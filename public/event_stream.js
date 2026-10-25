import {getLimits} from './site_limits.js';
// Shared by the browser and upstream adapters; handles split UTF-8 and SSE frames.
export async function* readEventStream(body) {
  if (!body) throw new Error('响应没有可读取的数据流。');
  const reader = body.getReader(), decoder = new TextDecoder();
  let buffer = '', received = 0, skipLF = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      received += value?.byteLength || 0;
      if (received > getLimits().streamBytes) throw new Error('数据流超过本次请求的大小限制。');
      let text = decoder.decode(value, { stream: !done });
      if (text.length) {
        // CR ends a line immediately; suppress its optional LF across byte chunks.
        if (skipLF && text[0] === '\n') text = text.slice(1);
        skipLF = text.endsWith('\r');
        buffer += text.replace(/\r\n|\r/g, '\n');
      }
      let separator;
      while ((separator = /\r\n\r\n|\n\n|\r\r/.exec(buffer))) {
        const frame = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator[0].length);
        if (frame.length > getLimits().eventBytes) throw new Error('数据流事件过大。');
        let event = 'message'; const data = [];
        for (const line of frame.split(/\r\n|\n|\r/)) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
        }
        if (data.length) yield { event, data: data.join('\n') };
      }
      if (buffer.length > getLimits().eventBytes) throw new Error('数据流事件过大。');
      if (done) break;
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function readChatStream(response, onDelta, onStatus = () => {}) {
  for await (const event of readEventStream(response.body)) {
    const value = JSON.parse(event.data);
    if (event.event === 'delta' && typeof value.text === 'string') onDelta(value.text);
    else if (event.event === 'status') onStatus(value.message);
    else if (event.event === 'error') {
      const error = new Error(value.error || '回复生成中断。'); error.status = value.status; throw error;
    } else if (event.event === 'done') return value;
  }
  throw new Error('连接提前结束，已收到的文字已保留，可重新生成。');
}
