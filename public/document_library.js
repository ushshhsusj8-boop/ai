import {getLimits} from './site_limits.js';
import {openDocumentReader} from './document_reader.js';
import {getStorageScope} from './scoped_storage.js';
import {validatePdfInfo, pdfCoverage} from './pdf_coverage.js';
export const MAX_DOCUMENT_CHARS = getLimits().documentChars;
export function validateDocuments(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > getLimits().documentCount) throw Error('每段对话超过当前资料份数预算，请新建对话添加更多。');
  const ids = new Set();
  return value.map(doc => {
    if (!doc || typeof doc.id !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(doc.id) || ids.has(doc.id)
      || typeof doc.name !== 'string' || !doc.name.trim() || doc.name.length > 100
      || !Array.isArray(doc.sections) || !doc.sections.length || doc.sections.length > 2000
      || (doc.enabled !== undefined && typeof doc.enabled !== 'boolean')) throw Error('资料格式无效。');
    ids.add(doc.id); let length = 0;
    const sections = doc.sections.map(section => {
      if (!section || typeof section.label !== 'string' || !section.label.trim() || section.label.length > 60
        || typeof section.text !== 'string' || !section.text.trim()) throw Error('资料段落无效。');
      length += section.text.length;
      if (length > getLimits().documentChars) throw Error(`每份资料最多 ${getLimits().documentChars/10000} 万字符，请拆分文件后导入。`);
      return { label: section.label, text: section.text };
    });
    const pdfInfo = validatePdfInfo(doc.pdfInfo, sections);
    return { id: doc.id, name: doc.name, enabled: doc.enabled !== false, sections, ...(pdfInfo ? {pdfInfo} : {}) };
  });
}
export function textSections(text, prefix = '段落') {
  const sections = [];
  for (let start = 0; start < text.length; start += 1200) {
    const part = text.slice(start, start + 1200);
    if (part.trim()) sections.push({ label: `${prefix} ${sections.length + 1}`, text: part });
  }
  return sections;
}
export function validateDocumentContext(value) {
  if (value === undefined) return undefined;
  if (!value || !['retrieval', 'overview'].includes(value.mode) || !Array.isArray(value.sources) || value.sources.length > getLimits().documentFragments) throw Error('资料引用格式无效。');
  const sources = value.sources.map(source => {
    if (!source || !/^资料\d{1,2}·片段\d{1,5}$/.test(source.id) || typeof source.name !== 'string' || source.name.length > 100
      || typeof source.location !== 'string' || source.location.length > 60 || typeof source.text !== 'string' || source.text.length > getLimits().documentFragmentChars) throw Error('资料引用内容无效。');
    const position = {};
    if (source.documentId !== undefined || source.sectionIndex !== undefined || source.offset !== undefined) {
      if (typeof source.documentId !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(source.documentId)
        || !Number.isInteger(source.sectionIndex) || source.sectionIndex < 0 || source.sectionIndex >= 2000
        || !Number.isInteger(source.offset) || source.offset < 0 || source.offset >= getLimits().documentChars) throw Error('资料定位无效。');
      Object.assign(position, { documentId: source.documentId, sectionIndex: source.sectionIndex, offset: source.offset });
    }
    return { id: source.id, name: source.name, location: source.location, text: source.text, ...position };
  });
  return { mode: value.mode, sources };
}
export function locateDocumentSource(source, documents) {
  // Never guess by filename: old citations and changed/deleted files keep their snapshot.
  const doc = documents.find(d => d.id === source.documentId);
  const section = doc?.sections[source.sectionIndex];
  if (!source.text || !section || section.label !== source.location
    || section.text.slice(source.offset, source.offset + source.text.length) !== source.text) return null;
  return { doc, section, offset: source.offset };
}
export function wireCitationLinks(text, article) {
  const targets = new Map([...article.querySelectorAll('[data-citation]')].map(el => [el.dataset.citation, el]));
  const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
  const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    if (node.parentElement.closest('pre,code,a,button')) continue;
    const pattern = /\[(资料\d{1,2}·片段\d{1,5}|\d{1,2})\]/g;
    let cursor = 0; const fragment = document.createDocumentFragment();
    for (const match of node.textContent.matchAll(pattern)) {
      const target = targets.get(match[1]); if (!target) continue;
      fragment.append(document.createTextNode(node.textContent.slice(cursor, match.index)));
      const button = document.createElement('button'); button.type = 'button'; button.className = 'citation-link';
      button.textContent = match[0]; button.setAttribute('aria-label', `查看来源 ${match[1]}`);
      button.onclick = () => {
        for (let parent = target; parent && parent !== article; parent = parent.parentElement) if (parent.tagName === 'DETAILS') parent.open = true;
        target.querySelector('details')?.setAttribute('open', '');
        target.tabIndex = -1; target.focus({ preventScroll: true }); target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      };
      fragment.append(button); cursor = match.index + match[0].length;
    }
    if (cursor) { fragment.append(document.createTextNode(node.textContent.slice(cursor))); node.replaceWith(fragment); }
  }
}
export function sourceDetails(context, documents = []) {
  const box = document.createElement('details'); box.className = 'document-sources';
  const title = document.createElement('summary');
  title.textContent = context.mode === 'overview' ? '本次参考片段 · 分散抽样，未逐字阅读全文' : '本次参考片段 · 按问题检索';
  box.append(title);
  for (const source of context.sources) {
    const detail = document.createElement('details'), label = document.createElement('summary'), pre = document.createElement('pre');
    detail.dataset.citation = source.id;
    label.textContent = `[${source.id}] ${source.name} · ${source.location}`; pre.textContent = source.text;
    const note = document.createElement('p'); note.textContent = '回答当时参考的片段；引用不代表已核实结论。';
    detail.append(label, note, pre);
    const position = locateDocumentSource(source, documents);
    if (position) {
      const view = document.createElement('button'); view.type = 'button'; view.className = 'text-button'; view.textContent = '查看原文位置';
      view.onclick = () => {
        const dialog = document.createElement('dialog'); dialog.className = 'source-reader'; dialog.setAttribute('aria-label', '资料原文位置');
        const close = document.createElement('button'); close.type = 'button'; close.textContent = '关闭原文'; close.className = 'text-button'; close.onclick = () => dialog.close();
        const heading = document.createElement('h3'); heading.textContent = `${position.doc.name} · ${source.location}`;
        const info = document.createElement('p'); info.textContent = '当前保存的原文段落；高亮部分与回答时片段一致。其余内容可能已有修改。';
        const content = document.createElement('pre'), mark = document.createElement('mark'); mark.textContent = source.text;
        content.append(document.createTextNode(position.section.text.slice(0, position.offset)), mark,
          document.createTextNode(position.section.text.slice(position.offset + source.text.length)));
        const header = document.createElement('div'); header.className = 'source-reader-header'; header.append(close, heading);
        dialog.append(header, info, content); detail.append(dialog);
        dialog.addEventListener('close', () => { dialog.remove(); view.focus(); }, { once: true });
        dialog.showModal(); close.focus(); mark.scrollIntoView({ block: 'start' });
      };
      detail.append(view);
    } else { const warning = document.createElement('p'); warning.textContent = '原文未载入、已变动或旧引用无定位信息；仅显示回答时片段。'; detail.append(warning); }
    box.append(detail);
  }
  return box;
}
export function renderDocumentLibrary(conversation, busy, onChange) {
  let box = document.querySelector('#document-library');
  if (!box) { box = document.createElement('div'); box.id = 'document-library'; document.querySelector('#prompt-input').before(box); }
  box.replaceChildren();
  for (const doc of conversation?.documents || []) {
    const row = document.createElement('div'); row.className = 'document-library-row';
    const button = document.createElement('button'); button.type = 'button'; button.className = 'text-button';
    button.textContent = `${doc.enabled ? '☑' : '☐'} ${doc.name} · ${doc.sections.reduce((n, s) => n + s.text.length, 0).toLocaleString()} 字符`;
    button.disabled = busy; button.setAttribute('aria-pressed', String(doc.enabled)); button.title = '点击暂停或恢复下次提问的资料引用';
    button.onclick = () => { doc.enabled = !doc.enabled; onChange(); };
    const details = document.createElement('details'), summary = document.createElement('summary'), pre = document.createElement('pre');
    summary.textContent = '查看资料'; pre.textContent = doc.sections.map(s => `${s.label}\n${s.text}`).join('\n\n');
    const read=document.createElement('button');read.type='button';read.className='text-button';read.textContent='在阅读器中打开';read.onclick=()=>openDocumentReader(doc,{owner:conversation.title,returnFocus:read});
    const coverage = document.createElement('p'); coverage.className = 'ui-note'; coverage.textContent = pdfCoverage(doc.pdfInfo);
    details.append(summary, read, coverage, pre); row.append(button, details); box.append(row);
  }
  if (conversation?.documents?.length) {
    const note = document.createElement('small'); note.textContent = '勾选的资料用于本次提问；点击文件名可暂停引用。'+(getStorageScope()?'资料随此账户的私有聊天保存。':'新资料随聊天保存在此浏览器，公开共享需要明确操作。'); box.append(note);
  }
}
