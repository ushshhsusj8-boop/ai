// One schema for the website, its private stores and the administrator panel.
const MiB=1024*1024;
// name: [legacy value, developer value, minimum, maximum, group, label, unit]
export const LIMIT_FIELDS=Object.freeze({
 dailyRequestLimit:[100,0,0,10000000,'requests','每日请求软额度（0不另限）','次'],
 dailyTokenLimit:[200000,0,0,1000000000000,'requests','每日Token软额度（0不另限）','Token'],
 dailyCodeRuns:[200,0,0,10000000,'requests','每日代码运行次数（0不另限）','次'],
 rateLimitPerMinute:[10,0,0,6000,'requests','每IP每分钟请求（0不另限）','次'],
 maxConcurrentRequests:[2,4,1,8,'requests','全站并发模型请求','个'],
 requestTimeoutMs:[90000,600000,1000,600000,'requests','单次生成最长等待','毫秒'],
 maxInputChars:[24000,1000000,1000,2000000,'chat','消息及指令输入预算','字符'],
 maxBodyBytes:[65536,32*MiB,1024,64*MiB,'chat','聊天请求体预算','字节'],
 promptChars:[12000,262144,1000,1000000,'chat','单次输入框与文字草稿','字符'],
 historyChars:[22000,1000000,1000,2000000,'chat','消息历史预算','字符'],
 maxMessages:[24,256,2,512,'chat','每次携带消息数','条'],
 parallelTasks:[6,24,6,100,'chat','每批并行任务（超出并发的排队）','条'],
 historyTurns:[10,100,1,255,'chat','可手动设定历史轮数','轮'],
 replyChars:[240000,2000000,240000,4000000,'chat','单条回复文字预算','字符'],
 streamBytes:[8*MiB,64*MiB,8*MiB,128*MiB,'chat','流式响应总预算','字节'],
 eventBytes:[MiB,8*MiB,MiB,16*MiB,'chat','单个流式事件预算','字节'],
 searchUses:[2,0,0,100,'search','每回答搜索次数（0交服务商）','次'],
 toolCalls:[3,0,0,30,'search','工具调用总次数（0交服务商，OpenRouter最高30）','次'],
 searchResults:[5,25,0,25,'search','每次搜索结果（0交服务商，OpenRouter最高25）','条'],
 searchTotalResults:[10,0,0,1000,'search','累计搜索结果（0交服务商）','条'],
 searchSources:[12,100,12,1000,'search','保存与显示的搜索来源','条'],
 searchQueries:[8,100,8,200,'search','保存与显示的搜索词','条'],
 textAttachmentBytes:[65536,20*MiB,65536,32*MiB,'documents','快速文本导入文件','字节'],
 textAttachmentChars:[6000,262144,6000,1000000,'documents','快速文本导入文字','字符'],
 documentBytes:[5*MiB,20*MiB,MiB,32*MiB,'documents','单个解析文件','字节'],
 documentChars:[120000,1000000,120000,2000000,'documents','单份解析文字','字符'],
 documentCount:[3,10,3,20,'documents','对话与项目同时启用资料','份'],
 pdfPages:[200,1000,200,2000,'documents','PDF解析页数','页'],
 ocrPages:[20,100,20,200,'documents','每次手动OCR','页'],
 documentFragments:[6,32,6,128,'documents','资料检索片段','个'],
 documentFragmentChars:[1200,4000,1200,16000,'documents','单个资料片段','字符'],
 documentContextChars:[8000,128000,8000,512000,'documents','资料上下文预算','字符'],
 imagesPerMessage:[3,10,3,20,'images','每条消息图片','张'],
 contextImages:[8,32,8,64,'images','每次上下文图片','张'],
 imageBytes:[192*1024,MiB,192*1024,2*MiB,'images','每张发送图片','字节'],
 imageEdge:[1600,4096,1600,4096,'images','发送图片最长边','像素'],
 imagePixels:[12000000,32000000,12000000,32000000,'images','原图像素预算','像素'],
 instructionChars:[2000,16000,2000,64000,'memory','项目与对话指令合计','字符'],
 personalInstructionChars:[2000,16000,2000,64000,'memory','账户通用指令','字符'],
 memoryCount:[40,500,40,2000,'memory','长期记忆条数','条'],
 memoryText:[500,4000,500,16000,'memory','单条记忆','字符'],
 memoryTotal:[12000,1000000,12000,4000000,'memory','记忆总文字','字符'],
 memoryContext:[4000,32000,4000,128000,'memory','每次记忆上下文','字符'],
 memorySelected:[8,32,8,128,'memory','每次选入记忆','条'],
 cloudConversations:[1000,10000,1000,20000,'storage','账户云聊天','段'],
 cloudWorkspaceBytes:[64*MiB,128*MiB,64*MiB,128*MiB,'storage','账户聊天与项目JSON','字节'],
 conversationMessages:[10000,50000,10000,100000,'storage','单段保存消息数','条'],
 conversationChars:[4*MiB,16*MiB,4*MiB,32*MiB,'storage','单段保存内容预算','字符'],
 projects:[20,200,20,500,'storage','项目数量','个'],
 projectBytes:[16*MiB,64*MiB,16*MiB,64*MiB,'storage','项目JSON备份','字节'],
 originalFiles:[60,500,60,1000,'storage','原文件保管数量','个'],
 originalFileBytes:[5*MiB,20*MiB,5*MiB,32*MiB,'storage','单个保管原文件','字节'],
 originalTotalBytes:[64*MiB,128*MiB,64*MiB,128*MiB,'storage','原文件账户总量','字节'],
 originalZipBytes:[65*MiB,129*MiB,65*MiB,129*MiB,'storage','原文件ZIP','字节'],
 prompts:[30,1000,30,5000,'storage','提示词条数','条'],
 promptText:[6000,32000,6000,64000,'storage','单条提示词','字符'],
 promptLibraryBytes:[MiB,16*MiB,MiB,32*MiB,'storage','提示词库存储','字节'],
 writingCount:[50,500,50,2000,'storage','文稿数量','份'],
 writingText:[256000,1000000,256000,4000000,'storage','单份文稿','字符'],
 writingBytes:[2*MiB,32*MiB,2*MiB,64*MiB,'storage','文稿总量','字节'],
 historyCount:[100,1000,100,5000,'storage','代码运行历史','条'],
 historyBytes:[8*MiB,32*MiB,8*MiB,64*MiB,'storage','代码历史存储','字节'],
 connections:[12,100,12,256,'storage','个人模型连接','个'],
 connectionModels:[24,128,24,256,'storage','每连接模型','个'],
 draftCount:[31,100,31,500,'storage','本机文字草稿','份'],
 customPresets:[20,200,20,1000,'storage','自建回答预设','个'],
 searchDisplay:[60,200,60,1000,'storage','工作区搜索结果','项'],
 shareCount:[20,100,20,500,'sharing','账户只读分享','份'],
 shareMessages:[100,1000,100,5000,'sharing','单份分享消息','条'],
 shareSnapshotBytes:[128*1024,MiB,128*1024,2*MiB,'sharing','单份分享文字','字节'],
 shareAccountBytes:[2*MiB,32*MiB,2*MiB,64*MiB,'sharing','账户分享总量','字节'],
});
export const LEGACY_LIMITS=Object.freeze({...Object.fromEntries(Object.entries(LIMIT_FIELDS).map(([k,v])=>[k,v[0]])),searchContext:'low'});
export const DEVELOPER_LIMITS=Object.freeze({...Object.fromEntries(Object.entries(LIMIT_FIELDS).map(([k,v])=>[k,v[1]])),searchContext:'high'});
export const MAXIMUM_LIMITS=Object.freeze({...Object.fromEntries(Object.entries(LIMIT_FIELDS).map(([k,v])=>[k,v[3]])),searchContext:'high'});
const zeroFields=['dailyRequestLimit','dailyTokenLimit','dailyCodeRuns','rateLimitPerMinute','searchUses','toolCalls','searchTotalResults'];
export const OPEN_LIMITS=Object.freeze({...MAXIMUM_LIMITS,...Object.fromEntries(zeroFields.map(k=>[k,0]))});
export function validateSiteLimits(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!Object.hasOwn(LIMIT_FIELDS,k)&&k!=='searchContext'))throw Error('限额包含未知或无效字段。');
 const result={};for(const[k,v]of Object.entries(LIMIT_FIELDS)){const n=value[k];if(!Number.isSafeInteger(n)||n<v[2]||n>v[3])throw Error(v[5]+'超出允许范围。');result[k]=n;}
 if(!['low','medium','high'].includes(value.searchContext))throw Error('搜索上下文档位无效。');result.searchContext=value.searchContext;
 if(result.historyChars>result.maxInputChars||result.promptChars>result.maxInputChars)throw Error('历史和输入框预算不能超过总输入预算。');
 if(result.memorySelected>result.memoryCount||result.imagesPerMessage>result.contextImages)throw Error('条数设置超过对应总量。');
 if(result.originalFileBytes>result.originalTotalBytes||result.originalZipBytes<result.originalTotalBytes+1024*1024)throw Error('原文件与ZIP容量设置不一致。');
 return Object.freeze(result);
}
let provider=()=>LEGACY_LIMITS,client=LEGACY_LIMITS,storedDepth=0;
export function configureLimitProvider(fn){provider=fn;}
export function getLimits(){return storedDepth?MAXIMUM_LIMITS:provider();}
export function withStoredLimits(fn){storedDepth++;try{const result=fn();if(result&&typeof result.then==='function')throw Error('Stored validation must be synchronous');return result;}finally{storedDepth--;}}
export function applyClientLimits(value){client=validateSiteLimits(value);provider=()=>client;}
export function limitObject(mapping){return Object.freeze(Object.defineProperties({},Object.fromEntries(Object.entries(mapping).map(([k,name])=>[k,{enumerable:true,get:()=>getLimits()[name]}]))));}
if(typeof document!=='undefined'&&typeof window!=='undefined'){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
 try{const response=await fetch('/api/site-policy',{cache:'no-store',credentials:'same-origin',signal:controller.signal});if(response.ok){const data=await response.json();applyClientLimits(data.limits);}}
 catch{}finally{clearTimeout(timer);}
}
