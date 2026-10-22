// Text edits only. Each page owns a separate slot, so concurrent tabs cannot overwrite drafts.
const ROOT = 'plaude-project-editor-v1:';
const ID = /^[A-Za-z0-9_-]{8,128}$/;
export function createProjectDraftStore({ userId = '', storage, writerId = crypto.randomUUID(), now = Date.now } = {}) {
  if (typeof userId !== 'string' || userId.length > 128 || !ID.test(writerId)) throw Error('项目草稿身份无效。');
  try { storage ??= globalThis.localStorage; } catch {}
  const prefix = ROOT + (userId ? 'account:' + encodeURIComponent(userId) : 'guest') + ':';
  function valid(value) {
    return value?.version === 1 && value.owner === userId && typeof value.projectId === 'string' && ID.test(value.projectId)
      && Number.isSafeInteger(value.revision) && value.revision >= 0 && Number.isSafeInteger(value.updatedAt)
      && ['name','baselineName'].every(key => typeof value[key] === 'string' && value[key].length <= 60)
      && ['instructions','baselineInstructions'].every(key => typeof value[key] === 'string' && value[key].length <= 2000);
  }
  function read(key) {
    if (typeof key !== 'string' || !key.startsWith(prefix)) throw Error('无权读取其他账户的项目草稿。');
    const raw = storage.getItem(key);
    if (!raw) return null;
    try { const value = JSON.parse(raw); return valid(value) ? { ...value, key, raw } : null; } catch { return null; }
  }
  function list() {
    if (!storage) throw Error('浏览器存储不可用。');
    const result = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(prefix)) { const value = read(key); if (value) result.push(value); }
    }
    return result.sort((a,b) => b.updatedAt - a.updatedAt);
  }
  function remove(key, expectedRaw) {
    const value = read(key);
    if (expectedRaw !== undefined && value?.raw !== expectedRaw) throw Error('该草稿又被其他页面修改，已保留新版草稿。');
    storage.removeItem(key);
  }
  return Object.freeze({ list, read, remove, keyFor: projectId => prefix + writerId + ':' + projectId,
    save({ projectId, revision, name, instructions, baselineName, baselineInstructions }) {
      const value = { version: 1, owner: userId, projectId, revision, name, instructions, baselineName, baselineInstructions, updatedAt: now() };
      if (!valid(value)) throw Error('项目草稿内容无效，未保存。');
      const key = prefix + writerId + ':' + projectId;
      if (!storage.getItem(key) && list().length >= 64) throw Error('本机项目草稿已达 64 份，请先恢复或删除旧草稿。');
      storage.setItem(key, JSON.stringify(value));
      return read(key);
    },
  });
}
