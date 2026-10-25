import assert from 'node:assert/strict';
import {test} from 'node:test';
import {writingLargeCacheScenarios} from './writing-large-sync.fixture.mjs';
let cached;const result=()=>cached??=writingLargeCacheScenarios(new URL('../public/',import.meta.url).href);
test('large confirmed writing baselines survive reload so offline edits do not become false conflicts',async()=>{
 const r=await result();assert.ok(r.cachedChars>600000);assert.equal(r.edit.synced,true);assert.equal(r.edit.conflicts,0);assert.equal(r.edit.localPreserved,true);assert.equal(r.edit.remoteUpdated,true);assert.deepEqual(r.edit.putRevisions,[0,1]);
});
test('deleting a large synced note offline survives reload and deletes the cloud original without resurrection',async()=>{
 const r=await result();assert.equal(r.deletion.reportedSynced,true);assert.equal(r.deletion.cloudDeleted,true);assert.equal(r.deletion.localDeleted,true);assert.equal(r.deletion.deleteRequests,1);assert.equal(r.deletion.siblingPreserved,true);
});
test('retaining large writing baselines still preserves true conflicts and both versions',async()=>{
 const r=await result();assert.equal(r.conflict.synced,false);assert.equal(r.conflict.conflicts,1);assert.equal(r.conflict.localPreserved,true);assert.equal(r.conflict.remotePreserved,true);
});
