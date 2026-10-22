export function normalizeContextSettings(value) {
  return {
    historyTurns: Number.isInteger(value?.historyTurns) && value.historyTurns >= 0 && value.historyTurns <= 10
      ? value.historyTurns : null,
    resetAt: Number.isSafeInteger(value?.resetAt) && value.resetAt >= 0 && value.resetAt <= Date.now()
      ? value.resetAt : null,
    ...(value?.useMemory===false?{useMemory:false}:{}),
    ...(value?.usePersonalInstructions===false?{usePersonalInstructions:false}:{}),
  };
}

// Keep the current question and complete historical question/answer pairs.
// A context reset changes what is sent, without deleting the visible history.
export function buildChatContext(messages, settings, { maxMessages = 24, maxChars = 22000 } = {}) {
  const context = normalizeContextSettings(settings);
  let latestIndex = messages.length - 1;
  while (latestIndex >= 0 && messages[latestIndex]?.role !== "user") latestIndex -= 1;
  if (latestIndex < 0) return { messages: [], historyTurns: 0 };
  const latest = messages[latestIndex];
  if (typeof latest.content !== "string" || latest.content.length > maxChars) {
    throw new Error("当前问题超过上下文长度上限，请缩短后再发送。");
  }
  const selected = [{ role: "user", content: latest.content, ...(latest.images?.length ? { images: latest.images } : {}) }];
  let imageCount = latest.images?.length || 0;
  let remaining = maxChars - latest.content.length;
  let turns = 0; const indices = [latestIndex], reasons = new Set();
  const afterReset = message => context.resetAt === null
    || (Number.isSafeInteger(message?.createdAt) && message.createdAt > context.resetAt);
  for (let index = latestIndex - 1; index > 0; index -= 1) {
    if (context.historyTurns !== null && turns >= context.historyTurns) { reasons.add('轮数设定'); break; }
    const answer = messages[index];
    const question = messages[index - 1];
    if (answer?.role !== "assistant" || question?.role !== "user"
      || typeof question.content !== "string" || typeof answer.content !== "string") { reasons.add('未成对消息'); continue; }
    if (!afterReset(question) || !afterReset(answer)) { reasons.add('上下文边界'); break; }
    const length = question.content.length + answer.content.length;
    if (imageCount + (question.images?.length || 0) > 8) { reasons.add('图片上限'); break; }
    if (selected.length + 2 > maxMessages) { reasons.add('消息条数上限'); break; }
    if (length > remaining) { reasons.add('字符预算'); break; }
    selected.unshift({ role: "user", content: question.content, ...(question.images?.length ? { images: question.images } : {}) }, { role: "assistant", content: answer.content });
    imageCount += question.images?.length || 0;
    indices.unshift(index - 1, index);
    remaining -= length;
    turns += 1;
    index -= 1;
  }
  return { messages: selected, historyTurns: turns, selection: {indices, latestIndex, omittedMessages: latestIndex - turns * 2, reasons: [...reasons], messageChars: maxChars - remaining, imageCount} };
}

export function findConversationMessages(messages, query, role = "all") {
  const value = String(query || "").trim().slice(0, 200);
  if (!value) return [];
  const pattern = new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
  return messages.flatMap((message, index) => {
    if (!message || typeof message.content !== "string"
      || !["user", "assistant"].includes(message.role)
      || (role !== "all" && role !== message.role)) return [];
    const matches = [...message.content.matchAll(pattern)];
    if (!matches.length) return [];
    const first = matches[0];
    const start = Math.max(0, first.index - 45);
    const end = Math.min(message.content.length, first.index + first[0].length + 100);
    return [{
      index, role: message.role, count: matches.length,
      before: `${start ? "…" : ""}${message.content.slice(start, first.index)}`,
      match: first[0],
      after: `${message.content.slice(first.index + first[0].length, end)}${end < message.content.length ? "…" : ""}`,
    }];
  });
}

export function speechChunks(content) {
  const text = String(content || "")
    .replace(/```[^\n]*\n/g, "").replace(/```/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/[*_`~]/g, "").trim();
  return text.match(/[^。！？.!?\n]{1,180}[。！？.!?\n]?/gu) || [];
}

export function filterModelOptions(models, query) {
  const terms = String(query || "").trim().toLowerCase().slice(0, 200).split(/\s+/).filter(Boolean);
  return models.filter(model => terms.every(term => `${model.label || ""} ${model.id}`.toLowerCase().includes(term)));
}

export function validateModelFavorites(value) {
  if (!Array.isArray(value) || value.length > 80) throw new Error("模型收藏最多保存 80 条。");
  const seen = new Set();
  return value.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)
      || Object.keys(item).some(key => !["provider", "model"].includes(key))
      || typeof item.provider !== "string" || !/^[a-z][a-z0-9_-]{0,40}$/.test(item.provider)
      || typeof item.model !== "string" || !/^[~A-Za-z0-9][A-Za-z0-9._~:/+-]{0,191}$/.test(item.model)
      || item.model.includes("://")) throw new Error("模型收藏格式无效。");
    const key = `${item.provider}\u0000${item.model}`;
    if (seen.has(key)) throw new Error("模型收藏包含重复记录。");
    seen.add(key);
    return { provider: item.provider, model: item.model };
  });
}
