export const PROMPT_LIBRARY_KEY = "yunjian-ai-prompt-library-v1";
export const MAX_PROMPTS = 30;
export const MAX_PROMPT_TITLE_CHARS = 50;
export const MAX_PROMPT_CONTENT_CHARS = 6000;

const EXPORT_FORMAT = "yunjian-ai-prompt-library";
const EXPORT_VERSION = 1;
const MAX_IMPORT_BYTES = 512 * 1024;
const PROMPT_FIELDS = ["id", "title", "content", "createdAt", "updatedAt"];

function fail(message) {
  throw new Error(message);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireKnownFields(value, fields, label) {
  if (!isPlainObject(value) || Object.keys(value).some((field) => !fields.includes(field))) {
    fail(`${label}包含不支持的字段。`);
  }
}

function promptId(value, label) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9_-]{0,127}$/i.test(value)) {
    fail(`${label}的 ID 无效。`);
  }
  return value;
}

function boundedText(value, maximum, label) {
  if (typeof value !== "string") fail(`${label}必须是文字。`);
  const result = value.trim();
  if (!result) fail(`${label}不能为空。`);
  if (Array.from(result).length > maximum) fail(`${label}最多支持 ${maximum} 个字符。`);
  return result;
}

function timestamp(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${label}无效。`);
  return value;
}

function validatePrompt(value, index) {
  const label = `第 ${index + 1} 条常用提示词`;
  requireKnownFields(value, PROMPT_FIELDS, label);
  const createdAt = timestamp(value.createdAt, `${label}的创建时间`);
  const updatedAt = timestamp(value.updatedAt, `${label}的更新时间`);
  if (updatedAt < createdAt) fail(`${label}的更新时间不能早于创建时间。`);
  return {
    id: promptId(value.id, label),
    title: boundedText(value.title, MAX_PROMPT_TITLE_CHARS, `${label}的标题`),
    content: boundedText(value.content, MAX_PROMPT_CONTENT_CHARS, `${label}的内容`),
    createdAt,
    updatedAt,
  };
}

/** Validate and clone a complete prompt library. */
export function validatePromptLibrary(value) {
  if (!Array.isArray(value)) fail("常用提示词数据必须是列表。");
  if (value.length > MAX_PROMPTS) fail(`常用提示词最多保存 ${MAX_PROMPTS} 条。`);
  const seen = new Set();
  return value.map((item, index) => {
    const prompt = validatePrompt(item, index);
    if (seen.has(prompt.id)) fail("常用提示词中存在重复的 ID。");
    seen.add(prompt.id);
    return prompt;
  });
}

export function loadPromptLibrary(storage) {
  if (!storage || typeof storage.getItem !== "function") fail("浏览器存储不可用。");
  const raw = storage.getItem(PROMPT_LIBRARY_KEY);
  if (raw === null) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail("浏览器内的常用提示词数据不是有效的 JSON。");
  }
  try {
    return validatePromptLibrary(parsed);
  } catch (error) {
    fail(`浏览器内的常用提示词无法读取：${error.message}`);
  }
}

export function savePromptLibrary(storage, prompts) {
  if (!storage || typeof storage.setItem !== "function") fail("浏览器存储不可用。");
  const validated = validatePromptLibrary(prompts);
  try {
    storage.setItem(PROMPT_LIBRARY_KEY, JSON.stringify(validated));
  } catch (error) {
    fail(`浏览器无法保存常用提示词：${error.message}`);
  }
  return validated;
}

function generatedId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return `prompt-${globalThis.crypto.randomUUID()}`;
  }
  return `prompt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function operationTime(value, label = "操作时间") {
  return timestamp(value === undefined ? Date.now() : value, label);
}

/** Return a new list containing the created prompt. The input list is not changed. */
export function createPrompt(prompts, draft, options = {}) {
  const current = validatePromptLibrary(prompts);
  if (current.length >= MAX_PROMPTS) fail(`常用提示词最多保存 ${MAX_PROMPTS} 条。`);
  requireKnownFields(draft, ["title", "content"], "新提示词");
  requireKnownFields(options, ["id", "now"], "创建选项");
  const now = operationTime(options.now, "创建时间");
  const id = promptId(options.id === undefined ? generatedId() : options.id, "新提示词");
  if (current.some((item) => item.id === id)) fail("常用提示词 ID 已存在。");
  const created = validatePrompt({
    id,
    title: draft.title,
    content: draft.content,
    createdAt: now,
    updatedAt: now,
  }, current.length);
  return [...current, created];
}

/** Update title and/or content and return a new list. */
export function updatePrompt(prompts, id, changes, options = {}) {
  const current = validatePromptLibrary(prompts);
  const targetId = promptId(id, "待修改提示词");
  requireKnownFields(changes, ["title", "content"], "修改内容");
  if (!("title" in changes) && !("content" in changes)) fail("没有可保存的修改。");
  requireKnownFields(options, ["now"], "修改选项");
  const index = current.findIndex((item) => item.id === targetId);
  if (index < 0) fail("找不到要修改的常用提示词。");
  const now = operationTime(options.now, "更新时间");
  if (now < current[index].updatedAt) fail("更新时间不能早于上次修改时间。");
  const replacement = validatePrompt({
    ...current[index],
    ...changes,
    updatedAt: now,
  }, index);
  return current.map((item, itemIndex) => itemIndex === index ? replacement : item);
}

export function deletePrompt(prompts, id) {
  const current = validatePromptLibrary(prompts);
  const targetId = promptId(id, "待删除提示词");
  if (!current.some((item) => item.id === targetId)) fail("找不到要删除的常用提示词。");
  return current.filter((item) => item.id !== targetId);
}

/** Order modes: recent, oldest, title. */
export function orderPrompts(prompts, order = "recent") {
  const current = validatePromptLibrary(prompts);
  if (!["recent", "oldest", "title"].includes(order)) fail("不支持这种提示词排序方式。");
  return current.sort((left, right) => {
    if (order === "title") {
      const titleOrder = left.title.localeCompare(right.title, "zh-CN", { sensitivity: "base", numeric: true });
      return titleOrder || right.updatedAt - left.updatedAt || left.id.localeCompare(right.id);
    }
    const timeOrder = order === "oldest"
      ? left.updatedAt - right.updatedAt
      : right.updatedAt - left.updatedAt;
    return timeOrder || left.title.localeCompare(right.title, "zh-CN", { sensitivity: "base" }) || left.id.localeCompare(right.id);
  });
}

export function searchPrompts(prompts, query, order = "recent") {
  if (typeof query !== "string") fail("搜索内容必须是文字。");
  const needle = query.trim().toLocaleLowerCase("zh-CN");
  const ordered = orderPrompts(prompts, order);
  if (!needle) return ordered;
  return ordered.filter((item) => `${item.title}\n${item.content}`.toLocaleLowerCase("zh-CN").includes(needle));
}

export function exportPromptLibrary(prompts, now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(date.getTime())) fail("导出日期无效。");
  return JSON.stringify({
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: date.toISOString(),
    prompts: validatePromptLibrary(prompts),
  }, null, 2);
}

/** Parse an exported file and merge only IDs that are not already present. */
export function planPromptImport(text, existingPrompts = []) {
  if (typeof text !== "string" || new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) {
    fail("提示词文件超过 512 KiB 或无法读取。");
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    fail("所选文件不是有效的 JSON 提示词文件。");
  }
  requireKnownFields(value, ["format", "version", "exportedAt", "prompts"], "提示词文件");
  if (value.format !== EXPORT_FORMAT || value.version !== EXPORT_VERSION) fail("提示词文件格式或版本不受支持。");
  if (typeof value.exportedAt !== "string" || !Number.isFinite(Date.parse(value.exportedAt))) fail("提示词文件日期无效。");
  const existing = validatePromptLibrary(existingPrompts);
  const incoming = validatePromptLibrary(value.prompts);
  const ids = new Set(existing.map((item) => item.id));
  const added = incoming.filter((item) => !ids.has(item.id));
  if (existing.length + added.length > MAX_PROMPTS) {
    fail(`导入后常用提示词会超过 ${MAX_PROMPTS} 条，请先删除部分旧内容。`);
  }
  return {
    prompts: [...existing, ...added],
    added: added.length,
    skipped: incoming.length - added.length,
  };
}
