import { scopedStorage } from './scoped_storage.js';
import { validateDocuments, validateDocumentContext } from './document_library.js';
import { validatePromptLibrary } from "./prompt_library.js";
import { validateImages } from './image_attachments.js';
import { normalizeContextSettings, validateModelFavorites } from "./conversation_tools.js";
import {validateBranch} from './conversation_branches.js';

const BACKUP_FORMAT = "yunjian-ai-local-backup";
const BACKUP_VERSION = 1;
const CONVERSATIONS_KEY = "yunjian-ai-conversations-v1";
const PRESETS_KEY = "yunjian-ai-presets-v1";
const CLOUD_PROMPTS_KEY = 'plaude-prompt-cloud-v1';
function cloudPrompts(storage){
  const raw=storage.getItem(CLOUD_PROMPTS_KEY);if(raw===null)return null;const value=JSON.parse(raw);
  if(value?.version!==1||!Number.isSafeInteger(value.revision)||value.revision<0)fail('本机提示词云缓存版本无效。');
  value.prompts=validatePromptLibrary(value.prompts);value.base=validatePromptLibrary(value.base);return value;
}
function backupPrompts(storage){return cloudPrompts(storage)?.prompts||readSaved(storage,PROMPTS_KEY,validatePromptLibrary);}
const PROMPTS_KEY = "yunjian-ai-prompt-library-v1";
const FAVORITES_KEY = "yunjian-ai-model-favorites-v1";
const MAX_BACKUP_BYTES = 64 * 1024 * 1024;
const MAX_CONVERSATIONS = 10_000;
const MAX_PRESETS = 20;
const MAX_MESSAGES = 10_000;
const MAX_MESSAGE_CHARS = 256000;
const MAX_INSTRUCTIONS_CHARS = 2000;
const MAX_SEARCH_SOURCES = 12;
const MAX_GROUNDED_HISTORY_AGE_MS = 2 * 365 * 24 * 60 * 60 * 1000;

function fail(message) {
  throw new Error(message);
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function knownFields(value, fields, label) {
  if (!plainObject(value) || Object.keys(value).some((key) => !fields.includes(key))) {
    fail(`${label}包含不支持的字段。`);
  }
}

function boundedText(value, maxLength, label, allowEmpty = false) {
  if (typeof value !== "string" || value.length > maxLength || (!allowEmpty && !value.trim())) {
    fail(`${label}格式不正确或长度超出限制。`);
  }
  return value;
}

function validateUsage(value) {
  if (value === undefined || value === null) return null;
  knownFields(value, ["inputTokens", "outputTokens", "totalTokens"], "用量");
  for (const field of ["inputTokens", "outputTokens", "totalTokens"]) {
    if (!Number.isSafeInteger(value[field]) || value[field] < 0) fail("用量数字无效。");
  }
  return {
    inputTokens: value.inputTokens,
    outputTokens: value.outputTokens,
    totalTokens: value.totalTokens,
  };
}

function validateParameters(value) {
  if (value === undefined) return {};
  knownFields(value, ["temperature", "top_p", "max_output_tokens"], "模型参数");
  if (value.temperature !== undefined && (typeof value.temperature !== "number"
    || !Number.isFinite(value.temperature) || value.temperature < 0 || value.temperature > 2)) {
    fail("随机度参数无效。");
  }
  if (value.top_p !== undefined && (typeof value.top_p !== "number"
    || !Number.isFinite(value.top_p) || value.top_p <= 0 || value.top_p > 1)) {
    fail("候选范围参数无效。");
  }
  if (value.max_output_tokens !== undefined && (!Number.isSafeInteger(value.max_output_tokens)
    || value.max_output_tokens < 1)) {
    fail("单次回复上限无效。");
  }
  return { ...value };
}

function validateContext(value) {
  if (value === undefined) return normalizeContextSettings();
  knownFields(value, ["historyTurns", "resetAt", "useMemory"], "上下文设置");
  if(value.useMemory!==undefined&&typeof value.useMemory!=='boolean')fail('记忆使用开关无效。');
  if (value.historyTurns !== undefined && value.historyTurns !== null
    && (!Number.isInteger(value.historyTurns) || value.historyTurns < 0 || value.historyTurns > 10)) {
    fail("携带的历史轮数无效。");
  }
  if (value.resetAt !== undefined && value.resetAt !== null
    && (!Number.isSafeInteger(value.resetAt) || value.resetAt < 0 || value.resetAt > Date.now())) {
    fail("上下文边界时间无效。");
  }
  return normalizeContextSettings(value);
}

export function validateSearch(value, label = '联网来源') {
  if (value === undefined) return null;
  knownFields(value, ["enabled", "used", "queries", "sources"], label);
  if (typeof value.enabled !== "boolean" || typeof value.used !== "boolean") {
    fail(`${label}的联网状态无效。`);
  }
  if (!Array.isArray(value.queries) || value.queries.length > 8) fail(`${label}的搜索词无效。`);
  const querySet = new Set();
  const queries = value.queries.map((query) => {
    const normalized = boundedText(query, 300, `${label}的搜索词`).replace(/\s+/g, " ").trim();
    if (querySet.has(normalized)) fail(`${label}包含重复搜索词。`);
    querySet.add(normalized);
    return normalized;
  });
  if (!Array.isArray(value.sources) || value.sources.length > MAX_SEARCH_SOURCES) {
    fail(`${label}的来源数量无效。`);
  }
  const sourceSet = new Set();
  const sources = value.sources.map((source) => {
    knownFields(source, ["title", "url", "excerpt"], `${label}的来源`);
    const title = boundedText(source.title, 240, `${label}的来源标题`);
    const rawUrl = boundedText(source.url, 2048, `${label}的来源地址`);
    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      fail(`${label}的来源地址无效。`);
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      fail(`${label}的来源地址无效。`);
    }
    const normalizedUrl = url.toString();
    if (sourceSet.has(normalizedUrl)) fail(`${label}包含重复来源。`);
    sourceSet.add(normalizedUrl);
    return { title, url: normalizedUrl, ...(source.excerpt !== undefined ? { excerpt: boundedText(source.excerpt, 900, `${label}的搜索摘录`, true) } : {}) };
  });
  return {
    enabled: value.enabled,
    used: value.used,
    queries,
    sources,
  };
}

