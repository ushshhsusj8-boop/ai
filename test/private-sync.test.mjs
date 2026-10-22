import test from 'node:test';
import assert from 'node:assert/strict';

// account.js performs identity bootstrap before any browser storage is read.
const originalFetch = globalThis.fetch, originalChannel = globalThis.BroadcastChannel, originalWindow = globalThis.window;
globalThis.fetch = async () => new Response(JSON.stringify({ enabled: true, user: { id: 'test-private-user' } }));
globalThis.BroadcastChannel = class { addEventListener() {} };
globalThis.window = { addEventListener() {} };
const { createPrivateSync } = await import('../public/private_sync.js');
globalThis.fetch = originalFetch; globalThis.BroadcastChannel = originalChannel; globalThis.window = originalWindow;

const clone = value => structuredClone(value);
const conversation = (id = 'conversation-first', text = '原始消息') => ({ id, title: '测试聊天', provider: 'deepseek', model: 'deepseek-chat', messages: text ? [{ role: 'user', content: text }] : [], documents: [], updatedAt: 1 });
const payload = c => ({ id: c.id, title: c.title, provider: c.provider, model: c.model, messages: clone(c.messages), documents: clone(c.documents), updatedAt: c.updatedAt });
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function gate() { let entered, release; return { entered: new Promise(resolve => entered = resolve), wait: new Promise(resolve => release = resolve), enter: () => entered(), release: () => release() }; }
function remoteServer() {
  const records = new Map(), calls = [];
  let offline = false, getGate, putGate, lostAcknowledgement = false, normalize = false;
  return {
    records, calls,
    set offline(value) { offline = value; }, set getGate(value) { getGate = value; }, set putGate(value) { putGate = value; },
    set lostAcknowledgement(value) { lostAcknowledgement = value; }, set normalize(value) { normalize = value; },
    seed(c, revision = 1) { records.set(c.id, { conversation: payload(c), revision }); },
    async fetch(url, options) {
      calls.push({ url, ...options });
      if (offline) throw Error('模拟断网');
      if (!options.method) {
        if (getGate) { const current = getGate; getGate = null; current.enter(); await current.wait; }
        return response({ userId: 'test-private-user', conversations: [...records.values()].map(clone) });
      }
      const id = decodeURIComponent(url.split('/').at(-1)), body = JSON.parse(options.body), old = records.get(id);
      if (options.method === 'DELETE') {
        if (!old) return response({}, 404);
        if (old.revision !== body.revision) return response({}, 409);
        records.delete(id); return response({ userId: 'test-private-user', deleted: true });
      }
      if (putGate) { const current = putGate; putGate = null; current.enter(); await current.wait; }
      if ((old?.revision || 0) !== body.revision) return response({}, 409);
      const c = clone(body.conversation); if (normalize) c.title = c.title.trim();
      const record = { conversation: c, revision: (old?.revision || 0) + 1 }; records.set(id, record);
      if (lostAcknowledgement) { lostAcknowledgement = false; throw Error('响应丢失'); }
      return response({ userId: 'test-private-user', ...record });
    },
  };
}
function client(remote, initial = [], options = {}) {
  const local = initial.map(clone), statuses = [], busyIds = new Set(), saved = new Map(); let changes = 0, sync;
  const storage = { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value) };
  sync = createPrivateSync({ conversations: () => local, payload, fetchImpl: remote.fetch, storage,
    currentUser: () => ({ id: 'test-private-user' }), onIdentityChanged: () => {}, confirmImpl: () => true,
    busy: id => busyIds.has(id), isLinked: c => c.projectLinked === true,
    status: text => statuses.push(text),
    replace(c, id = c?.id) { const index = local.findIndex(item => item.id === id); if (!c) { if (index >= 0) local.splice(index, 1); } else if (index >= 0) local[index] = clone(c); else local.push(clone(c)); },
    changed() { changes++; if (options.autosave) void sync.sync(); }, requestTimeoutMs: options.requestTimeoutMs,
  });
  return { sync, local, statuses, busyIds, saved, get changes() { return changes; } };
}

test('initial pull loads private conversations and changed autosave terminates without a sync loop', async () => {
  const remote = remoteServer(); remote.seed(conversation()); const app = client(remote, [], { autosave: true });
  const result = await app.sync.sync(); assert.equal(result.synced, true); assert.equal(app.local.length, 1); assert.equal(app.changes, 1);
  assert.equal(remote.calls.filter(c => c.method === 'PUT').length, 0); assert.ok(remote.calls.length <= 3);
  await app.sync.sync(); assert.equal(app.changes, 1);
});

