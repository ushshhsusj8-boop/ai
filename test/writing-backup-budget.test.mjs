import test from 'node:test';
import assert from 'node:assert/strict';
import {writingBackup,writingBackupDrafts,writingBackupByteLimit,validateWritingBackupSize} from '../public/writing_backups.js';
import {createWritingStore,WRITING_KEY} from '../public/writing_store.js';
import {withSiteLimits} from '../src/limit_context.mjs';
import {LEGACY_LIMITS,DEVELOPER_LIMITS} from '../public/site_limits.js';
const memory=()=>{const map=new Map();return{getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,String(value))};};

test('backup preflight follows current byte budgets, includes exact boundary and rejects invalid sizes',()=>{
 withSiteLimits(LEGACY_LIMITS,()=>{assert.equal(writingBackupByteLimit(),4*1024*1024);validateWritingBackupSize(4*1024*1024);assert.throws(()=>validateWritingBackupSize(4*1024*1024+1),/4 MiB/);});
 withSiteLimits(DEVELOPER_LIMITS,()=>{assert.equal(writingBackupByteLimit(),64*1024*1024);validateWritingBackupSize(4500250);assert.throws(()=>validateWritingBackupSize(64*1024*1024+1),/64 MiB/);});
 for(const size of [-1,NaN,Infinity,1.5,'10'])assert.throws(()=>validateWritingBackupSize(size),/大小无效/);
});

test('a legal exported library above 4 MiB restores complete Unicode notes with new IDs and skips duplicate contents',()=>{
 withSiteLimits(DEVELOPER_LIMITS,()=>{
  const source=createWritingStore(memory()),target=createWritingStore(memory());
  for(const[id,title,char]of[['qa-source-one','Synthetic one','文'],['qa-source-two','Synthetic two','稿']])source.save({id,revision:0,title,text:char.repeat(750000)});
  target.save({id:'qa-existing-note',revision:0,title:'Keep existing',text:'unchanged'});
  const exported=writingBackup(source.list()),bytes=new TextEncoder().encode(exported).length;assert.ok(bytes>4*1024*1024);validateWritingBackupSize(bytes);
  const incoming=writingBackupDrafts(exported);assert.equal(target.importDrafts(incoming),2);const after=target.list();
  assert.equal(after.length,3);assert.equal(after.find(n=>n.id==='qa-existing-note').text,'unchanged');
  for(const n of source.list()){const copy=after.find(p=>p.title===n.title);assert.equal(copy.text,n.text);assert.notEqual(copy.id,n.id);}
  assert.equal(target.importDrafts(incoming),0);assert.equal(target.list().length,3);
  withSiteLimits(LEGACY_LIMITS,()=>assert.throws(()=>writingBackupDrafts(exported),/当前导入预算.*4 MiB/));
 });
});

test('accepting a larger backup file does not bypass note text or total-storage budgets and failed imports are atomic',()=>{
 withSiteLimits({...DEVELOPER_LIMITS,writingBytes:2*1024*1024},()=>{
  const storage=memory(),target=createWritingStore(storage);target.save({id:'qa-original-note',revision:0,title:'Existing',text:'a'.repeat(1000000)});
  const before=storage.getItem(WRITING_KEY);
  const text=writingBackup([{title:'New one',text:'b'.repeat(600000)},{title:'New two',text:'c'.repeat(600000)}]);const drafts=writingBackupDrafts(text);
  assert.throws(()=>target.importDrafts(drafts),/文稿库已满/);assert.equal(storage.getItem(WRITING_KEY),before);
  assert.throws(()=>writingBackupDrafts(writingBackup([{title:'Too long',text:'d'.repeat(DEVELOPER_LIMITS.writingText+1)}])),/无效文稿/);assert.equal(storage.getItem(WRITING_KEY),before);
 });
});
