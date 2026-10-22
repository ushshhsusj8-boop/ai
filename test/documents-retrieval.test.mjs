import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateDocuments, validateDocumentContext, textSections } from '../public/document_library.js';
import { retrieveDocuments } from '../src/document_retrieval.mjs';
import { parseDocument } from '../public/documents.js';
import { createSharedConversationStore } from '../src/shared_conversations.mjs';
import { createBackup, planImport, applyImport } from '../public/backups.js';
import { createGatewayServer } from '../src/app.mjs';
import { loadConfig } from '../src/config.mjs';
import { readChatStream } from '../public/event_stream.js';
const docs = [{ id: 'document-test-001', name: '远航计划.pdf', enabled: true, pdfInfo: {version: 1, totalPages: 180, states: Array(180).fill('text')}, sections: Array.from({ length: 180 }, (_, i) => ({ label: `第 ${i + 1} 页`, text: i === 179 ? '远航项目的最终验收口令是蓝鲸7392，负责人为李海。' : '日常事项：整理物品，维护办公设备，准备例会材料。'.repeat(12) })) }];
test('retrieval finds a unique answer on page 180 and preserves page citation', () => {
  const result = retrieveDocuments(docs, '远航项目最终验收口令是什么？');
  assert.equal(result.context.mode, 'retrieval');
  assert.equal(result.context.sources[0].location, '第 180 页');
  assert.ok(result.text.includes('蓝鲸7392'));
  assert.ok(result.text.length <= 8000);
  assert.deepEqual(validateDocumentContext(result.context), result.context);
});
test('retrieval distinguishes two conflicting documents and bounds context', () => {
  const pair = [...docs, { id: 'document-test-002', name: '变更通知.txt', enabled: true, sections: [{ label: '段落 1', text: '远航项目的最终验收口令已经更改为青鸟4488。' }] }];
  const result = retrieveDocuments(pair, '远航项目最终验收口令是否更改？', 2400);
  assert.ok(result.context.sources.some(s => s.id.startsWith('资料1')));
  assert.ok(result.context.sources.some(s => s.id.startsWith('资料2')));
  assert.ok(result.text.length <= 2400);
  assert.equal(retrieveDocuments(pair.map(d => ({ ...d, enabled: false })), '问题'), null);
  assert.throws(() => retrieveDocuments(pair, '问题', 100), /上下文已满/);
});
test('overview explicitly labels sampling and covers beginning and end', () => {
  for (const question of ['总结全文', 'zzzz-no-match']) {
    const result = retrieveDocuments(docs, question);
    assert.equal(result.context.mode, 'overview');
    assert.ok(result.text.includes('不能宣称已精读全文'));
    assert.ok(result.context.sources.some(s => s.location === '第 180 页'));
    assert.ok(result.context.sources.some(s => s.location === '第 1 页'));
  }
});
test('full text parsing retains late content, rejects oversize and invalid UTF8', async () => {
  const text = '例行记录。'.repeat(14000) + '末尾重要凭证 BLUE-7392';
  const parsed = await parseDocument(new File([text], '记录.txt'), { full: true });
  assert.equal(parsed.text, text); assert.ok(parsed.sections.at(-1).text.includes('BLUE-7392'));
  await assert.rejects(parseDocument(new File(['a'.repeat(120001)], '超长.txt'), { full: true }), /12 万/);
  await assert.rejects(parseDocument(new File([new Uint8Array([255, 254])], '错误.txt'), { full: true }), /UTF-8/);
  assert.throws(() => validateDocuments([...docs, ...docs]), /格式无效/);
  assert.throws(() => validateDocuments([{ ...docs[0], sections: [{ label: '段落', text: 'a'.repeat(120001) }] }]), /12 万/);
  assert.equal(textSections('编辑的文字', '编辑后段落')[0].label, '编辑后段落 1');
});
test('documents and cited excerpts survive shared reload, cannot be stripped, and roundtrip through backup', () => {
  const directory = mkdtempSync(join(tmpdir(), 'huawei-docs-'));
  const conversation = { id: 'docs-roundtrip', title: '资料', provider: 'deepseek', model: 'deepseek-flash', updatedAt: Date.now(), documents: docs, messages: [{ role: 'user', content: '口令？' }, { role: 'assistant', content: '蓝鲸7392', documentContext: retrieveDocuments(docs, '最终验收口令').context }] };
  const key = 'publisher-edit-key-abcdefghijklmnopqrstuvwxyz';
  try {
    const file = join(directory, 'shared.json'); createSharedConversationStore(file).upsert(conversation, key);
    const store = createSharedConversationStore(file), saved = store.list()[0];
    assert.deepEqual(saved.documents, docs); assert.deepEqual(saved.messages[1].documentContext, conversation.messages[1].documentContext);
    assert.throws(() => store.upsert({ ...conversation, documents: [] }, key), /Saved attachments/);
    store.mergeRemote([{ ...conversation, documents: [], updatedAt: Date.now()+1 }]); assert.deepEqual(store.list()[0].documents, docs);
    store.upsert({ ...conversation, documents: docs.map(d => ({ ...d, enabled: false })) }, key);
    assert.equal(store.list()[0].documents[0].enabled, false);
    const source = { getItem: k => k === 'yunjian-ai-conversations-v1' ? JSON.stringify([conversation]) : null };
    const data = new Map(), dest = { getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,v), removeItem: k => data.delete(k) };
    applyImport(planImport(createBackup(source), dest), dest);
    const restored = JSON.parse(data.get('yunjian-ai-conversations-v1'))[0];
    assert.deepEqual(restored.documents, docs); assert.deepEqual(restored.messages[1].documentContext, conversation.messages[1].documentContext);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('gateway retrieves full large document, sends bounded excerpts to upstream and returns citations in SSE', async t => {
  const config = loadConfig({ NODE_ENV: 'test', BIND_HOST: '127.0.0.1', GATEWAY_ACCESS_TOKEN: 'docs-test-token-abcdefghijklmnopqrstuvwxyz', DEEPSEEK_API_KEY: 'sk-test-abcdefghijklmnopqrstuvwxyz', DEFAULT_PROVIDER: 'deepseek' });
  let calls = 0;
  const server = createGatewayServer({ config, fetchImpl: async (_, options) => {
    calls++; const input = JSON.parse(options.body); const text = input.input.at(-1).content;
    assert.ok(text.includes('蓝鲸7392')); assert.ok(text.length < 9000);
    return new Response(JSON.stringify({ output_text: '蓝鲸7392 [资料1·片段180]', usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 } }), { headers: { 'content-type': 'application/json' } });
  } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => { server.closeAllConnections(); server.close(); });
  const request = payload => fetch(`http://127.0.0.1:${server.address().port}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${config.gatewayAccessToken}`, accept: 'text/event-stream' }, body: JSON.stringify({ provider: 'deepseek', messages: [{ role: 'user', content: '最终验收口令是什么？' }], documents: docs, ...payload }) });
  const response = await request({}); assert.equal(response.status, 200);
  const result = await readChatStream(response, () => {}); assert.equal(result.documentContext.sources[0].location, '第 180 页');
  const rejected = await request({ documents: [{ ...docs[0], extra: 'a'.repeat(100000) }] });
  assert.equal(rejected.status, 413); assert.equal(calls, 1);
});
