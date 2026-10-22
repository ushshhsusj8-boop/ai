import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executionRecord, validateExecutionRecord, checkHistoryCapacity, createExecutionHistory } from '../public/execution_history.js';
const job = { language: 'python', code: 'print("你好")', stdin: '输入' };
const result = { id: 'server-id', status: 'completed', stdout: '你好\n', stderr: '', exitCode: 0, durationMs: 400 };
const record = options => executionRecord(job, result, { localId: 'local-id', createdAt: 1000, ...options });
test('execution records retain code stdin and errors but reject transport and credential properties', () => {
  const saved = executionRecord({ ...job, token: 'private' }, { ...result, authorization: 'private', internal: {} }, { localId: 'local-id', createdAt: 1000 });
  assert.deepEqual(validateExecutionRecord(saved), saved); assert.equal(saved.code, job.code); assert.equal(saved.stdin, job.stdin);
  assert.equal(JSON.stringify(saved).includes('private'), false);
  const failed = executionRecord(job, { ...result, status: 'interrupted', stdout: '', exitCode: null }, { resultReceived: false, error: '已请求停止' });
  assert.equal(failed.resultReceived, false); assert.equal(failed.status, 'interrupted'); assert.equal(failed.exitCode, null);
});
test('history rejects malformed records and enforces UTF8 source/stdin limits', () => {
  assert.throws(() => executionRecord({ ...job, code: '中'.repeat(11000) }, result), /32 KiB/);
  assert.throws(() => executionRecord({ ...job, stdin: '中'.repeat(5500) }, result), /16 KiB/);
  assert.throws(() => validateExecutionRecord({ ...record(), status: 'invented-success' }), /格式/);
  assert.throws(() => validateExecutionRecord({ ...record(), stdout: 'x'.repeat(131073) }), /格式/);
});
test('full history refuses new writes without discarding prior records and permits same-record retry', () => {
  const records = Array.from({ length: 100 }, (_, i) => record({ localId: 'local-' + i })), before = JSON.stringify(records);
  assert.throws(() => checkHistoryCapacity(records, record()), /已满/); assert.equal(JSON.stringify(records), before);
  assert.doesNotThrow(() => checkHistoryCapacity(records, record({ localId: 'local-0' })));
  const large = Array.from({ length: 99 }, (_, i) => ({ ...record({ localId: 'large-' + i }), stdout: '中'.repeat(32768) }));
  assert.throws(() => checkHistoryCapacity(large, record()), /已满/);
});
test('unavailable storage fails explicitly rather than reporting saved data', async () => {
  const store = createExecutionHistory(null); await assert.rejects(store.list(), /不允许/); await assert.rejects(store.save(record()), /不允许/);
});