test('a stalled response body times out, preserves edits and releases the queue for a successful retry', async () => {
  const remote = remoteServer(); let stall = true;
  const fetchImpl = remote.fetch;
  remote.fetch = async (url, options) => stall ? {ok: true, status: 200, json: () => new Promise((resolve,reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), {once:true}))} : fetchImpl(url, options);
  const app = client(remote, [conversation()], {requestTimeoutMs: 15});
  const result = await app.sync.sync(); assert.equal(result.synced, false); assert.match(result.error, /超时/); assert.equal(app.local.length, 1);
  stall = false; assert.equal((await app.sync.sync()).synced, true); assert.equal(remote.records.size, 1);
});

test('conflict resolution never claims a new copy is cloud-saved when uploading the copy fails', async () => {
  const remote = remoteServer(); remote.seed(conversation('conversation-first', '云端修改'), 2);
  const fetchImpl = remote.fetch;
  remote.fetch = async (url, options) => options.method === 'PUT' && !url.endsWith('/conversation-first') ? Promise.reject(Error('副本上传失败')) : fetchImpl(url, options);
  const protectedClient = client(remote, []); await protectedClient.sync.sync();
  protectedClient.local[0].messages[0].content = '需保留的本机修改'; remote.records.get('conversation-first').revision++;
  remote.records.get('conversation-first').conversation.messages[0].content = '新的云端修改';
  const message = await protectedClient.sync.resolve();
  assert.match(message, /尚未同步/); assert.equal(protectedClient.local.length, 2);
  assert.ok(protectedClient.local.some(c => c.messages[0].content === '需保留的本机修改'));
  assert.equal(remote.records.size, 1);
});

test('a save during an active pull is queued and the completed generated answer reaches the server', async () => {
  const remote = remoteServer(), app = client(remote, [conversation()]); await app.sync.sync();
  app.busyIds.add('conversation-first'); app.local[0].messages.push({ role: 'assistant', content: '生成中' });
  const blocked = gate(); remote.getGate = blocked; const first = app.sync.sync(); await blocked.entered;
  app.busyIds.clear(); app.local[0].messages[1].content = '完整回答，结束'; const second = app.sync.sync(); blocked.release();
  await Promise.all([first, second]);
  assert.equal(remote.records.get('conversation-first').conversation.messages[1].content, '完整回答，结束');
  assert.equal(app.statuses.at(-1), '个人私有空间 · 已同步到云端');
});

test('edits during an in-flight PUT are retained and uploaded in a following pass', async () => {
  const remote = remoteServer(), app = client(remote, [conversation()]); await app.sync.sync();
  app.local[0].messages.push({ role: 'assistant', content: '第一次编辑' });
  const blocked = gate(); remote.putGate = blocked; const running = app.sync.sync(); await blocked.entered;
  app.local[0].messages[1].content = '保存期间的最终编辑'; const queued = app.sync.sync(); blocked.release();
  await Promise.all([running, queued]);
  assert.equal(remote.records.get('conversation-first').conversation.messages[1].content, '保存期间的最终编辑');
  assert.equal(app.local[0].messages[1].content, '保存期间的最终编辑');
});

test('busy generation reports pending and does not claim every conversation is synced', async () => {
  const remote = remoteServer(), app = client(remote, [conversation()]); app.busyIds.add('conversation-first');
  const result = await app.sync.sync(); assert.equal(result.synced, false); assert.equal(result.pending, 1);
  assert.match(app.statuses.at(-1), /正在生成或等待同步/); assert.equal(remote.records.size, 0);
});

test('empty project-linked chats synchronize while ordinary empty drafts stay local', async () => {
  const remote = remoteServer(), linked = { ...conversation('linked-conversation', ''), projectLinked: true };
  const app = client(remote, [linked, conversation('unlinked-conversation', '')]); await app.sync.sync();
  assert.equal(remote.records.has('linked-conversation'), true); assert.equal(remote.records.has('unlinked-conversation'), false);
});

