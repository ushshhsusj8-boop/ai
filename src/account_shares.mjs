import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {existsSync,statSync,readFileSync,mkdirSync,openSync,writeFileSync,fsyncSync,closeSync,renameSync,rmSync} from 'node:fs';
import {dirname} from 'node:path';
import {validateShareSnapshot} from '../public/share_tools.js';
const DAY=86400000,MAX_BYTES=8*1024*1024;
const fail=(message,statusCode=400)=>{throw Object.assign(Error(message),{statusCode});};
export function createAccountShares(file,{requireUser,now=Date.now}){
  function read(){
    if(!existsSync(file))return {version:1,revisions:{},shares:[]};
    if(statSync(file).size>MAX_BYTES)throw Error('Share storage exceeds limit');const s=JSON.parse(readFileSync(file,'utf8'));
    if(s?.version!==1||!s.revisions||typeof s.revisions!=='object'||Array.isArray(s.revisions)||Object.values(s.revisions).some(r=>!Number.isSafeInteger(r)||r<0)||!Array.isArray(s.shares)||s.shares.length>1000)throw Error('Invalid share storage');
    const ids=new Set(),digests=new Set();for(const r of s.shares){
      if(!r||typeof r.userId!=='string'||!/^[0-9a-f-]{36}$/.test(r.userId)||typeof r.id!=='string'||!/^[0-9a-f-]{36}$/.test(r.id)||typeof r.requestId!=='string'||!/^[0-9a-f-]{36}$/.test(r.requestId)||typeof r.digest!=='string'||!/^[0-9a-f]{64}$/.test(r.digest)||!Number.isSafeInteger(r.createdAt)||!Number.isSafeInteger(r.expiresAt)||r.expiresAt<=r.createdAt||r.expiresAt>r.createdAt+30*DAY||ids.has(r.id)||digests.has(r.digest))throw Error('Invalid share record');
      r.snapshot=validateShareSnapshot(r.snapshot);ids.add(r.id);digests.add(r.digest);
    }return s;
  }
  const revision=(s,id)=>Object.hasOwn(s.revisions,id)?s.revisions[id]:0;
  const envelope=(s,id)=>({userId:id,revision:revision(s,id),shares:s.shares.filter(r=>r.userId===id).map(r=>({id:r.id,requestId:r.requestId,title:r.snapshot.title,messageCount:r.snapshot.messages.length,createdAt:r.createdAt,expiresAt:r.expiresAt,expired:r.expiresAt<=now()}))});
  function save(s,id,expected){
    if(revision(s,id)!==expected)fail('分享列表已在其他设备变化，请重新读取；当前预览保留。',409);
    if(expected===Number.MAX_SAFE_INTEGER)fail('分享版本已达上限。',413);s.revisions[id]=expected+1;
    const serialized=JSON.stringify(s);if(Buffer.byteLength(serialized)>MAX_BYTES||s.shares.length>1000||Buffer.byteLength(JSON.stringify(s.shares.filter(r=>r.userId===id)))>2*1024*1024)fail('分享存储容量已满，请先撤销旧分享。',413);
    mkdirSync(dirname(file),{recursive:true,mode:0o700});const temp=file+'.'+randomBytes(12).toString('hex')+'.tmp';let handle;
    try{handle=openSync(temp,'wx',0o600);writeFileSync(handle,serialized,'utf8');fsyncSync(handle);closeSync(handle);handle=undefined;renameSync(temp,file);}finally{if(handle!==undefined)closeSync(handle);rmSync(temp,{force:true});}
  }
  const expected=body=>{if(!Number.isSafeInteger(body?.revision)||body.revision<0)fail('分享版本无效。');return body.revision;};
  return Object.freeze({
    list(id){requireUser(id);return envelope(read(),id);},
    create(id,body){
      requireUser(id);const rev=expected(body);if(Object.keys(body).some(k=>!['revision','snapshot','expiresDays','requestId'].includes(k))||typeof body.requestId!=='string'||!/^[0-9a-f-]{36}$/.test(body.requestId)||![1,7,30].includes(body.expiresDays))fail('分享字段或有效期无效。');
      let snapshot;try{snapshot=validateShareSnapshot(body.snapshot);}catch(e){fail(e.message);}
      const s=read();if(s.shares.some(r=>r.userId===id&&r.requestId===body.requestId))fail('此预览已创建过链接，未重复创建。若未收到链接，请读取列表，撤销该次分享后重新预览创建。',409);if(revision(s,id)!==rev)fail('分享列表已在其他设备变化，请重新读取；当前预览保留。',409);
      if(s.shares.filter(r=>r.userId===id).length>=20)fail('每账户最多保留20份分享，请先撤销旧分享。',413);
      const token=randomBytes(32).toString('base64url'),createdAt=now(),record={id:randomUUID(),userId:id,requestId:body.requestId,digest:createHash('sha256').update(token).digest('hex'),createdAt,expiresAt:createdAt+body.expiresDays*DAY,snapshot};
      s.shares.push(record);save(s,id,rev);return {...envelope(s,id),created:{id:record.id,token,expiresAt:record.expiresAt}};
    },
    revoke(id,shareId,body){
      requireUser(id);const rev=expected(body);if(Object.keys(body).some(k=>k!=='revision'))fail('撤销字段无效。');const s=read();if(revision(s,id)!==rev)fail('分享列表已变化，请重新读取后撤销。',409);
      const index=s.shares.findIndex(r=>r.id===shareId&&r.userId===id);if(index<0)fail('分享不存在或已撤销。',404);s.shares.splice(index,1);save(s,id,rev);return envelope(s,id);
    },
    resolve(token){
      if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))fail('分享链接已失效或不可用。',404);
      const digest=createHash('sha256').update(token).digest(),s=read(),r=s.shares.find(r=>timingSafeEqual(Buffer.from(r.digest,'hex'),digest));
      if(!r||r.expiresAt<=now())fail('分享链接已失效或不可用。',404);try{requireUser(r.userId);}catch{fail('分享链接已失效或不可用。',404);}
      return {snapshot:structuredClone(r.snapshot),expiresAt:r.expiresAt,expiresInMs:r.expiresAt-now()};
    },
  });
}
