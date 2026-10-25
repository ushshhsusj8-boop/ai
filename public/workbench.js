import {getLimits} from './site_limits.js';
import { scopedStorage } from './scoped_storage.js';
import { parseDocument, formatDocument } from './documents.js';
import {pdfCoverage} from './pdf_coverage.js';
import { previewDocument, messageDetails } from './workbench_tools.js';
import { prepareImage } from './image_attachments.js';
import { textSections } from './document_library.js';

function download(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function initWorkbench(callbacks) {
  const quickbar = document.createElement('div'); quickbar.className = 'workbench-quickbar';
  quickbar.innerHTML = `<div class="quick-preset"><label for="quick-preset">提示词</label><select id="quick-preset" aria-label="快捷切换提示词"></select><button class="text-button" id="quick-preset-edit" type="button">编辑</button></div><div class="quick-actions"><label class="quick-markdown"><input id="quick-markdown" type="checkbox" checked> Markdown</label><button class="text-button" id="quick-find" type="button">⌕ 查找</button><button class="text-button" id="quick-artifact" type="button" disabled>◇ 代码预览</button></div>`;
  document.querySelector('#conversation').before(quickbar);
  const preset = quickbar.querySelector('#quick-preset');
  preset.onchange = () => callbacks.setPreset(preset.value);
  quickbar.querySelector('#quick-preset-edit').onclick = callbacks.editPreset;
  quickbar.querySelector('#quick-find').onclick = callbacks.find;
  const markdown = quickbar.querySelector('#quick-markdown');
  try { markdown.checked = scopedStorage.getItem('yunjian-ai-markdown-v1') !== 'false'; } catch {}
  markdown.onchange = () => {
    try { scopedStorage.setItem('yunjian-ai-markdown-v1', String(markdown.checked)); } catch {}
    callbacks.render();
  };

  const panel = document.createElement('aside'); panel.id = 'artifact-panel'; panel.className = 'artifact-panel'; panel.hidden = true;
  panel.setAttribute('aria-label', '代码与页面预览');
  panel.innerHTML = `<header class="artifact-heading"><div><span class="dialog-kicker">创作预览</span><h2 id="artifact-title">代码预览</h2></div><button class="icon-button" id="artifact-expand" type="button" aria-label="展开预览面板" aria-pressed="false">⛶</button><button class="icon-button" id="artifact-close" type="button" aria-label="关闭预览面板">×</button></header><div class="artifact-toolbar"><div role="group" aria-label="预览显示方式"><button class="secondary-button" id="artifact-preview-tab" type="button">预览</button><button class="secondary-button" id="artifact-code-tab" type="button">代码</button></div><button class="text-button" id="artifact-copy" type="button">复制</button><button class="text-button" id="artifact-download" type="button">下载</button></div><p id="artifact-note" class="artifact-note"></p><div id="artifact-content" class="artifact-content"></div>`;
  document.querySelector('.app-shell').append(panel);
  let artifact, artifactFocus;
  const content = panel.querySelector('#artifact-content');
  const previewTab = panel.querySelector('#artifact-preview-tab'), codeTab = panel.querySelector('#artifact-code-tab');
  function artifactView(preview) {
    preview = preview && /^(html?|svg)$/i.test(artifact.language);
    previewTab.setAttribute('aria-pressed', String(preview)); codeTab.setAttribute('aria-pressed', String(!preview));
    content.replaceChildren();
    if (preview) {
      const frame = document.createElement('iframe'); frame.title = 'HTML / SVG 静态预览';
      frame.setAttribute('sandbox', ''); frame.setAttribute('referrerpolicy', 'no-referrer');
      frame.setAttribute('inert', ''); frame.setAttribute('tabindex', '-1');
      frame.srcdoc = previewDocument(artifact.source); content.append(frame);
    } else { const pre = document.createElement('pre'); const code = document.createElement('code'); code.textContent = artifact.source; pre.append(code); content.append(pre); }
  }
  function openArtifact(language, source) {
    artifact = { language: language || 'text', source }; artifactFocus = document.activeElement;
    panel.hidden = false; document.querySelector('.app-shell').classList.add('artifact-open');
    panel.querySelector('#artifact-title').textContent = `${artifact.language.toUpperCase()} · ${source.split('\n').length} 行`;
    previewTab.disabled = !/^(html?|svg)$/i.test(language);
    panel.querySelector('#artifact-note').textContent = previewTab.disabled ? '查看、复制或下载完整代码。' : '静态预览 · 脚本和外部资源不会运行';
    quickbar.querySelector('#quick-artifact').disabled = false; artifactView(!previewTab.disabled);
    panel.querySelector('#artifact-close').focus();
  }
  function closeArtifact() {
    panel.hidden = true; panel.classList.remove('is-expanded'); content.replaceChildren();
    document.querySelector('.app-shell').classList.remove('artifact-open');
    panel.querySelector('#artifact-expand').setAttribute('aria-pressed', 'false');
    if (artifactFocus?.isConnected) artifactFocus.focus(); else quickbar.querySelector('#quick-artifact').focus();
  }
  window.openCodeArtifact = openArtifact;
  quickbar.querySelector('#quick-artifact').onclick = () => artifact && openArtifact(artifact.language, artifact.source);
  panel.querySelector('#artifact-close').onclick = closeArtifact;
  panel.querySelector('#artifact-expand').onclick = event => {
    const expanded = panel.classList.toggle('is-expanded'); event.currentTarget.setAttribute('aria-pressed', String(expanded));
    event.currentTarget.setAttribute('aria-label', expanded ? '还原预览面板' : '展开预览面板');
  };
  previewTab.onclick = () => artifactView(true); codeTab.onclick = () => artifactView(false);
  panel.querySelector('#artifact-copy').onclick = async () => callbacks.toast(await callbacks.copy(artifact.source) ? '代码已复制。' : '复制失败，请在代码页手动复制。');
  panel.querySelector('#artifact-download').onclick = () => {
    const extensions = { html: 'html', htm: 'html', svg: 'svg', javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts', python: 'py', py: 'py', css: 'css', json: 'json', markdown: 'md', md: 'md' };
    download(artifact.source, `plaude-code.${extensions[artifact.language.toLowerCase()] || 'txt'}`);
  };
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden && !document.querySelector('dialog[open]')) { event.preventDefault(); closeArtifact(); }
  });

  const details = document.createElement('dialog'); details.id = 'message-details-dialog'; details.className = 'settings-dialog message-details-dialog';
  details.setAttribute('aria-labelledby', 'message-details-title');
  details.innerHTML = `<div class="dialog-card"><div class="dialog-heading"><h2 id="message-details-title">消息详情</h2><button class="icon-button" type="button" aria-label="关闭消息详情">×</button></div><p>当前消息的保存内容、时间和所属对话模型。</p><pre></pre><button class="secondary-button" type="button" id="message-details-copy">复制 JSON</button></div>`;
  document.body.append(details); details.querySelector('.icon-button').onclick = () => details.close();
  details.querySelector('#message-details-copy').onclick = async () => callbacks.toast(await callbacks.copy(details.querySelector('pre').textContent) ? '消息详情已复制。' : '复制失败。');

  const review = document.createElement('dialog'); review.id = 'attachment-review'; review.className = 'settings-dialog attachment-review';
  review.setAttribute('aria-labelledby', 'attachment-review-title');
  review.innerHTML = `<div class="dialog-card"><div class="dialog-heading"><div><span class="dialog-kicker">附件工作区</span><h2 id="attachment-review-title">检查文件内容</h2></div><button class="icon-button" id="attachment-close" type="button" aria-label="取消文件导入">×</button></div><p>文件在浏览器内解析。先检查文字，再插入消息；点击发送后才会交给模型。</p><div id="attachment-files" class="attachment-files" role="group" aria-label="选择待检查文件"></div><p id="attachment-status" role="status"></p><label class="token-label" for="attachment-text">解析文字（可修改）</label><textarea id="attachment-text" rows="12" maxlength="6000" spellcheck="false"></textarea><div class="dialog-actions"><button class="text-button" id="attachment-remove" type="button">移除此文件</button><button class="secondary-button" id="attachment-cancel" type="button">取消</button><button class="primary-button" id="attachment-insert" type="button" disabled>插入消息</button></div></div>`;
  document.body.append(review);
  review.querySelector('.dialog-heading + p').textContent = `文档加入当前对话资料，后续提问自动检索相关片段；最多 ${getLimits().documentCount} 份、每份 ${getLimits().documentChars} 字符、PDF ${getLimits().pdfPages} 页。资料随当前对话保存，发送问题后相关片段交给模型。图片支持直接看图或 OCR。`;
  review.querySelector('#attachment-text').maxLength = getLimits().documentChars;
  review.querySelector('#attachment-insert').textContent = '添加到当前对话';
  const imagePreview = document.createElement('img'); imagePreview.id = 'attachment-image-preview'; imagePreview.alt = '待发送图片'; imagePreview.hidden = true;
  const ocr = document.createElement('button'); ocr.type = 'button'; ocr.id = 'attachment-ocr'; ocr.className = 'secondary-button'; ocr.textContent = '改为 OCR 文字'; ocr.hidden = true;
  review.querySelector('#attachment-text').before(imagePreview, ocr);
  const editor = review.querySelector('#attachment-text'), status = review.querySelector('#attachment-status'), insert = review.querySelector('#attachment-insert');
  let files = [], selected = 0, parsing = false, context, parseController;
  function stash() {
    const file = files[selected];
    if (file && !file.image && file.text !== editor.value) {
      file.text = editor.value;
      if (file.full) { file.sections = textSections(file.text, '编辑后段落'); delete file.pdfInfo; }
    }
  }
  function showFiles() {
    const list = review.querySelector('#attachment-files'); list.replaceChildren();
    files.forEach((file, index) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary-button';
      button.textContent = file.name; button.setAttribute('aria-pressed', String(selected === index));
      button.disabled = parsing;
      button.onclick = () => { stash(); selected = index; showFiles(); }; list.append(button);
    });
    const file = files[selected]; editor.value = file?.text || ''; editor.disabled = parsing || !file;
    editor.hidden = Boolean(file?.image); review.querySelector('label[for="attachment-text"]').hidden = editor.hidden;
    imagePreview.hidden = !file?.image; ocr.hidden = !file?.image; ocr.disabled = parsing;
    if (file?.image) imagePreview.src = file.image.dataUrl; else imagePreview.removeAttribute('src');
    review.querySelector('#attachment-remove').disabled = parsing || !file;
    insert.disabled = parsing || !files.length;
    if (!parsing) status.textContent = file?.image
      ? `${file.name} · ${file.image.width} × ${file.image.height} · 已压缩；${callbacks.visionSupported() ? '当前型号支持看图' : '发送前请选择标有“看图”的型号，或改用 OCR'}`
      : file ? `${file.name} · ${file.text.length} 字${file.truncated ? ` · 内容较长，已截取前 ${getLimits().textAttachmentChars} 字` : ''} ${pdfCoverage(file.pdfInfo)}` : '没有待插入的文件。';
  }
  ocr.onclick = async () => {
    const file = files[selected]; if (!file?.image || parsing) return;
    parsing = true; parseController = new AbortController(); showFiles();
    try {
      const parsed = await parseDocument(file.sourceFile, { signal: parseController.signal, language: callbacks.ocrLanguage(), progress: text => { status.textContent = text; } });
      if (review.open) files[selected] = parsed;
      parsing = false; showFiles();
    } catch (error) { parsing = false; showFiles(); status.textContent = error.message; }
  };
  review.querySelector('#attachment-close').onclick = () => review.close();
  review.querySelector('#attachment-cancel').onclick = () => review.close();
  review.addEventListener('close', () => parseController?.abort());
  review.querySelector('#attachment-remove').onclick = () => { stash(); files.splice(selected, 1); selected = Math.max(0, selected - 1); showFiles(); };
  insert.onclick = () => {
    stash();
    if (files.some(file => !file.image && !file.text.trim())) { status.textContent = '文件内容不能为空，可移除不需要的文件。'; return; }
    if (context !== callbacks.context()) { status.textContent = '当前对话已改变，请取消后在目标对话重新添加文件。'; return; }
    const documents = files.filter(file => file.full).map(file => ({ id: crypto.randomUUID(), name: file.name, enabled: true, sections: file.sections, ...(file.pdfInfo ? {pdfInfo: file.pdfInfo} : {}) }));
    if (callbacks.insert(files.filter(file => !file.image && !file.full).map(file => formatDocument(file.name, file.text)).join('\n\n'), files.filter(file => file.image).map(file => file.image), documents)) review.close();
  };
  async function openFiles(input) {
    if (parsing || callbacks.busy()) return callbacks.toast('请等待当前任务完成后添加文件。');
    if (!input.length) return;
    if (input.length > Math.max(getLimits().documentCount,getLimits().imagesPerMessage)) return callbacks.toast('一次最多添加 3 个文件。');
    files = []; selected = 0; context = callbacks.context(); parsing = true; parseController = new AbortController(); showFiles(); review.showModal();
    try {
      for (const file of input) {
        status.textContent = `正在读取 ${file.name}…`;
        const isImage = /\.(png|jpe?g|webp)$/i.test(file.name) || /^image\/(png|jpeg|webp)$/.test(file.type);
        const result = isImage ? { name: file.name, text: '', image: await prepareImage(file), sourceFile: file }
          : await parseDocument(file, { full: true, signal: parseController.signal, language: callbacks.ocrLanguage(), progress: text => { status.textContent = `${file.name} · ${text}`; } });
        if (!review.open) return;
        files.push(result);
      }
      parsing = false; showFiles(); editor.focus();
    } catch (error) { files = []; parsing = false; showFiles(); status.textContent = error.message || '文件解析失败。'; }
    finally { parsing = false; }
  }
  const dropzone = document.createElement('div'); dropzone.className = 'file-drop-overlay'; dropzone.hidden = true;
  dropzone.innerHTML = '<div><strong>松开以检查附件</strong><span>文本 · PDF · Word · 图片，最多 3 个文件</span></div>';
  document.body.append(dropzone); let dragDepth = 0;
  const fileDrag = event => [...(event.dataTransfer?.types || [])].includes('Files');
  document.addEventListener('dragenter', event => { if (fileDrag(event)) { event.preventDefault(); dragDepth++; if (!document.querySelector('dialog[open]')) dropzone.hidden = false; } });
  document.addEventListener('dragover', event => { if (fileDrag(event)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } });
  document.addEventListener('dragleave', event => { if (fileDrag(event) && --dragDepth <= 0) { dragDepth = 0; dropzone.hidden = true; } });
  document.addEventListener('drop', event => { if (!fileDrag(event)) return; event.preventDefault(); dragDepth = 0; dropzone.hidden = true;
    if (document.querySelector('dialog[open]')) return callbacks.toast('请先关闭当前弹窗，再添加文件。');
    void openFiles([...event.dataTransfer.files]);
  });
  window.addEventListener('blur', () => { dragDepth = 0; dropzone.hidden = true; });
  document.querySelector('#prompt-input').addEventListener('paste', event => {
    const images = [...(event.clipboardData?.files || [])].filter(file => file.type.startsWith('image/'));
    if (images.length) { event.preventDefault(); void openFiles(images); }
  });
  return {
    openFiles, markdown: () => markdown.checked,
    details(message, conversation) { details.querySelector('pre').textContent = JSON.stringify(messageDetails(message, conversation), null, 2); details.showModal(); },
    sync(conversation, presets, busy) {
      const choices = [{ id: 'current', name: '自定义设定' }, ...presets];
      preset.replaceChildren(...choices.map(choice => { const option = document.createElement('option'); option.value = choice.id; option.textContent = choice.name; return option; }));
      preset.value = presets.find(p => p.instructions === (conversation?.instructions || ''))?.id || 'current';
      preset.disabled = busy; quickbar.querySelector('#quick-preset-edit').disabled = busy;
      quickbar.querySelector('#quick-find').disabled = !conversation?.messages?.length;
    },
  };
}
