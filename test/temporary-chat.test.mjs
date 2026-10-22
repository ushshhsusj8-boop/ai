import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createAccountStore} from '../src/accounts.mjs';
import {createGatewayServer} from '../src/app.mjs';
import {loadConfig} from '../src/config.mjs';

test('temporary chat remains isolated from account history, memory and persistent publication',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'plaude-temporary-test-')),store=createAccountStore(join(dir,'accounts.json'));
 const owner=await store.register({username:'qa-temporary-owner',password:'qa-temporary-password-2026'}),upstream=[];let codeRuns=0;
 store.putMemories(owner.user.id,{revision:0,library:{enabled:true,entries:[{id:'qa-temp-memory',text:'合成账户记忆不得带入',enabled:true,always:true}]}});
 store.putInstructions(owner.user.id,{revision:0,instructions:{enabled:true,text:'合成账户指令不得带入'}});
 const saved={id:'qa-normal-history',title:'合成普通记录',provider:'deepseek',model:'deepseek-flash',updatedAt:1,messages:[{role:'user',content:'合成普通问题'}]};store.putConversation(owner.user.id,saved.id,{revision:0,conversation:saved});
 const before=store.listConversations(owner.user.id),memory=store.listMemories(owner.user.id),instructions=store.listInstructions(owner.user.id);
 const config=loadConfig({NODE_ENV:'test',BIND_HOST:'127.0.0.1',DEFAULT_PROVIDER:'deepseek',GATEWAY_ACCESS_TOKEN:'qa-temporary-abcdefghijklmnopqrstuvwxyz',DEEPSEEK_API_KEY:'sk-test-abcdefghijklmnopqrstuvwxyz',RATE_LIMIT_PER_MINUTE:'600'});
 const server=createGatewayServer({config,accountStore:store,fetchImpl:async(_url,options)=>{upstream.push(options.body);return Response.json({output_text:'合成临时回答',usage:{input_tokens:1,output_tokens:1,total_tokens:2}});},runCode:async()=>{codeRuns++;throw Error('Code execution forbidden');}});server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});const origin='http://127.0.0.1:'+server.address().port;
 const request=(path,body,user=owner)=>fetch(origin+path,{method:body?'POST':'GET',headers:{...(user?{cookie:'plaude_session='+user.sessionToken,'x-plaude-client':'1','x-plaude-account-id':user.user.id}:{}),...(body?{origin,'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const question={temporary:true,provider:'deepseek',model:'deepseek-flash',messages:[{role:'user',content:'合成临时隐私问题'}]};
 await t.test('the standalone page is served without caching and its local assets are available',async()=>{
  const response=await request('/temporary');assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.ok((await response.text()).includes('不承诺供应商零留存'));
  for(const path of ['/temporary.js','/temporary.css'])assert.equal((await request(path)).status,200);
 });
 await t.test('temporary generation needs an authenticated current account',async()=>{assert.equal((await request('/api/chat',question,null)).status,401);assert.equal(upstream.length,0);});
 await t.test('temporary text cannot carry memory, instructions, documents, search or images',async()=>{
  for(const extra of [{temporary:'true'},{memory:{revision:1,ids:['qa-temp-memory']}},{personalInstructions:{revision:1}},{instructions:'不得带入'},{documents:[{}]},{webSearch:true},{messages:[{role:'user',content:'q',images:[{}]}]}])assert.ok((await request('/api/chat',{...question,...extra})).status>=400);
  assert.equal(upstream.length,0);
 });
 await t.test('an explicit temporary request sends only provided text and preserves all account records',async()=>{
  const response=await request('/api/chat',{...question,parameters:{max_output_tokens:32768}});assert.equal(response.status,200);assert.equal((await response.json()).text,'合成临时回答');assert.equal(upstream.length,1);
  assert.ok(upstream[0].includes('合成临时隐私问题'));assert.ok(!upstream[0].includes('合成账户记忆不得带入'));assert.ok(!upstream[0].includes('合成账户指令不得带入'));assert.deepEqual(store.listConversations(owner.user.id),before);assert.deepEqual(store.listMemories(owner.user.id),memory);assert.deepEqual(store.listInstructions(owner.user.id),instructions);assert.equal(codeRuns,0);
 });
 await t.test('persistent private and shared storage reject an explicit temporary record',async()=>{
  assert.throws(()=>store.putConversation(owner.user.id,'qa-temp-forged',{revision:0,conversation:{...saved,id:'qa-temp-forged',temporary:true}}),/临时聊天/);
  assert.deepEqual(store.listConversations(owner.user.id),before);
 });
});
