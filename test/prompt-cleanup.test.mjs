import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {withSiteLimits} from '../src/limit_context.mjs';
import {DEVELOPER_LIMITS,LEGACY_LIMITS} from '../public/site_limits.js';
import {createPromptCloud} from '../src/prompt_cloud.mjs';
import {createPromptSync} from '../public/prompt_sync.js';
import {savePromptLibrary,loadPromptLibrary,deletePrompt,orderPrompts,searchPrompts,exportPromptLibrary,planPromptImport} from '../public/prompt_library.js';
const memory=()=>{const data=new Map();return{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v))};};
const prompts=(n=34)=>Array.from({length:n},(_,i)=>({id:'qa-prompt-'+i,title:'合成提示词 '+i,content:'测'.repeat(12000)+i,createdAt:i,updatedAt:i}));
const high=fn=>withSiteLimits(DEVELOPER_LIMITS,fn),low=fn=>withSiteLimits(LEGACY_LIMITS,fn);
function fixture(t){const directory=mkdtempSync(join(tmpdir(),'plaude-prompt-cleanup-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));const requireUser=id=>{if(!['qa-owner','qa-other'].includes(id))throw Error('Unknown synthetic account');};return{directory,store:createPromptCloud(directory,{requireUser}),reopen:()=>createPromptCloud(directory,{requireUser})};}

test('lowered quotas keep old prompt browsing, export and explicit local deletion usable without admitting edits or imports',()=>{
 const storage=memory(),old=high(()=>savePromptLibrary(storage,prompts()));
 low(()=>{
  assert.equal(loadPromptLibrary(storage).length,34);
  assert.equal(orderPrompts(old).length,34);assert.equal(searchPrompts(old,'合成提示词 33')[0].id,'qa-prompt-33');
  assert.deepEqual(JSON.parse(exportPromptLibrary(old)).prompts,old);
  const next=deletePrompt(old,'qa-prompt-0');assert.equal(next.length,33);assert.equal(old.length,34);
  assert.deepEqual(savePromptLibrary(storage,next),next);assert.deepEqual(loadPromptLibrary(storage),next);
  const raw=storage.getItem('yunjian-ai-prompt-library-v1');
  for(const forged of [next.map((p,i)=>i? p:{...p,content:p.content+'edit'}),[...next,{...next[0],id:'new-prompt'}],next.slice(1).map((p,i)=>i?p:{...p,updatedAt:p.updatedAt+1})])assert.throws(()=>savePromptLibrary(storage,forged));
  assert.throws(()=>planPromptImport(exportPromptLibrary(old),next));assert.equal(storage.getItem('yunjian-ai-prompt-library-v1'),raw);
  assert.throws(()=>deletePrompt([...next,next[0]],next[0].id));assert.deepEqual(loadPromptLibrary(storage),next);
 });
});

test('cloud deletion above a lowered count/text/byte budget is an exact subset with account, revision and hard validation intact',t=>{
 const {store,reopen,directory}=fixture(t),old=high(()=>store.put('qa-owner',{revision:0,prompts:prompts()}));
 low(()=>{
  const next=old.prompts.slice(1);assert.ok(Buffer.byteLength(JSON.stringify(next))>LEGACY_LIMITS.promptLibraryBytes);
  const removed=store.put('qa-owner',{revision:1,prompts:next});assert.equal(removed.revision,2);assert.deepEqual(reopen().list('qa-owner').prompts,next);
  const file=join(directory,'qa-owner.json'),raw=readFileSync(file);
  assert.throws(()=>store.put('qa-owner',{revision:1,prompts:next.slice(1)}),{statusCode:409});
  const attacks=[next.slice(1).map((p,i)=>i?p:{...p,title:'changed'}),next.slice(1).map((p,i)=>i?p:{...p,id:'new-prompt'}),next.slice(1).map((p,i)=>i?p:{...p,updatedAt:p.updatedAt+1}),[...next,next[0]],next.slice(1).map((p,i)=>i?p:{...p,content:'x'.repeat(64001)}),next.slice(1).map((p,i)=>i?p:{...p,extra:true})];
  for(const value of attacks){assert.throws(()=>store.put('qa-owner',{revision:2,prompts:value}));assert.deepEqual(readFileSync(file),raw);}
  assert.throws(()=>store.put('qa-other',{revision:0,prompts:next}));assert.deepEqual(store.list('qa-other').prompts,[]);
  assert.throws(()=>store.put('../escape',{revision:0,prompts:[]}));
  assert.deepEqual(store.put('qa-owner',{revision:2,prompts:[]}).prompts,[]);
  assert.equal(store.put('qa-owner',{revision:3,prompts:[{...old.prompts[0],content:'within current quota'}]}).revision,4);
 });
});

test('two devices converge on explicit over-budget prompt deletions after lost acknowledgement and reject stale local saves',async t=>{
 const {store}=fixture(t);high(()=>store.put('qa-owner',{revision:0,prompts:prompts()}));let lose=true;
 const fetchImpl=async(_,o)=>{try{const result=o.method==='PUT'?store.put('qa-owner',JSON.parse(o.body)):store.list('qa-owner');if(o.method==='PUT'&&lose){lose=false;throw Error('lost acknowledgement');}return{ok:true,status:200,json:async()=>result};}catch(error){if(!error.statusCode)throw error;return{ok:false,status:error.statusCode,json:async()=>({error:error.message})};}};
 await low(async()=>{
  const storage=memory(),a=createPromptSync({userId:'qa-owner',storage,fetchImpl}),b=createPromptSync({userId:'qa-owner',storage:memory(),fetchImpl});await a.sync();await b.sync();
  const before=a.list(),next=deletePrompt(before,before[0].id);a.save(next,before);assert.match((await a.sync()).error,/lost/);assert.equal(store.list('qa-owner').prompts.length,33);
  assert.equal((await a.sync()).error,'');await b.sync();assert.deepEqual(b.list(),next);
  const reloaded=createPromptSync({userId:'qa-owner',storage,fetchImpl});assert.deepEqual(reloaded.list(),next);
  assert.throws(()=>reloaded.save(next.slice(1),before),/其他窗口/);assert.deepEqual(reloaded.list(),next);
  reloaded.save(next.slice(1),next);assert.equal((await reloaded.sync()).error,'');await b.sync();assert.equal(b.list().length,32);
 });
});
