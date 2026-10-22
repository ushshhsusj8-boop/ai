import { parseHistoryBackup, planHistoryImport, HISTORY_BYTES, HISTORY_LIMIT } from './execution_history.js';

const backupText = runs => JSON.stringify({ format: 'plaude-code-history', version: 1, exportedAt: new Date().toISOString(), runs });
export function validateCloudRuns(runs) {
  const records = parseHistoryBackup(backupText(runs));
  if (new Set(records.map(r => r.localId)).size !== records.length) throw Error('云备份记录编号重复。');
  if (new TextEncoder().encode(JSON.stringify(records)).length > HISTORY_BYTES) throw Error('云备份最多100条 / 8 MiB，原记录保留。');
  return records;
}
function envelope(value, userId) {
  if (value?.userId !== userId || !Number.isSafeInteger(value.revision) || value.revision < 0) {
    throw Error('云备份账户或版本不匹配，未更改本机记录。');
  }
  return { userId, revision: value.revision, runs: validateCloudRuns(value.runs) };
}
export function createHistoryCloud({ userId, history, fetchImpl = globalThis.fetch,
  isCurrent = () => true, onIdentityChanged = () => {}, timeoutMs = 30000 }) {
  const identity = () => { if (!userId || !isCurrent()) throw Error('请登录原账户后重新预览；本机记录保留。'); };
  async function request(options = {}) {
    identity();
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl('/api/account/code-history', {
        ...options, signal: controller.signal, credentials: 'same-origin', cache: 'no-store',
        headers: { accept: 'application/json', 'content-type': 'application/json', 'x-plaude-client': '1', 'x-plaude-account-id': userId },
      });
      const value = await response.json();
      if (controller.signal.aborted) throw Error('aborted');
      identity();
      if ([401, 403].includes(response.status)) { onIdentityChanged(); throw Error('登录已失效，本机历史保留，请重新登录。'); }
      if (!response.ok) throw Error(value.error || '云备份操作失败，本机和原云记录保留。');
      return envelope(value, userId);
    } catch (error) {
      if (controller.signal.aborted) throw Error('云备份响应超时，尚未确认保存或删除结果。请重新查询；本机记录保留。');
      throw error;
    } finally { clearTimeout(timer); }
  }
  const summary = plan => ({ added: plan.additions.length, skipped: plan.skipped, renamed: plan.renamed, total: plan.total, bytes: plan.bytes });
  const content = record => JSON.stringify(Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'localId')));
  function verifyUpload(before, incoming, after) {
    const expected = new Set([...before, ...incoming].map(content)), actual = new Set(after.map(content));
    if (after.length !== expected.size || actual.size !== expected.size || [...expected].some(c => !actual.has(c))) {
      throw Error('云备份确认内容不完整，尚未确认成功；本机记录保留，请重新查询。');
    }
    for (const record of before) if (!after.some(r => r.localId === record.localId && content(r) === content(record))) {
      throw Error('云端原记录确认不一致，尚未确认成功，请重新查询。');
    }
  }
  return {
    async previewUpload() {
      identity(); const incoming = validateCloudRuns(await history.list()), cloud = await request(); identity();
      let plan;
      try { plan = planHistoryImport(incoming, cloud.runs); } catch { throw Error('合并后云备份超过100条 / 8 MiB，尚未上传；原记录保留。'); }
      return { kind: 'upload', cloud, incoming, summary: summary(plan) };
    },
    async upload(preview) {
      identity(); if (preview?.kind !== 'upload') throw Error('请重新预览云备份。');
      const next = await request({ method: 'POST', body: JSON.stringify({ revision: preview.cloud.revision, runs: preview.incoming }) });
      verifyUpload(preview.cloud.runs, preview.incoming, next.runs);
      const expectedRevision = preview.cloud.revision + (preview.summary.added ? 1 : 0);
      if (next.revision !== expectedRevision) throw Error('云备份版本确认不一致，请重新查询；本机记录保留。');
      return preview.summary;
    },
    async previewRestore() {
      const cloud = await request(); identity();
      const plan = await history.previewImport(backupText(cloud.runs)); identity();
      return { kind: 'restore', cloud, plan, summary: summary(plan) };
    },
    async restore(preview) {
      identity(); if (preview?.kind !== 'restore') throw Error('请重新预览云端恢复。');
      // Refuse a stale cloud preview, and let IndexedDB reject changed local history atomically.
      const current = await request(); identity();
      if (current.revision !== preview.cloud.revision || JSON.stringify(current.runs) !== JSON.stringify(preview.cloud.runs)) {
        throw Error('云备份已变化，请重新预览；尚未恢复，原记录保留。');
      }
      return history.importBackup(preview.plan);
    },
    list: () => request(),
    async remove(preview) {
      identity(); const result = await request({ method: 'DELETE', body: JSON.stringify({ revision: preview.revision }) });
      if (result.runs.length || result.revision !== preview.revision + 1) throw Error('尚未确认云备份删除，请重新查询。');
      return result;
    },
    limits: { count: HISTORY_LIMIT, bytes: HISTORY_BYTES },
  };
}
