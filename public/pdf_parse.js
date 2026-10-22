export const MAX_OCR_PAGES = 20;
export const MAX_OCR_PIXELS = 4_000_000;
export function abortError() { return new DOMException('已取消文件解析，原资料保留。', 'AbortError'); }
export function checkAbort(signal) { if (signal?.aborted) throw abortError(); }
export function abortable(promise, signal) {
  if (!signal) return Promise.resolve(promise);
  if (signal.aborted) { Promise.resolve(promise).catch(() => {}); return Promise.reject(abortError()); }
  return new Promise((resolve, reject) => {
    const cancel = () => reject(abortError()); signal.addEventListener('abort', cancel, {once: true});
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel));
  });
}
export function ocrViewport(page) {
  const base = page.getViewport({scale: 1}), area = base.width * base.height;
  if (!(area > 0) || !Number.isFinite(area) || !Number.isFinite(base.width + base.height)) throw Error('PDF 页面尺寸无效。');
  const scale = Math.min(2, Math.sqrt((MAX_OCR_PIXELS - 10000) / area), 4096 / Math.max(base.width, base.height));
  const viewport = page.getViewport({scale});
  if (Math.ceil(viewport.width) * Math.ceil(viewport.height) > MAX_OCR_PIXELS) throw Error('PDF 页面像素超过 OCR 限制。');
  return viewport;
}
const clean = text => text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').trim();
/** Adapters allow cancellation and resource limits to be tested without OCR/model calls. */
export async function readPdf(pdf, {signal, progress = () => {}, choosePages = async () => [], recognizePage, maxChars = 120000} = {}) {
  if (!Number.isInteger(pdf.numPages) || pdf.numPages < 1 || pdf.numPages > 200) throw Error('PDF 最多 200 页，请拆分后上传。');
  const states = Array(pdf.numPages).fill('unread'), texts = new Map(); let chars = 0;
  function add(page, text, kind) {
    text = clean(text);
    if (!text) { if (kind === 'ocr') states[page - 1] = 'no_text'; return; }
    chars += text.length;
    if (chars > maxChars) throw Error('PDF 超过 12 万字符，请拆分后导入；未导入截断内容。');
    texts.set(page, text); states[page - 1] = kind;
  }
  for (let n = 1; n <= pdf.numPages; n++) {
    checkAbort(signal); progress(`读取 PDF 文字层 ${n}/${pdf.numPages}…`);
    const page = await abortable(pdf.getPage(n), signal);
    try {
      const content = await abortable(page.getTextContent(), signal);
      add(n, content.items.map(item => (item.str || '') + (item.hasEOL ? '\n' : ' ')).join(''), 'text');
    } finally { page.cleanup(); }
  }
  const missing = states.flatMap((s, i) => s === 'unread' ? [i + 1] : []);
  if (missing.length) {
    const selected = await abortable(choosePages({totalPages: pdf.numPages, missing, maxPages: MAX_OCR_PAGES, signal}), signal);
    checkAbort(signal);
    if (!Array.isArray(selected) || selected.length > MAX_OCR_PAGES || new Set(selected).size !== selected.length || selected.some(n => !missing.includes(n))) throw Error('请从未读页中选择最多 20 页进行 OCR。');
    for (const [i, n] of [...selected].sort((a, b) => a - b).entries()) {
      checkAbort(signal); progress(`OCR 第 ${n} 页（${i + 1}/${selected.length}）…`);
      const page = await abortable(pdf.getPage(n), signal);
      try {
        if (!recognizePage) throw Error('OCR 组件不可用。');
        add(n, await abortable(recognizePage(page, n), signal), 'ocr');
      } finally { page.cleanup(); }
    }
  }
  checkAbort(signal);
  if (!texts.size) throw Error('没有提取到文字；扫描 PDF 请选择页面进行 OCR，识别仍为空时请核对原文件。');
  const sections = [...texts].sort((a, b) => a[0] - b[0]).map(([n, text]) => ({label: `第 ${n} 页`, text}));
  return {sections, text: sections.map(s => s.text).join('\n'), pdfInfo: {version: 1, totalPages: pdf.numPages, states}};
}