function validateConversations(value) {
  if (!Array.isArray(value) || value.length > MAX_CONVERSATIONS) fail("对话数量超过单次导入上限，记录不会自动删除。");
  const seen = new Set();
  return value.map((item, index) => {
    const label = `第 ${index + 1} 条对话`;
    knownFields(item, ["id", "title", "titleEdited", "pinned", "archived", "provider", "model", "parameters", "context", "webSearch", "instructions", "updatedAt", "lastUsage", "messages", "documents", "branch", "projectLinked"], label);
    const id = boundedText(item.id, 128, `${label}的 ID`);
    const branch=validateBranch(item.branch,id);
    if(item.projectLinked!==undefined&&typeof item.projectLinked!=='boolean')fail('项目关联标记无效。');
    if (seen.has(id)) fail("备份中存在重复的对话 ID。");
    seen.add(id);
    const title = item.title === undefined ? "新对话" : boundedText(item.title, 60, `${label}的标题`, true);
    const titleEdited = item.titleEdited === undefined ? false : item.titleEdited;
    if (typeof titleEdited !== "boolean") fail(`${label}的标题状态无效。`);
    const pinned = item.pinned === undefined ? false : item.pinned;
    if (typeof pinned !== "boolean") fail(`${label}的置顶状态无效。`);
    const archived = item.archived === undefined ? false : item.archived;
    if (typeof archived !== "boolean") fail(`${label}的归档状态无效。`);
    const provider = item.provider === undefined ? "" : boundedText(item.provider, 64, `${label}的模型`, true);
    const model = item.model === undefined ? "" : boundedText(item.model, 192, `${label}的具体型号`, true);
    const parameters = validateParameters(item.parameters);
    const webSearch = item.webSearch === undefined ? false : item.webSearch;
    if (typeof webSearch !== "boolean") fail(`${label}的联网搜索状态无效。`);
    const instructions = item.instructions === undefined ? "" : boundedText(item.instructions, MAX_INSTRUCTIONS_CHARS, `${label}的回答方式`, true);
    const updatedAt = item.updatedAt === undefined ? Date.now() : item.updatedAt;
    if (!Number.isFinite(updatedAt) || updatedAt < 0) fail(`${label}的更新时间无效。`);
    if (!Array.isArray(item.messages) || (item.messages.length < 1 && !item.documents?.length&&!branch&&item.projectLinked!==true) || item.messages.length > MAX_MESSAGES) {
      fail(`${label}的消息数量超过单次导入上限，记录不会自动删除。`);
    }
    const messages = item.messages.map((message, messageIndex) => {
      knownFields(message, ["role", "content", "createdAt", "groundedAt", "search", "completion", "images", "documentContext"], `${label}的第 ${messageIndex + 1} 条消息`);
      if (message.completion !== undefined && (message.role !== 'assistant' || !['stopped', 'interrupted', 'length'].includes(message.completion))) fail(`${label}的回复完成状态无效。`);
      if (message.role !== "user" && message.role !== "assistant") fail(`${label}的消息角色无效。`);
      const createdAt = message.createdAt;
      if (createdAt !== undefined && (!Number.isSafeInteger(createdAt)
        || createdAt < 0 || createdAt > 8_640_000_000_000_000)) {
        fail(`${label}的消息时间无效。`);
      }
      const groundedAt = message.groundedAt;
      if (groundedAt !== undefined && (!Number.isSafeInteger(groundedAt)
        || groundedAt < 0 || groundedAt > Date.now()
        || Date.now() - groundedAt >= MAX_GROUNDED_HISTORY_AGE_MS)) {
        fail(`${label}的 Gemini 联网回答已超过可保存期限。`);
      }
      if (groundedAt !== undefined && (message.role !== "assistant" || provider !== "gemini")) {
        fail(`${label}的 Gemini 联网回答标记无效。`);
      }
      const search = validateSearch(message.search, `${label}的第 ${messageIndex + 1} 条消息`);
      const documentContext = validateDocumentContext(message.documentContext);
      if (documentContext && message.role !== 'assistant') fail('用户消息不能包含资料引用。');
      const images = validateImages(message.images, message.role);
      if (search && message.role !== "assistant") fail(`${label}的用户消息不能包含联网来源。`);
      if (search && provider === "gemini") fail(`${label}不能保存 Gemini 搜索建议或来源。`);
      return {
        role: message.role,
        ...(documentContext ? { documentContext } : {}),
        content: boundedText(message.content, MAX_MESSAGE_CHARS, `${label}的消息`),
        ...(images.length ? { images } : {}),
        ...(createdAt === undefined ? {} : { createdAt }),
        ...(groundedAt === undefined ? {} : { groundedAt }),
        ...(search ? { search } : {}),
        ...(message.completion ? { completion: message.completion } : {}),
      };
    });
    return { id, ...(branch?{branch}:{}),...(item.projectLinked===true?{projectLinked:true}:{}),title, titleEdited, pinned, archived, provider, model, parameters, documents: validateDocuments(item.documents), context: validateContext(item.context), webSearch, instructions, updatedAt, lastUsage: validateUsage(item.lastUsage), messages };
  });
}

