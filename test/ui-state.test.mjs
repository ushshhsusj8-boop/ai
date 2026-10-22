import test from 'node:test';
import assert from 'node:assert/strict';
import {uiPreferences,historyBucket,historyPage,searchWorkspace} from '../public/ui_state.js';
test('invalid UI preferences use stable defaults and retain valid independent choices',()=>{
  assert.deepEqual(uiPreferences({theme:'unknown',density:'compact',textSize:99}),{theme:'system',density:'compact',textSize:16,readingWidth:'standard'});
  assert.deepEqual(uiPreferences({theme:'dark',textSize:18}),{theme:'dark',density:'comfortable',textSize:18,readingWidth:'standard'});
  assert.equal(uiPreferences({readingWidth:'wide'}).readingWidth,'wide');
});
test('history groups use local calendar boundaries and pinned entries remain separate',()=>{
  const now=+new Date(2026,9,9,12),time=(day,hour=12)=>+new Date(2026,9,day,hour);
  assert.equal(historyBucket({pinned:true,updatedAt:0},now),'置顶');
  assert.equal(historyBucket({updatedAt:time(9,0)},now),'今天');
  assert.equal(historyBucket({updatedAt:time(8,23)},now),'昨天');
  assert.equal(historyBucket({updatedAt:time(3)},now),'最近 7 天');
  assert.equal(historyBucket({updatedAt:time(1)},now),'更早');
});
test('workspace search finds archived message content, project instructions, document body and note text with original location',()=>{
  const conversations=[{id:'chat-one',title:'日常',updatedAt:1,archived:true,messages:[{content:'无匹配'},{content:'needle [1] 这段在回复后半部分'}],documents:[]}];
  const projects=[{id:'project-one',name:'工作项目',instructions:'needle 准则',documents:[{id:'file-one',name:'报告.txt',sections:[{text:'needle 报告后半部分'}]}]}];
  const notes=[{id:'note-one',title:'文稿',text:'needle 修改'}];
  const result=searchWorkspace({conversations,projects,notes,query:'NEEDLE'});
  assert.deepEqual(result.map(r=>r.kind),['chat','project','file','note']);assert.equal(result[0].messageIndex,1);assert.match(result[0].subtitle,/已归档/);assert.equal(result[2].projectId,'project-one');
  assert.equal(searchWorkspace({conversations,query:'[1]'}).length,1);
  assert.equal(searchWorkspace({conversations,projects,notes,query:'needle',kind:'file'})[0].kind,'file');
});
test('workspace search bounds results, requires all terms and never searches data that was not supplied',()=>{
  const conversations=Array.from({length:80},(_,i)=>({id:'chat-'+i,title:'针目 search',updatedAt:i,messages:[{content:'内容 search'}]}));
  assert.equal(searchWorkspace({conversations,query:'search'}).length,60);
  assert.equal(searchWorkspace({conversations,query:'search absent'}).length,0);
  assert.equal(searchWorkspace({query:'私有资料'}).length,0);
  assert.equal(searchWorkspace({conversations,query:''})[0].messageIndex,-1);
});
test('large history windows preserve every stored item and include the active old conversation',()=>{
  const items=Array.from({length:1200},(_,i)=>({id:'chat-'+i})),page=historyPage(items,100,'chat-1100');
  assert.equal(page.length,100);assert.equal(page[0].id,'chat-1100');assert.equal(new Set(page.map(c=>c.id)).size,100);assert.equal(items.length,1200);assert.equal(historyPage(items,200).length,200);
});
test('bounded workspace search stops before touching categories whose results cannot be shown',()=>{
  const conversations=Array.from({length:100},(_,i)=>({id:'chat-'+i,title:'needle',updatedAt:i,messages:[]}));
  const project={get name(){throw Error('Unneeded expensive category should not be read');}};
  assert.equal(searchWorkspace({conversations,projects:[project],query:'needle'}).length,60);
});
