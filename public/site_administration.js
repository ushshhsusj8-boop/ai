import {LIMIT_FIELDS,DEVELOPER_LIMITS,OPEN_LIMITS,validateSiteLimits} from './site_limits.js';
import {accountUser,accountHeaders,accountAdministration} from './account.js';

export function initSiteAdministration({beforeReload=()=>{}}={}){
 const dialog=document.createElement('dialog');dialog.id='site-administration-dialog';dialog.className='settings-dialog instructions-dialog';dialog.setAttribute('aria-labelledby','site-admin-title');
 dialog.innerHTML=`<div class="dialog-card"><div class="dialog-heading"><h2 id="site-admin-title">站点管理 · 开发者额度</h2><button type="button" class="icon-button" id="site-admin-close" aria-label="关闭站点管理">×</button></div>
 <p>所有者可指定管理员；管理员可调整全站额度。这些权限不提供其他账户的私有聊天、原文件或密钥访问。</p>
 <p id="site-admin-status" role="status" aria-live="polite"></p><form id="site-admin-claim-form" hidden><p>首次绑定需要验证服务器管理权。请在自己的服务器终端按使用说明生成一次性绑定码（30分钟有效），再在此绑定当前登录账户。普通注册不会自动取得管理权；绑定码不会作为网站邀请码。</p><label for="site-admin-claim-code">一次性绑定码</label><input id="site-admin-claim-code" type="password" autocomplete="off" required minlength="43" maxlength="43"><button type="submit" class="primary-button">将当前账户绑定为站点所有者</button></form><div id="site-admin-controls" hidden>
 <div class="project-actions"><button type="button" class="secondary-button" id="site-admin-developer">开发者高额度预设</button><button type="button" class="secondary-button" id="site-admin-open">填入可配置上限</button><button type="button" class="text-button" id="site-admin-refresh">重新读取</button></div>
 <p>请求数、Token、频率为0时，本站不另设软额度；搜索次数、工具次数、搜索结果为0时不向服务商指定限制。模型自身窗口、输出上限和服务商额度仍生效。文件与传输保留当前服务器的资源边界；代码执行继续为20秒、384MiB、无网络，并须手动运行。</p>
 <form id="site-admin-form"><div id="site-admin-fields"></div><label for="site-admin-search-context">搜索上下文</label><select id="site-admin-search-context"><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select><div class="project-actions"><button type="submit" class="primary-button" id="site-admin-save">保存全站额度</button><button type="button" class="secondary-button" id="site-admin-reload">保存草稿并重新载入页面</button></div></form>
 <section id="site-admin-owners" hidden><h3>管理员（开发者）</h3><div id="site-admin-members"></div><form id="site-admin-member-form"><label for="site-admin-username">已注册的本站用户名</label><input id="site-admin-username" autocomplete="off" maxlength="32" required><button type="submit" class="secondary-button" id="site-admin-add">指定为管理员</button></form><p>所有者不能在此被撤销。管理员不能指定其他管理员。</p></section></div></div>`;
 document.body.append(dialog);const $=id=>dialog.querySelector('#site-admin-'+id);
 const entry=document.createElement('button');entry.type='button';entry.id='open-site-administration';entry.className='ui-settings-link';entry.textContent='站点管理 · 开发者额度';
 const unbound=accountUser&&accountAdministration?.ownerConfigured===false;
 if(accountAdministration?.canAdminister||unbound)document.querySelector('#ui-settings-chat')?.prepend(entry);
 if(unbound){entry.textContent='绑定站点所有者';$('claim-form').hidden=false;}
 const groups={requests:'请求与并发',chat:'输入、上下文与回复',search:'联网与工具',documents:'文件解析与资料检索',images:'图片',memory:'指令与记忆',storage:'保存、备份与连接',sharing:'只读分享'};
 const inputs=new Map();for(const[group,title]of Object.entries(groups)){
  const section=document.createElement('details');section.open=['requests','search'].includes(group);const heading=document.createElement('summary');heading.textContent=title;section.append(heading);
  for(const[key,v]of Object.entries(LIMIT_FIELDS).filter(([,v])=>v[4]===group)){
   const label=document.createElement('label');label.htmlFor='site-limit-'+key;label.textContent=v[5]+'（'+v[6]+'）';const input=document.createElement('input');input.type='number';input.id=label.htmlFor;input.min=String(v[2]);input.max=String(v[3]);input.step='1';input.required=true;input.inputMode='numeric';input.style.maxWidth='100%';section.append(label,input);inputs.set(key,input);
  }$('fields').append(section);
 }
 let base=null,working=false,baseline='',focus;
 const values=()=>({...Object.fromEntries([...inputs].map(([k,i])=>[k,Number(i.value)])),searchContext:$('search-context').value});
 const dirty=()=>base&&JSON.stringify(values())!==baseline;
 const status=text=>{$('status').textContent=text;};
 const allowedDiscard=()=>!dirty()||confirm('放弃尚未保存的额度编辑？');
 function fill(limits){for(const[k,input]of inputs)input.value=String(limits[k]);$('search-context').value=limits.searchContext;}
 async function request(path='',body,method=body?'PUT':'GET'){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try{const response=await fetch('/api/account/administration'+path,{method,credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:{...accountHeaders(),'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();if(!response.ok)throw Error(data.error||'站点管理请求失败。');validateSiteLimits(data.limits);if(!['owner','admin'].includes(data.role)||!Number.isSafeInteger(data.revision))throw Error('管理响应无效。');return data;}
  catch(error){if(controller.signal.aborted)throw Error('请求超时，编辑保留；请重新读取以核对云端状态。');throw error;}finally{clearTimeout(timer);}
 }
 function accept(value){base=value;fill(base.limits);baseline=JSON.stringify(values());$('controls').hidden=false;$('owners').hidden=!base.canManageAdministrators;$('members').replaceChildren();
  for(const user of base.administrators||[]){const row=document.createElement('p');row.textContent=user.username+(user.role==='owner'?' · 站点所有者':' · 管理员');if(user.role!=='owner'){const revoke=document.createElement('button');revoke.type='button';revoke.className='text-button';revoke.textContent='撤销';revoke.onclick=()=>void run(async()=>{if(dirty())throw Error('请先保存或重新读取额度编辑，再修改管理员。');if(!confirm('撤销 '+user.username+' 的管理员权限？'))return;accept(await request('/administrators',{revision:base.revision,username:user.username,administrator:false}));status('管理员权限已撤销，私有资料保留。');});row.append(revoke);}$('members').append(row);}
 }
 async function run(operation){if(working)return;working=true;dialog.setAttribute('aria-busy','true');for(const input of dialog.querySelectorAll('button,input,select'))input.disabled=true;try{await operation();}catch(error){status(error.message);}finally{working=false;dialog.removeAttribute('aria-busy');for(const input of dialog.querySelectorAll('button,input,select'))input.disabled=false;}}
 entry.onclick=()=>{focus=document.activeElement;document.querySelector('dialog[open]')?.close();dialog.showModal();if(!base&&$('claim-form').hidden)void run(async()=>{accept(await request());status('当前身份：'+(base.role==='owner'?'站点所有者':'管理员')+'。修改只在保存后生效。');});};
 $('claim-form').onsubmit=event=>{event.preventDefault();void run(async()=>{try{accept(await request('/claim',{code:$('claim-code').value.trim()},'POST'));$('claim-form').hidden=true;entry.textContent='站点管理 · 开发者额度';status('当前登录账户已绑定为站点所有者；绑定码已失效。');}finally{$('claim-code').value='';}});};
 $('close').onclick=()=>{if(!working&&allowedDiscard())dialog.close();};dialog.addEventListener('cancel',event=>{if(working||!allowedDiscard())event.preventDefault();});dialog.addEventListener('close',()=>focus?.focus());
 $('refresh').onclick=()=>{if(allowedDiscard())void run(async()=>{accept(await request());status('已重新读取。');});};
 $('developer').onclick=()=>{fill(DEVELOPER_LIMITS);status('已填入开发者高额度，尚未保存。');};$('open').onclick=()=>{fill(OPEN_LIMITS);status('已填入资源边界内的可配置上限，尚未保存。');};
 $('form').onsubmit=event=>{event.preventDefault();void run(async()=>{const limits=validateSiteLimits(values());accept(await request('/limits',{revision:base.revision,limits}));status('已保存。新请求使用新设置；点击重新载入使本页全部编辑器采用新设置，已在生成的请求保持原预算。');});};
 $('reload').onclick=()=>void run(async()=>{if(dirty())throw Error('请先保存额度或重新读取，再重新载入。');await beforeReload();location.reload();});
 $('member-form').onsubmit=event=>{event.preventDefault();void run(async()=>{if(dirty())throw Error('请先保存额度编辑，再指定管理员。');const username=$('username').value.trim();accept(await request('/administrators',{revision:base.revision,username,administrator:true}));$('username').value='';status('已指定管理员；对方重新载入页面后可见管理入口。');});};
 return{busy:()=>working};
}
