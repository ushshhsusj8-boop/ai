import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectDraftStore } from '../public/project_drafts.js';
function memory() {
  const data = new Map();
  return {get length() {return data.size;}, key: i => [...data.keys()][i] ?? null, getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,v), removeItem: k => data.delete(k)};
}
const draft = (name = '本机修改') => ({projectId: 'project-one', revision: 3, name, instructions: '尚未上传的指令', baselineName: '原项目', baselineInstructions: '原指令'});
test('project text drafts survive a new page and keep guest, accounts and simultaneous tabs separate', () => {
  const storage = memory();
  const a = createProjectDraftStore({userId: 'alice', storage, writerId: 'page-one'});
  const second = createProjectDraftStore({userId: 'alice', storage, writerId: 'page-two'});
  const b = createProjectDraftStore({userId: 'bob', storage, writerId: 'page-one'});
  const guest = createProjectDraftStore({storage, writerId: 'page-one'});
  const first = a.save(draft()); second.save(draft('另一页草稿')); b.save(draft('账户B')); guest.save(draft('访客'));
  assert.equal(a.list().length, 2); assert.equal(b.list().length, 1); assert.equal(guest.list().length, 1);
  assert.throws(() => b.read(first.key), /其他账户/); assert.throws(() => guest.remove(first.key), /其他账户/);
  const reload = createProjectDraftStore({userId: 'alice', storage, writerId: 'page-reloaded'});
  assert.equal(reload.read(first.key).instructions, '尚未上传的指令'); assert.equal(reload.read(first.key).revision, 3);
  assert.equal(reload.list().length, 2); assert.equal(a.read(first.key).name, '本机修改');
});
test('draft deletion checks the recovered version and never removes a newer edit from another page', () => {
  const storage = memory(), a = createProjectDraftStore({userId: 'alice', storage, writerId: 'page-one'});
  const original = a.save(draft()); a.save(draft('后来又修改'));
  assert.throws(() => a.remove(original.key, original.raw), /又被其他页面修改/);
  assert.equal(a.read(original.key).name, '后来又修改');
  const latest = a.read(original.key); a.remove(latest.key, latest.raw); assert.equal(a.list().length, 0);
});
test('full, invalid or unavailable draft storage retains existing drafts and does not report a successful save', () => {
  const storage = memory(), a = createProjectDraftStore({userId: 'alice', storage, writerId: 'page-one'});
  for (let i=0; i<64; i++) a.save({...draft(), projectId: `project-${i}`});
  assert.throws(() => a.save({...draft(), projectId: 'project-new'}), /64/); assert.equal(a.list().length, 64);
  a.save({...draft('仍可更新'), projectId: 'project-0'}); assert.equal(a.list().length, 64);
  assert.throws(() => a.save({...draft(), revision: -1}), /无效/);
  assert.throws(() => a.save({...draft(), projectId: undefined}), /无效/);
  const failed = createProjectDraftStore({storage: {getItem() {throw Error('blocked');}}, writerId: 'page-blocked'});
  assert.throws(() => failed.save(draft()), /blocked/); assert.equal(a.list().length, 64);
});
test('malformed records or an injected other owner are never offered as recoverable drafts', () => {
  const storage = memory(), a = createProjectDraftStore({userId: 'alice', storage, writerId: 'page-one'});
  const value = a.save(draft()); storage.setItem(value.key, '{broken'); assert.equal(a.list().length, 0);
  storage.setItem(value.key, JSON.stringify({...value, owner: 'bob'})); assert.equal(a.list().length, 0);
});
