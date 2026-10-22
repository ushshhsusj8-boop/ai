import { validateDocuments } from './document_library.js';
export const PROJECT_BYTES = 16 * 1024 * 1024;
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(value);
export function validateProjects(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.projects) || value.projects.length > 20 || !Array.isArray(value.links) || value.links.length > 10000) throw Error('项目备份格式无效，最多 20 个项目、10000 个关联。');
  const ids = new Set(), chats = new Set();
  const projects = value.projects.map(p => {
    if (!p || !validId(p.id) || ids.has(p.id) || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 60 || typeof p.instructions !== 'string' || p.instructions.length > 2000 || !Number.isSafeInteger(p.revision) || p.revision < 0) throw Error('项目名称、指令或版本无效。');
    ids.add(p.id);
    return { id: p.id, name: p.name.trim(), instructions: p.instructions, revision: p.revision, documents: validateDocuments(p.documents) };
  });
  const links = value.links.map(link => {
    if (!link || !validId(link.conversationId) || !ids.has(link.projectId) || chats.has(link.conversationId)) throw Error('项目对话关联无效。');
    chats.add(link.conversationId); return { conversationId: link.conversationId, projectId: link.projectId };
  });
  const result = { version: 1, projects, links };
  if (new TextEncoder().encode(JSON.stringify(result)).length > PROJECT_BYTES) throw Error('项目库已满（16 MiB），请先导出并清理资料。旧内容仍保留。');
  return result;
}
export function projectContext(state, conversation) {
  state = validateProjects(state);
  const link = state.links.find(l => l.conversationId === conversation.id);
  const project = state.projects.find(p => p.id === link?.projectId);
  const documents = [...(project?.documents || []), ...(conversation.documents || [])].filter(d => d.enabled !== false);
  if (documents.length > 3) throw Error('项目与对话合计最多引用 3 份资料，请先暂停部分文件。');
  const instructions = [project?.instructions, conversation.instructions].filter(Boolean).join('\n\n');
  if (instructions.length > 2000) throw Error('项目指令与对话回答方式合计超过 2000 字符，请缩短后再发送。');
  return { instructions, documents: validateDocuments(documents), project };
}
export function createProjectStore(database = globalThis.indexedDB) {
  let pending;
  const empty = () => ({ version: 1, projects: [], links: [] });
  function open() {
    if (!database) return Promise.reject(Error('项目存储不可用，请允许浏览器保存网站数据。'));
    return pending ||= new Promise((resolve, reject) => {
      const request = database.open('plaude-projects-v1', 1); let blocked = false;
      request.onupgradeneeded = () => request.result.createObjectStore('workspace');
      request.onsuccess = () => { if (blocked) return request.result.close(); request.result.onversionchange = () => request.result.close(); resolve(request.result); };
      request.onerror = () => reject(Error('项目存储打开失败，请检查浏览器权限。'));
      request.onblocked = () => { blocked = true; reject(Error('请关闭其他旧页面后刷新项目库。')); };
    });
  }
  async function transact(change) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('workspace', change ? 'readwrite' : 'readonly'), store = tx.objectStore('workspace');
      let result, failure;
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(failure || Error('项目保存失败，旧内容仍保留。请检查存储空间或权限。'));
      const req = store.get('all');
      req.onsuccess = () => { try { result = validateProjects(req.result || empty()); if (change) { change(result); result = validateProjects(result); store.put(result, 'all'); } } catch (e) { failure = e; tx.abort(); } };
    });
  }
  return {
    read: () => transact(),
    save: project => transact(s => {
      const index = s.projects.findIndex(p => p.id === project.id), current = s.projects[index];
      if (current && current.revision !== project.revision) throw Error('项目已在其他页面修改，请重新打开项目后再编辑。');
      const next = { ...project, revision: (current?.revision || 0) + 1 };
      if (index < 0) { if (project.revision !== 0) throw Error('项目已删除，请重新打开项目。'); s.projects.push(next); } else s.projects[index] = next;
    }),
    link: (conversationId, projectId) => transact(s => { if (projectId && !s.projects.some(p => p.id === projectId)) throw Error('项目已删除。'); s.links = s.links.filter(l => l.conversationId !== conversationId); if (projectId) s.links.push({ conversationId, projectId }); }),
    inherit: (sourceId, targetId) => transact(s => {
      const source = s.links.find(l => l.conversationId === sourceId);
      if (source && !s.links.some(l => l.conversationId === targetId)) s.links.push({ conversationId: targetId, projectId: source.projectId });
    }),
    remove: (id, revision) => transact(s => { const p = s.projects.find(p => p.id === id); if (p && p.revision !== revision) throw Error('项目已在其他页面修改，请重新打开后再删除。'); s.projects = s.projects.filter(p => p.id !== id); s.links = s.links.filter(l => l.projectId !== id); }),
    import: value => { const incoming = validateProjects(value); return transact(s => {
      if (incoming.projects.some(p => s.projects.some(existing => existing.id === p.id)) || incoming.links.some(l => s.links.some(existing => existing.conversationId === l.conversationId))) throw Error('备份与现有项目或对话关联冲突，未导入；请先导出保留现有内容，再删除冲突项目。');
      s.projects.push(...incoming.projects); s.links.push(...incoming.links);
    }); },
  };
}
