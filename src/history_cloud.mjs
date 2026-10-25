import {getLimits,withStoredLimits} from '../public/site_limits.js';
import { randomBytes } from 'node:crypto';
import { constants, mkdirSync, openSync, fstatSync, readFileSync, writeFileSync, fsyncSync, closeSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { validateCloudRuns } from '../public/history_cloud.js';
import { planHistoryImport, HISTORY_BYTES } from '../public/execution_history.js';

const fail = (message, statusCode = 400) => { throw Object.assign(Error(message), { statusCode }); };
export function createHistoryCloudStore(directory, { requireUser }) {
  function read(...args){return withStoredLimits(()=>readStored(...args));}
  function readStored(userId) {
    requireUser(userId);
    if (typeof userId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(userId)) fail('账户编号无效。');
    const file = join(directory, userId + '.json'); let handle;
    try {
      handle = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      const stat = fstatSync(handle);
      if (!stat.isFile() || stat.size > getLimits().historyBytes+65536) throw Error('Invalid private history storage');
      const value = JSON.parse(readFileSync(handle, 'utf8'));
      if (value?.version !== 1 || value.userId !== userId || !Number.isSafeInteger(value.revision) || value.revision < 0) throw Error('Invalid private history storage');
      value.runs = validateCloudRuns(value.runs);
      return { file, value };
    } catch (error) {
      if (error.code === 'ENOENT') return { file, value: { version: 1, userId, revision: 0, runs: [] } };
      throw error;
    } finally { if (handle !== undefined) closeSync(handle); }
  }
  function write(file, value) {
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized) > getLimits().historyBytes+65536) fail('云备份容量不足，原记录保留。', 413);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporary = file + '.' + randomBytes(12).toString('hex') + '.tmp'; let handle;
    try {
      handle = openSync(temporary, 'wx', 0o600); writeFileSync(handle, serialized, 'utf8'); fsyncSync(handle);
      closeSync(handle); handle = undefined; renameSync(temporary, file);
    } finally { if (handle !== undefined) closeSync(handle); rmSync(temporary, { force: true }); }
  }
  function baseline(body, fields) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !fields.includes(k)) || !Number.isSafeInteger(body.revision) || body.revision < 0) fail('云备份版本或字段无效。');
  }
  const answer = value => ({ userId: value.userId, revision: value.revision, runs: structuredClone(value.runs) });
  return Object.freeze({
    list(userId) { return answer(read(userId).value); },
    merge(userId, body) {
      baseline(body, ['revision', 'runs']); let incoming;
      try { incoming = validateCloudRuns(body.runs); } catch (error) { fail(error.message, /MiB|100条|100 条/.test(error.message) ? 413 : 400); }
      const { file, value } = read(userId);
      if (body.revision !== value.revision) fail('云备份已在其他设备修改或删除，请重新预览；未覆盖原记录。', 409);
      let plan;
      try { plan = planHistoryImport(incoming, value.runs); } catch { fail('合并后云备份超过当前条数或字节预算，原记录保留。', 413); }
      if (plan.additions.length) {
        if (value.revision === Number.MAX_SAFE_INTEGER) fail('云备份版本已达上限。', 413);
        value.runs.push(...plan.additions); value.revision++; write(file, value);
      }
      return answer(value);
    },
    remove(userId, body) {
      baseline(body, ['revision']); const { file, value } = read(userId);
      if (body.revision !== value.revision) fail('云备份已变化，未删除新版，请重新查询。', 409);
      if (value.revision === Number.MAX_SAFE_INTEGER) fail('云备份版本已达上限。', 413);
      value.runs = []; value.revision++; write(file, value); return answer(value);
    },
  });
}
