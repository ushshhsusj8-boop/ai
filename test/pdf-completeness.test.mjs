import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readPdf, ocrViewport, MAX_OCR_PIXELS} from '../public/pdf_parse.js';
import {pdfCoverage, pageRanges, validatePdfInfo} from '../public/pdf_coverage.js';
import {validateDocuments} from '../public/document_library.js';
import {retrieveDocuments} from '../src/document_retrieval.mjs';
import {validateProjects} from '../public/projects.js';
const fixture = texts => ({numPages: texts.length, getPage: async n => ({getTextContent: async () => ({items: [{str: texts[n - 1]}]}), cleanup() {}})});
test('mixed PDF retains actual page numbers and records omitted scanned/blank pages', async () => {
  const result = await readPdf(fixture(['start', '', '', 'last']), {choosePages: async ({missing}) => {assert.deepEqual(missing, [2, 3]); return [];}});
  assert.deepEqual(result.sections.map(s => s.label), ['第 1 页', '第 4 页']);
  assert.deepEqual(result.pdfInfo.states, ['text', 'unread', 'unread', 'text']);
  assert.match(pdfCoverage(result.pdfInfo), /第 2–3 页.*不能视为全文/);
  assert.equal(pageRanges([1, 2, 4, 7, 8, 9]), '1–2、4、7–9');
});
test('OCR is explicitly selected, ordered by original page; empty OCR stays visibly missing', async () => {
  let calls = [];
  const result = await readPdf(fixture(['', '', '']), {choosePages: async () => [3, 1], recognizePage: async (_, n) => {calls.push(n); return n === 1 ? 'scan BLUE7392' : '';}});
  assert.deepEqual(calls, [1, 3]); assert.equal(result.sections[0].label, '第 1 页');
  assert.deepEqual(result.pdfInfo.states, ['ocr', 'unread', 'no_text']);
  assert.match(pdfCoverage(result.pdfInfo), /OCR 1 页.*未读取文字 2 页.*OCR 可能识别错误/);
  await assert.rejects(readPdf(fixture(['']), {choosePages: async () => []}), /没有提取到文字/);
  await assert.rejects(readPdf(fixture(['']), {choosePages: async () => [1], recognizePage: async () => ''}), /没有提取到文字/);
});
test('page/selection/character limits reject before returning a truncated document', async () => {
  await assert.rejects(readPdf(fixture(Array(201).fill('text'))), /200 页/);
  for (const selected of [[1, 1], [0], Array.from({length: 21}, (_, n) => n + 1)]) await assert.rejects(readPdf(fixture(Array(21).fill('')), {choosePages: async () => selected}), /最多 20 页/);
  await assert.rejects(readPdf(fixture(['a'.repeat(120001)])), /12 万字符/);
  await assert.rejects(readPdf(fixture(['text', '']), {choosePages: async () => [2], recognizePage: async () => 'a'.repeat(120000)}), /12 万字符/);
});
test('cancel while choosing or recognizing rejects without delivering partially parsed data', async () => {
  for (const stage of ['choose', 'recognize']) {
    const controller = new AbortController(); let started;
    const ready = new Promise(r => started = r), pending = () => {started(); return new Promise(() => {});};
    const task = readPdf(fixture(['old', '']), {signal: controller.signal, choosePages: stage === 'choose' ? pending : async () => [2], recognizePage: pending});
    await ready; controller.abort(); await assert.rejects(task, {name: 'AbortError'});
  }
  await assert.rejects(readPdf(fixture(['old', '']), {choosePages: async () => [2], recognizePage: async () => {throw Error('OCR failed');}}), /OCR failed/);
});
test('rendered OCR page dimensions are bounded, including extreme aspect ratios', () => {
  for (const [width, height] of [[612, 792], [1e8, 1e8], [1e8, 1]]) {
    const page = {getViewport: ({scale}) => ({width: width * scale, height: height * scale})}, v = ocrViewport(page);
    assert.ok(Math.ceil(v.width) * Math.ceil(v.height) <= MAX_OCR_PIXELS);
    assert.ok(v.width <= 4096 && v.height <= 4096);
  }
  assert.throws(() => ocrViewport({getViewport: () => ({width: Infinity, height: 100})}), /尺寸无效/);
});
test('coverage validation survives project snapshots and rejects false page claims', async () => {
  const result = await readPdf(fixture(['first', '', 'last']));
  const doc = {id: 'pdf-test-document', name: 'mixed.pdf', enabled: true, sections: result.sections, pdfInfo: result.pdfInfo};
  assert.deepEqual(validateDocuments([doc])[0], doc);
  assert.deepEqual(validateProjects({version: 1, projects: [{id: 'pdf-test-project', name: 'PDF QA', instructions: '', revision: 0, documents: [doc]}], links: []}).projects[0].documents[0], doc);
  for (const info of [{...doc.pdfInfo, states: ['text']}, {...doc.pdfInfo, states: ['text', 'text', 'text']}, {...doc.pdfInfo, states: ['text', 'invalid', 'text']}]) assert.throws(() => validateDocuments([{...doc, pdfInfo: info}]), /状态|页码/);
  assert.equal(validatePdfInfo(undefined), undefined);
  assert.ok(!Object.hasOwn(validateDocuments([{...doc, pdfInfo: undefined}])[0], 'pdfInfo'));
});
test('retrieval warns of missing pages and OCR errors within its context budget', () => {
  const doc = {id: 'pdf-test-document', name: 'mixed.pdf', sections: [{label: '第 2 页', text: 'scan keyword '.repeat(300)}], pdfInfo: {version: 1, totalPages: 3, states: ['unread', 'ocr', 'no_text']}};
  const result = retrieveDocuments([doc], 'keyword', 2200);
  assert.match(result.text, /未读取文字 2 页.*不能视为全文.*OCR 可能识别错误/);
  assert.equal(result.context.sources[0].location, '第 2 页'); assert.ok(result.text.length <= 2200);
});

