import {randomBytes} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,statSync,openSync,writeFileSync,fsyncSync,closeSync,renameSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {validatePersonalInstructions,personalInstructionContext} from '../public/personal_instructions.js';
const fail=(message,statusCode=400)=>{throw Object.assign(Error(message),{statusCode});};
export function createAccountInstructions(directory,{requireUser}) {
  function read(userId) {
    requireUser(userId);const file=join(directory,userId+'.json');
    if(!existsSync(file))return {file,value:{version:1,userId,revision:0,instructions:{enabled:true,text:''}}};
    if(statSync(file).size>16384)throw Error('Private instructions storage exceeds limit');
    const value=JSON.parse(readFileSync(file,'utf8'));
    if(value?.version!==1||value.userId!==userId||!Number.isSafeInteger(value.revision)||value.revision<0)throw Error('Invalid private instructions storage');
    value.instructions=validatePersonalInstructions(value.instructions);return {file,value};
  }
  const envelope=value=>({userId:value.userId,revision:value.revision,instructions:structuredClone(value.instructions)});
  return Object.freeze({
    list(userId){return envelope(read(userId).value);},
    put(userId,body={}){
      if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['revision','instructions'].includes(k))||!Number.isSafeInteger(body.revision)||body.revision<0)fail('通用指令版本或字段无效。');
      let instructions;try{instructions=validatePersonalInstructions(body.instructions);}catch(error){fail(error.message);}
      const {file,value}=read(userId);
      if(value.revision!==body.revision)fail('通用指令已在其他设备修改，未覆盖云端内容。编辑草稿保留；请复制草稿后读取云端版本核对。',409);
      if(value.revision===Number.MAX_SAFE_INTEGER)fail('通用指令版本已达上限。',413);
      const next={version:1,userId,revision:value.revision+1,instructions};mkdirSync(directory,{recursive:true,mode:0o700});const temp=file+'.'+randomBytes(12).toString('hex')+'.tmp';let handle;
      try{handle=openSync(temp,'wx',0o600);writeFileSync(handle,JSON.stringify(next),'utf8');fsyncSync(handle);closeSync(handle);handle=undefined;renameSync(temp,file);}finally{if(handle!==undefined)closeSync(handle);rmSync(temp,{force:true});}
      return envelope(next);
    },
    resolve(userId,selection){
      if(!selection||typeof selection!=='object'||Array.isArray(selection)||Object.keys(selection).some(k=>k!=='revision')||!Number.isSafeInteger(selection.revision))fail('通用指令选择无效。');
      const {value}=read(userId);if(value.revision!==selection.revision||!value.instructions.enabled||!value.instructions.text)fail('通用指令已修改或关闭，请重新发送；本次尚未请求模型。',409);
      return personalInstructionContext(value.instructions);
    },
  });
}
