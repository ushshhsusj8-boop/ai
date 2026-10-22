export function parseModelParameterJson(source, capabilities = {}) {
  let value;
  try { value = JSON.parse(source); } catch { throw Error('JSON 格式不正确，请检查引号、逗号和括号。'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('参数必须是 JSON 对象。');
  const limits = { temperature: [0, 2], top_p: [0.01, 1],
    max_output_tokens: [capabilities.max_output_tokens?.min || 1, capabilities.max_output_tokens?.max] };
  for (const [name, number] of Object.entries(value)) {
    if (!Object.hasOwn(limits, name)) throw Error(`不支持参数 ${name}，可编辑 temperature、top_p、max_output_tokens。`);
    if (!capabilities[name]) throw Error(`当前模型不支持 ${name}。`);
    const [min, max] = limits[name];
    if (typeof number !== 'number' || !Number.isFinite(number) || number < min || (max !== undefined && number > max)
      || (name === 'max_output_tokens' && !Number.isSafeInteger(number))) throw Error(max === undefined
        ? `${name} 必须是不小于 ${min} 的安全整数。`
        : `${name} 必须是 ${min}–${max} 之间的${name === 'max_output_tokens' ? '整数' : '数字'}。`);
  }
  return value;
}

export function previewDocument(source) {
  // Keep the downloaded source intact; previews cannot run scripts, load remote
  // resources, submit forms, or refresh/navigate via source meta tags.
  const markup = String(source).replace(/<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi, '');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; connect-src 'none'; img-src 'none'; media-src 'none'; font-src 'none'; frame-src 'none'; child-src 'none'; object-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'; style-src 'unsafe-inline'"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${markup}</body></html>`;
}

export function messageDetails(message, conversation = {}) {
  return { role: message.role, content: message.content,
    ...(Number.isSafeInteger(message.createdAt) ? { createdAt: new Date(message.createdAt).toISOString() } : {}),
    provider: conversation.provider || '', model: conversation.model || '',
    characters: Array.from(message.content || '').length };
}

export function appendDraftText(current, addition, limit = 12000) {
  const next = current + (current.trim() ? '\n\n' : '') + addition;
  if (next.length > limit) throw Error(`内容超过 ${limit} 字，请缩短文件文字后再插入。`);
  return next;
}
