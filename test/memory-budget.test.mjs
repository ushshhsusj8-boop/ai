import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {withSiteLimits} from '../src/limit_context.mjs';
import {DEVELOPER_LIMITS,LEGACY_LIMITS} from '../public/site_limits.js';
import {validateMemories,selectMemories,memoryContext,memoryBackup,parseMemoryBackup,planMemoryImport} from '../public/memory_tools.js';
import {createMemoryClient} from '../public/account_memory.js';
import {createAccountMemory} from '../src/account_memory.mjs';
const high=fn=>withSiteLimits(DEVELOPER_LIMITS,fn),low=fn=>withSiteLimits(LEGACY_LIMITS,fn);
const oldLibrary=()=>({enabled:true,entries:Array.from({length:42},(_,i)=>({id:'qa-memory-'+i,text:'合成偏好 '+i+' '+'测'.repeat(1200),enabled:i!==1,always:i!==2}))});
function fixture(t){const directory=mkdtempSync(join(tmpdir(),'plaude-memory-budget-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));const options={requireUser:id=>{if(!['qa-owner','qa-other'].includes(id))throw Error('Unknown synthetic account');}};return{directory,store:createAccountMemory(directory,options),reopen:()=>createAccountMemory(directory,options)};}

test('old over-budget memory can be selected and exported without expanding the current send budget or weakening import validation',()=>{
 const old=high(()=>validateMemories(oldLibrary())),raw=JSON.stringify(old);
 low(()=>{
  const selected=selectMemories(old,'合成偏好');assert.ok(selected.length>0&&selected.length<=LEGACY_LIMITS.memorySelected);assert.ok(memoryContext(selected).length<=LEGACY_LIMITS.memoryContext);
  assert.deepEqual(selectMemories({...old,enabled:false}),[]);assert.ok(!selected.some(e=>e.id==='qa-memory-1'));
  assert.deepEqual(JSON.parse(memoryBackup(old)).library,old);assert.equal(JSON.stringify(old),raw);
  assert.throws(()=>parseMemoryBackup(memoryBackup(old)));assert.throws(()=>planMemoryImport(old,{enabled:true,entries:[]}));
  assert.throws(()=>selectMemories({...old,entries:[...old.entries,old.entries[0]]}));
 });
});

test('version-checked over-budget memory only permits deletion or disabling without changing retained text or increasing exposure',t=>{
 const {store,reopen,directory}=fixture(t),saved=high(()=>store.put('qa-owner',{revision:0,library:oldLibrary()}));
 low(()=>{
  assert.throws(()=>store.resolve('qa-owner',{revision:1,ids:saved.library.entries.slice(3,12).map(e=>e.id)}));
  assert.throws(()=>store.resolve('qa-owner',{revision:1,ids:saved.library.entries.slice(3,7).map(e=>e.id)}),/长度预算/);
  assert.throws(()=>store.resolve('qa-owner',{revision:1,ids:['qa-memory-1']}),{statusCode:409});
  let next=structuredClone(saved.library);next.enabled=false;const off=store.put('qa-owner',{revision:1,library:next});assert.equal(off.revision,2);assert.deepEqual(off.library.entries,saved.library.entries);assert.throws(()=>store.resolve('qa-owner',{revision:2,ids:[]}),{statusCode:409});
  next=structuredClone(off.library);next.entries[0].enabled=false;const paused=store.put('qa-owner',{revision:2,library:next});assert.equal(paused.library.entries[0].enabled,false);
  next=structuredClone(paused.library);next.entries=next.entries.slice(1);const deleted=store.put('qa-owner',{revision:3,library:next});assert.equal(deleted.library.entries.length,41);assert.deepEqual(reopen().list('qa-owner'),deleted);
  const file=join(directory,'qa-owner.json'),raw=readFileSync(file);
  assert.ok(raw.length>128*1024);
  for(const change of [v=>{v.enabled=true;},v=>{v.entries[0].enabled=true;},v=>{v.entries[0].text+='edit';},v=>{v.entries[0].always=!v.entries[0].always;},v=>{v.entries[0].id='qa-memory-new';},v=>{v.entries[0].extra=true;},v=>{v.entries.push({...v.entries[0],id:'qa-memory-new'});}]){const attempt=structuredClone(deleted.library);change(attempt);assert.throws(()=>store.put('qa-owner',{revision:4,library:attempt}));assert.deepEqual(readFileSync(file),raw);}
  assert.throws(()=>store.put('qa-owner',{revision:3,library:{enabled:false,entries:[]}}),{statusCode:409});assert.throws(()=>store.put('qa-other',{revision:0,library:deleted.library}));assert.deepEqual(store.list('qa-other').library.entries,[]);
  const short={enabled:true,entries:[{id:'qa-short-memory',text:'当前预算内',enabled:true,always:true}]};assert.equal(store.put('qa-owner',{revision:4,library:short}).revision,5);assert.deepEqual(store.resolve('qa-owner',{revision:5,ids:['qa-short-memory']}).ids,['qa-short-memory']);
 });
});

test('memory client can prepare, pause and delete retained old entries while stale state and new over-budget edits remain rejected',async t=>{
 const {store}=fixture(t);high(()=>store.put('qa-owner',{revision:0,library:oldLibrary()}));let puts=0;
 const fetchImpl=async(_,o)=>{try{if(o.method==='PUT')puts++;return Response.json(o.method==='PUT'?store.put('qa-owner',JSON.parse(o.body)):store.list('qa-owner'));}catch(error){if(!error.statusCode)throw error;return Response.json({error:error.message},{status:error.statusCode});}};
 await low(async()=>{
  const a=createMemoryClient({userId:'qa-owner',fetchImpl}),b=createMemoryClient({userId:'qa-owner',fetchImpl});const prepared=await a.prepare('问题');assert.ok(prepared.chars<=LEGACY_LIMITS.memoryContext);assert.ok(prepared.entries.length<=LEGACY_LIMITS.memorySelected);await b.load();
  const paused=structuredClone(a.snapshot.library);paused.entries[0].enabled=false;await a.save(paused);assert.equal(store.list('qa-owner').library.entries[0].enabled,false);
  const modified=structuredClone(paused);modified.entries[2].text+='edit';await assert.rejects(a.save(modified));assert.equal(puts,1);
  const stale={...b.snapshot.library,enabled:false};await assert.rejects(b.save(stale),/其他设备/);assert.equal(b.snapshot.revision,1);
  await b.load();const next={...b.snapshot.library,enabled:false};await b.save(next);assert.deepEqual(await b.prepare('问题'),{entries:[],chars:0});
  next.entries=next.entries.slice(1);await b.save(next);assert.equal(store.list('qa-owner').library.entries.length,41);assert.equal((await a.load()).library.enabled,false);
 });
});
