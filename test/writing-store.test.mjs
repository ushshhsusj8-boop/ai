import test from 'node:test';
import assert from 'node:assert/strict';
import {createWritingStore} from '../public/writing_store.js';
function memory(){const data=new Map();return{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};}
const note=(id='writing-one',text='初稿')=>({id,title:'测试文稿',text,revision:0});
test('writing drafts persist across reload without modifying the source conversation',()=>{
  const storage=memory(),store=createWritingStore(storage),source={content:'# 原回复'};
  const saved=store.save(note('writing-one',source.content));store.save({...saved,text:'修改稿'});
  assert.equal(createWritingStore(storage).list()[0].text,'修改稿');assert.equal(source.content,'# 原回复');
});
test('simultaneous writing edits and stale deletion are rejected; a new copy preserves both versions',()=>{
  const storage=memory(),one=createWritingStore(storage),two=createWritingStore(storage);
  const old=one.save(note());two.save({...old,text:'另一页稿件'});
  assert.throws(()=>one.save({...old,text:'本页稿件'}),/其他页面/);assert.throws(()=>one.remove(old.id,old.revision),/未删除/);
  one.save(note('writing-copy','本页稿件'));assert.equal(one.list().length,2);assert.ok(one.list().some(n=>n.text==='另一页稿件'));
  const latest=one.list().find(n=>n.id===old.id);one.remove(latest.id,latest.revision);assert.throws(()=>one.save(old),/删除/);
});
test('full writing storage retains previous notes on count, byte or browser-write failure',()=>{
  const storage=memory(),store=createWritingStore(storage);
  for(let i=0;i<50;i++)store.save(note('writing-'+i));const before=storage.getItem('plaude-writing-desk-v1');
  assert.throws(()=>store.save(note('writing-extra')),/50/);assert.equal(storage.getItem('plaude-writing-desk-v1'),before);
  const big=createWritingStore(memory());big.save(note('writing-big-one','字'.repeat(256000)));big.save(note('writing-big-two','字'.repeat(256000)));
  assert.throws(()=>big.save(note('writing-big-three','字'.repeat(256000))),/2 MiB/);assert.equal(big.list().length,2);
  const blocked=createWritingStore({getItem:()=>null,setItem(){throw Error('Storage blocked');}});assert.throws(()=>blocked.save(note()),/blocked/);
});
test('invalid or corrupt writing records are preserved and cannot be overwritten by a new save',()=>{
  const storage=memory();storage.setItem('plaude-writing-desk-v1','{broken');const store=createWritingStore(storage);
  assert.throws(()=>store.save(note()));assert.equal(storage.getItem('plaude-writing-desk-v1'),'{broken');
  const fresh=createWritingStore(memory());assert.throws(()=>fresh.save({...note(),title:''}),/无效/);assert.throws(()=>fresh.save({...note(),text:'x'.repeat(256001)}),/无效/);
});
