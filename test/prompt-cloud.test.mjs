import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPromptCloud} from '../src/prompt_cloud.mjs';
import {createBackup,planImport,applyImport} from '../public/backups.js';
import {createPromptSync,PROMPT_CLOUD_KEY} from '../public/prompt_sync.js';
import {createPrompt,savePromptLibrary,loadPromptLibrary} from '../public/prompt_library.js';
const memory=()=>{const map=new Map();return{getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};};
const prompt=(content='构造初稿',id='qa-prompt-0001')=>createPrompt([],{title:'测试提示词',content},{id,now:100});
function fixture(t){
  const dir=mkdtempSync(join(tmpdir(),'prompt-cloud-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const store=createPromptCloud(dir,{requireUser:id=>{if(!['qa-owner','qa-other'].includes(id))throw Error('invalid user');}});
  let offline=false,lose=false;
  const fetchImpl=async(path,options)=>{
    if(offline)throw Error('offline');assert.equal(path,'/api/account/prompt-library');
    const id=options.headers['x-plaude-account-id'];
    try{const value=options.method==='PUT'?store.put(id,JSON.parse(options.body)):store.list(id);if(lose&&options.method==='PUT'){lose=false;throw Error('lost acknowledgement');}return{ok:true,status:200,json:async()=>value};}
    catch(error){if(!error.statusCode)throw error;return{ok:false,status:error.statusCode,json:async()=>({error:error.message})};}
  };
  const device=(storage=memory())=>createPromptSync({userId:'qa-owner',storage,fetchImpl});
  return{store,reopen:()=>createPromptCloud(dir,{requireUser:()=>{}}),device,fetchImpl,set offline(v){offline=v;},set lose(v){lose=v;}};
}
test('private library persists across store restart; limits, ownership and stale updates/deletions are atomic',t=>{
  const api=fixture(t);const first=api.store.put('qa-owner',{revision:0,prompts:prompt()});assert.equal(first.revision,1);assert.deepEqual(api.reopen().list('qa-owner').prompts,first.prompts);
  assert.deepEqual(api.store.list('qa-other').prompts,[]);
  assert.throws(()=>api.store.put('qa-owner',{revision:0,prompts:[]}),{statusCode:409});
  assert.throws(()=>api.store.put('qa-owner',{revision:1,prompts:Array(31).fill(prompt()[0])}));
  assert.throws(()=>api.store.put('qa-owner',{revision:1,prompts:[],userId:'qa-other'}));
  assert.throws(()=>api.store.list('../escape'));
  assert.equal(api.store.list('qa-owner').revision,1);
  api.store.put('qa-owner',{revision:1,prompts:[]});assert.throws(()=>api.store.put('qa-owner',{revision:1,prompts:prompt()}),{statusCode:409});
});
test('two devices read, update and delete without resurrecting a deleted library',async t=>{
  const api=fixture(t),a=api.device(),b=api.device();a.save(prompt(),[]);await a.sync();await b.sync();assert.equal(b.list()[0].content,'构造初稿');
  b.save([],b.list());await b.sync();await a.sync();assert.deepEqual(a.list(),[]);assert.equal(api.store.list('qa-owner').revision,2);
});
test('concurrent changes and deletion conflicts preserve both versions until explicit copy merge',async t=>{
  const api=fixture(t),a=api.device(),b=api.device();a.save(prompt(),[]);await a.sync();await b.sync();
  a.save(prompt('A云端新版'),a.list());await a.sync();b.save(prompt('B离线新版'),b.list());assert.equal((await b.sync()).conflict,true);
  assert.equal(api.store.list('qa-owner').prompts[0].content,'A云端新版');assert.equal(b.list()[0].content,'B离线新版');
  assert.equal(await b.resolve('merge',()=>false),false);assert.equal(await b.resolve('merge',()=>true),true);
  assert.deepEqual(new Set(api.store.list('qa-owner').prompts.map(p=>p.content)),new Set(['A云端新版','B离线新版']));
  await a.sync();const stale=b.list();a.save([],a.list());await a.sync();b.save(stale.map(p=>({...p,content:'删除后修改'})),stale);
  assert.equal((await b.sync()).conflict,true);assert.deepEqual(api.store.list('qa-owner').prompts,[]);await b.resolve('merge',()=>true);
  assert.ok(api.store.list('qa-owner').prompts.every(p=>!stale.some(old=>old.id===p.id)));
});
test('offline edits survive reload and lost PUT acknowledgement reconciles exact content',async t=>{
  const api=fixture(t),storage=memory(),a=api.device(storage);api.offline=true;a.save(prompt(),[]);assert.match((await a.sync()).error,/offline/);
  const restored=api.device(storage);assert.equal(restored.list()[0].content,'构造初稿');api.offline=false;api.lose=true;assert.match((await restored.sync()).error,/lost/);
  assert.equal((await restored.sync()).error,'');assert.equal(api.store.list('qa-owner').revision,1);
});
test('legacy library never uploads without explicit migration, remains recoverable after reading cloud',async t=>{
  const api=fixture(t),storage=memory();savePromptLibrary(storage,prompt('旧本机库'));api.store.put('qa-owner',{revision:0,prompts:prompt('云端库')});
  const a=api.device(storage);await a.sync();assert.equal(a.list()[0].content,'旧本机库');assert.equal(api.store.list('qa-owner').revision,1);
  assert.equal(await a.resolve('cloud',()=>true),true);assert.equal(a.list()[0].content,'云端库');assert.equal(a.report().legacyAvailable,true);
  await a.resolve('legacy',()=>true);assert.equal(a.list().length,2);assert.equal(a.report().legacyAvailable,false);assert.equal(loadPromptLibrary(storage)[0].content,'旧本机库');
});
test('capacity, another tab and corrupt storage refuse destructive saves or merge',async t=>{
  const api=fixture(t),storage=memory(),a=api.device(storage),b=api.device(storage);a.save(prompt(),[]);assert.throws(()=>b.save(prompt('stale'),[]),/其他窗口/);
  await a.sync();const full=Array.from({length:30},(_,i)=>prompt('remote '+i,'remote-'+i)[0]);api.store.put('qa-owner',{revision:1,prompts:full});a.save(prompt('local differs'),a.list());await a.sync();const before=storage.getItem(PROMPT_CLOUD_KEY);
  assert.equal(await a.resolve('merge',()=>true),false);assert.equal(storage.getItem(PROMPT_CLOUD_KEY),before);assert.equal(api.store.list('qa-owner').prompts.length,30);
  storage.setItem(PROMPT_CLOUD_KEY,'{bad');assert.throws(()=>api.device(storage));assert.equal(storage.getItem(PROMPT_CLOUD_KEY),'{bad');
});
test('unsaved editor, identity mismatch and complete-response timeout preserve local contents',async t=>{
  const api=fixture(t),storage=memory();let busy=true;const a=createPromptSync({userId:'qa-owner',storage,fetchImpl:api.fetchImpl,busy:()=>busy});
  api.store.put('qa-owner',{revision:0,prompts:prompt()});await a.sync();assert.deepEqual(a.list(),[]);busy=false;await a.sync();assert.equal(a.list().length,1);
  const wrong=createPromptSync({userId:'qa-owner',storage,fetchImpl:async()=>({ok:true,status:200,json:async()=>({userId:'qa-other',revision:99,prompts:[]})})});assert.match((await wrong.sync()).error,/身份/);assert.equal(a.list().length,1);
  const timeout=createPromptSync({userId:'qa-owner',storage,requestTimeoutMs:10,fetchImpl:async(_,o)=>({ok:true,json:()=>new Promise((_,reject)=>o.signal.addEventListener('abort',()=>reject(Error('aborted'))))})});assert.match((await timeout.sync()).error,/超时/);assert.equal(a.list().length,1);
});

test('whole workspace backup includes active cloud cache and import preserves baseline and legacy original',async t=>{
  const api=fixture(t),storage=memory(),a=api.device(storage);a.save(prompt(),[]);await a.sync();savePromptLibrary(storage,prompt('原旧库','legacy-qa'));
  const backup=createBackup(storage);assert.equal(JSON.parse(backup).prompts[0].content,'构造初稿');
  const incoming=JSON.parse(backup);incoming.prompts=prompt('导入新提示词','incoming-qa');const plan=planImport(JSON.stringify(incoming),storage);applyImport(plan,storage);
  assert.equal(a.list().length,2);assert.equal(loadPromptLibrary(storage)[0].content,'原旧库');await a.sync();assert.equal(api.store.list('qa-owner').prompts.length,2);
});

test('saving while upload is in flight queues latest text and stale import preview refuses overwrite',async t=>{
  const api=fixture(t),storage=memory();let release,entered;
  const gate=new Promise(r=>entered=r);let first=true;
  const a=createPromptSync({userId:'qa-owner',storage,fetchImpl:async(path,o)=>{
    if(o.method==='PUT'&&first){first=false;entered();await new Promise(r=>release=r);}return api.fetchImpl(path,o);
  }});
  a.save(prompt('first'),[]);const pending=a.sync();await gate;a.save(prompt('latest'),a.list());release();await pending;
  assert.equal(api.store.list('qa-owner').prompts[0].content,'latest');
  const plan=planImport(createBackup(storage),storage);a.save(prompt('after preview'),a.list());assert.throws(()=>applyImport(plan,storage),/重新预览/);assert.equal(a.list()[0].content,'after preview');await a.sync();
});
