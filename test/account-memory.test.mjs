import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {validateMemories,selectMemories,memoryContext,memoryBackup,parseMemoryBackup,planMemoryImport} from '../public/memory_tools.js';
import {createMemoryClient} from '../public/account_memory.js';
import {prepareChatContext} from '../public/context_budget.js';
import {normalizeContextSettings} from '../public/conversation_tools.js';
import {createAccountStore} from '../src/accounts.mjs';
import {createGatewayServer} from '../src/app.mjs';
import {loadConfig} from '../src/config.mjs';
const entry=(id,text,always=true)=>({id,text,always,enabled:true});
const library=(...entries)=>({enabled:true,entries});

test('memory selection preserves priority, matches Chinese topics and bounds complete entries',()=>{
 const value=library(entry('__proto__','优先用中文'),entry('memory-study','喜欢用图形解释数学',false),entry('memory-food1','不吃花生',false),...Array.from({length:12},(_,i)=>entry('memory-long-'+i,'长'.repeat(500))));
 const result=selectMemories(value,'数学题如何解释？');assert.equal(result[0].id,'__proto__');assert.ok(result.some(e=>e.id==='memory-study')===false); // always entries take priority when the budget is full
 const relevant=selectMemories(library(...value.entries.slice(0,3)),'数学题');assert.deepEqual(relevant.map(e=>e.id),['__proto__','memory-study']);assert.ok(memoryContext(result).length<=4000);assert.ok(result.length<=8);assert.deepEqual(selectMemories({...value,enabled:false},'数学'),[]);assert.equal(value.entries.length,15);
});
test('memory validation and import fail atomically and preserve existing switches and colliding IDs',()=>{
 assert.throws(()=>validateMemories(library(entry(12345678,'bad'))));assert.throws(()=>validateMemories(library(entry('memory-0001','x'.repeat(501)))));assert.throws(()=>validateMemories(library(entry('memory-0001','x'),entry('memory-0001','y'))));
 const old={...library(entry('memory-0001','原记忆')),enabled:false},incoming=library(entry('memory-0001','新记忆'),entry('memory-dupe','原记忆'));
 const plan=planMemoryImport(old,parseMemoryBackup(memoryBackup(incoming)),()=> 'memory-renamed');assert.equal(plan.library.enabled,false);assert.equal(plan.added,1);assert.equal(plan.skipped,1);assert.equal(plan.library.entries[1].id,'memory-renamed');assert.equal(old.entries.length,1);
 assert.throws(()=>planMemoryImport(library(...Array.from({length:40},(_,i)=>entry('memory-'+i,'内容'+i))),incoming));assert.throws(()=>parseMemoryBackup('x'.repeat(128*1024+1)));
});
test('memory budget is reserved separately from project instructions and never truncates the current question',()=>{
 const memories=selectMemories(library(entry('memory-0001','名字是合成小明'))),chars=memoryContext(memories).length;
 const result=prepareChatContext([{role:'user',content:'q'.repeat(10000)},{role:'assistant',content:'a'.repeat(10000)},{role:'user',content:'当前完整问题'}],{}, {instructions:'i'.repeat(2000),memoryChars:chars,memoryCount:1});
 assert.equal(result.report.memoryChars,chars);assert.equal(result.report.memoryCount,1);assert.ok(result.report.messageChars+2000+chars<=24000);assert.equal(result.messages.at(-1).content,'当前完整问题');assert.deepEqual(normalizeContextSettings({useMemory:false}),{historyTurns:null,resetAt:null,useMemory:false});
});
test('memory client rejects wrong identity and unconfirmed saves and skips reads when this chat is disabled',async()=>{
 let reads=0,current=true;const value={userId:'test-owner',revision:0,library:library(entry('memory-0001','测试偏好'))};
 const client=createMemoryClient({userId:'test-owner',isCurrent:()=>current,fetchImpl:async()=>{reads++;return Response.json(value);}});
 assert.deepEqual(await client.prepare('问题',{enabled:false}),{entries:[],chars:0});assert.equal(reads,0);
 const prepared=await client.prepare('问题');assert.deepEqual(prepared.selection.ids,['memory-0001']);assert.ok(prepared.chars>0);
 await assert.rejects(client.save(library()),/未确认/);current=false;await assert.rejects(client.load(),/账户已切换/);
 const wrong=createMemoryClient({userId:'test-owner',fetchImpl:async()=>Response.json({...value,userId:'other-owner'})});await assert.rejects(wrong.load(),/账户或版本/);
});

