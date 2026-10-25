import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep,basename} from 'node:path';
import {once} from 'node:events';
import {request as httpRequest} from 'node:http';
import {createAccountStore} from '../src/accounts.mjs';
import {createGatewayServer} from '../src/app.mjs';
import {loadConfig} from '../src/config.mjs';
import {withSiteLimits} from '../src/limit_context.mjs';
import {DEVELOPER_LIMITS,LEGACY_LIMITS,MAXIMUM_LIMITS} from '../public/site_limits.js';
import {cleanupConnections,cleanupPayload} from './connection-cleanup.fixture.mjs';
async function fixture(t,{http=false}={}){
 const directory=await mkdtemp(join(tmpdir(),'plaude-connection-cleanup-')),file=join(directory,'accounts.json'),store=createAccountStore(file);
 const owner=await store.register({username:'qa-connections-owner',password:'synthetic-connections-password-2026'}),other=await store.register({username:'qa-connections-other',password:'synthetic-other-password-2026'});
 let server,origin,calls=0;
 if(http){server=createGatewayServer({config:loadConfig({NODE_ENV:'test',GATEWAY_ACCESS_TOKEN:'qa-connection-cleanup-abcdefghijklmnopqrstuvwxyz',DEEPSEEK_API_KEY:'sk-synthetic-abcdefghijklmnopqrstuvwxyz'}),accountStore:store,fetchImpl:async()=>{calls++;throw Error('Real models forbidden');}});server.listen(0,'127.0.0.1');await once(server,'listening');origin='http://127.0.0.1:'+server.address().port;}
 t.after(async()=>{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}const target=resolve(directory);assert.ok(target.startsWith(resolve(tmpdir())+sep)&&basename(target).startsWith('plaude-connection-cleanup-'));await rm(target,{recursive:true,force:true});});
 const request=(method='GET',body,user=owner,extra={})=>fetch(origin+'/api/account/connections',{method,headers:{cookie:'plaude_session='+user.sessionToken,'x-plaude-client':'1','x-plaude-account-id':user.user.id,...(method==='GET'?{}:{origin,'content-type':'application/json'}),...extra},...(body?{body:JSON.stringify(body)}:{})});
 return{directory,file,store,owner,other,request,origin,get calls(){return calls;}};
}
test('lower connection counts allow deleting one old entry while retained connections and keys stay unchanged',async t=>{
 const f=await fixture(t),original=cleanupConnections(15),id=f.owner.user.id;
 const before=withSiteLimits(DEVELOPER_LIMITS,()=>f.store.putConnections(id,{revision:0,connections:original}));
 const key=await readFile(f.file+'.connections.key');
 const saved=withSiteLimits(LEGACY_LIMITS,()=>f.store.putConnections(id,{revision:before.revision,connections:cleanupPayload(before.connections.slice(1))}));
 assert.equal(saved.connections.length,14);assert.equal(saved.revision,2);assert.equal(Object.hasOwn(saved.connections[0],'apiKey'),false);
 assert.equal(f.store.resolveConnection(id,original[1].id,2).apiKey,original[1].apiKey);assert.throws(()=>f.store.resolveConnection(id,original[0].id,2),e=>e.statusCode===409);
 assert.deepEqual(await readFile(f.file+'.connections.key'),key);assert.deepEqual(f.store.getConnections(f.other.user.id).connections,[]);
});
test('old over-budget model lists can remain during exact deletion, while mixed edits and stale writes preserve prior bytes',async t=>{
 const f=await fixture(t),id=f.owner.user.id,original=cleanupConnections(3,32);
 const view=withSiteLimits(DEVELOPER_LIMITS,()=>f.store.putConnections(id,{revision:0,connections:original}));
 const target=join(f.file+'.connections',id+'.json'),before=await readFile(target);
 for(const change of [c=>({...c,label:'changed'}),c=>({...c,apiKey:'qa-replaced-key'}),c=>({...c,models:c.models.slice(1),model:c.models[1]})]){
  const next=cleanupPayload(view.connections.slice(1));next[0]=change(next[0]);assert.throws(()=>withSiteLimits(LEGACY_LIMITS,()=>f.store.putConnections(id,{revision:1,connections:next})));assert.deepEqual(await readFile(target),before);
 }
 const saved=withSiteLimits(LEGACY_LIMITS,()=>f.store.putConnections(id,{revision:1,connections:cleanupPayload(view.connections.slice(1))}));
 assert.equal(saved.connections.length,2);assert.equal(saved.connections[0].models.length,32);assert.equal(saved.revision,2);
 const after=await readFile(target);assert.throws(()=>f.store.putConnections(id,{revision:1,connections:[]}),e=>e.statusCode===409);assert.deepEqual(await readFile(target),after);
});
test('large retained connection lists can be deleted through real HTTP after lowering budgets without admitting new writes',async t=>{
 const f=await fixture(t,{http:true}),id=f.owner.user.id;
 const view=withSiteLimits(DEVELOPER_LIMITS,()=>f.store.putConnections(id,{revision:0,connections:cleanupConnections(8,128)}));
 const body={revision:1,connections:cleanupPayload(view.connections.slice(1))};assert.ok(Buffer.byteLength(JSON.stringify(body))>128*1024);
 const response=await f.request('PUT',body);assert.equal(response.status,200);const result=await response.json();assert.equal(result.connections.length,7);assert.equal(result.revision,2);
 const raw=await readFile(join(f.file+'.connections',id+'.json'));
 assert.equal((await f.request('PUT',{revision:1,connections:[]})).status,409);
 assert.equal((await f.request('PUT',{revision:2,connections:[...cleanupPayload(result.connections),{...cleanupConnections(20)[19]}]})).status,400);
 assert.equal((await f.request('GET',undefined,f.other,{'x-plaude-account-id':id})).status,403);
 assert.deepEqual(await readFile(join(f.file+'.connections',id+'.json')),raw);assert.equal(f.calls,0);
 assert.ok(!JSON.stringify(result).includes('qa-synthetic-key'));assert.equal(f.store.getConnections(f.other.user.id).connections.length,0);
});
test('connection cleanup keeps a fixed hard request boundary and rejects oversized declarations without reading a body',async t=>{
 const f=await fixture(t,{http:true}),bound=MAXIMUM_LIMITS.connections*(MAXIMUM_LIMITS.connectionModels*256+8192);
 const status=await new Promise((resolve,reject)=>{const req=httpRequest(f.origin+'/api/account/connections',{method:'PUT',agent:false,headers:{cookie:'plaude_session='+f.owner.sessionToken,'x-plaude-client':'1','x-plaude-account-id':f.owner.user.id,origin:f.origin,'content-type':'application/json','content-length':String(bound+1)}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.setTimeout(3000,()=>req.destroy(Error('Hard limit waited for payload')));req.flushHeaders();req.end();});
 assert.equal(status,413);assert.equal(f.calls,0);
});
