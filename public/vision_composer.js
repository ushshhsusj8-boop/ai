import { scopedStorage } from './scoped_storage.js';
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
  let drafts = {};
  try {
    const saved = JSON.parse(scopedStorage.getItem(DRAFT_KEY) || '{}');
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('invalid');
    drafts = Object.fromEntries(Object.entries(saved).map(([id, images]) => [id, validateImages(images)]));
  } catch { callbacks.toast('图片草稿无法读取，请重新添加图片；已发送的聊天记录不受影响。'); }
  const tray = document.createElement('div'); tray.id = 'image-draft-tray'; tray.hidden = true;
  const hint = document.createElement('p'); hint.id = 'vision-model-hint'; hint.className = 'vision-model-hint';
  document.querySelector('#prompt-input').before(tray, hint);
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
      next = validateImages(next);
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
      ? `${current.length}/3 张图片 · 点击发送后交给模型，并随当前对话保存。`
      : '当前型号未确认支持图片。请选择标有“看图”的型号，或移除图片后使用 OCR。';
  }
  return { images, setImages, render, show };
}
