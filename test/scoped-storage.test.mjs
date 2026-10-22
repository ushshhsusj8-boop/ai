import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { configureStorageScope, getStorageScope, scopedStorage, globalStorage } from '../public/scoped_storage.js';
import { createBackup, planImport, applyImport } from '../public/backups.js';
import { createExecutionHistory } from '../public/execution_history.js';

const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const values = new Map();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: key => values.delete(key),
  key: index => [...values.keys()][index] ?? null,
  get length() { return values.size; },
} });
after(() => {
  if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage);
  else delete globalThis.localStorage;
});

const conversationKey = 'yunjian-ai-conversations-v1';
const tokenKey = 'yunjian-ai-gateway-token';
const chat = content => ({ id: 'private-chat-01', title: '测试', provider: 'deepseek', model: 'deepseek-flash',
  instructions: '', updatedAt: 123, messages: [{ role: 'user', content, createdAt: 100 }] });

test('storage fails closed until identity bootstrap explicitly selects a workspace', () => {
  assert.equal(getStorageScope(), undefined);
  assert.throws(() => scopedStorage.getItem(conversationKey), /身份尚未确认/);
  assert.throws(() => scopedStorage.setItem(conversationKey, '[]'), /身份尚未确认/);
  assert.equal(values.size, 0);
});

test('account storage and exported backups never inherit or overwrite public and other-account records', () => {
  configureStorageScope(null);
  scopedStorage.setItem(conversationKey, JSON.stringify([chat('public original')]));
  globalStorage.setItem(tokenKey, 'invitation-kept-global');
  const original = values.get(conversationKey);
  configureStorageScope('account-A');
  assert.equal(scopedStorage.getItem(conversationKey), null);
  assert.deepEqual(JSON.parse(createBackup(scopedStorage)).conversations, []);
  scopedStorage.setItem(conversationKey, JSON.stringify([chat('A private')]));
  scopedStorage.setItem('yunjian-ai-drafts-v1', '{"new-conversation":"A draft"}');
  scopedStorage.setItem('yunjian-ai-image-drafts-v1', '{"new-conversation":[]}');
  assert.equal(JSON.parse(createBackup(scopedStorage)).conversations[0].messages[0].content, 'A private');
  configureStorageScope('account-B');
  assert.equal(scopedStorage.getItem(conversationKey), null);
  assert.equal(scopedStorage.getItem('yunjian-ai-drafts-v1'), null);
  assert.equal(scopedStorage.getItem('yunjian-ai-image-drafts-v1'), null);
  assert.deepEqual(JSON.parse(createBackup(scopedStorage)).conversations, []);
  scopedStorage.setItem(conversationKey, JSON.stringify([chat('B private')]));
  configureStorageScope(null);
  const exported = createBackup(scopedStorage);
  assert.equal(exported.includes('A private'), false);
  assert.equal(exported.includes('B private'), false);
  assert.equal(values.get(conversationKey), original);
  assert.equal(globalStorage.getItem(tokenKey), 'invitation-kept-global');
});

test('explicit import and storage clear only change the selected account', () => {
  configureStorageScope('account-A');
  const backup = createBackup(scopedStorage);
  configureStorageScope('account-C');
  applyImport(planImport(backup, scopedStorage), scopedStorage);
  assert.equal(JSON.parse(createBackup(scopedStorage)).conversations[0].messages[0].content, 'A private');
  assert.equal(scopedStorage.length, 4);
  assert.equal(scopedStorage.key(0), conversationKey);
  assert.equal(scopedStorage.key(99), null);
  scopedStorage.clear();
  assert.equal(scopedStorage.length, 0);
  configureStorageScope('account-A');
  assert.equal(JSON.parse(createBackup(scopedStorage)).conversations[0].messages[0].content, 'A private');
  configureStorageScope(null);
  assert.equal(JSON.parse(createBackup(scopedStorage)).conversations[0].messages[0].content, 'public original');
});

function emptyDatabase(opened) {
  return { open(name) {
    opened.push(name);
    const request = {};
    queueMicrotask(() => {
      request.result = { transaction() {
        const tx = { objectStore: () => ({ getAll() {
          const read = { result: [] };
          queueMicrotask(() => { read.onsuccess(); tx.oncomplete(); });
          return read;
        } }) };
        return tx;
      }, close() {} };
      request.onsuccess();
    });
    return request;
  } };
}

test('code history opens separate account databases and rejects stale stores after account changes', async () => {
  const opened = [], database = emptyDatabase(opened);
  configureStorageScope(null);
  const publicHistory = createExecutionHistory(database);
  await publicHistory.list();
  configureStorageScope('account-A');
  const a = createExecutionHistory(database);
  await a.list();
  await assert.rejects(publicHistory.list(), /账户身份已改变/);
  configureStorageScope('account-B');
  await createExecutionHistory(database).list();
  await assert.rejects(a.list(), /账户身份已改变/);
  assert.equal(opened[0], 'plaude-code-history-v1');
  assert.equal(new Set(opened).size, 3);
});

test('invalid identity cannot reset an active account to the public workspace', () => {
  configureStorageScope('account-A');
  for (const invalid of ['', undefined, 7, ' account-A', 'x'.repeat(129)]) assert.throws(() => configureStorageScope(invalid), /标识无效/);
  assert.equal(getStorageScope(), 'account-A');
});
