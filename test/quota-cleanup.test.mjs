import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createProjectOriginalStore} from '../src/project_originals.mjs';
import {createWritingNotes} from '../src/writing_notes.mjs';
import {createWritingStore} from '../public/writing_store.js';
import {createAccountStore} from '../src/accounts.mjs';
import {withSiteLimits} from '../src/limit_context.mjs';
import {DEVELOPER_LIMITS,LEGACY_LIMITS} from '../public/site_limits.js';
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const requireUser=id=>{if(![owner,other].includes(id))throw Object.assign(Error('unknown account'),{statusCode:401});};
const status=code=>error=>error.statusCode===code;
function fixture(){const dir=mkdtempSync(join(tmpdir(),'plaude-quota-cleanup-'));return{dir,dispose:()=>rmSync(dir,{recursive:true,force:true})};}
const notes=(count,text='saved text')=>Array.from({length:count},(_,n)=>({id:'quota-note-'+String(n).padStart(3,'0'),title:'Synthetic '+n,text,revision:1,updatedAt:1}));

test('lowering original-file count and per-file budgets still permits explicit deletion and failed-cleanup retry',()=>{
 const f=fixture();try{
  const root=join(f.dir,'originals'),projects={projects:[{id:'quota-project',documents:Array.from({length:63},(_,i)=>({id:'quota-document-'+i}))}]};
  const settings={requireUser,getProjects:()=>projects},store=createProjectOriginalStore(root,settings),target=i=>({projectId:'quota-project',documentId:'quota-document-'+i,name:'synthetic-'+i+'.txt'});
  withSiteLimits(DEVELOPER_LIMITS,()=>{for(let i=0;i<61;i++)store.upload(owner,target(i),Buffer.from('saved-'+i));store.upload(other,target(0),Buffer.from('other account'));});
  const before=store.list(owner),first=before.files[0],sibling=before.files[1],failed=createProjectOriginalStore(root,{...settings,removeBlob:()=>{throw Error('synthetic lock');}});
  const pending=withSiteLimits(LEGACY_LIMITS,()=>failed.remove(owner,first.id));assert.equal(pending.files.length,61);assert.equal(pending.usedBytes,before.usedBytes);assert.equal(pending.files[0].cleanupPending,true);
  assert.deepEqual(readFileSync(join(root,owner,sibling.id+'.bin')),Buffer.from('saved-1'));
  const restarted=createProjectOriginalStore(root,settings),removed=withSiteLimits(LEGACY_LIMITS,()=>restarted.remove(owner,first.id));assert.equal(removed.files.length,60);assert.equal(removed.usedBytes,before.usedBytes-first.size);
  assert.throws(()=>withSiteLimits(LEGACY_LIMITS,()=>restarted.upload(owner,target(62),Buffer.from('new'))),status(413));
  assert.equal(restarted.list(other).files.length,1);
  const large=withSiteLimits(DEVELOPER_LIMITS,()=>store.upload(other,{...target(1),name:'large.txt'},Buffer.alloc(6*1024*1024,65))).files.find(v=>v.name==='large.txt');
  assert.equal(withSiteLimits(LEGACY_LIMITS,()=>store.remove(other,large.id)).files.length,1);
 }finally{f.dispose();}
});
test('over-budget original cleanup still requires a durable pending marker before touching the blob',()=>{
 const f=fixture();try{const root=join(f.dir,'originals'),settings={requireUser,getProjects:()=>({projects:[{id:'quota-project',documents:[{id:'quota-document'}]}]})};const store=createProjectOriginalStore(root,settings);
  const file=withSiteLimits(DEVELOPER_LIMITS,()=>store.upload(owner,{projectId:'quota-project',documentId:'quota-document',name:'synthetic.txt'},Buffer.alloc(6*1024*1024,65))).files[0],index=join(root,owner,'index.json'),before=readFileSync(index);let removed=false;
  const broken=createProjectOriginalStore(root,{...settings,writeIndex:()=>{throw Error('synthetic index failure');},removeBlob:()=>{removed=true;}});
  assert.throws(()=>withSiteLimits(LEGACY_LIMITS,()=>broken.remove(owner,file.id)),/synthetic index failure/);assert.equal(removed,false);assert.deepEqual(readFileSync(index),before);assert.equal(store.download(owner,file.id).content.length,file.size);
 }finally{f.dispose();}
});
test('lowering writing budgets permits one-at-a-time local and cloud deletion while rejecting stale or oversized writes',()=>{
 const f=fixture();try{const data=new Map([['plaude-writing-desk-v1',JSON.stringify({version:1,notes:notes(52)})]]),storage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)},local=createWritingStore(storage);
  withSiteLimits(LEGACY_LIMITS,()=>local.remove('quota-note-000',1));assert.equal(local.list().length,51);assert.equal(local.list().find(n=>n.id==='quota-note-001').text,'saved text');
  const snapshot=data.get('plaude-writing-desk-v1');assert.throws(()=>withSiteLimits(LEGACY_LIMITS,()=>local.save({...local.list()[0],text:'new text'})));assert.equal(data.get('plaude-writing-desk-v1'),snapshot);
  const dir=join(f.dir,'writing');mkdirSync(dir);const file=join(dir,owner+'.json');writeFileSync(file,JSON.stringify({version:1,userId:owner,records:notes(52,'x'.repeat(100000))}));
  const cloud=createWritingNotes(dir,{requireUser}),before=readFileSync(file);assert.throws(()=>withSiteLimits(LEGACY_LIMITS,()=>cloud.remove(owner,'quota-note-000',2)),status(409));assert.deepEqual(readFileSync(file),before);
  const deleted=withSiteLimits(LEGACY_LIMITS,()=>cloud.remove(owner,'quota-note-000',1));assert.equal(deleted.deleted,true);
  const restarted=createWritingNotes(dir,{requireUser});assert.equal(restarted.list(owner).notes.length,51);assert.equal(restarted.list(owner).deleted.length,1);assert.equal(restarted.list(other).notes.length,0);
  const saved=readFileSync(file);assert.throws(()=>withSiteLimits(LEGACY_LIMITS,()=>restarted.put(owner,'quota-new-note',{revision:0,note:{id:'quota-new-note',title:'new',text:'new'}})),status(413));assert.deepEqual(readFileSync(file),saved);
 }finally{f.dispose();}
});
test('conversation cleanup can reduce a workspace still above its new intake budget without admitting new data (scaled byte budgets)',async()=>{
 const f=fixture();try{const file=join(f.dir,'accounts.json'),store=createAccountStore(file),user=await store.register({username:'quota-owner',password:'Synthetic-only-password-123!'}),bob=await store.register({username:'quota-other',password:'Synthetic-only-password-123!'});
  // Scale only this isolated store's byte threshold to exercise the same over-
  // quota branch without allocating a 64+ MiB fixture on the production host.
  const high={...DEVELOPER_LIMITS,cloudWorkspaceBytes:64000},low={...LEGACY_LIMITS,cloudWorkspaceBytes:12000};
  withSiteLimits(high,()=>{for(let i=0;i<3;i++){const conversation={id:'quota-chat-'+i,title:'saved',provider:'deepseek',model:'synthetic',messages:[{role:'user',content:'x'.repeat(8000)}]};store.putConversation(user.user.id,conversation.id,{revision:0,conversation});}});
  const result=withSiteLimits(low,()=>store.deleteConversation(user.user.id,'quota-chat-0',1));assert.equal(result.deleted,true);const live=store.listConversations(user.user.id).conversations;assert.equal(live.length,2);assert.equal(live[0].conversation.messages[0].content.length,8000);
  const target=join(file+'.workspaces',user.user.id+'.json'),before=readFileSync(target);assert.throws(()=>withSiteLimits(low,()=>store.putConversation(user.user.id,'quota-chat-new',{revision:0,conversation:{id:'quota-chat-new',provider:'deepseek',model:'synthetic',messages:[{role:'user',content:'new'}]}})),status(413));assert.deepEqual(readFileSync(target),before);
  assert.throws(()=>store.deleteConversation(bob.user.id,live[0].conversation.id,1),status(404));assert.throws(()=>store.deleteConversation(user.user.id,live[0].conversation.id,2),status(409));assert.equal(createAccountStore(file).listConversations(user.user.id).conversations.length,2);
 }finally{f.dispose();}
});
