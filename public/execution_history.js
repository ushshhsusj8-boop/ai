import {getLimits} from './site_limits.js';
import { getStorageScope } from './scoped_storage.js';
const DATABASE = 'plaude-code-history-v1';
export const HISTORY_LIMIT = getLimits().historyCount;
export const HISTORY_BYTES = getLimits().historyBytes;
export const HISTORY_IMPORT_BYTES = getLimits().historyBytes+2*1024*1024;
const bytes = value => new TextEncoder().encode(value).length;
const STATUSES = new Set(['completed', 'failed', 'timeout', 'output_limit', 'cancelled', 'interrupted']);

export function executionRecord(job, result, { localId = crypto.randomUUID(), createdAt = Date.now(), resultReceived = true, error = '' } = {}) {
  if (!job || !['python', 'java'].includes(job.language) || typeof job.code !== 'string' || !job.code.trim() || bytes(job.code) > 32768 || typeof job.stdin !== 'string' || bytes(job.stdin) > 16384) throw Error('代码最多 32 KiB，标准输入最多 16 KiB。');
  if (!result || !STATUSES.has(result.status) || typeof result.stdout !== 'string' || typeof result.stderr !== 'string' || bytes(result.stdout) + bytes(result.stderr) > 131072 ||
      !Number.isFinite(result.durationMs) || result.durationMs < 0 || !(result.exitCode === null || Number.isInteger(result.exitCode))) throw Error('运行记录格式不正确。');
  if (typeof localId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(localId) || !Number.isSafeInteger(createdAt) || createdAt < 0) throw Error('运行记录标识不正确。');
  return { localId, createdAt, id: String(result.id || '').slice(0, 80), language: job.language, code: job.code, stdin: job.stdin,
    status: result.status, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, durationMs: result.durationMs,
    resultReceived: Boolean(resultReceived), error: String(error).slice(0, 500) };
}
export function validateExecutionRecord(record) {
  return executionRecord(record, record, { localId: record.localId, createdAt: record.createdAt, resultReceived: record.resultReceived, error: record.error });
}
export function checkHistoryCapacity(records, candidate) {
  const remaining = records.filter(record => record.localId !== candidate.localId);
  if (remaining.length >= getLimits().historyCount || bytes(JSON.stringify([...remaining, candidate])) > getLimits().historyBytes) throw Error('本机运行历史已满（超过当前条数或字节预算）。旧记录仍保留；请先下载并删除不需要的记录，再保存当前结果。');
}
const RECORD_FIELDS = new Set(['localId','createdAt','id','language','code','stdin','status','stdout','stderr','exitCode','durationMs','resultReceived','error']);
function importRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record) || Object.keys(record).some(key => !RECORD_FIELDS.has(key)) ||
      typeof record.id !== 'string' || record.id.length > 80 || typeof record.resultReceived !== 'boolean' ||
      typeof record.error !== 'string' || record.error.length > 500) throw Error('备份中的运行记录字段或类型无效。');
  return validateExecutionRecord(record);
}
export function parseHistoryBackup(text) {
  if (typeof text !== 'string' || bytes(text) > getLimits().historyBytes+2*1024*1024) throw Error('运行历史备份最多 10 MiB。');
  let data; try { data = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw Error('请选择有效的运行历史 JSON 备份。'); }
  if (!data || Array.isArray(data) || data.version !== 1 || (data.format !== undefined && data.format !== 'plaude-code-history') ||
      Object.keys(data).some(key => !['version','format','exportedAt','runs'].includes(key)) ||
      typeof data.exportedAt !== 'string' || data.exportedAt.length > 80 || !Number.isFinite(Date.parse(data.exportedAt)) ||
      !Array.isArray(data.runs) || data.runs.length > getLimits().historyCount) throw Error('运行历史备份格式无效或超过 100 条。');
  return data.runs.map(importRecord);
}
const contentKey = record => JSON.stringify(Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'localId')));
const historySnapshot = records => JSON.stringify(records.map(validateExecutionRecord).sort((a,b) => a.localId.localeCompare(b.localId)));
export function planHistoryImport(incoming, existing, { newId = () => crypto.randomUUID() } = {}) {
  if (!Array.isArray(incoming) || incoming.length > getLimits().historyCount) throw Error('运行历史备份最多 100 条。');
  const source = incoming.map(importRecord), current = existing.map(validateExecutionRecord), all = [...current];
  const ids = new Set(current.map(record => record.localId)), contents = new Set(current.map(contentKey));
  const additions = []; let skipped = 0, renamed = 0;
  for (const original of source) {
    if (contents.has(contentKey(original))) { skipped++; continue; }
    let record = original;
    if (ids.has(record.localId)) {
      let id, attempts = 0;
      do { id = newId(); if (++attempts > 20) throw Error('无法生成新的记录编号，请重新预览。'); } while (ids.has(id));
      record = importRecord({...original, localId:id}); renamed++;
    }
    checkHistoryCapacity(all, record); all.push(record); additions.push(record); ids.add(record.localId); contents.add(contentKey(record));
  }
  return { baseline:historySnapshot(current), additions, skipped, renamed, total:all.length, bytes:bytes(JSON.stringify(all)) };
}
export function searchExecutionHistory(records, query = '', language = 'all', field = 'all') {
  const term = String(query).trim().slice(0,200).normalize('NFKC').toLocaleLowerCase();
  return records.filter(record => {
    if (language !== 'all' && record.language !== language) return false;
    const text = field === 'code' ? record.code : field === 'output' ? [record.stdout,record.stderr,record.error].join('\n') :
      [record.code,record.stdin,record.stdout,record.stderr,record.error].join('\n');
    return !term || text.normalize('NFKC').toLocaleLowerCase().includes(term);
  });
}
export function createExecutionHistory(database = globalThis.indexedDB) {
  let pending;
  const scope = getStorageScope();
  function open() {
    if (!database) return Promise.reject(Error('浏览器不允许本机历史存储。当前结果仍可下载。'));
    if (scope === undefined || scope !== getStorageScope()) return Promise.reject(Error('账户身份已改变，请刷新页面后查看运行历史。'));
    if (!pending) pending = new Promise((resolve, reject) => {
      const name = scope === null ? DATABASE : `${DATABASE}-account-${encodeURIComponent(scope)}`;
      const request = database.open(name, 1); let blocked = false;
      request.onupgradeneeded = () => { const db = request.result; db.createObjectStore('runs', { keyPath: 'localId' }); db.createObjectStore('drafts'); };
      request.onsuccess = () => { if (blocked) { request.result.close(); return; } request.result.onversionchange = () => request.result.close(); resolve(request.result); };
      request.onerror = () => reject(Error('本机历史存储无法打开，请检查浏览器存储设置。'));
      request.onblocked = () => { blocked = true; reject(Error('本机历史升级被其他页面占用，请关闭旧页面后刷新。')); };
    });
    return pending;
  }
  async function transaction(store, mode, action) {
    const db = await open();
    if (scope !== getStorageScope()) throw Error('账户身份已改变，请刷新页面后查看运行历史。');
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode), object = tx.objectStore(store); let value, failure;
      tx.oncomplete = () => resolve(value);
      tx.onabort = tx.onerror = () => reject(failure || Error('本机存储失败，当前结果仍可下载；请检查剩余空间或浏览器权限。'));
      try { action(object, result => { value = result; }, error => { failure = error; tx.abort(); }); }
      catch (error) { failure = error; tx.abort(); }
    });
  }
  return {
    list: () => transaction('runs', 'readonly', (store, done, fail) => { const request = store.getAll(); request.onsuccess = () => { try { done(request.result.map(validateExecutionRecord).sort((a, b) => b.createdAt - a.createdAt)); } catch (error) { fail(error); } }; }),
    save: record => transaction('runs', 'readwrite', (store, done, fail) => {
      const normalized = validateExecutionRecord(record), request = store.getAll();
      request.onsuccess = () => { try { checkHistoryCapacity(request.result, normalized); store.put(normalized); done(normalized); } catch (error) { fail(error); } };
    }),
    previewImport: async text => planHistoryImport(parseHistoryBackup(text), await transaction('runs', 'readonly', (store, done) => {
      const request = store.getAll(); request.onsuccess = () => done(request.result);
    })),
    importBackup: plan => transaction('runs', 'readwrite', (store, done, fail) => {
      const request = store.getAll(); request.onsuccess = () => { try {
        if (scope !== getStorageScope()) throw Error('账户身份已改变，尚未导入；请刷新页面。');
        const existing = request.result.map(validateExecutionRecord);
        if (historySnapshot(existing) !== plan.baseline) throw Error('本机历史已在其他窗口更新，请重新选择文件并预览；尚未导入。');
        const additions = plan.additions.map(importRecord), merged = [...existing], ids = new Set(existing.map(r => r.localId));
        for (const record of additions) {
          if (ids.has(record.localId)) throw Error('导入编号已存在，请重新预览；旧记录保留。');
          checkHistoryCapacity(merged, record); merged.push(record); ids.add(record.localId);
        }
        for (const record of additions) store.add(record);
        done({added:additions.length, skipped:plan.skipped, renamed:plan.renamed});
      } catch (error) { fail(error); } };
    }),
    remove: id => transaction('runs', 'readwrite', store => store.delete(id)),
    clear: () => transaction('runs', 'readwrite', store => store.clear()),
    readDraft: () => transaction('drafts', 'readonly', (store, done) => { const request = store.get('runner'); request.onsuccess = () => done(request.result); }),
    saveDraft: draft => transaction('drafts', 'readwrite', store => store.put({ language: draft.language, code: String(draft.code).slice(0, 32768), stdin: String(draft.stdin).slice(0, 16384) }, 'runner')),
  };
}
