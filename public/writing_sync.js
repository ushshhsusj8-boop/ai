import {validateWritingNotes} from './writing_store.js';

const KEY='plaude-writing-sync-v1', ID=/^[A-Za-z0-9_-]{8,128}$/;
const fingerprint=note=>JSON.stringify({title:note.title,text:note.text});
export function createWritingSync({userId,store,storage,fetchImpl=globalThis.fetch,busy=()=>false,
  changed=()=>{},status=()=>{},isCurrent=()=>true,onIdentityChanged=()=>{},requestTimeoutMs=20000}) {
  if(typeof userId!=='string'||!userId)throw Error('请先登录个人账户。');
  let known=Object.create(null),ready=false,running=null,timer,again=false,lastError='';
  const conflicts=new Map();
  try{const value=JSON.parse(storage.getItem(KEY)||'{}');if(value&&typeof value==='object'&&!Array.isArray(value))for(const [id,record]of Object.entries(value).slice(0,5000))if(ID.test(id)&&Number.isSafeInteger(record?.revision)&&record.revision>0&&typeof record.fingerprint==='string'&&record.fingerprint.length<600000)known[id]=record;}catch{}
  const persist=()=>storage.setItem(KEY,JSON.stringify(known));
  function identity(){if(!isCurrent())throw Error('账户已改变，未载入或上传文稿。');}
  async function request(path='',options={}) {
    identity();const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),requestTimeoutMs);
    try{
      const response=await fetchImpl('/api/account/writing-notes'+path,{...options,credentials:'same-origin',cache:'no-store',signal:controller.signal,
        headers:{accept:'application/json','content-type':'application/json','x-plaude-client':'1','x-plaude-account-id':userId}});
      const value=await response.json();identity();
      if([401,403].includes(response.status)){onIdentityChanged();throw Error('登录状态已改变，请重新登录；本机文稿保留。');}
      if(!response.ok){const error=Error(value.error||'文稿云同步失败，本机内容保留。');error.status=response.status;throw error;}
      if(value.userId!==userId)throw Error('账户身份不匹配，未载入文稿。');return value;
    }catch(error){if(controller.signal.aborted)throw Error('文稿云同步超时，本机修改已保留，请重新同步。');throw error;}
    finally{clearTimeout(timeout);}
  }
  function envelope(value){
    const notes=validateWritingNotes(value.notes),ids=new Set(notes.map(n=>n.id));
    if(!Array.isArray(value.deleted)||value.deleted.length>5000)throw Error('云端文稿版本无效，本机内容保留。');
    for(const record of value.deleted){if(!record||!ID.test(record.id)||ids.has(record.id)||!Number.isSafeInteger(record.revision)||record.revision<1)throw Error('云端文稿版本无效，本机内容保留。');ids.add(record.id);}
    return{notes,deleted:value.deleted};
  }
  const remember=note=>{known[note.id]={revision:note.revision,fingerprint:fingerprint(note)};};
  async function pull(){
    const data=envelope(await request()),remoteIds=new Set();let modified=false;
    for(const cloud of data.notes){
      remoteIds.add(cloud.id);if(busy(cloud.id))continue;
      const local=store.list().find(n=>n.id===cloud.id),base=known[cloud.id];
      if(local&&fingerprint(local)===fingerprint(cloud)){remember(cloud);conflicts.delete(cloud.id);continue;}
      const dirty=local&&base&&fingerprint(local)!==base.fingerprint;
      if(local&&(!base||dirty&&base.revision!==cloud.revision)||!local&&base&&base.revision!==cloud.revision){conflicts.set(cloud.id,cloud);continue;}
      if(!local&&base)continue; // A local deletion is still pending; do not resurrect it.
      if(!local||!dirty){store.adopt(cloud,local?.revision||0);remember(cloud);conflicts.delete(cloud.id);modified=true;}
    }
    for(const id of Object.keys(known)){
      if(remoteIds.has(id)||busy(id))continue;
      const local=store.list().find(n=>n.id===id);
      if(local&&fingerprint(local)!==known[id].fingerprint)conflicts.set(id,null);
      else{if(local){store.remove(id,local.revision);modified=true;}delete known[id];conflicts.delete(id);}
    }
    for(const deleted of data.deleted)if(store.list().some(n=>n.id===deleted.id)&&!known[deleted.id]&&!busy(deleted.id))conflicts.set(deleted.id,null);
    ready=true;persist();if(modified)changed();
  }
  async function push(){
    for(const local of store.list()){
      if(busy(local.id)||conflicts.has(local.id)||known[local.id]?.fingerprint===fingerprint(local))continue;
      try{const result=await request('/'+encodeURIComponent(local.id),{method:'PUT',body:JSON.stringify({note:local,revision:known[local.id]?.revision||0})});
        const note=validateWritingNotes([result.note])[0];if(note.id!==local.id||fingerprint(note)!==fingerprint(local))throw Error('云端确认内容不一致，本机修改保留。');remember(note);persist();
      }catch(error){if(error.status!==409)throw error;conflicts.set(local.id,undefined);}
    }
    const localIds=new Set(store.list().map(n=>n.id));
    for(const id of Object.keys(known)){
      if(localIds.has(id)||busy(id)||conflicts.has(id))continue;
      try{await request('/'+encodeURIComponent(id),{method:'DELETE',body:JSON.stringify({revision:known[id].revision})});delete known[id];persist();}
      catch(error){if(error.status===404){delete known[id];persist();}else if(error.status===409)conflicts.set(id,undefined);else throw error;}
    }
  }
  function report(){
    let local;try{local=store.list();}catch(error){lastError=error.message;local=[];}const ids=new Set(local.map(n=>n.id)),pending=local.filter(n=>busy(n.id)||!conflicts.has(n.id)&&fingerprint(n)!==known[n.id]?.fingerprint).length
      +Object.keys(known).filter(id=>!ids.has(id)&&!conflicts.has(id)).length;
    const result={synced:!lastError&&!pending&&!conflicts.size,pending,conflicts:conflicts.size,error:lastError,running:Boolean(running)};
    result.message=lastError?'尚未同步到云端：'+lastError+' · 本机文稿保留':conflicts.size?`有${conflicts.size}份文稿冲突 · 本机与云端版本均保留，请处理冲突`:pending?`${pending}份文稿等待同步 · 本机修改已保留`:'文稿已同步到当前账户云端';
    status(result);return result;
  }
  function sync(){
    clearTimeout(timer);again=true;if(running)return running;
    running=(async()=>{let rounds=0;try{do{again=false;if(!ready)await pull();await push();await pull();rounds++;}while(again&&rounds<3);lastError='';}
      catch(error){lastError=error.message||'网络无法连接';}
      finally{running=null;}const result=report();if(again&&!lastError)schedule();return result;})();return running;
  }
  function schedule(){clearTimeout(timer);report();timer=setTimeout(()=>void sync(),700);}
  return Object.freeze({sync,schedule,get running(){return Boolean(running);},get conflicts(){return conflicts.size;},
    isSynced:note=>!lastError&&!conflicts.has(note.id)&&fingerprint(note)===known[note.id]?.fingerprint,
    async resolve(confirmImpl=globalThis.confirm){
      try{await pull();}catch(error){lastError=error.message;report();return false;}
      if(!conflicts.size)return true;
      if(!confirmImpl(`处理${conflicts.size}份文稿冲突：本机修改另存副本，原编号载入云端版本；云端已删除时仅保留本机副本。不会覆盖云端内容。继续？`))return false;
      try{for(const [id,cloud]of [...conflicts]){if(busy(id))throw Error('请先保存正在编辑的文字，再处理冲突。');store.resolve(id,cloud);if(cloud)remember(cloud);else delete known[id];conflicts.delete(id);persist();}changed();lastError='';await sync();return true;}
      catch(error){lastError=error.message;report();return false;}
    },
  });
}
