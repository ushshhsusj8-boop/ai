import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateCodeArtifacts,validArtifactName,artifactBytes,artifactDownloadName} from '../public/code_artifact_tools.js';
import {collectCodeArtifacts} from '../src/artifact_collection.mjs';
const file=(name='构造.csv',text='列一,列二\n1,你好\n')=>({name,size:Buffer.byteLength(text),data:Buffer.from(text).toString('base64')});
test('generated file validation retains binary bytes and rejects unsafe paths and malformed payloads',()=>{
  assert.deepEqual(Buffer.from(artifactBytes(validateCodeArtifacts([file()])[0])),Buffer.from('列一,列二\n1,你好\n'));
  for(const name of ['../secret','/absolute','a/../../secret','a\\secret','a//b','a/./b','a\u0000b','a/b/c/d/e'])assert.equal(validArtifactName(name),false);
  for(const value of [[file('../secret')],[{...file(),size:100}],[{...file(),data:'@@'}],[{...file(),size:65537}],[file(),file()],Array.from({length:5},(_,i)=>file('f'+i))])assert.throws(()=>validateCodeArtifacts(value));
  assert.equal(artifactDownloadName('reports/test.html'),'reports_test.html');assert.equal(artifactBytes(file('empty','')).length,0);
});
test('Linux collector reads bounded normal files using directory handles and refuses symbolic links', {skip:process.platform!=='linux'},async t=>{
  const dir=await mkdtemp(join(tmpdir(),'plaude-file-qa-'));t.after(()=>rm(dir,{recursive:true,force:true}));const root=join(dir,'output');await mkdir(join(root,'reports'),{recursive:true});
  await writeFile(join(root,'reports','构造.csv'),'列一,列二\n1,你好\n');await writeFile(join(dir,'secret.txt'),'DO_NOT_RETURN');
  await symlink(join(dir,'secret.txt'),join(root,'escape.txt'));await symlink(dir,join(root,'escape-dir'));
  await writeFile(join(root,'too-large.bin'),Buffer.alloc(65537));
  const result=await collectCodeArtifacts(root);assert.equal(result.files.length,1);assert.equal(result.files[0].name,'reports/构造.csv');assert.equal(Buffer.from(result.files[0].data,'base64').toString(),'列一,列二\n1,你好\n');assert.ok(result.fileNotice);
  const alias=join(dir,'alias');await symlink(root,alias);assert.equal((await collectCodeArtifacts(alias)).files.length,0);
});
test('Linux collector caps number, scanning and empty file results', {skip:process.platform!=='linux'},async t=>{
  const dir=await mkdtemp(join(tmpdir(),'plaude-file-limit-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  for(let i=0;i<10;i++)await writeFile(join(dir,'file-'+i),'');const result=await collectCodeArtifacts(dir);assert.equal(result.files.length,4);assert.ok(result.fileNotice);assert.ok(result.files.every(f=>f.size===0&&f.data===''));
  assert.deepEqual((await collectCodeArtifacts(join(dir,'missing'))).files,[]);
});
