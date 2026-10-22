import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createAccountStore} from '../src/accounts.mjs';
import {createProjectOriginalStore} from '../src/project_originals.mjs';
import {createGatewayServer} from '../src/app.mjs';
import {loadConfig} from '../src/config.mjs';
import {createProjectOriginalClient, ORIGINAL_LIMITS} from '../public/project_originals.js';
const alice='11111111-1111-4111-8111-111111111111', bob='22222222-2222-4222-8222-222222222222';
const projects={projects:Array.from({length:20},(_,p)=>({id:'project-test-'+String(p).padStart(3,'0'),documents:Array.from({length:3},(_,d)=>({id:`document-test-${p}-${d}`}))}))};
function fixture(options={}) {const dir=mkdtempSync(join(tmpdir(),'plaude-originals-')); const root=join(dir,'originals'),requireUser=id=>{if(![alice,bob].includes(id))throw Error('unknown account');},settings={requireUser,getProjects:()=>projects,...options};return {dir,root,settings,store:createProjectOriginalStore(root,settings),dispose:()=>rmSync(dir,{recursive:true,force:true})};}
const target=(n=0)=>({projectId:projects.projects[Math.floor(n/3)].id,documentId:projects.projects[Math.floor(n/3)].documents[n%3].id,name:`example-${n}.txt`});
test('Linux original download refuses symbolic links even when bytes match', {skip: process.platform !== 'linux'}, () => {
  const f=fixture();try { const content=Buffer.from('same bytes'),a=f.store.upload(alice,target(),content).files[0],b=f.store.upload(bob,target(),content).files[0]; const source=join(f.root,alice,a.id+'.bin');rmSync(source);symlinkSync(join(f.root,bob,b.id+'.bin'),source);assert.throws(()=>f.store.download(alice,a.id),e=>e.code==='ELOOP'); }finally{f.dispose();}
});
test('private originals are immutable, isolated, byte exact and survive restart/project removal',()=>{
  const f=fixture();try{
    const content=Buffer.from('Synthetic private original\n蓝鲸'),saved=f.store.upload(alice,target(),content),file=saved.files[0];
    assert.equal(f.store.list(bob).files.length,0);assert.throws(()=>f.store.download(bob,file.id),e=>e.statusCode===404);
    assert.deepEqual(f.store.download(alice,file.id).content,content);assert.deepEqual(f.store.upload(alice,target(),content),saved);
    assert.throws(()=>f.store.upload(alice,target(),Buffer.from('different')),e=>e.statusCode===409);assert.deepEqual(f.store.download(alice,file.id).content,content);
    const restarted=createProjectOriginalStore(f.root,{...f.settings,getProjects:()=>({projects:[]})});assert.deepEqual(restarted.download(alice,file.id).content,content);
    assert.throws(()=>restarted.upload(alice,target(1),content),e=>e.statusCode===409);assert.equal(restarted.remove(alice,file.id).files.length,0);assert.equal(restarted.remove(alice,file.id).files.length,0);
  }finally{f.dispose();}
});
test('single/count/total capacity and metadata failure preserve all prior files',()=>{
  const f=fixture();try{
    const saved=f.store.upload(alice,target(),Buffer.from('old')),old=saved.files[0],index=join(f.root,alice,'index.json'),before=readFileSync(index);
    const broken=createProjectOriginalStore(f.root,{...f.settings,writeIndex:()=>{throw Error('disk write failure');}});
    assert.throws(()=>broken.upload(alice,target(1),Buffer.from('new')),/disk write failure/);assert.deepEqual(readFileSync(index),before);assert.equal(readdirSync(join(f.root,alice)).filter(n=>n.endsWith('.bin')).length,1);
    assert.throws(()=>broken.remove(alice,old.id),/disk write failure/);assert.deepEqual(f.store.download(alice,old.id).content,Buffer.from('old'));
    assert.throws(()=>f.store.upload(alice,target(1),Buffer.alloc(ORIGINAL_LIMITS.maxFileBytes+1)),e=>e.statusCode===413);
    for(let n=1;n<60;n++)f.store.upload(alice,target(n),Buffer.from('x'));
    assert.equal(f.store.list(alice).files.length,60);assert.throws(()=>f.store.upload(alice,{...target(),documentId:'document-extra-01'},Buffer.from('x')),e=>e.statusCode===409);
    const many={projects:[...projects.projects,{id:'project-extra-001',documents:[{id:'document-extra-01'}]}]};const capped=createProjectOriginalStore(f.root,{...f.settings,getProjects:()=>many});assert.throws(()=>capped.upload(alice,{projectId:'project-extra-001',documentId:'document-extra-01',name:'extra.txt'},Buffer.from('x')),e=>e.statusCode===413);
    const large=Buffer.alloc(ORIGINAL_LIMITS.maxFileBytes,7);for(let n=0;n<12;n++)f.store.upload(bob,target(n),large);
    const totalBefore=f.store.list(bob);assert.throws(()=>f.store.upload(bob,target(12),large),e=>e.statusCode===413);assert.deepEqual(f.store.list(bob),totalBefore);assert.deepEqual(f.store.download(bob,totalBefore.files[0].id).content,large);
  }finally{f.dispose();}
});
test('failed deletion cleanup stays visible and charged for retry; corruption refuses replacement',()=>{
  const f=fixture();try{
    const first=f.store.upload(alice,target(),Buffer.from('old')),file=first.files[0];const failed=createProjectOriginalStore(f.root,{...f.settings,removeBlob:()=>{throw Error('locked file');}});
    const pending=failed.remove(alice,file.id);assert.equal(pending.files[0].cleanupPending,true);assert.equal(pending.usedBytes,first.usedBytes);assert.equal(readFileSync(join(f.root,alice,file.id+'.bin'),'utf8'),'old');
    assert.equal(f.store.remove(alice,file.id).usedBytes,0);assert.equal(f.store.list(alice).files.length,0);
    const saved=f.store.upload(alice,target(),Buffer.from('original'));writeFileSync(join(f.root,alice,saved.files[0].id+'.bin'),'tampered');assert.throws(()=>f.store.download(alice,saved.files[0].id),/mismatch/);
    const index=join(f.root,alice,'index.json');writeFileSync(index,'broken index');assert.throws(()=>f.store.upload(alice,target(1),Buffer.from('new')));assert.equal(readFileSync(index,'utf8'),'broken index');
    assert.throws(()=>f.store.upload(bob,{...target(),name:'../evil.pdf'},Buffer.from('x')),/文件名/);
  }finally{f.dispose();}
});
test('HTTP originals require correct account/origin, preserve bytes and force private attachment download',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'plaude-original-api-')),accounts=createAccountStore(join(dir,'accounts.json'));
  const a=await accounts.register({username:'original-alice',password:'original-test-password-2026'}),b=await accounts.register({username:'original-bob',password:'original-test-password-2026'});
  const doc={id:'document-original-test',name:'original.pdf',sections:[{label:'第 1 页',text:'saved text'}],enabled:true},project={id:'project-original-test',name:'Original QA',instructions:'',revision:0,documents:[doc]};
  accounts.putProjects(a.user.id,{revision:0,projects:{version:1,projects:[project],links:[]}});
  const server=createGatewayServer({config:loadConfig({NODE_ENV:'test',LOCAL_DEV_NO_AUTH:'0',GATEWAY_ACCESS_TOKEN:'original-test-key-abcdefghijklmnopqrstuvwxyz',DEEPSEEK_API_KEY:'sk-test-abcdefghijklmnopqrstuvwxyz'}),accountStore:accounts,fetchImpl:async()=>{throw Error('No model calls');}});server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>{server.closeAllConnections();server.close();rmSync(dir,{recursive:true,force:true});});
  const origin='http://127.0.0.1:'+server.address().port,url=origin+'/api/account/project-files',cookie='plaude_session='+a.sessionToken,headers={cookie,'x-plaude-account-id':a.user.id};
  assert.equal((await fetch(url)).status,401);assert.equal((await fetch(url,{headers:{...headers,'x-plaude-account-id':b.user.id}})).status,403);
  const path='?'+new URLSearchParams({projectId:project.id,documentId:doc.id,name:'原始报告.pdf'}),content=Buffer.from('%PDF-synthetic-qa\0DATA');
  const mutation={...headers,origin,'x-plaude-client':'1','content-type':'application/octet-stream'};
  assert.equal((await fetch(url+path,{method:'POST',headers:{...mutation,origin:'https://evil.invalid'},body:content})).status,403);
  const saved=await fetch(url+path,{method:'POST',headers:mutation,body:content});assert.equal(saved.status,201);const result=await saved.json(),file=result.files[0];
  const r=await fetch(url+'/'+file.id,{headers});assert.equal(r.status,200);assert.match(r.headers.get('content-disposition'),/^attachment;.*filename\*=/);assert.equal(r.headers.get('content-type'),'application/octet-stream');assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.match(r.headers.get('content-security-policy'),/sandbox/);assert.deepEqual(Buffer.from(await r.arrayBuffer()),content);
  assert.equal((await fetch(url+'/'+file.id,{headers:{cookie:'plaude_session='+b.sessionToken,'x-plaude-account-id':b.user.id}})).status,404);
  assert.equal((await fetch(url+path,{method:'POST',headers:mutation,body:Buffer.alloc(ORIGINAL_LIMITS.maxFileBytes+1)})).status,413);
  const deleted=await fetch(url+'?id='+file.id,{method:'DELETE',headers:mutation});assert.equal(deleted.status,200);assert.equal((await deleted.json()).files.length,0);assert.deepEqual(accounts.getProjects(a.user.id).projects.projects[0].documents,[doc]);
});
test('browser client rejects wrong account responses, checksum failures and account switches mid-download',async()=>{
  let owner=alice;const file={id:'33333333-3333-4333-8333-333333333333',projectId:'project-original-test',documentId:'document-original-test',name:'sample.txt',size:3,sha256:'0'.repeat(64),createdAt:0,cleanupPending:false};
  const client=createProjectOriginalClient({userId:alice,currentAccount:()=>owner,fetchImpl:async()=>new Response(new Blob(['abc']))});
  await assert.rejects(client.download(file),/校验失败/);owner=bob;await assert.rejects(client.list(),/账户已切换/);
  owner=alice;const wrong=createProjectOriginalClient({userId:alice,currentAccount:()=>owner,fetchImpl:async()=>new Response(JSON.stringify({userId:bob,files:[],usedBytes:0}))});await assert.rejects(wrong.list(),/账户或列表/);
  const switching=createProjectOriginalClient({userId:alice,currentAccount:()=>owner,fetchImpl:async()=>{owner=bob;return new Response('abc');}});await assert.rejects(switching.download(file),/账户已切换/);
});
