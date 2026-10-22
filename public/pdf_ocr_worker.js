/* Dedicated supervisor: terminating it also stops its dedicated OCR child worker. */
importScripts('/vendor/tesseract.js');
let worker;
self.onmessage = async ({data: {id, action, language, image}}) => {
  try {
    if (action === 'init') {
      if (!['eng', 'chi_sim', 'chi_sim+eng'].includes(language)) throw Error('请选择中文或英文 OCR。');
      worker = await Tesseract.createWorker(language, 1, {workerPath: '/vendor/ocr/worker.min.js', corePath: '/vendor/ocr/core', langPath: '/vendor/ocr/lang', workerBlobURL: false,
        logger: m => self.postMessage({progress: Math.round((m.progress || 0) * 100)}), errorHandler: () => self.postMessage({id, error: 'OCR 组件加载或识别失败，请重试。'})});
      self.postMessage({id, text: ''});
    } else if (action === 'recognize' && worker) self.postMessage({id, text: (await worker.recognize(image)).data.text});
    else throw Error('OCR 尚未准备好。');
  } catch { self.postMessage({id, error: 'OCR 组件加载或识别失败，请重试。'}); }
};
