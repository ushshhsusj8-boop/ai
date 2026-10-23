import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {existsSync,readFileSync,mkdirSync,writeFileSync,openSync,fsyncSync,closeSync,renameSync,rmSync,statSync,readdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {validateConnection} from '../public/connection_tools.js';
const fail=(message,statusCode=400)=>{throw Object.assign(Error(message),{statusCode});};
export function createAccountConnections({file,userFor}) {
  const directory=file+'.connections',keyFile=file+'.connections.key';
  function key(){
    if(!existsSync(keyFile)){
      if(existsSync(directory)&&readdirSync(directory).some(name=>name.endsWith('.json')))fail('个人连接加密密钥缺失，已停止保存并保留原资料。',500);
      mkdirSync(dirname(file),{recursive:true,mode:0o700});let fd;
      try{fd=openSync(keyFile,'wx',0o600);writeFileSync(fd,randomBytes(32));fsyncSync(fd);}finally{if(fd!==undefined)closeSync(fd);}
    }
    const data=readFileSync(keyFile);if(data.length!==32)fail('连接加密密钥无效，已保留原资料。',500);return data;
  }
  function path(id){userFor(id);return join(directory,id+'.json');}
  function read(id){
    const target=path(id);if(!existsSync(target))return {revision:0,connections:[]};
    try{
      if(!existsSync(keyFile)||statSync(target).size>256*1024)throw Error();
      const env=JSON.parse(readFileSync(target,'utf8'));if(env.version!==1)throw Error();
      const decipher=createDecipheriv('aes-256-gcm',key(),Buffer.from(env.iv,'base64'));decipher.setAAD(Buffer.from('plaude-connections-v1:'+id));decipher.setAuthTag(Buffer.from(env.tag,'base64'));
      const value=JSON.parse(Buffer.concat([decipher.update(Buffer.from(env.data,'base64')),decipher.final()]));
      if(!Number.isSafeInteger(value.revision)||value.revision<1||!Array.isArray(value.connections)||value.connections.length>12)throw Error();
      const ids=new Set();for(const c of value.connections){validateConnection(c);if(ids.has(c.id)||!c.apiKey)throw Error();ids.add(c.id);}return value;
    }catch{fail('无法读取个人连接，已保留原资料；请联系站点维护者。',500);}
  }
  function view(id,value=read(id)){return {userId:id,revision:value.revision,connections:value.connections.map(({apiKey,...c})=>({...c,keyConfigured:!!apiKey})),encrypted:true};}
  function save(id,input){
    const previous=read(id);
    if(!input||Object.keys(input).some(k=>!['revision','connections'].includes(k))||!Array.isArray(input.connections)||input.connections.length>12)fail('每个账户最多12个个人连接。');
    if(input.revision!==previous.revision)fail('连接已在其他设备修改，请先读取云端版本。',409);
    const ids=new Set(),connections=input.connections.map(raw=>{
      const c=validateConnection(raw);if(ids.has(c.id))fail('连接编号重复。');ids.add(c.id);
      const old=previous.connections.find(p=>p.id===c.id);
      if(!c.apiKey){if(!old||old.apiUrl!==c.apiUrl||old.protocol!==c.protocol)fail('新增或修改 API 地址/协议时，请重新填写自己的 API Key。');c.apiKey=old.apiKey;}
      return c;
    });
    const value={revision:previous.revision+1,connections};
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);cipher.setAAD(Buffer.from('plaude-connections-v1:'+id));
    const data=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);
    mkdirSync(directory,{recursive:true,mode:0o700});const target=path(id),temp=target+'.'+randomBytes(12).toString('hex')+'.tmp';let fd;
    try{fd=openSync(temp,'wx',0o600);writeFileSync(fd,JSON.stringify({version:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')}));fsyncSync(fd);closeSync(fd);fd=undefined;renameSync(temp,target);}finally{if(fd!==undefined)closeSync(fd);rmSync(temp,{force:true});}
    return view(id,value);
  }
  function providers(id){const value=read(id);return value.connections.map(c=>({...c,label:'我的 · '+c.label,privateConnection:true,connectionRevision:value.revision,modelOptions:c.models.map(id=>({id,label:id,inputModalities:c.vision?['text','image']:['text']}))}));}
  return {get:view,save,providers,resolve(id,providerId,revision){const found=providers(id).find(p=>p.id===providerId);if(!found)fail('个人连接已删除或不属于此账户，请重新选择模型。',409);if(revision!==found.connectionRevision)fail('个人连接已更新，请刷新模型列表后再发送。',409);return found;}};
}
