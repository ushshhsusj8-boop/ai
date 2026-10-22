import test from 'node:test';
import assert from 'node:assert/strict';
import {executionRecord,parseHistoryBackup,planHistoryImport,searchExecutionHistory,HISTORY_IMPORT_BYTES} from '../public/execution_history.js';
const record = (id='qa-a',code='print("你好 [1]")',extra={}) => executionRecord({language:'python',code,stdin:'标准输入'},
  {id:'qa-server',status:'completed',stdout:'完整标准输出',stderr:'错误 marker',exitCode:0,durationMs:5,...extra}, {localId:id,createdAt:100});
const backup = runs => JSON.stringify({version:1,exportedAt:'2026-10-10T00:00:00Z',runs});
test('old and new backups round trip exact Unicode input/output and interrupted results', () => {
  const records=[record(),{...record('qa-b'),status:'interrupted',resultReceived:false,error:'未知实际结果',exitCode:null}];
  assert.deepEqual(parseHistoryBackup(backup(records)),records);
  assert.deepEqual(parseHistoryBackup('\uFEFF'+JSON.stringify({...JSON.parse(backup(records)),format:'plaude-code-history'})),records);
});
test('malformed, unexpected, oversized and mistyped backups are rejected before writes', () => {
  for (const text of ['null','[]','{bad',JSON.stringify({version:2,runs:[]}),JSON.stringify({...JSON.parse(backup([])),format:'other'}),
    backup([{...record(),resultReceived:'yes'}]),backup([{...record(),authorization:'private'}]),backup([{...record(),code:null}]),
    backup(Array.from({length:101},(_,i)=>record('qa-'+i)))]) assert.throws(()=>parseHistoryBackup(text));
  assert.throws(()=>parseHistoryBackup(' '.repeat(HISTORY_IMPORT_BYTES+1)),/10 MiB/);
  assert.throws(()=>parseHistoryBackup(backup([{...record(),stdin:'中'.repeat(6000)}])),/16 KiB/);
});
test('duplicate imports are idempotent while colliding distinct results receive new identifiers', () => {
  const original=record(), changed=record('qa-a','print("changed")'), independent=record('qa-z','print("独立")');
  const before=JSON.stringify([original]);
  const plan=planHistoryImport([original,changed,independent,changed],[original],{newId:()=> 'qa-conflict-copy'});
  assert.equal(plan.skipped,2); assert.equal(plan.renamed,1); assert.equal(plan.total,3);
  assert.equal(plan.additions[0].localId,'qa-conflict-copy'); assert.equal(JSON.stringify([original]),before);
  assert.equal(planHistoryImport([changed,independent],[original,...plan.additions]).additions.length,0);
});
test('combined count and UTF8 byte capacity refuse entire import and preserve originals', () => {
  const full=Array.from({length:100},(_,i)=>record('qa-'+i,'print('+i+')')), before=JSON.stringify(full);
  assert.throws(()=>planHistoryImport([record('incoming','new')],full),/已满/); assert.equal(JSON.stringify(full),before);
  const big=Array.from({length:95},(_,i)=>record('big-'+i,'print('+i+')',{stdout:'中'.repeat(30000)}));
  assert.throws(()=>planHistoryImport([record('incoming','new')],big),/已满/);
  assert.throws(()=>planHistoryImport([record('qa-a','new')],[record()],{newId:()=> 'qa-a'}),/编号/);
});
test('history search is literal Unicode and combines language with code/output field filters', () => {
  const python=record(), java={...record('qa-java','class Main {}',{stdout:'ＭＡＲＫＥＲ'}),language:'java'};
  assert.deepEqual(searchExecutionHistory([python,java],'[1]','python','code'),[python]);
  assert.deepEqual(searchExecutionHistory([python,java],'marker','java','output'),[java]);
  assert.deepEqual(searchExecutionHistory([python,java],'标准输入','all','code'),[]);
  assert.deepEqual(searchExecutionHistory([python,java],'标准输入'),[python,java]);
  assert.deepEqual(searchExecutionHistory([python,java],'.*'),[]);
});
