import {validateConnection} from './connection_tools.js';

export function initModelConnections({user,reloadProviders,toast,identityChanged,busy=()=>false}) {
  const dialog=document.createElement('dialog');dialog.id='model-connections-dialog';dialog.className='settings-dialog instructions-dialog';
  dialog.setAttribute('aria-labelledby','connections-title');
  dialog.innerHTML=`<div class="dialog-card"><div class="dialog-heading"><h2 id="connections-title">我的模型连接</h2><button class="icon-button" id="connections-close" type="button" aria-label="关闭模型连接">×</button></div>
    <p>每个账户可添加、修改自己的 URL、API Key 和模型，跨设备保存。站点提供的模型仍可选择。</p>
    <p id="connections-status" role="status" aria-live="polite"></p><div id="connections-controls">
    <label for="connections-list">已保存的个人连接</label><select id="connections-list"></select>
    <div class="project-actions"><button type="button" class="secondary-button" id="connections-new">添加自己的连接</button><button type="button" class="text-button" id="connections-refresh">重新读取</button></div>
    <form id="connections-form" hidden>
    <label for="connections-label">连接名称</label><input id="connections-label" maxlength="80" required autocomplete="off" placeholder="例如：我的模型服务">
    <label for="connections-protocol">API 协议</label><select id="connections-protocol"><option value="chat-completions">OpenAI 兼容 · Chat Completions</option><option value="responses">OpenAI 兼容 · Responses</option></select>
    <label for="connections-url">API Base URL 或完整请求地址</label><input id="connections-url" type="url" required maxlength="2048" autocomplete="off" spellcheck="false" placeholder="https://api.example.com/v1">
    <p class="context-help">可填服务的 Base URL，保存时补全对应协议路径；仅支持公网 HTTPS，不接受内网、本机地址或跳转。没有固定的服务商名单。</p>
    <label for="connections-key">你的 API Key</label><input id="connections-key" type="password" maxlength="4096" autocomplete="new-password" spellcheck="false">
    <p id="connections-key-note" class="context-help"></p>
    <label for="connections-models">模型 ID（每行一个，最多24个；第一行为默认模型）</label><textarea id="connections-models" rows="4" maxlength="4700" required spellcheck="false" placeholder="填写服务商提供的模型 ID"></textarea>
    <label><input id="connections-vision" type="checkbox"> 服务商已确认这些模型支持图片输入</label>
    <p>选择此连接提问时，消息和你已启用的记忆、指令、资料或图片会发送到填写的服务，请确认服务可信。保存连接不会调用模型。密钥在服务器加密保管，页面不会读回密钥，也不写入浏览器存储或聊天备份。</p>
    <div class="project-actions"><button type="submit" class="primary-button" id="connections-save">保存连接</button><button type="button" class="text-button" id="connections-delete">删除此连接</button></div></form></div></div>`;
  document.body.append(dialog);const $=name=>dialog.querySelector('#connections-'+name);
  const entry=document.createElement('button');entry.id='open-model-connections';entry.className='ui-settings-link';entry.type='button';entry.textContent='我的模型连接 · 自定义 URL';
  document.querySelector('#ui-settings-chat')?.prepend(entry);
  let base=null,selected='',working=false,loaded=false,baseline='',lastFocus=null;
  function values(){return {id:selected,label:$('label').value,apiUrl:$('url').value.trim(),protocol:$('protocol').value,apiKey:$('key').value.trim(),models:$('models').value.split(/\r?\n/).map(m=>m.trim()).filter(Boolean),vision:$('vision').checked};}
  const dirty=()=>!$('form').hidden&&JSON.stringify(values())!==baseline;
  function canDiscard(){return !dirty()||confirm('放弃此连接尚未保存的修改？');}
  function clearKey(){$('key').value='';}
  function controls(){
    for(const input of dialog.querySelectorAll('input,select,textarea,button'))input.disabled=working;
    $('new').disabled=working||!loaded||base.connections.length>=12;
    $('save').disabled=working||!loaded;$('delete').hidden=!base?.connections.some(c=>c.id===selected);
  }
  function edit(id){
    selected=id;const item=base.connections.find(c=>c.id===id);$('form').hidden=!id;
    $('label').value=item?.label||'';$('protocol').value=item?.protocol||'chat-completions';$('url').value=item?.apiUrl||'';clearKey();
    $('models').value=item?.models.join('\n')||'';$('vision').checked=item?.vision===true;
    $('key').placeholder=item?.keyConfigured?'已保存，地址和协议不变时可留空':'填写你自己的 API Key';
    $('key-note').textContent=item?.keyConfigured?'已有密钥不会显示；修改 URL 或协议时必须重新填写密钥。':'新增连接必须填写自己的密钥。';
    $('list').replaceChildren();
    if(!base.connections.length||!item){const o=new Option(id?'尚未保存的新连接':'暂无个人连接',id||'');$('list').append(o);}
    for(const c of base.connections)$('list').append(new Option(c.label,c.id));$('list').value=id||'';
    baseline=JSON.stringify(values());controls();
  }
  async function request(method='GET',body){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
    try{
      const response=await fetch('/api/account/connections',{method,credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:{'content-type':'application/json','x-plaude-client':'1','x-plaude-account-id':user.id},...(body?{body:JSON.stringify(body)}:{})});
      if([401,403].includes(response.status)){identityChanged();throw Error('账户已切换，请重新登录。');}
      const data=await response.json();if(!response.ok)throw Error(data.error||'连接操作失败。');
      if(data.userId!==user.id||!Number.isSafeInteger(data.revision)||!Array.isArray(data.connections))throw Error('账户或连接版本无效，请刷新重试。');
      return data;
    }catch(error){if(controller.signal.aborted)throw Error('连接请求超时，草稿保留；请重新读取以核对云端状态。');throw error;}finally{clearTimeout(timer);}
  }
  async function action(fn){if(working)return;working=true;controls();try{await fn();}catch(error){$('status').textContent=error.message;}finally{working=false;controls();}}
  async function read(){base=await request();loaded=true;edit(base.connections.find(c=>c.id===selected)?.id||base.connections[0]?.id||'');await reloadProviders();$('status').textContent=base.connections.length?'已读取当前账户的个人连接。':'暂无个人连接，点击“添加自己的连接”。';}
  async function open(){
    if(working)return;
    if(dialog.open){$('label').focus();return;}
    if(busy())return toast('请等待回复或后台保存结束后再修改模型连接。');
    if(!user)return toast('请先登录个人账户，再添加自己的模型连接。');
    lastFocus=document.activeElement;for(const d of document.querySelectorAll('dialog[open]'))d.close();
    dialog.showModal();$('status').textContent='正在读取个人连接…';loaded=false;base={connections:[]};edit('');await action(read);
  }
  function close(){if(working||!canDiscard())return;clearKey();base=null;loaded=false;baseline='';$('models').value='';$('url').value='';dialog.close();lastFocus?.focus();}
  entry.onclick=()=>void open();$('close').onclick=close;dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
  dialog.addEventListener('close',clearKey);
  $('list').onchange=()=>{const next=$('list').value;if(!canDiscard()){$('list').value=selected;return;}edit(next);};
  $('new').onclick=()=>{if(!canDiscard())return;edit('mine-'+crypto.randomUUID().replaceAll('-','').slice(0,24));$('label').focus();};
  $('refresh').onclick=()=>{if(canDiscard())void action(read);};
  $('form').onsubmit=event=>{event.preventDefault();void action(async()=>{
    if(busy())throw Error('请等待回复或后台保存结束后再修改连接。');
    const value=values(),connection=validateConnection({...value,model:value.models[0]});
    const connections=base.connections.filter(c=>c.id!==selected).map(({keyConfigured,...c})=>({...c,apiKey:''}));connections.push(connection);
    const saved=await request('PUT',{revision:base.revision,connections});base=saved;loaded=true;edit(selected);clearKey();
    await reloadProviders();$('status').textContent='连接已保存。请在聊天顶部选择“我的 · '+connection.label+'”使用；没有调用模型。';
  });};
  $('delete').onclick=()=>{if(!confirm('删除此个人连接？原聊天保留，后续不会再使用此连接。'))return;void action(async()=>{
    if(busy())throw Error('请等待回复或后台保存结束后再删除连接。');
    const connections=base.connections.filter(c=>c.id!==selected).map(({keyConfigured,...c})=>({...c,apiKey:''}));
    base=await request('PUT',{revision:base.revision,connections});edit(base.connections[0]?.id||'');await reloadProviders();$('status').textContent='个人连接已删除，聊天记录保留。';
  });};
  return {open,isBusy:()=>working||dialog.open&&dirty()};
}
