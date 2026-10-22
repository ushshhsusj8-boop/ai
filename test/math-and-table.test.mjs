import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {documentAsset} from '../src/document_assets.mjs';
const window={};
for(const name of ['math_display.js','table_export.js'])runInNewContext(readFileSync(new URL('../public/'+name,import.meta.url),'utf8'),{window});
const math=window.plaudeMath;
test('formulas keep escaped currency, inline code and link destinations intact',()=>{
  const text='价格 $20 和 $30，转义 \\$x\\$，代码 ` $x^2$ `，链接 [价格](https://example.com/$x$)。';
  assert.equal(math.segments(text).filter(p=>p.math).length,0);
});
test('inline and display formulas retain source and do not consume surrounding text',()=>{
  const parts=math.segments(String.raw`前文 \(a_1+b^2\) 后文 $$\frac{1}{2}$$，$x^2$。`);
  assert.equal(parts.filter(p=>p.math).length,3);
  assert.equal(parts.filter(p=>p.math&&p.display).length,1);
  assert.equal(parts.map(p=>p.raw||p.text).join(''),String.raw`前文 \(a_1+b^2\) 后文 $$\frac{1}{2}$$，$x^2$。`);
});
test('multiline display math preserves blank lines and ignores unclosed blocks',()=>{
  const block=math.blockAt(['$$','a = \\frac{1}{2}','','+ b','$$','后文'],0);
  assert.equal(block.end,4);assert.match(block.part.text,/\n\n/);
  assert.equal(math.blockAt(['$$','unclosed'],0),null);
});
test('math assets use an explicit same-origin allowlist',()=>{
  assert.equal(documentAsset('/vendor/katex/katex.min.js').contentType,'text/javascript; charset=utf-8');
  assert.equal(documentAsset('/vendor/katex/fonts/KaTeX_Main-Regular.woff2').contentType,'font/woff2');
  for(const path of ['/vendor/katex/../../secrets/workspace-master.key','/vendor/katex/LICENSE','/vendor/katex/fonts/unknown.woff2'])assert.equal(documentAsset(path),undefined);
});
test('CSV preserves Unicode, quotes, commas and line breaks and rejects spreadsheet execution',()=>{
  const csv=window.plaudeTableExport.tableCsv([['中文','a,b','"quote"','两\n行'],['=1+1',' \t@SUM(1)','-7','+cmd','普通值']]);
  assert.ok(csv.startsWith('\ufeff'));assert.ok(csv.endsWith('\r\n'));
  assert.match(csv,/"a,b","""quote""","两\n行"/);
  assert.ok(csv.includes('"\'=1+1"'));assert.ok(csv.includes('"\' \t@SUM(1)"'));assert.ok(csv.includes('"普通值"'));
});
