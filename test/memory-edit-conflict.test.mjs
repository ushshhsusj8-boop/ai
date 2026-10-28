import test from 'node:test';
import assert from 'node:assert/strict';
import {planMemoryEdit} from '../public/memory_tools.js';
const entry = (id, text, extra = {}) => ({id, text, enabled:true, always:true, ...extra});
const original = () => ({enabled:true,entries:[entry('memory-first','原偏好'),entry('memory-second','兄弟偏好')]});

test('a stale memory editor cannot overwrite a newer text or priority after its library refreshes', () => {
  const baseline=original().entries[0];
  for(const updated of [{text:'另一设备的新偏好'},{always:false}]) {
    const remote=original();Object.assign(remote.entries[0],updated);const before=structuredClone(remote);
    assert.throws(()=>planMemoryEdit(remote,{id:baseline.id,text:'本页未保存草稿',always:true},baseline),/已更新/);
    assert.deepEqual(remote,before);
  }
});
test('saving a reviewed memory merges sibling changes and preserves newer privacy switches', () => {
  const baseline=original().entries[0], remote=original();remote.enabled=false;
  remote.entries[0].enabled=false;remote.entries[1].text='另一设备更新的兄弟偏好';const before=structuredClone(remote);
  const saved=planMemoryEdit(remote,{id:baseline.id,text:'本页核对过的文字',always:false},baseline);
  assert.equal(saved.enabled,false);assert.equal(saved.entries[0].enabled,false);
  assert.equal(saved.entries[0].text,'本页核对过的文字');assert.equal(saved.entries[0].always,false);
  assert.deepEqual(saved.entries[1],remote.entries[1]);assert.deepEqual(remote,before);
});
test('a deleted memory is not resurrected and edits require the matching captured baseline', () => {
  const remote=original(),baseline=remote.entries.shift(),before=structuredClone(remote);
  assert.throws(()=>planMemoryEdit(remote,{id:baseline.id,text:'未保存',always:true},baseline),/已不存在/);
  assert.deepEqual(remote,before);
  for(const bad of [null,{...baseline,id:'memory-incorrect'}])assert.throws(()=>planMemoryEdit(original(),{id:baseline.id,text:'未保存',always:true},bad),/已更新/);
});
test('explicitly reselecting the latest memory or adding a new entry keeps existing records intact', () => {
  const remote=original();remote.entries[0].text='最新偏好';
  const saved=planMemoryEdit(remote,{id:'memory-first',text:'核对最新内容后保存',always:true},structuredClone(remote.entries[0]));
  assert.equal(saved.entries[0].text,'核对最新内容后保存');assert.deepEqual(saved.entries[1],remote.entries[1]);
  const added=planMemoryEdit(remote,{text:'新增偏好',always:false},null,()=> 'memory-new-one');
  assert.equal(added.entries.length,3);assert.deepEqual(added.entries.slice(0,2),remote.entries);
  assert.equal(added.entries[2].enabled,true);assert.equal(added.entries[2].id,'memory-new-one');
});
