import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {once} from 'node:events';
import {createAccountStore} from '../src/accounts.mjs';
import {createGatewayServer} from '../src/app.mjs';
import {loadConfig} from '../src/config.mjs';
import {validateShareSnapshot} from '../public/share_tools.js';
const snapshot={title:'合成只读标题',messages:[{role:'user',content:'合成所选问题'},{role:'assistant',content:'合成所选回答 <script>禁止执行</script>'}]};
test('share validation rejects hidden fields and oversized selections without truncating text',()=>{
 assert.deepEqual(validateShareSnapshot(snapshot),snapshot);for(const value of [{...snapshot,ownerId:'fake'},{...snapshot,messages:[{...snapshot.messages[0],images:[{}]}]},{...snapshot,messages:[{role:'system',content:'secret'}]},{...snapshot,messages:[]},{...snapshot,messages:Array.from({length:101},()=>snapshot.messages[0])},{...snapshot,messages:[{role:'user',content:'中'.repeat(45000)}]}])assert.throws(()=>validateShareSnapshot(value));
});
test('revocable snapshots protect ownership, consent boundaries, expiry and atomic persistence',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'plaude-share-test-')),file=join(dir,'accounts.json');let time=Date.now(),models=0;const store=createAccountStore(file,{now:()=>time});
 const password='qa-share-password-2026',a=await store.register({username:'qa-share-alice',password}),b=await store.register({username:'qa-share-bob',password});
 const original={id:'qa-share-original',title:'原聊天',provider:'deepseek',model:'deepseek-flash',updatedAt:1,messages:[...snapshot.messages,{role:'assistant',content:'未选择的文字不得公开'}]};store.putConversation(a.user.id,original.id,{revision:0,conversation:original});const before=store.listConversations(a.user.id);
 const config=loadConfig({NODE_ENV:'test',BIND_HOST:'127.0.0.1',DEFAULT_PROVIDER:'deepseek',GATEWAY_ACCESS_TOKEN:'qa-share-abcdefghijklmnopqrstuvwxyz',DEEPSEEK_API_KEY:'sk-test-abcdefghijklmnopqrstuvwxyz',RATE_LIMIT_PER_MINUTE:'600'});
 const server=createGatewayServer({config,accountStore:store,fetchImpl:async()=>{models++;throw Error('Models forbidden');}});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});const origin='http://127.0.0.1:'+server.address().port;
 const request=(path,user=a,method='GET',body,extra={})=>fetch(origin+path,{method,headers:{...(user?{cookie:'plaude_session='+user.sessionToken,'x-plaude-client':'1','x-plaude-account-id':user.user.id}:{}),...(method==='GET'?{}:{origin,'content-type':'application/json'}),...extra},...(body?{body:JSON.stringify(body)}:{})});
 const create=(revision=0,extra={})=>({revision,snapshot,expiresDays:7,requestId:randomUUID(),...extra});let created,submitted;
 await t.test('listing and creation require current identity and same-origin mutations',async()=>{
  assert.equal((await request('/api/account/shares',null)).status,401);assert.equal((await request('/api/account/shares',a,'GET',undefined,{'x-plaude-account-id':b.user.id})).status,403);
  assert.equal((await request('/api/account/shares',a,'POST',create(),{origin:'https://foreign.example'})).status,403);assert.equal((await request('/api/account/shares',a,'POST',{...create(),userId:b.user.id})).status,400);assert.equal(store.listShares(a.user.id).shares.length,0);
 });
 await t.test('only explicit snapshots are published; public reading requires no login or site invitation',async()=>{
  submitted=create();const response=await request('/api/account/shares',a,'POST',submitted);assert.equal(response.status,201);created=(await response.json()).created;assert.match(created.token,/^[A-Za-z0-9_-]{43}$/);
  const publicResponse=await request('/api/share-view',null,'GET',undefined,{'x-plaude-share-token':created.token});assert.equal(publicResponse.status,200);assert.equal(publicResponse.headers.get('cache-control'),'no-store');const data=await publicResponse.json();assert.deepEqual(data.snapshot,snapshot);assert.deepEqual(Object.keys(data).sort(),['expiresAt','expiresInMs','snapshot']);assert.equal((await request('/api/share-view',null,'POST',{})).status,405);assert.equal((await request('/api/account/shares',null)).status,401);const activity=JSON.stringify(await(await request('/api/activity')).json());assert.ok(!activity.includes(created.token));assert.ok(!activity.includes('合成所选回答'));assert.ok(!JSON.stringify(data).includes('未选择的文字'));
  const onDisk=await readFile(file+'.shares.json','utf8');assert.ok(!onDisk.includes(created.token));assert.ok(onDisk.includes(createHash('sha256').update(created.token).digest('hex')));assert.deepEqual(createAccountStore(file,{now:()=>time}).resolveShare(created.token).snapshot,snapshot);
 });
 await t.test('lists reveal neither another account nor link tokens or message bodies',async()=>{
  const own=await(await request('/api/account/shares')).json();assert.equal(own.revision,1);assert.equal(own.shares.length,1);assert.ok(!JSON.stringify(own).includes(created.token));assert.ok(!JSON.stringify(own).includes('合成所选回答'));assert.equal((await(await request('/api/account/shares',b)).json()).shares.length,0);
 });
 await t.test('lost acknowledgements and stale lists cannot create duplicate or unintended shares',async()=>{
  assert.equal((await request('/api/account/shares',a,'POST',submitted)).status,409);assert.equal((await request('/api/account/shares',a,'POST',create(0))).status,409);assert.equal(store.listShares(a.user.id).shares.length,1);
  assert.equal((await request('/api/account/shares/'+created.id,b,'DELETE',{revision:0})).status,404);assert.equal(store.resolveShare(created.token).snapshot.title,snapshot.title);
 });
 await t.test('later chat edits are excluded and revocation erases the stored snapshot without editing the original',async()=>{
  store.putConversation(a.user.id,original.id,{revision:1,conversation:{...original,updatedAt:2,messages:[...original.messages,{role:'user',content:'后续新消息不得公开'}]}});assert.ok(!JSON.stringify(store.resolveShare(created.token)).includes('后续新消息'));
  const chatBefore=store.listConversations(a.user.id);assert.equal((await request('/api/account/shares/'+created.id,a,'DELETE',{revision:0})).status,409);assert.equal((await request('/api/account/shares/'+created.id,a,'DELETE',{revision:1})).status,200);
  for(const token of [created.token,'x'.repeat(43),'malformed'])assert.equal((await request('/api/share-view',null,'GET',undefined,{'x-plaude-share-token':token})).status,404);
  assert.deepEqual(store.listConversations(a.user.id),chatBefore);assert.ok(!(await readFile(file+'.shares.json','utf8')).includes('合成所选回答'));assert.ok(before.conversations.length===1);
 });
 await t.test('expiry, capacity and corrupt storage fail closed and preserve existing records',async()=>{
  let rev=2,expiring;for(let i=0;i<20;i++){const value=store.createShare(a.user.id,create(rev++,{expiresDays:1}));expiring=value.created;}
  assert.throws(()=>store.createShare(a.user.id,create(rev)),/20份/);time+=86400001;assert.throws(()=>store.resolveShare(expiring.token),/失效/);assert.ok(store.listShares(a.user.id).shares.every(s=>s.expired));
  const raw=await readFile(file+'.shares.json','utf8');await writeFile(file+'.shares.json','corrupt');assert.equal((await request('/api/share-view',null,'GET',undefined,{'x-plaude-share-token':expiring.token})).status,500);assert.throws(()=>store.createShare(a.user.id,create(rev)));assert.equal(await readFile(file+'.shares.json','utf8'),'corrupt');await writeFile(file+'.shares.json',raw);assert.equal(models,0);
 });
});
