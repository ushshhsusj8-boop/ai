import test from 'node:test';
import assert from 'node:assert/strict';
import {createBackup,planImport,applyImport} from '../public/backups.js';
import {withSiteLimits} from '../src/limit_context.mjs';
import {LEGACY_LIMITS,DEVELOPER_LIMITS} from '../public/site_limits.js';
const keys={prompts:'yunjian-ai-prompt-library-v1',cloud:'plaude-prompt-cloud-v1',conversations:'yunjian-ai-conversations-v1'};
const memory=(initial={})=>{const map=new Map(Object.entries(initial));return{getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k),snapshot:()=>JSON.stringify([...map])};};
const prompts=(count,prefix='qa-prompt')=>Array.from({length:count},(_,i)=>({id:prefix+'-'+i,title:'Synthetic '+i,content:'Full synthetic prompt '+i,createdAt:100,updatedAt:100}));

test('workspace backups restore more than 30 developer prompts, preserve duplicate IDs and skip repeated imports',()=>{
 withSiteLimits(DEVELOPER_LIMITS,()=>{
  const source=memory({[keys.prompts]:JSON.stringify(prompts(31))}),original={...prompts(1)[0],content:'Keep local duplicate'},target=memory({[keys.prompts]:JSON.stringify([original])});
  const backup=createBackup(source),plan=planImport(backup,target);assert.equal(plan.addedPrompts,30);assert.equal(plan.skippedPrompts,1);applyImport(plan,target);
  const saved=JSON.parse(target.getItem(keys.prompts));assert.equal(saved.length,31);assert.deepEqual(saved.find(p=>p.id===original.id),original);assert.deepEqual(saved.slice(1),prompts(31).slice(1));
  const repeated=planImport(backup,target);assert.equal(repeated.addedPrompts,0);assert.equal(repeated.skippedPrompts,31);applyImport(repeated,target);assert.deepEqual(JSON.parse(target.getItem(keys.prompts)),saved);
 });
});

test('large prompt imports preserve cloud baseline metadata and reject changed cloud caches before any write',()=>{
 withSiteLimits(DEVELOPER_LIMITS,()=>{
  const old=prompts(1,'qa-existing'),envelope={version:1,revision:7,base:old,prompts:old,migrated:true},source=memory({[keys.prompts]:JSON.stringify(prompts(31))}),target=memory({[keys.cloud]:JSON.stringify(envelope)});
  const backup=createBackup(source),plan=planImport(backup,target);assert.equal(plan.addedPrompts,31);
  target.setItem(keys.cloud,JSON.stringify({...envelope,revision:8}));const before=target.snapshot();assert.throws(()=>applyImport(plan,target),/其他窗口更新/);assert.equal(target.snapshot(),before);
  applyImport(planImport(backup,target),target);const cloud=JSON.parse(target.getItem(keys.cloud));assert.equal(cloud.revision,8);assert.equal(cloud.migrated,true);assert.deepEqual(cloud.base,old);assert.equal(cloud.prompts.length,32);assert.equal(target.getItem(keys.prompts),null);assert.deepEqual(cloud.prompts[0],old[0]);
 });
});

test('merged prompt counts obey live custom and legacy budgets without changing any data on overflow',()=>{
 const source=memory({[keys.prompts]:JSON.stringify(prompts(20,'qa-incoming'))}),target=memory({[keys.prompts]:JSON.stringify(prompts(20,'qa-existing'))}),backup=createBackup(source),before=target.snapshot();
 withSiteLimits({...DEVELOPER_LIMITS,prompts:40},()=>assert.equal(planImport(backup,target).prompts.length,40));
 withSiteLimits({...DEVELOPER_LIMITS,prompts:39},()=>assert.throws(()=>planImport(backup,target),/39/));
 withSiteLimits(LEGACY_LIMITS,()=>assert.throws(()=>planImport(backup,target),/30/));assert.equal(target.snapshot(),before);
});