function validatePresets(value) {
  if (!Array.isArray(value) || value.length > MAX_PRESETS) fail("自定义预设数量超出限制。最多保存 20 个。");
  const seen = new Set();
  return value.map((item, index) => {
    const label = `第 ${index + 1} 个预设`;
    knownFields(item, ["id", "name", "instructions"], label);
    if (typeof item.id !== "string" || !/^custom-[a-z0-9-]+$/i.test(item.id) || item.id.length > 128) {
      fail(`${label}的 ID 无效。`);
    }
    if (seen.has(item.id)) fail("备份中存在重复的预设 ID。");
    seen.add(item.id);
    return {
      id: item.id,
      name: boundedText(item.name, 40, `${label}的名称`).trim(),
      instructions: boundedText(item.instructions, MAX_INSTRUCTIONS_CHARS, `${label}的回答方式`).trim(),
    };
  });
}

function readSaved(storage, key, validate) {
  const raw = storage.getItem(key);
  if (raw === null) return [];
  try {
    return validate(JSON.parse(raw));
  } catch (error) {
    fail(`浏览器内已有数据无法读取：${error.message}`);
  }
}

export function createBackup(storage, now = new Date()) {
  const backup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    conversations: readSaved(storage, CONVERSATIONS_KEY, validateConversations),
    presets: readSaved(storage, PRESETS_KEY, validatePresets),
    prompts: backupPrompts(storage),
    favorites: readSaved(storage, FAVORITES_KEY, validateModelFavorites),
  };
  const json = JSON.stringify(backup, null, 2);
  if (new TextEncoder().encode(json).length > MAX_BACKUP_BYTES) fail("备份超过 64 MiB，无法导出。");
  return json;
}

