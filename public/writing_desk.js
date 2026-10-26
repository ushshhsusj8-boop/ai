import {getLimits} from './site_limits.js';
import {scopedStorage,globalStorage,getStorageScope} from './scoped_storage.js';
import {createWritingStore} from './writing_store.js';
import {trapSidebarTab} from './accessibility.js';
import {createWritingSync} from './writing_sync.js';
import {writingBackup,writingBackupDrafts,validateWritingBackupSize} from './writing_backups.js';
export function initWritingDesk({insert,toast,userId=null,onIdentityChanged}) {
  const store=createWritingStore(scopedStorage), panel=document.createElement('aside');
  panel.id='writing-panel';panel.className='writing-panel';panel.hidden=true;panel.setAttribute('aria-labelledby','writing-heading');
  panel.innerHTML=`<header class="writing-heading"><div><span class="ui-kicker">写作画布</span><h2 id="writing-heading">把想法写完整</h2></div><button class="icon-button" id="writing-close" type="button" aria-label="关闭写作画布">×</button></header>
    <div class="writing-library"><label class="sr-only" for="writing-select">已保存的本机文稿</label><select id="writing-select"></select><button type="button" id="writing-new">新文稿</button></div>
    <label class="sr-only" for="writing-title">文稿名称</label><input id="writing-title" maxlength="80" placeholder="给文稿起个名字">
    <div class="writing-tabs" role="group" aria-label="文稿显示"><button id="writing-edit" type="button" aria-pressed="true">编辑</button><button id="writing-preview" type="button" aria-pressed="false">预览</button><span id="writing-count"></span></div>
    <label class="sr-only" for="writing-text">文稿内容</label><textarea id="writing-text" maxlength="${getLimits().writingText}" spellcheck="false" placeholder="写下草稿，或从 AI 回复中打开一份文稿…"></textarea><div id="writing-render" class="message-text" hidden></div>
    <p id="writing-status" role="status" aria-live="polite"></p><p id="writing-sync-status" role="status" aria-live="polite" hidden></p><div class="writing-sync-actions" hidden><button id="writing-sync-now" type="button">立即同步</button><button id="writing-conflicts" type="button" hidden>处理冲突</button><button id="writing-import-local" type="button">导入访客文稿</button></div><p class="ui-note" id="writing-storage-note"></p>
    <footer class="writing-actions"><button id="writing-save" type="button">保存</button><button id="writing-copy" type="button">另存副本</button><button id="writing-insert" type="button">放入聊天草稿</button><button id="writing-export" type="button">导出 Markdown</button><button id="writing-delete" type="button">删除</button></footer>`;
  document.querySelector('.app-shell').append(panel);
  const $=id=>panel.querySelector('#writing-'+id);let note, baseline='',timer,origin,sync;
  $('storage-note').textContent=userId?'文稿在此账户私有同步；离线修改先存本机。请观察云端状态。原聊天保持，导出可独立备份。':'访客文稿仅存当前浏览器。登录后可手动导入个人空间并跨设备同步，原访客版本保留。';
  const backupButton=document.createElement('button'),importButton=document.createElement('button'),file=document.createElement('input');
  backupButton.type=importButton.type='button';backupButton.id='writing-backup';importButton.id='writing-import-backup';backupButton.textContent='备份全部文稿';importButton.textContent='导入文稿备份';file.type='file';file.accept='.json';file.hidden=true;file.id='writing-backup-file';panel.querySelector('.writing-actions').append(backupButton,importButton,file);
  const payload=()=>({id:note.id,revision:note.revision,title:$('title').value.trim()||'未命名文稿',text:$('text').value});
  const fingerprint=()=>JSON.stringify({title:$('title').value,text:$('text').value});
  const dirty=()=>note&&fingerprint()!==baseline;
  const media=matchMedia('(max-width:760px),(max-width:1024px) and (max-height:500px)');
  function semantics(){const modal=!panel.hidden&&media.matches;panel.setAttribute('role',modal?'dialog':'region');panel.toggleAttribute('aria-modal',modal);if(modal)panel.setAttribute('aria-modal','true');document.querySelector('.main-panel').inert=modal;document.querySelector('#sidebar').inert=modal||(media.matches&&!document.body.classList.contains('sidebar-open'));}
  media.addEventListener('change',semantics);
  function list() {try{return store.list();}catch(e){$('status').textContent=e.message;return[];}}
  function library() {const notes=list();$('select').replaceChildren(new Option('本机文稿库',''),...notes.map(n=>new Option(n.title,n.id)));$('select').value=notes.some(n=>n.id===note?.id)?note.id:'';}
  function mode(preview) {
    $('text').hidden=preview;$('render').hidden=!preview;$('edit').setAttribute('aria-pressed',String(!preview));$('preview').setAttribute('aria-pressed',String(preview));
    if(preview){if(typeof window.renderMessageMarkdown==='function')window.renderMessageMarkdown($('text').value,$('render'));else $('render').textContent=$('text').value;}
  }
  function flush() {
    clearTimeout(timer);if(!dirty())return true;
    try {note=store.save(payload());baseline=fingerprint();$('status').textContent='已保存到本机文稿库'+(sync?' · 等待云端确认':'')+' · '+new Date(note.updatedAt).toLocaleTimeString();library();sync?.schedule();return true;}
    catch(e){$('status').textContent='尚未保存：'+e.message;return false;}
  }
  function draw(value) {
    note=value||{id:crypto.randomUUID(),revision:0,title:'未命名文稿',text:''};
    $('title').value=note.title;$('text').value=note.text;baseline=fingerprint();$('count').textContent=note.text.length+' 字符';library();mode(false);
    $('status').textContent=note.revision?'已载入文稿；修改后自动保存。':'新文稿 · 输入后自动保存到本机。';
  }
  function open(text, title='AI 回复文稿', id) {
    if((typeof text==='string'||id)&&dirty()&&!flush()){toast('当前文稿尚未保存，请先导出或另存副本。');return;}
    origin=document.activeElement;
    if(!document.querySelector('#artifact-panel')?.hidden)document.querySelector('#artifact-close')?.click();
    if(id){const value=list().find(n=>n.id===id);if(!value){toast('文稿已不存在。');return;}draw(value);}
    else if(typeof text==='string'){draw({id:crypto.randomUUID(),revision:0,title:title.slice(0,80)||'AI 回复文稿',text});baseline='';flush();}
    else if(!note)draw();
    panel.hidden=false;document.querySelector('.app-shell').classList.add('canvas-open');$('text').focus();
    semantics();if(sync)void sync.sync();
  }
  function close() {
    if(!flush()&&!confirm('文稿尚未保存。关闭画布并保留页面中的文字？刷新会丢失这些未保存修改，请先导出。'))return;
    panel.hidden=true;document.querySelector('.app-shell').classList.remove('canvas-open');semantics();if(origin?.isConnected&&origin.getClientRects().length)origin.focus();else document.querySelector('#prompt-input').focus();
  }
  $('close').onclick=close;$('edit').onclick=()=>mode(false);$('preview').onclick=()=>mode(true);$('save').onclick=flush;
  $('new').onclick=()=>{if(dirty()&&!flush()){toast('请先保存当前文稿或导出。');return;}draw();$('title').focus();};
  $('select').onchange=()=>{const id=$('select').value;if(dirty()&&!flush()){$('select').value=note.id;return;}if(id){const value=list().find(n=>n.id===id);if(value)draw(value);}else draw();};
  $('copy').onclick=()=>{const previous=note;note={...payload(),id:crypto.randomUUID(),revision:0};baseline='';if(flush())toast('已另存文稿副本，原稿保留。');else note=previous;};
  $('delete').onclick=()=>{if(!note.revision)return; if(!confirm(sync?'删除此文稿并同步到其他设备？原聊天与AI回复保留。':'删除这份本机文稿？原聊天与AI回复保留。'))return;try{store.remove(note.id,note.revision);draw();sync?.schedule();toast(sync?'本机文稿已删除，等待云端确认。':'本机文稿已删除。');}catch(e){$('status').textContent=e.message;}};
  $('export').onclick=()=>{const p=payload(),url=URL.createObjectURL(new Blob([p.text],{type:'text/markdown;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=p.title.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_')+'.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  $('insert').onclick=()=>insert($('text').value);
  const download=(name,text,type)=>{const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  backupButton.onclick=()=>{if(!flush())return;try{download('plaude-writing-'+new Date().toISOString().slice(0,10)+'.json',writingBackup(store.list()),'application/json;charset=utf-8');toast('此设备已载入的全部文稿已导出；云端未读的新内容需先同步。');}catch(e){$('status').textContent=e.message;}};
  importButton.onclick=()=>file.click();file.onchange=async()=>{const incoming=file.files?.[0];file.value='';if(!incoming||!flush())return;try{validateWritingBackupSize(incoming.size);const drafts=writingBackupDrafts(await incoming.text());if(!confirm(`导入${drafts.length}份文稿？相同内容跳过，其他内容创建新编号；现有文稿保留${sync?'，副本将同步到此账户':''}。`))return;const added=store.importDrafts(drafts);library();sync?.schedule();toast(`已导入${added}份文稿，相同内容已跳过。`);}catch(e){$('status').textContent='未导入：'+e.message;}};
  if(userId){
    $('sync-status').hidden=false;panel.querySelector('.writing-sync-actions').hidden=false;
    sync=createWritingSync({userId,store,storage:scopedStorage,isCurrent:()=>getStorageScope()===userId,onIdentityChanged,
      busy:id=>note?.id===id&&dirty(),changed:()=>{library();if(note?.revision&&!dirty()){const latest=list().find(n=>n.id===note.id);if(latest&&latest.revision!==note.revision)draw(latest);else if(!latest)draw();}},
      status:result=>{$('sync-status').textContent=result.message;$('conflicts').hidden=!result.conflicts;if(note?.revision&&!dirty()&&sync?.isSynced(note))$('status').textContent='已保存到此账户云端 · '+new Date(note.updatedAt).toLocaleTimeString();},
    });
    $('sync-now').onclick=()=>{if(flush())void sync.sync();};$('conflicts').onclick=()=>{if(flush())void sync.resolve();};
    $('import-local').onclick=()=>{if(!flush())return;try{const drafts=createWritingStore(globalStorage).list();if(!drafts.length){toast('此浏览器没有访客文稿可导入。');return;}if(!confirm(`将此浏览器的${drafts.length}份访客文稿复制到当前账户并同步？原访客文稿保留。`))return;const added=store.importDrafts(drafts);library();sync.schedule();toast(`已复制${added}份文稿到此账户的本机库，等待云端确认。`);}catch(e){$('sync-status').textContent=e.message;}};
    window.addEventListener('online',()=>void sync.sync());window.addEventListener('focus',()=>void sync.sync());setInterval(()=>void sync.sync(),30000);void sync.sync();
  }
  for(const id of ['title','text'])$(id).addEventListener('input',()=>{$('count').textContent=$('text').value.length+' 字符';$('status').textContent='正在保存本机修改…';clearTimeout(timer);timer=setTimeout(flush,350);});
  window.addEventListener('pagehide',flush);window.addEventListener('beforeunload',e=>{if(dirty()&&!flush()){e.preventDefault();e.returnValue='';}});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!panel.hidden&&!document.querySelector('dialog[open]')&&panel.contains(document.activeElement)){e.preventDefault();close();}});
  document.addEventListener('keydown',e=>{if(!panel.hidden&&media.matches&&!document.querySelector('dialog[open]'))trapSidebarTab(e,panel);},true);
  const artifact=document.querySelector('#artifact-panel');if(artifact)new MutationObserver(()=>{if(!artifact.hidden&&!panel.hidden)close();}).observe(artifact,{attributes:true,attributeFilter:['hidden']});
  library();
  return {open,flush,notes:list,refresh:library,sync:()=>sync?.sync(),get syncBusy(){return Boolean(sync?.running);}};
}
