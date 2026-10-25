import assert from 'node:assert/strict';
import {test} from 'node:test';
import {initVisionComposer} from '../public/vision_composer.js';
import {validateImages} from '../public/image_attachments.js';
import {applyClientLimits,DEVELOPER_LIMITS,LEGACY_LIMITS} from '../public/site_limits.js';
import {configureStorageScope,scopedStorage} from '../public/scoped_storage.js';

const pixel={name:'synthetic-pixel.png',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMQW+z1HwAD2QID/iGHgwAAAABJRU5ErkJggg=='};
const key='yunjian-ai-image-drafts-v1';
function setup(raw){
  const values=new Map(),notices=[],nodes=[];
  globalThis.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)};
  const node=tag=>{const value={tagName:tag,children:[],value:'',setAttribute(){},append(...n){this.children.push(...n);},replaceChildren(...n){this.children=n;},before(){},remove(){},click(){this.onclick?.();},querySelector(){return node('button');},showModal(){},close(){}};nodes.push(value);return value;};
  globalThis.document={createElement:node,body:node('body'),querySelector:()=>node('textarea')};
  configureStorageScope('qa-image-owner');scopedStorage.setItem(key,raw);
  let context='old-image-chat';
  const composer=initVisionComposer({context:()=>context,busy:()=>false,supported:()=>true,changed(){},toast:m=>notices.push(m)});
  return {composer,notices,node:id=>nodes.find(n=>n.id===id),select:id=>context=id,raw:()=>scopedStorage.getItem(key)};
}
function legacyImages(count=5){
  applyClientLimits(DEVELOPER_LIMITS);
  const list=validateImages(Array.from({length:count},(_,i)=>({...pixel,name:'synthetic-'+i+'.png'})));
  applyClientLimits(LEGACY_LIMITS);return list;
}
test.afterEach(()=>{applyClientLimits(LEGACY_LIMITS);configureStorageScope(null);delete globalThis.document;delete globalThis.localStorage;delete globalThis.confirm;});
test('lower image count budgets retain every stored draft when another chat adds a new image',()=>{
  const old=legacyImages(),sibling=validateImages([pixel]),raw=JSON.stringify({'old-image-chat':old,constructor:sibling});
  const view=setup(raw);
  assert.deepEqual(view.composer.images(),old);
  assert.equal(view.raw(),raw);
  view.select('new-image-chat');assert.equal(view.composer.setImages([pixel]),true);
  const stored=JSON.parse(view.raw());assert.deepEqual(stored['old-image-chat'],old);assert.deepEqual(stored.constructor,sibling);
});
test('old over-budget images can be removed one at a time, while new edits still use current budgets',()=>{
  const old=legacyImages(),raw=JSON.stringify({'old-image-chat':old,other:validateImages([pixel])}),view=setup(raw);
  assert.equal(view.composer.setImages(old.slice(1)),true);
  assert.deepEqual(view.composer.images(),old.slice(1));
  const saved=view.raw();
  assert.equal(view.composer.setImages([...old.slice(1),old[0]]),false);assert.equal(view.raw(),saved);
  assert.equal(view.composer.setImages(old.slice(1).map((i,n)=>n?i:{...i,name:'edited.png'})),false);assert.equal(view.raw(),saved);
  assert.equal(view.composer.setImages(old.slice(2)),true);assert.equal(view.composer.images().length,3);
  assert.equal(view.composer.setImages([]),true);assert.equal(JSON.parse(view.raw()).other.length,1);
});
test('unreadable image draft storage is preserved instead of being overwritten by the next add',()=>{
  const raw='{"old-image-chat": [broken synthetic backup',view=setup(raw);
  assert.equal(view.composer.setImages([pixel]),false);
  assert.equal(view.raw(),raw);assert.ok(view.notices.some(m=>/未覆盖|未保存/.test(m)));
});

test('lowered image edge budgets allow exact removals without relaxing new image or send validation',()=>{
  applyClientLimits(DEVELOPER_LIMITS);
  const wide={name:'synthetic-wide.png',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAB9AAAAABCAYAAACG/TV9AAAAJElEQVR4nO3DAQ0AAAgDIFMYypoPqkGEjerMqqqqqqqqqur3BylssIJL4dsKAAAAAElFTkSuQmCC'};
  const old=validateImages([wide,wide]);applyClientLimits(LEGACY_LIMITS);
  const view=setup(JSON.stringify({'old-image-chat':old}));
  assert.equal(view.composer.setImages(old.slice(1)),true);
  assert.deepEqual(view.composer.images(),old.slice(1));
  assert.throws(()=>validateImages(view.composer.images()),/尺寸/);
  const saved=view.raw();assert.equal(view.composer.setImages([{...old[0],name:'edited.png'}]),false);assert.equal(view.raw(),saved);
});
test('unreadable cache cleanup requires confirmation, unchanged bytes and the original account',()=>{
  const broken='broken synthetic image draft',view=setup(broken),clear=view.node('image-draft-clear');
  globalThis.confirm=()=>false;clear.click();assert.equal(view.raw(),broken);
  globalThis.confirm=()=>{scopedStorage.setItem(key,'new data from another tab');return true;};
  clear.click();assert.equal(view.raw(),'new data from another tab');
  scopedStorage.setItem(key,broken);configureStorageScope('qa-other-owner');scopedStorage.setItem(key,'other account image draft');
  assert.equal(view.composer.setImages([pixel]),false);clear.click();assert.equal(view.raw(),'other account image draft');
  configureStorageScope('qa-image-owner');assert.equal(view.raw(),broken);
  globalThis.confirm=()=>true;clear.click();assert.equal(view.raw(),null);
  assert.equal(view.composer.setImages([pixel]),true);
});
