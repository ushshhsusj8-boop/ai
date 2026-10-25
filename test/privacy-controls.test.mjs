import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {request as httpRequest} from 'node:http';
import {randomUUID} from 'node:crypto';
import {createAccountStore} from '../src/accounts.mjs';
import {createGatewayServer} from '../src/app.mjs';
import {loadConfig} from '../src/config.mjs';
import {withSiteLimits} from '../src/limit_context.mjs';
import {DEVELOPER_LIMITS} from '../public/site_limits.js';
import {createPersonalInstructionClient,personalInstructionContext} from '../public/personal_instructions.js';

async function fixture(t){
 const directory=await mkdtemp(join(tmpdir(),'plaude-privacy-controls-')),file=join(directory,'accounts.json'),store=createAccountStore(file);
 const owner=await store.register({username:'qa-controls-owner',password:'synthetic-controls-password-2026'}),other=await store.register({username:'qa-controls-other',password:'synthetic-controls-password-2026'});let calls=0;
 const config=loadConfig({NODE_ENV:'test',BIND_HOST:'127.0.0.1',GATEWAY_ACCESS_TOKEN:'qa-controls-token-abcdefghijklmnopqrstuvwxyz',DEEPSEEK_API_KEY:'sk-test-abcdefghijklmnopqrstuvwxyz',RATE_LIMIT_PER_MINUTE:'600'});
 const server=createGatewayServer({config,accountStore:store,fetchImpl:async()=>{calls++;throw Error('Real model calls forbidden');}});server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(directory,{recursive:true,force:true});});const origin='http://127.0.0.1:'+server.address().port;
 const request=(path,method='GET',body,user=owner,extra={})=>fetch(origin+path,{method,headers:{cookie:'plaude_session='+user.sessionToken,'x-plaude-client':'1','x-plaude-account-id':user.user.id,...(method==='GET'?{}:{origin,'content-type':'application/json'}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
 return{file,store,owner,other,request,origin,get calls(){return calls;}};
}
const memories=()=>({enabled:true,entries:Array.from({length:42},(_,i)=>({id:'qa-memory-'+i,text:'测'.repeat(1200)+i,enabled:true,always:true}))});

test('large existing memories can actually turn off through the HTTP route after lowering budgets, without admitting oversized edits',async t=>{
 const f=await fixture(t),id=f.owner.user.id,original=withSiteLimits(DEVELOPER_LIMITS,()=>f.store.putMemories(id,{revision:0,library:memories()}));
 const off={...original.library,enabled:false},body={revision:1,library:off};assert.ok(Buffer.byteLength(JSON.stringify(body))>128*1024);
 const response=await f.request('/api/account/memories','PUT',body);assert.equal(response.status,200);assert.deepEqual((await response.json()).library,off);
 const raw=await readFile(join(f.file+'.memories',id+'.json'));
 const changed=structuredClone(off);changed.entries[0].text+='edited';assert.equal((await f.request('/api/account/memories','PUT',{revision:2,library:changed})).status,400);
 assert.equal((await f.request('/api/account/memories','PUT',{revision:1,library:off})).status,409);
 assert.equal((await f.request('/api/account/memories','PUT',{revision:2,library:off},f.other,{'x-plaude-account-id':id})).status,403);
 assert.deepEqual(await readFile(join(f.file+'.memories',id+'.json')),raw);assert.equal(f.calls,0);
});

test('revoking one old large share through HTTP immediately invalidates its token while other over-budget shares and accounts stay intact',async t=>{
 const f=await fixture(t),id=f.owner.user.id,created=[];
 withSiteLimits(DEVELOPER_LIMITS,()=>{for(let i=0;i<4;i++)created.push(f.store.createShare(id,{revision:i,requestId:randomUUID(),expiresDays:7,snapshot:{title:'synthetic '+i,messages:[{role:'assistant',content:String(i)+'x'.repeat(800000)}]}}).created);});
 const other=f.store.createShare(f.other.user.id,{revision:0,requestId:randomUUID(),expiresDays:7,snapshot:{title:'other',messages:[{role:'user',content:'other synthetic text'}]}}).created;
 const response=await f.request('/api/account/shares/'+created[0].id,'DELETE',{revision:4});assert.equal(response.status,200);assert.equal((await response.json()).shares.length,3);
 const publicRead=token=>fetch(f.origin+'/api/share-view',{headers:{'x-plaude-share-token':token}});
 assert.equal((await publicRead(created[0].token)).status,404);assert.equal((await publicRead(created[1].token)).status,200);assert.equal((await publicRead(other.token)).status,200);
 const raw=await readFile(f.file+'.shares.json');assert.equal((await f.request('/api/account/shares/'+created[1].id,'DELETE',{revision:4})).status,409);
 assert.equal((await f.request('/api/account/shares/'+created[1].id,'DELETE',{revision:1},f.other)).status,404);
 assert.equal((await f.request('/api/account/shares','POST',{revision:5,requestId:randomUUID(),expiresDays:7,snapshot:{title:'new',messages:[{role:'user',content:'new synthetic'}]}})).status,413);
 assert.deepEqual(await readFile(f.file+'.shares.json'),raw);assert.equal(f.calls,0);
});

test('old long personal instructions can be disabled intact through both client and HTTP, while edits, re-enabling and stale writes remain blocked',async t=>{
 const f=await fixture(t),id=f.owner.user.id,original=withSiteLimits(DEVELOPER_LIMITS,()=>f.store.putInstructions(id,{revision:0,instructions:{enabled:true,text:'测'.repeat(6000)}}));
 const client=createPersonalInstructionClient({userId:id,fetchImpl:(path,o)=>f.request(path,o.method,o.body?JSON.parse(o.body):undefined)});await client.load();
 const off={...original.instructions,enabled:false};await client.save(off,1);assert.equal(f.store.listInstructions(id).instructions.text,original.instructions.text);
 assert.throws(()=>personalInstructionContext(original.instructions));
 assert.deepEqual(await client.prepare(),{chars:0});assert.equal(personalInstructionContext(off),'');
 const raw=await readFile(join(f.file+'.instructions',id+'.json'));
 for(const instructions of [{...off,enabled:true},{...off,text:off.text+'edit'},{...off,extra:true}])assert.equal((await f.request('/api/account/instructions','PUT',{revision:2,instructions})).status,400);
 assert.equal((await f.request('/api/account/instructions','PUT',{revision:1,instructions:off})).status,409);
 assert.deepEqual(await readFile(join(f.file+'.instructions',id+'.json')),raw);
 const cleared=await f.request('/api/account/instructions','PUT',{revision:2,instructions:{enabled:false,text:''}});assert.equal(cleared.status,200);assert.equal(f.calls,0);
});

test('compatible HTTP envelopes retain a finite hard body limit and reject oversized declarations before reading their payload',async t=>{
 const f=await fixture(t);
 for(const path of ['/api/account/memories','/api/account/instructions']){
  const status=await new Promise((resolve,reject)=>{
   const req=httpRequest(f.origin+path,{method:'PUT',agent:false,headers:{cookie:'plaude_session='+f.owner.sessionToken,'x-plaude-client':'1','x-plaude-account-id':f.owner.user.id,origin:f.origin,'content-type':'application/json','content-length':String(1024*1024*1024)}},response=>{response.resume();response.on('end',()=>resolve(response.statusCode));});
   req.on('error',reject);req.setTimeout(3000,()=>req.destroy(Error('Oversize declaration was not rejected before payload read')));req.flushHeaders();req.end();
  });
  assert.equal(status,413);
 }
 assert.equal(f.calls,0);
});
