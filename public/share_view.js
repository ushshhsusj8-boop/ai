import {validateShareSnapshot} from './share_tools.js';
import {withStoredLimits} from './site_limits.js';
const $=id=>document.getElementById('shared-'+id);
document.documentElement.dataset.theme=matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light';
const token=location.hash.slice(1);let controller=null,epoch=0,expiryTimer;
function clear(){epoch++;controller?.abort();controller=null;clearTimeout(expiryTimer);$('title').textContent='';$('messages').replaceChildren();}
async function load(){clear();const current=epoch;if(!/^[A-Za-z0-9_-]{43}$/.test(token)){$('status').textContent='分享链接不完整或不可用，请向分享者索取完整链接。';return;}
  const request=new AbortController();controller=request;const timer=setTimeout(()=>request.abort(),20000);$('status').textContent='正在核对分享状态…';
  try{const response=await fetch('/api/share-view',{credentials:'omit',cache:'no-store',signal:request.signal,headers:{'x-plaude-share-token':token}});const data=await response.json();if(current!==epoch)return;if(!response.ok)throw Error(data.error||'分享已失效或暂不可用。');const snapshot=withStoredLimits(()=>validateShareSnapshot(data.snapshot));if(!Number.isSafeInteger(data.expiresAt)||!Number.isSafeInteger(data.expiresInMs)||data.expiresInMs<=0||data.expiresInMs>30*86400000)throw Error('分享链接已过期。');
    $('title').textContent=snapshot.title;document.title='只读分享 · plaude chat';$('messages').replaceChildren(...snapshot.messages.map(m=>{const article=document.createElement('article'),role=document.createElement('strong'),body=document.createElement('div');role.textContent=m.role==='user'?'你':'AI';body.className='message-text';if(m.role==='assistant'&&window.renderMessageMarkdown)window.renderMessageMarkdown(m.content,body);else body.textContent=m.content;article.append(role,body);return article;}));$('status').textContent='只读文字快照 · 到期 '+new Date(data.expiresAt).toLocaleString();expiryTimer=setTimeout(load,Math.min(data.expiresInMs+10,2147483000));
  }catch(e){if(current===epoch){$('title').textContent='';$('messages').replaceChildren();$('status').textContent=request.signal.aborted?'读取超时，请刷新重试。':e.message;}}finally{clearTimeout(timer);if(controller===request)controller=null;}}
window.addEventListener('pagehide',()=>{clear();$('status').textContent='离开页面后将重新核对分享状态。';});
window.addEventListener('pageshow',e=>{if(e.persisted)void load();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void load();});
void load();
