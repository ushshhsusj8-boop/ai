import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateImages, imageParts, MAX_IMAGE_BYTES } from '../public/image_attachments.js';
import { supportsImageInput } from '../src/vision.mjs';
import { normalizeModelCatalog } from '../src/model_catalog.mjs';
import { buildChatContext } from '../public/conversation_tools.js';
import { createSharedConversationStore } from '../src/shared_conversations.mjs';
import { createBackup, planImport, applyImport } from '../public/backups.js';
import { createGatewayServer } from '../src/app.mjs';
import { loadConfig } from '../src/config.mjs';
import { readChatStream } from '../public/event_stream.js';

const image = { name: 'pixel.png', dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMfcAAAAASUVORK5CYII=' };
const images = validateImages([image]);
const base = loadConfig({ NODE_ENV: 'test', BIND_HOST: '127.0.0.1', GATEWAY_ACCESS_TOKEN: 'vision-test-token-abcdefghijklmnopqrstuvwxyz', DEEPSEEK_API_KEY: 'sk-test-abcdefghijklmnopqrstuvwxyz', NVIDIA_API_KEY: 'nvapi-test-abcdefghijklmnopqrstuvwxyz', DEFAULT_PROVIDER: 'deepseek' });
async function start(t, fetchImpl, overrides = {}) {
  const app = createGatewayServer({ config: { ...base, ...overrides }, fetchImpl });
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  t.after(() => { app.closeAllConnections(); app.close(); });
  return `http://127.0.0.1:${app.address().port}`;
}
function request(url, payload, extra = {}) {
  return fetch(url + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${base.gatewayAccessToken}`, ...extra }, body: JSON.stringify({ provider: 'deepseek', messages: [{ role: 'user', content: '看图', images }], ...payload }) });
}
test('image validator verifies binary type, dimensions, byte count, roles and count', () => {
  assert.equal(images[0].width, 1); assert.equal(images[0].height, 1);
  for (const dataUrl of ['https://example.com/a.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,YWJjZA==', 'data:image/png;base64,***', 'data:image/jpeg;base64,' + 'A'.repeat(MAX_IMAGE_BYTES * 2)]) {
    assert.throws(() => validateImages([{ dataUrl }]));
  }
  const bomb = Buffer.from(image.dataUrl.split(',')[1], 'base64'); bomb.writeUInt32BE(90000, 16);
  assert.throws(() => validateImages([{ dataUrl: 'data:image/png;base64,' + bomb.toString('base64') }]), /尺寸/);
  assert.throws(() => validateImages([image], 'assistant'));
  assert.throws(() => validateImages([image, image, image, image]));
  assert.equal(validateImages([{ ...image, name: 'c:\\test\\<bad>.png' }])[0].name, '_bad_.png');
});
test('vision capability is conservative and honors per-model catalog modalities', () => {
  assert.equal(supportsImageInput(base.providers.deepseek, 'deepseek-flash'), true);
  assert.equal(supportsImageInput(base.providers.deepseek, 'deepseek-v4-pro'), false);
  assert.equal(supportsImageInput({ ...base.providers.deepseek, apiUrl: 'https://custom.example/responses' }, 'deepseek-flash'), false);
  const provider = { id: 'openrouter', model: 'vendor/vision', models: ['vendor/vision'], modelCatalogMode: 'curated' };
  const modelOptions = normalizeModelCatalog({ data: [{ id: 'vendor/vision', architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } }] }, provider);
  assert.equal(supportsImageInput({ ...provider, modelOptions }, 'vendor/vision'), true);
  assert.equal(supportsImageInput({ ...provider, modelOptions }, 'vendor/text'), false);
});
test('multimodal adapters preserve text and use the correct provider image part', () => {
  const messages = [{ role: 'user', content: '图中是什么', images }, { role: 'assistant', content: '回答' }];
  const responses = imageParts(messages, 'responses');
  assert.equal(responses[0].content[1].type, 'input_image');
  assert.equal(responses[0].content[1].image_url, image.dataUrl);
  assert.deepEqual(responses[1], messages[1]);
  const chat = imageParts(messages, 'chat-completions');
  assert.equal(chat[0].content[1].image_url.url, image.dataUrl);
  assert.equal(JSON.stringify(chat).includes('pixel.png'), false);
});
test('context retains images for follow-up and bounds image history without changing saved records', () => {
  const messages = [];
  for (let i = 0; i < 10; i++) messages.push({ role: 'user', content: '看图', images, createdAt: i + 1 }, { role: 'assistant', content: '答', createdAt: i + 1 });
  messages.push({ role: 'user', content: '继续解释' });
  const context = buildChatContext(messages, {});
  assert.equal(context.messages.reduce((sum, m) => sum + (m.images?.length || 0), 0), 8);
  assert.equal(messages[0].images[0].dataUrl, image.dataUrl);
  assert.equal(buildChatContext(messages, { historyTurns: 0 }).messages.length, 1);
});
test('images survive shared store reload and backup roundtrip', () => {
  const directory = mkdtempSync(join(tmpdir(), 'huawei-vision-'));
  const now = Date.now();
  const conversation = { id: 'vision-roundtrip', title: '图片对话', provider: 'deepseek', model: 'deepseek-flash', updatedAt: now, messages: [{ role: 'user', content: '看图', images, createdAt: now }] };
  try {
    const file = join(directory, 'shared.json');
    createSharedConversationStore(file).upsert(conversation, 'publisher-edit-key-abcdefghijklmnopqrstuvwxyz');
    const saved = createSharedConversationStore(file).list()[0];
    assert.deepEqual(saved.messages[0].images, images);
    const stripped = { ...conversation, updatedAt: now + 1, messages: [{ role: 'user', content: '看图' }] };
    assert.throws(() => createSharedConversationStore(file).upsert(stripped, 'publisher-edit-key-abcdefghijklmnopqrstuvwxyz'), /Saved attachments/);
    const merged = createSharedConversationStore(file); merged.mergeRemote([stripped]);
    assert.deepEqual(merged.list()[0].messages[0].images, images);
    const data = new Map([['yunjian-ai-conversations-v1', JSON.stringify([conversation])]]);
    const source = { getItem: key => data.get(key) ?? null };
    const dest = new Map(); const destination = { getItem: key => dest.get(key) ?? null, setItem: (key, value) => dest.set(key, value), removeItem: key => dest.delete(key) };
    applyImport(planImport(createBackup(source), destination), destination);
    assert.deepEqual(JSON.parse(dest.get('yunjian-ai-conversations-v1'))[0].messages[0].images, images);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('authenticated image requests reach Responses upstream and stream their answer', async t => {
  const encoder = new TextEncoder();
  const url = await start(t, async (_, options) => {
    const input = JSON.parse(options.body);
    assert.equal(input.stream, true); assert.equal(input.input[0].content[1].image_url, image.dataUrl);
    return new Response(new ReadableStream({ start(controller) {
      for (const data of [{ type: 'response.output_text.delta', delta: '图中内容' }, { type: 'response.completed', response: { output_text: '图中内容', usage: { input_tokens: 4, output_tokens: 3, total_tokens: 7 } } }]) controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      controller.close();
    } }), { headers: { 'content-type': 'text/event-stream' } });
  });
  const metadata = await (await fetch(url + '/api/providers')).json();
  assert.equal(metadata.providers.find(p => p.id === 'deepseek').models.find(m => m.id === 'deepseek-flash').vision, true);
  let delta = ''; const result = await readChatStream(await request(url, {}, { accept: 'text/event-stream' }), text => { delta += text; });
  assert.equal(delta, '图中内容'); assert.equal(result.usage.totalTokens, 7);
});
test('vision failures reject before contacting a provider and keep auth enforced', async t => {
  let calls = 0; const url = await start(t, async () => { calls++; throw new Error('must not call'); });
  assert.equal((await request(url, {}, { authorization: 'Bearer invalid' })).status, 401);
  for (const payload of [
    { model: 'deepseek-v4-pro' }, { webSearch: true },
    { messages: [{ role: 'user', content: '看图', images: [{ dataUrl: 'http://127.0.0.1/private' }] }] },
    { messages: Array.from({ length: 3 }, () => ({ role: 'user', content: '看图', images: [image, image, image] })) },
  ]) assert.equal((await request(url, payload)).status, 400);
  assert.equal(calls, 0);
});
test('image payload allowance leaves the existing text request limit intact', async t => {
  let calls = 0; const url = await start(t, async () => { calls++; return Response.json({ output_text: 'ok' }); }, { maxBodyBytes: 1024 });
  const padding = Buffer.alloc(3000); // PNG ancillary bytes do not count as text request budget.
  const dataUrl = image.dataUrl.split(',')[0] + ',' + Buffer.concat([Buffer.from(image.dataUrl.split(',')[1], 'base64'), padding]).toString('base64');
  assert.equal((await request(url, { messages: [{ role: 'user', content: '看图', images: [{ dataUrl }] }] })).status, 200);
  assert.equal((await request(url, { messages: [{ role: 'user', content: 'x'.repeat(2000) }] })).status, 413);
  assert.equal(calls, 1);
});
