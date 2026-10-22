import {WRITING_LIMITS} from './writing_store.js';
export function writingBackup(notes,now=new Date()) {
  return JSON.stringify({format:'plaude-writing-backup',version:1,exportedAt:now.toISOString(),notes:notes.map(({title,text})=>({title,text}))},null,2);
}
export function writingBackupDrafts(text) {
  if(typeof text!=='string'||new TextEncoder().encode(text).length>WRITING_LIMITS.bytes*2)throw Error('文稿备份超过4 MiB，无法导入。');
  const value=JSON.parse(text);
  if(value?.format!=='plaude-writing-backup'||value.version!==1||!Array.isArray(value.notes)||value.notes.length>WRITING_LIMITS.notes)throw Error('不是有效的plaude chat文稿备份。');
  return value.notes.map(n=>{if(!n||typeof n.title!=='string'||!n.title.trim()||n.title.length>80||typeof n.text!=='string'||n.text.length>WRITING_LIMITS.text)throw Error('备份含无效文稿，未导入任何内容。');return{title:n.title.trim(),text:n.text};});
}
