import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {createAccountStore} from '../src/accounts.mjs';
import {createGatewayServer} from '../src/app.mjs';
import {loadConfig} from '../src/config.mjs';
import {originalZipPlan,originalZipChunks,verifyOriginalZip,originalSnapshotText,crc32,MAX_ORIGINAL_ZIP_BYTES} from '../public/original_zip.js';
import {createProjectOriginalClient} from '../public/project_originals.js';
const userId='11111111-1111-4111-8111-111111111111',contents=[new TextEncoder().encode('原始文件\nBLUE7392'),new Uint8Array([0,255,3,20,70])];
const files=contents.map((content,i)=>({id:`33333333-3333-4333-8333-33333333333${i}`,projectId:'project-zip-test',documentId:'document-zip-test-'+i,name:i?'同名资料.pdf':'同名资料.txt',size:content.length,sha256:createHash('sha256').update(content).digest('hex'),createdAt:100,cleanupPending:false}));
const envelope={userId,files,usedBytes:files.reduce((n,f)=>n+f.size,0)};
const encoded=()=>{const plan=originalZipPlan(envelope,'2026-10-10T00:00:00.000Z'),parts=[...originalZipChunks(plan,f=>contents[files.findIndex(v=>v.id===f.id)])];return {plan,bytes:Buffer.concat(parts)};};
test('client exports verified ZIP only; interrupted downloads and account changes return no archive',async()=>{
  const {bytes}=encoded(),headers={'content-length':String(bytes.length)},make=fetchImpl=>createProjectOriginalClient({userId,currentAccount:()=>userId,fetchImpl});
  const client=make(async()=>new Response(bytes,{headers}));assert.equal((await client.export(envelope)).size,bytes.length);
  const interrupted=make(async()=>new Response(new ReadableStream({start(c){c.error(new TypeError('connection interrupted'));}}),{headers}));await assert.rejects(interrupted.export(envelope),/下载中断/);
  let current=userId;const switched=createProjectOriginalClient({userId,currentAccount:()=>current,fetchImpl:async()=>{current='other-user';return new Response(bytes,{headers});}});await assert.rejects(switched.export(envelope),/账户已切换/);
});
test('ZIP CRC matches standard vector, archive has exact entries and is read by independent Python ZIP reader',async t=>{
  assert.equal(crc32(new TextEncoder().encode('123456789')),0xcbf43926);
  const {plan,bytes}=encoded();assert.equal(bytes.length,plan.size);const manifest=await verifyOriginalZip(new Blob([bytes]),envelope);assert.equal(manifest.files.length,2);assert.equal(manifest.files[0].name,files[0].name);
  const dir=mkdtempSync(join(tmpdir(),'plaude-zip-'));try{const path=join(dir,'backup.zip');writeFileSync(path,bytes);
    const result=spawnSync(process.platform==='win32'?'python':'python3',['-c','import sys,json,zipfile,hashlib; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(json.dumps({"names":z.namelist(),"hashes":[hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist()[1:]]}))',path],{encoding:'utf8',windowsHide:true});
    if(result.error?.code==='ENOENT'){t.skip('independent Python ZIP reader unavailable');return;}assert.equal(result.status,0,result.stderr);const read=JSON.parse(result.stdout);assert.deepEqual(read.names,plan.entries.map(e=>e.name));assert.deepEqual(read.hashes,files.map(f=>f.sha256));
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('truncated, corrupt, wrong-account and mismatched backup blobs never pass validation',async()=>{
  const {bytes}=encoded();await assert.rejects(verifyOriginalZip(new Blob([bytes.subarray(0,-8)]),envelope),/不完整/);
  const bad=Buffer.from(bytes);bad[100]^=1;await assert.rejects(verifyOriginalZip(new Blob([bad]),envelope),/校验失败/);
  await assert.rejects(verifyOriginalZip(new Blob([bytes]),{...envelope,userId:'other-user'}),/账户不一致/);
  await assert.rejects(verifyOriginalZip(new Blob([bytes]),{...envelope,files:files.slice(1)}),/账户不一致/);
  await assert.rejects(verifyOriginalZip(new Blob([bytes,new Uint8Array([1])]),envelope),/不完整/);
  await assert.rejects(verifyOriginalZip({size:MAX_ORIGINAL_ZIP_BYTES+1},envelope),/大小无效/);
  await assert.rejects(verifyOriginalZip(new Blob([bytes]),envelope,{check:()=>{throw Error('cancelled account');}}),/cancelled account/);
});
test('pending deleted entries are excluded and unavailable original stops generation before a complete ZIP',()=>{
  const pending={...envelope,files:[files[0],{...files[1],cleanupPending:true}]},plan=originalZipPlan(pending);assert.equal(plan.entries.length,2);assert.equal(plan.manifest.usedBytes,files[0].size);
  const stream=originalZipChunks(originalZipPlan(envelope),()=>{throw Error('original deleted');});assert.ok(!stream.next().done);assert.ok(!stream.next().done);assert.throws(()=>stream.next(),/original deleted/);
  assert.throws(()=>originalZipPlan({...envelope,files:[]}),/没有可备份/);
});
test('authenticated ZIP export uses exact list snapshot and streams all checked bytes without state writes',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'plaude-zip-api-')),path=join(dir,'accounts.json'),accounts=createAccountStore(path),account=await accounts.register({username:'zip-test-alice',password:'zip-test-password-2026'});
  const docs=files.map(f=>({id:f.documentId,name:f.name,sections:[{label:'段落 1',text:'source QA'}],enabled:true}));accounts.putProjects(account.user.id,{revision:0,projects:{version:1,projects:[{id:'project-zip-test',name:'ZIP QA',instructions:'',revision:0,documents:docs}],links:[]}});
  const apiContents=[Buffer.from(contents[0]),Buffer.alloc(5*1024*1024,17)];
  for(let i=0;i<files.length;i++)accounts.uploadOriginal(account.user.id,{projectId:'project-zip-test',documentId:docs[i].id,name:docs[i].name},apiContents[i]);
  const saved=accounts.listOriginals(account.user.id),snapshot=createHash('sha256').update(originalSnapshotText(saved.files)).digest('hex');
  const server=createGatewayServer({config:loadConfig({NODE_ENV:'test',LOCAL_DEV_NO_AUTH:'0',GATEWAY_ACCESS_TOKEN:'zip-test-key-abcdefghijklmnopqrstuvwxyz',DEEPSEEK_API_KEY:'sk-test-abcdefghijklmnopqrstuvwxyz'}),accountStore:accounts,fetchImpl:async()=>{throw Error('No upstream');}});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();rmSync(dir,{recursive:true,force:true});});
  const url='http://127.0.0.1:'+server.address().port+'/api/account/project-files/export',headers={cookie:'plaude_session='+account.sessionToken,'x-plaude-account-id':account.user.id},before=readFileSync(path+'.originals/'+account.user.id+'/index.json');
  assert.equal((await fetch(url+'?snapshot='+snapshot)).status,401);assert.equal((await fetch(url+'?snapshot=old',{headers})).status,409);
  const response=await fetch(url+'?snapshot='+snapshot,{headers});assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/zip');assert.match(response.headers.get('content-disposition'),/^attachment;/);const blob=await response.blob();assert.equal(blob.size,Number(response.headers.get('content-length')));await verifyOriginalZip(blob,saved);assert.deepEqual(readFileSync(path+'.originals/'+account.user.id+'/index.json'),before);
  writeFileSync(path+'.originals/'+account.user.id+'/'+saved.files[1].id+'.bin','tampered');await assert.rejects(async()=>{const response=await fetch(url+'?snapshot='+snapshot,{headers});await response.blob();});
});
