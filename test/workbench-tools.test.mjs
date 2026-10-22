import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseModelParameterJson, previewDocument, messageDetails, appendDraftText } from '../public/workbench_tools.js';

const capabilities = { temperature: true, top_p: true, max_output_tokens: { min: 64, max: 1200 } };
test('JSON output budgets support known model maxima and unknown provider bounds', () => {
  assert.deepEqual(parseModelParameterJson('{"max_output_tokens":393216}', {max_output_tokens:{min:1,max:393216}}), {max_output_tokens:393216});
  assert.deepEqual(parseModelParameterJson('{"max_output_tokens":262144}', {max_output_tokens:{min:1}}), {max_output_tokens:262144});
  for (const value of [0, -1, 1.5, '65536', 9007199254740992]) {
    assert.throws(() => parseModelParameterJson(JSON.stringify({max_output_tokens:value}), {max_output_tokens:{min:1}}));
  }
});
test('JSON parameters preserve zero and obey model support and server bounds', () => {
  assert.deepEqual(parseModelParameterJson('{"temperature":0,"max_output_tokens":1200}', capabilities), { temperature: 0, max_output_tokens: 1200 });
  assert.deepEqual(parseModelParameterJson('{}', capabilities), {});
  for (const source of ['[]', 'null', '{', '{"temperature":"1"}', '{"top_p":0}', '{"max_output_tokens":1201}', '{"max_output_tokens":64.5}', '{"apiKey":"private"}', '{"__proto__":{}}']) {
    assert.throws(() => parseModelParameterJson(source, capabilities));
  }
  assert.throws(() => parseModelParameterJson('{"temperature":1}', {}));
});
test('artifact preview blocks active content and removes source meta navigation', () => {
  const source = '<meta http-equiv="refresh" content="0;url=https://example.com"><script>parent.evil()</script><h1>Hello</h1>';
  const result = previewDocument(source);
  assert.doesNotMatch(result, /http-equiv="refresh"/);
  assert.match(result, /script-src 'none'/); assert.match(result, /connect-src 'none'/);
  assert.match(result, /form-action 'none'/); assert.match(result, /<h1>Hello<\/h1>/);
  assert.match(source, /http-equiv="refresh"/);
});
test('message inspection never copies private or transport properties', () => {
  const value = messageDetails({ role: 'assistant', content: '你好🌱', createdAt: 1234, token: 'secret', raw: { authorization: 'secret' } },
    { provider: 'test', model: 'test-model', editKey: 'secret', gatewayToken: 'secret' });
  assert.equal(value.characters, 3); assert.equal(value.model, 'test-model');
  assert.doesNotMatch(JSON.stringify(value), /secret|authorization|editKey|gatewayToken/);
});
test('reviewed documents append to a draft atomically and refuse overflow', () => {
  assert.equal(appendDraftText('原来的问题', '文件内容'), '原来的问题\n\n文件内容');
  assert.equal(appendDraftText('', '文件内容'), '文件内容');
  assert.throws(() => appendDraftText('保留原稿', '太长的文件内容', 5));
});
