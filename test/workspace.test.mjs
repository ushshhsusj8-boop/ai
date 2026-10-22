import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer, request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { createWorkspaceSettings } from '../src/workspace_settings.mjs';
import { createGatewayServer } from '../src/app.mjs';
import { loadConfig } from '../src/config.mjs';
import { searchWeb } from '../src/web_search.mjs';
import { validateDocxArchive } from '../public/documents.js';

const key = 'sk-test-private-key-abcdefghijklmnopqrstuvwxyz';
const base = () => loadConfig({ NODE_ENV: 'test', BIND_HOST: '127.0.0.1', LOCAL_DEV_NO_AUTH: '1',
  GATEWAY_ACCESS_TOKEN: 'gateway-private-test-abcdefghijklmnopqrstuvwxyz', DEEPSEEK_API_KEY: key });
function editable(store) { const input = store.get(); input.connections = input.connections.map(c => ({ ...c, apiKey: '' })); return input; }
test('workspace encrypts secrets, keeps blank keys on edits, and restores dynamic model configuration', t => {
  const dir = mkdtempSync(join(tmpdir(), 'workspace-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'settings.enc'), store = createWorkspaceSettings(base(), { file }); t.after(() => store.close());
  const input = editable(store); input.connections[0].models.push('new-model');
  input.search = { engine: 'tavily', url: '', apiKey: 'tvly-private-test-key', maxResults: 3, depth: 'basic', timeRange: 'week' };
  store.save(input);
  assert.equal(store.config.providers.deepseek.models.includes('new-model'), true);
  assert.equal(JSON.stringify(store.get()).includes(key), false);
  assert.equal(JSON.stringify(store.get()).includes('tvly-private-test-key'), false);
  assert.equal(readFileSync(file, 'utf8').includes('tvly-'), false);
  const next = editable(store); next.search.apiKey = ''; store.save(next);
  const restored = createWorkspaceSettings(base(), { file }); t.after(() => restored.close());
  assert.equal(restored.config.workspaceSearch.apiKey, 'tvly-private-test-key');
  assert.equal(restored.config.providers.deepseek.apiKey, key);
  assert.equal(restored.config.providers.deepseek.models.includes('new-model'), true);
  assert.equal({ ...restored.config }.providers.deepseek.apiKey, key);
});
test('invalid workspace settings leave active connections and saved settings unchanged', t => {
  const store = createWorkspaceSettings(base()); t.after(() => store.close());
  const snapshot = store.get();
  for (const alter of [input => { input.connections[0].models = ['https://invalid']; },
    input => { input.connections[0].apiUrl = 'http://example.com/chat/completions'; },
    input => { input.search.engine = 'tavily'; }, input => { input.network = { mode: 'custom', url: 'file:///secret' }; }]) {
    const input = editable(store); alter(input); assert.throws(() => store.save(input)); assert.deepEqual(store.get(), snapshot);
  }
});
test('workspace keeps account-filtered catalog models and adds explicitly configured model IDs', t => {
  const store = createWorkspaceSettings(base()); t.after(() => store.close());
  const config = store.config;
  store.updateCatalog({ providers: { deepseek: { ...config.providers.deepseek,
    models: ['deepseek-flash'], modelOptions: [{ id: 'deepseek-flash', label: 'Flash' }], modelCatalogLoaded: true } } });
  assert.deepEqual(config.providers.deepseek.models, ['deepseek-flash']);
  const input = editable(store); input.connections[0].models.push('manual-model'); store.save(input);
  assert.deepEqual(config.providers.deepseek.models, ['deepseek-flash', 'manual-model']);
});
test('custom proxy actually routes backend requests through a proxy', { timeout: 8000 }, async t => {
  let calls = 0; const sockets = new Set();
  const upstream = createServer((_req, res) => res.end('proxied'));
  const proxy = createServer((req, res) => {
    calls++; const forward = httpRequest(req.url, { method: req.method, headers: req.headers }, result => {
      res.writeHead(result.statusCode, result.headers); result.pipe(res);
    }); forward.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(forward);
  }); proxy.on('connect', (req, client, head) => {
    calls++; sockets.add(client); client.on('close', () => sockets.delete(client));
    const [host, port] = req.url.split(':'); const target = connect(Number(port), host, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) target.write(head); client.pipe(target); target.pipe(client);
    }); sockets.add(target); target.on('close', () => sockets.delete(target)); target.on('error', () => client.destroy()); client.on('error', () => target.destroy());
  });
  upstream.listen(0, '127.0.0.1'); proxy.listen(0, '127.0.0.1'); await Promise.all([once(upstream, 'listening'), once(proxy, 'listening')]);
  t.after(() => { for (const socket of sockets) socket.destroy(); upstream.closeAllConnections(); upstream.close(); proxy.close(); });
  const store = createWorkspaceSettings(base()); t.after(() => store.close()); const input = editable(store);
  input.network = { mode: 'custom', url: `http://127.0.0.1:${proxy.address().port}` }; store.save(input);
  assert.equal(await (await store.fetch(`http://127.0.0.1:${upstream.address().port}/`)).text(), 'proxied'); assert.equal(calls, 1);
});
test('local workspace APIs reject cross-origin and production access, and never return credentials', async t => {
  const store = createWorkspaceSettings(base()); t.after(() => store.close());
  const server = createGatewayServer({ config: store.config, workspaceStore: store }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); }); const url = `http://127.0.0.1:${server.address().port}`;
  const get = headers => fetch(`${url}/api/workspace/settings`, { headers });
  assert.equal((await get({})).status, 403);
  assert.equal((await get({ 'x-yunjian-workspace': '1', origin: 'https://evil.example' })).status, 403);
  const response = await get({ 'x-yunjian-workspace': '1', origin: url }); assert.equal(response.status, 200); assert.equal((await response.text()).includes(key), false);
  const cloud = createGatewayServer({ config: { ...store.config, localDevNoAuth: false }, workspaceStore: store }); cloud.listen(0, '127.0.0.1'); await once(cloud, 'listening');
  t.after(() => { cloud.closeAllConnections(); cloud.close(); });
  assert.equal((await fetch(`http://127.0.0.1:${cloud.address().port}/api/workspace/settings`, { headers: { 'x-yunjian-workspace': '1' } })).status, 403);
});
test('external search gives DeepSeek real search context and sources without changing the user message', async t => {
  const store = createWorkspaceSettings(base()); t.after(() => store.close());
  const input = editable(store); input.search = { engine: 'tavily', apiKey: 'tvly-test', maxResults: 2, depth: 'basic', timeRange: '' }; store.save(input);
  let modelBody, searchBody;
  const server = createGatewayServer({ config: store.config, workspaceStore: store, fetchImpl: async (url, options) => {
    if (String(url).includes('tavily')) { searchBody = JSON.parse(options.body); return Response.json({ results: [
      { title: 'Source', url: 'https://example.com/news', content: 'Current verified search evidence.' },
      { title: 'unsafe', url: 'javascript:alert(1)', content: 'skip' } ] }); }
    modelBody = JSON.parse(options.body); return Response.json({ output_text: 'Answer with source', usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } });
  } }); server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const metadata = await (await fetch(`${url}/api/providers`)).json(); assert.equal(metadata.providers[0].capabilities.webSearch, true);
  const response = await fetch(`${url}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'deepseek', messages: [{ role: 'user', content: 'What happened today?' }], webSearch: true }) });
  assert.equal(response.status, 200); const result = await response.json(); assert.equal(result.search.used, true); assert.equal(result.search.sources.length, 1);
  assert.equal(searchBody.query, 'What happened today?'); assert.ok(JSON.stringify(modelBody).includes('Current verified search evidence.'));
  assert.ok(JSON.stringify(modelBody).includes('What happened today?'));
});
test('search failure or no readable results prevents false grounded answers', async () => {
  const settings = { engine: 'searxng', url: 'https://example.com/', maxResults: 3, timeRange: '' };
  await assert.rejects(searchWeb(settings, 'query', async () => Response.json({ results: [] })), /没有返回可读取/);
  await assert.rejects(searchWeb(settings, 'query', async () => new Response('', { status: 403 })), /403/);
});
test('DOCX parser rejects invalid archives and compressed expansion bombs before extraction', () => {
  assert.throws(() => validateDocxArchive(new Uint8Array(40)), /Word/);
  const bytes = new Uint8Array(68), view = new DataView(bytes.buffer);
  view.setUint32(0, 0x02014b50, true); view.setUint32(24, 100 * 1024 * 1024, true);
  view.setUint32(46, 0x06054b50, true); view.setUint16(56, 1, true); view.setUint32(62, 0, true);
  assert.throws(() => validateDocxArchive(bytes), /过大/);
});
