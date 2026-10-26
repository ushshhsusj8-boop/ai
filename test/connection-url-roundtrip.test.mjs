import assert from 'node:assert/strict';
import {test} from 'node:test';
import {once} from 'node:events';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {createCipheriv,randomBytes} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,resolve,sep,basename} from 'node:path';
import {connectionEndpoint} from '../public/connection_tools.js';
import {createAccountStore} from '../src/accounts.mjs';
import {createGatewayServer} from '../src/app.mjs';
import {loadConfig} from '../src/config.mjs';
import {createConnectionNetwork} from '../src/connection_network.mjs';
const maximum=2048*9+32;
const connection=(apiUrl,protocol='chat-completions')=>({id:'mine-'+('a'.repeat(24)),label:'Synthetic Unicode route',apiUrl,protocol,model:'qa-model',models:['qa-model'],vision:false,apiKey:'qa-only-synthetic-key-2026'});
const payload=c=>{const {keyConfigured,...entry}=c;return {...entry,apiKey:''};};
async function fixture(t){
 const directory=await mkdtemp(join(tmpdir(),'plaude-url-roundtrip-')),file=join(directory,'accounts.json'),store=createAccountStore(file);
 const owner=await store.register({username:'qa-url-owner',password:'synthetic-url-password-2026'}),other=await store.register({username:'qa-url-other',password:'synthetic-other-password-2026'});
 let calls=0;const server=createGatewayServer({config:loadConfig({NODE_ENV:'test',GATEWAY_ACCESS_TOKEN:'qa-url-roundtrip-abcdefghijklmnopqrstuvwxyz',DEEPSEEK_API_KEY:'sk-synthetic-abcdefghijklmnopqrstuvwxyz'}),accountStore:store,fetchImpl:async()=>{calls++;throw Error('Real models forbidden');}});
 server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));const target=resolve(directory);assert.ok(target.startsWith(resolve(tmpdir())+sep)&&basename(target).startsWith('plaude-url-roundtrip-'));await rm(target,{recursive:true,force:true});});
 const request=async(path='/api/account/connections',method='GET',body,user=owner,extra={})=>{const response=await fetch(origin+path,{method,headers:{cookie:'plaude_session='+user.sessionToken,'x-plaude-client':'1','x-plaude-account-id':user.user.id,...(method==='GET'?{}:{origin,'content-type':'application/json'}),...extra},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,value:await response.json()};};
 return {file,store,owner,other,request,get calls(){return calls;}};
}

test('personal endpoints round-trip after Unicode encoding or protocol suffix expansion and reject excessive canonical lengths',()=>{
 for(const protocol of ['chat-completions','responses'])for(const input of ['https://api.example.org/'+'路径'.repeat(200),'https://api.example.org/'+'a'.repeat(2025)]){
  const canonical=connectionEndpoint(input,protocol);assert.ok(canonical.length>2048);assert.equal(connectionEndpoint(canonical,protocol),canonical);
 }
 for(const input of ['https://api.example.org/'+'a'.repeat(maximum),'https://api.example.org/'+'路'.repeat(2048),'https://u:p@api.example.org/v1','http://api.example.org/v1','https://api.example.org/v1?k=secret','https://localhost/v1'])assert.throws(()=>connectionEndpoint(input));
 assert.throws(()=>connectionEndpoint('https://api.example.org/responses','chat-completions'));
});

