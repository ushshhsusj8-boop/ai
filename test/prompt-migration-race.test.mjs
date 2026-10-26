import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,basename,sep} from 'node:path';
import {createPromptSync,PROMPT_CLOUD_KEY} from '../public/prompt_sync.js';
import {PROMPT_LIBRARY_KEY,createPrompt,loadPromptLibrary,savePromptLibrary} from '../public/prompt_library.js';
import {createAccountStore} from '../src/accounts.mjs';
import {createGatewayServer} from '../src/app.mjs';
import {loadConfig} from '../src/config.mjs';
const prompt=(content,id='legacy-source')=>createPrompt([],{title:'Synthetic migration',content},{id,now:100});
const memory=()=>{const map=new Map();return{getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,String(value))};};
async function fixture(t){
 const directory=await mkdtemp(join(tmpdir(),'plaude-migration-race-')),store=createAccountStore(join(directory,'accounts.json'));
 const account=await store.register({username:'qa-migration',password:'synthetic-migration-password-2026'}),other=await store.register({username:'qa-migration-other',password:'synthetic-other-password-2026'});
 let modelCalls=0;const server=createGatewayServer({config:loadConfig({NODE_ENV:'test',GATEWAY_ACCESS_TOKEN:'qa-migration-abcdefghijklmnopqrstuvwxyz',DEEPSEEK_API_KEY:'sk-synthetic-abcdefghijklmnopqrstuvwxyz'}),accountStore:store,fetchImpl:async()=>{modelCalls++;throw Error('Real models forbidden');}});
 server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));const target=resolve(directory);assert.ok(target.startsWith(resolve(tmpdir())+sep)&&basename(target).startsWith('plaude-migration-race-'));await rm(target,{recursive:true,force:true});});
 let hook=null,puts=0;const fetchImpl=async(path,options)=>{const response=await fetch(origin+path,{...options,headers:{...options.headers,cookie:'plaude_session='+account.sessionToken,...(options.method==='PUT'?{origin}:{})}});if(options.method==='PUT')puts++;if(hook){const fn=hook;hook=null;fn();}return response;};
 const storage=memory();savePromptLibrary(storage,prompt('Original legacy text'));
 storage.setItem(PROMPT_CLOUD_KEY,JSON.stringify({version:1,revision:0,base:[],prompts:[],migrated:false}));
 const sync=createPromptSync({userId:account.user.id,storage,fetchImpl});
 return{storage,sync,store,account,other,set hook(fn){hook=fn;},get puts(){return puts;},get modelCalls(){return modelCalls;}};
}

test('legacy migration rechecks its source after an awaited real HTTP read before asking for confirmation',async t=>{
 const f=await fixture(t),before=f.storage.getItem(PROMPT_CLOUD_KEY);let confirmations=0;
 const latest=prompt('Edited in another tab');latest.push(...prompt('New sibling in another tab','legacy-sibling'));
 f.hook=()=>savePromptLibrary(f.storage,latest);
 assert.equal(await f.sync.resolve('legacy',()=>{confirmations++;return true;}),false);
 assert.equal(confirmations,0);assert.equal(f.puts,0);assert.equal(f.storage.getItem(PROMPT_CLOUD_KEY),before);assert.deepEqual(loadPromptLibrary(f.storage),latest);assert.equal(f.sync.report().legacyAvailable,true);assert.match(f.sync.report().error,/旧本机库.*修改/);
});

test('legacy changes made during confirmation abort without marking migration complete or uploading the stale snapshot',async t=>{
 const f=await fixture(t),before=f.storage.getItem(PROMPT_CLOUD_KEY),latest=prompt('Changed during confirmation','replacement-source');
 assert.equal(await f.sync.resolve('legacy',()=>{savePromptLibrary(f.storage,latest);return true;}),false);
 assert.equal(f.puts,0);assert.equal(f.storage.getItem(PROMPT_CLOUD_KEY),before);assert.deepEqual(loadPromptLibrary(f.storage),latest);assert.equal(f.sync.report().legacyAvailable,true);
 assert.equal(await f.sync.resolve('legacy',()=>true),true);assert.equal(f.puts,1);
 const cloud=f.store.listPrompts(f.account.user.id);assert.equal(cloud.prompts.length,1);assert.equal(cloud.prompts[0].content,latest[0].content);assert.notEqual(cloud.prompts[0].id,latest[0].id);assert.equal(f.sync.report().legacyAvailable,false);
 assert.deepEqual(loadPromptLibrary(f.storage),latest);assert.deepEqual(f.store.listPrompts(f.other.user.id).prompts,[]);assert.equal(f.modelCalls,0);
});

test('an unreadable source introduced while awaiting the cloud is preserved and never certified as migrated',async t=>{
 const f=await fixture(t),before=f.storage.getItem(PROMPT_CLOUD_KEY);f.hook=()=>f.storage.setItem(PROMPT_LIBRARY_KEY,'{synthetic-broken-json');
 assert.equal(await f.sync.resolve('legacy',()=>true),false);assert.equal(f.storage.getItem(PROMPT_LIBRARY_KEY),'{synthetic-broken-json');assert.equal(f.storage.getItem(PROMPT_CLOUD_KEY),before);assert.equal(f.puts,0);assert.equal(f.store.listPrompts(f.account.user.id).prompts.length,0);assert.equal(f.modelCalls,0);
});
