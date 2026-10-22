import { buildChatContext } from './conversation_tools.js';

// Both the draft preview and the real request use this preparation step.
export function prepareChatContext(messages, settings, {
  instructions = '', documents = [], maxInputChars = 24000,
  maxMessages = 24, historyBudget = 22000, memoryChars = 0, memoryCount = 0,
} = {}) {
  if (!Number.isInteger(maxInputChars) || maxInputChars < 1000 || maxInputChars > 200000) {
    throw Error('本站上下文限制无效，请重新连接。');
  }
  instructions = typeof instructions === 'string' ? instructions.trim() : '';
  if (instructions.length > 2000) throw Error('项目和对话指令合计超过2000字符，请缩短。');
  if(!Number.isSafeInteger(memoryChars)||memoryChars<0||memoryChars>4000)throw Error('记忆预算无效。');
  const documentCount = documents.filter(d => d.enabled !== false).length;
  const latest = [...messages].reverse().find(m => m?.role === 'user');
  const questionChars = latest?.content?.length || 0;
  const documentReserve = documentCount
    ? Math.min(8000, Math.max(500, maxInputChars - instructions.length - memoryChars - questionChars)) : 0;
  const messageBudget = Math.min(historyBudget, maxInputChars - instructions.length - memoryChars - documentReserve);
  if (questionChars > messageBudget) {
    throw Error(documentCount
      ? '当前问题太长，无法同时给资料引用预留空间；请缩短问题或暂停资料引用，草稿仍保留。'
      : '当前问题超过本站字符预算，请缩短后再发送，草稿仍保留。');
  }
  const result = buildChatContext(messages, settings, { maxMessages, maxChars: messageBudget });
  const selection = result.selection || {
    indices: [], omittedMessages: 0, reasons: [], messageChars: 0, imageCount: 0,
  };
  return {
    messages: result.messages,
    report: {
      ...selection, historyTurns: result.historyTurns, instructionChars: instructions.length,
      documentCount, documentReserve, messageBudget, inputLimit: maxInputChars, memoryChars, memoryCount,
    },
  };
}

function historicalRanges(indices) {
  const ranges = [];
  for (const index of indices) {
    const last = ranges.at(-1);
    if (last && index === last[1] + 1) last[1] = index;
    else ranges.push([index, index]);
  }
  return ranges.map(([start, end]) => start === end ? `${start + 1}` : `${start + 1}–${end + 1}`).join('、');
}

export function formatContextReport(report) {
  const prior = report.indices.slice(0, -1);
  const range = prior.length ? `历史第 ${historicalRanges(prior)} 条` : '没有历史消息';
  const reasons = report.reasons.length ? `，原因：${report.reasons.join('、')}` : '';
  return `携带 ${report.historyTurns} 轮历史（${range}），省略 ${report.omittedMessages} 条历史${reasons}。当前问题另计；原消息仍保留。\n`
    + `消息文字 ${report.messageChars}/${report.messageBudget} 字符，指令 ${report.instructionChars} 字符，图片 ${report.imageCount}/8。本站总输入上限 ${report.inputLimit} 字符。\n`
    + (report.memoryChars ? `长期记忆 ${report.memoryCount} 条，占 ${report.memoryChars} 字符；可在长期记忆面板查看内容。\n` : '')
    + (report.documentCount ? `启用 ${report.documentCount} 份资料，给引用片段至少预留 ${report.documentReserve} 字符；实际片段由服务器检索选择。\n` : '')
    + '这是本站文字范围与字符预算，不是模型token用量或计费预估；图片、模型内部格式及联网结果没有换算成token。';
}
