import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {connectionEndpoint,validateConnection} from '../public/connection_tools.js';
import {createConnectionNetwork,publicAddress} from '../src/connection_network.mjs';
import {createAccountStore} from '../src/accounts.mjs';
import {createGatewayServer} from '../src/app.mjs';
import {loadConfig} from '../src/config.mjs';

const sample=()=>({id:'mine-1234567890abcdef12345678',label:'合成自有连接',apiUrl:'https://models.example.com/v1',protocol:'chat-completions',apiKey:'qa-private-key-never-echo',model:'qa-model',models:['qa-model'],vision:false});
test('personal URLs accept arbitrary public HTTPS services and normalize Base URLs for both protocols',()=>{
  assert.equal(connectionEndpoint('https://custom.example.org:9443/v1/'),'https://custom.example.org:9443/v1/chat/completions');
  assert.equal(connectionEndpoint('https://other.example.org/api/responses','responses'),'https://other.example.org/api/responses');
  assert.equal(connectionEndpoint('https://other.example.org/v1','responses'),'https://other.example.org/v1/responses');
  for(const value of ['http://models.example.com/v1','https://user:password@models.example.com/v1','file:///etc/passwd','https://models.example.com/v1?key=secret','https://models.example.com/v1#secret','https://host.local/v1','https://localhost/v1'])assert.throws(()=>connectionEndpoint(value));
  assert.throws(()=>connectionEndpoint('https://models.example.com/v1/responses','chat-completions'));
  assert.throws(()=>validateConnection({...sample(),ownerId:'other'}));assert.throws(()=>validateConnection({...sample(),apiKey:'key\ninject'}));
});
test('public-address validation rejects local, metadata, reserved, IPv4-mapped and transition address ranges',()=>{
  for(const ip of ['0.0.0.0','10.0.0.1','100.64.0.1','127.0.0.1','169.254.169.254','172.31.1.1','192.168.1.1','192.0.2.1','198.18.0.1','224.0.0.1','255.255.255.255','::','::1','::ffff:127.0.0.1','::ffff:8.8.8.8','fc00::1','fe80::1','64:ff9b::a00:1','2001:db8::1','2002:7f00:1::1','2001::1','3fff::1'])assert.equal(publicAddress(ip),false,ip);
  assert.equal(publicAddress('8.8.8.8'),true);assert.equal(publicAddress('2606:4700:4700::1111'),true);assert.equal(publicAddress('8.8.8.8',['8.8.8.8']),false);
});
test('private transport checks every DNS result, pins the actual connect lookup, bypasses proxies and rejects redirects',async()=>{
  let addresses=[{address:'8.8.8.8',family:4}],lookups=0,sent=0,agentOptions,closed=0;
  const prepare=createConnectionNetwork({lookupImpl:async()=>{lookups++;return addresses;},agentFactory:options=>{agentOptions=options;return {close:async()=>{closed++;}};},fetchImpl:async(url,options)=>{sent++;assert.equal(options.redirect,'error');assert.ok(options.dispatcher);assert.equal(String(url),'https://models.example.com/v1/chat/completions');return Response.json({ok:true});}});
  const provider=validateConnection(sample()),transport=await prepare(provider);
  addresses=[{address:'127.0.0.1',family:4}];
  const pinned=await new Promise((resolve,reject)=>agentOptions.connect.lookup('models.example.com',{all:true},(e,a)=>e?reject(e):resolve(a)));assert.deepEqual(pinned,[{address:'8.8.8.8',family:4}]);assert.equal(lookups,1);
  await transport.fetch(provider.apiUrl,{headers:{authorization:'Bearer qa-key'}});assert.equal(sent,1);
  await assert.rejects(transport.fetch('https://elsewhere.example.com/v1/chat/completions'));await transport.close();assert.equal(closed,1);
  await assert.rejects(prepare(provider));addresses=[{address:'8.8.8.8',family:4},{address:'10.1.1.1',family:4}];await assert.rejects(prepare(provider));
  addresses=[{address:'8.8.8.8',family:4}];await assert.rejects(prepare(provider,{blockedHosts:['models.example.com']}));await assert.rejects(prepare(provider,{blockedHosts:['8.8.8.8']}));assert.equal(sent,1);
});

