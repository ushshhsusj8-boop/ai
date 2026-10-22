import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createPersonalInstructionClient,validatePersonalInstructions,personalInstructionContext} from '../public/personal_instructions.js';
import {prepareChatContext} from '../public/context_budget.js';
import {normalizeContextSettings} from '../public/conversation_tools.js';
import {createAccountStore} from '../src/accounts.mjs';
import {createGatewayServer} from '../src/app.mjs';
import {loadConfig} from '../src/config.mjs';

test('personal instructions share the input budget without truncating the current question',()=>{
  const value={enabled:true,text:'好'.repeat(2000)},chars=personalInstructionContext(value).length;
  assert.throws(()=>validatePersonalInstructions({...value,text:'x'.repeat(2001)}));
  assert.throws(()=>validatePersonalInstructions({...value,other:'injection'}));
  assert.throws(()=>validatePersonalInstructions({...value,text:'bad\0text'}));
  assert.equal(personalInstructionContext({...value,enabled:false}),'');
  const result=prepareChatContext([{role:'user',content:'q'.repeat(10000)},{role:'assistant',content:'a'.repeat(10000)},{role:'user',content:'完整问题'}],{}, {instructions:'i'.repeat(2000),memoryChars:4000,personalChars:chars});
  assert.equal(result.messages.at(-1).content,'完整问题');assert.ok(result.report.messageChars+2000+4000+chars<=24000);
  assert.throws(()=>prepareChatContext([{role:'user',content:'q'.repeat(20000)}],{},{personalChars:chars,memoryChars:4000}),/预算/);
  assert.equal(normalizeContextSettings({usePersonalInstructions:false}).usePersonalInstructions,false);
});

test('client checks identity, confirmed saves, disabled reads and aborts before sending',async()=>{
  let calls=0,current=true;const envelope={userId:'qa-owner',revision:2,instructions:{enabled:true,text:'简短中文'}};
  const client=createPersonalInstructionClient({userId:'qa-owner',isCurrent:()=>current,fetchImpl:async()=>{calls++;return Response.json(envelope);}});
  assert.deepEqual(await client.prepare({enabled:false}),{chars:0});assert.equal(calls,0);
  assert.deepEqual((await client.prepare()).selection,{revision:2});
  await assert.rejects(client.save(envelope.instructions,2),/尚未确认/);
  const aborted=new AbortController();aborted.abort();await assert.rejects(client.prepare({signal:aborted.signal}),/停止/);
  current=false;await assert.rejects(client.load(),/切换/);
  const wrong=createPersonalInstructionClient({userId:'qa-other',fetchImpl:async()=>Response.json(envelope)});await assert.rejects(wrong.load(),/账户或版本/);
});

