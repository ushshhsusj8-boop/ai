import {getLimits} from './site_limits.js';
import {documentMatches} from './document_search.js';
export const UI_DEFAULTS = Object.freeze({theme:'system', density:'comfortable', textSize:16, readingWidth:'standard'});
export function uiPreferences(value) {
  return {theme:['system','light','dark'].includes(value?.theme) ? value.theme : 'system',
    density:['comfortable','compact'].includes(value?.density) ? value.density : 'comfortable',
    textSize:[14,16,18].includes(value?.textSize) ? value.textSize : 16,
    readingWidth:value?.readingWidth==='wide'?'wide':'standard'};
}
export function historyBucket(conversation, now = Date.now()) {
  if (conversation.pinned) return '置顶';
  const today = new Date(now); today.setHours(0,0,0,0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate()-1);
  const week = new Date(today); week.setDate(week.getDate()-7);
  const time = Number(conversation.updatedAt) || 0;
  return time >= +today ? '今天' : time >= +yesterday ? '昨天' : time >= +week ? '最近 7 天' : '更早';
}
export function historyPage(items,limit=100,activeId='') {
  const page=items.slice(0,Math.max(1,limit)),active=items.find(c=>c.id===activeId);
  if(active&&!page.some(c=>c.id===activeId)){page.pop();page.unshift(active);}return page;
}
function excerpt(text, terms) {
  text = String(text || ''); const lower = text.toLocaleLowerCase();
  const at = Math.max(0, ...terms.map(t=>lower.indexOf(t)).filter(n=>n>=0));
  const start = Math.max(0, at-30); return (start ? '…' : '') + text.slice(start,start+150).replace(/\s+/g,' ') + (text.length>start+150?'…':'');
}
/** Search the current account's supplied data only. No remote/public search or model request. */
export function searchWorkspace({conversations=[], projects=[], notes=[], query='', kind='all', limit=getLimits().searchDisplay}) {
  const terms = String(query).trim().toLocaleLowerCase().slice(0,200).split(/\s+/).filter(Boolean);
  const matches = text => terms.every(t=>String(text || '').toLocaleLowerCase().includes(t));
  const result = [], add = item => {if(result.length<limit)result.push(item);};
  if (kind==='all'||kind==='chat') for(const c of [...conversations].sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.updatedAt-a.updatedAt)) {
    const index = terms.length ? c.messages?.findIndex(m=>matches(m.content)) ?? -1 : -1;
    if(matches(c.title)||terms.length&&index>=0) add({kind:'chat',id:c.id,title:c.title||'新对话',subtitle:(c.archived?'已归档 · ':'')+excerpt(index>=0?c.messages[index].content:c.messages?.at(-1)?.content,terms),messageIndex:index});
    if(result.length>=limit)return result;
  }
  if (kind==='all'||kind==='project') for(const p of projects) {if(matches(p.name+' '+p.instructions)) add({kind:'project',id:p.id,title:p.name,subtitle:`${p.documents?.length||0} 份资料 · `+excerpt(p.instructions,terms)});if(result.length>=limit)return result;}
  if ((terms.length||kind==='file') && (kind==='all'||kind==='file')) {
    const documents = [...projects.flatMap(p=>(p.documents||[]).map(d=>({d,projectId:p.id,owner:p.name}))), ...conversations.flatMap(c=>(c.documents||[]).map(d=>({d,conversationId:c.id,owner:c.title})))];
    for(const {d,projectId,conversationId,owner} of documents) {
      const hits=documentMatches(d,query),seen=new Set();
      for(const source of hits){if(seen.has(source.sectionIndex))continue;seen.add(source.sectionIndex);add({kind:'file',id:d.id,title:d.name,subtitle:`${owner} · ${source.location} · `+excerpt(d.sections[source.sectionIndex].text,terms),projectId,conversationId,owner,query,source});if(seen.size>=3)break;}
      if(!hits.length&&matches(d.name)) add({kind:'file',id:d.id,title:d.name,subtitle:`${owner} · ${d.sections?.length||0} 页 / 段 · 打开资料阅读器`,projectId,conversationId,owner,query:''});
      if(result.length>=limit)return result;
    }
  }
  if(kind==='all'||kind==='note') for(const n of notes) if(matches(n.title)||terms.length&&matches(n.text))add({kind:'note',id:n.id,title:n.title,subtitle:excerpt(n.text,terms)});
  return result;
}
