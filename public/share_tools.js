import {getLimits} from './site_limits.js';
export function validateShareSnapshot(value){
  const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
  if(!object(value)||Object.keys(value).some(k=>!['title','messages'].includes(k))||typeof value.title!=='string'||!value.title.trim()||value.title.length>80||!Array.isArray(value.messages)||!value.messages.length||value.messages.length>getLimits().shareMessages)throw Error('请选择1–100条文字消息，分享标题最多80字符。');
  const messages=value.messages.map(m=>{
    if(!object(m)||Object.keys(m).some(k=>!['role','content'].includes(k))||!['user','assistant'].includes(m.role)||typeof m.content!=='string'||!m.content.trim())throw Error('仅可分享用户与助手的非空文字消息。');
    return {role:m.role,content:m.content};
  });
  const result={title:value.title.trim(),messages};if(new TextEncoder().encode(JSON.stringify(result)).length>getLimits().shareSnapshotBytes)throw Error('所选文字超过128 KiB，请减少选择；不会截断内容。');return result;
}
