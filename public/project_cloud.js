import {withStoredLimits} from './site_limits.js';
import { validateProjects } from './projects.js';

const endpoint = '/api/account/projects';
const offlineMessage = '云端项目暂时无法连接；当前显示此账户的离线缓存。修改需要联网，未保存的内容请先复制保留。';
function envelope(value) {
  if (!value || !Number.isSafeInteger(value.revision) || value.revision < 0) throw Error('云端项目版本无效，请刷新重试。');
  return { projects: withStoredLimits(()=>validateProjects(value.projects)), revision: value.revision };
}

// This database is deliberately separate from the original, local-only project library.
function accountCache(database, userId) {
  let pending;
  const open = () => {
    if (!database) return Promise.reject(Error('离线缓存不可用。'));
    return pending ||= new Promise((resolve, reject) => {
      const request = database.open('plaude-project-cloud-v1', 1);
      let blocked = false;
      request.onupgradeneeded = () => request.result.createObjectStore('accounts');
      request.onsuccess = () => { if (blocked) return request.result.close(); request.result.onversionchange = () => request.result.close(); resolve(request.result); };
      request.onerror = () => reject(Error('离线缓存打开失败。'));
      request.onblocked = () => { blocked = true; reject(Error('离线缓存被旧页面占用。')); };
    });
  };
  async function access(value) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('accounts', value === undefined ? 'readonly' : 'readwrite');
      const store = tx.objectStore('accounts'); let result;
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(Error('离线缓存读取或保存失败。'));
      if (value === undefined) { const request = store.get(userId); request.onsuccess = () => { result = request.result; }; }
      else store.put(value, userId);
    });
  }
  return { read: () => access(), write: value => access(value) };
}

export function createCloudProjectStore({ userId, fetchImpl = globalThis.fetch, database = globalThis.indexedDB, requestTimeoutMs = 20000 }) {
  if (typeof userId !== 'string' || !userId || userId.length > 128) throw Error('请先登录后打开云端项目。');
  const cache = accountCache(database, userId);
  let state = { mode: 'cloud', offline: false, cached: false, cacheUnavailable: false, revision: null };
  let queue = Promise.resolve();
  async function request(method, value) {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    let response;
    try {
    try {
      response = await fetchImpl(endpoint, {
        method, credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: { accept: 'application/json', 'x-plaude-account-id': userId, ...(method === 'PUT' ? { 'content-type': 'application/json', 'x-plaude-client': '1' } : {}) },
        ...(value === undefined ? {} : { body: JSON.stringify(value) }),
      });
    } catch {
      state.offline = true;
      const error = Error(offlineMessage); error.offline = true; throw error;
    }
    if (!response.ok) {
      const message = response.status === 409 ? '云端项目已在另一设备修改，未覆盖任何资料。请保留当前草稿，重新打开项目后再编辑。'
        : response.status === 401 ? '登录已过期，请重新登录；当前修改尚未保存。'
          : response.status === 403 ? '账户已切换或无权操作该项目，请重新打开项目。'
            : '云端项目读取或保存失败，旧资料仍保留，请稍后重试。';
      const error = Error(message); error.status = response.status; error.offline = response.status >= 500; if (error.offline) state.offline = true; throw error;
    }
    const data = await response.json().catch(e => {
      if (!controller.signal.aborted) throw e;
      state.offline = true; const error = Error(offlineMessage); error.offline = true; throw error;
    });
    if (data.userId && data.userId !== userId) throw Error('账户身份不匹配，未载入项目资料。');
    return envelope(data);
    } finally { clearTimeout(timeout); }
  }
  async function remember(value) {
    try { await cache.write(value); state.cacheUnavailable = false; }
    catch { state.cacheUnavailable = true; }
    state = { ...state, offline: false, cached: false, revision: value.revision };
    return value;
  }
  async function online() { return remember(await request('GET')); }
  async function mutate(change) {
    const current = await online();
    const next = structuredClone(current.projects);
    change(next);
    const projects = validateProjects(next);
    const saved = await remember(await request('PUT', { projects, revision: current.revision }));
    return structuredClone(saved.projects);
  }
  const change = action => {
    const pending = queue.then(() => mutate(action));
    queue = pending.catch(() => {});
    return pending;
  };
  return {
    get status() { return { ...state }; },
    async read() {
      try { return structuredClone((await online()).projects); }
      catch (error) {
        if (!error.offline) throw error;
        state.offline = true;
        let saved;
        try { saved = envelope(await cache.read()); } catch { throw error; }
        state = { ...state, cached: true, revision: saved.revision };
        return structuredClone(saved.projects);
      }
    },
    save: project => change(s => {
      const index = s.projects.findIndex(p => p.id === project.id), current = s.projects[index];
      if (current && current.revision !== project.revision) throw Error('项目已在其他设备修改，请保留草稿，重新打开项目后再编辑。');
      const next = { ...project, revision: (current?.revision || 0) + 1 };
      if (index < 0) { if (project.revision !== 0) throw Error('项目已删除，请重新打开项目。'); s.projects.push(next); }
      else s.projects[index] = next;
    }),
    link: (conversationId, projectId) => change(s => {
      if (projectId && !s.projects.some(p => p.id === projectId)) throw Error('项目已删除。');
      s.links = s.links.filter(l => l.conversationId !== conversationId);
      if (projectId) s.links.push({ conversationId, projectId });
    }),
    inherit: (sourceId, targetId) => change(s => {
      const source = s.links.find(l => l.conversationId === sourceId);
      if (source && !s.links.some(l => l.conversationId === targetId)) s.links.push({ conversationId: targetId, projectId: source.projectId });
    }),
    remove: (id, revision) => change(s => {
      const project = s.projects.find(p => p.id === id);
      if (project && project.revision !== revision) throw Error('项目已在其他设备修改，请重新打开后再删除。');
      s.projects = s.projects.filter(p => p.id !== id); s.links = s.links.filter(l => l.projectId !== id);
    }),
    import: value => {
      const incoming = validateProjects(value);
      return change(s => {
        if (incoming.projects.some(p => s.projects.some(existing => existing.id === p.id)) || incoming.links.some(l => s.links.some(existing => existing.conversationId === l.conversationId))) throw Error('备份与现有项目或对话关联冲突，未导入；请先导出保留现有内容，再处理冲突项目。');
        s.projects.push(...incoming.projects); s.links.push(...incoming.links);
      });
    },
  };
}
