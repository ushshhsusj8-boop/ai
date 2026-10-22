import test from 'node:test';
import assert from 'node:assert/strict';
import {documentMatches,sectionMatches} from '../public/document_search.js';
import {searchWorkspace} from '../public/ui_state.js';
import {locateDocumentSource} from '../public/document_library.js';
const doc={id:'test-document',name:'报告.pdf',sections:Array.from({length:180},(_,i)=>({label:`第 ${i+1} 页`,text:i===179?'前文'.repeat(1000)+'Needle [1] 后半部分 needle':'普通内容'}))};
test('full saved document search reaches page 180 and exact later UTF-16 offsets',()=>{
  const matches=documentMatches(doc,'needle [1]');assert.equal(matches.length,3);
  assert.equal(matches[0].sectionIndex,179);assert.equal(matches[0].offset,2000);
  assert.deepEqual(locateDocumentSource(matches[0],[doc]),{doc,section:doc.sections[179],offset:2000});
});
test('query syntax is literal and Unicode case matching does not shift original offsets',()=>{
  assert.deepEqual(sectionMatches('İ 😀 NEEDLE [1] a+b .*',['needle','[1]']).map(m=>m.offset),[5,12]);
  assert.equal(sectionMatches('ab xx',['a+b']).length,0);
  assert.equal(sectionMatches('a+b .*',['a+b','.*']).length,2);
  assert.equal(documentMatches(doc,'needle absent').length,0);
});
test('search result retains owning project/chat and section location for same file ids and names',()=>{
  const results=searchWorkspace({query:'needle',kind:'file',projects:[{id:'project',name:'项目甲',documents:[doc]}],conversations:[{id:'chat',title:'对话乙',documents:[doc]}]});
  assert.equal(results.length,2);assert.equal(results[0].projectId,'project');assert.equal(results[1].conversationId,'chat');assert.match(results[0].subtitle,/第 180 页/);assert.equal(results[1].source.sectionIndex,179);
});
test('changed/deleted source never guesses a location while unchanged exact match remains usable',()=>{
  const source=documentMatches(doc,'needle')[0],changed=structuredClone(doc);
  changed.sections[179].text='增加文字'+changed.sections[179].text;
  assert.equal(locateDocumentSource(source,[changed]),null);assert.equal(locateDocumentSource(source,[]),null);
  changed.sections[179]=structuredClone(doc.sections[179]);changed.sections[179].label='第 181 页';assert.equal(locateDocumentSource(source,[changed]),null);
});
test('file filter lists loaded files without a query and limits sections/results while match navigation stays bounded',()=>{
  const many={...doc,sections:Array.from({length:20},(_,i)=>({label:'段落 '+i,text:'needle '.repeat(200)}))};
  const projects=[{id:'project',name:'项目',documents:[many]}];
  assert.equal(searchWorkspace({projects,kind:'file',query:''}).length,1);
  assert.equal(searchWorkspace({projects,kind:'file',query:'needle'}).length,3);
  assert.equal(documentMatches(many,'needle').length,2000);
  assert.equal(searchWorkspace({projects,kind:'file',query:'needle',limit:2}).length,2);
  assert.equal(searchWorkspace({query:'needle',kind:'file'}).length,0);
});
