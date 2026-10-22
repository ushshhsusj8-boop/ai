import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtempSync,rmSync,readdirSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createProjectOriginalStore} from '../src/project_originals.mjs';
import {createAccountStore} from '../src/accounts.mjs';
import {createGatewayServer} from '../src/app.mjs';
import {loadConfig} from '../src/config.mjs';
import {originalZipPlan,originalZipChunks,originalSnapshotText} from '../public/original_zip.js';
import {inspectOriginalBackup,planOriginalRestore} from '../public/original_restore.js';
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const digest=value=>createHash('sha256').update(value).digest('hex');
const snapshot=value=>digest(originalSnapshotText(value.files));
const contents=[Buffer.alloc(373,65),Buffer.from('原文件第二份')];
const files=contents.map((content,i)=>({id:randomUUID(),projectId:'qa-restore-project',documentId:'qa-restore-document-'+i,name:'恢复资料'+i+'.txt',size:content.length,sha256:digest(content),createdAt:100,cleanupPending:false}));
const archiveEnvelope={userId:owner,files,usedBytes:contents.reduce((n,c)=>n+c.length,0)};
function zip(envelope=archiveEnvelope){const plan=originalZipPlan(envelope);return new Blob([...originalZipChunks(plan,file=>contents[files.findIndex(f=>f.id===file.id)])]);}
function fixture(t,overrides={}){
  const root=mkdtempSync(join(tmpdir(),'original-restore-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const options={requireUser:id=>{if(![owner,other].includes(id))throw Error('unknown user');},getProjects:()=>({projects:[{id:'qa-restore-project',documents:[...files.map(f=>({id:f.documentId})),{id:'qa-restore-later'}]}]}),...overrides};
  return{root,options,store:createProjectOriginalStore(root,options)};
}
test('own bounded ZIP is fully checked before preview; corrupt, wrong account and empty data are refused',async()=>{
  const blob=zip(),checked=await inspectOriginalBackup(blob,owner);assert.equal(checked.slices.length,2);
  for(const slice of checked.slices)assert.deepEqual(Buffer.from(await blob.slice(slice.offset,slice.offset+slice.size).arrayBuffer()),contents[files.findIndex(file=>file.id===slice.file.id)]);
  await assert.rejects(inspectOriginalBackup(blob,other),/原账户/);await assert.rejects(inspectOriginalBackup(blob.slice(0,blob.size-1),owner),/不完整/);
  const bytes=Buffer.from(await blob.arrayBuffer());bytes[checked.slices[0].offset]^=1;await assert.rejects(inspectOriginalBackup(new Blob([bytes]),owner),/校验失败/);
  await assert.rejects(inspectOriginalBackup({size:65*1024*1024+1},owner),/65 MiB/);
});
test('restore appends original bytes in one commit and duplicates are idempotent even without current project',async t=>{
  const f=fixture(t,{getProjects:()=>({projects:[]})}),empty=f.store.list(owner);
  const restored=await f.store.restore(owner,zip(),snapshot(empty));assert.equal(restored.files.length,2);
  for(let i=0;i<2;i++)assert.deepEqual(f.store.download(owner,files[i].id).content,contents[i]);
  const index=join(f.root,owner,'index.json'),before=readFileSync(index);assert.deepEqual(await f.store.restore(owner,zip(),snapshot(restored)),restored);assert.deepEqual(readFileSync(index),before);
  assert.equal(f.store.list(other).files.length,0);
});
test('list changes, content conflicts and full combined quota refuse the entire batch',async t=>{
  const f=fixture(t),empty=f.store.list(owner);
  f.store.upload(owner,{projectId:files[0].projectId,documentId:files[0].documentId,name:files[0].name},Buffer.from('different original'));
  const saved=f.store.list(owner),index=join(f.root,owner,'index.json'),before=readFileSync(index),disk=readdirSync(join(f.root,owner)).sort();
  await assert.rejects(f.store.restore(owner,zip(),snapshot(empty)),{statusCode:409});
  await assert.rejects(f.store.restore(owner,zip(),snapshot(saved)),/冲突/);assert.deepEqual(readFileSync(index),before);assert.deepEqual(readdirSync(join(f.root,owner)).sort(),disk);
  const current={userId:owner,files:Array.from({length:60},(_,i)=>({...files[0],id:randomUUID(),documentId:'full-document-'+i})),usedBytes:60*files[0].size};
  assert.throws(()=>planOriginalRestore(current,archiveEnvelope),/超过60/);
  const pending={...saved,files:saved.files.map(f=>({...f,cleanupPending:true}))};assert.throws(()=>planOriginalRestore(pending,archiveEnvelope),/冲突/);
});
test('failed final index write removes every staged blob and leaves all existing data untouched',async t=>{
  const f=fixture(t);f.store.upload(owner,{projectId:'qa-restore-project',documentId:'qa-restore-later',name:'keep.txt'},Buffer.from('existing'));
  const saved=f.store.list(owner),index=join(f.root,owner,'index.json'),before=readFileSync(index),disk=readdirSync(join(f.root,owner)).sort();
  const failed=createProjectOriginalStore(f.root,{...f.options,writeIndex:()=>{throw Error('disk write failure');}});
  await assert.rejects(failed.restore(owner,zip(),snapshot(saved)),/disk write failure/);assert.deepEqual(readFileSync(index),before);assert.deepEqual(readdirSync(join(f.root,owner)).sort(),disk);assert.equal(f.store.download(owner,saved.files[0].id).content.toString(),'existing');
});
test('concurrent upload during asynchronous staging preserves new upload and rolls back only this restore',async t=>{
  const f=fixture(t);let reads=0;
  class ChangingBlob extends Blob{slice(...args){const part=super.slice(...args),native=part.arrayBuffer.bind(part);part.arrayBuffer=async()=>{const data=await native();if(part.size===373&&++reads===2)f.store.upload(owner,{projectId:'qa-restore-project',documentId:'qa-restore-later',name:'later.txt'},Buffer.from('concurrent keep'));return data;};return part;}}
  const blob=new ChangingBlob([zip()]);await assert.rejects(f.store.restore(owner,blob,snapshot(f.store.list(owner))),/列表已变化/);
  const saved=f.store.list(owner);assert.equal(saved.files.length,1);assert.equal(f.store.download(owner,saved.files[0].id).content.toString(),'concurrent keep');assert.equal(readdirSync(join(f.root,owner)).filter(n=>n.endsWith('.bin')).length,1);
});
test('HTTP restore requires same-origin account session, validates source owner and returns exact private original bytes',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'original-restore-http-')),accounts=createAccountStore(join(dir,'accounts.json'));
  const user=await accounts.register({username:'qa-restore-http',password:'qa-restore-password-2026'}),config=loadConfig({NODE_ENV:'test',GATEWAY_ACCESS_TOKEN:'qa-restore-invite-abcdefghijklmnopqrstuvwxyz',DEEPSEEK_API_KEY:'sk-test-abcdefghijklmnopqrstuvwxyz'});
  const server=createGatewayServer({config,accountStore:accounts,fetchImpl:async()=>{throw Error('QA forbids model');}});server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>{server.closeAllConnections();server.close();rmSync(dir,{recursive:true,force:true});});
  const origin='http://127.0.0.1:'+server.address().port,url=origin+'/api/account/project-files/restore?snapshot='+snapshot(accounts.listOriginals(user.user.id));
  const headers={cookie:'plaude_session='+user.sessionToken,origin,'x-plaude-client':'1','x-plaude-account-id':user.user.id,'content-type':'application/octet-stream'};
  assert.equal((await fetch(url,{method:'POST',headers:{origin,'x-plaude-client':'1','content-type':'application/octet-stream'},body:zip()})).status,401);
  assert.equal((await fetch(url,{method:'POST',headers:{...headers,origin:'https://other.example'},body:zip()})).status,403);
  assert.equal((await fetch(url,{method:'POST',headers,body:zip()})).status,400);
  assert.equal(accounts.listOriginals(user.user.id).files.length,0);
  const ownZip=zip({...archiveEnvelope,userId:user.user.id}),response=await fetch(url,{method:'POST',headers,body:ownZip});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  const saved=await response.json();assert.equal(saved.files.length,2);assert.deepEqual(accounts.downloadOriginal(user.user.id,files[0].id).content,contents[0]);
  assert.equal((await fetch(url,{method:'POST',headers,body:ownZip})).status,409);
});