export function planImport(text, storage) {
  if (typeof text !== "string" || new TextEncoder().encode(text).length > MAX_BACKUP_BYTES) {
    fail("备份文件超过 64 MiB 或无法读取。");
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail("所选文件不是有效的 JSON 备份。");
  }
  knownFields(parsed, ["format", "version", "exportedAt", "conversations", "presets", "prompts", "favorites"], "备份文件");
  if (parsed.format !== BACKUP_FORMAT || parsed.version !== BACKUP_VERSION) {
    fail("备份格式或版本不受支持。");
  }
  if (typeof parsed.exportedAt !== "string" || !Number.isFinite(Date.parse(parsed.exportedAt))) {
    fail("备份日期无效。");
  }
  const incomingConversations = validateConversations(parsed.conversations);
  const incomingPresets = validatePresets(parsed.presets);
  const incomingPrompts = validatePromptLibrary(parsed.prompts === undefined ? [] : parsed.prompts);
  const incomingFavorites = validateModelFavorites(parsed.favorites === undefined ? [] : parsed.favorites);
  const existingConversations = readSaved(storage, CONVERSATIONS_KEY, validateConversations);
  const existingPresets = readSaved(storage, PRESETS_KEY, validatePresets);
  const existingPrompts = backupPrompts(storage);
  const existingFavorites = readSaved(storage, FAVORITES_KEY, validateModelFavorites);
  const conversationIds = new Set(existingConversations.map((item) => item.id));
  const presetIds = new Set(existingPresets.map((item) => item.id));
  const promptIds = new Set(existingPrompts.map((item) => item.id));
  const newConversations = incomingConversations.filter((item) => !conversationIds.has(item.id));
  const newPresets = incomingPresets.filter((item) => !presetIds.has(item.id));
  const newPrompts = incomingPrompts.filter((item) => !promptIds.has(item.id));
  const favoriteKeys = new Set(existingFavorites.map(item => `${item.provider}\u0000${item.model}`));
  const newFavorites = incomingFavorites.filter(item => !favoriteKeys.has(`${item.provider}\u0000${item.model}`));
  if (existingConversations.length + newConversations.length > MAX_CONVERSATIONS) {
    fail("导入后对话超过单次导入上限，请拆分备份导入；已有记录保留。");
  }
  if (existingPresets.length + newPresets.length > MAX_PRESETS) {
    fail("导入后预设会超过 20 个，请先删除部分旧预设，再重试。");
  }
  if (existingPrompts.length + newPrompts.length > 30) {
    fail("导入后提示词会超过 30 条，请先删除部分旧提示词，再重试。");
  }
  if (existingFavorites.length + newFavorites.length > 80) fail("导入后模型收藏会超过 80 条，请先移除部分收藏。");
  return {
    conversations: [...existingConversations, ...newConversations].sort((a, b) => b.updatedAt - a.updatedAt),
    presets: [...existingPresets, ...newPresets],
    prompts: [...existingPrompts, ...newPrompts],
    favorites: [...existingFavorites, ...newFavorites],
    addedConversations: newConversations.length,
    addedPresets: newPresets.length,
    skippedConversations: incomingConversations.length - newConversations.length,
    skippedPresets: incomingPresets.length - newPresets.length,
    addedPrompts: newPrompts.length,
    skippedPrompts: incomingPrompts.length - newPrompts.length,
    addedFavorites: newFavorites.length,
    promptCloudBaseline:storage.getItem(CLOUD_PROMPTS_KEY),
  };
}

