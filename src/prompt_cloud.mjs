import {getLimits,withStoredLimits} from '../public/site_limits.js';
import {randomBytes} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,statSync,openSync,writeFileSync,fsyncSync,closeSync,renameSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {validatePromptLibrary,validatePromptChange} from '../public/prompt_library.js';

const fail=(message,statusCode=400)=>{throw Object.assign(Error(message),{statusCode});};
export function createPromptCloud(directory,{requireUser,now=Date.now}) {
  function read(...args){return withStoredLimits(()=>readStored(...args));}
  function readStored(userId){
    requireUser(userId);const file=join(directory,userId+'.json');
    if(!existsSync(file))return{file,value:{version:1,userId,revision:0,prompts:[],updatedAt:0}};
    if(statSync(file).size>getLimits().promptLibraryBytes)throw Error('Private prompt storage exceeds limit');
    const value=JSON.parse(readFileSync(file,'utf8'));
    if(value.version!==1||value.userId!==userId||!Number.isSafeInteger(value.revision)||value.revision<0)throw Error('Invalid private prompt storage');
    value.prompts=validatePromptLibrary(value.prompts);return{file,value};
  }
  function list(userId){const {value}=read(userId);return{userId,revision:value.revision,prompts:value.prompts};}
  function put(userId,body={}){
    if(Object.keys(body).some(k=>!['revision','prompts'].includes(k))||!Number.isSafeInteger(body.revision)||body.revision<0)fail('提示词库版本或字段无效。');
    const {file,value}=read(userId);
    if(body.revision!==value.revision)fail('提示词库已在其他设备修改或删除，未覆盖云端内容。',409);
    let prompts,removalOnly;try{({prompts,removalOnly}=validatePromptChange(body.prompts,value.prompts));}catch(error){fail(error.message);}
    if(value.revision===Number.MAX_SAFE_INTEGER)fail('提示词版本已达上限。',413);
    const next={version:1,userId,revision:value.revision+1,prompts,updatedAt:now()},serialized=JSON.stringify(next);
    const byteLimit=removalOnly?withStoredLimits(()=>getLimits().promptLibraryBytes):getLimits().promptLibraryBytes;
    if(Buffer.byteLength(serialized)>byteLimit)fail('提示词库超过容量限制。',413);
    mkdirSync(directory,{recursive:true,mode:0o700});const temporary=file+'.'+randomBytes(12).toString('hex')+'.tmp';let handle;
    try{handle=openSync(temporary,'wx',0o600);writeFileSync(handle,serialized,'utf8');fsyncSync(handle);closeSync(handle);handle=undefined;renameSync(temporary,file);}finally{if(handle!==undefined)closeSync(handle);rmSync(temporary,{force:true});}
    return{userId,revision:next.revision,prompts};
  }
  return Object.freeze({list,put});
}
