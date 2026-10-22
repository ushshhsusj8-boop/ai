const STATES = new Set(['text', 'ocr', 'unread', 'no_text']);
export function validatePdfInfo(value, sections) {
  if (value === undefined) return undefined;
  if (!value || value.version !== 1 || !Number.isInteger(value.totalPages) || value.totalPages < 1 || value.totalPages > 200
    || !Array.isArray(value.states) || value.states.length !== value.totalPages || value.states.some(s => !STATES.has(s))) throw Error('PDF 逐页读取状态无效。');
  const pages = value.states.flatMap((s, i) => ['text', 'ocr'].includes(s) ? [i + 1] : []);
  if (sections && (sections.length !== pages.length || sections.some((s, i) => s.label !== `第 ${pages[i]} 页`))) throw Error('PDF 页码与读取状态不一致。');
  return {version: 1, totalPages: value.totalPages, states: [...value.states]};
}
export function pageRanges(pages) {
  const ranges = [];
  for (let i = 0; i < pages.length; i++) {
    const start = pages[i]; let end = start;
    while (pages[i + 1] === end + 1) end = pages[++i];
    ranges.push(start === end ? String(start) : `${start}–${end}`);
  }
  return ranges.join('、');
}
export function pdfCoverage(info) {
  if (!info) return '';
  const text = info.states.filter(s => s === 'text').length, ocr = info.states.filter(s => s === 'ocr').length;
  const missing = info.states.flatMap((s, i) => ['unread', 'no_text'].includes(s) ? [i + 1] : []);
  return `PDF 共 ${info.totalPages} 页 · 文字层 ${text} 页 · OCR ${ocr} 页。`
    + (missing.length ? `未读取文字 ${missing.length} 页（第 ${pageRanges(missing)} 页）；可能是扫描页、空白页或识别遗漏，不能视为全文。` : '每页均提取到文字；不保证文字层或 OCR 没有遗漏。')
    + (ocr ? 'OCR 可能识别错误，请核对原文件。' : '');
}
