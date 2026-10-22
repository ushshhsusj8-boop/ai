const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/;
export const BRANCH_LABELS=Object.freeze({edit:'修改问题',continue:'从回复继续',regenerate:'重新生成',copy:'冲突副本'});
export function validateBranch(value,selfId) {
  if(value===undefined)return undefined;
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['parentId','rootId','messageIndex','kind','createdAt'].includes(k))
    ||typeof value.parentId!=='string'||typeof value.rootId!=='string'||!ID.test(value.parentId)||!ID.test(value.rootId)||value.parentId===selfId||value.rootId===selfId
    ||!Number.isInteger(value.messageIndex)||value.messageIndex<0||value.messageIndex>=10000
    ||!Object.hasOwn(BRANCH_LABELS,value.kind)||!Number.isSafeInteger(value.createdAt)||value.createdAt<0||value.createdAt>Date.now()+300000)throw Error('对话分支来源格式无效。');
  return {parentId:value.parentId,rootId:value.rootId,messageIndex:value.messageIndex,kind:value.kind,createdAt:value.createdAt};
}
export function branchOrigin(source,messageIndex,kind,now=Date.now()) {
  return validateBranch({parentId:source.id,rootId:source.branch?.rootId||source.id,messageIndex,kind,createdAt:now});
}
export function branchFamily(conversations,active) {
  if(!active)return [];
  const root=active.branch?.rootId||active.id;
  return conversations.filter(c=>c.id===root||c.branch?.rootId===root).sort((a,b)=>Number(b.id===root)-Number(a.id===root)||(a.branch?.createdAt||a.updatedAt)-(b.branch?.createdAt||b.updatedAt));
}
export function sharedMessagePrefix(a,b) {
  let index=0;while(index<Math.min(a.messages.length,b.messages.length)) {const left=a.messages[index],right=b.messages[index];if(left.role!==right.role||left.content!==right.content||JSON.stringify(left.images||[])!==JSON.stringify(right.images||[]))break;index++;}return index;
}