test('actual HTTP save, reread, metadata edit and deletion keep canonical Unicode routes and encrypted keys usable',async t=>{
 const f=await fixture(t),entry=connection('https://api.example.org/'+'路径'.repeat(200));
 const created=await f.request(undefined,'PUT',{revision:0,connections:[entry]});assert.equal(created.status,200);
 const read=await f.request();assert.equal(read.status,200);assert.equal(read.value.connections[0].apiUrl,created.value.connections[0].apiUrl);assert.ok(read.value.connections[0].apiUrl.length>2048);
 const providers=await f.request('/api/providers');assert.equal(providers.status,200);assert.ok(providers.value.providers.some(p=>p.id===entry.id));
 const edited=await f.request(undefined,'PUT',{revision:1,connections:[{...payload(read.value.connections[0]),label:'Updated synthetic route'}]});assert.equal(edited.status,200);assert.equal(edited.value.revision,2);
 assert.equal(f.store.resolveConnection(f.owner.user.id,entry.id,2).apiKey,entry.apiKey);assert.ok(!JSON.stringify(edited.value).includes(entry.apiKey));
 const path=join(f.file+'.connections',f.owner.user.id+'.json'),before=await readFile(path);
 assert.equal((await f.request(undefined,'PUT',{revision:1,connections:[]})).status,409);assert.deepEqual(await readFile(path),before);
 assert.equal((await f.request(undefined,'GET',undefined,f.other,{'x-plaude-account-id':f.owner.user.id})).status,403);
 const invalid=connection('https://api.example.org/'+'路'.repeat(2048));assert.equal((await f.request(undefined,'PUT',{revision:2,connections:[invalid]})).status,400);assert.deepEqual(await readFile(path),before);
 const removed=await f.request(undefined,'PUT',{revision:2,connections:[]});assert.equal(removed.status,200);assert.equal(removed.value.connections.length,0);assert.deepEqual(f.store.getConnections(f.other.user.id).connections,[]);assert.equal(f.calls,0);
});

test('legacy authenticated envelopes with expanded URLs recover without rewriting credentials or dropping sibling connections',async t=>{
 const f=await fixture(t),id=f.owner.user.id,original=connection('https://api.example.org/v1');
 f.store.putConnections(id,{revision:0,connections:[original]});
 const key=await readFile(f.file+'.connections.key'),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from('plaude-connections-v1:'+id));
 const legacy={...original,apiUrl:new URL('https://api.example.org/'+'路'.repeat(2010)+'/chat/completions').toString()},sibling={...original,id:'mine-'+('b'.repeat(24)),apiUrl:'https://api.example.org/v1/chat/completions',label:'Sibling preserved'};
 assert.ok(legacy.apiUrl.length>18000&&legacy.apiUrl.length<maximum);
 const data=Buffer.concat([cipher.update(JSON.stringify({revision:1,connections:[legacy,sibling]})),cipher.final()]);
 const path=join(f.file+'.connections',id+'.json');await writeFile(path,JSON.stringify({version:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')}));
 const before=await readFile(path),read=await f.request();assert.equal(read.status,200);assert.equal(read.value.connections[0].apiUrl,legacy.apiUrl);assert.deepEqual(await readFile(path),before);assert.deepEqual(await readFile(f.file+'.connections.key'),key);
 assert.equal(f.store.resolveConnection(id,legacy.id,1).apiKey,original.apiKey);
 const updated=await f.request(undefined,'PUT',{revision:1,connections:read.value.connections.map(payload)});assert.equal(updated.status,200);
 const deleted=await f.request(undefined,'PUT',{revision:2,connections:[payload(updated.value.connections[1])]});assert.equal(deleted.status,200);assert.equal(deleted.value.connections[0].id,sibling.id);assert.equal(f.store.resolveConnection(id,sibling.id,3).apiKey,sibling.apiKey);assert.equal(f.calls,0);
});

test('pinned personal transport uses the same canonical endpoint for expanded Unicode paths',async()=>{
 const canonical=new URL('https://api.example.org/'+'路径'.repeat(200)+'/chat/completions').toString();let calls=0;
 const network=createConnectionNetwork({lookupImpl:async()=>[{address:'8.8.8.8',family:4}],agentFactory:()=>({close:async()=>{}}),fetchImpl:async(url,options)=>{calls++;assert.equal(String(url),canonical);assert.equal(options.redirect,'error');return new Response('synthetic');}});
 const prepared=await network({apiUrl:canonical,protocol:'chat-completions'});try{assert.equal(await(await prepared.fetch(canonical)).text(),'synthetic');await assert.rejects(()=>prepared.fetch('https://other.example.org/chat/completions'));assert.equal(calls,1);}finally{await prepared.close();}
});
