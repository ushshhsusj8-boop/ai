import {withStoredLimits} from '../public/site_limits.js';
import {randomBytes} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,statSync,openSync,writeFileSync,fsyncSync,closeSync,renameSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {validateMemories,validateMemoryChange,memoryContext,MEMORY_LIMITS} from '../public/memory_tools.js';
const fail=(message,statusCode=400)=>{throw Object.assign(Error(message),{statusCode});};
export function createAccountMemory(directory,{requireUser}) {
  function read(...args){return withStoredLimits(()=>readStored(...args));}
  function readStored(userId) {
    requireUser(userId); const file=join(directory,userId+'.json');
    if(!existsSync(file))return {file,value:{version:1,userId,revision:0,library:{enabled:true,entries:[]}}};
    if(statSync(file).size>MEMORY_LIMITS.backup)throw Error('Private memory storage exceeds its limit');
    const value=JSON.parse(readFileSync(file,'utf8'));
    if(value?.version!==1||value.userId!==userId||!Number.isSafeInteger(value.revision)||value.revision<0)throw Error('Invalid private memory storage');
    value.library=validateMemories(value.library);return {file,value};
  }
  const envelope=value=>({userId:value.userId,revision:value.revision,library:structuredClone(value.library)});
  return Object.freeze({
    list(userId){return envelope(read(userId).value);},
    put(userId,body={}){
      if(Object.keys(body).some(k=>!['revision','library'].includes(k))||!Number.isSafeInteger(body.revision)||body.revision<0)fail('记忆版本或字段无效。');
      const {file,value}=read(userId);
      if(value.revision!==body.revision)fail('记忆已在其他设备修改，未覆盖任何内容。请重新读取后核对，编辑草稿保留。',409);
      let library,restrictiveOnly;try{({library,restrictiveOnly}=validateMemoryChange(body.library,value.library));}catch(error){fail(error.message);}
      if(value.revision===Number.MAX_SAFE_INTEGER)fail('记忆版本已达上限。',413);
      const next={version:1,userId,revision:value.revision+1,library},serialized=JSON.stringify(next);
      const byteLimit=restrictiveOnly?withStoredLimits(()=>MEMORY_LIMITS.backup):MEMORY_LIMITS.backup;
      if(Buffer.byteLength(serialized)>byteLimit)fail('记忆容量已满。',413);
      mkdirSync(directory,{recursive:true,mode:0o700});const temp=file+'.'+randomBytes(12).toString('hex')+'.tmp';let handle;
      try{handle=openSync(temp,'wx',0o600);writeFileSync(handle,serialized,'utf8');fsyncSync(handle);closeSync(handle);handle=undefined;renameSync(temp,file);}finally{if(handle!==undefined)closeSync(handle);rmSync(temp,{force:true});}
      return envelope(next);
    },
    resolve(userId,selection){
      const {value}=read(userId);
      if(!selection||Object.keys(selection).some(k=>!['revision','ids'].includes(k))||!Number.isSafeInteger(selection.revision)||!Array.isArray(selection.ids)||selection.ids.length>MEMORY_LIMITS.selected||new Set(selection.ids).size!==selection.ids.length)fail('本次记忆选择无效。');
      if(selection.revision!==value.revision||!value.library.enabled)fail('长期记忆已变化或关闭，请重新预览后重试；本次尚未请求模型。',409);
      const entries=selection.ids.map(id=>value.library.entries.find(e=>e.id===id&&e.enabled));
      if(entries.some(e=>!e))fail('记忆已删除或暂停，请重新预览后重试。',409);
      const text=memoryContext(entries);if(text.length>MEMORY_LIMITS.context)fail('本次记忆超过长度预算。');
      return {text,ids:entries.map(e=>e.id)};
    },
  });
}
