import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { createGatewayServer } from '../src/app.mjs';
import { loadConfig } from '../src/config.mjs';
import { readEventStream, readChatStream } from '../public/event_stream.js';
import { collectProviderStream } from '../src/provider_stream.mjs';

const encoder = new TextEncoder();
const event = value => `data: ${JSON.stringify(value)}\n\n`;
function body(text, stride = 1) {
  const bytes = encoder.encode(text);
  return new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += stride) controller.enqueue(bytes.slice(i, i + stride)); controller.close(); } });
}
const config = loadConfig({ NODE_ENV: 'test', BIND_HOST: '127.0.0.1', GATEWAY_ACCESS_TOKEN: 'stream-test-token-abcdefghijklmnopqrstuvwxyz',
  NVIDIA_API_KEY: 'nvapi-test-key-abcdefghijklmnopqrstuvwxyz', DEEPSEEK_API_KEY: 'sk-test-key-abcdefghijklmnopqrstuvwxyz', REQUEST_TIMEOUT_MS: '1000' });
async function server(t, fetchImpl, overrides = {}) {
  const app = createGatewayServer({ config: { ...config, ...overrides }, fetchImpl });
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  t.after(() => { app.closeAllConnections(); app.close(); });
  return `http://127.0.0.1:${app.address().port}`;
}
function request(url, options = {}) {
  return fetch(url + '/api/chat', { method: 'POST', headers: { authorization: `Bearer ${config.gatewayAccessToken}`, 'content-type': 'application/json', accept: 'text/event-stream', ...options.headers },
    body: JSON.stringify({ provider: options.provider || 'nvidia', messages: [{ role: 'user', content: '你好' }] }), signal: options.signal });
}
test('SSE preserves split UTF-8, CRLF, comments and multiline data', async () => {
  const frames = [];
  for await (const item of readEventStream(body(': heartbeat\r\n\r\nevent: delta\r\ndata: 你好🌱\r\ndata: next\r\n\r\n'))) frames.push(item);
  assert.deepEqual(frames, [{ event: 'delta', data: '你好🌱\nnext' }]);
});
test('chat adapter collects deltas and final usage without exposing reasoning', async () => {
  let text = '';
  const payload = await collectProviderStream(body(event({ choices: [{ index: 0, delta: { content: '你', reasoning_content: 'private' } }] })
    + event({ choices: [{ index: 0, delta: { content: '好' }, finish_reason: 'stop' }] })
    + event({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } }) + 'data: [DONE]\n\n'), 'chat-completions', delta => { text += delta; });
  assert.equal(text, '你好'); assert.equal(payload.usage.total_tokens, 5); assert.doesNotMatch(JSON.stringify(payload), /private/);
});
test('Responses adapter forwards output text and preserves incomplete terminal status', async () => {
  let text = '';
  const payload = await collectProviderStream(body(event({ type: 'response.reasoning_text.delta', delta: 'private' })
    + event({ type: 'response.output_text.delta', delta: '部分回答' })
    + event({ type: 'response.incomplete', response: { status: 'incomplete', usage: { total_tokens: 4 } } })), 'responses', delta => { text += delta; });
  assert.equal(text, '部分回答'); assert.equal(payload.output_text, text); assert.equal(payload.status, 'incomplete');
});
test('truncated and explicit-error upstream streams fail after preserving received deltas', async () => {
  for (const suffix of ['', event({ error: { message: 'private upstream detail' } })]) {
    let text = '';
    await assert.rejects(collectProviderStream(body(event({ choices: [{ delta: { content: '保留' } }] }) + suffix), 'chat-completions', delta => { text += delta; }));
    assert.equal(text, '保留');
  }
});
test('gateway delivers text before completion and records final usage', async t => {
  let release, received; const gate = new Promise(r => { release = r; }); const deltaReady = new Promise(r => { received = r; });
  const url = await server(t, async (_url, options) => {
    const sent = JSON.parse(options.body); assert.equal(sent.stream, true); assert.equal(sent.stream_options.include_usage, true);
    return new Response(new ReadableStream({ async start(controller) {
      controller.enqueue(encoder.encode(event({ choices: [{ delta: { content: '第一段' } }] })));
      await gate;
      controller.enqueue(encoder.encode(event({ choices: [{ delta: { content: '第二段' }, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 } }) + 'data: [DONE]\n\n')); controller.close();
    } }), { headers: { 'content-type': 'text/event-stream' } });
  });
  const response = await request(url); assert.equal(response.headers.get('x-accel-buffering'), 'no');
  let accumulated = '';
  const finished = readChatStream(response, delta => { accumulated += delta; received(); });
  await deltaReady; assert.equal(accumulated, '第一段'); release();
  const result = await finished; assert.equal(result.text, '第一段第二段'); assert.equal(result.usage.totalTokens, 4);
});
test('Responses gateway streaming and JSON-only fallback both finish correctly', async t => {
  for (const streaming of [true, false]) {
    const url = await server(t, async (_url, options) => {
      assert.equal(JSON.parse(options.body).stream, true);
      const payload = { status: 'completed', output_text: '完成', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
      return streaming ? new Response(body(event({ type: 'response.output_text.delta', delta: '完成' }) + event({ type: 'response.completed', response: payload })), { headers: { 'content-type': 'text/event-stream' } }) : Response.json(payload);
    });
    const result = await readChatStream(await request(url, { provider: 'deepseek' }), () => {}); assert.equal(result.text, '完成');
  }
});
test('midstream error is a sanitized SSE error, not an apparent successful answer', async t => {
  const url = await server(t, async () => new Response(body(event({ choices: [{ delta: { content: '保留' } }] }) + event({ error: { message: 'secret-key' } })), { headers: { 'content-type': 'text/event-stream' } }));
  let text = '';
  await assert.rejects(readChatStream(await request(url), delta => { text += delta; }), error => error.status === 502 && !error.message.includes('secret-key'));
  assert.equal(text, '保留');
});
test('client cancellation aborts upstream and releases the concurrency slot', async t => {
  let aborted; const stopped = new Promise(r => { aborted = r; });
  let calls = 0;
  const url = await server(t, async (_url, options) => {
    if (++calls > 1) return Response.json({ choices: [{ message: { content: '第二次成功' } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(encoder.encode(event({ choices: [{ delta: { content: '先显示' } }] })));
      options.signal.addEventListener('abort', () => { controller.error(new DOMException('Aborted', 'AbortError')); aborted(); }, { once: true });
    } }), { headers: { 'content-type': 'text/event-stream' } });
  }, { maxConcurrentRequests: 1 });
  const abort = new AbortController();
  await assert.rejects(readChatStream(await request(url, { signal: abort.signal }), () => abort.abort()));
  await stopped; await new Promise(r => setTimeout(r, 20));
  assert.equal((await readChatStream(await request(url), () => {})).text, '第二次成功');
});
test('stream requests still require authentication and frontend rejects missing done events', async t => {
  const url = await server(t, () => { throw new Error('must not reach upstream'); });
  assert.equal((await request(url, { headers: { authorization: '' } })).status, 401);
  let text = '';
  await assert.rejects(readChatStream(new Response(body('event: delta\ndata: {"text":"保留"}\n\n')), delta => { text += delta; }), /提前结束/);
  assert.equal(text, '保留');
});

let lineScenarios;
async function lineCases(){return lineScenarios??=import('./stream-lines.fixture.mjs').then(({streamLineScenarios})=>streamLineScenarios(new URL('../public/',import.meta.url).href));}
test('mixed SSE line endings preserve every frame, UTF-8 and chat status across arbitrary byte chunks',async()=>{
  const r=await lineCases();assert.equal(r.framing.combinations,40);assert.deepEqual(r.framing.failures,[]);assert.equal(r.chat.error,'');assert.deepEqual(r.chat.deltas,['合成回答🌱']);assert.deepEqual(r.chat.statuses,['处理中']);assert.equal(r.chat.final.text,'合成回答🌱');
});
test('SSE never invents a blank line from split CRLF, dispatches standalone CR promptly and rejects incomplete done',async()=>{
  const r=await lineCases();assert.deepEqual(r.boundaries.singleCRLF,[{event:'delta',data:'one\ntwo'}]);assert.equal(r.boundaries.earlyCR,true);assert.deepEqual(r.boundaries.earlyFrame,{event:'delta',data:'now'});assert.deepEqual(r.boundaries.tail,[{event:'done',data:'{}'}]);assert.equal(r.boundaries.truncatedText,'已收到部分');assert.match(r.boundaries.truncatedError,/提前结束/);
});
test('SSE line normalization retains event and total limits and cancels underlying readers on exit',async()=>{
  const r=await lineCases();assert.match(r.limits.event.error,/事件过大/);assert.equal(r.limits.event.cancelled,true);assert.match(r.limits.total.error,/大小限制/);assert.equal(r.limits.total.cancelled,true);assert.equal(r.cancelledOnReturn,true);
});
test('gateway consumes mixed-line upstream SSE and returns complete text and usage without real model access',async t=>{
  const wire='data: '+JSON.stringify({choices:[{delta:{content:'合成混合换行回复🌱'}}]})+'\n\r\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}],usage:{prompt_tokens:2,completion_tokens:3,total_tokens:5}})+'\r\n\rdata: [DONE]\n\n';
  let simulated=0;const url=await server(t,async()=>{simulated++;return new Response(body(wire,1),{headers:{'content-type':'text/event-stream'}});});let text='';const result=await readChatStream(await request(url),delta=>text+=delta);assert.equal(text,'合成混合换行回复🌱');assert.equal(result.text,text);assert.equal(result.usage.totalTokens,5);assert.equal(simulated,1);
});