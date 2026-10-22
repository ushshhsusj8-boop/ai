import {abortError, checkAbort} from './pdf_parse.js';
import {pageRanges} from './pdf_coverage.js';
export function choosePdfOcrPages({totalPages, missing, maxPages, signal}) {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const origin = document.activeElement, dialog = document.createElement('dialog'); dialog.id = 'pdf-ocr-picker'; dialog.className = 'pdf-ocr-picker'; dialog.setAttribute('aria-labelledby', 'pdf-ocr-heading');
    const node = (tag, text) => { const el = document.createElement(tag); if (text) el.textContent = text; return el; };
    const heading = node('h2', 'PDF 有未读取的页面'); heading.id = 'pdf-ocr-heading';
    const help = node('p', `共 ${totalPages} 页，第 ${pageRanges(missing)} 页没有文字层，可能是扫描页或空白页。可选最多 ${maxPages} 页在本机 OCR，也可只保留已提取的文字。OCR 不会调用模型，结果可能有误。`);
    const pages = node('div'); pages.className = 'pdf-ocr-pages'; pages.setAttribute('role', 'group'); pages.setAttribute('aria-label', '选择 OCR 页码');
    for (const n of missing) { const label = node('label'), input = node('input'); input.type = 'checkbox'; input.value = n; input.setAttribute('aria-label', `第 ${n} 页`); label.append(input, document.createTextNode(`第 ${n} 页`)); pages.append(label); }
    const status = node('p', '尚未选择页面'); status.id = 'pdf-ocr-selection'; status.setAttribute('role', 'status');
    const actions = node('div'); actions.className = 'pdf-ocr-actions';
    const button = (id, text, action) => { const b = node('button', text); b.type = 'button'; b.className = 'secondary-button'; b.id = id; b.onclick = action; return b; };
    const chosen = () => [...pages.querySelectorAll('input:checked')].map(i => Number(i.value));
    let settled = false;
    function finish(value, error) { if (settled) return; settled = true; signal?.removeEventListener('abort', cancel); dialog.close(); dialog.remove(); if (origin?.isConnected) origin.focus({preventScroll: true}); error ? reject(error) : resolve(value); }
    const cancel = () => finish(null, abortError());
    const start = button('pdf-ocr-start', '识别所选页面', () => finish(chosen())); start.className = 'primary-button'; start.disabled = true;
    pages.onchange = () => { const count = chosen().length; status.textContent = `已选择 ${count}/${maxPages} 页` + (count > maxPages ? '，请减少选择。' : ''); start.disabled = !count || count > maxPages; };
    const select = button('pdf-ocr-first', `选择前 ${Math.min(maxPages, missing.length)} 个未读页`, () => { pages.querySelectorAll('input').forEach((i, n) => i.checked = n < maxPages); pages.onchange(); });
    actions.append(select, start, button('pdf-ocr-text-only', '只保留已有文字', () => finish([])), button('pdf-ocr-cancel', '取消导入', cancel));
    dialog.append(heading, help, pages, status, actions); document.body.append(dialog); signal?.addEventListener('abort', cancel, {once: true}); dialog.addEventListener('cancel', e => { e.preventDefault(); cancel(); }); dialog.showModal(); select.focus();
  });
}
