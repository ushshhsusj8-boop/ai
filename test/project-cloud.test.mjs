import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudProjectStore } from '../public/project_cloud.js';

const project = (id = 'project-first') => ({ id, revision: 0, name: '私有项目', instructions: '中文回答', documents: [] });
const empty = () => ({ version: 1, projects: [], links: [] });
const reply = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
function memoryDatabase() {
  const databases = new Map();
  return { open(name) {
    const request = {};
    queueMicrotask(() => {
      const isNew = !databases.has(name); if (isNew) databases.set(name, new Map());
      const values = databases.get(name);
      request.result = {
        createObjectStore() {}, close() {},
        transaction() {
          const transaction = { objectStore: () => ({
            get(key) { const result = {}; queueMicrotask(() => { result.result = structuredClone(values.get(key)); result.onsuccess?.(); queueMicrotask(() => transaction.oncomplete?.()); }); return result; },
            put(value, key) { values.set(key, structuredClone(value)); queueMicrotask(() => transaction.oncomplete?.()); },
          }) };
          return transaction;
        },
      };
      if (isNew) request.onupgradeneeded?.(); request.onsuccess?.();
    });
    return request;
  } };
}
function server() {
  let value = { projects: empty(), revision: 0 }, offline = false, fail = 0, race = false;
  const calls = [];
  return {
    calls,
    get value() { return structuredClone(value); },
    set offline(v) { offline = v; }, set fail(v) { fail = v; }, set race(v) { race = v; },
    async fetch(url, options) {
      calls.push({ url, ...options });
      if (offline) throw new TypeError('network disconnected');
      if (fail) return reply({}, fail);
      if (options.method === 'GET') return reply(value);
      const incoming = JSON.parse(options.body);
      if (race || incoming.revision !== value.revision) return reply({}, 409);
      value = { projects: incoming.projects, revision: value.revision + 1 }; return reply(value);
    },
  };
}

test('cloud projects persist and another device reads the latest library with account-scoped requests', async () => {
  const remote = server();
  const one = createCloudProjectStore({ userId: 'user-one', fetchImpl: remote.fetch, database: memoryDatabase() });
  await one.save(project()); await one.link('conversation-one', 'project-first');
  const two = createCloudProjectStore({ userId: 'user-one', fetchImpl: remote.fetch, database: memoryDatabase() });
  const state = await two.read();
  assert.equal(state.projects[0].revision, 1); assert.equal(state.links[0].conversationId, 'conversation-one');
  assert.equal(two.status.revision, 2);
  for (const request of remote.calls) {
    assert.equal(request.url, '/api/account/projects'); assert.equal(request.credentials, 'same-origin');
    assert.equal(request.headers['x-plaude-account-id'], 'user-one');
    if (request.method === 'PUT') assert.equal(request.headers['x-plaude-client'], '1');
  }
});

test('offline read uses only the same account cache, offline writes fail without altering confirmed data', async () => {
  const remote = server(), database = memoryDatabase();
  const store = createCloudProjectStore({ userId: 'user-one', fetchImpl: remote.fetch, database });
  await store.save(project()); remote.offline = true;
  const state = await store.read(); assert.equal(state.projects.length, 1); assert.equal(store.status.offline, true); assert.equal(store.status.cached, true);
  await assert.rejects(store.save({ ...state.projects[0], name: '不得保存' }), /无法连接/);
  const cached = await store.read(); assert.equal(cached.projects[0].name, '私有项目');
  const other = createCloudProjectStore({ userId: 'user-two', fetchImpl: remote.fetch, database });
  await assert.rejects(other.read(), /无法连接/);
  const reloaded = createCloudProjectStore({ userId: 'user-one', fetchImpl: remote.fetch, database });
  assert.equal((await reloaded.read()).projects[0].name, '私有项目');
});

test('a revision conflict retains the confirmed server snapshot and does not overwrite remote content', async () => {
  const remote = server(), store = createCloudProjectStore({ userId: 'user-one', fetchImpl: remote.fetch, database: memoryDatabase() });
  await store.save(project()); const original = await store.read(); remote.race = true;
  await assert.rejects(store.save({ ...original.projects[0], name: '不能覆盖' }), /另一设备修改/);
  assert.equal(remote.value.projects.projects[0].name, '私有项目'); remote.offline = true;
  assert.equal((await store.read()).projects[0].name, '私有项目');
});

test('stale editing revisions are rejected after a fresh GET, while independent changes merge safely', async () => {
  const remote = server(), database = memoryDatabase();
  const first = createCloudProjectStore({ userId: 'user-one', fetchImpl: remote.fetch, database });
  const second = createCloudProjectStore({ userId: 'user-one', fetchImpl: remote.fetch, database });
  await first.save(project()); const stale = await first.read();
  await second.save({ ...stale.projects[0], name: '另一设备修改' });
  const count = remote.calls.filter(r => r.method === 'PUT').length;
  await assert.rejects(first.save({ ...stale.projects[0], name: '旧版' }), /其他设备修改/);
  assert.equal(remote.calls.filter(r => r.method === 'PUT').length, count);
  await first.save(project('project-second')); assert.equal(remote.value.projects.projects.length, 2);
});

test('authentication, account mismatch, malformed response and conflicts cannot fall back to cached data', async () => {
  const remote = server(), database = memoryDatabase();
  const store = createCloudProjectStore({ userId: 'user-one', fetchImpl: remote.fetch, database });
  await store.save(project());
  for (const status of [401, 403, 409]) { remote.fail = status; await assert.rejects(store.read()); }
  remote.fail = 503; assert.equal((await store.read()).projects.length, 1);
  const invalid = createCloudProjectStore({ userId: 'user-one', database, fetchImpl: async () => reply({ projects: empty(), revision: -1 }) });
  await assert.rejects(invalid.read(), /版本无效/);
  const mismatched = createCloudProjectStore({ userId: 'user-one', database, fetchImpl: async () => reply({ userId: 'user-two', projects: empty(), revision: 1 }) });
  await assert.rejects(mismatched.read(), /身份不匹配/);
});

