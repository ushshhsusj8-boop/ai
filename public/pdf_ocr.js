import {abortError, abortable, checkAbort} from './pdf_parse.js';
export async function createPdfOcr(language, signal, progress) {
  checkAbort(signal);
  const worker = new Worker('/pdf_ocr_worker.js'), pending = new Map(); let sequence = 0, stopped = false;
  function terminate(error = abortError()) { if (stopped) return; stopped = true; worker.terminate(); signal?.removeEventListener('abort', cancel); for (const job of pending.values()) { clearTimeout(job.timer); job.reject(error); } pending.clear(); }
  const cancel = () => terminate(); signal?.addEventListener('abort', cancel, {once: true});
  worker.onmessage = ({data}) => {
    if (data.progress !== undefined) { progress(`OCR 本机识别 ${data.progress}%…`); return; }
    const job = pending.get(data.id); if (!job) return;
    if (data.error) { terminate(Error(data.error)); return; }
    clearTimeout(job.timer); pending.delete(data.id); job.resolve(data.text);
  };
  worker.onerror = e => { e.preventDefault(); terminate(Error('OCR 工作线程加载失败，请重试。')); };
  const request = (action, payload = {}, transfer = []) => new Promise((resolve, reject) => {
    if (stopped) return reject(abortError());
    const id = ++sequence, timer = setTimeout(() => terminate(Error('OCR 等待超过 90 秒，已停止；请减少页数或重试。')), 90000);
    pending.set(id, {resolve, reject, timer}); worker.postMessage({id, action, ...payload}, transfer);
  });
  try { await request('init', {language}); } catch (e) { terminate(e); throw e; }
  return {
    async recognize(canvas) {
      const blob = canvas instanceof Blob ? canvas : await abortable(new Promise(resolve => canvas.toBlob(resolve, 'image/png')), signal);
      if (!blob) throw Error('无法准备 OCR 页面图片。');
      const image = await abortable(blob.arrayBuffer(), signal); checkAbort(signal);
      return request('recognize', {image}, [image]);
    },
    terminate
  };
}