export function applyImport(plan, storage) {
  if(Object.hasOwn(plan,'promptCloudBaseline')&&plan.promptCloudBaseline!==storage.getItem(CLOUD_PROMPTS_KEY))fail('提示词库已在其他窗口更新，请重新预览导入。');
  const oldConversations = storage.getItem(CONVERSATIONS_KEY);
  const oldPresets = storage.getItem(PRESETS_KEY);
  const oldFavorites = storage.getItem(FAVORITES_KEY);
  const cloud=cloudPrompts(storage),promptKey=cloud?CLOUD_PROMPTS_KEY:PROMPTS_KEY,oldPromptValue=storage.getItem(promptKey);
  try {
    storage.setItem(CONVERSATIONS_KEY, JSON.stringify(plan.conversations));
    storage.setItem(PRESETS_KEY, JSON.stringify(plan.presets));
    storage.setItem(promptKey,JSON.stringify(cloud?{...cloud,prompts:validatePromptLibrary(plan.prompts||[])}:validatePromptLibrary(plan.prompts||[])));
    storage.setItem(FAVORITES_KEY, JSON.stringify(plan.favorites || []));
  } catch (error) {
    try {
      if (oldConversations === null) storage.removeItem(CONVERSATIONS_KEY);
      else storage.setItem(CONVERSATIONS_KEY, oldConversations);
      if (oldPresets === null) storage.removeItem(PRESETS_KEY);
      else storage.setItem(PRESETS_KEY, oldPresets);
      if (oldPromptValue === null) storage.removeItem(promptKey);
      else storage.setItem(promptKey, oldPromptValue);
      if (oldFavorites === null) storage.removeItem(FAVORITES_KEY);
      else storage.setItem(FAVORITES_KEY, oldFavorites);
    } catch { /* The browser may also block rollback when storage is full. */ }
    fail(`浏览器无法保存导入数据：${error.message}`);
  }
}

function initBackupDialog() {
  const dialog = document.querySelector("#backup-dialog");
  const open = document.querySelector("#open-backup");
  const close = document.querySelector("#close-backup");
  const exportButton = document.querySelector("#backup-export");
  const importButton = document.querySelector("#backup-import");
  const fileInput = document.querySelector("#backup-file");
  const status = document.querySelector("#backup-status");
  if (!dialog || !open || !close || !exportButton || !importButton || !fileInput || !status) return;
  open.addEventListener("click", () => { status.textContent = ""; dialog.showModal(); });
  close.addEventListener("click", () => dialog.close());
  fileInput.addEventListener("change", () => {
    status.textContent = fileInput.files?.[0] ? `已选择：${fileInput.files[0].name}` : "";
  });
  exportButton.addEventListener("click", () => {
    try {
      const json = createBackup(scopedStorage);
      const url = URL.createObjectURL(new Blob([json], { type: "application/json;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `plaude-chat-本地备份-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.textContent = "备份已下载。文件含对话内容，请妥善保管；不含网站访问口令。";
    } catch (error) {
      status.textContent = error.message;
    }
  });
  importButton.addEventListener("click", async () => {
    const file = fileInput.files?.[0];
    if (!file) { status.textContent = "请先选择 .json 备份文件。"; return; }
    if (!file.name.toLowerCase().endsWith(".json")) { status.textContent = "请选择 .json 备份文件。"; return; }
    if (file.size > MAX_BACKUP_BYTES) { status.textContent = "备份文件超过 64 MiB。"; return; }
    importButton.disabled = true;
    try {
      const text = await file.text();
      if (!window.dispatchEvent(new Event('plaude-before-backup-import', { cancelable: true }))) {
        throw Error('仍有对话正在生成、排队或同步云端，请等待任务完成后再导入；也可先停止生成。当前聊天和备份文件均保留。');
      }
      const plan = planImport(text, scopedStorage);
      applyImport(plan, scopedStorage);
      window.dispatchEvent(new Event('plaude-backup-imported'));
      status.textContent = `已导入 ${plan.addedConversations} 条对话、${plan.addedPresets} 个预设、${plan.addedPrompts} 条提示词、${plan.addedFavorites} 个模型收藏；重复的已有记录会保留。页面即将刷新。`;
      setTimeout(() => location.reload(), 1000);
    } catch (error) {
      status.textContent = error.message;
      importButton.disabled = false;
    }
  });
}

if (typeof document !== "undefined") {
  const { accountReady } = await import("./account.js");
  await accountReady;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initBackupDialog);
  else initBackupDialog();
}
