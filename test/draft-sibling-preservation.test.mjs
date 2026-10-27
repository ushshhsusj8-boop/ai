import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeConversationDrafts} from '../public/conversation_tools.js';

test('interleaved edits and clearing one draft preserve the other tab latest sibling drafts',()=>{
 const initial=Object.freeze({third:'Original third draft'}),a=Object.freeze({...initial,first:'First tab draft'}),aSaved=mergeConversationDrafts(initial,initial,a);
 const b=Object.freeze({...initial,second:'Second tab draft'}),bSaved=mergeConversationDrafts(initial,aSaved,b);assert.deepEqual(bSaved,{third:'Original third draft',first:'First tab draft',second:'Second tab draft'});
 const aEdited={...aSaved,first:'Latest first draft'},latest=mergeConversationDrafts(aSaved,bSaved,aEdited);assert.equal(latest.second,'Second tab draft');
 const cleared={...bSaved};delete cleared.second;assert.deepEqual(mergeConversationDrafts(bSaved,latest,cleared),{third:'Original third draft',first:'Latest first draft'});
 assert.deepEqual(initial,{third:'Original third draft'});assert.deepEqual(b,{third:'Original third draft',second:'Second tab draft'});
});

test('an unchanged stale page neither overwrites a newer draft nor resurrects one removed elsewhere',()=>{
 const baseline={first:'Old draft'},current={first:'Newer draft',second:'Sibling'};
 assert.deepEqual(mergeConversationDrafts(baseline,current,{...baseline}),current);
 assert.deepEqual(mergeConversationDrafts(baseline,{second:'Sibling'},{...baseline}),{second:'Sibling'});
 assert.deepEqual(mergeConversationDrafts(baseline,{second:'Sibling'},{first:'Explicit new edit'}),{second:'Sibling',first:'Explicit new edit'});
});

test('draft keys resembling prototype properties remain ordinary own entries across merges and deletions',()=>{
 const baseline=Object.fromEntries([['__proto__','Original proto draft'],['constructor','Original constructor draft']]);
 const current=Object.fromEntries([['__proto__','Newer proto draft'],['constructor','Original constructor draft'],['toString','Sibling draft']]);
 const edited=Object.fromEntries([['__proto__','Original proto draft']]);
 const result=mergeConversationDrafts(baseline,current,edited);
 assert.equal(Object.hasOwn(result,'__proto__'),true);assert.equal(result.__proto__,'Newer proto draft');assert.equal(Object.hasOwn(result,'constructor'),false);assert.equal(result.toString,'Sibling draft');assert.equal(Object.getPrototypeOf(result),Object.prototype);
});

test('a stale tab cannot bypass the draft count budget or evict saved siblings, while old over-budget edits and removal remain allowed',()=>{
 const baseline={first:'One'},current={first:'One',second:'Two'},edited={first:'One',third:'Three'},before=structuredClone(current);
 assert.throws(()=>mergeConversationDrafts(baseline,current,edited,2),e=>e.code==='DRAFT_COUNT');assert.deepEqual(current,before);
 const old={first:'One',second:'Two',third:'Three'};assert.equal(Object.keys(mergeConversationDrafts(old,old,{...old,first:'Edited'},2)).length,3);
 assert.deepEqual(mergeConversationDrafts(old,old,{first:'One',second:'Two'},2),{first:'One',second:'Two'});
 assert.deepEqual(mergeConversationDrafts(current,current,{first:'One',third:'Three'},2),{first:'One',third:'Three'});
});
