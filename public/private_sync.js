import { scopedStorage } from './scoped_storage.js';
import { accountUser, accountHeaders, identityChanged } from './account.js';
import {branchOrigin} from './conversation_branches.js';

export function createPrivateSync({ conversations, payload, replace, changed, busy, status, isLinked = () => false,
  fetchImpl = globalThis.fetch, storage = scopedStorage, currentUser = () => accountUser,
  onIdentityChanged = identityChanged, confirmImpl = message => globalThis.confirm(message), requestTimeoutMs = 20000 }) {
  const key = 'plaude-private-sync-v1';
  let known = {}, running = null, ready = false, syncAgain = false;
  const conflicts = new Map(), deleting = new Set();
  try { const saved = JSON.parse(storage.getItem(key) || '{}'); if (saved && typeof saved === 'object' && !Array.isArray(saved)) known = saved; } catch {}
  const persist = () => storage.setItem(key, JSON.stringify(known));
  const fingerprint = c => JSON.stringify(payload(c));
  const usable = c => c.provider && c.model && (c.messages?.length || c.documents?.length || c.branch || isLinked(c));
  async function request(path = '', options = {}) {
    const userId = currentUser()?.id;
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
    const response = await fetchImpl('/api/account/conversations' + path, { ...options, credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
      headers: { 'content-type': 'application/json', ...accountHeaders(), ...(userId ? { 'x-plaude-client': '1', 'x-plaude-account-id': userId } : {}) } });
    const data = await response.json().catch(e => { if (controller.signal.aborted) throw e; return {}; });
    if ([401, 403].includes(response.status)) { onIdentityChanged(); throw Error('登录状态已改变，请重新登录。'); }
    if (!response.ok) { const error = Error(data.error || `云端保存失败（${response.status}）`); error.status = response.status; throw error; }
    if (!userId || currentUser()?.id !== userId || (data.userId && data.userId !== userId)) throw Error('账户身份不匹配，未载入资料。');
    return data;
    } catch (e) { if (controller.signal.aborted) throw Error('聊天同步请求超时，请重新连接后点击“立即同步聊天”。'); throw e; }
    finally { clearTimeout(timeout); }
  }
  function remember(record) { known[record.conversation.id] = { revision: record.revision, fingerprint: fingerprint(record.conversation) }; }
  async function pull() {
    const data = await request(), remoteIds = new Set(); let modified = false;
    if (!Array.isArray(data.conversations)) throw Error('云端聊天格式无效，未替换本机内容。');
    for (const record of data.conversations) {
      const cloud = record.conversation, local = conversations().find(c => c.id === cloud.id), base = known[cloud.id]; remoteIds.add(cloud.id);
      if (busy(cloud.id) || deleting.has(cloud.id)) continue;
      const localFingerprint = local && fingerprint(local), cloudFingerprint = fingerprint(cloud);
      // An acknowledgement may have been lost after a successful PUT. Equal content is safe to reconcile.
      if (local && localFingerprint === cloudFingerprint) { remember(record); conflicts.delete(cloud.id); continue; }
      const dirty = local && base && localFingerprint !== base.fingerprint;
      if (local && (!base || (base.revision !== record.revision && dirty))) { conflicts.set(cloud.id, record); continue; }
      if (!local || !dirty) { replace(cloud); remember(record); conflicts.delete(cloud.id); modified = true; }
    }
    for (const id of Object.keys(known)) {
      if (remoteIds.has(id) || busy(id) || deleting.has(id)) continue;
      const local = conversations().find(c => c.id === id);
      if (local && fingerprint(local) !== known[id].fingerprint) conflicts.set(id, null);
      else { if (local) { replace(null, id); modified = true; } delete known[id]; conflicts.delete(id); }
    }
    ready = true; persist(); if (modified) changed();
  }
  async function push() {
    let modified = false;
    for (const c of [...conversations()]) {
      if (!usable(c) || busy(c.id) || deleting.has(c.id) || conflicts.has(c.id)) continue;
      const base = known[c.id], submitted = payload(c), submittedFingerprint = JSON.stringify(submitted);
      if (base?.fingerprint === submittedFingerprint) continue;
      try {
        const data = await request('/' + encodeURIComponent(c.id), { method: 'PUT', body: JSON.stringify({ conversation: submitted, revision: base?.revision || 0 }) });
        remember({ conversation: data.conversation, revision: data.revision }); persist();
        const latest = conversations().find(local => local.id === c.id);
        // Only adopt normalization if no new answer/edit arrived while the request was in flight.
        if (latest && !busy(c.id) && fingerprint(latest) === submittedFingerprint && fingerprint(latest) !== fingerprint(data.conversation)) {
          replace(data.conversation); modified = true;
        }
      } catch (error) { if (error.status !== 409) throw error; conflicts.set(c.id, undefined); }
    }
    if (modified) changed();
  }
  function pendingCount() {
    return conversations().filter(c => busy(c.id) || deleting.has(c.id)
      || (usable(c) && !conflicts.has(c.id) && fingerprint(c) !== known[c.id]?.fingerprint)).length;
  }
  function report() {
    const pending = pendingCount();
    status(conflicts.size ? `有 ${conflicts.size} 段同步冲突 · 本机内容保留，打开个人账户处理${pending ? ` · 另有 ${pending} 段待同步` : ''}`
      : pending ? `个人私有空间 · ${pending} 段正在生成或等待同步，本机内容保留` : '个人私有空间 · 已同步到云端');
    return { synced: !conflicts.size && !pending, conflicts: conflicts.size, pending };
  }
  function sync() {
    syncAgain = true;
    if (running) return running;
    let failed = false;
    running = (async () => {
      let result;
      try {
        do {
          syncAgain = false;
          if (!ready) await pull();
          await push(); await pull();
          // Also catch changes made without an explicit save callback while the network was pending.
          if (conversations().some(c => usable(c) && !busy(c.id) && !deleting.has(c.id) && !conflicts.has(c.id) && fingerprint(c) !== known[c.id]?.fingerprint)) syncAgain = true;
        } while (syncAgain);
        result = report();
      } catch (error) { failed = true; status(`尚未同步：${error.message} · 本机内容保留`); result = { synced: false, conflicts: conflicts.size, pending: pendingCount(), error: error.message }; }
      return result;
    })().finally(() => { running = null; if (syncAgain && !failed) void sync(); });
    return running;
  }
  return { sync, get running() { return Boolean(running); }, async remove(id) {
    deleting.add(id);
    try {
      if (running) await running;
      const base = known[id];
      if (base) {
        try { await request('/' + encodeURIComponent(id), { method: 'DELETE', body: JSON.stringify({ revision: base.revision }) }); }
        catch (error) { if (error.status === 409) conflicts.set(id, undefined); if (error.status !== 404) throw error; }
        delete known[id]; conflicts.delete(id); persist();
      }
    } finally { deleting.delete(id); }
  }, async resolve() {
    await sync(); if (!conflicts.size) return '没有待处理的同步冲突。';
    if (!confirmImpl(`有 ${conflicts.size} 段对话在其他设备发生修改。将本机版本另存为私有副本，然后载入云端新版；不会覆盖云端。继续？`)) return '本机版本仍保留，未覆盖云端。';
    const data = await request(), remote = new Map(data.conversations.map(record => [record.conversation.id, record]));
    for (const id of conflicts.keys()) {
      if (busy(id)) throw Error('请先停止此对话的生成，再处理冲突。');
      const local = conversations().find(c => c.id === id);
      if (local) replace({ ...structuredClone(local), id: crypto.randomUUID(),branch:branchOrigin(local,Math.max(0,local.messages.length-1),'copy'), title: ((local.title || '对话') + ' · 本机副本').slice(0, 60), updatedAt: Date.now() });
      const cloud = remote.get(id); if (cloud) { replace(cloud.conversation); remember(cloud); } else { replace(null, id); delete known[id]; }
    }
    conflicts.clear(); persist(); changed(); const result = await sync();
    return result.synced ? '本机修改已另存为私有副本并同步，云端新版已载入。'
      : '本机修改已另存本机私有副本，云端新版已载入；副本尚未同步，请查看同步状态并重试。';
  } };
}