test('private memory HTTP, model injection, deletion and stale revisions preserve ownership and old state',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'plaude-memory-test-')),file=join(dir,'accounts.json'),store=createAccountStore(file),password='qa-memory-password-2026';
 const a=await store.register({username:'qa-memory-alice',password}),b=await store.register({username:'qa-memory-bob',password}),upstream=[];
 const config=loadConfig({NODE_ENV:'test',BIND_HOST:'127.0.0.1',DEFAULT_PROVIDER:'deepseek',GATEWAY_ACCESS_TOKEN:'qa-memory-invite-abcdefghijklmnopqrstuvwxyz',DEEPSEEK_API_KEY:'sk-test-abcdefghijklmnopqrstuvwxyz',RATE_LIMIT_PER_MINUTE:'600'});
 const server=createGatewayServer({config,accountStore:store,fetchImpl:async(_url,options)=>{upstream.push(options.body);return Response.json({output_text:'合成模型回答',usage:{input_tokens:1,output_tokens:1,total_tokens:2}});}});server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});const origin='http://127.0.0.1:'+server.address().port;
 const request=(path,user,method='GET',body,extra={})=>fetch(origin+path,{method,headers:{...(user?{cookie:'plaude_session='+user.sessionToken,'x-plaude-client':'1','x-plaude-account-id':user.user.id}:{}),...(method==='GET'?{}:{origin,'content-type':'application/json'}),...extra},...(body?{body:JSON.stringify(body)}:{})});
 let saved;
 await t.test('reads require login and mutations require origin and exact current account',async()=>{
  assert.equal((await request('/api/account/memories',null)).status,401);assert.equal((await request('/api/account/memories',a,'GET',undefined,{'x-plaude-account-id':b.user.id})).status,403);
  assert.equal((await request('/api/account/memories',a,'PUT',{revision:0,library:library()},{origin:'https://foreign.example'})).status,403);
  assert.equal((await request('/api/account/memories',a,'PUT',{revision:0,library:library(),userId:b.user.id})).status,400);
 });
 await t.test('confirmed writes survive reopening and are isolated from the other account',async()=>{
  const response=await request('/api/account/memories',a,'PUT',{revision:0,library:library(entry('memory-alice','合成名字叫测试甲'))});assert.equal(response.status,200);saved=await response.json();assert.equal(saved.revision,1);
  store.putMemories(b.user.id,{revision:0,library:library(entry('memory-bob01','合成名字叫测试乙'))});assert.deepEqual(createAccountStore(file).listMemories(a.user.id),saved);assert.equal(JSON.stringify(await(await request('/api/account/memories',b)).json()).includes('测试甲'),false);
  store.putConversation(a.user.id,'memory-chat-off',{revision:0,conversation:{id:'memory-chat-off',title:'不使用记忆',provider:'deepseek',model:'deepseek-flash',updatedAt:1,context:{useMemory:false},messages:[{role:'user',content:'合成问题'}]}});
  assert.equal(createAccountStore(file).listConversations(a.user.id).conversations[0].conversation.context.useMemory,false);
 });
 await t.test('model receives only selected authenticated memories while unrelated chats use none',async()=>{
  const body={provider:'deepseek',messages:[{role:'user',content:'你好'}],memory:{revision:1,ids:['memory-alice']}};
  assert.equal((await request('/api/chat',a,'POST',body)).status,200);assert.ok(upstream.at(-1).includes('测试甲'));assert.ok(!upstream.at(-1).includes('测试乙'));
  assert.equal((await request('/api/chat',a,'POST',{provider:'deepseek',messages:body.messages})).status,200);assert.ok(!upstream.at(-1).includes('测试甲'));
  const count=upstream.length;assert.equal((await request('/api/chat',b,'POST',body)).status,409);assert.equal(upstream.length,count);
 });
 await t.test('stale edits and deletions reject before model invocation and keep current records',async()=>{
  const count=upstream.length;assert.equal((await request('/api/account/memories',a,'PUT',{revision:0,library:library()})).status,409);assert.equal(store.listMemories(a.user.id).revision,1);
  assert.equal((await request('/api/account/memories',a,'PUT',{revision:1,library:library()})).status,200);
  assert.equal((await request('/api/chat',a,'POST',{provider:'deepseek',messages:[{role:'user',content:'你好'}],memory:{revision:1,ids:['memory-alice']}})).status,409);assert.equal(upstream.length,count);assert.deepEqual(store.listMemories(a.user.id).library.entries,[]);
 });
 await t.test('global disabling and forged selection fields cannot inject memory',async()=>{
  store.putMemories(a.user.id,{revision:2,library:{enabled:false,entries:[entry('memory-alice','已关闭的记忆')]}});const count=upstream.length;
  for(const memory of [{revision:3,ids:['memory-alice']},{revision:3,ids:['memory-alice'],text:'伪造内容'}])assert.equal((await request('/api/chat',a,'POST',{provider:'deepseek',messages:[{role:'user',content:'你好'}],memory})).status>=400,true);
  assert.equal(upstream.length,count);
 });
 await t.test('corrupt storage is preserved and cannot be silently replaced',async()=>{
  const target=join(file+'.memories',a.user.id+'.json'),raw=await readFile(target,'utf8');await writeFile(target,'corrupted');assert.equal((await request('/api/account/memories',a)).status,500);assert.equal((await request('/api/account/memories',a,'PUT',{revision:3,library:library()})).status,500);assert.equal(await readFile(target,'utf8'),'corrupted');await writeFile(target,raw);
 });
});