test('private instructions persist, enforce ownership, reject conflicts and resolve only on the server',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'plaude-instructions-test-')),file=join(dir,'accounts.json'),store=createAccountStore(file),password='qa-instructions-password-2026';
  const a=await store.register({username:'qa-instruction-alice',password}),b=await store.register({username:'qa-instruction-bob',password}),upstream=[];
  const config=loadConfig({NODE_ENV:'test',BIND_HOST:'127.0.0.1',DEFAULT_PROVIDER:'deepseek',GATEWAY_ACCESS_TOKEN:'qa-instruction-abcdefghijklmnopqrstuvwxyz',DEEPSEEK_API_KEY:'sk-test-abcdefghijklmnopqrstuvwxyz',RATE_LIMIT_PER_MINUTE:'600'});
  const server=createGatewayServer({config,accountStore:store,fetchImpl:async(_url,options)=>{upstream.push(options.body);return Response.json({output_text:'合成回答',usage:{input_tokens:1,output_tokens:1,total_tokens:2}});}});server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});const origin='http://127.0.0.1:'+server.address().port;
  const request=(path,user,method='GET',body,extra={})=>fetch(origin+path,{method,headers:{...(user?{cookie:'plaude_session='+user.sessionToken,'x-plaude-client':'1','x-plaude-account-id':user.user.id}:{}),...(method==='GET'?{}:{origin,'content-type':'application/json'}),...extra},...(body?{body:JSON.stringify(body)}:{})});
  const first={revision:0,instructions:{enabled:true,text:'合成甲的默认偏好'}},question={provider:'deepseek',messages:[{role:'user',content:'你好'}]};
  await t.test('login, CSRF and current account checks protect both reads and writes',async()=>{
    assert.equal((await request('/api/account/instructions',null)).status,401);
    assert.equal((await request('/api/account/instructions',a,'GET',undefined,{'x-plaude-account-id':b.user.id})).status,403);
    assert.equal((await request('/api/account/instructions',a,'PUT',first,{origin:'https://foreign.example'})).status,403);
    assert.equal((await request('/api/account/instructions',a,'PUT',{...first,userId:b.user.id})).status,400);
  });
  await t.test('a confirmed revision survives reopening; another user sees no content',async()=>{
    const response=await request('/api/account/instructions',a,'PUT',first);assert.equal(response.status,200);const saved=await response.json();assert.equal(saved.revision,1);
    assert.deepEqual(createAccountStore(file).listInstructions(a.user.id),saved);assert.equal((await(await request('/api/account/instructions',b)).json()).instructions.text,'');
    assert.equal((await request('/api/account/instructions',a,'PUT',{...first,instructions:{enabled:false,text:'不得覆盖'}})).status,409);assert.equal(store.listInstructions(a.user.id).instructions.text,first.instructions.text);
  });
  await t.test('authenticated model preparation inserts current owned instructions before specific chat instructions',async()=>{
    assert.equal((await request('/api/chat',a,'POST',{...question,instructions:'合成具体任务',personalInstructions:{revision:1}})).status,200);
    const body=upstream.at(-1);assert.ok(body.includes('合成甲的默认偏好'));assert.ok(body.indexOf('合成甲的默认偏好')<body.indexOf('合成具体任务'));
    assert.equal((await request('/api/chat',a,'POST',question)).status,200);assert.ok(!upstream.at(-1).includes('合成甲的默认偏好'));
    const count=upstream.length;for(const [user,selection]of[[b,{revision:1}],[a,{revision:1,text:'伪造指令'}],[a,{revision:0}]])assert.ok((await request('/api/chat',user,'POST',{...question,personalInstructions:selection})).status>=400);assert.equal(upstream.length,count);
  });
  await t.test('pausing or deleting fails stale preparation before any upstream request',async()=>{
    const count=upstream.length;store.putInstructions(a.user.id,{revision:1,instructions:{enabled:false,text:'已暂停'}});
    assert.equal((await request('/api/chat',a,'POST',{...question,personalInstructions:{revision:1}})).status,409);
    assert.equal((await request('/api/chat',a,'POST',{...question,personalInstructions:{revision:2}})).status,409);
    store.putInstructions(a.user.id,{revision:2,instructions:{enabled:true,text:''}});assert.equal((await request('/api/chat',a,'POST',{...question,personalInstructions:{revision:3}})).status,409);assert.equal(upstream.length,count);
    store.putConversation(a.user.id,'qa-personal-disabled',{revision:0,conversation:{id:'qa-personal-disabled',title:'关闭通用指令',provider:'deepseek',model:'deepseek-flash',updatedAt:1,context:{usePersonalInstructions:false},messages:question.messages}});assert.equal(createAccountStore(file).listConversations(a.user.id).conversations[0].conversation.context.usePersonalInstructions,false);
  });
  await t.test('corrupt stored instructions cannot be silently overwritten',async()=>{
    const target=join(file+'.instructions',a.user.id+'.json'),raw=await readFile(target,'utf8');await writeFile(target,'corrupt');
    assert.equal((await request('/api/account/instructions',a)).status,500);assert.equal((await request('/api/account/instructions',a,'PUT',first)).status,500);assert.equal(await readFile(target,'utf8'),'corrupt');await writeFile(target,raw);
  });
});
