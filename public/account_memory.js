import {validateMemories,selectMemories,memoryContext,memoryBackup,parseMemoryBackup,planMemoryImport} from './memory_tools.js';
export function createMemoryClient({userId,fetchImpl=globalThis.fetch,isCurrent=()=>true,onIdentityChanged=()=>{}}) {
  let snapshot=null;
  const identity=()=>{if(!userId||!isCurrent())throw Error('账户已切换，请重新打开长期记忆。');};
  async function request(method,body,signal) {
    identity();const controller=new AbortController(),abort=()=>controller.abort(),timer=setTimeout(abort,20000);
    if(signal?.aborted)controller.abort();else signal?.addEventListener('abort',abort,{once:true});
    try{
      const response=await fetchImpl('/api/account/memories',{method,credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:{accept:'application/json','content-type':'application/json','x-plaude-client':'1','x-plaude-account-id':userId},...(body?{body:JSON.stringify(body)}:{})});
      const data=await response.json();if(controller.signal.aborted)throw Error('aborted');identity();
      if([401,403].includes(response.status)){onIdentityChanged();throw Error('登录已失效，请重新登录后使用记忆。');}
      if(!response.ok)throw Error(data.error||'长期记忆读取或保存失败，请稍后重试。');
      if(data.userId!==userId||!Number.isSafeInteger(data.revision)||data.revision<0)throw Error('记忆账户或版本不一致，未载入资料。');
      return {...data,library:validateMemories(data.library)};
    }catch(error){if(controller.signal.aborted)throw Error(signal?.aborted?'本次记忆准备已停止，尚未请求模型。':'长期记忆请求超时，结果尚未确认。请重新读取；原聊天和编辑草稿保留。');throw error;}
    finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  return {
    get snapshot(){return snapshot&&structuredClone(snapshot);},
    async load(signal){const next=await request('GET',undefined,signal);if(!snapshot||next.revision>=snapshot.revision)snapshot=next;return structuredClone(snapshot);},
    async save(library,revision=snapshot?.revision){
      library=validateMemories(library);if(!Number.isSafeInteger(revision))throw Error('请先读取长期记忆。');
      const next=await request('PUT',{library,revision});
      if(next.revision!==revision+1||JSON.stringify(next.library)!==JSON.stringify(library))throw Error('尚未确认记忆完整保存，请重新读取核对；编辑草稿保留。');
      if(!snapshot||next.revision>=snapshot.revision)snapshot=next;return structuredClone(snapshot);
    },
    async prepare(query,{enabled=true,signal}={}){
      if(!enabled||!userId)return {entries:[],chars:0};
      const value=await this.load(signal),entries=selectMemories(value.library,query);
      return {entries,chars:memoryContext(entries).length,...(value.library.enabled?{selection:{revision:value.revision,ids:entries.map(e=>e.id)}}:{})};
    },
  };
}

export function initAccountMemory({user,currentUser,identityChanged,toast,changed,active}) {
  const client=createMemoryClient({userId:user?.id,isCurrent:()=>user?.id===currentUser()?.id,onIdentityChanged:identityChanged});
  const dialog=document.createElement('dialog');dialog.id='memory-dialog';dialog.className='settings-dialog';dialog.setAttribute('aria-labelledby','memory-title');
  dialog.innerHTML=`<div class="dialog-card"><div class="dialog-heading"><h2 id="memory-title">长期记忆</h2><button type="button" class="icon-button" id="memory-close" aria-label="关闭长期记忆">×</button></div><p>保存你希望跨聊天使用的个人偏好和背景。只有点击保存才会写入当前账户；不会自动扫描历史聊天。每次最多选用8条、4000字符，可在下方预览。访客不保存长期记忆。</p><p id="memory-status" role="status" aria-live="polite"></p><div id="memory-controls"><label><input type="checkbox" id="memory-global"> 允许聊天使用本账户记忆（总开关）</label><div class="project-actions"><button type="button" id="memory-global-save" class="secondary-button">保存开关</button><button type="button" id="memory-refresh" class="text-button">重新读取</button><button type="button" id="memory-export" class="text-button">导出记忆</button><button type="button" id="memory-import" class="text-button">导入记忆</button><input type="file" id="memory-file" accept=".json,application/json" hidden></div><section id="memory-import-preview" hidden><p id="memory-import-summary"></p><button type="button" id="memory-import-confirm" class="primary-button">确认合并导入</button><button type="button" id="memory-import-cancel" class="text-button">取消导入</button></section><h3>已保存的记忆</h3><div id="memory-list" class="memory-list"></div><h3 id="memory-edit-title">新增记忆</h3><label for="memory-text">内容（最多500字）</label><textarea id="memory-text" rows="4" maxlength="500" placeholder="例如：我希望默认用中文回答，解释代码时先给示例。"></textarea><label><input id="memory-always" type="checkbox" checked> 每次优先使用（取消后仅在问题相关时使用）</label><div class="project-actions"><button type="button" id="memory-save" class="primary-button">保存记忆</button><button type="button" id="memory-new" class="text-button">清空编辑</button></div><h3>本次草稿会使用的记忆</h3><p id="memory-preview-note"></p><div id="memory-selected"></div><h3>上次准备发送的记忆</h3><p>仅表示本页曾准备此内容，不证明模型已收到；刷新后清除。</p><div id="memory-last-used"></div><p>关闭或删除不会改写已有回复。记忆导出独立于聊天JSON备份；新设备登录同一账户可读取。读取失败时不会悄悄跳过记忆继续生成，可关闭本对话记忆后发送。</p></div></div>`;
  document.body.append(dialog);const $=id=>dialog.querySelector('#memory-'+id);let working=false,editing=null,preview=null;const lastUses=new Map();
  const entry=document.createElement('button');entry.id='open-memory';entry.type='button';entry.className='ui-settings-link';entry.textContent='长期记忆';document.querySelector('#ui-settings-data')?.append(entry);
  const accountEntry=entry.cloneNode(true);accountEntry.id='account-open-memory';accountEntry.className='secondary-button';document.querySelector('#account-manage')?.append(accountEntry);
  const chip=document.createElement('button');chip.id='memory-summary';chip.type='button';chip.className='text-button';chip.hidden=!user;chip.textContent='长期记忆 · 查看';document.querySelector('#prompt-input').before(chip);
  function drawPreview(){
    const snapshot=client.snapshot,enabled=active()?.context?.useMemory!==false,entries=snapshot&&enabled?selectMemories(snapshot.library,document.querySelector('#prompt-input').value):[];
    $('preview-note').textContent=!enabled?'本对话已关闭长期记忆。':!snapshot?'打开后读取当前账户记忆。':!snapshot.library.enabled?'本账户记忆总开关已关闭。':`已选 ${entries.length} 条，共 ${memoryContext(entries).length}/4000 字符；发送时重新读取，内容变化时请核对。`;
    $('selected').replaceChildren(...entries.map(e=>{const p=document.createElement('p');p.textContent=e.text;return p;}));
    $('last-used').replaceChildren(...(lastUses.get(active()?.id)||[]).map(e=>{const p=document.createElement('p');p.textContent=e.text;return p;}));
    chip.textContent=!enabled?'长期记忆 · 本对话已关闭':snapshot?`长期记忆 · ${snapshot.library.enabled?entries.length+'条候选':'已关闭'}`:'长期记忆 · 查看';
  }
  function paint(){
    const snapshot=client.snapshot;entry.disabled=false;accountEntry.disabled=false;$('controls').hidden=!user;
    if(snapshot)$('global').checked=snapshot.library.enabled;
    $('list').replaceChildren();
    for(const item of snapshot?.library.entries||[]){
      const row=document.createElement('article'),p=document.createElement('p'),actions=document.createElement('div');p.textContent=item.text;actions.className='project-actions';
      const add=(label,fn)=>{const b=document.createElement('button');b.type='button';b.className='text-button';b.textContent=label;b.onclick=fn;b.disabled=working;actions.append(b);};
      add('编辑',()=>{if($('text').value.trim()&&!confirm('替换当前未保存的记忆编辑？'))return;editing=item.id;$('text').value=item.text;$('always').checked=item.always;$('edit-title').textContent='编辑记忆';$('text').focus();});
      add(item.enabled?'暂停使用':'恢复使用',()=>run(async()=>{const next=client.snapshot;next.library.entries.find(e=>e.id===item.id).enabled=!item.enabled;await client.save(next.library,next.revision);message('记忆开关已保存。');}));
      add('删除',()=>run(async()=>{if(!confirm('删除这条长期记忆？原聊天和已有回复保留。'))return;const next=client.snapshot;next.library.entries=next.library.entries.filter(e=>e.id!==item.id);await client.save(next.library,next.revision);if(editing===item.id){editing=null;$('text').value='';}message('已删除记忆。');}));
      const tag=document.createElement('small');tag.textContent=`${item.enabled?'启用':'已暂停'} · ${item.always?'每次优先':'相关时使用'}`;row.append(p,tag,actions);$('list').append(row);
    }
    if(snapshot&&!snapshot.library.entries.length)$('list').textContent='尚无记忆，可手动添加，或在消息操作中选择“保存为记忆”。';
    for(const id of ['global','global-save','export','import','save'])$(id).disabled=working||!snapshot;
    for(const id of ['refresh','new','text','always','import-confirm','import-cancel'])$(id).disabled=working;
    drawPreview();changed?.();
  }
  const message=text=>$('status').textContent=text;
  async function run(fn){if(working)return;working=true;dialog.setAttribute('aria-busy','true');paint();try{await fn();}catch(error){message(error.message);}finally{working=false;dialog.removeAttribute('aria-busy');paint();}}
  async function open(text){
    for(const other of document.querySelectorAll('dialog[open]'))if(other!==dialog)other.close();
    if(!dialog.open)dialog.showModal();
    if(typeof text==='string'){if($('text').value.trim()&&!confirm('用所选消息替换当前未保存的记忆编辑？'))return;editing=null;$('text').value=text.slice(0,500);$('edit-title').textContent='从消息保存记忆';message(text.length>500?'已预填消息前500字，请编辑、核对后点击保存；尚未写入。':'请核对内容并点击保存；尚未写入。');}
    if(!user){message('请先登录个人账户，再保存跨聊天的长期记忆。');paint();return;}
    await run(async()=>{await client.load();if(typeof text!=='string')message('当前账户记忆已读取；编辑后须点击保存。');});$('text').focus();
  }
  const close=()=>{if(working)return;if($('text').value.trim()&&!confirm('关闭会保留本页未保存的编辑，但刷新后会丢失。仍要关闭？'))return;dialog.close();};
  $('close').onclick=close;dialog.addEventListener('cancel',e=>{e.preventDefault();close();});entry.onclick=accountEntry.onclick=chip.onclick=()=>open();
  $('refresh').onclick=()=>run(async()=>{preview=null;$('import-preview').hidden=true;await client.load();message('已读取最新记忆，当前文字编辑仍保留，请核对后保存。');});
  $('new').onclick=()=>{if($('text').value.trim()&&!confirm('清空当前未保存的记忆编辑？'))return;editing=null;$('text').value='';$('always').checked=true;$('edit-title').textContent='新增记忆';};
  $('save').onclick=()=>run(async()=>{const next=client.snapshot,text=$('text').value.trim();if(!text)throw Error('请填写记忆内容。');const index=next.library.entries.findIndex(e=>e.id===editing);if(editing&&index<0)throw Error('这条记忆已不存在，文字仍保留；请清空编辑后另存。');const item={id:editing||crypto.randomUUID(),text,enabled:index<0?true:next.library.entries[index].enabled,always:$('always').checked};if(index<0)next.library.entries.push(item);else next.library.entries[index]=item;await client.save(next.library,next.revision);editing=null;$('text').value='';$('edit-title').textContent='新增记忆';message(item.enabled?'记忆已保存到当前账户，新聊天也可使用。':'记忆内容已保存，仍保持暂停；需要时可点击“恢复使用”。');toast('长期记忆已保存。');});
  $('global-save').onclick=()=>{const enabled=$('global').checked;void run(async()=>{const next=client.snapshot;await client.save({...next.library,enabled},next.revision);message(enabled?'本账户长期记忆已启用。':'本账户长期记忆已关闭；已保存内容保留，可随时恢复。');});};
  $('export').onclick=()=>{const url=URL.createObjectURL(new Blob([memoryBackup(client.snapshot.library)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='plaude-memory-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);message('记忆已交给浏览器下载，请保管备份文件。');};
  $('import').onclick=()=>$('file').click();$('file').onchange=()=>{const file=$('file').files[0];$('file').value='';if(file)void run(async()=>{preview=null;$('import-preview').hidden=true;$('import-summary').textContent='';if(file.size>128*1024)throw Error('记忆备份超过128 KiB。');const next=client.snapshot,plan=planMemoryImport(next.library,parseMemoryBackup(await file.text()));preview={...plan,revision:next.revision};$('import-summary').textContent=`将新增 ${plan.added} 条，跳过 ${plan.skipped} 条重复；保留现有记忆和总开关，尚未上传。`;$('import-preview').hidden=false;});};
  $('import-confirm').onclick=()=>run(async()=>{if(!preview)throw Error('请重新选择备份并预览。');if(!preview.added){message('全部记忆已存在，无须导入。');}else{await client.save(preview.library,preview.revision);message(`已合并导入 ${preview.added} 条记忆，原记忆保留。`);}preview=null;$('import-preview').hidden=true;});
  $('import-cancel').onclick=()=>{preview=null;$('import-preview').hidden=true;message('已取消导入。');};
  paint();return {open,remember:text=>open(text),busy:()=>working,record:(id,entries)=>{lastUses.set(id,structuredClone(entries));drawPreview();},preview:(enabled=active()?.context?.useMemory!==false)=>{const value=client.snapshot;if(!user||!enabled||!value)return{entries:[],chars:0,loaded:!!value};const entries=selectMemories(value.library,document.querySelector('#prompt-input').value);return{entries,chars:memoryContext(entries).length,loaded:true};},sync:drawPreview,
    async prepare(query,options){if(!user)return{entries:[],chars:0};const value=await client.prepare(query,options);drawPreview();return value;}};
}
