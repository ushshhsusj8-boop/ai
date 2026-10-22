import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequestQueue, fetchQueuedChat } from '../public/request_queue.js';

test('interactive and batch requests share slots, queue fairly and release exactly once', async () => {
  const queue = createRequestQueue(2);
  const releaseA = await queue.acquire(new AbortController().signal);
  const releaseB = await queue.acquire(new AbortController().signal);
  const started = [];
  const third = queue.acquire(new AbortController().signal).then(release => { started.push('third'); return release; });
  const fourth = queue.acquire(new AbortController().signal).then(release => { started.push('fourth'); return release; });
  await Promise.resolve(); assert.deepEqual(started, []);
  releaseB(); releaseB();
  const releaseC = await third; assert.deepEqual(started, ['third']);
  releaseA(); const releaseD = await fourth; assert.deepEqual(started, ['third', 'fourth']);
  releaseC(); releaseD();
});

test('canceling a queued conversation never starts it or interrupts other conversations', async () => {
  const queue = createRequestQueue(1);
  const releaseA = await queue.acquire(new AbortController().signal);
  const cancelled = new AbortController();
  const wait = queue.acquire(cancelled.signal);
  cancelled.abort(); await assert.rejects(wait, { name: 'AbortError' });
  let started = false;
  const next = queue.acquire(new AbortController().signal).then(release => { started = true; return release; });
  await Promise.resolve(); assert.equal(started, false);
  releaseA(); (await next)();
  await assert.rejects(queue.acquire(cancelled.signal), { name: 'AbortError' });
});

test('a lower server concurrency limit takes effect without canceling active requests', async () => {
  const queue = createRequestQueue(2);
  const releaseA = await queue.acquire(new AbortController().signal);
  const releaseB = await queue.acquire(new AbortController().signal);
  queue.setLimit(1);
  let started = false;
  const wait = queue.acquire(new AbortController().signal).then(release => { started = true; return release; });
  releaseA(); await Promise.resolve(); assert.equal(started, false);
  releaseB(); (await wait)(); assert.equal(started, true);
});

test('only explicit pre-upstream busy responses retry, with a bounded count', async () => {
  const options = { signal: new AbortController().signal };
  let calls = 0;
  const response = await fetchQueuedChat('/api/chat', options, async () => {
    calls++; return calls === 1 ? new Response('busy', { status: 503, headers: { 'x-yunjian-busy': '1' } }) : Response.json({ ok: true });
  }, async () => {});
  assert.equal(calls, 2); assert.equal(response.status, 200);
  calls = 0;
  await fetchQueuedChat('/api/chat', options, async () => { calls++; return new Response('upstream failed', { status: 503 }); }, async () => {});
  assert.equal(calls, 1);
  calls = 0;
  const busy = await fetchQueuedChat('/api/chat', options, async () => { calls++; return new Response('busy', { status: 503, headers: { 'x-yunjian-busy': '1' } }); }, async () => {});
  assert.equal(calls, 3); assert.equal(busy.status, 503);
});

test('canceling during a busy retry delay prevents another request', async () => {
  const controller = new AbortController(); let calls = 0;
  const pending = fetchQueuedChat('/api/chat', { signal: controller.signal }, async () => { calls++; return new Response('busy', { status: 503, headers: { 'x-yunjian-busy': '1' } }); });
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending, { name: 'AbortError' }); assert.equal(calls, 1);
});
