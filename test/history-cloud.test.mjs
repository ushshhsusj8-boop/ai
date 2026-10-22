import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHistoryCloudStore } from '../src/history_cloud.mjs';
import { createHistoryCloud, validateCloudRuns } from '../public/history_cloud.js';
import { executionRecord, parseHistoryBackup, planHistoryImport, HISTORY_BYTES } from '../public/execution_history.js';

const record = (localId = 'qa-record-1', code = 'print(42)') => executionRecord({ language: 'python', code, stdin: '' }, { id: 'qa-job', status: 'completed', stdout: '42\n', stderr: '', exitCode: 0, durationMs: 12 }, { localId, createdAt: 100 });
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'history-cloud-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const requireUser = id => { if (!['qa-owner', 'qa-other'].includes(id)) throw Error('invalid user'); };
  const store = createHistoryCloudStore(dir, { requireUser });
  return { dir, store, reopen: () => createHistoryCloudStore(dir, { requireUser }) };
}
function device(f, initial = []) {
  let runs = structuredClone(initial), isCurrent = true, offline = false, wrong = false, lost = false;
  const history = {
    async list() { return structuredClone(runs); },
    async previewImport(text) { return planHistoryImport(parseHistoryBackup(text), runs); },
    async importBackup(plan) {
      assert.equal(plan.baseline, planHistoryImport([], runs).baseline, 'local history changed');
      runs.push(...structuredClone(plan.additions)); return { added: plan.additions.length, skipped: plan.skipped, renamed: plan.renamed };
    },
  };
  const fetchImpl = async (path, options) => {
    assert.equal(path, '/api/account/code-history'); assert.equal(options.headers['x-plaude-account-id'], 'qa-owner');
    if (offline) throw Error('offline');
    const body = options.body && JSON.parse(options.body);
    try {
      const data = options.method === 'POST' ? f.store.merge('qa-owner', body) : options.method === 'DELETE' ? f.store.remove('qa-owner', body) : f.store.list('qa-owner');
      if (lost && options.method === 'POST') { lost = false; throw Error('lost acknowledgement'); }
      if (wrong) data.userId = 'qa-other';
      return { status: 200, ok: true, json: async () => data };
    } catch (error) {
      if (!error.statusCode) throw error;
      return { status: error.statusCode, ok: false, json: async () => ({ error: error.message }) };
    }
  };
  return { client: createHistoryCloud({ userId: 'qa-owner', history, fetchImpl, isCurrent: () => isCurrent }), history,
    get runs() { return runs; }, set current(v) { isCurrent = v; }, set offline(v) { offline = v; }, set wrong(v) { wrong = v; }, set lost(v) { lost = v; } };
}
test('private cloud persists, deduplicates content and preserves colliding identifiers as separate records', t => {
  const f = fixture(t), first = f.store.merge('qa-owner', { revision: 0, runs: [record()] });
  assert.equal(first.revision, 1); assert.deepEqual(f.reopen().list('qa-owner'), first); assert.deepEqual(f.store.list('qa-other').runs, []);
  assert.equal(f.store.merge('qa-owner', { revision: 1, runs: [record('another-id')] }).revision, 1);
  const merged = f.store.merge('qa-owner', { revision: 1, runs: [record('qa-record-1', 'print(43)')] });
  assert.equal(merged.runs.length, 2); assert.deepEqual(merged.runs[0], first.runs[0]); assert.notEqual(merged.runs[1].localId, first.runs[0].localId);
  assert.throws(() => f.store.list('../escape'));
});
test('stale upload or delete, invalid content, capacity and corrupt storage preserve previous cloud bytes', t => {
  const f = fixture(t); f.store.merge('qa-owner', { revision: 0, runs: [record()] });
  const file = join(f.dir, 'qa-owner.json'), before = readFileSync(file);
  for (const body of [{ revision: 0, runs: [] }, { revision: 1, runs: [{ ...record(), artifacts: [] }] }, { revision: 1, runs: Array(101).fill(record()) }, { revision: 1, runs: [], userId: 'qa-other' }, { revision: 1, runs: [record(), record()] }]) {
    assert.throws(() => f.store.merge('qa-owner', body)); assert.deepEqual(readFileSync(file), before);
  }
  assert.throws(() => f.store.remove('qa-owner', { revision: 0 }), { statusCode: 409 });
  const full = Array.from({ length: 100 }, (_, i) => record('full-' + i, "print('full-" + i + "')"));
  f.store.merge('qa-owner', { revision: 1, runs: full.slice(1) }); const fullBefore = readFileSync(file);
  assert.throws(() => f.store.merge('qa-owner', { revision: 2, runs: [record('overflow', 'print(999)')] }), { statusCode: 413 }); assert.deepEqual(readFileSync(file), fullBefore);
  const large = Array.from({ length: 80 }, (_, i) => ({ ...record('large-' + i), stdout: 'x'.repeat(131072) }));
  assert.ok(Buffer.byteLength(JSON.stringify(large)) > HISTORY_BYTES); assert.throws(() => validateCloudRuns(large));
  writeFileSync(file, '{corrupt'); assert.throws(() => f.store.merge('qa-owner', { revision: 0, runs: [] })); assert.equal(readFileSync(file, 'utf8'), '{corrupt');
});
test('explicit deletion keeps version protection and does not affect another account', t => {
  const f = fixture(t); f.store.merge('qa-owner', { revision: 0, runs: [record()] }); f.store.merge('qa-other', { revision: 0, runs: [record()] });
  const empty = f.store.remove('qa-owner', { revision: 1 }); assert.equal(empty.revision, 2); assert.deepEqual(empty.runs, []);
  assert.equal(f.reopen().list('qa-other').runs.length, 1); assert.throws(() => f.store.merge('qa-owner', { revision: 1, runs: [record()] }), { statusCode: 409 });
});
test('two devices preview then merge without uploading on read, running code or replacing local history', async t => {
  const f = fixture(t), a = device(f, [record()]), b = device(f, [record('qa-record-1', 'print(43)')]);
  const preview = await a.client.previewUpload(); assert.equal(f.store.list('qa-owner').revision, 0); assert.equal(preview.summary.added, 1);
  await a.client.upload(preview); const restore = await b.client.previewRestore(); assert.equal(restore.summary.renamed, 1); assert.equal(b.runs.length, 1);
  await b.client.restore(restore); assert.equal(b.runs.length, 2); assert.equal(b.runs[0].code, 'print(43)');
  const upload = await b.client.previewUpload(); await b.client.upload(upload); assert.equal(f.store.list('qa-owner').runs.length, 2);
  assert.equal((await a.client.previewUpload()).summary.added, 0);
});
test('changed cloud/local previews refuse restoration and stale uploads; offline and wrong identity preserve local data', async t => {
  const f = fixture(t), a = device(f, [record()]), b = device(f); await a.client.upload(await a.client.previewUpload());
  let preview = await b.client.previewRestore(); f.store.merge('qa-owner', { revision: 1, runs: [record('new', 'print(44)')] });
  await assert.rejects(b.client.restore(preview), /已变化/); assert.equal(b.runs.length, 0);
  preview = await b.client.previewRestore(); b.runs.push(record('local', 'print(55)')); await assert.rejects(b.client.restore(preview), /local history changed/); assert.equal(b.runs.length, 1);
  const stale = await a.client.previewUpload(); f.store.remove('qa-owner', { revision: 2 }); await assert.rejects(a.client.upload(stale), /其他设备/);
  a.offline = true; await assert.rejects(a.client.previewUpload(), /offline/); a.offline = false; a.wrong = true; await assert.rejects(a.client.previewRestore(), /不匹配/); a.wrong = false;
  a.current = false; await assert.rejects(a.client.previewRestore(), /原账户/); assert.deepEqual(a.runs, [record()]);
});
test('lost upload confirmation is not retried automatically and fresh preview recognizes saved duplicate', async t => {
  const f = fixture(t), a = device(f, [record()]); a.lost = true;
  await assert.rejects(a.client.upload(await a.client.previewUpload()), /lost/); assert.equal(f.store.list('qa-owner').revision, 1);
  assert.equal((await a.client.previewUpload()).summary.added, 0); assert.equal(f.store.list('qa-owner').runs.length, 1); assert.equal(a.runs.length, 1);
});
test('complete response timeout and incomplete upload confirmation never claim success', async t => {
  const f = fixture(t), a = device(f, [record()]), preview = await a.client.previewUpload();
  const timeout = createHistoryCloud({ userId: 'qa-owner', history: a.history, timeoutMs: 5, fetchImpl: async (_, o) => ({ ok: true, status: 200, json: () => new Promise((_, reject) => o.signal.addEventListener('abort', () => reject(Error('aborted')))) }) });
  await assert.rejects(timeout.previewUpload(), /超时/);
  const incomplete = createHistoryCloud({ userId: 'qa-owner', history: a.history, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ userId: 'qa-owner', revision: 1, runs: [] }) }) });
  await assert.rejects(incomplete.upload(preview), /不完整/); assert.equal(a.runs.length, 1);
});
test('Linux private cloud refuses symlink storage without reading or replacing target', { skip: process.platform !== 'linux' }, t => {
  const f = fixture(t), target = join(f.dir, 'outside.json'); writeFileSync(target, 'keep'); symlinkSync(target, join(f.dir, 'qa-owner.json'));
  assert.throws(() => f.store.list('qa-owner')); assert.throws(() => f.store.merge('qa-owner', { revision: 0, runs: [record()] })); assert.equal(readFileSync(target, 'utf8'), 'keep');
});
