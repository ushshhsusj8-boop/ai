import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createGatewayServer } from '../src/app.mjs';
import { createAccountStore } from '../src/accounts.mjs';
import { loadConfig } from '../src/config.mjs';

const PASSWORD = 'private-account-test-password-123';
const TOKEN = 'account-isolation-gateway-token-abcdefghijklmnopqrstuvwxyz';
const encoder = new TextEncoder();
const event = payload => `data: ${JSON.stringify(payload)}\n\n`;
const reply = () => Response.json({ output_text: '本次回答', usage: { input_tokens: 2, output_tokens: 2, total_tokens: 4 } });
async function fixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'plaude-account-gateway-'));
  const accountStore = createAccountStore(join(directory, 'accounts.json'));
  const alice = await accountStore.register({ username: 'alice', password: PASSWORD });
  const bob = await accountStore.register({ username: 'bob', password: PASSWORD });
  const config = loadConfig({ NODE_ENV: 'test', BIND_HOST: '127.0.0.1', GATEWAY_ACCESS_TOKEN: TOKEN,
    DEEPSEEK_API_KEY: 'sk-private-test-abcdefghijklmnopqrstuvwxyz', DEFAULT_PROVIDER: 'deepseek',
    CODE_RUNNER_SOCKET: '/run/test/runner.sock', RATE_LIMIT_PER_MINUTE: '600', ...options.environment });
  const server = createGatewayServer({ config, accountStore, fetchImpl: options.fetchImpl || reply,
    sharedStore: options.sharedStore, workspaceStore: options.workspaceStore,
    runCode: options.runCode || (async () => ({ language: 'python', stdout: 'private output', stderr: '', exitCode: 0, status: 'completed', durationMs: 5 })) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); rmSync(directory, { force: true, recursive: true }); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const headers = user => user ? { cookie: `plaude_session=${user.sessionToken}`, 'x-plaude-client': '1', 'x-plaude-account-id': user.user.id }
    : { authorization: `Bearer ${TOKEN}` };
  function request(path, user, { method = 'GET', body, extra = {}, omit = [], signal } = {}) {
    const all = { ...headers(user), ...(method !== 'GET' && user ? { origin } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...extra };
    for (const key of omit) delete all[key];
    return fetch(`${origin}${path}`, { method, headers: all, ...(body ? { body: JSON.stringify(body) } : {}), signal });
  }
  const chat = (user, options = {}) => request('/api/chat', user, { method: 'POST', body: { provider: 'deepseek', messages: [{ role: 'user', content: '私人问题' }] }, ...options });
  const logs = async user => { const response = await request('/api/activity', user); assert.equal(response.status, 200); return response.json(); };
  return { alice, bob, accountStore, config, origin, request, chat, logs };
}

test('chat activity and runtime requests isolate two accounts and legacy guests without exposing owner identifiers', async t => {
  const f = await fixture(t), ids = [];
  for (const user of [f.alice, f.bob, null]) {
    const response = await f.chat(user); assert.equal(response.status, 200); ids.push((await response.json()).requestId);
  }
  await f.request('/api/account/projects', f.alice);
  await f.request('/api/account/login', null, { method: 'POST', body: { username: 'bob', password: PASSWORD }, extra: { origin: f.origin, 'x-plaude-client': '1' } });
  for (const [index, user] of [f.alice, f.bob, null].entries()) {
    const logs = await f.logs(user), serialized = JSON.stringify(logs);
    assert.deepEqual(logs.events.map(item => item.type), ['chat_started', 'chat_completed']);
    assert.deepEqual([...new Set(logs.events.map(item => item.requestId))], [ids[index]]);
    for (const other of ids.filter(id => id !== ids[index])) assert.equal(serialized.includes(other), false);
    assert.equal(serialized.includes('ownerId'), false); assert.equal(serialized.includes(f.alice.user.id), false); assert.equal(serialized.includes(f.bob.user.id), false);
    assert.equal(serialized.includes(PASSWORD), false); assert.equal(serialized.includes('私人问题'), false);
    assert.equal(logs.requests.filter(item => item.path === '/api/chat').length, 1);
    assert.equal(logs.requests.some(item => item.path === '/api/account/login'), false);
    assert.equal(logs.requests.some(item => item.path === '/api/account/projects'), index === 0);
  }
});

test('cookie chat and code require exact same origin, custom marker and expected identity while legacy Bearer remains usable', async t => {
  let upstreamCalls = 0, codeCalls = 0;
  const f = await fixture(t, { environment: { ALLOWED_ORIGINS: 'https://other.example' }, fetchImpl: async () => { upstreamCalls += 1; return reply(); },
    runCode: async () => { codeCalls += 1; return { language: 'python', status: 'completed', stdout: '', stderr: '', exitCode: 0, durationMs: 1 }; } });
  for (const path of ['/api/chat', '/api/code/run']) {
    const body = path === '/api/chat' ? { provider: 'deepseek', messages: [{ role: 'user', content: 'hello' }] } : { language: 'python', code: 'print(1)' };
    for (const options of [{ omit: ['origin'] }, { omit: ['x-plaude-client'] }, { omit: ['x-plaude-account-id'] },
      { extra: { origin: 'https://other.example' } }, { extra: { 'sec-fetch-site': 'cross-site' } }]) {
      assert.equal((await f.request(path, f.alice, { method: 'POST', body, ...options })).status, 403);
    }
    assert.equal((await f.request(path, f.alice, { method: 'POST', body, extra: { 'x-plaude-account-id': f.bob.user.id } })).status, 401);
    assert.equal((await f.request(path, f.alice, { method: 'POST', body })).status, 200);
    assert.equal((await f.request(path, null, { method: 'POST', body })).status, 200);
  }
  assert.equal(upstreamCalls, 2); assert.equal(codeCalls, 2);
  assert.equal((await f.request('/api/activity', f.alice, { extra: { origin: 'https://other.example' } })).status, 403);
});

test('stream failures and code failures remain owned by the initiating account', async t => {
  const f = await fixture(t, { fetchImpl: async () => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(encoder.encode(event({ type: 'response.output_text.delta', delta: '私人已收到内容' })
      + event({ type: 'error', message: 'PRIVATE_UPSTREAM_ERROR' }))); controller.close();
  } }), { headers: { 'content-type': 'text/event-stream' } }) });
  const response = await f.chat(f.alice, { extra: { accept: 'text/event-stream' } });
  const streamId = response.headers.get('x-request-id'), stream = await response.text();
  assert.match(stream, /event: error/); assert.equal(stream.includes('PRIVATE_UPSTREAM_ERROR'), false);
  const failed = await f.request('/api/code/run', f.bob, { method: 'POST', body: { language: 'shell', code: 'id' } });
  assert.equal(failed.status, 400); const codeId = (await failed.json()).requestId;
  const alice = await f.logs(f.alice), bob = await f.logs(f.bob), guest = await f.logs(null);
  assert.deepEqual(alice.events.map(item => item.type), ['chat_started', 'chat_failed']);
  assert.equal(alice.events.every(item => item.requestId === streamId), true);
  assert.deepEqual(bob.events.map(item => item.type), ['code_failed']); assert.equal(bob.events[0].requestId, codeId);
  assert.equal(JSON.stringify(bob).includes(streamId), false); assert.equal(JSON.stringify(alice).includes(codeId), false);
  assert.deepEqual(guest.events, []); assert.equal(guest.requests.some(item => ['/api/chat', '/api/code/run'].includes(item.path)), false);
});

