import test from 'node:test';import assert from 'node:assert/strict';
import {branchOrigin,validateBranch,branchFamily,sharedMessagePrefix} from '../public/conversation_branches.js';
import {normalizeConversation} from '../src/shared_conversations.mjs';
import {createBackup,planImport} from '../public/backups.js';
const original={id:'root-conversation',title:'原版',provider:'deepseek',model:'deepseek-flash',updatedAt:100,instructions:'原要求',messages:[{role:'user',content:'问题'},{role:'assistant',content:'旧回答'}]};
test('nested branch ancestry stays anchored to original and family excludes unrelated supplied chats',()=>{
  const branch={...original,id:'child-conversation',branch:branchOrigin(original,1,'continue',100)},next={...original,id:'next-conversation',branch:branchOrigin(branch,0,'edit',101)};
  assert.equal(next.branch.rootId,original.id);assert.equal(next.branch.parentId,branch.id);assert.deepEqual(branchFamily([next,{...original,id:'unrelated-chat'},original,branch],next).map(c=>c.id),[original.id,branch.id,next.id]);assert.equal(branchFamily([],next).length,0);
});
test('invalid branch ids, self references, payload fields, kinds and positions reject at trusted boundaries',()=>{
  const valid=branchOrigin(original,1,'regenerate',100);for(const patch of [{parentId:undefined},{rootId:99},{parentId:'bad'},{kind:'script'},{messageIndex:-1},{messageIndex:10000},{createdAt:Date.now()+999999},{password:'x'}])assert.throws(()=>validateBranch({...valid,...patch},'child-conversation'));
  assert.throws(()=>validateBranch(valid,original.id));assert.equal(validateBranch(undefined),undefined);
});
test('private/shared normalization and JSON backup round trip preserve ancestry including unsent empty branch',()=>{
  const child={...original,id:'child-conversation',messages:[],branch:branchOrigin(original,0,'edit',100)};
  assert.deepEqual(normalizeConversation(child,100,{allowEmpty:true}).branch,child.branch);
  const store={getItem:key=>key==='yunjian-ai-conversations-v1'?JSON.stringify([original,child]):null};const plan=planImport(createBackup(store),{getItem:()=>null});assert.deepEqual(plan.conversations.find(c=>c.id===child.id).branch,child.branch);assert.deepEqual(plan.conversations.find(c=>c.id===child.id).messages,[]);
});
test('version comparison identifies divergent questions or attached images and handles one version ending at common prefix',()=>{
  const child=structuredClone(original);child.messages[1].content='新回答';assert.equal(sharedMessagePrefix(original,child),1);
  child.messages=original.messages.slice(0,1);assert.equal(sharedMessagePrefix(original,child),1);child.messages[0]={...child.messages[0],images:[{name:'different'}]};assert.equal(sharedMessagePrefix(original,child),0);
});
