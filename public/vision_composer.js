import { scopedStorage, getStorageScope } from './scoped_storage.js';
import {getLimits,withStoredLimits} from './site_limits.js';
import { validateImages } from './image_attachments.js';
const DRAFT_KEY = 'yunjian-ai-image-drafts-v1';

export function imageGallery(images, open) {
  const gallery = document.createElement('div'); gallery.className = 'message-images';
  for (const item of images) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'image-thumbnail';
    button.title = `查看 ${item.name}`;
    const image = document.createElement('img'); image.src = item.dataUrl; image.alt = item.name; image.loading = 'lazy';
    button.append(image); button.onclick = () => open(item); gallery.append(button);
  }
  return gallery;
}

export function initVisionComposer(callbacks) {
  let drafts = {}, raw, unreadable=false;
  const scope=getStorageScope();
  try {
    raw=scopedStorage.getItem(DRAFT_KEY);
    const saved = JSON.parse(raw || '{}');
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('invalid');
    drafts = withStoredLimits(()=>Object.fromEntries(Object.entries(saved).map(([id, images]) => [id, validateImages(images)])));
  } catch { unreadable=true;callbacks.toast('图片草稿无法读取，旧数据未覆盖。可先下载原始数据，再确认清理；已发送记录不受影响。'); }
  const tray = document.createElement('div'); tray.id = 'image-draft-tray'; tray.hidden = true;
  const hint = document.createElement('p'); hint.id = 'vision-model-hint'; hint.className = 'vision-model-hint';
  const recovery=document.createElement('div');recovery.id='image-draft-recovery';recovery.hidden=!unreadable;recovery.className='vision-model-hint';
  const note=document.createElement('p');note.textContent='图片草稿无法读取，已阻止覆盖。仅清理未发送图片，不影响已发送聊天或文字草稿。';recovery.append(note);
  function snapshot(){
    if(getStorageScope()!==scope)throw Error('账户已改变，请刷新后处理图片草稿。');
    if(scopedStorage.getItem(DRAFT_KEY)!==raw)throw Error('图片草稿已在其他页面改变，请刷新后再处理。');
  }
  if(unreadable&&typeof raw==='string'){
    const download=document.createElement('button');download.id='image-draft-download';download.type='button';download.className='text-button';download.textContent='下载原始图片草稿';
    download.onclick=()=>{try{snapshot();const url=URL.createObjectURL(new Blob([raw],{type:'text/plain;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download='plaude-image-drafts-raw.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){callbacks.toast(error.message);}};
    const clear=document.createElement('button');clear.id='image-draft-clear';clear.type='button';clear.className='text-button';clear.textContent='清空损坏的图片草稿';
    clear.onclick=()=>{try{snapshot();if(!confirm('仅清空当前账户未发送的图片草稿？已发送聊天和文字草稿保留。此操作无法撤销，建议先下载原始数据。'))return;snapshot();scopedStorage.removeItem(DRAFT_KEY);drafts=Object.create(null);raw=null;unreadable=false;recovery.hidden=true;render();callbacks.changed();callbacks.toast('未发送图片草稿已清理，可以重新添加图片。');}catch(error){callbacks.toast(error.message);}};
    recovery.append(download,clear);
  }
  document.querySelector('#prompt-input').before(tray, hint, recovery);
  const dialog = document.createElement('dialog'); dialog.className = 'settings-dialog vision-dialog'; dialog.id = 'vision-dialog';
  dialog.innerHTML = '<div class="dialog-card"><div class="dialog-heading"><h2>查看图片</h2><button type="button" class="icon-button" aria-label="关闭图片">×</button></div><img alt=""><p></p></div>';
  document.body.append(dialog); dialog.querySelector('button').onclick = () => dialog.close();
  const images = (id = callbacks.context()) => Object.hasOwn(drafts, id) ? drafts[id] : [];
  function show(item) {
    dialog.querySelector('img').src = item.dataUrl; dialog.querySelector('img').alt = item.name;
    dialog.querySelector('p').textContent = `${item.name} · ${item.width} × ${item.height} · 发送给模型的压缩图片`;
    dialog.showModal();
  }
  function setImages(next, id = callbacks.context()) {
    try {
      if(getStorageScope()!==scope)throw Error('账户已改变，请刷新后添加图片。');
      if(unreadable)throw Error('旧图片草稿无法读取，未覆盖；请先下载原始数据并确认清理。');
      const before=images(id),stored=withStoredLimits(()=>validateImages(next));
      let position=0;
      const removing=stored.length<before.length&&stored.every(item=>{
        while(position<before.length&&JSON.stringify(before[position])!==JSON.stringify(item))position++;
        return position++<before.length;
      });
      next=removing?stored:validateImages(next);
      // Imported chat identifiers may coincide with Object.prototype names.
      const updated = Object.assign(Object.create(null), drafts);
      if (next.length) updated[id] = next; else delete updated[id];
      scopedStorage.setItem(DRAFT_KEY, JSON.stringify(updated)); drafts = updated;
      render(); callbacks.changed(); return true;
    } catch (error) { callbacks.toast(`图片草稿未保存：${error.message || '浏览器空间不足，请导出备份或移除待发送图片。'}`); return false; }
  }
  function render() {
    const current = images(); tray.hidden = !current.length; tray.replaceChildren();
    current.forEach((item, index) => {
      const card = document.createElement('div'); card.className = 'image-draft-card';
      card.append(imageGallery([item], show));
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'text-button';
      remove.textContent = '移除'; remove.setAttribute('aria-label', `移除图片 ${item.name}`); remove.disabled = callbacks.busy();
      remove.onclick = () => setImages(current.filter((_, i) => i !== index)); card.append(remove); tray.append(card);
    });
    hint.hidden = !current.length;
    hint.textContent = callbacks.supported()
      ? `${current.length}/${getLimits().imagesPerMessage} 张图片 · 点击发送后交给模型，并随当前对话保存。`
      : '当前型号未确认支持图片。请选择标有“看图”的型号，或移除图片后使用 OCR。';
    try{validateImages(current);}catch{hint.textContent+=' 旧草稿超过当前图片预算，原图保留；请逐张移除或重新添加压缩图片后发送。';}
  }
  return { images, setImages, render, show };
}
