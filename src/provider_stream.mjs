import {getLimits} from '../public/site_limits.js';
import { readEventStream } from '../public/event_stream.js';

export async function collectProviderStream(body, protocol, onDelta) {
  let text = '', usage, finishReason, completed = false, finalResponse;
  const append = delta => {
    if (typeof delta !== 'string' || !delta) return;
    if (text.length + delta.length > getLimits().replyChars) throw new Error('Upstream output too large');
    text += delta; onDelta(delta);
  };
  for await (const frame of readEventStream(body)) {
    if (frame.data === '[DONE]') { completed = true; break; }
    const data = JSON.parse(frame.data);
    if (data.error || data.type === 'error' || data.type === 'response.failed') {
      const error = new Error('Upstream streaming request failed');
      error.statusCode = Number(data.error?.code) === 429 ? 429 : 502; throw error;
    }
    if (protocol === 'responses') {
      if (data.type === 'response.output_text.delta' || data.type === 'response.refusal.delta') append(data.delta);
      if (['response.completed', 'response.incomplete'].includes(data.type)) {
        finalResponse = data.response || {}; completed = true; break;
      }
    } else {
      const choice = data.choices?.find(item => item.index === 0) || data.choices?.[0];
      append(choice?.delta?.content);
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      if (data.usage) usage = data.usage;
    }
  }
  if (!completed && !finishReason) throw new Error('Upstream stream ended before completion');
  return protocol === 'responses'
    ? { ...finalResponse, output_text: finalResponse?.output_text || text }
    : { choices: [{ message: { content: text }, finish_reason: finishReason || 'stop' }], usage };
}
