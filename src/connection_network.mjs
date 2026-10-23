import {lookup} from 'node:dns/promises';
import {isIP,BlockList} from 'node:net';
import {networkInterfaces} from 'node:os';
import {Agent,fetch as networkFetch} from 'undici';
import {connectionEndpoint} from '../public/connection_tools.js';

const reserved=new BlockList();
for(const [address,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]])reserved.addSubnet(address,prefix,'ipv4');
for(const [address,prefix] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]])reserved.addSubnet(address,prefix,'ipv6');
const global6=new BlockList();global6.addSubnet('2000::',3,'ipv6');
const fail=()=>Object.assign(Error('自定义连接仅支持公网 HTTPS 模型服务；请检查地址和 DNS。'),{statusCode:400});
export function publicAddress(address,blocked=[]) {
  const family=isIP(address);
  if(!family||blocked.some(b=>{const list=new BlockList();if(isIP(b))list.addAddress(b,isIP(b)===6?'ipv6':'ipv4');return list.check(address,family===6?'ipv6':'ipv4');}))return false;
  return family===4?!reserved.check(address,'ipv4'):global6.check(address,'ipv6')&&!reserved.check(address,'ipv6');
}
export function createConnectionNetwork({lookupImpl=lookup,fetchImpl=networkFetch,agentFactory=options=>new Agent(options)}={}) {
  return async function prepare(provider,{blockedHosts=[],blockedAddresses=[],signal}={}) {
    const url=new URL(connectionEndpoint(provider.apiUrl,provider.protocol)),host=url.hostname.replace(/^\[|\]$/g,'').toLowerCase();
    const local=Object.values(networkInterfaces()).flat().filter(Boolean).map(i=>i.address);
    const blocked=[...local,...blockedAddresses,...blockedHosts.map(h=>h.replace(/^\[|\]$/g,'')).filter(h=>isIP(h))];
    if(blockedHosts.map(h=>h.toLowerCase().replace(/^\[|\]$/g,'').replace(/\.$/,'')).includes(host.replace(/\.$/,'')))throw fail();
    const time=AbortSignal.timeout(10000),guard=signal?AbortSignal.any([signal,time]):time;
    let records;
    try{
      records=isIP(host)?[{address:host,family:isIP(host)}]:await Promise.race([lookupImpl(host,{all:true,verbatim:true}),new Promise((_,reject)=>{if(guard.aborted)reject(fail());else guard.addEventListener('abort',()=>reject(fail()),{once:true});})]);
    }catch{throw fail();}
    if(!records.length||records.length>32||records.some(r=>!publicAddress(r.address,blocked)))throw fail();
    const pinned=records[0];
    const dispatcher=agentFactory({connect:{timeout:10000,lookup:(hostname,options,callback)=>{
      if(hostname.toLowerCase()!==host)return callback(fail());
      if(options?.all)callback(null,[pinned]);else callback(null,pinned.address,pinned.family);
    }}});
    return {fetch:async(target,options={})=>{
      if(new URL(target).toString()!==url.toString())throw fail();
      try{return await fetchImpl(url,{...options,redirect:'error',dispatcher});}catch(error){if(options.signal?.aborted)throw error;throw Object.assign(Error('自定义模型连接失败，请检查地址、证书和服务状态。'),{statusCode:502});}
    },close:()=>dispatcher.close().catch(()=>{})};
  };
}
