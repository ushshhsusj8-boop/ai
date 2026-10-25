function waitForSlot(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
    const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

// Only retry the gateway's explicit pre-upstream concurrency rejection. Never
// retry an upstream error or a stream that may already have generated output.
export async function fetchQueuedChat(url, options, fetchImpl = fetch, wait = waitForSlot) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetchImpl(url, options);
    if (attempt >= 2 || response.status !== 503 || response.headers.get('x-yunjian-busy') !== '1') return response;
    await response.body?.cancel();
    await wait(2000, options.signal);
  }
}

// One queue is shared by interactive chats and batch tasks in this page.
export function createRequestQueue(initialLimit = 2) {
  let limit = initialLimit, active = 0;
  const waiting = [];
  function drain() {
    while (active < limit && waiting.length) {
      const job = waiting.shift();
      job.signal.removeEventListener('abort', job.abort);
      if (job.signal.aborted) { job.reject(new DOMException('Aborted', 'AbortError')); continue; }
      active++;
      let released = false;
      job.resolve(() => { if (released) return; released = true; active--; drain(); });
    }
  }
  return {
    setLimit(value) {
      if (!Number.isInteger(value) || value < 1 || value > 8) throw new Error('Invalid request concurrency');
      limit = value; drain();
    },
    acquire(signal) {
      return new Promise((resolve, reject) => {
        if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
        const job = { signal, resolve, reject, abort: () => {
          const index = waiting.indexOf(job); if (index >= 0) waiting.splice(index, 1);
          reject(new DOMException('Aborted', 'AbortError'));
        } };
        signal.addEventListener('abort', job.abort, { once: true }); waiting.push(job); drain();
      });
    },
  };
}
