export const PERSONAL_LIMIT = 2000;
export function validatePersonalInstructions(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(k => !['enabled', 'text'].includes(k))
    || typeof value.enabled !== 'boolean' || typeof value.text !== 'string'
    || value.text.length > PERSONAL_LIMIT || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.text)) {
    throw Error('通用指令须为最多2000字符的文字，并包含有效开关。');
  }
  return {enabled: value.enabled, text: value.text.trim()};
}
export function personalInstructionContext(value) {
  value = validatePersonalInstructions(value);
  return value.enabled && value.text ? '\n\n账户通用指令（个人默认偏好；发生冲突时以本次项目、对话及用户的具体要求为准）：\n' + value.text + '\n\n' : '';
}
export function createPersonalInstructionClient({userId, fetchImpl=globalThis.fetch, isCurrent=()=>true, onIdentityChanged=()=>{}}) {
  let snapshot=null;
  const identity=()=>{if(!userId||!isCurrent())throw Error('账户已切换，请重新打开通用指令。');};
  async function request(method,body,signal) {
    identity(); const controller=new AbortController(),abort=()=>controller.abort(),timer=setTimeout(abort,20000);
    if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
    try {
      const response=await fetchImpl('/api/account/instructions',{method,credentials:'same-origin',cache:'no-store',signal:controller.signal,
        headers:{accept:'application/json','content-type':'application/json','x-plaude-client':'1','x-plaude-account-id':userId},...(body?{body:JSON.stringify(body)}:{})});
      const data=await response.json();identity();if(controller.signal.aborted)throw Error('aborted');
      if([401,403].includes(response.status)){onIdentityChanged();throw Error('登录已失效，请重新登录。');}
      if(!response.ok)throw Error(data.error||'通用指令读取或保存失败。');
      if(data.userId!==userId||!Number.isSafeInteger(data.revision)||data.revision<0)throw Error('通用指令账户或版本不一致。');
      return {userId,revision:data.revision,instructions:validatePersonalInstructions(data.instructions)};
    } catch(error) {
      if(controller.signal.aborted)throw Error(signal?.aborted?'本次准备已停止，尚未请求模型。':'通用指令请求超时，请重新读取核对；编辑草稿保留。');
      throw error;
    } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  return {
    get snapshot(){return snapshot&&structuredClone(snapshot);},
    async load(signal){const next=await request('GET',undefined,signal);if(!snapshot||next.revision>=snapshot.revision)snapshot=next;return structuredClone(snapshot);},
    async save(instructions,revision){
      instructions=validatePersonalInstructions(instructions);if(!Number.isSafeInteger(revision))throw Error('请先读取通用指令。');
      const next=await request('PUT',{instructions,revision});
      if(next.revision!==revision+1||JSON.stringify(next.instructions)!==JSON.stringify(instructions))throw Error('尚未确认完整保存，请重新读取核对；编辑草稿保留。');
      if(!snapshot||next.revision>=snapshot.revision)snapshot=next;return structuredClone(snapshot);
    },
    async prepare({enabled=true,signal}={}){
      if(!userId||!enabled)return {chars:0};
      const next=await this.load(signal),text=personalInstructionContext(next.instructions);
      return {chars:text.length,...(text?{selection:{revision:next.revision}}:{})};
    },
  };
}

export function initPersonalInstructions({user,currentUser,identityChanged,changed,toast}) {
  const client=createPersonalInstructionClient({userId:user?.id,isCurrent:()=>user?.id===currentUser()?.id,onIdentityChanged:identityChanged});
  const dialog=document.createElement('dialog');dialog.id='personal-instructions-dialog';dialog.className='settings-dialog';dialog.setAttribute('aria-labelledby','personal-instructions-title');
  dialog.innerHTML='<div class="dialog-card"><div class="dialog-heading"><h2 id="personal-instructions-title">账户通用指令</h2><button type="button" id="personal-close" class="icon-button" aria-label="关闭通用指令">×</button></div><p>设置你的默认回答方式，例如语言、详略、职业背景。保存后在同一账户的各段聊天和设备中使用。</p><p id="personal-status" role="status" aria-live="polite"></p><div id="personal-controls"><label><input type="checkbox" id="personal-enabled"> 启用账户通用指令</label><label for="personal-text">希望 AI 如何回答（最多2000字符）</label><textarea id="personal-text" rows="8" maxlength="2000" placeholder="例如：默认用中文；先给结论，涉及代码时提供可运行的示例。"></textarea><p id="personal-count"></p><div class="project-actions"><button type="button" class="primary-button" id="personal-save">保存通用指令</button><button type="button" class="text-button" id="personal-refresh">读取云端版本</button></div><p>仅点击保存才会写入。关闭开关可保留文字；清空文字并保存可删除内容。具体项目、对话及本次提问的要求优先于这些默认偏好。可在“上下文范围”里单独关闭某段聊天的通用指令。</p><p>长期记忆用于保存个人事实和偏好条目；这里用于规定默认回答方式。通用指令独立于聊天JSON备份，可复制文字自行保存。</p></div></div>';
  document.body.append(dialog);const $=id=>dialog.querySelector('#personal-'+id);let working=false,base=null;
  const entry=document.createElement('button');entry.id='open-personal-instructions';entry.className='ui-settings-link';entry.type='button';entry.textContent='账户通用指令';document.querySelector('#ui-settings-chat')?.prepend(entry);
  const accountEntry=entry.cloneNode(true);accountEntry.id='account-open-personal-instructions';accountEntry.className='secondary-button';document.querySelector('#account-manage')?.append(accountEntry);
  const count=()=>{$('count').textContent=$('text').value.length+'/2000 字符';};
  const draft=()=>({enabled:$('enabled').checked,text:$('text').value});
  const dirty=()=>base&&JSON.stringify(draft())!==JSON.stringify(base.instructions);
  function paint(){for(const id of ['text','enabled','save','refresh'])$(id).disabled=working||!user||(id==='save'&&!base);$('controls').hidden=!user;dialog.setAttribute('aria-busy',String(working));count();changed?.();}
  async function run(fn){if(working)return;working=true;paint();try{await fn();}catch(error){$('status').textContent=error.message;}finally{working=false;paint();}}
  function fill(next){base=next;$('enabled').checked=next.instructions.enabled;$('text').value=next.instructions.text;count();}
  async function open(){
    for(const other of document.querySelectorAll('dialog[open]'))if(other!==dialog)other.close();dialog.showModal();
    if(!user){$('status').textContent='请先登录个人账户，再保存通用指令。';paint();return;}
    if(dirty()){$('status').textContent='保留了本页未保存的草稿；保存前可读取云端版本核对。';return;}
    await run(async()=>{fill(await client.load());$('status').textContent='已读取当前账户的云端版本；编辑后点击保存。';});$('text').focus();
  }
  const close=()=>{if(!working)dialog.close();};$('close').onclick=close;dialog.addEventListener('cancel',e=>{e.preventDefault();close();});entry.onclick=accountEntry.onclick=open;
  $('text').addEventListener('input',count);
  $('save').onclick=()=>{const value=draft(),revision=base?.revision;void run(async()=>{fill(await client.save(value,revision));$('status').textContent='已保存；下一次发送会使用最新通用指令。';toast('通用指令已保存。');});};
  $('refresh').onclick=()=>{if(dirty()&&!confirm('用云端版本替换本页尚未保存的草稿？'))return;void run(async()=>{fill(await client.load());$('status').textContent='已载入云端版本。';});};
  paint();return {busy:()=>working,prepare:options=>client.prepare(options),preview(enabled=true){const next=client.snapshot;return {chars:user&&enabled&&next?personalInstructionContext(next.instructions).length:0,loaded:!!next};}};
}
