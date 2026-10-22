import {randomBytes} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,statSync,openSync,writeFileSync,fsyncSync,closeSync,renameSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {validateWritingNote,validateWritingNotes,WRITING_LIMITS} from '../public/writing_store.js';

const MAX_RECORDS=5000,MAX_BYTES=4*1024*1024,ID=/^[A-Za-z0-9_-]{8,128}$/;
const fail=(message,statusCode=400)=>{throw Object.assign(Error(message),{statusCode});};
export function createWritingNotes(directory,{requireUser,now=Date.now}) {
  function read(userId) {
    requireUser(userId);const file=join(directory,userId+'.json');
    if(!existsSync(file))return{file,value:{version:1,userId,records:[]}};
    if(statSync(file).size>MAX_BYTES)throw Error('Writing storage exceeds its limit');
    const value=JSON.parse(readFileSync(file,'utf8')),ids=new Set();
    if(value?.version!==1||value.userId!==userId||!Array.isArray(value.records)||value.records.length>MAX_RECORDS)throw Error('Invalid private writing storage');
    for(const record of value.records){if(!record||!ID.test(record.id)||ids.has(record.id)||!Number.isSafeInteger(record.revision)||record.revision<1||!Number.isSafeInteger(record.updatedAt)||record.updatedAt<0)throw Error('Invalid private writing record');ids.add(record.id);if(record.deleted!==true)validateWritingNote(record);}
    validateWritingNotes(value.records.filter(r=>!r.deleted));return{file,value};
  }
  function write(file,value) {
    const serialized=JSON.stringify(value);if(Buffer.byteLength(serialized)>MAX_BYTES)fail('文稿版本记录已满，请联系管理员备份清理。',413);
    mkdirSync(directory,{recursive:true,mode:0o700});const temporary=file+'.'+randomBytes(12).toString('hex')+'.tmp';let handle;
    try{handle=openSync(temporary,'wx',0o600);writeFileSync(handle,serialized,'utf8');fsyncSync(handle);closeSync(handle);handle=undefined;renameSync(temporary,file);}finally{if(handle!==undefined)closeSync(handle);rmSync(temporary,{force:true});}
  }
  function revision(value){if(!Number.isSafeInteger(value)||value<0)fail('文稿版本无效。');}
  return Object.freeze({
    list(userId){const {value}=read(userId);return{userId,notes:structuredClone(value.records.filter(r=>!r.deleted)),deleted:value.records.filter(r=>r.deleted).map(({id,revision,updatedAt})=>({id,revision,updatedAt})),limits:WRITING_LIMITS};},
    put(userId,id,body={}){
      revision(body.revision);if(!ID.test(id)||body.note?.id!==id)fail('文稿编号无效或不一致。');
      let note;try{note=validateWritingNote({...body.note,revision:1,updatedAt:now()});}catch(error){fail(error.message);}
      const {file,value}=read(userId),index=value.records.findIndex(n=>n.id===id),previous=value.records[index];
      if(previous?previous.deleted||previous.revision!==body.revision:body.revision!==0)fail('文稿已在其他设备修改或删除，未覆盖云端版本。',409);
      if(index<0&&value.records.length>=MAX_RECORDS)fail('文稿历史编号已达上限。',413);
      note.revision=(previous?.revision||0)+1;if(index<0)value.records.push(note);else value.records[index]=note;
      try{validateWritingNotes(value.records.filter(n=>!n.deleted));}catch(error){fail(error.message,413);}
      write(file,value);return{userId,note};
    },remove(userId,id,expectedRevision){
      revision(expectedRevision);const {file,value}=read(userId),index=value.records.findIndex(n=>n.id===id),previous=value.records[index];
      if(!previous||previous.deleted)fail('文稿已不存在。',404);if(previous.revision!==expectedRevision)fail('文稿已在其他设备修改，未删除新版。',409);
      value.records[index]={id,revision:previous.revision+1,updatedAt:now(),deleted:true};write(file,value);return{userId,...value.records[index]};
    },
  });
}
