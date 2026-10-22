import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { retrieveDocuments } from '../src/document_retrieval.mjs';
import { validateDocumentContext, locateDocumentSource } from '../public/document_library.js';
import { searchWeb } from '../src/web_search.mjs';
import { validateSearch, createBackup, planImport } from '../public/backups.js';
import { normalizeConversation, createSharedConversationStore } from '../src/shared_conversations.mjs';
import { createAccountStore } from '../src/accounts.mjs';

const documents = [{ id: 'citation-document', name: 'QA.pdf', enabled: true, sections: [
  { label: '第 180 页', text: '背景'.repeat(510) + '唯一标记 CITATION7392' + '结尾'.repeat(300) }] }];
test('private citation snapshots and search sources persist for the same account and stay isolated', async () => {
  const directory = mkdtempSync(join(tmpdir(),'citation-accounts-'));
  try {
    const file = join(directory,'accounts.json'), store = createAccountStore(file);
    const alice = await store.register({username:'qa_citation_alice',password:'QA-citation-password-7392!'});
    const bob = await store.register({username:'qa_citation_bob',password:'QA-citation-password-7392!'});
    const search = {enabled:true,used:true,queries:['QA'],sources:[{title:'QA',url:'https://example.invalid/report',excerpt:'QA saved excerpt'}]};
    const documentContext = retrieveDocuments(documents,'CITATION7392').context;
    const conversation = {id:'private-citation-qa',provider:'deepseek',model:'deepseek-flash',documents,
      messages:[{role:'user',content:'QA question'},{role:'assistant',content:'QA answer [1]',search,documentContext}]};
    store.putConversation(alice.user.id,conversation.id,{revision:0,conversation});
    const reload = createAccountStore(file);
    assert.deepEqual(reload.listConversations(alice.user.id).conversations[0].conversation.messages[1].search,search);
    assert.deepEqual(reload.listConversations(alice.user.id).conversations[0].conversation.messages[1].documentContext,documentContext);
    assert.equal(reload.listConversations(bob.user.id).conversations.length,0);
  } finally {rmSync(directory,{recursive:true,force:true});}
});
test('citation offsets identify overlapped retrieval text and reject changed, absent or same-name documents', () => {
  const context = retrieveDocuments(documents, 'CITATION7392').context;
  assert.deepEqual(validateDocumentContext(context), context);
  const source = context.sources.find(s => s.offset === 1000);
  assert.ok(source); const position = locateDocumentSource(source, documents);
  assert.equal(position.section.label, '第 180 页'); assert.equal(position.offset, 1000);
  assert.equal(locateDocumentSource(source, [{ ...documents[0], id: 'different-document' }]), null);
  assert.equal(locateDocumentSource(source, [{ ...documents[0], sections: [{ label: source.location, text: 'changed' }] }]), null);
  assert.equal(locateDocumentSource(source, []), null);
  const { documentId, sectionIndex, offset, ...legacy } = source;
  assert.equal(locateDocumentSource(legacy, documents), null);
  assert.deepEqual(validateDocumentContext({mode:'retrieval',sources:[legacy]}).sources[0], legacy);
  assert.throws(() => validateDocumentContext({ mode:'retrieval', sources:[{...source, offset:-1}] }), /定位/);
});
test('budget-truncated citations retain exact original position and sampling remains explicit', () => {
  const result = retrieveDocuments(documents, '总结', 800);
  assert.equal(result.context.mode, 'overview'); assert.match(result.text, /不能宣称已精读全文/);
  for (const source of result.context.sources) assert.ok(locateDocumentSource(source, documents));
});
test('search excerpts are bounded and survive server storage and backup roundtrip', async () => {
  const search = await searchWeb({engine:'searxng',url:'https://search.invalid/',maxResults:3}, 'QA', async () => new Response(JSON.stringify({results:[
    {url:'javascript:alert(1)',title:'unsafe',content:'bad'},
    {url:'https://source.invalid/report',title:'QA source',content:'<img onerror=alert(1)>'.repeat(100)}
  ]})));
  assert.equal(search.sources.length, 1); assert.equal(search.sources[0].excerpt.length, 900);
  assert.match(search.context, /\[1\]/);
  const state = { enabled:true, used:true, sources:search.sources, queries:search.queries };
  assert.deepEqual(validateSearch(state), state);
  assert.throws(() => validateSearch({...state,sources:[{...state.sources[0],excerpt:'x'.repeat(901)}]}));
  assert.throws(() => validateSearch({...state,sources:[{title:'QA',url:'https://user:pass@source.invalid'}]}));
  const conversation = {id:'citation-chat-01',title:'QA sources',provider:'deepseek',model:'deepseek-flash',updatedAt:Date.now(),documents,
    messages:[{role:'user',content:'QA question'},{role:'assistant',content:'QA [1]',search:state,documentContext:retrieveDocuments(documents,'CITATION7392').context}]};
  assert.deepEqual(normalizeConversation(conversation).messages[1].search, state);
  const directory = mkdtempSync(join(tmpdir(),'citation-test-'));
  try {
    const file = join(directory,'shared.json'); createSharedConversationStore(file).upsert(conversation,'qa-edit-key-abcdefghijklmnopqrstuvwxyz');
    const saved = createSharedConversationStore(file).list()[0];
    assert.deepEqual(saved.messages[1].search,state);
    const backup = createBackup({getItem: key => key === 'yunjian-ai-conversations-v1' ? JSON.stringify([conversation]) : null});
    const restored = planImport(backup,{getItem: () => null}).conversations[0];
    assert.deepEqual(restored.messages[1].search,state);
    assert.deepEqual(restored.messages[1].documentContext,conversation.messages[1].documentContext);
  } finally { rmSync(directory,{recursive:true,force:true}); }
  const gemini = normalizeConversation({...conversation,provider:'gemini'});
  assert.equal(gemini.messages[1].search,undefined);
});
