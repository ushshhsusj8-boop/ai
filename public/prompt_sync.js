import {withStoredLimits} from './site_limits.js';
import {loadPromptLibrary,savePromptLibrary,validatePromptLibrary,validatePromptChange,createPrompt} from './prompt_library.js';

export const PROMPT_CLOUD_KEY='plaude-prompt-cloud-v1';
const fingerprint=prompts=>JSON.stringify(prompts);
// One atomic browser envelope holds both the local edits and their cloud baseline.
export function createPromptSync({userId,storage,fetchImpl=globalThis.fetch,isCurrent=()=>true,
  busy=()=>false,changed=()=>{},status=()=>{},onIdentityChanged=()=>{},requestTimeoutMs=20000}) {
  let ready=false,running=null,conflict=false,lastError='',timer,again=false;
  function identity(){if(!isCurrent())throw Error('账户已改变，本机提示词保留。');}
  function read(){return withStoredLimits(readStored);}
  function readStored(){
    identity();const raw=storage.getItem(PROMPT_CLOUD_KEY);if(raw===null)return null;
    const value=JSON.parse(raw);
    if(value?.version!==1||!Number.isSafeInteger(value.revision)||value.revision<0)throw Error('本机提示词版本无效，请先导出备份。');
    value.prompts=validatePromptLibrary(value.prompts);value.base=validatePromptLibrary(value.base);return value;
  }
  function write(value){identity();storage.setItem(PROMPT_CLOUD_KEY,JSON.stringify(value));}
  const list=()=>read()?.prompts||loadPromptLibrary(storage);
  function report(){
    let value,legacyAvailable=false;try{value=read();legacyAvailable=!value?.migrated&&loadPromptLibrary(storage).length>0;}catch(error){lastError=error.message;}
    const pending=value&&fingerprint(value.prompts)!==fingerprint(value.base);
    const message=lastError?'尚未同步：'+lastError+' · 本机内容保留':!value?'旧本机库尚未迁移；云端内容不会覆盖本机库':conflict?'版本冲突 · 本机与云端均保留，请合并副本':busy()?'编辑中 · 请保存后同步':pending?'本机修改已保存 · 等待云同步':!ready?'尚未读取云端 · 本机内容保留':running?'正在同步提示词库':'提示词库已同步到当前账户云端';
    const result={message,error:lastError,conflict,legacy:!value,legacyAvailable,pending:Boolean(pending),running:Boolean(running)};status(result);return result;
  }
  async function request(options={}){
    identity();const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),requestTimeoutMs);
    try{
      const response=await fetchImpl('/api/account/prompt-library',{...options,credentials:'same-origin',cache:'no-store',signal:controller.signal,
        headers:{accept:'application/json','content-type':'application/json','x-plaude-client':'1','x-plaude-account-id':userId}});
      const value=await response.json();identity();
      if([401,403].includes(response.status)){onIdentityChanged();throw Error('登录状态已改变，请重新登录。');}
      if(!response.ok)throw Object.assign(Error(value.error||'提示词云同步失败'),{status:response.status});
      if(value.userId!==userId||!Number.isSafeInteger(value.revision)||value.revision<0)throw Error('云端身份或版本不匹配。');
      return{revision:value.revision,prompts:withStoredLimits(()=>validatePromptLibrary(value.prompts))};
    }catch(error){if(controller.signal.aborted)throw Error('提示词云同步超时，请重试。');throw error;}finally{clearTimeout(timeout);}
  }
  function adopt(remote){const previous=read();write({version:1,...remote,base:remote.prompts,migrated:previous?.migrated===true});conflict=false;changed();}
  async function perform(){
    const remote=await request();ready=true;let value=read();
    if(!value){
      if(loadPromptLibrary(storage).length)return; // An explicit migration is required.
      if(busy())return;
      adopt(remote);return;
    }
    const dirty=fingerprint(value.prompts)!==fingerprint(value.base);
    if(fingerprint(value.prompts)===fingerprint(remote.prompts)){
      write({...value,revision:remote.revision,base:remote.prompts});conflict=false;return;
    }
    if(!dirty){if(!busy())adopt(remote);return;}
    if(value.revision!==remote.revision){conflict=true;return;}
    const sent=value.prompts;
    try{
      const accepted=await request({method:'PUT',body:JSON.stringify({revision:value.revision,prompts:sent})});
      if(fingerprint(accepted.prompts)!==fingerprint(sent)||accepted.revision!==value.revision+1)throw Error('云端确认内容不一致。');
      value=read();if(value.revision>accepted.revision)throw Error('其他窗口已同步新版，请重新同步。');write({...value,revision:accepted.revision,base:accepted.prompts});conflict=false;
    }catch(error){if(error.status===409){conflict=true;return;}throw error;}
  }
  function sync(){
    clearTimeout(timer);if(running){again=true;return running;}
    running=(async()=>{let rounds=0;try{do{again=false;await perform();rounds++;}while(again&&!conflict&&rounds<3);lastError='';}catch(error){lastError=error.message;}finally{running=null;}return report();})();report();return running;
  }
  function save(prompts,expected){
    const value=read(),current=list();
    if(fingerprint(current)!==fingerprint(expected))throw Error('提示词库已在其他窗口更新，本次编辑未覆盖；请复制编辑文字后重新打开。');
    const {prompts:next}=validatePromptChange(prompts,current);
    if(value)write({...value,prompts:next});else savePromptLibrary(storage,next);
    conflict=false;lastError='';again=true;report();clearTimeout(timer);timer=setTimeout(()=>void sync(),500);return next;
  }
  function merge(local,remote){
    let result=remote.prompts;
    for(const item of local){
      const cloud=result.find(p=>p.id===item.id);
      if(cloud&&cloud.title===item.title&&cloud.content===item.content)continue;
      // Fresh IDs ensure a deleted cloud record cannot be resurrected silently.
      result=createPrompt(result,{title:item.title,content:item.content});
    }
    return result;
  }
  async function resolve(mode,confirmImpl=globalThis.confirm){
    if(running)await running;
    try{
      if(busy())throw Error('请先保存编辑文字，再处理云同步。');
      const local=list(),source=mode==='legacy'?loadPromptLibrary(storage):local,value=read(),remote=await request();
      const checkSource=()=>{if(mode==='legacy'&&fingerprint(loadPromptLibrary(storage))!==fingerprint(source))throw Error('旧本机库已在其他窗口修改，请重新迁移；最新内容已保留。');};
      checkSource();
      if(!confirmImpl(mode==='cloud'?'读取云端库？旧本机库仍保留，可随后迁移或导出。':'将本机与云端合并？不同内容另存副本，保留云端版本及原本机旧库；容量不足时不修改。'))return false;
      if(busy())throw Error('编辑文字已改变，请先保存。');
      checkSource();
      const prompts=mode==='cloud'?remote.prompts:merge(source,remote);
      if(fingerprint(list())!==fingerprint(local)||read()?.revision!==value?.revision)throw Error('其他窗口已修改，请重新处理。');
      write({version:1,revision:remote.revision,base:remote.prompts,prompts,migrated:value?.migrated===true||mode==='legacy'});conflict=false;ready=true;changed();await sync();return !lastError&&!conflict;
    }catch(error){lastError=error.message;report();return false;}
  }
  if(!read()&&!loadPromptLibrary(storage).length)write({version:1,revision:0,base:[],prompts:[]});
  return Object.freeze({list,save,sync,resolve,report,get running(){return Boolean(running);}});
}