test('account model connections isolate encrypted credentials, versions and model requests',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'plaude-connection-test-')),file=join(dir,'accounts.json'),store=createAccountStore(file),password='qa-connection-password-2026';
  const a=await store.register({username:'qa-connection-alice',password}),b=await store.register({username:'qa-connection-bob',password});
  let globalCalls=0,privateCalls=[],dnsCalls=0;
  const network=createConnectionNetwork({lookupImpl:async()=>{dnsCalls++;return [{address:'8.8.8.8',family:4}];},agentFactory:()=>({close:async()=>{}}),fetchImpl:async(url,options)=>{privateCalls.push({url:String(url),headers:options.headers,body:JSON.parse(options.body)});return Response.json({choices:[{message:{content:'合成回答'},finish_reason:'stop'}],output_text:'合成回答',usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2,input_tokens:1,output_tokens:1}});}});
  const config=loadConfig({NODE_ENV:'test',BIND_HOST:'127.0.0.1',DEFAULT_PROVIDER:'deepseek',GATEWAY_ACCESS_TOKEN:'qa-gateway-abcdefghijklmnopqrstuvwxyz',DEEPSEEK_API_KEY:'qa-global-secret-abcdefghijklmnopqrstuvwxyz',RATE_LIMIT_PER_MINUTE:'600'});
  const server=createGatewayServer({config,accountStore:store,connectionNetwork:network,fetchImpl:async()=>{globalCalls++;return Response.json({});}});server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
  const request=(path,user,method='GET',body,extra={})=>fetch(origin+path,{method,headers:{...(user?{cookie:'plaude_session='+user.sessionToken,'x-plaude-client':'1','x-plaude-account-id':user.user.id}:{}),...(method==='GET'?{}:{origin,'content-type':'application/json'}),...extra},...(body?{body:JSON.stringify(body)}:{})});
  const send=(user,extra={})=>request('/api/chat',user,'POST',{provider:sample().id,model:'qa-model',connectionRevision:1,messages:[{role:'user',content:'合成问题'}],...extra});
  await t.test('authentication, identity, CSRF, unknown fields and stale writes are rejected',async()=>{
    assert.equal((await request('/api/account/connections',null)).status,401);assert.equal((await request('/api/account/connections',a,'GET',undefined,{'x-plaude-account-id':b.user.id})).status,403);
    assert.equal((await request('/api/account/connections',a,'PUT',{revision:0,connections:[sample()]},{origin:'https://foreign.example'})).status,403);
    assert.equal((await request('/api/account/connections',a,'PUT',{revision:0,connections:[sample()],userId:b.user.id})).status,400);
    const saved=await request('/api/account/connections',a,'PUT',{revision:0,connections:[sample()]});assert.equal(saved.status,200);assert.equal((await saved.json()).revision,1);
    assert.equal((await request('/api/account/connections',a,'PUT',{revision:0,connections:[]})).status,409);assert.equal(dnsCalls,0);assert.equal(privateCalls.length,0);
  });
  await t.test('saved secrets and URLs are encrypted at rest and never returned in metadata or other accounts',async()=>{
    const raw=await readFile(join(file+'.connections',a.user.id+'.json'),'utf8');assert.ok(!raw.includes(sample().apiKey));assert.ok(!raw.includes('models.example.com'));
    assert.equal((await readFile(file+'.connections.key')).length,32);assert.equal((await readdir(file+'.connections')).length,1);
    const own=await (await request('/api/account/connections',a)).text();assert.ok(!own.includes(sample().apiKey));assert.ok(own.includes('keyConfigured'));
    assert.equal(createAccountStore(file).getConnections(a.user.id).revision,1);assert.deepEqual(store.getConnections(b.user.id).connections,[]);
    for(const user of [null,b]){const providers=await (await request('/api/providers',user)).text();assert.ok(!providers.includes(sample().id));assert.ok(!providers.includes(sample().apiKey));}
    const providers=await (await request('/api/providers',a)).json();const mine=providers.providers.find(p=>p.id===sample().id);assert.equal(mine.connectionRevision,1);assert.equal(mine.privateConnection,true);assert.ok(!JSON.stringify(providers).includes('models.example.com'));assert.ok(providers.providers.some(p=>p.id==='deepseek'));
  });
  await t.test('external site-token API neither lists nor resolves personal connections even for a signed-in owner',async()=>{
    const authorization={authorization:'Bearer qa-gateway-abcdefghijklmnopqrstuvwxyz'};
    const listed=await request('/v1/models',a,'GET',undefined,authorization);assert.equal(listed.status,200);
    const models=(await listed.json()).data;assert.ok(models.some(m=>m.id==='deepseek'));assert.ok(models.every(m=>!m.id.startsWith('mine-')));
    const before=privateCalls.length;const response=await request('/v1/chat/completions',a,'POST',{model:sample().id,messages:[{role:'user',content:'合成外部调用'}]},authorization);
    assert.equal(response.status,400);assert.match((await response.json()).error.message,/enabled model ID/);assert.equal(privateCalls.length,before);assert.equal(globalCalls,0);
  });
  await t.test('only the owner can generate, using their exact URL and key, including temporary text chats',async()=>{
    assert.equal((await send(b)).status,409);assert.equal((await send(null)).status,401);assert.equal((await send(a,{connectionRevision:0})).status,409);assert.equal(privateCalls.length,0);
    assert.equal((await send(a)).status,200);assert.equal((await send(a,{temporary:true})).status,200);assert.equal(globalCalls,0);assert.equal(privateCalls.length,2);
    assert.equal(privateCalls[0].url,'https://models.example.com/v1/chat/completions');assert.equal(privateCalls[0].headers.authorization,'Bearer '+sample().apiKey);assert.ok(!JSON.stringify(privateCalls).includes(config.providers.deepseek.apiKey));
    const conversation={id:'qa-custom-chat',title:'合成私人连接聊天',provider:sample().id,model:'qa-model',updatedAt:1,messages:[{role:'user',content:'合成问题'}]};assert.equal((await request('/api/account/conversations/'+conversation.id,a,'PUT',{revision:0,conversation})).status,200);
  });
  await t.test('blank keys retain the same endpoint only; changing the URL requires a new key and blocks stale prepared requests',async()=>{
    assert.equal((await request('/api/account/connections',a,'PUT',{revision:1,connections:[{...sample(),apiUrl:'https://new.example.com/v1',apiKey:''}]})).status,400);
    const saved=await request('/api/account/connections',a,'PUT',{revision:1,connections:[{...sample(),apiKey:''}]});assert.equal(saved.status,200);assert.equal(store.resolveConnection(a.user.id,sample().id,2).apiKey,sample().apiKey);
    assert.equal((await send(a)).status,409);assert.equal(privateCalls.length,2);
    assert.equal((await request('/api/account/connections',a,'PUT',{revision:2,connections:[{...sample(),apiUrl:'https://new.example.com/v2',apiKey:'qa-new-key'}]})).status,200);
    assert.equal((await send(a,{connectionRevision:3})).status,200);assert.equal(privateCalls.at(-1).url,'https://new.example.com/v2/chat/completions');assert.equal(privateCalls.at(-1).headers.authorization,'Bearer qa-new-key');
  });
  await t.test('corruption and wrong-account encrypted envelopes fail closed without crashing the provider list or replacing data',async()=>{
    const target=join(file+'.connections',a.user.id+'.json'),raw=await readFile(target,'utf8');await writeFile(target,'corrupt');
    assert.equal((await request('/api/account/connections',a)).status,500);assert.equal((await request('/api/providers',a)).status,500);assert.equal((await request('/healthz')).status,200);assert.equal((await request('/api/account/connections',a,'PUT',{revision:3,connections:[]})).status,500);assert.equal(await readFile(target,'utf8'),'corrupt');await writeFile(target,raw);
    const other=join(file+'.connections',b.user.id+'.json');await writeFile(other,raw);assert.equal((await request('/api/account/connections',b)).status,500);await rm(other);
  });
  await t.test('deletion prevents later model access while preserving original chat; logs never contain secrets or message text',async()=>{
    const count=privateCalls.length;assert.equal((await request('/api/account/connections',a,'PUT',{revision:3,connections:[]})).status,200);assert.equal((await send(a,{connectionRevision:4})).status,409);assert.equal(privateCalls.length,count);assert.equal(store.listConversations(a.user.id).conversations.length,1);
    const logs=await (await request('/api/activity',a)).text();for(const secret of [sample().apiKey,'qa-new-key','models.example.com','合成问题'])assert.ok(!logs.includes(secret),secret);
  });
  await t.test('a second owner can use the same connection ID with an independent Responses endpoint and key',async()=>{
    const c={...sample(),protocol:'responses',apiUrl:'https://second.example.org/v1',apiKey:'qa-b-key'};
    assert.equal((await request('/api/account/connections',b,'PUT',{revision:0,connections:[c]})).status,200);
    assert.equal((await send(b)).status,200);assert.equal(privateCalls.at(-1).url,'https://second.example.org/v1/responses');assert.equal(privateCalls.at(-1).headers.authorization,'Bearer qa-b-key');assert.equal(store.getConnections(a.user.id).connections.length,0);
    const key=await readFile(file+'.connections.key');await rm(file+'.connections.key');const target=join(file+'.connections',b.user.id+'.json'),raw=await readFile(target,'utf8');
    assert.equal((await request('/api/account/connections',a,'PUT',{revision:4,connections:[sample()]})).status,500);assert.equal(await readFile(target,'utf8'),raw);await writeFile(file+'.connections.key',key);
  });
});