test('cloud persistence works if browser storage is unavailable and never claims to have an offline cache', async () => {
  const remote = server(), store = createCloudProjectStore({ userId: 'user-one', fetchImpl: remote.fetch, database: null });
  await store.save(project()); assert.equal(store.status.cacheUnavailable, true);
  assert.equal((await store.read()).projects.length, 1); remote.offline = true;
  await assert.rejects(store.read(), /无法连接/);
});

test('a stalled project response body times out without changing cached data, then allows an online retry', async () => {
  const remote = server(), database = memoryDatabase(); let stall = false;
  const fetchImpl = (url, options) => stall ? Promise.resolve({ok:true, json: () => new Promise((resolve,reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), {once:true}))}) : remote.fetch(url, options);
  const store = createCloudProjectStore({userId:'user-one', database, fetchImpl, requestTimeoutMs:15});
  await store.save(project()); stall = true;
  assert.equal((await store.read()).projects[0].name, '私有项目'); assert.equal(store.status.offline, true);
  await assert.rejects(store.save({...project(), name:'不能覆盖'}), /无法连接/);
  stall = false; assert.equal((await store.read()).projects.length, 1); assert.equal(store.status.offline, false);
});

test('same-tab concurrent writes are serialized and imports refuse conflicts without changing existing data', async () => {
  const remote = server(), store = createCloudProjectStore({ userId: 'user-one', fetchImpl: remote.fetch, database: memoryDatabase() });
  await Promise.all([store.save(project()), store.save(project('project-second'))]);
  assert.equal(remote.value.projects.projects.length, 2);
  await assert.rejects(store.import({ version: 1, projects: [project()], links: [] }), /冲突/);
  assert.equal(remote.value.revision, 2);
  await store.link('conversation-one', 'project-first'); await store.inherit('conversation-one', 'conversation-two');
  assert.equal((await store.read()).links.length, 2);
  await store.remove('project-first', 1); assert.equal((await store.read()).links.length, 0);
});

const snapshot = (revision, projects = [{ ...project(), revision, name: `项目版本${revision}` }]) => ({ projects: { version: 1, projects, links: [] }, revision });
function delayedReads() {
  const pending = [];
  return { pending, fetch: () => new Promise(resolve => pending.push(resolve)) };
}
test('a late older GET cannot regress the returned library, status or persisted offline snapshot', async () => {
  const database = memoryDatabase(), remote = delayedReads();
  const store = createCloudProjectStore({ userId: 'user-one', database, fetchImpl: remote.fetch });
  const older = store.read(), newer = store.read();
  remote.pending[1](reply(snapshot(2))); assert.equal((await newer).projects[0].name, '项目版本2');
  remote.pending[0](reply(snapshot(1))); assert.equal((await older).projects[0].name, '项目版本2');
  assert.equal(store.status.revision, 2);
  const reloaded = createCloudProjectStore({ userId: 'user-one', database, fetchImpl: async () => { throw Error('offline'); } });
  assert.equal((await reloaded.read()).projects[0].name, '项目版本2'); assert.equal(reloaded.status.revision, 2);
});
test('a stale response in another client cannot resurrect a deleted project in the shared offline cache', async () => {
  const database = memoryDatabase(), remote = delayedReads();
  const first = createCloudProjectStore({ userId: 'user-one', database, fetchImpl: remote.fetch });
  const second = createCloudProjectStore({ userId: 'user-one', database, fetchImpl: remote.fetch });
  const older = first.read(), removed = second.read();
  remote.pending[1](reply(snapshot(3, []))); await removed;
  remote.pending[0](reply(snapshot(2))); assert.deepEqual((await older).projects, []); assert.equal(first.status.revision, 3);
  const offline = async () => { throw Error('offline'); };
  const reloaded = createCloudProjectStore({ userId: 'user-one', database, fetchImpl: offline });
  assert.deepEqual((await reloaded.read()).projects, []); assert.equal(reloaded.status.revision, 3);
  await assert.rejects(createCloudProjectStore({ userId: 'user-two', database, fetchImpl: offline }).read(), /无法连接/);
});
test('out-of-order successful reads retain the latest in-memory revision when IndexedDB is unavailable', async () => {
  const remote = delayedReads();
  const store = createCloudProjectStore({ userId: 'user-one', database: null, fetchImpl: remote.fetch });
  const older = store.read(), newer = store.read();
  remote.pending[1](reply(snapshot(4))); await newer;
  remote.pending[0](reply(snapshot(1))); assert.equal((await older).projects[0].revision, 4);
  assert.equal(store.status.revision, 4); assert.equal(store.status.cacheUnavailable, true);
});
test('an invalid cache with a higher numeric revision does not block a validated server snapshot', async () => {
  const database = memoryDatabase();
  await new Promise(resolve => {
    const request = database.open('plaude-project-cloud-v1', 1);
    request.onsuccess = () => {
      const tx = request.result.transaction('accounts', 'readwrite');
      tx.oncomplete = resolve; tx.objectStore('accounts').put({ revision: 100, projects: { invalid: true } }, 'user-one');
    };
  });
  const store = createCloudProjectStore({ userId: 'user-one', database, fetchImpl: async () => reply(snapshot(1)) });
  assert.equal((await store.read()).projects[0].revision, 1);
  const reloaded = createCloudProjectStore({ userId: 'user-one', database, fetchImpl: async () => { throw Error('offline'); } });
  assert.equal((await reloaded.read()).projects[0].revision, 1);
});