test('a running and cancelled code job is visible only to its owner', async t => {
  let entered, aborted; const started = new Promise(resolve => { entered = resolve; }), cancelled = new Promise(resolve => { aborted = resolve; });
  const f = await fixture(t, { runCode: async (_socket, _job, signal) => {
    entered(); await new Promise((resolve, reject) => signal.addEventListener('abort', () => { aborted(); reject(new DOMException('Aborted', 'AbortError')); }, { once: true }));
  } });
  const controller = new AbortController(), pending = f.request('/api/code/run', f.alice, { method: 'POST', body: { language: 'python', code: 'while True: pass' }, signal: controller.signal });
  await started;
  assert.equal((await f.logs(f.alice)).codeBusy, true); assert.equal((await f.logs(f.bob)).codeBusy, false); assert.equal((await f.logs(null)).codeBusy, false);
  controller.abort(); await assert.rejects(pending); await cancelled;
  let logs;
  for (let i = 0; i < 30; i += 1) {
    logs = await f.logs(f.alice); if (logs.events.some(item => item.type === 'code_cancelled')) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.deepEqual(logs.events.map(item => item.type), ['code_started', 'code_cancelled']);
  assert.equal(logs.requests.some(item => item.path === '/api/code/run' && item.status === 499), true);
  assert.deepEqual((await f.logs(f.bob)).events, []); assert.deepEqual((await f.logs(null)).events, []);
});

test('account cookies do not grant legacy shared, OpenAI-compatible or local-admin data access', async t => {
  const f = await fixture(t, { sharedStore: { list: () => [{ id: 'public-legacy-chat', messages: [{ role: 'user', content: 'PUBLIC_LEGACY_ONLY' }] }] } });
  for (const path of ['/api/shared-conversations', '/v1/models']) {
    assert.equal((await f.request(path, f.alice)).status, 401);
    assert.equal((await f.request(path, null)).status, 200);
  }
  assert.equal((await f.request('/api/workspace/logs', f.alice, { extra: { 'x-yunjian-workspace': '1' } })).status, 403);
  const providers = await (await f.request('/api/providers', f.alice)).text();
  assert.equal(providers.includes(TOKEN), false); assert.equal(providers.includes('sk-private-test'), false);
  assert.equal(providers.includes(f.alice.user.id), false); assert.equal(providers.includes(PASSWORD), false);
});
