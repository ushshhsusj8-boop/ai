import {getLimits} from './site_limits.js';
// A legacy 2048-character URL can expand ninefold when its path is encoded.
// Apply one bound to the canonical endpoint, including the protocol suffix.
export const CONNECTION_URL_MAX_LENGTH=2048*9+32;
export function connectionEndpoint(value, protocol = 'chat-completions') {
  if (!['chat-completions','responses'].includes(protocol)) throw Error('请选择 Chat Completions 或 Responses。');
  if (typeof value !== 'string' || value.length > CONNECTION_URL_MAX_LENGTH || /[\x00-\x20\x7f]/.test(value.trim())) throw Error('请输入完整的 HTTPS API 地址。');
  let url; try { url = new URL(value.trim()); } catch { throw Error('请输入完整的 HTTPS API 地址。'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw Error('API 地址须使用 HTTPS，不能包含密码、查询参数或片段。');
  const host=url.hostname.replace(/^\[|\]$/g,'').toLowerCase();
  if (!host.includes('.') && !host.includes(':') || /(?:^|\.)(?:localhost|local|internal|home|lan|test|invalid)$/.test(host)) throw Error('请使用公网模型服务地址。');
  let path=url.pathname.replace(/\/+$/,'');
  const suffix=protocol==='responses'?'/responses':'/chat/completions';
  if (/\/(?:responses|chat\/completions)$/.test(path)) {
    if(!path.endsWith(suffix)) throw Error('请求地址与所选 API 协议不一致。');
  } else path += suffix;
  url.pathname=path;
  const endpoint=url.toString();
  if(endpoint.length>CONNECTION_URL_MAX_LENGTH)throw Error('API 地址编码后过长，请缩短路径。');
  return endpoint;
}

export function validateConnection(input) {
  if (!input || typeof input!=='object' || Array.isArray(input)) throw Error('连接内容无效。');
  const allowed=['id','label','apiUrl','protocol','model','models','apiKey','vision'];
  if(Object.keys(input).some(k=>!allowed.includes(k))) throw Error('连接包含不支持的设置。');
  if(typeof input.id!=='string'||!/^mine-[a-f0-9]{24}$/.test(input.id))throw Error('连接编号无效。');
  if(typeof input.label!=='string'||!input.label.trim()||input.label.length>80||/[\x00-\x1f\x7f]/.test(input.label))throw Error('请填写最多80字符的连接名称。');
  const models=Array.isArray(input.models)?[...new Set(input.models)]:[];
  if(!models.length||models.length>getLimits().connectionModels||models.some(m=>typeof m!=='string'||!/^[~A-Za-z0-9][A-Za-z0-9._~:/+-]{0,191}$/.test(m)||m.includes('://')))throw Error('请填写1—24个有效模型 ID，每行一个。');
  if(!models.includes(input.model))throw Error('默认模型必须包含在模型列表中。');
  if(typeof input.vision!=='boolean')throw Error('图片支持开关无效。');
  if(typeof input.apiKey!=='string'||input.apiKey.length>4096||/[\x00-\x20\x7f-\uffff]/.test(input.apiKey))throw Error('API Key 须为不含空白的英文字符，最多4096字符。');
  return {id:input.id,label:input.label.trim(),protocol:input.protocol,apiUrl:connectionEndpoint(input.apiUrl,input.protocol),model:input.model,models,vision:input.vision,apiKey:input.apiKey};
}

// Validate the selected destination before clearing a draft or appending a turn.
export function chatSelectionProblem(conversation, provider, modelId) {
  if (!provider?.id) return '当前服务商连接已不可用，请明确选择其他服务商后再发送。';
  if (conversation?.provider?.startsWith('mine-') && conversation.provider !== provider.id)
    return '此对话原来的个人连接已不可用，请明确选择其他服务商；草稿已保留。';
  const models=Array.isArray(provider.models)&&provider.models.length?provider.models:[{id:provider.model}];
  if (!modelId || !models.some(model=>model?.id===modelId))
    return '原型号已不可用，请明确选择一个可用型号；草稿已保留。';
  if (conversation?.provider===provider.id && conversation.model && conversation.model!==modelId)
    return '当前对话的原型号与选择不一致，请重新选择型号；草稿已保留。';
  return '';
}
