import {getLimits} from './site_limits.js';
import { readTextFile } from './attachment_utils.js';
import { MAX_DOCUMENT_CHARS, textSections } from './document_library.js';
import {abortable, checkAbort, ocrViewport, readPdf} from './pdf_parse.js';
import {choosePdfOcrPages} from './pdf_ocr_picker.js';
import {createPdfOcr} from './pdf_ocr.js';
const TEXT_TYPES = ['txt', 'md', 'json', 'csv'];
const MAX_BYTES = getLimits().documentBytes;
const scripts = new Map();
function script(path) {
  if (!scripts.has(path)) scripts.set(path, new Promise((resolve, reject) => {
    const element = document.createElement('script'); element.src = path;
    element.onload = resolve; element.onerror = () => { scripts.delete(path); element.remove(); reject(Error('本地解析组件加载失败，请重新启动后端。')); };
    document.head.append(element);
  }));
  return scripts.get(path);
}
function safeName(name) { return name.replaceAll('\\', '/').split('/').at(-1).replace(/[<>:"|?*\[\]\x00-\x1f\x7f]/g, '_').slice(0, 100); }
export function validateDocxArchive(bytes) {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (data.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw Error('不是有效的 Word 文档。');
  const count = data.getUint16(end + 10, true), start = data.getUint32(end + 16, true);
  if (count > 1000 || count === 0 || start >= end) throw Error('Word 文档过大或格式不受支持。');
  let total = 0, cursor = start;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || data.getUint32(cursor, true) !== 0x02014b50) throw Error('Word 文档目录损坏。');
    const size = data.getUint32(cursor + 24, true), flags = data.getUint16(cursor + 8, true);
    total += size;
    if (flags & 1 || size > 16 * 1024 * 1024 || total > 32 * 1024 * 1024) throw Error('Word 文档解压后过大或已加密。');
    cursor += 46 + data.getUint16(cursor + 28, true) + data.getUint16(cursor + 30, true) + data.getUint16(cursor + 32, true);
  }
}
export async function parseDocument(file, { language = 'chi_sim+eng', progress = () => {}, full = false, signal, choosePages = choosePdfOcrPages } = {}) {
  checkAbort(signal);
  if (!file || typeof file.arrayBuffer !== 'function') throw Error('请选择文件。');
  const extension = file.name.split('.').at(-1).toLowerCase();
  if (TEXT_TYPES.includes(extension) && !full) return { ...await readTextFile(file), truncated: false };
  if (![...TEXT_TYPES, 'pdf', 'docx', 'png', 'jpg', 'jpeg', 'webp'].includes(extension)) throw Error('支持 TXT、Markdown、CSV、JSON、PDF、DOCX 和图片。');
  if (!file.size || file.size > getLimits().documentBytes) throw Error('文档或图片必须小于 5 MiB，且不能为空。');
  let text = '', pdfInfo; const sections = [];
  if (TEXT_TYPES.includes(extension)) {
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); }
    catch { throw Error('文本文件需使用 UTF-8 编码，请转换后重试。'); }
  } else if (extension === 'pdf') {
    progress('读取 PDF…');
    const pdf = await abortable(import('/vendor/pdf.mjs'), signal);
    pdf.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.mjs';
    const task = pdf.getDocument({ data: new Uint8Array(await abortable(file.arrayBuffer(), signal)), isEvalSupported: false,
      standardFontDataUrl: '/vendor/pdf-fonts/', useSystemFonts: true, maxImageSize: 12_000_000 });
    let ocr, render;
    const stop = () => { render?.cancel(); ocr?.terminate(); void task.destroy().catch(() => {}); };
    signal?.addEventListener('abort', stop, {once: true});
    try {
      const document = await abortable(task.promise, signal);
      if (document.numPages > (full ? getLimits().pdfPages : Math.min(40,getLimits().pdfPages))) throw Error(`一次最多解析 ${full ? getLimits().pdfPages : Math.min(40,getLimits().pdfPages)} 页 PDF，请先拆分文档。`);
      const result = await readPdf(document, {signal, progress, choosePages, recognizePage: async (page, n) => {
        if (!ocr) ocr = await createPdfOcr(language, signal, message => progress(`第 ${n} 页 · ${message}`));
        const viewport = ocrViewport(page), canvas = window.document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        try {
          render = page.render({canvas, canvasContext: canvas.getContext('2d'), viewport, background: '#ffffff', annotationMode: 0});
          await abortable(render.promise, signal); render = null;
          return await ocr.recognize(canvas);
        } finally { render?.cancel(); render = null; canvas.width = canvas.height = 0; }
      }});
      text = result.text; sections.push(...result.sections); pdfInfo = result.pdfInfo;
    } finally { signal?.removeEventListener('abort', stop); ocr?.terminate(); await task.destroy(); }
  } else if (extension === 'docx') {
    progress('读取 Word 文档…'); const buffer = await file.arrayBuffer();
    validateDocxArchive(new Uint8Array(buffer)); await script('/vendor/mammoth.js');
    text = (await window.mammoth.extractRawText({ arrayBuffer: buffer })).value;
  } else {
    progress('准备图片识别…');
    const bitmap = await createImageBitmap(file);
    const validSize = bitmap.width * bitmap.height <= getLimits().imagePixels; bitmap.close();
    if (!validSize) throw Error('图片最多 1200 万像素，请缩小后重试。');
    const worker = await createPdfOcr(language, signal, progress);
    try { text = await worker.recognize(file); } finally { worker.terminate(); }
  }
  checkAbort(signal);
  text = text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').trim();
  if (!text) throw Error('没有识别到可用文字。');
  if (full) {
    if (text.length > getLimits().documentChars) throw Error(`文档超过 ${getLimits().documentChars/10000} 万字符，请拆分后导入；未导入截断内容。`);
    return { name: safeName(file.name), text, sections: sections.length ? sections : textSections(text), ...(pdfInfo ? {pdfInfo} : {}), truncated: false, full: true };
  }
  const chars = Array.from(text), truncated = chars.length > getLimits().textAttachmentChars;
  return { name: safeName(file.name), text: chars.slice(0, getLimits().textAttachmentChars).join(''), truncated, ...(pdfInfo ? {pdfInfo} : {}) };
}
export function formatDocument(name, text) {
  return `【文件内容：${safeName(name)}】\n${text.trim()}\n【文件结束】`;
}
