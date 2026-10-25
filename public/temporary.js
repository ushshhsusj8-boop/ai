import {getLimits} from './site_limits.js';
import {prepareChatContext} from './context_budget.js';
import {readChatStream} from './event_stream.js';
const theme=new URL(location.href).searchParams.get('theme');document.documentElement.dataset.theme=['dark','light'].includes(theme)?theme:(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light');
const $=id=>document.getElementById('temporary-'+id);
let messages=[],providers=[],userId=null,controller=null,ready=false,disposed=false,failed=false,limit=24000,outputSupported=true;
const text=value=>$('status').textContent=value;
function controls(){const busy=!!controller;for(const id of ['provider','model','output'])$(id).disabled=!ready||busy||(id==='output'&&!outputSupported);$('input').disabled=!ready;$('send').disabled=!ready||busy||!$('input').value.trim();$('stop').hidden=!busy;$('retry').hidden=!failed||busy||!ready;}
function paint(){
  const near=$('messages').scrollHeight-$('messages').clientHeight-$('messages').scrollTop<120;
  $('messages').replaceChildren(...messages.map(m=>{const article=document.createElement('article');article.className='temporary-message';article.dataset.role=m.role;const role=document.createElement('strong');role.textContent=m.role==='user'?'你':'AI';const body=document.createElement('div');body.className='message-text';if(m.role==='assistant'&&!m.streaming&&window.renderMessageMarkdown)window.renderMessageMarkdown(m.content,body);else body.textContent=m.content;article.append(role,body);return article;}));
  if(near)$('messages').scrollTop=$('messages').scrollHeight;
}
function dispose(){disposed=true;ready=false;controller?.abort();controller=null;messages.length=0;userId=null;failed=false;$('input').value='';$('output').value='';$('messages').replaceChildren();controls();}
function identityChanged(){dispose();text('账户状态已改变，临时内容已清除。请返回普通聊天重新登录。');}
let channel;try{channel=new BroadcastChannel('plaude-account-change');channel.onmessage=identityChanged;}catch{}
window.addEventListener('storage',e=>{if(e.key==='plaude-account-change-v1'&&e.newValue)identityChanged();});
window.addEventListener('pagehide',()=>{dispose();channel?.close();});
window.addEventListener('pageshow',e=>{if(e.persisted){dispose();text('离开前的临时内容已清除，请刷新开始新的临时聊天。');}});
$('exit').onclick=()=>{if((messages.length||$('input').value.trim())&&!confirm('结束临时聊天？本页内容将清除，无法恢复。'))return;dispose();location.assign('/');};
function modelOptions(){const provider=providers.find(p=>p.id===$('provider').value);$('model').replaceChildren(...(provider?.models||[]).map(m=>{const o=document.createElement('option');o.value=m.id;o.textContent=m.label||m.id;return o;}));outputBounds();}
function outputBounds(){const provider=providers.find(p=>p.id===$('provider').value),model=provider?.models?.find(m=>m.id===$('model').value);const bounds=(model?.parameters||provider?.parameters)?.max_output_tokens;outputSupported=!!bounds;$('output').value='';$('output').min=String(bounds?.min||1);if(bounds?.max)$('output').max=String(bounds.max);else $('output').removeAttribute('max');controls();}
$('provider').onchange=modelOptions;$('model').onchange=outputBounds;$('input').oninput=controls;
$('input').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.keyCode!==229){e.preventDefault();if(!$('send').disabled)$('form').requestSubmit();}};
$('stop').onclick=()=>controller?.abort();
async function generate(retry=false){
  if(!ready||controller||disposed)return;
  let prepared;try{
    if(!$('output').checkValidity())throw Error('最大输出token不在当前模型支持的范围。');
    const content=$('input').value.trim();if(!retry&&!content)return;
    const source=retry?messages.slice(0,messages.findLastIndex(m=>m.role==='user')+1):[...messages,{role:'user',content}];
    prepared=prepareChatContext(source,{}, {maxInputChars:limit,historyBudget:getLimits().historyChars});
    if(!retry){messages.push({role:'user',content});$('input').value='';}
  }catch(error){text(error.message);return;}
  const request=new AbortController();controller=request;failed=false;controls();paint();text('正在生成；关闭页面会停止并清除本页内容。');
  const timer=setTimeout(()=>request.abort(),getLimits().requestTimeoutMs+30000);let answer=null;
  const add=delta=>{if(disposed||request.signal.aborted)return;if(!answer){if(retry&&messages.at(-1)?.role==='assistant')messages.pop();answer={role:'assistant',content:'',streaming:true};messages.push(answer);}if(answer.content.length+delta.length>getLimits().replyChars)throw Error('回复超过本页大小限制，已收到的文字保留。');answer.content+=delta;paint();};
  try{
    const response=await fetch('/api/chat',{method:'POST',credentials:'same-origin',cache:'no-store',signal:request.signal,headers:{'content-type':'application/json',accept:'text/event-stream','x-yunjian-ui':'browser','x-plaude-client':'1','x-plaude-account-id':userId},body:JSON.stringify({temporary:true,provider:$('provider').value,...(providers.find(p=>p.id===$('provider').value)?.privateConnection?{connectionRevision:providers.find(p=>p.id===$('provider').value).connectionRevision}:{}),model:$('model').value,messages:prepared.messages,...($('output').value?{parameters:{max_output_tokens:Number($('output').value)}}:{})})});
    if(disposed)return;
    if([401,403].includes(response.status)){identityChanged();return;}
    const value=response.ok&&response.headers.get('content-type')?.includes('text/event-stream')?await readChatStream(response,add,m=>{if(!disposed)text(m||'正在生成…');}):await response.json();
    if(disposed)return;if(!response.ok)throw Error(value.error||'请求失败，请重试。');
    if(typeof value.text!=='string'||!value.text.trim()||value.text.length>getLimits().replyChars)throw Error('模型返回的文字无效，已收到的内容保留。');
    if(!answer)add('');answer.content=value.text;answer.streaming=false;paint();text(value.finishReason==='length'?'已达本次输出上限，可调大输出或继续提问。':`回复完成 · 携带${prepared.report.historyTurns}轮历史，省略${prepared.report.omittedMessages}条 · 本页不保存`);
  }catch(error){if(!disposed){failed=true;if(answer)answer.streaming=false;paint();text(request.signal.aborted?'已停止，当前页收到的文字保留。可重试或继续提问。':error.message);}}
  finally{clearTimeout(timer);if(controller===request)controller=null;if(!disposed)controls();}
}
$('form').onsubmit=e=>{e.preventDefault();void generate();};$('retry').onclick=()=>void generate(true);
async function initialize(){const start=new AbortController(),timer=setTimeout(()=>start.abort(),20000);try{
  const options={credentials:'same-origin',cache:'no-store',signal:start.signal};const session=await fetch('/api/account/session',options);if(!session.ok)throw Error('账户暂时无法确认，请刷新重试。');const identity=await session.json();if(!identity.user?.id)throw Error('请先返回普通聊天登录个人账户，再进入临时聊天。');
  const response=await fetch('/api/providers',{...options,headers:{'x-plaude-client':'1','x-plaude-account-id':identity.user.id}});if(!response.ok)throw Error('模型列表读取失败，请刷新重试。');const data=await response.json();if(disposed)return;userId=identity.user.id;providers=data.providers||[];limit=data.limits?.maxInputChars||24000;
  $('provider').replaceChildren(...providers.map(p=>{const o=document.createElement('option');o.value=p.id;o.textContent=p.label||p.id;return o;}));$('provider').value=data.defaultProvider||providers[0]?.id;modelOptions();ready=!!$('model').value;text(ready?'临时文字聊天已就绪；不读取记忆和通用指令。':'暂无可用模型。');controls();if(ready)$('input').focus();
}catch(error){if(!disposed){text(start.signal.aborted?'连接超时，请刷新重试。':error.message);controls();}}finally{clearTimeout(timer);}}
$('input').maxLength=getLimits().promptChars;
void initialize();
