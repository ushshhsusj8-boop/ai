import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceSession } from '../public/voice_composer.js';

function setup(text = '', limit = 12000) {
  let recognition, context = 'first', busy = false, saved = 0, status = '', active = false;
  class Recognition { constructor() { recognition = this; } start() { this.onstart(); } stop() { this.stopped = true; } abort() { this.aborted = true; } }
  const input = { value: text, maxLength: limit, selectionStart: text.length, selectionEnd: text.length, setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; } };
  const session = createVoiceSession({ Recognition, input, context: () => context, busy: () => busy, changed: () => saved++,
    status: value => status = value, active: value => active = value, timer: () => 1, clearTimer: () => {} });
  const result = (text, isFinal) => Object.assign([{ transcript: text }], { isFinal });
  return { session, input, start: () => session.start(), results: (...items) => recognition.onresult({ results: items.map(item => result(...item)) }),
    get recognition() { return recognition; }, get status() { return status; }, get saved() { return saved; }, get active() { return active; },
    switch: () => { context = 'second'; }, busy: () => { busy = true; } };
}
test('speech keeps interim text outside draft and consumes cumulative finals once', () => {
  const s = setup('原有草稿：'); s.start(); s.results(['暂时', false]); assert.equal(s.input.value, '原有草稿：');
  s.results(['第一句', true], ['第二', false]); s.results(['第一句', true], ['第二句', true]);
  assert.equal(s.input.value, '原有草稿：第一句第二句'); assert.equal(s.saved, 2);
  s.session.stop(); assert.equal(s.recognition.stopped, true);
  s.results(['第一句', true], ['第二句', true], ['结束', true]); assert.equal(s.input.value, '原有草稿：第一句第二句结束');
});
test('context switch, manual edits, cancellation and busy state reject late speech', () => {
  for (const action of [s => s.switch(), s => { s.input.value = '手动编辑'; }, s => s.session.cancel(), s => s.busy()]) {
    const s = setup('保留'); s.start(); action(s); const expected = s.input.value; s.results(['不应写入', true]);
    assert.equal(s.input.value, expected); assert.equal(s.active, false); assert.equal(s.recognition.aborted, true);
  }
});
test('speech replaces selected text, enforces prompt length and preserves draft on errors', () => {
  const s = setup('12345', 6); s.input.selectionStart = 2; s.input.selectionEnd = 4; s.start(); s.results(['ABCDE', true]);
  assert.equal(s.input.value, '12ABC5'); assert.equal(s.active, false); assert.match(s.status, /上限/);
  const denied = setup('草稿'); denied.start(); denied.recognition.onerror({ error: 'not-allowed' }); assert.equal(denied.input.value, '草稿'); assert.match(denied.status, /权限/);
});
test('late callbacks from previous recognition cannot affect a restarted session', () => {
  const s = setup(); s.start(); const previous = s.recognition; s.session.cancel(); s.start();
  previous.onend(); previous.onerror({ error: 'network' }); previous.onresult({ results: [Object.assign([{ transcript: '旧结果' }], { isFinal: true })] });
  assert.equal(s.active, true); assert.equal(s.input.value, ''); s.results(['新结果', true]); assert.equal(s.input.value, '新结果');
});
