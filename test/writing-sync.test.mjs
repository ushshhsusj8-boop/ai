import test from 'node:test';
import assert from 'node:assert/strict';
import {createWritingStore,WRITING_KEY} from '../public/writing_store.js';
import {createWritingSync} from '../public/writing_sync.js';
import {writingBackup,writingBackupDrafts} from '../public/writing_backups.js';
const memory=()=>{const data=new Map();return{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};};
function server(){const records=new Map();let requests=0,offline=false;return{records,get requests(){return requests;},set offline(v){offline=v;},async fetch(path,options){requests++;if(offline)throw Error('offline');assert.equal(options.headers['x-plaude-account-id'],'qa-owner');const id=path.split('/').at(-1),method=options.method||'GET',body=options.body&&JSON.parse(options.body);let status=200,value;
  if(method==='GET')value={userId:'qa-owner',notes:[...records.values()].filter(n=>!n.deleted),deleted:[...records.values()].filter(n=>n.deleted)};
  else{const previous=records.get(id);if(method==='PUT'){if(previous?previous.deleted||previous.revision!==body.revision:body.revision!==0)status=409;else{const note={...body.note,revision:(previous?.revision||0)+1,updatedAt:Date.now()};records.set(id,note);value={userId:'qa-owner',note};}}
    else if(!previous||previous.deleted)status=404;else if(previous.revision!==body.revision)status=409;else{const record={id,revision:previous.revision+1,updatedAt:Date.now(),deleted:true};records.set(id,record);value={userId:'qa-owner',...record};}}
  return{ok:status===200,status,json:async()=>value||{error:'conflict'}};
}};}
const draft=(id='writing-sync-0001',text='第一稿')=>({id,title:'同步文稿',text,revision:0});
function device(api){const storage=memory(),store=createWritingStore(storage);const sync=createWritingSync({userId:'qa-owner',store,storage,fetchImpl:api.fetch});return{store,sync,storage};}
test('writing sync uploads confirmed content, reads on another device and propagates deletions without resurrection',async()=>{
  const api=server(),a=device(api),b=device(api);a.store.save(draft());assert.equal((await a.sync.sync()).synced,true);assert.equal((await b.sync.sync()).synced,true);assert.equal(b.store.list()[0].text,'第一稿');
  const n=b.store.list()[0];b.store.remove(n.id,n.revision);await b.sync.sync();await a.sync.sync();assert.deepEqual(a.store.list(),[]);assert.equal(api.records.get(n.id).deleted,true);
});
test('writing conflicts preserve local and remote content; explicit resolution saves a separate copy',async()=>{
  const api=server(),a=device(api),b=device(api);a.store.save(draft());await a.sync.sync();await b.sync.sync();
  a.store.save({...a.store.list()[0],text:'设备A新版'});await a.sync.sync();b.store.save({...b.store.list()[0],text:'设备B新版'});
  const result=await b.sync.sync();assert.equal(result.conflicts,1);assert.equal(result.synced,false);assert.equal(b.store.list()[0].text,'设备B新版');assert.equal(api.records.get('writing-sync-0001').text,'设备A新版');
  assert.equal(await b.sync.resolve(()=>false),false);assert.equal(b.store.list().length,1);
  assert.equal(await b.sync.resolve(()=>true),true);assert.deepEqual(new Set(b.store.list().map(n=>n.text)),new Set(['设备A新版','设备B新版']));assert.equal((await a.sync.sync()).synced,true);assert.equal(a.store.list().length,2);
});
test('offline changes remain local and sync later; a lost PUT acknowledgement reconciles by exact content',async()=>{
  const api=server(),a=device(api);api.offline=true;a.store.save(draft());assert.equal((await a.sync.sync()).synced,false);assert.equal(a.store.list()[0].text,'第一稿');api.offline=false;assert.equal((await a.sync.sync()).synced,true);
  const old=a.storage.getItem('plaude-writing-sync-v1');a.store.save({...a.store.list()[0],text:'确认丢失稿'});await a.sync.sync();a.storage.setItem('plaude-writing-sync-v1',old);
  const restarted=createWritingSync({userId:'qa-owner',store:a.store,storage:a.storage,fetchImpl:api.fetch});assert.equal((await restarted.sync()).synced,true);assert.equal(api.records.size,1);
});
test('cloud deletion versus local edit becomes a copy; active unsaved editors are never replaced',async()=>{
  const api=server(),a=device(api),b=device(api);a.store.save(draft());await a.sync.sync();await b.sync.sync();a.store.remove(a.store.list()[0].id,1);await a.sync.sync();b.store.save({...b.store.list()[0],text:'仍需保留'});assert.equal((await b.sync.sync()).conflicts,1);await b.sync.resolve(()=>true);assert.equal(b.store.list()[0].text,'仍需保留');assert.notEqual(b.store.list()[0].id,'writing-sync-0001');
  const local=b.store.list()[0],sync=createWritingSync({userId:'qa-owner',store:b.store,storage:b.storage,fetchImpl:api.fetch,busy:id=>id===local.id});api.records.set(local.id,{...api.records.get(local.id),text:'远端改稿',revision:5});await sync.sync();assert.equal(b.store.list()[0].text,'仍需保留');
});
test('wrong identity, timed out responses and corrupt local libraries never claim successful sync',async()=>{
  const storage=memory(),store=createWritingStore(storage);store.save(draft());
  const wrong=createWritingSync({userId:'qa-owner',store,storage,fetchImpl:async()=>({ok:true,json:async()=>({userId:'another-owner',notes:[],deleted:[]})})});assert.equal((await wrong.sync()).synced,false);assert.equal(store.list()[0].text,'第一稿');
  const timeout=createWritingSync({userId:'qa-owner',store,storage,requestTimeoutMs:10,fetchImpl:async(path,options)=>({ok:true,json:()=>new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted'))))})});assert.match((await timeout.sync()).error,/超时/);
  storage.setItem(WRITING_KEY,'{broken');assert.equal((await wrong.sync()).synced,false);assert.equal(storage.getItem(WRITING_KEY),'{broken');
});
test('writing JSON backup imports new identifiers, skips duplicates and fails atomically on capacity or malformed data',()=>{
  const storage=memory(),store=createWritingStore(storage);store.save(draft());const text=writingBackup(store.list());assert.equal(store.importDrafts(writingBackupDrafts(text)),0);
  assert.throws(()=>writingBackupDrafts(JSON.stringify({format:'plaude-writing-backup',version:1,notes:[{title:'bad',text:123}]})));const before=storage.getItem(WRITING_KEY);
  assert.throws(()=>store.importDrafts(Array.from({length:50},(_,i)=>({title:'incoming '+i,text:'other'}))));assert.equal(storage.getItem(WRITING_KEY),before);
  const other=createWritingStore(memory());assert.equal(other.importDrafts(writingBackupDrafts(text)),1);assert.notEqual(other.list()[0].id,store.list()[0].id);
});

test('legal prototype-named writing IDs download without inventing local deletion conflicts',async()=>{
  const {writingSyncKeyScenarios}=await import('./writing-sync-keys.fixture.mjs');const r=await writingSyncKeyScenarios(new URL('../public/',import.meta.url).href);
  assert.equal(r.downloads.synced,true);assert.equal(r.downloads.conflicts,0);assert.deepEqual(r.downloads.ids,[...r.identifiersAccepted].sort());assert.equal(r.downloads.contentsPreserved,true);
});
test('prototype-named writing sync metadata survives reload and offline edits keep real conflict protection',async()=>{
  const {writingSyncKeyScenarios}=await import('./writing-sync-keys.fixture.mjs');const r=await writingSyncKeyScenarios(new URL('../public/',import.meta.url).href);
  assert.equal(r.reload.metadataOwnBefore,true);assert.equal(r.reload.metadataOwnAfter,true);assert.equal(r.reload.synced,true);assert.equal(r.reload.conflicts,0);assert.equal(r.reload.remoteText,'刷新前离线修改');assert.equal(r.reload.localText,r.reload.remoteText);assert.deepEqual(r.reload.putRevisions,[0,1]);
  assert.equal(r.conflict.synced,false);assert.equal(r.conflict.conflicts,1);assert.equal(r.conflict.localText,'本机需保留修改');assert.equal(r.conflict.remoteText,'另一设备需保留修改');
});
test('prototype-named writing deletion after cache reload reaches the cloud and preserves sibling notes',async()=>{
  const {writingSyncKeyScenarios}=await import('./writing-sync-keys.fixture.mjs');const r=await writingSyncKeyScenarios(new URL('../public/',import.meta.url).href);
  assert.equal(r.deletion.reportedSynced,true);assert.equal(r.deletion.cloudDeleted,true);assert.equal(r.deletion.cloudRevision,2);assert.equal(r.deletion.deleteRequests,1);assert.equal(r.deletion.localDeleted,true);assert.equal(r.deletion.siblingPreserved,true);
});