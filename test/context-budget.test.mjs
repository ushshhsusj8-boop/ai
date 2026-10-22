import assert from 'node:assert/strict';
import {test} from 'node:test';
import {prepareChatContext,formatContextReport} from '../public/context_budget.js';
import {retrieveDocuments} from '../src/document_retrieval.mjs';
const history=Array.from({length:6},(_,i)=>[{role:'user',content:'question '+String(i)+' '+ 'q'.repeat(1990),createdAt:100+i*2},{role:'assistant',content:'answer '+String(i)+' '+ 'a'.repeat(1992),createdAt:101+i*2}]).flat();
const docs=[{id:'context-doc-test',name:'report.pdf',enabled:true,sections:[{label:'第 180 页',text:'BLUE7392 source fact. '.repeat(300)}]}];
test('reported exact history range, omission reason and characters match selected request without altering history',()=>{
  const source=[...history,{role:'user',content:'current question',createdAt:200}],before=structuredClone(source),result=prepareChatContext(source,{});
  assert.equal(result.report.historyTurns,5);assert.equal(result.report.omittedMessages,2);assert.equal(result.report.indices[0],2);assert.ok(result.report.reasons.includes('字符预算'));
  assert.equal(result.report.messageChars,result.messages.reduce((n,m)=>n+m.content.length,0));assert.match(formatContextReport(result.report),/历史第 3–12 条.*省略 2 条/);assert.match(formatContextReport(result.report),/不是模型token/);assert.deepEqual(source,before);
  const gap=prepareChatContext([{role:'user',content:'first'},{role:'assistant',content:'answer'},{role:'user',content:'unanswered'},{role:'user',content:'second'},{role:'assistant',content:'answer2'},{role:'user',content:'current'}],{});
  assert.match(formatContextReport(gap.report),/历史第 1–2、4–5 条.*省略 1 条.*未成对消息/);
});
test('active documents reserve retrieval budget that used to be exhausted by long history and instructions',()=>{
  const source=[{role:'user',content:'q'.repeat(5496)},{role:'assistant',content:'a'.repeat(5500)},{role:'user',content:'q'.repeat(5496)},{role:'assistant',content:'a'.repeat(5500)},{role:'user',content:'BLUE7392'}],instructions='i'.repeat(2000),result=prepareChatContext(source,{}, {instructions,documents:docs});
  assert.equal(result.report.documentReserve,8000);assert.equal(result.report.messageBudget,14000);assert.ok(result.report.historyTurns<prepareChatContext(source,{}).report.historyTurns);
  const remaining=24000-instructions.length-result.report.messageChars,retrieved=retrieveDocuments(docs,'BLUE7392',remaining);assert.ok(remaining>=8000);assert.match(retrieved.text,/BLUE7392/);
  const old=prepareChatContext(source,{}, {instructions}).messages;assert.equal(24000-instructions.length-old.reduce((n,m)=>n+m.content.length,0),0);assert.throws(()=>retrieveDocuments(docs,'BLUE7392',0),/上下文已满/);
  assert.equal(prepareChatContext(source,{}, {documents:docs.map(d=>({...d,enabled:false}))}).report.documentReserve,0);
});
test('settings/reset/image/message limits are explained and current question is never truncated',()=>{
  const source=[...history,{role:'user',content:'current question',createdAt:200}];
  const reset=prepareChatContext(source,{resetAt:108});assert.ok(reset.report.reasons.includes('上下文边界'));assert.equal(reset.report.indices[0],10);
  const zero=prepareChatContext(source,{historyTurns:0});assert.equal(zero.report.historyTurns,0);assert.equal(zero.report.omittedMessages,12);assert.deepEqual(zero.messages,[{role:'user',content:'current question'}]);
  assert.ok(prepareChatContext(source,{}, {maxMessages:3}).report.reasons.includes('消息条数上限'));
  const images=source.map(m=>m.role==='user'?{...m,images:Array(3).fill({id:'qa-image'})}:m);const limited=prepareChatContext(images,{});assert.ok(limited.report.reasons.includes('图片上限'));assert.equal(limited.report.imageCount,6);
  assert.throws(()=>prepareChatContext([{role:'user',content:'x'.repeat(1000)}],{}, {maxInputChars:1000,documents:docs}),/无法同时/);
  assert.throws(()=>prepareChatContext(source,{}, {instructions:'x'.repeat(2001)}),/指令合计/);
  const custom=prepareChatContext([{role:'user',content:'q'}],{}, {maxInputChars:3000});assert.equal(custom.report.messageBudget,3000);assert.equal(custom.report.inputLimit,3000);
});
