import { readFileSync, existsSync } from 'node:fs';
const fixed = new Map([
  ['/vendor/pdf.mjs', ['pdfjs-dist/legacy/build/pdf.mjs', 'text/javascript']],
  ['/vendor/pdf.worker.mjs', ['pdfjs-dist/legacy/build/pdf.worker.mjs', 'text/javascript']],
  ['/vendor/mammoth.js', ['mammoth/mammoth.browser.min.js', 'text/javascript']],
  ['/vendor/tesseract.js', ['tesseract.js/dist/tesseract.min.js', 'text/javascript']],
  ['/vendor/ocr/worker.min.js', ['tesseract.js/dist/worker.min.js', 'text/javascript']],
  ['/vendor/ocr/lang/eng.traineddata.gz', ['@tesseract.js-data/eng/4.0.0/eng.traineddata.gz', 'application/octet-stream']],
  ['/vendor/ocr/lang/chi_sim.traineddata.gz', ['@tesseract.js-data/chi_sim/4.0.0/chi_sim.traineddata.gz', 'application/octet-stream']],
]);
export function documentAsset(path) {
  const math=path.match(/^\/vendor\/katex\/(katex\.min\.(?:js|css)|fonts\/KaTeX_[A-Za-z0-9_-]+\.woff2)$/);
  if(math){const file=new URL('../public/vendor/katex/'+math[1],import.meta.url);if(!existsSync(file))return undefined;
    return{body:readFileSync(file),contentType:math[1].endsWith('.js')?'text/javascript; charset=utf-8':math[1].endsWith('.css')?'text/css; charset=utf-8':'font/woff2'};}
  let entry = fixed.get(path);
  const core = path.match(/^\/vendor\/ocr\/core\/(tesseract-core(?:-(?:simd|relaxedsimd))?(?:-lstm)?\.wasm(?:\.js)?)$/);
  if (core) entry = [`tesseract.js-core/${core[1]}`, core[1].endsWith('.js') ? 'text/javascript' : 'application/wasm'];
  const font = path.match(/^\/vendor\/pdf-fonts\/([A-Za-z0-9_-]+\.(?:pfb|ttf))$/);
  if (font) entry = [`pdfjs-dist/standard_fonts/${font[1]}`, 'application/octet-stream'];
  if (!entry) return undefined;
  const file = new URL(`../node_modules/${entry[0]}`, import.meta.url);
  if (!existsSync(file)) return undefined;
  return { body: readFileSync(file), contentType: entry[1] };
}
