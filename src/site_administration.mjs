import {existsSync,readFileSync,statSync,mkdirSync,openSync,writeFileSync,fsyncSync,closeSync,renameSync,rmSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {DEVELOPER_LIMITS,validateSiteLimits} from '../public/site_limits.js';
const fail=(message,statusCode=400)=>{throw Object.assign(Error(message),{statusCode});};
export function createSiteAdministration({file,findUser,requireUser,write=atomic,now=Date.now}){
 function read(){
  if(!existsSync(file))return{version:1,revision:0,ownerId:null,administrators:[],limits:{...DEVELOPER_LIMITS}};
  try{if(statSync(file).size>256*1024)throw Error();const value=JSON.parse(readFileSync(file,'utf8'));if(value.version!==1||!Number.isSafeInteger(value.revision)||value.revision<1||!Array.isArray(value.administrators)||value.administrators.some(id=>typeof id!=='string')||new Set(value.administrators).size!==value.administrators.length)throw Error();if(value.ownerId===null){if(value.administrators.length||!value.setup||!/^[a-f0-9]{64}$/.test(value.setup.digest)||!Number.isSafeInteger(value.setup.expiresAt))throw Error();}else{if(typeof value.ownerId!=='string'||!value.administrators.includes(value.ownerId)||value.setup!==undefined)throw Error();requireUser(value.ownerId);}for(const id of value.administrators)requireUser(id);value.limits=validateSiteLimits(value.limits);return value;}catch{fail('站点权限或额度配置无法读取，已保留原文件，请联系站点所有者。',503);}
 }
 function role(id,value=read()){return id&&value.ownerId===id?'owner':id&&value.administrators.includes(id)?'admin':'user';}
 function authorized(id,value,owner=false){requireUser(id);if(owner?role(id,value)!=='owner':!['owner','admin'].includes(role(id,value)))fail(owner?'仅站点所有者可以指定或撤销管理员。':'此操作需要站点管理员权限。',403);}
 function save(value){if(value.revision===Number.MAX_SAFE_INTEGER)fail('管理员设置版本已达上限。',413);const next={...value,revision:value.revision+1};write(file,next);return next;}
 function view(id,value=read()){authorized(id,value);return{revision:value.revision,role:role(id,value),canManageAdministrators:role(id,value)==='owner',limits:{...value.limits},...(role(id,value)==='owner'?{administrators:value.administrators.map(userId=>{const user=requireUser(userId);return{id:user.id,username:user.username,displayName:user.displayName,role:role(user.id,value)};})}:{})};}
 return Object.freeze({
  limits:()=>read().limits,
  access(id){const value=read(),r=role(id,value);return{role:r,canAdminister:r==='owner'||r==='admin',canManageAdministrators:r==='owner',ownerConfigured:!!value.ownerId};},
  view,
  bootstrapOwner(username){const value=read(),user=findUser(username);if(!user)fail('首位站点所有者必须是已经存在的本站用户名。',404);if(value.ownerId){if(value.ownerId!==user.id)fail('站点所有者已绑定，不能通过重复初始化改为其他账户。',409);return view(user.id,value);}const {setup:_used,...rest}=value;const next=save({...rest,ownerId:user.id,administrators:[user.id]});return view(user.id,next);},
  issueSetupCode(){const value=read();if(value.ownerId)fail('站点所有者已经绑定，不能再次生成首次绑定码。',409);const code=randomBytes(32).toString('base64url');save({...value,setup:{digest:createHash('sha256').update(code).digest('hex'),expiresAt:now()+30*60*1000}});return code;},
  claimOwner(id,input){requireUser(id);const value=read();if(value.ownerId)fail('站点所有者已绑定，不能重复绑定。',409);if(!input||Object.keys(input).some(k=>k!=='code')||typeof input.code!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(input.code))fail('一次性绑定码无效或已过期。',403);const digest=createHash('sha256').update(input.code).digest();if(!value.setup||value.setup.expiresAt<=now()||!timingSafeEqual(digest,Buffer.from(value.setup.digest,'hex')))fail('一次性绑定码无效或已过期。',403);const {setup:_used,...rest}=value;return view(id,save({...rest,ownerId:id,administrators:[id]}));},
  putLimits(id,input){const value=read();authorized(id,value);if(!input||Object.keys(input).some(k=>!['revision','limits'].includes(k)))fail('额度设置包含未知字段。');if(input.revision!==value.revision)fail('管理员设置已在其他页面修改，请重新读取；草稿保留。',409);let limits;try{limits=validateSiteLimits(input.limits);}catch(error){fail(error.message);}return view(id,save({...value,limits}));},
  setAdministrator(id,input){const value=read();authorized(id,value,true);if(!input||Object.keys(input).some(k=>!['revision','username','administrator'].includes(k))||typeof input.username!=='string'||typeof input.administrator!=='boolean')fail('管理员设置无效。');if(input.revision!==value.revision)fail('管理员列表已改变，请重新读取后再试。',409);const user=findUser(input.username);if(!user)fail('没有找到该本站用户名。',404);if(user.id===value.ownerId&&!input.administrator)fail('不能撤销站点所有者的管理权限。');const ids=new Set(value.administrators);if(input.administrator)ids.add(user.id);else ids.delete(user.id);return view(id,save({...value,administrators:[...ids]}));},
 });
}
function atomic(file,value){mkdirSync(dirname(file),{recursive:true,mode:0o700});const temp=file+'.'+randomBytes(12).toString('hex')+'.tmp';let fd;try{fd=openSync(temp,'wx',0o600);writeFileSync(fd,JSON.stringify(value));fsyncSync(fd);closeSync(fd);fd=undefined;renameSync(temp,file);}finally{if(fd!==undefined)closeSync(fd);rmSync(temp,{force:true});}}
