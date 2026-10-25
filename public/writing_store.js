import {getLimits,limitObject,withStoredLimits} from './site_limits.js';
export const WRITING_KEY='plaude-writing-desk-v1';
export const WRITING_LIMITS=limitObject({bytes:'writingBytes',notes:'writingCount',text:'writingText'});
const KEY=WRITING_KEY;
export function validateWritingNote(n) {
  if(!n||typeof n.id!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(n.id)||typeof n.title!=='string'||!n.title.trim()||n.title.length>80||typeof n.text!=='string'||n.text.length>WRITING_LIMITS.text||!Number.isSafeInteger(n.revision)||n.revision<1||!Number.isSafeInteger(n.updatedAt)||n.updatedAt<0)throw Error('文稿格式无效，未覆盖原数据。');
  return {id:n.id,title:n.title.trim(),text:n.text,revision:n.revision,updatedAt:n.updatedAt};
}
export function validateWritingNotes(notes) {
  if(!Array.isArray(notes)||notes.length>WRITING_LIMITS.notes)throw Error('文稿数量超出上限（50份），原数据保留。');
  const ids=new Set(),value=notes.map(n=>{const next=validateWritingNote(n);if(ids.has(next.id))throw Error('文稿编号重复，原数据保留。');ids.add(next.id);return next;});
  if(new TextEncoder().encode(JSON.stringify({version:1,notes:value})).length>WRITING_LIMITS.bytes)throw Error('文稿库已满（2 MiB），请先导出并清理旧文稿。');
  return value;
}
export function createWritingStore(storage, {now=Date.now}={}) {
  function read(...args){return withStoredLimits(()=>readStored(...args));}
function readStored() {
    const raw=storage.getItem(KEY); if(!raw)return{version:1,notes:[]};
    const value=JSON.parse(raw);
    if(value?.version!==1||!Array.isArray(value.notes)||value.notes.length>WRITING_LIMITS.notes)throw Error('文稿库格式无效，已保留原数据，请先导出浏览器备份。');
    value.notes=validateWritingNotes(value.notes);
    return value;
  }
  function write(value) {value.notes=validateWritingNotes(value.notes);storage.setItem(KEY,JSON.stringify(value));}
  return Object.freeze({list:()=>structuredClone(read().notes).sort((a,b)=>b.updatedAt-a.updatedAt),
    save(note) {
      if(typeof note?.title!=='string'||!note.title.trim()||note.title.length>80||typeof note.text!=='string'||note.text.length>getLimits().writingText||typeof note.id!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(note.id)||!Number.isSafeInteger(note.revision)||note.revision<0)throw Error('文稿名称或内容无效。');
      const state=read(), index=state.notes.findIndex(n=>n.id===note.id), previous=state.notes[index];
      if(previous?previous.revision!==note.revision:note.revision!==0)throw Error('文稿已在其他页面修改或删除。当前文字仍保留，请另存副本。');
      if(index<0&&state.notes.length>=WRITING_LIMITS.notes)throw Error('本机最多保存 50 份文稿，请先导出并清理。');
      const next={id:note.id,title:note.title.trim(),text:note.text,revision:(previous?.revision||0)+1,updatedAt:now()};
      if(index<0)state.notes.push(next);else state.notes[index]=next;write(state);return structuredClone(next);
    },adopt(remote, expectedRevision) {
      remote=withStoredLimits(()=>validateWritingNote(remote));const state=read(),index=state.notes.findIndex(n=>n.id===remote.id),previous=state.notes[index];
      if((previous?.revision||0)!==expectedRevision)throw Error('本机文稿已改变，未覆盖当前修改。');
      const next={...remote,revision:(previous?.revision||0)+1};if(index<0)state.notes.push(next);else state.notes[index]=next;withStoredLimits(()=>write(state));return structuredClone(next);
    },resolve(id, cloud) {
      const state=read(),previous=state.notes.find(n=>n.id===id),next=state.notes.filter(n=>n.id!==id);
      if(previous)next.push({...previous,id:crypto.randomUUID(),title:(previous.title.slice(0,72)+' · 副本'),revision:1,updatedAt:now()});
      if(cloud)next.push({...validateWritingNote(cloud),revision:(previous?.revision||0)+1});
      write({version:1,notes:next});return structuredClone(next);
    },importDrafts(drafts) {
      if(!Array.isArray(drafts)||drafts.length>WRITING_LIMITS.notes)throw Error('文稿备份格式或数量无效。');
      const state=read();let added=0;
      for(const draft of drafts){const next=validateWritingNote({...draft,id:crypto.randomUUID(),revision:1,updatedAt:now()});if(state.notes.some(n=>n.title===next.title&&n.text===next.text))continue;state.notes.push(next);added++;}
      write(state);return added;
    },remove(id, revision) {
      const state=read(), previous=state.notes.find(n=>n.id===id);if(!previous)return;
      if(previous.revision!==revision)throw Error('另一页面已修改这份文稿，未删除新版。');
      // Removing a confirmed note may leave other old notes above a new quota.
      state.notes=state.notes.filter(n=>n.id!==id);withStoredLimits(()=>write(state));
    }});
}