test('two-device revision conflicts preserve local edits and resolution keeps both private versions', async () => {
  const remote = remoteServer(), app = client(remote, [conversation()]); await app.sync.sync();
  remote.seed(conversation('conversation-first', '另一设备的内容'), 2); app.local[0].messages[0].content = '本机未同步修改';
  const result = await app.sync.sync(); assert.equal(result.conflicts, 1); assert.equal(app.local[0].messages[0].content, '本机未同步修改');
  assert.equal(remote.records.get('conversation-first').conversation.messages[0].content, '另一设备的内容');
  await app.sync.resolve(); assert.equal(app.local.length, 2);
  assert.deepEqual(new Set(app.local.map(c => c.messages[0].content)), new Set(['另一设备的内容', '本机未同步修改']));
  assert.equal(remote.records.size, 2);
});

test('offline failures retain local changes and reconnect uploads them', async () => {
  const remote = remoteServer(), app = client(remote, [conversation()]); await app.sync.sync();
  app.local[0].messages[0].content = '断网修改'; remote.offline = true;
  assert.equal((await app.sync.sync()).synced, false); assert.match(app.statuses.at(-1), /尚未同步/);
  assert.equal(app.local[0].messages[0].content, '断网修改'); remote.offline = false;
  assert.equal((await app.sync.sync()).synced, true); assert.equal(remote.records.get('conversation-first').conversation.messages[0].content, '断网修改');
});

test('a lost successful PUT acknowledgement reconciles identical server content without a false conflict', async () => {
  const remote = remoteServer(), app = client(remote, [conversation()]); remote.lostAcknowledgement = true;
  assert.equal((await app.sync.sync()).synced, false); assert.equal(remote.records.size, 1);
  const result = await app.sync.sync(); assert.equal(result.synced, true); assert.equal(result.conflicts, 0);
});

test('remote deletion removes an unchanged local copy and preserves dirty local content as a conflict', async () => {
  const remote = remoteServer(), app = client(remote, [conversation()]); await app.sync.sync();
  remote.records.delete('conversation-first'); await app.sync.sync(); assert.equal(app.local.length, 0);
  const other = client(remote, [conversation('conversation-other')]); await other.sync.sync();
  remote.records.delete('conversation-other'); other.local[0].messages[0].content = '删除前本机修改';
  const result = await other.sync.sync(); assert.equal(result.conflicts, 1); assert.equal(other.local.length, 1);
  await other.sync.resolve(); assert.equal(other.local.length, 1); assert.notEqual(other.local[0].id, 'conversation-other');
  assert.equal(other.local[0].messages[0].content, '删除前本机修改');
});

test('explicit deletion uses the confirmed revision, and conflicting deletion retains the original', async () => {
  const remote = remoteServer(), app = client(remote, [conversation()]); await app.sync.sync();
  remote.seed(conversation(), 2); await assert.rejects(app.sync.remove('conversation-first'));
  assert.equal(remote.records.has('conversation-first'), true); assert.equal(app.local.length, 1);
  await app.sync.sync(); await app.sync.remove('conversation-first'); assert.equal(remote.records.size, 0);
});

test('server normalization is adopted once and does not cause endlessly dirty uploads', async () => {
  const remote = remoteServer(); remote.normalize = true;
  const app = client(remote, [{ ...conversation(), title: '  测试聊天  ' }], { autosave: true });
  assert.equal((await app.sync.sync()).synced, true); assert.equal(app.local[0].title, '测试聊天');
  assert.equal(remote.calls.filter(c => c.method === 'PUT').length, 1);
});


test('sync busy state covers held responses and queued sync calls until all cloud work finishes', async () => {
  const remote=remoteServer(),blocked=gate(),app=client(remote,[conversation()]);
  assert.equal(app.sync.running,false);remote.getGate=blocked;
  const first=app.sync.sync();await blocked.entered;assert.equal(app.sync.running,true);
  const queued=app.sync.sync();assert.equal(app.sync.running,true);blocked.release();
  const results=await Promise.all([first,queued]);assert.equal(results.every(r=>r.synced),true);assert.equal(app.sync.running,false);
});

test('failed cloud work releases busy state so a later backup or explicit retry is not permanently blocked', async () => {
  const remote=remoteServer(),app=client(remote,[conversation()]);remote.offline=true;
  assert.equal((await app.sync.sync()).synced,false);assert.equal(app.sync.running,false);
  remote.offline=false;assert.equal((await app.sync.sync()).synced,true);assert.equal(app.sync.running,false);
  assert.equal(remote.records.size,1);
});
