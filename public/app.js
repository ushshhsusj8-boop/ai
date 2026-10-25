import {initSiteAdministration} from './site_administration.js';
import {getLimits,withStoredLimits,MAXIMUM_LIMITS} from './site_limits.js';
import { initProjectWorkspace } from './project_workspace.js';
import { initExecutionConsole } from './execution_console.js';
import { initVoiceComposer } from './voice_composer.js';
import { validateDocuments, validateDocumentContext, renderDocumentLibrary, sourceDetails, wireCitationLinks } from './document_library.js';
import { initMobileLayout } from './mobile_layout.js';
import { initAccessibility, trapSidebarTab } from './accessibility.js';
import { accountUser, accountHeaders, initAccountUI, identityChanged } from './account.js';
import { scopedStorage, globalStorage } from './scoped_storage.js';
import { createPrivateSync } from './private_sync.js';
import { initModernUI } from './modern_ui.js';
import { initHistoryMenu, preserveHistoryFocus } from './history_menu.js';
import {branchOrigin,validateBranch} from './conversation_branches.js';
import {initBranchNavigation} from './branch_navigation.js';
import { createPromptSync } from './prompt_sync.js';
import { initWritingDesk } from './writing_desk.js';
import { historyBucket,historyPage } from './ui_state.js';
import {prepareChatContext,formatContextReport} from './context_budget.js';
import {initAccountMemory} from './account_memory.js';
import {initPersonalInstructions} from './personal_instructions.js';
import {initPrivateShares} from './private_shares.js';
"use strict";

import {chatSelectionProblem} from './connection_tools.js';
import {initModelConnections} from './model_connections.js';
import { initWorkspace, workspacePreferences } from "./workspace.js";
import { initWorkbench } from "./workbench.js";
import { appendDraftText } from "./workbench_tools.js";
import { readChatStream } from "./event_stream.js";
import { validateImages } from './image_attachments.js';
import { initVisionComposer, imageGallery } from './vision_composer.js';
import { createRequestQueue, fetchQueuedChat } from './request_queue.js';
const requestQueue = createRequestQueue(2);

let projects;
let branchNavigation;
let workspace;
let workbench;
let visionComposer;
let voiceComposer;
let accountMemory;
let personalInstructions;
let privateShares;
let privateSync;
let accountUI;
let modernUI;
let writingDesk;
let promptSync;

import { normalizeContextSettings, findConversationMessages, speechChunks, filterModelOptions, validateModelFavorites } from "./conversation_tools.js";

const STORAGE_KEY = "yunjian-ai-conversations-v1";
const TOKEN_KEY = "yunjian-ai-gateway-token";
const FONT_KEY = "yunjian-ai-font-v1";
const PRESETS_KEY = "yunjian-ai-presets-v1";
const DRAFTS_KEY = "yunjian-ai-drafts-v1";
const SHARED_EDIT_KEYS_KEY = "yunjian-ai-shared-edit-keys-v1";
const SHARED_AUTHOR_KEY = "yunjian-ai-shared-author-v1";
const MODEL_FAVORITES_KEY = "yunjian-ai-model-favorites-v1";
const MAX_INSTRUCTIONS_CHARS = getLimits().instructionChars;
const MAX_CUSTOM_PRESETS = getLimits().customPresets;
const BUILTIN_PRESETS = [
  { id: "default", name: "默认回答", instructions: "" },
  { id: "concise", name: "简洁清楚", instructions: "请用简洁、准确的中文回答。先给结论，再列出必要步骤；不确定时明确说明。" },
  { id: "writing", name: "写作搭档", instructions: "你是中文写作搭档。先确认用途、读者和语气；给出自然、具体的草稿，并指出可修改之处。" },
  { id: "coding", name: "编程助手", instructions: "你是编程助手。优先给可执行的排查步骤和最小改动，说明关键假设，并给出验证方法。" },
  { id: "learning", name: "学习讲解", instructions: "用循序渐进的方式讲解。先给直观例子，再解释关键概念，并用一两个问题帮助检查理解。" },
];
const FONT_CHOICES = ["default", "system", "serif"];
const FONT_LABELS = { default: "默认", system: "系统", serif: "衬线" };
const MAX_STORED_MESSAGE_CHARS = getLimits().maxInputChars;
const API_MESSAGE_LIMIT = getLimits().maxMessages;
const API_CHAR_BUDGET = getLimits().historyChars;
const MAX_SEARCH_SOURCES = getLimits().searchSources;
const MAX_SEARCH_SUGGESTIONS_CHARS = 50000;
const MAX_GROUNDED_HISTORY_AGE_MS = 2 * 365 * 24 * 60 * 60 * 1000;
const mobileSidebarMedia = window.matchMedia("(max-width: 760px), (max-width: 1024px) and (max-height: 500px)");

const elements = {
  body: document.body,
  mainPanel: document.querySelector(".main-panel"),
  sidebar: document.querySelector("#sidebar"),
  sidebarBackdrop: document.querySelector("#sidebar-backdrop"),
  menuButton: document.querySelector("#menu-button"),
  workspaceMenuButton: document.querySelector("#workspace-menu-button"),
  workspaceMenu: document.querySelector("#workspace-menu"),
  webSearchToggle: document.querySelector("#web-search-toggle"),
  webSearchStatus: document.querySelector("#web-search-status"),
  openPromptLibrary: document.querySelector("#open-prompt-library"),
  openConversationSearch: document.querySelector("#open-conversation-search"),
  conversationSearchDialog: document.querySelector("#conversation-search-dialog"),
  closeConversationSearch: document.querySelector("#close-conversation-search"),
  conversationSearchInput: document.querySelector("#conversation-search-input"),
  conversationSearchRole: document.querySelector("#conversation-search-role"),
  conversationSearchStatus: document.querySelector("#conversation-search-status"),
  conversationSearchResults: document.querySelector("#conversation-search-results"),
  openContextSettings: document.querySelector("#open-context-settings"),
  contextSettingsDialog: document.querySelector("#context-settings-dialog"),
  closeContextSettings: document.querySelector("#close-context-settings"),
  contextHistoryTurns: document.querySelector("#context-history-turns"),
  contextSettingsStatus: document.querySelector("#context-settings-status"),
  resetChatContext: document.querySelector("#reset-chat-context"),
  restoreChatContext: document.querySelector("#restore-chat-context"),
  saveContextSettings: document.querySelector("#save-context-settings"),
  contextSummary: document.querySelector("#context-summary"),
  openParallelTasks: document.querySelector("#open-parallel-tasks"),
  parallelTasksDialog: document.querySelector("#parallel-tasks-dialog"),
  closeParallelTasks: document.querySelector("#close-parallel-tasks"),
  parallelTaskInput: document.querySelector("#parallel-task-input"),
  parallelTaskSummary: document.querySelector("#parallel-task-summary"),
  parallelTaskResults: document.querySelector("#parallel-task-results"),
  clearParallelTasks: document.querySelector("#clear-parallel-tasks"),
  startParallelTasks: document.querySelector("#start-parallel-tasks"),
  promptLibraryDialog: document.querySelector("#prompt-library-dialog"),
  closePromptLibrary: document.querySelector("#close-prompt-library"),
  promptLibrarySearch: document.querySelector("#prompt-library-search"),
  promptLibraryOrder: document.querySelector("#prompt-library-order"),
  promptLibraryList: document.querySelector("#prompt-library-list"),
  libraryPromptTitle: document.querySelector("#library-prompt-title"),
  libraryPromptContent: document.querySelector("#library-prompt-content"),
  newLibraryPrompt: document.querySelector("#new-library-prompt"),
  saveLibraryPrompt: document.querySelector("#save-library-prompt"),
  deleteLibraryPrompt: document.querySelector("#delete-library-prompt"),
  insertLibraryPrompt: document.querySelector("#insert-library-prompt"),
  exportPromptLibrary: document.querySelector("#export-prompt-library"),
  importPromptLibraryFile: document.querySelector("#import-prompt-library-file"),
  promptLibraryStatus: document.querySelector("#prompt-library-status"),
  sidebarClose: document.querySelector("#sidebar-close"),
  newChat: document.querySelector("#new-chat"),
  clearHistory: document.querySelector("#clear-history"),
  historyActiveFilter: document.querySelector("#history-active-filter"),
  historyArchivedFilter: document.querySelector("#history-archived-filter"),
  historyList: document.querySelector("#history-list"),
  historyHeadingTitle: document.querySelector("#history-heading-title"),
  exportChat: document.querySelector("#export-chat"),
  archiveChat: document.querySelector("#archive-chat"),
  archiveChatLabel: document.querySelector("#archive-chat-label"),
  fontToggle: document.querySelector("#font-toggle"),
  fontToggleLabel: document.querySelector("#font-toggle-label"),
  historySearch: document.querySelector("#history-search"),
  currentChatTitle: document.querySelector("#current-chat-title"),
  deleteCurrentChat: document.querySelector("#delete-current-chat"),
  usageSummary: document.querySelector("#usage-summary"),
  providerSelect: document.querySelector("#provider-select"),
  modelIdSelect: document.querySelector("#model-id-select"),
  openModelPicker: document.querySelector("#open-model-picker"),
  openModelDirectory: document.querySelector("#open-model-directory"),
  modelPickerDialog: document.querySelector("#model-picker-dialog"),
  closeModelPicker: document.querySelector("#close-model-picker"),
  modelPickerInput: document.querySelector("#model-picker-input"),
  modelPickerProvider: document.querySelector("#model-picker-provider"),
  modelPickerFavorites: document.querySelector("#model-picker-favorites"),
  modelPickerStatus: document.querySelector("#model-picker-status"),
  modelPickerResults: document.querySelector("#model-picker-results"),
  openModelParameters: document.querySelector("#open-model-parameters"),
  modelParametersDialog: document.querySelector("#model-parameters-dialog"),
  closeModelParameters: document.querySelector("#close-model-parameters"),
  saveModelParameters: document.querySelector("#save-model-parameters"),
  resetModelParameters: document.querySelector("#reset-model-parameters"),
  parameterTemperatureEnabled: document.querySelector("#parameter-temperature-enabled"),
  parameterTemperature: document.querySelector("#parameter-temperature"),
  parameterTopPEnabled: document.querySelector("#parameter-top-p-enabled"),
  parameterTopP: document.querySelector("#parameter-top-p"),
  parameterMaxOutputEnabled: document.querySelector("#parameter-max-output-enabled"),
  parameterMaxOutput: document.querySelector("#parameter-max-output"),
  parameterMaxOutputMaximum: document.querySelector("#parameter-max-output-maximum"),
  parameterMaxOutputHint: document.querySelector("#parameter-max-output-hint"),
  temperatureRow: document.querySelector("#temperature-row"),
  topPRow: document.querySelector("#top-p-row"),
  maxOutputRow: document.querySelector("#max-output-row"),
  parameterHelp: document.querySelector("#parameter-help"),
  modelNote: document.querySelector("#model-note"),
  conversation: document.querySelector("#conversation"),
  jumpLatest: document.querySelector("#jump-latest"),
  welcome: document.querySelector("#welcome"),
  messages: document.querySelector("#messages"),
  composer: document.querySelector("#composer"),
  promptInput: document.querySelector("#prompt-input"),
  textFileInput: document.querySelector("#text-file-input"),
  attachTextButton: document.querySelector("#attach-text-button"),
  sendButton: document.querySelector("#send-button"),
  sendIcon: document.querySelector("#send-icon"),
  statusDot: document.querySelector("#status-dot"),
  serviceStatus: document.querySelector("#service-status"),
  serviceDetail: document.querySelector("#service-detail"),
  retryConnection: document.querySelector("#retry-connection"),
  liveStatus: document.querySelector("#live-status"),
  toast: document.querySelector("#toast"),
  settingsDialog: document.querySelector("#settings-dialog"),
  settingsDescription: document.querySelector("#settings-description"),
  settingsForm: document.querySelector("#settings-form"),
  openSettings: document.querySelector("#open-settings"),
  gatewayToken: document.querySelector("#gateway-token"),
  removeToken: document.querySelector("#remove-token"),
  saveToken: document.querySelector("#save-token"),
  apiDialog: document.querySelector("#api-dialog"),
  openApiAccess: document.querySelector("#open-api-access"),
  openSharedConversations: document.querySelector("#open-shared-conversations"),
  sharedConversationsDialog: document.querySelector("#shared-conversations-dialog"),
  closeSharedConversations: document.querySelector("#close-shared-conversations"),
  sharedAuthorName: document.querySelector("#shared-author-name"),
  refreshSharedConversations: document.querySelector("#refresh-shared-conversations"),
  publishCurrentConversation: document.querySelector("#publish-current-conversation"),
  publishAllConversations: document.querySelector("#publish-all-conversations"),
  sharedConversationsStatus: document.querySelector("#shared-conversations-status"),
  sharedConversationsList: document.querySelector("#shared-conversations-list"),
  closeApiAccess: document.querySelector("#close-api-access"),
  apiBaseUrl: document.querySelector("#api-base-url"),
  copyApiBaseUrl: document.querySelector("#copy-api-base-url"),
  apiModelId: document.querySelector("#api-model-id"),
  copyApiModelId: document.querySelector("#copy-api-model-id"),
  apiKeyHelp: document.querySelector("#api-key-help"),
  openInstructions: document.querySelector("#open-instructions"),
  instructionsEntryLabel: document.querySelector("#instructions-entry-label"),
  instructionsDialog: document.querySelector("#instructions-dialog"),
  closeInstructions: document.querySelector("#close-instructions"),
  presetSelect: document.querySelector("#preset-select"),
  instructionsInput: document.querySelector("#instructions-input"),
  presetName: document.querySelector("#preset-name"),
  savePreset: document.querySelector("#save-preset"),
  deletePreset: document.querySelector("#delete-preset"),
  updatePreset: document.querySelector("#update-preset"),
  applyInstructions: document.querySelector("#apply-instructions"),
  suggestions: [...document.querySelectorAll("[data-prompt]")],
};

const state = {
  providers: [],
  contextLimits: {maxInputChars:getLimits().maxInputChars,maxMessages:getLimits().maxMessages},
  contextReports: new Map(),
  defaultProvider: "",
  conversations: loadConversations(),
  customPresets: loadCustomPresets(),
  drafts: loadDrafts(),
  promptLibrary: [],
  promptLibraryModule: null,
  selectedPromptId: "",
  activeId: "",
  get busy() { return this.backgroundRequests.has(this.activeId); },
  pendingRequests: new Map(),
  draftBranchId: "",
  get requestController() { return this.backgroundRequests.get(this.activeId); },
  toastTimer: 0,
  historyMode: "active",
  historyLimit:100,historyViewKey:'',
  features: { sharedConversations: false, parallelTasks: true },
  sharedConversations: [],
  sharedEditKeys: loadSharedEditKeys(),
  sharedIds: new Set(),
  sharedFingerprints: new Map(),
  sharedSyncRunning: false,
  sharedSyncAgain: false,
  sharedSaveFailed: false,
  backgroundRequests: new Map(),
  regeneratingIds: new Set(),
  branchingIds: new Set(),
  backupImportPending: false,
  parallelTasks: new Map(),
  parallelBatchRunning: false,
  speechMessage: null,
  speechGeneration: 0,
  modelFavorites: loadModelFavorites(),
};

function validUsage(value) {
  if (!value || typeof value !== "object") return null;
  const { inputTokens, outputTokens, totalTokens } = value;
  if (![inputTokens, outputTokens, totalTokens].every((number) =>
    Number.isSafeInteger(number) && number >= 0
  )) return null;
  return { inputTokens, outputTokens, totalTokens };
}

function validMessageTime(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000;
}

function validGroundedTime(value, now = Date.now()) {
  return validMessageTime(value) && value <= now && now - value < MAX_GROUNDED_HISTORY_AGE_MS;
}

function safeSourceUrl(value) {
  if (typeof value !== "string" || value.length > 2048) return "";
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function validSearchResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || typeof value.enabled !== "boolean" || typeof value.used !== "boolean") return null;
  const sources = [];
  const sourceUrls = new Set();
  if (Array.isArray(value.sources)) {
    for (const item of value.sources) {
      const url = safeSourceUrl(item?.url);
      if (!url || sourceUrls.has(url)) continue;
      const title = typeof item?.title === "string"
        ? item.title.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
          .replace(/\s+/g, " ").trim().slice(0, 240) : "";
      sources.push({ title: title || new URL(url).hostname, url, ...(typeof item.excerpt === 'string' ? { excerpt: item.excerpt.slice(0, 900) } : {}) });
      sourceUrls.add(url);
      if (sources.length >= getLimits().searchSources) break;
    }
  }
  const queries = [];
  const querySet = new Set();
  if (Array.isArray(value.queries)) {
    for (const item of value.queries) {
      if (typeof item !== "string") continue;
      const query = item.replace(/\s+/g, " ").trim().slice(0, 300);
      if (!query || querySet.has(query)) continue;
      queries.push(query);
      querySet.add(query);
      if (queries.length >= getLimits().searchQueries) break;
    }
  }
  const suggestionsHtml = typeof value.suggestionsHtml === "string"
    && value.suggestionsHtml.length <= MAX_SEARCH_SUGGESTIONS_CHARS
    ? value.suggestionsHtml : undefined;
  return {
    enabled: value.enabled,
    used: value.used,
    queries,
    sources,
    ...(suggestionsHtml ? { suggestionsHtml } : {}),
  };
}

function validParameters(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  if (typeof value.temperature === "number" && Number.isFinite(value.temperature)
    && value.temperature >= 0 && value.temperature <= 2) result.temperature = value.temperature;
  if (typeof value.top_p === "number" && Number.isFinite(value.top_p)
    && value.top_p > 0 && value.top_p <= 1) result.top_p = value.top_p;
  if (Number.isSafeInteger(value.max_output_tokens) && value.max_output_tokens >= 1) {
    result.max_output_tokens = value.max_output_tokens;
  }
  return result;
}

function parameterCapabilities(provider, modelId = elements.modelIdSelect?.value) {
  const model = modelsFor(provider).find((item) => item.id === modelId);
  return model?.parameters || provider?.parameters || {};
}

function parametersForProvider(provider, value, modelId = elements.modelIdSelect?.value) {
  const parameters = validParameters(value);
  const capabilities = parameterCapabilities(provider, modelId);
  const result = {};
  if (capabilities.temperature === true && parameters.temperature !== undefined) {
    result.temperature = parameters.temperature;
  }
  if (capabilities.top_p === true && parameters.top_p !== undefined) {
    result.top_p = parameters.top_p;
  }
  const bounds = capabilities.max_output_tokens;
  if (bounds && parameters.max_output_tokens >= (bounds.min || 1)
    && (bounds.max === undefined || parameters.max_output_tokens <= bounds.max)) {
    result.max_output_tokens = parameters.max_output_tokens;
  }
  return result;
}

function createConversationId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (globalThis.crypto?.getRandomValues) {
    const values = new Uint32Array(4);
    globalThis.crypto.getRandomValues(values);
    return [...values].map((value) => value.toString(16).padStart(8, "0")).join("-");
  }
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function setWorkspaceMenu(open, focusFirst = false) {
  if (!elements.workspaceMenu || !elements.workspaceMenuButton) return;
  elements.workspaceMenu.hidden = !open;
  elements.workspaceMenuButton.setAttribute("aria-expanded", String(open));
  if (open && focusFirst) {
    elements.workspaceMenu.querySelector("input:not(:disabled), button:not(:disabled)")?.focus();
  }
}

function loadConversations(...args){return withStoredLimits(()=>loadConversationsStored(...args));}
function loadConversationsStored(storage = scopedStorage) {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.id === "string" && Array.isArray(item.messages))
      .map((item) => ({
        id: item.id,
        ...(item.branch?{branch:validateBranch(item.branch,item.id)}:{}),
        title: typeof item.title === "string" ? item.title.slice(0, 60) : "新对话",
        titleEdited: item.titleEdited === true,
        pinned: item.pinned === true,
        projectLinked: item.projectLinked === true,
        archived: item.archived === true,
        provider: typeof item.provider === "string" ? item.provider : "",
        model: typeof item.model === "string" ? item.model.slice(0, 192) : "",
        parameters: validParameters(item.parameters),
        context: normalizeContextSettings(item.context),
        documents: validateDocuments(item.documents),
        webSearch: item.webSearch === true,
        instructions: typeof item.instructions === "string"
          ? item.instructions.trim().slice(0, getLimits().instructionChars) : "",
        updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : Date.now(),
        lastUsage: validUsage(item.lastUsage),
        messages: item.messages
          .filter((message) =>
            message
            && (message.role === "user" || message.role === "assistant")
            && typeof message.content === "string"
            && message.content.trim()
            && (message.groundedAt === undefined || validGroundedTime(message.groundedAt))
          )
          .map((message) => ({
            role: message.role,
            content: message.content,
            ...(message.documentContext ? { documentContext: validateDocumentContext(message.documentContext) } : {}),
            ...(message.images?.length ? { images: validateImages(message.images, message.role) } : {}),
            ...(['stopped', 'interrupted', 'length'].includes(message.completion) ? { completion: message.completion } : {}),
            ...(validMessageTime(message.createdAt)
              ? { createdAt: message.createdAt } : {}),
            ...(validGroundedTime(message.groundedAt)
              ? { groundedAt: message.groundedAt } : {}),
            ...(item.provider !== "gemini" && validSearchResult(message.search)
              ? { search: validSearchResult(message.search) } : {}),
          })),
      }));
  } catch {
    return [];
  }
}

function loadModelFavorites() {
  try {
    return validateModelFavorites(JSON.parse(scopedStorage.getItem(MODEL_FAVORITES_KEY) || "[]"));
  } catch { return []; }
}

function isFavoriteModel(provider, model) {
  return state.modelFavorites.some(item => item.provider === provider && item.model === model);
}

function toggleFavoriteModel(provider, model) {
  if (isFavoriteModel(provider, model)) {
    state.modelFavorites = state.modelFavorites.filter(item => item.provider !== provider || item.model !== model);
  } else {
    if (state.modelFavorites.length >= 80) { showToast("最多收藏 80 个模型，请先移除一些收藏。"); return; }
    state.modelFavorites.push({ provider, model });
  }
  try { scopedStorage.setItem(MODEL_FAVORITES_KEY, JSON.stringify(state.modelFavorites)); }
  catch { showToast("本次收藏已更新，但浏览器无法长期保存。"); }
  renderModelPicker();
}

function loadCustomPresets() {
  try {
    const parsed = JSON.parse(scopedStorage.getItem(PRESETS_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    const seen = new Set();
    return parsed.filter((item) => {
      if (!item || typeof item.id !== "string" || !/^custom-[a-z0-9-]+$/i.test(item.id)
        || typeof item.name !== "string" || typeof item.instructions !== "string") return false;
      if (!item.name.trim() || item.name.length > 40 || !item.instructions.trim()
        || item.instructions.length > getLimits().instructionChars || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    }).slice(0, getLimits().customPresets).map((item) => ({
      id: item.id, name: item.name.trim(), instructions: item.instructions.trim(),
    }));
  } catch {
    return [];
  }
}

function loadDrafts(...args){return withStoredLimits(()=>loadDraftsStored(...args));}
function loadDraftsStored() {
  try {
    const parsed = JSON.parse(scopedStorage.getItem(DRAFTS_KEY) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed)
      .filter(([id, content]) => typeof id === "string" && id.length <= 128
        && typeof content === "string" && content.length <= getLimits().promptChars && content.trim())
      .slice(-getLimits().draftCount));
  } catch {
    return {};
  }
}

function loadSharedEditKeys() {
  try {
    const parsed = JSON.parse(scopedStorage.getItem(SHARED_EDIT_KEYS_KEY) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([id, key]) =>
      /^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/.test(id)
      && typeof key === "string" && key.length >= 32 && key.length <= 160
    ));
  } catch {
    return {};
  }
}

function persistSharedEditKeys() {
  try {
    scopedStorage.setItem(SHARED_EDIT_KEYS_KEY, JSON.stringify(state.sharedEditKeys));
  } catch {
    showToast("浏览器无法保存公共对话的编辑权限。");
  }
}

function createEditKey() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function activeBackgroundRequest() {
  return state.backgroundRequests.get(state.activeId);
}

function draftKey(conversation) {
  if (!conversation) return "";
  return conversation.messages.length === 0 && !conversation.documents?.length && !conversation.projectLinked&&!conversation.branch ? "new-conversation" : conversation.id;
}

function hasConversationContent(conversation) {
  return Boolean(conversation && (conversation.messages.length || conversation.documents?.length
    || conversation.projectLinked || conversation.branch));
}

function persistDrafts() {
  try {
    const entries = Object.entries(state.drafts).filter(([, content]) => content.trim());
    scopedStorage.setItem(DRAFTS_KEY, JSON.stringify(Object.fromEntries(entries)));
    return true;
  } catch {
    // Draft saving is best-effort; the current textarea remains usable.
    return false;
  }
}

function saveDraft(conversation = activeConversation(), content = elements.promptInput.value) {
  const key = draftKey(conversation);
  if (!key) return !content.trim();
  // Lowering policy must never truncate or evict an already saved draft.
  const entries = Object.entries(state.drafts).filter(([id]) => id !== key);
  if(content.length>MAXIMUM_LIMITS.promptChars)return false;
  if(content.trim()){
    if(!Object.hasOwn(state.drafts,key)&&entries.length>=getLimits().draftCount){
      if(state.draftSaveWarning!==key)showToast(`已达到${getLimits().draftCount}份草稿预算，旧草稿保留。当前文字尚未自动保存，请先复制保留或清理不再需要的草稿。`);
      state.draftSaveWarning=key;return false;
    }
    entries.push([key,content]);
  }
  state.draftSaveWarning=null;
  state.drafts = Object.fromEntries(entries);
  return persistDrafts();
}

function clearDraft(conversation = activeConversation()) {
  const key = draftKey(conversation);
  if (key && Object.hasOwn(state.drafts, key)) {
    delete state.drafts[key];
    persistDrafts();
  }
}

function restoreDraft(conversation = activeConversation(), fallback = "") {
  voiceComposer?.cancel();
  const key = draftKey(conversation);
  elements.promptInput.value = Object.hasOwn(state.drafts, key) ? state.drafts[key] : fallback;
  resizeTextarea();
  updateSendState();
}

function saveConversations(scheduleSync = true) {
  const saved = state.conversations
    .filter((conversation) => (conversation.messages.length > 0 || conversation.documents?.length || conversation.projectLinked||conversation.branch) && conversation.id !== state.draftBranchId)
    .sort((a, b) =>
      Number(b.id === state.activeId) - Number(a.id === state.activeId)
      || Number(b.pinned) - Number(a.pinned)
      || b.updatedAt - a.updatedAt
    );
  const activeDraft = state.conversations.find((conversation) =>
    conversation.id === state.activeId
      && ((conversation.messages.length === 0 && !conversation.documents?.length && !conversation.projectLinked&&!conversation.branch) || conversation.id === state.draftBranchId)
  );
  state.conversations = activeDraft ? [activeDraft, ...saved] : saved;
  try {
    const serializable = saved.map((conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) => {
        const search = conversation.provider === "gemini"
          ? null : validSearchResult(message.search);
        const storedSearch = search ? {
          enabled: search.enabled,
          used: search.used,
          queries: search.queries,
          sources: search.sources,
        } : null;
        return {
          role: message.role,
          content: message.content,
          ...(message.documentContext ? { documentContext: validateDocumentContext(message.documentContext) } : {}),
          ...(message.images?.length ? { images: message.images } : {}),
          ...(['stopped', 'interrupted', 'length'].includes(message.completion) ? { completion: message.completion } : {}),
          ...(validMessageTime(message.createdAt) ? { createdAt: message.createdAt } : {}),
          ...(validGroundedTime(message.groundedAt) ? { groundedAt: message.groundedAt } : {}),
          ...(storedSearch ? { search: storedSearch } : {}),
        };
      }),
    }));
    scopedStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
  } catch {
    showToast("浏览器缓存已满，正在尝试保存到后端；请确认服务仍在运行。");
  }
  if (accountUser && scheduleSync) void privateSync?.sync();
}

function activeConversation() {
  return state.conversations.find((item) => item.id === state.activeId);
}

function selectedProvider() {
  return state.providers.find((item) => item.id === elements.providerSelect.value);
}

function selectedModelSupportsImages() {
  return modelsFor(selectedProvider()).find(model => model.id === elements.modelIdSelect.value)?.vision === true;
}

function providerSupportsWebSearch(provider) {
  return provider?.capabilities?.webSearch === true;
}

function modelNoteText(provider, modelId) {
  if (!modelId) return "密钥仅在后端";
  if (provider?.modelCatalog?.dynamic) {
    return provider.modelCatalog.loaded
      ? `${modelId} · 已同步 ${provider.modelCatalog.count} 个型号 · 密钥仅在后端`
      : `${modelId} · 在线型号目录暂不可用 · 密钥仅在后端`;
  }
  return `${modelId} · 密钥仅在后端`;
}

function syncWebSearchControl(conversation = activeConversation()) {
  if (!elements.webSearchToggle || !elements.webSearchStatus) return;
  const provider = selectedProvider();
  const supported = providerSupportsWebSearch(provider);
  const enabled = supported && conversation?.webSearch === true;
  elements.webSearchToggle.checked = enabled;
  elements.webSearchToggle.disabled = state.busy || Boolean(activeBackgroundRequest()) || !supported;
  let status;
  if (!provider) {
    status = "等待后端连接";
  } else if (!supported) {
    status = "请配置独立搜索引擎，或使用支持内置搜索的服务商";
  } else if (enabled) {
    status = provider.capabilities?.searchEngine && provider.capabilities.searchEngine !== "builtin" ? `已开启 ${provider.capabilities.searchEngine === "tavily" ? "Tavily" : "SearXNG"} 搜索` : provider.id === "gemini" ? "已开启 Google Search；会产生额外用量"
      : provider.id === "openrouter" ? "已开启 OpenRouter 联网搜索；会产生额外费用"
        : "已开启 Web Search；会产生额外用量";
  } else {
    status = "当前服务商支持，按需开启";
  }
  elements.webSearchStatus.textContent = status;
  elements.webSearchStatus.title = status;
  elements.webSearchToggle.title = status;
}

function modelsFor(provider) {
  if (!provider) return [];
  if (Array.isArray(provider.models) && provider.models.length) {
    return provider.models.filter((model) => typeof model?.id === "string" && model.id);
  }
  return provider.model ? [{ id: provider.model, label: provider.model }] : [];
}

function syncModelOptions(conversation = activeConversation()) {
  // A deleted personal endpoint must not inherit another conversation's selection.
  for(const option of [...elements.providerSelect.options])if(option.dataset.unavailablePersonal&&option.value!==conversation?.provider)option.remove();
  if(conversation?.provider?.startsWith('mine-')){
    if(![...elements.providerSelect.options].some(option=>option.value===conversation.provider)){
      const unavailable=new Option('个人连接已不可用 · 请重新选择',conversation.provider);
      unavailable.disabled=true;unavailable.dataset.unavailablePersonal='1';elements.providerSelect.prepend(unavailable);
    }
    elements.providerSelect.value=conversation.provider;
  }
  const provider = selectedProvider();
  const models = modelsFor(provider);
  const desired = conversation?.provider === provider?.id ? conversation.model : "";
  elements.modelIdSelect.replaceChildren();
  for (const model of models) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = `${model.label || model.id}${model.vision ? ' · 看图' : ''}`;
    option.title = model.id;
    elements.modelIdSelect.append(option);
  }
  const unavailableModel=Boolean(desired&&!models.some(model=>model.id===desired));
  if(unavailableModel){const unavailable=new Option('原型号已不可用 · 请重新选择',desired);unavailable.disabled=true;elements.modelIdSelect.prepend(unavailable);}
  elements.modelIdSelect.value = unavailableModel || models.some((model) => model.id === desired)
    ? desired : models[0]?.id || "";
  elements.modelIdSelect.disabled = state.busy || Boolean(activeBackgroundRequest()) || models.length === 0;
  if (!unavailableModel && conversation?.provider === provider?.id) {
    conversation.model = elements.modelIdSelect.value;
    conversation.parameters = parametersForProvider(
      provider,
      conversation.parameters,
      elements.modelIdSelect.value,
    );
  }
  elements.modelNote.textContent = !provider&&conversation?.provider?.startsWith('mine-')?'个人连接已不可用，请明确选择其他服务商。'
    :unavailableModel?'原型号已不可用，请明确选择其他型号。':modelNoteText(provider, elements.modelIdSelect.value);
  syncWebSearchControl(conversation);
}

function createConversation({restoredText = ""} = {}) {
  voiceComposer?.cancel();
  stopReading();
  saveDraft();
  state.historyMode = "active";
  if (state.draftBranchId) {
    delete state.drafts[state.draftBranchId];
    persistDrafts();
  }
  state.conversations = state.conversations.filter((conversation) =>
    (conversation.messages.length > 0 || conversation.documents?.length || conversation.projectLinked||conversation.branch) && conversation.id !== state.draftBranchId
  );
  state.draftBranchId = "";
  const conversation = {
    id: createConversationId(),
    title: "新对话",
    titleEdited: false,
    pinned: false,
    archived: false,
    provider: state.providers.length ? (elements.providerSelect.value || state.defaultProvider) : "",
    model: state.providers.length ? (elements.modelIdSelect?.value || "") : "",
    parameters: {},
    context: normalizeContextSettings(),
    webSearch: false,
    instructions: "",
    updatedAt: Date.now(),
    lastUsage: null,
    messages: [],
  };
  state.conversations.unshift(conversation);
  state.activeId = conversation.id;
  if(restoredText)state.drafts["new-conversation"]=restoredText;
  else delete state.drafts["new-conversation"];
  persistDrafts();
  elements.promptInput.value = "";
  resizeTextarea();
  render({ scrollToBottom: true });
  closeSidebar(true);
  elements.promptInput.focus();
  return conversation;
}

function ensureConversation() {
  let conversation = activeConversation();
  if (!conversation) conversation = createConversation();
  return conversation;
}

function selectConversation(id) {
  if (!state.conversations.some((item) => item.id === id)) return;
  voiceComposer?.cancel();
  stopReading();
  saveDraft();
  if (state.draftBranchId && id !== state.draftBranchId) {
    delete state.drafts[state.draftBranchId];
    persistDrafts();
    state.conversations = state.conversations.filter((item) => item.id !== state.draftBranchId);
    state.draftBranchId = "";
  }
  state.activeId = id;
  const conversation = activeConversation();
  if (conversation?.provider && state.providers.some((item) => item.id === conversation.provider)) {
    elements.providerSelect.value = conversation.provider;
  }
  syncModelOptions(conversation);
  restoreDraft(conversation);
  render({ scrollToBottom: true });
  closeSidebar();
}

function deleteConversation(id) {
  if (state.backgroundRequests.has(id)) return;
  const target = state.conversations.find((item) => item.id === id);
  if (!target) return;
  if (hasConversationContent(target)) {
    target.archived = true;
    target.updatedAt = Date.now();
    saveConversations();
    renderHistory();
    showToast("对话已归档，完整记录保留，可在“已归档”中查看。");
    return;
  }
  const deletingActive = state.activeId === id;
  if (deletingActive) stopReading();
  delete state.drafts[draftKey(target)];
  persistDrafts();
  state.conversations = state.conversations.filter((item) => item.id !== id);
  if (state.draftBranchId === id) state.draftBranchId = "";
  if (deletingActive) {
    state.activeId = state.conversations[0]?.id || "";
    const selected = activeConversation();
    if (selected?.provider && state.providers.some((item) => item.id === selected.provider)) {
      elements.providerSelect.value = selected.provider;
    }
  }
  saveConversations();
  if (!state.activeId) createConversation();
  else {
    if (deletingActive) restoreDraft(activeConversation());
    render({ scrollToBottom: deletingActive });
  }
  showToast("对话已删除。");
}

function renameConversation(conversation, title) {
  const normalized = title.replace(/\s+/g, " ").trim().slice(0, 60);
  if (!normalized || normalized === conversation.title) {
    renderHistory();
    return;
  }
  conversation.title = normalized;
  conversation.titleEdited = true;
  conversation.updatedAt = Date.now();
  saveConversations();
  void syncPublishedConversation(conversation);
  render();
  showToast("对话已重命名。");
}

function togglePinnedConversation(conversation) {
  if (state.backgroundRequests.has(conversation.id)) return;
  conversation.pinned = !conversation.pinned;
  saveConversations();
  renderHistory();
  showToast(conversation.pinned ? "对话已置顶。" : "对话已取消置顶。");
}

function toggleArchivedConversation(conversation = activeConversation()) {
  if (state.busy || !hasConversationContent(conversation)) return;
  const archived = !conversation.archived;
  conversation.archived = archived;
  conversation.updatedAt = Date.now();
  saveConversations();
  state.historyMode = "active";
  if (!archived) {
    render({ scrollToBottom: true });
    showToast("对话已移出归档。");
    return;
  }

  const next = state.conversations
    .filter((item) => !item.archived && item.messages.length > 0)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)[0];
  if (next) {
    state.activeId = next.id;
    if (state.providers.some((item) => item.id === next.provider)) {
      elements.providerSelect.value = next.provider;
    }
    syncModelOptions(next);
    restoreDraft(next);
    render({ scrollToBottom: true });
  } else {
    createConversation();
  }
  showToast("对话已归档，可在侧栏“已归档”中找回。");
}

function startRenaming(row, conversation) {
  if (state.backgroundRequests.has(conversation.id)) return;
  const input = document.createElement("input");
  input.className = "history-rename-input";
  input.type = "text";
  input.maxLength = 60;
  input.value = conversation.title || "新对话";
  input.setAttribute("aria-label", "修改对话名称");
  row.replaceChildren(input);
  input.focus();
  input.select();
  let finished = false;
  const finish = (save) => {
    if (finished) return;
    finished = true;
    if (save) renameConversation(conversation, input.value);
    else renderHistory();
  };
  input.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
    }
  });
  input.addEventListener("blur", () => finish(true));
}

function renderHistory() {
  preserveHistoryFocus(elements.historyList);
  elements.historyList.replaceChildren();
  const showArchived = state.historyMode === "archived";
  elements.historyActiveFilter?.classList.toggle("active", !showArchived);
  elements.historyArchivedFilter?.classList.toggle("active", showArchived);
  elements.historyActiveFilter?.setAttribute("aria-pressed", String(!showArchived));
  elements.historyArchivedFilter?.setAttribute("aria-pressed", String(showArchived));
  const available = state.conversations.filter((item) =>
    (item.messages.length > 0 || item.documents?.length||item.projectLinked||item.branch) && item.archived === showArchived
  )
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
  const query = (elements.historySearch?.value || "").trim().toLocaleLowerCase();
  const viewKey=String(showArchived)+'|'+query;if(state.historyViewKey!==viewKey){state.historyViewKey=viewKey;state.historyLimit=100;}
  const visible = query
    ? available.filter((item) =>
      item.title.toLocaleLowerCase().includes(query)
      || item.messages.some((message) => message.content.toLocaleLowerCase().includes(query))
    )
    : available;
  elements.historyHeadingTitle.textContent = query
    ? `${showArchived ? "归档" : "对话"}搜索 · ${visible.length}`
    : `${showArchived ? "已归档" : "你的对话"} · ${available.length}`;
  if (available.length === 0) {
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = showArchived
      ? "归档的对话会显示在这里。"
      : "你的创作会留在这里，方便随时继续。";
    elements.historyList.append(empty);
    return;
  }

  if (visible.length === 0) {
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = "没有找到相关对话。";
    elements.historyList.append(empty);
    return;
  }

  let previousBucket='';
  const page=historyPage(visible,state.historyLimit,state.activeId);
  for (const conversation of page) {
    const bucket=query?'搜索结果':historyBucket(conversation);
    if(bucket!==previousBucket){const heading=document.createElement('p');heading.className='history-group-label';heading.textContent=bucket;elements.historyList.append(heading);previousBucket=bucket;}
    const row = document.createElement("div");
    row.className = `history-row${conversation.pinned ? " is-pinned" : ""}`;
    row.dataset.conversationId = conversation.id;
    const button = document.createElement("button");
    button.className = `history-item${conversation.id === state.activeId ? " active" : ""}`;
    button.type = "button";
    const parallelTask = state.parallelTasks.get(conversation.id);
    const taskPrefix = parallelTask?.status === "running" ? "● "
      : parallelTask?.status === "queued" ? "◌ "
        : parallelTask?.status === "done" ? "✓ "
          : parallelTask?.status === "failed" ? "! " : "";
    button.textContent = `${taskPrefix}${conversation.title || "新对话"}`;
    button.title = conversation.title || "新对话";
    if (conversation.id === state.activeId) button.setAttribute("aria-current", "true");
    button.addEventListener("click", () => selectConversation(conversation.id));
    const actions = document.createElement("div");
    actions.className = "history-actions";
    const pin = document.createElement("button");
    pin.className = "history-action";
    pin.type = "button";
    pin.textContent = conversation.pinned ? "取消置顶" : "置顶对话";
    pin.title = conversation.pinned ? "取消置顶" : "置顶对话";
    pin.setAttribute("aria-pressed", String(conversation.pinned));
    pin.setAttribute("aria-label", `${conversation.pinned ? "取消置顶" : "置顶"}：${conversation.title || "新对话"}`);
    const conversationBusy = state.backgroundRequests.has(conversation.id);
    pin.disabled = conversationBusy;
    pin.addEventListener("click", () => togglePinnedConversation(conversation));
    const rename = document.createElement("button");
    rename.className = "history-action";
    rename.type = "button";
    rename.textContent = "重命名";
    rename.title = "重命名对话";
    rename.setAttribute("aria-label", `重命名：${conversation.title || "新对话"}`);
    rename.disabled = conversationBusy;
    rename.addEventListener("click", () => startRenaming(row, conversation));
    const remove = document.createElement("button");
    remove.className = "history-action";
    remove.type = "button";
    remove.textContent = "归档并保留";
    remove.title = "归档并保留对话";
    remove.setAttribute("aria-label", `归档：${conversation.title || "新对话"}`);
    remove.disabled = conversationBusy;
    remove.addEventListener("click", () => deleteConversation(conversation.id));
    actions.append(pin, rename, remove);
    const more=document.createElement('button');more.type='button';more.className='history-more-button';more.textContent='⋯';
    more.setAttribute('aria-label',`对话操作：${conversation.title||'新对话'}`);more.setAttribute('aria-haspopup','dialog');more.setAttribute('aria-expanded','false');
    more.disabled=conversationBusy;
    row.append(button, more, actions);
    elements.historyList.append(row);
  }
  if(visible.length>page.length){const more=document.createElement('button');more.id='history-load-more';more.type='button';more.textContent=`载入更多对话 · 还有 ${visible.length-page.length} 段`;more.onclick=()=>{const previous=page.length;state.historyLimit+=100;renderHistory();const rows=elements.historyList.querySelectorAll('.history-item');rows[Math.min(previous,rows.length-1)]?.focus();};elements.historyList.append(more);}
}

function renderConversationDetails() {
  const conversation = activeConversation();
  const conversationBusy = state.busy || Boolean(activeBackgroundRequest());
  elements.openConversationSearch.disabled = !conversation?.messages.length;
  elements.openContextSettings.disabled = conversationBusy;
  const context = normalizeContextSettings(conversation?.context);
  elements.contextSummary.textContent = context.historyTurns === 0 ? "仅本次问题"
    : context.historyTurns !== null ? `最多携带 ${context.historyTurns} 轮历史` : "自动上下文";
  if (context.resetAt !== null) elements.contextSummary.textContent += " · 已开始新上下文";
  if (conversation?.messages.some(message => message.images?.length)) elements.contextSummary.textContent += " · 最多8图";
  updateContextPreview();
  elements.exportChat.disabled = conversationBusy || !conversation?.messages.length;
  if (elements.archiveChat) {
    elements.archiveChat.disabled = conversationBusy || !hasConversationContent(conversation);
  }
  if (elements.archiveChatLabel) {
    elements.archiveChatLabel.textContent = conversation?.archived
      ? "移出归档" : "归档当前对话";
  }
  elements.openInstructions.disabled = conversationBusy;
  elements.openModelParameters.disabled = conversationBusy || !selectedProvider();
  elements.openModelParameters.classList.toggle("has-custom-parameters", !!conversation
    && Object.keys(conversation.parameters || {}).length > 0);
  elements.openModelParameters.title = Object.keys(conversation?.parameters || {}).length
    ? "已自定义模型参数" : "设置当前对话的模型参数";
  elements.instructionsEntryLabel.textContent = conversation?.instructions
    ? "对话设定 · 已启用" : "对话设定";
  if (elements.currentChatTitle) {
    elements.currentChatTitle.textContent = conversation?.title || "新对话";
    elements.currentChatTitle.title = conversation?.title || "新对话";
  }
  if (elements.deleteCurrentChat) {
    elements.deleteCurrentChat.disabled = conversationBusy || !hasConversationContent(conversation);
  }
  if (elements.usageSummary) {
    const usage = conversation?.lastUsage;
    const count = (value) => new Intl.NumberFormat("zh-CN").format(value);
    elements.usageSummary.textContent = usage
      ? `上次回复用量：输入 ${count(usage.inputTokens)} · 输出 ${count(usage.outputTokens)} · 共 ${count(usage.totalTokens)} Token`
      : "";
  }
  syncWebSearchControl(conversation);
}

async function branchFromMessage(conversation, messageIndex) {
  const sourceId = conversation.id;
  if (state.busy || sourceId !== state.activeId || state.branchingIds.has(sourceId) || state.regeneratingIds.has(sourceId)) return;
  state.branchingIds.add(sourceId);
  showToast("正在准备对话分支…");
  renderMessages();
  try {
    stopReading();
    saveDraft(conversation);
    const selected = conversation.messages[messageIndex];
    if (selected?.role !== "user" && selected?.role !== "assistant") return;

    const editingQuestion = selected.role === "user";
    const prefix = conversation.messages.slice(0, messageIndex + (editingQuestion ? 0 : 1)).map((message) => ({
      role: message.role,
      content: message.content,
      ...(message.documentContext ? { documentContext: validateDocumentContext(message.documentContext) } : {}),
      ...(message.images?.length ? { images: message.images } : {}),
      ...(validMessageTime(message.createdAt) ? { createdAt: message.createdAt } : {}),
      ...(validGroundedTime(message.groundedAt) ? { groundedAt: message.groundedAt } : {}),
      ...(['stopped', 'interrupted', 'length'].includes(message.completion) ? { completion: message.completion } : {}),
      ...(conversation.provider !== "gemini" && validSearchResult(message.search)
        ? { search: validSearchResult(message.search) } : {}),
    }));
    const title = prefix.length > 0
      ? `${(conversation.title || "新对话").slice(0, 55)} · 分支`
      : `修改 · ${selected.content.replace(/\s+/g, " ").trim().slice(0, 25)}`;
    const provider = state.providers.some((item) => item.id === conversation.provider)
      ? conversation.provider
      : elements.providerSelect.value || state.defaultProvider;
    const branch = {
      id: createConversationId(),
      branch:branchOrigin(conversation,messageIndex,editingQuestion?'edit':'continue'),
      title,
      titleEdited: prefix.length > 0,
      pinned: false,
      archived: false,
      provider,
      model: conversation.model || "",
      parameters: { ...validParameters(conversation.parameters) },
      context: normalizeContextSettings(conversation.context),
      documents: validateDocuments(conversation.documents),
      webSearch: conversation.webSearch === true,
      instructions: conversation.instructions || "",
      updatedAt: Date.now(),
      lastUsage: null,
      messages: prefix,
    };

    try { await projects.inherit(conversation.id, branch.id); } catch (error) { showToast(error.message); return; }
    const activate = state.activeId === sourceId;
    // A pending branch must keep the newer active draft, including an empty chat.
    state.conversations = state.conversations.filter((item) =>
      (!activate && item.id === state.activeId) || ((item.messages.length > 0 || item.documents?.length||item.projectLinked||item.branch) && item.id !== state.draftBranchId)
    );
    if (activate) state.draftBranchId = '';
    state.conversations.unshift(branch);
    const branchDraft = editingQuestion ? selected.content : "";
    saveDraft(branch, branchDraft);
    if (activate) {
      state.activeId = branch.id;
      if (provider && state.providers.some((item) => item.id === provider)) {
        elements.providerSelect.value = provider;
      }
      syncModelOptions(branch);
      elements.promptInput.value = branchDraft;
    }
    visionComposer?.setImages(editingQuestion ? selected.images || [] : [], draftKey(branch));
    saveConversations();
    resizeTextarea();
    render({ scrollToBottom: activate });
    if (activate) {
      closeSidebar();
      elements.promptInput.focus();
    }
    showToast(!activate ? "分支已在后台创建，可在对话历史中打开；当前草稿保持不变。" : editingQuestion
      ? "已创建对话分支；修改问题后发送，原对话仍会保留。"
      : "已从这条回复创建分支；输入新问题继续对话。原对话仍会保留。");
  } finally {
    state.branchingIds.delete(sourceId);
    renderMessages();
  }
}

function searchSuggestionsFrame(html) {
  const frame = document.createElement("iframe");
  frame.className = "search-suggestions-frame";
  frame.title = "Google 搜索建议";
  frame.loading = "lazy";
  frame.referrerPolicy = "no-referrer";
  frame.setAttribute("credentialless", "");
  frame.setAttribute("sandbox", "allow-popups allow-popups-to-escape-sandbox");
  const policy = "default-src 'none'; style-src 'unsafe-inline'; img-src data: https://www.google.com https://www.gstatic.com; font-src data:; connect-src 'none'; script-src 'none'; form-action 'none'; base-uri 'none'";
  const documentText = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${html}</body></html>`;
  const objectUrl = URL.createObjectURL(new Blob([documentText], { type: "text/html;charset=utf-8" }));
  frame.src = objectUrl;
  frame.addEventListener("load", () => URL.revokeObjectURL(objectUrl), { once: true });
  return frame;
}

function searchDetailsElement(value) {
  const search = validSearchResult(value);
  if (!search?.enabled) return null;
  const section = document.createElement("section");
  section.className = "message-search";
  section.setAttribute("aria-label", "联网搜索信息");

  const heading = document.createElement("div");
  heading.className = "message-search-heading";
  const icon = document.createElement("span");
  icon.className = "message-search-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "⌕";
  const label = document.createElement("strong");
  label.textContent = search.used ? "已联网检索" : "已开启联网搜索，本次未调用";
  heading.append(icon, label);
  section.append(heading);

  if (search.sources.length) {
    const list = document.createElement("ol");
    list.className = "message-source-list";
    for (const [index, source] of search.sources.entries()) {
      const item = document.createElement("li");
      item.dataset.citation = String(index + 1);
      const link = document.createElement("a");
      link.href = source.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      const title = document.createElement("span");
      title.textContent = source.title;
      const host = document.createElement("small");
      host.textContent = new URL(source.url).hostname.replace(/^www\./, "");
      link.append(title, host);
      item.append(link);
      const details = document.createElement('details'), summary = document.createElement('summary'), excerpt = document.createElement('p');
      summary.textContent = `查看来源 [${index + 1}]`; excerpt.textContent = source.excerpt || '此来源未提供可保存的搜索摘录；请打开原网页核查。';
      const url = document.createElement('p'); url.className = 'source-url'; url.textContent = source.url;
      details.append(summary, url, excerpt); item.append(details);
      list.append(item);
    }
    section.append(list);
  }

  if (search.queries.length) {
    const queries = document.createElement("details");
    queries.className = "message-search-queries";
    const summary = document.createElement("summary");
    summary.textContent = `查看搜索词（${search.queries.length}）`;
    const list = document.createElement("ul");
    for (const query of search.queries) {
      const item = document.createElement("li");
      item.textContent = query;
      list.append(item);
    }
    queries.append(summary, list);
    section.append(queries);
  }

  if (search.suggestionsHtml) {
    const suggestions = document.createElement("div");
    suggestions.className = "search-suggestions";
    const suggestionsLabel = document.createElement("span");
    suggestionsLabel.className = "search-suggestions-label";
    suggestionsLabel.textContent = "Google 搜索建议";
    suggestions.append(suggestionsLabel, searchSuggestionsFrame(search.suggestionsHtml));
    section.append(suggestions);
  }
  return section;
}

function messageElement(message, providerLabel, canRegenerate = false, onBranch = null) {
  const preparingBranch = state.branchingIds.has(state.activeId) || state.regeneratingIds.has(state.activeId);
  const article = document.createElement("article");
  article.className = `message ${message.role}`;

  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = message.role === "user" ? "你" : "云";

  const body = document.createElement("div");
  const meta = document.createElement("div");
  meta.className = "message-meta";
  const author = message.role === "user" ? "你" : providerLabel || "AI 助手";
  if (validMessageTime(message.createdAt)) {
    const date = new Date(message.createdAt);
    const time = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(date);
    meta.textContent = `${author} · ${time}`;
    meta.title = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date);
  } else {
    meta.textContent = author;
  }

  const text = document.createElement("div");
  text.className = "message-text";
  if (message.role === "assistant" && !message.streaming && workbench?.markdown() !== false && typeof window.renderMessageMarkdown === "function") {
    window.renderMessageMarkdown(message.content, text);
  } else {
    text.textContent = message.content;
  }

  body.append(meta, text);
  if (message.documentContext) body.append(sourceDetails(message.documentContext,
    [...(activeConversation()?.documents || []), ...(projects?.projectForConversation(activeConversation()?.id)?.documents || [])]));
  if (message.images?.length) body.append(imageGallery(message.images, image => visionComposer.show(image)));
  if (message.streaming || message.completion) {
    const status = document.createElement('p'); status.className = 'message-completion';
    status.textContent = message.streaming ? '正在生成…'
      : message.completion === 'stopped' ? '已停止 · 已收到的文字已保留'
      : message.completion === 'length' ? '达到本次输出上限 · 可继续提问或调整参数'
      : '回复中断 · 已收到的文字已保留';
    body.append(status);
  }
  const searchDetails = message.role === "assistant" ? searchDetailsElement(message.search) : null;
  if (searchDetails) body.append(searchDetails);
  if (message.role === 'assistant' && !message.streaming) wireCitationLinks(text, body);
  if (message.role === "user" && (message.content.length > 1400 || message.content.split("\n").length > 18)) {
    const fullContent = message.content;
    const shortened = `${Array.from(fullContent).slice(0, 900).join("")}…`;
    const toggle = document.createElement("button");
    toggle.className = "copy-message";
    toggle.type = "button";
    let expanded = false;
    const sync = () => {
      text.textContent = expanded ? fullContent : shortened;
      toggle.textContent = expanded ? "收起长提问" : "展开完整提问";
      toggle.setAttribute("aria-expanded", String(expanded));
    };
    toggle.addEventListener("click", () => { expanded = !expanded; sync(); });
    sync();
    body.append(toggle);
  }
  if (message.role === "user" && onBranch) {
    const actions = document.createElement("div");
    actions.className = "message-actions";
    const copyButton = document.createElement("button");
    copyButton.className = "copy-message";
    copyButton.type = "button";
    copyButton.textContent = "复制提问";
    copyButton.addEventListener("click", async () => {
      const copied = await copyText(message.content);
      showToast(copied ? "提问已复制。" : "复制失败，请手动选择文字。");
    });
    const branchButton = document.createElement("button");
    branchButton.className = "copy-message";
    branchButton.type = "button";
    branchButton.textContent = preparingBranch ? "正在准备…" : "修改并重问";
    branchButton.disabled = state.busy || preparingBranch;
    branchButton.addEventListener("click", onBranch);
    actions.append(copyButton, branchButton);
    body.append(actions);
  }
  if (message.role === "assistant") {
    const actions = document.createElement("div");
    actions.className = "message-actions";
    const copyButton = document.createElement("button");
    copyButton.className = "copy-message";
    copyButton.type = "button";
    copyButton.textContent = "复制回复";
    copyButton.addEventListener("click", async () => {
      const copied = await copyText(message.content);
      showToast(copied ? "回复已复制。" : "复制失败，请手动选择文字。");
    });
    actions.append(copyButton);
    if(!message.streaming){const edit=document.createElement('button');edit.type='button';edit.className='copy-message';edit.textContent='在画布中编辑';edit.onclick=()=>writingDesk?.open(message.content, (activeConversation()?.title||'AI 回复')+' · 文稿');actions.append(edit);}
    if ("speechSynthesis" in window && "SpeechSynthesisUtterance" in window) {
      const readButton = document.createElement("button");
      readButton.className = "copy-message";
      readButton.type = "button";
      readButton.dataset.readReply = "";
      readButton.speechMessage = message;
      readButton.textContent = state.speechMessage === message ? "停止朗读" : "朗读回复";
      readButton.setAttribute("aria-pressed", String(state.speechMessage === message));
      readButton.addEventListener("click", () => readReply(message));
      actions.append(readButton);
    }
    if (typeof window.renderMessageMarkdown === "function") {
      const displayButton = document.createElement("button");
      displayButton.className = "copy-message";
      displayButton.type = "button";
      displayButton.textContent = workbench?.markdown() === false ? "查看排版" : "查看原文";
      displayButton.setAttribute("aria-pressed", String(workbench?.markdown() === false));
      displayButton.addEventListener("click", () => {
        const showSource = displayButton.getAttribute("aria-pressed") !== "true";
        if (showSource) text.textContent = message.content;
        else window.renderMessageMarkdown(message.content, text);
        displayButton.textContent = showSource ? "查看排版" : "查看原文";
        displayButton.setAttribute("aria-pressed", String(showSource));
      });
      actions.append(displayButton);
    }
    if (onBranch) {
      const branchButton = document.createElement("button");
      branchButton.className = "copy-message";
      branchButton.type = "button";
      branchButton.textContent = preparingBranch ? "正在准备…" : "从此继续";
      branchButton.disabled = state.busy || preparingBranch;
      branchButton.addEventListener("click", onBranch);
      actions.append(branchButton);
    }
    if (canRegenerate) {
      const regenerateButton = document.createElement("button");
      regenerateButton.className = "copy-message";
      regenerateButton.type = "button";
      const preparing = preparingBranch;
      regenerateButton.textContent = preparing ? "正在准备…" : "重新生成";
      regenerateButton.disabled = state.busy || preparing;
      regenerateButton.addEventListener("click", () => regenerateLastReply());
      actions.append(regenerateButton);
    }
    body.append(actions);
  }
  if (workbench) {
    let actions = body.querySelector('.message-actions');
    if (!actions) { actions = document.createElement('div'); actions.className = 'message-actions'; body.append(actions); }
    const detail = document.createElement('button'); detail.type = 'button'; detail.className = 'copy-message'; detail.textContent = '消息详情';
    const conversation = activeConversation();
    detail.addEventListener('click', () => workbench.details(message, conversation)); actions.append(detail);
  }
  if(accountUser && message.content && ['user','assistant'].includes(message.role)) {
    const remember=document.createElement('button');remember.type='button';remember.className='copy-message';remember.textContent='保存为记忆';remember.onclick=()=>accountMemory?.remember(message.content);body.querySelector('.message-actions')?.append(remember);
  }
  if(message.role==='assistant') {
    const actions=body.querySelector('.message-actions');
    if(actions?.children.length>3){
      const more=document.createElement('details'),summary=document.createElement('summary'),options=document.createElement('div');
      more.className='message-more';summary.textContent='更多';summary.setAttribute('aria-label','更多回复操作');options.className='message-more-options';
      for(const control of [...actions.children].slice(3))options.append(control);
      more.append(summary,options);actions.append(more);
      more.addEventListener('keydown',event=>{if(event.key==='Escape'&&more.open){event.preventDefault();event.stopPropagation();more.open=false;summary.focus();}});
    }
  }
  article.append(avatar, body);
  return article;
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // A denied clipboard permission can still allow the selected-text fallback.
    }
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.className = "clipboard-helper";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  } catch {
    return false;
  }
}

function typingElement(providerLabel) {
  const article = document.createElement("article");
  article.className = "message assistant";
  article.id = "typing-message";

  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = "云";

  const body = document.createElement("div");
  const meta = document.createElement("div");
  meta.className = "message-meta";
  meta.textContent = `${providerLabel || "AI 助手"} 正在思考`;
  const dots = document.createElement("div");
  dots.className = "typing-dots";
  dots.setAttribute("aria-label", "正在生成回复");
  dots.append(document.createElement("span"), document.createElement("span"), document.createElement("span"));
  body.append(meta, dots);
  article.append(avatar, body);
  return article;
}

function currentProviderLabel() {
  const id = elements.providerSelect.value;
  return state.providers.find((item) => item.id === id)?.label || "AI 助手";
}

function renderMessages() {
  const conversation = activeConversation();
  const messages = conversation?.messages || [];
  const conversationBusy = state.busy || Boolean(activeBackgroundRequest());
  elements.welcome.hidden = messages.length > 0;
  elements.messages.hidden = messages.length === 0;
  elements.messages.replaceChildren();

  const resetAt = normalizeContextSettings(conversation?.context).resetAt;
  let boundaryShown = resetAt === null;
  const appendBoundary = () => {
    const divider = document.createElement("div");
    divider.className = "context-divider";
    divider.textContent = "新上下文从这里开始 · 之前的消息仍保留";
    elements.messages.append(divider);
    boundaryShown = true;
  };

  const provider = state.providers.find((item) => item.id === (conversation?.provider || elements.providerSelect.value));
  for (const [index, message] of messages.entries()) {
    if (!boundaryShown && validMessageTime(message.createdAt) && message.createdAt > resetAt) appendBoundary();
    const canRegenerate = !conversationBusy && conversation?.id !== state.draftBranchId
      && index === messages.length - 1
      && message.role === "assistant"
      && messages[index - 1]?.role === "user";
    const onBranch = !conversationBusy && (message.role === "user" || message.role === "assistant")
      ? () => branchFromMessage(conversation, index)
      : null;
    const article = messageElement(message, provider?.label, canRegenerate, onBranch);
    article.dataset.messageIndex = String(index);
    if (index === messages.length - 1 && message.role === 'user') {
      const recovery = document.createElement('p');
      recovery.className = 'message-completion';
      recovery.textContent = conversationBusy ? '正在请求回复 · 问题已保留' : '尚未收到完整回复 · 问题和图片已保留；重试会再次请求模型，不会新增一条相同问题。';
      const retry = document.createElement('button');
      retry.type = 'button'; retry.className = 'copy-message';
      retry.textContent = '重试此问题'; retry.disabled = conversationBusy;
      retry.addEventListener('click', () => {
        if (state.backgroundRequests.has(conversation.id) || state.sharedIds.has(conversation.id) && !state.sharedEditKeys[conversation.id]) {
          showToast('请先通过“修改问题”创建可编辑副本。'); return;
        }
        if (navigator.onLine === false) { showToast('当前处于离线状态，问题已保留，请联网后手动重试。'); return; }
        void requestConversation(conversation, message);
      });
      article.querySelector('.message-text').parentElement.append(recovery, retry);
    }
    elements.messages.append(article);
  }
  if (!boundaryShown) appendBoundary();
  if (state.busy && !messages.at(-1)?.streaming) {
    const typing = typingElement(provider?.label);
    if (state.parallelTasks.get(conversation.id)?.status === 'queued') typing.querySelector('.message-meta').textContent = '等待生成 · 前面的对话完成后自动开始';
    elements.messages.append(typing);
  }
}

function updateJumpLatestVisibility() {
  const distance = elements.conversation.scrollHeight
    - elements.conversation.clientHeight - elements.conversation.scrollTop;
  elements.jumpLatest.hidden = !activeConversation()?.messages.length || distance < 120;
}

function render({ scrollToBottom = false } = {}) {
  modernUI?.refresh();
  branchNavigation?.refresh();
  const previousTop = elements.conversation.scrollTop;
  const previousDistance = elements.conversation.scrollHeight
    - elements.conversation.clientHeight - previousTop;
  projects?.sync();
  renderHistory();
  renderConversationDetails();
  renderMessages();
  updateSendState();
  renderDocumentLibrary(activeConversation(), state.busy, () => { activeConversation().updatedAt = Date.now(); saveConversations(); render(); });
  workbench?.sync(activeConversation(), [...BUILTIN_PRESETS, ...state.customPresets], state.busy || Boolean(activeBackgroundRequest()));
  requestAnimationFrame(() => {
    elements.conversation.style.scrollBehavior = "auto";
    elements.conversation.scrollTop = scrollToBottom || previousDistance < 96
      ? elements.conversation.scrollHeight : previousTop;
    elements.conversation.style.scrollBehavior = "";
    updateJumpLatestVisibility();
  });
}

function exportConversation() {
  const conversation = activeConversation();
  if (state.busy || !conversation?.messages.length) return;
  const heading = conversation.title || "新对话";
  const model = state.providers.find((item) => item.id === conversation.provider)?.label
    || conversation.provider || "AI 助手";
  const sections = [`# ${heading}`, ""];
  for (const message of conversation.messages) {
    const timestamp = validMessageTime(message.createdAt)
      ? ` · ${new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(new Date(message.createdAt))}`
      : "";
    sections.push(`## ${message.role === "user" ? "你" : model}${timestamp}`, "", message.content, "");
    if (message.documentContext) {
      sections.push('### 本次参考片段' + (message.documentContext.mode === 'overview' ? '（抽样概览）' : '（按问题检索）'), '');
      for (const source of message.documentContext.sources) sections.push(`[${source.id}] ${source.name} · ${source.location}`, '', source.text, '');
    }
    for (const [index, image] of (message.images || []).entries()) sections.push(`![图片 ${index + 1}](${image.dataUrl})`, '');
    const search = message.role === "assistant" && conversation.provider !== "gemini"
      ? validSearchResult(message.search) : null;
    if (search?.sources.length) {
      sections.push("### 联网来源", "");
      for (const [index, source] of search.sources.entries()) {
        const title = source.title.replace(/([\\[\]])/g, "\\$1");
        const url = source.url.replace(/\(/g, "%28").replace(/\)/g, "%29");
        sections.push(`${index + 1}. [${title}](${url})`, ...(source.excerpt ? [source.excerpt] : []));
      }
      sections.push("");
    }
  }
  const content = `\uFEFF${sections.join("\n")}`;
  const filename = heading.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/g, "").slice(0, 48) || "对话";
  const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}.md`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("当前对话已导出为 Markdown 文件。");
}

function resizeTextarea() {
  elements.promptInput.style.height = "auto";
  elements.promptInput.style.height = `${Math.min(elements.promptInput.scrollHeight, 180)}px`;
}

function updateSendState() {
  const backgroundBusy = Boolean(activeBackgroundRequest());
  elements.sendButton.disabled = !state.busy && (
    (elements.promptInput.value.trim().length === 0 && !visionComposer?.images().length) || state.providers.length === 0 || Boolean(chatSelectionProblem(activeConversation(),selectedProvider(),elements.modelIdSelect.value))
  );
  elements.sendButton.classList.toggle("cancel", state.busy);
  elements.sendButton.setAttribute("aria-label", state.busy ? state.parallelTasks.get(state.activeId)?.status === 'queued' ? '取消排队' : '停止当前对话生成' : '发送消息');
  elements.sendIcon.textContent = state.busy ? "■" : "↑";
  elements.providerSelect.disabled = state.busy || backgroundBusy || state.providers.length === 0;
  elements.modelIdSelect.disabled = state.busy || backgroundBusy || modelsFor(selectedProvider()).length === 0;
  elements.openModelParameters.disabled = state.busy || backgroundBusy || state.providers.length === 0;
  elements.openModelPicker.disabled = state.busy || backgroundBusy || modelsFor(selectedProvider()).length === 0;
  elements.openModelDirectory.disabled = elements.openModelPicker.disabled;
  elements.attachTextButton.disabled = state.busy || backgroundBusy;
  elements.newChat.disabled = false;
  elements.clearHistory.disabled = state.busy || state.backgroundRequests.size > 0;
  syncWebSearchControl();
  visionComposer?.render();
  voiceComposer?.sync();
  accountMemory?.sync();
  updateContextPreview();
}

function previewProjectInput(conversation) {
  return projects?.preview(conversation||{id:'',instructions:'',documents:[]})||{instructions:conversation?.instructions||'',documents:conversation?.documents||[]};
}
function updateContextPreview() {
  const conversation=activeConversation(),detail=document.querySelector('#context-budget-detail'),last=document.querySelector('#context-last-request');
  if(!detail||!elements.contextSummary)return;
  const busy=state.busy||Boolean(activeBackgroundRequest());
  if(busy){detail.textContent='当前对话正在生成；结束后可查看下一次发送预览。';return;}
  try {
    const images=visionComposer?.images()||[],content=elements.promptInput.value.trim()||(images.length?'请描述并分析图片内容。':''),settings={...normalizeContextSettings(conversation?.context)};
    if(elements.contextSettingsDialog.open){const value=elements.contextHistoryTurns.value;settings.historyTurns=value==='auto'?null:Number(value);if(document.querySelector('#context-use-memory').checked)delete settings.useMemory;else settings.useMemory=false;if(document.querySelector('#context-use-personal').checked)delete settings.usePersonalInstructions;else settings.usePersonalInstructions=false;}
    const personal=personalInstructions?.preview(settings.usePersonalInstructions!==false)||{chars:0,loaded:false};
    const memory=settings.useMemory===false?{entries:[],chars:0}:accountMemory?.preview(settings.useMemory!==false)||{entries:[],chars:0};
    const {report}=prepareChatContext([...(conversation?.messages||[]),{role:'user',content,images}],settings,{...state.contextLimits,...previewProjectInput(conversation),historyBudget:getLimits().historyChars,maxMessages:getLimits().maxMessages,memoryChars:memory.chars,memoryCount:memory.entries.length,personalChars:personal.chars});
    detail.textContent=formatContextReport(report)+(accountUser&&settings.usePersonalInstructions!==false&&!personal.loaded?'\n账户通用指令尚未读取，可在设置中查看；发送时会读取。':'')+(accountUser&&memory.loaded===false?'\n长期记忆尚未读取，请打开“长期记忆”核对；发送时会重新读取。':'');
    elements.contextSummary.textContent=`下次 ${report.historyTurns} 轮${report.omittedMessages?` · 省略 ${report.omittedMessages} 条`:''}`;elements.contextSummary.title=detail.textContent;
  }catch(e){detail.textContent=e.message;elements.contextSummary.textContent='上下文需检查';elements.contextSummary.title=e.message;}
  const previous=state.contextReports.get(conversation?.id);last.hidden=!previous;if(previous)last.textContent='上次准备发送的范围（未证明服务器已收到）：\n'+formatContextReport(previous);
}

function setServiceStatus(kind, title, detail) {
  elements.statusDot.className = `status-dot ${kind}`;
  elements.serviceStatus.textContent = title;
  elements.serviceDetail.textContent = detail;
}

function showToast(message) {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  state.toastTimer = window.setTimeout(() => elements.toast.classList.remove("visible"), 4200);
}

function applyFontChoice(choice) {
  const selected = FONT_CHOICES.includes(choice) ? choice : "default";
  document.documentElement.dataset.font = selected;
  elements.fontToggleLabel.textContent = `字体：${FONT_LABELS[selected]}`;
  elements.fontToggle.title = `当前字体：${FONT_LABELS[selected]}；点击切换`;
}

function loadFontChoice() {
  try {
    return scopedStorage.getItem(FONT_KEY) || "default";
  } catch {
    return "default";
  }
}

function isLoopbackLocation() {
  return ["127.0.0.1", "localhost", "[::1]", "::1"].includes(window.location.hostname);
}

function tokenTransportIsSafe() {
  return window.location.protocol === "https:" || isLoopbackLocation();
}

function readAccessToken() {
  try {
    const persistentToken = globalStorage.getItem(TOKEN_KEY) || "";
    if (persistentToken) return persistentToken;

    const sessionToken = sessionStorage.getItem(TOKEN_KEY) || "";
    if (sessionToken) {
      globalStorage.setItem(TOKEN_KEY, sessionToken);
      sessionStorage.removeItem(TOKEN_KEY);
    }
    return sessionToken;
  } catch {
    try {
      return sessionStorage.getItem(TOKEN_KEY) || "";
    } catch {
      return "";
    }
  }
}

function setAccessToken(token) {
  try {
    if (token) globalStorage.setItem(TOKEN_KEY, token);
    else globalStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    return true;
  } catch {
    try {
      if (token) sessionStorage.setItem(TOKEN_KEY, token);
      else sessionStorage.removeItem(TOKEN_KEY);
      showToast("浏览器禁止长期保存口令，本次只能保留到关闭浏览器。请检查隐私设置。");
      return true;
    } catch {
      showToast("浏览器无法保存访问口令，请检查隐私设置。");
      return false;
    }
  }
}

function renderConversationSearch() {
  const conversation = activeConversation();
  const results = findConversationMessages(conversation?.messages || [],
    elements.conversationSearchInput.value, elements.conversationSearchRole.value);
  elements.conversationSearchResults.replaceChildren();
  elements.conversationSearchStatus.textContent = elements.conversationSearchInput.value.trim()
    ? `找到 ${results.length} 条消息，共 ${results.reduce((sum, item) => sum + item.count, 0)} 处匹配`
    : "输入关键字开始查找。";
  for (const result of results) {
    const button = document.createElement("button");
    button.className = "conversation-search-result";
    button.type = "button";
    const label = document.createElement("strong");
    label.textContent = `第 ${result.index + 1} 条 · ${result.role === "user" ? "我的提问" : "AI 回复"} · ${result.count} 处`;
    const snippet = document.createElement("span");
    const mark = document.createElement("mark");
    mark.textContent = result.match;
    snippet.append(document.createTextNode(result.before), mark, document.createTextNode(result.after));
    button.append(label, snippet);
    button.addEventListener("click", () => {
      elements.conversationSearchDialog.close();
      const message = elements.messages.querySelector(`[data-message-index="${result.index}"]`);
      if (!message) return;
      message.classList.add("message-located");
      message.tabIndex = -1;
      message.focus({ preventScroll: true });
      message.scrollIntoView({ block: "center", behavior: "smooth" });
      window.setTimeout(() => message.classList.remove("message-located"), 2500);
    });
    elements.conversationSearchResults.append(button);
  }
}

function renderModelPicker() {
  const provider = selectedProvider();
  elements.modelPickerProvider.textContent = `${provider?.label || "当前服务商"} · 选择其他型号会开启新对话，保留原对话。`;
  const models = filterModelOptions(modelsFor(provider), elements.modelPickerInput.value)
    .filter(model => !elements.modelPickerFavorites.checked || isFavoriteModel(provider?.id, model.id))
    .sort((a, b) => Number(isFavoriteModel(provider?.id, b.id)) - Number(isFavoriteModel(provider?.id, a.id)));
  elements.modelPickerStatus.textContent = models.length ? `${models.length} 个匹配型号 · 点击星标收藏`
    : elements.modelPickerFavorites.checked ? "没有匹配的收藏，可取消“只看收藏”查看其他型号。" : "没有找到匹配型号。";
  elements.modelPickerResults.replaceChildren();
  for (const model of models) {
    const row = document.createElement("div");
    row.className = "model-picker-row";
    const select = document.createElement("button");
    select.type = "button";
    select.className = "model-picker-option";
    const selected = model.id === elements.modelIdSelect.value;
    select.setAttribute("aria-pressed", String(selected));
    const label = document.createElement("strong");
    label.textContent = `${selected ? "✓ " : ""}${model.label || model.id}${model.vision ? ' · 看图' : ''}`;
    const id = document.createElement("small");
    id.textContent = model.id;
    select.append(label, id);
    select.addEventListener("click", () => {
      if (state.busy || activeBackgroundRequest()) return;
      elements.modelPickerDialog.close();
      if (elements.modelIdSelect.value !== model.id) {
        elements.modelIdSelect.value = model.id;
        elements.modelIdSelect.dispatchEvent(new Event("change"));
      }
    });
    const favorite = document.createElement("button");
    favorite.type = "button";
    favorite.className = "model-favorite-button";
    const starred = isFavoriteModel(provider.id, model.id);
    favorite.textContent = starred ? "★" : "☆";
    favorite.setAttribute("aria-label", `${starred ? "取消收藏" : "收藏"} ${model.label || model.id}`);
    favorite.setAttribute("aria-pressed", String(starred));
    favorite.addEventListener("click", () => toggleFavoriteModel(provider.id, model.id));
    row.append(select, favorite);
    elements.modelPickerResults.append(row);
  }
}

function openModelPicker() {
  if (state.busy || activeBackgroundRequest() || !modelsFor(selectedProvider()).length) return;
  elements.modelPickerInput.value = "";
  elements.modelPickerFavorites.checked = false;
  renderModelPicker();
  setWorkspaceMenu(false);
  elements.modelPickerDialog.showModal();
  elements.modelPickerInput.focus();
}

function openConversationSearch() {
  setWorkspaceMenu(false);
  renderConversationSearch();
  elements.conversationSearchDialog.showModal();
  elements.conversationSearchInput.focus();
  elements.conversationSearchInput.select();
}

function openContextSettings() {
  if (state.busy || activeBackgroundRequest()) return;
  const conversation = ensureConversation();
  const context = normalizeContextSettings(conversation.context);
  elements.contextHistoryTurns.value = context.historyTurns === null ? "auto" : String(context.historyTurns);
  document.querySelector('#context-use-memory').checked=context.useMemory!==false;
  document.querySelector('#context-use-personal').checked=context.usePersonalInstructions!==false;
  elements.restoreChatContext.disabled = context.resetAt === null;
  elements.contextSettingsStatus.textContent = context.resetAt === null
    ? "当前可引用完整历史，实际携带量受所选轮数和长度限制。"
    : "已设置上下文边界，后续提问只引用边界之后的对话。";
  setWorkspaceMenu(false);
  elements.contextSettingsDialog.showModal();
  updateContextPreview();
}
elements.contextHistoryTurns.addEventListener('change',updateContextPreview);
document.querySelector('#context-use-memory').addEventListener('change',updateContextPreview);
document.querySelector('#context-use-personal').addEventListener('change',updateContextPreview);
elements.contextSettingsDialog.addEventListener('close',updateContextPreview);

function saveContextSettings(mode = "save") {
  if (state.busy || activeBackgroundRequest()) return;
  const conversation = ensureConversation();
  const context = normalizeContextSettings(conversation.context);
  const value = elements.contextHistoryTurns.value;
  context.historyTurns = value === "auto" ? null : Number(value);
  if(document.querySelector('#context-use-memory').checked)delete context.useMemory;else context.useMemory=false;
  if(document.querySelector('#context-use-personal').checked)delete context.usePersonalInstructions;else context.usePersonalInstructions=false;
  if (mode === "reset") context.resetAt = Date.now();
  if (mode === "restore") context.resetAt = null;
  conversation.context = normalizeContextSettings(context);
  conversation.updatedAt = Date.now();
  saveConversations();
  elements.contextSettingsDialog.close();
  render({ scrollToBottom: mode === "reset" });
  showToast(mode === "reset" ? "已开始新上下文，旧消息仍保留。"
    : mode === "restore" ? "已允许再次引用之前的历史。" : "当前对话的上下文设置已保存。");
}

function syncReadingButtons() {
  for (const button of document.querySelectorAll("[data-read-reply]")) {
    const active = state.speechMessage === button.speechMessage;
    button.textContent = active ? "停止朗读" : "朗读回复";
    button.setAttribute("aria-pressed", String(active));
  }
}

function stopReading() {
  state.speechGeneration += 1;
  state.speechMessage = null;
  window.speechSynthesis?.cancel();
  syncReadingButtons();
}

function readReply(message) {
  const wasReading = state.speechMessage === message;
  stopReading();
  if (wasReading) return;
  const chunks = speechChunks(message.content);
  if (!chunks.length) { showToast("这条回复没有可朗读的文字。"); return; }
  state.speechMessage = message;
  const generation = state.speechGeneration;
  const lang = /[\u3400-\u9fff]/u.test(message.content) ? "zh-CN" : "en-US";
  const voice = window.speechSynthesis.getVoices().find(item => item.lang.toLowerCase() === lang.toLowerCase());
  let index = 0;
  const next = () => {
    if (generation !== state.speechGeneration) return;
    if (index === chunks.length) { stopReading(); return; }
    const utterance = new window.SpeechSynthesisUtterance(chunks[index++]);
    utterance.lang = lang;
    if (voice) utterance.voice = voice;
    utterance.onend = next;
    utterance.onerror = () => {
      if (generation !== state.speechGeneration) return;
      stopReading();
      showToast("浏览器朗读未能完成，请检查设备语音设置后重试。");
    };
    window.speechSynthesis.speak(utterance);
  };
  syncReadingButtons();
  next();
}

function setSidebar(open, restoreFocus = false) {
  const mobile = mobileSidebarMedia.matches;
  const shouldOpen = mobile && open;
  elements.body.classList.toggle("sidebar-open", shouldOpen);
  elements.menuButton.setAttribute("aria-expanded", String(shouldOpen));
  elements.sidebar.inert = mobile && !shouldOpen;
  elements.mainPanel.inert = shouldOpen;
  if (mobile) elements.sidebar.setAttribute("aria-hidden", String(!shouldOpen));
  else elements.sidebar.removeAttribute("aria-hidden");
  if (shouldOpen) {
    elements.sidebar.setAttribute('role', 'dialog');
    elements.sidebar.setAttribute('aria-modal', 'true');
  } else {
    elements.sidebar.removeAttribute('role');
    elements.sidebar.removeAttribute('aria-modal');
  }
  if (shouldOpen) elements.sidebarClose.focus();
  else if (restoreFocus && mobile) elements.menuButton.focus();
}

function openSidebar() {
  setSidebar(true);
}

function closeSidebar(restoreFocus = false) {
  setSidebar(false, restoreFocus);
}

function openSettings() {
  const safeTransport = tokenTransportIsSafe();
  elements.gatewayToken.disabled = !safeTransport;
  elements.saveToken.disabled = !safeTransport;
  elements.settingsDescription.textContent = safeTransport
    ? "输入一次后会保存在当前浏览器，网站更新或重启浏览器后仍可使用。公用设备用完后请移除口令。"
    : "当前网页没有使用 HTTPS。为保护访问口令，请改用 HTTPS 后再填写。";
  elements.gatewayToken.value = safeTransport ? readAccessToken() : "";
  elements.settingsDialog.showModal();
  window.setTimeout(() => {
    if (safeTransport) elements.gatewayToken.focus();
  }, 0);
}

function openApiAccess() {
  elements.apiBaseUrl.textContent = `${window.location.origin}/v1`;
  elements.apiKeyHelp.textContent = isLoopbackLocation()
    ? "本地访问口令保存在项目的 secrets/gateway_access_token 文件中。请勿将它写进公开代码。"
    : "使用“访问设置”中的网站访问口令。请勿将它写进公开代码。";
  // /v1 uses the site token and exposes shared providers, not account connections.
  const apiProviders = state.providers.filter(provider => !provider.privateConnection && !provider.id.startsWith('mine-'));
  elements.apiModelId.replaceChildren();
  for (const provider of apiProviders) {
    const option = document.createElement("option");
    option.value = provider.id;
    option.textContent = `${provider.label} (${provider.id})`;
    elements.apiModelId.append(option);
  }
  if (!apiProviders.length) {
    const unavailable = new Option('暂无可供外部应用调用的站点模型', '');
    unavailable.disabled = true;
    elements.apiModelId.append(unavailable);
  }
  elements.apiModelId.disabled = apiProviders.length === 0;
  elements.copyApiModelId.disabled = apiProviders.length === 0;
  if (apiProviders.some((provider) => provider.id === elements.providerSelect.value)) {
    elements.apiModelId.value = elements.providerSelect.value;
  }
  elements.apiDialog.showModal();
}

function presetById(id) {
  return [...BUILTIN_PRESETS, ...state.customPresets].find((item) => item.id === id);
}

function renderPresetOptions(selectedId = "current") {
  elements.presetSelect.replaceChildren();
  const current = document.createElement("option");
  current.value = "current";
  current.textContent = "当前对话设定";
  elements.presetSelect.append(current);
  const builtins = document.createElement("optgroup");
  builtins.label = "内置预设";
  const custom = document.createElement("optgroup");
  custom.label = "我的预设";
  for (const preset of [...BUILTIN_PRESETS, ...state.customPresets]) {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.name;
    (preset.id.startsWith("custom-") ? custom : builtins).append(option);
  }
  elements.presetSelect.append(builtins, custom);
  elements.presetSelect.value = presetById(selectedId) ? selectedId : "current";
  const isCustom = elements.presetSelect.value.startsWith("custom-");
  elements.deletePreset.disabled = !isCustom;
  elements.updatePreset.disabled = !isCustom;
}

function openInstructions() {
  const conversation = ensureConversation();
  renderPresetOptions();
  elements.instructionsInput.value = conversation.instructions || "";
  elements.presetName.value = "";
  elements.instructionsDialog.showModal();
}

function saveCustomPreset() {
  const name = elements.presetName.value.replace(/\s+/g, " ").trim();
  const instructions = elements.instructionsInput.value.trim();
  if (!name || !instructions) {
    showToast("请填写预设名称和回答方式。");
    return;
  }
  if (name.length > 40 || instructions.length > getLimits().instructionChars) {
    showToast("预设名称最多 40 字，回答方式超过当前指令字符预算。");
    return;
  }
  if (state.customPresets.length >= getLimits().customPresets) {
    showToast("最多保存 20 个自建预设。请先删除不再使用的预设。");
    return;
  }
  if ([...BUILTIN_PRESETS, ...state.customPresets].some((item) =>
    item.name.toLocaleLowerCase() === name.toLocaleLowerCase()
  )) {
    showToast("已有同名预设，请换一个名称。");
    return;
  }
  const preset = { id: `custom-${createConversationId()}`, name, instructions };
  const next = [...state.customPresets, preset];
  try {
    scopedStorage.setItem(PRESETS_KEY, JSON.stringify(next));
  } catch {
    showToast("浏览器无法保存预设，请检查存储空间或隐私设置。");
    return;
  }
  state.customPresets = next;
  renderPresetOptions(preset.id);
  elements.presetName.value = "";
  showToast("预设已保存在当前浏览器；点击“应用”后用于本次对话。");
}

function deleteCustomPreset() {
  const id = elements.presetSelect.value;
  const preset = state.customPresets.find((item) => item.id === id);
  if (!preset || !window.confirm(`确定删除预设“${preset.name}”吗？`)) return;
  const next = state.customPresets.filter((item) => item.id !== id);
  try {
    scopedStorage.setItem(PRESETS_KEY, JSON.stringify(next));
  } catch {
    showToast("浏览器无法更新预设，请稍后重试。");
    return;
  }
  state.customPresets = next;
  renderPresetOptions();
  elements.instructionsInput.value = activeConversation()?.instructions || "";
  showToast("预设已删除；当前对话的回答方式没有改变。");
}

function updateCustomPreset() {
  const id = elements.presetSelect.value;
  const preset = state.customPresets.find((item) => item.id === id);
  if (!preset) return;
  const name = elements.presetName.value.replace(/\s+/g, " ").trim() || preset.name;
  const instructions = elements.instructionsInput.value.trim();
  if (!instructions || name.length > 40 || instructions.length > getLimits().instructionChars) {
    showToast("回答方式不能为空，名称最多 40 字，回答方式超过当前指令字符预算。");
    return;
  }
  if ([...BUILTIN_PRESETS, ...state.customPresets].some((item) =>
    item.id !== id && item.name.toLocaleLowerCase() === name.toLocaleLowerCase()
  )) {
    showToast("已有同名预设，请换一个名称。");
    return;
  }
  const next = state.customPresets.map((item) =>
    item.id === id ? { id, name, instructions } : item
  );
  try {
    scopedStorage.setItem(PRESETS_KEY, JSON.stringify(next));
  } catch {
    showToast("浏览器无法更新预设，请稍后重试。");
    return;
  }
  state.customPresets = next;
  renderPresetOptions(id);
  elements.presetName.value = "";
  showToast("预设已更新；点击“应用”后用于本次对话。");
}

function applyInstructions() {
  const conversation = ensureConversation();
  const instructions = elements.instructionsInput.value.trim();
  if (instructions.length > getLimits().instructionChars) {
    showToast("回答方式超过当前指令字符预算。");
    return;
  }
  conversation.instructions = instructions;
  conversation.updatedAt = Date.now();
  saveConversations();
  render();
  elements.instructionsDialog.close();
  showToast(instructions ? "回答方式已应用到当前对话。" : "当前对话已恢复默认回答方式。");
}

async function ensurePromptLibrary() {
  if (!state.promptLibraryModule) {
    state.promptLibraryModule = await import("/prompt_library.js");
  }
  if(accountUser&&!promptSync){
    const userId=accountUser.id;
    promptSync=createPromptSync({userId,storage:scopedStorage,isCurrent:()=>accountUser?.id===userId,
      onIdentityChanged:identityChanged,busy:promptEditorDirty,
      changed:()=>{state.promptLibrary=promptSync.list();selectLibraryPrompt(state.selectedPromptId);},
      status:result=>{
        document.querySelector('#prompt-cloud-status').textContent=result.message;
        document.querySelector('#prompt-cloud-migrate').hidden=!result.legacyAvailable;
        document.querySelector('#prompt-cloud-use').hidden=!result.legacy;
        document.querySelector('#prompt-cloud-resolve').hidden=!result.conflict;
      }});
    document.querySelector('#prompt-cloud-sync').hidden=false;
    document.querySelector('#prompt-cloud-sync').onclick=()=>void promptSync.sync();
    document.querySelector('#prompt-cloud-migrate').onclick=()=>void promptSync.resolve('legacy');
    document.querySelector('#prompt-cloud-use').onclick=()=>void promptSync.resolve('cloud');
    document.querySelector('#prompt-cloud-resolve').onclick=()=>void promptSync.resolve('merge');
    window.addEventListener('online',()=>void promptSync.sync());
  }
  state.promptLibrary = promptSync?promptSync.list():state.promptLibraryModule.loadPromptLibrary(scopedStorage);
}

function promptEditorDirty(){
  if(!elements.promptLibraryDialog.open)return false;
  const selected=state.promptLibrary.find(p=>p.id===state.selectedPromptId);
  return elements.libraryPromptTitle.value!==(selected?.title||'')||elements.libraryPromptContent.value!==(selected?.content||'');
}

function persistLibraryPrompts(next){
  return promptSync?promptSync.save(next,state.promptLibrary):state.promptLibraryModule.savePromptLibrary(scopedStorage,next);
}

function selectLibraryPrompt(id) {
  const prompt = state.promptLibrary.find((item) => item.id === id);
  state.selectedPromptId = prompt?.id || "";
  elements.libraryPromptTitle.value = prompt?.title || "";
  elements.libraryPromptContent.value = prompt?.content || "";
  elements.deleteLibraryPrompt.disabled = !prompt;
  renderPromptLibrary();
}

function renderPromptLibrary() {
  if (!state.promptLibraryModule) return;
  const visible = state.promptLibraryModule.searchPrompts(
    state.promptLibrary,
    elements.promptLibrarySearch.value,
    elements.promptLibraryOrder.value,
  );
  elements.promptLibraryList.replaceChildren();
  if (!visible.length) {
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = state.promptLibrary.length ? "没有找到相关提示词。" : "还没有常用提示词，可以在右侧新建。";
    elements.promptLibraryList.append(empty);
  }
  for (const prompt of visible) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `prompt-library-item${prompt.id === state.selectedPromptId ? " active" : ""}`;
    button.setAttribute("aria-pressed", String(prompt.id === state.selectedPromptId));
    const title = document.createElement("strong");
    title.textContent = prompt.title;
    const preview = document.createElement("small");
    preview.textContent = prompt.content.replace(/\s+/g, " ").slice(0, 80);
    button.append(title, preview);
    button.addEventListener("click", () => {
      selectLibraryPrompt(prompt.id);
      elements.promptLibraryList.querySelector('[aria-pressed="true"]')?.focus();
    });
    elements.promptLibraryList.append(button);
  }
  elements.promptLibraryStatus.textContent = `${state.promptLibrary.length} / ${getLimits().prompts} 条`;
}

async function openPromptLibrary() {
  try {
    await ensurePromptLibrary();
    const selectedExists = state.promptLibrary.some((item) => item.id === state.selectedPromptId);
    const selected = selectedExists ? state.selectedPromptId
      : state.promptLibraryModule.orderPrompts(state.promptLibrary, "recent")[0]?.id || "";
    selectLibraryPrompt(selected);
    elements.promptLibraryDialog.showModal();
    void promptSync?.sync();
  } catch (error) {
    showToast(error.message || "无法读取提示词库。");
  }
}

function newLibraryPrompt() {
  state.selectedPromptId = "";
  elements.libraryPromptTitle.value = "";
  elements.libraryPromptContent.value = "";
  elements.deleteLibraryPrompt.disabled = true;
  renderPromptLibrary();
  elements.libraryPromptTitle.focus();
}

function saveLibraryPrompt() {
  try {
    const draft = {
      title: elements.libraryPromptTitle.value,
      content: elements.libraryPromptContent.value,
    };
    let next,nextSelected=state.selectedPromptId;
    if (state.selectedPromptId) {
      next = state.promptLibraryModule.updatePrompt(
        state.promptLibrary, state.selectedPromptId, draft,
      );
    } else {
      const before = new Set(state.promptLibrary.map((item) => item.id));
      next = state.promptLibraryModule.createPrompt(state.promptLibrary, draft);
      nextSelected = next.find((item) => !before.has(item.id))?.id || "";
    }
    state.promptLibrary = persistLibraryPrompts(next);
    selectLibraryPrompt(nextSelected);
    showToast("提示词已保存。" );
  } catch (error) {
    showToast(error.message || "无法保存提示词。");
  }
}

function deleteLibraryPrompt() {
  const prompt = state.promptLibrary.find((item) => item.id === state.selectedPromptId);
  if (!prompt || !window.confirm(`确定删除提示词“${prompt.title}”吗？`)) return;
  try {
    const next = state.promptLibraryModule.deletePrompt(state.promptLibrary, prompt.id);
    state.promptLibrary = persistLibraryPrompts(next);
    const nextId = state.promptLibraryModule.orderPrompts(state.promptLibrary, "recent")[0]?.id || "";
    selectLibraryPrompt(nextId);
    showToast("提示词已删除。" );
  } catch (error) {
    showToast(error.message || "无法删除提示词。");
  }
}

function insertLibraryPrompt() {
  const content = elements.libraryPromptContent.value.trim();
  if (!content) {
    showToast("请先选择提示词，或在内容框中填写文字。");
    return;
  }
  const input = elements.promptInput;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  const before = input.value.slice(0, start);
  const after = input.value.slice(end);
  const leftGap = before && !before.endsWith("\n") ? "\n\n" : "";
  const rightGap = after && !after.startsWith("\n") ? "\n\n" : "";
  const next = `${before}${leftGap}${content}${rightGap}${after}`;
  if (next.length > input.maxLength) {
    showToast("插入后会超过当前输入框字符预算。");
    return;
  }
  input.value = next;
  const cursor = before.length + leftGap.length + content.length;
  input.setSelectionRange(cursor, cursor);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  elements.promptLibraryDialog.close();
  input.focus();
  showToast("提示词已插入输入框。" );
}

function exportPromptLibrary() {
  try {
    const json = state.promptLibraryModule.exportPromptLibrary(state.promptLibrary);
    const url = URL.createObjectURL(new Blob([json], { type: "application/json;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `plaude-chat-提示词-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    elements.promptLibraryStatus.textContent = "提示词文件已下载。";
  } catch (error) {
    showToast(error.message || "无法导出提示词。");
  }
}

async function importPromptLibraryFile() {
  const file = elements.importPromptLibraryFile.files?.[0];
  elements.importPromptLibraryFile.value = "";
  if (!file) return;
  if (!file.name.toLocaleLowerCase().endsWith(".json") || file.size > Math.max(512*1024,getLimits().promptLibraryBytes)) {
    showToast("请选择不超过 512 KiB 的 JSON 提示词文件。");
    return;
  }
  try {
    const plan = state.promptLibraryModule.planPromptImport(await file.text(), state.promptLibrary);
    state.promptLibrary = persistLibraryPrompts(plan.prompts);
    elements.promptLibraryStatus.textContent = `已导入 ${plan.added} 条，跳过重复 ${plan.skipped} 条。`;
    renderPromptLibrary();
  } catch (error) {
    showToast(error.message || "无法导入提示词文件。");
  }
}

function prepareModelParameters() {
  if (state.busy) return;
  const provider = selectedProvider();
  if (!provider) return;
  const parameters = validParameters(activeConversation()?.parameters);
  const capabilities = parameterCapabilities(provider);
  const maxOutput = capabilities.max_output_tokens;
  elements.temperatureRow.hidden = capabilities.temperature !== true;
  elements.topPRow.hidden = capabilities.top_p !== true;
  elements.maxOutputRow.hidden = !maxOutput;
  elements.parameterTemperatureEnabled.checked = parameters.temperature !== undefined && !elements.temperatureRow.hidden;
  elements.parameterTemperature.value = String(parameters.temperature ?? 1);
  elements.parameterTopPEnabled.checked = parameters.top_p !== undefined && !elements.topPRow.hidden;
  elements.parameterTopP.value = String(parameters.top_p ?? 1);
  elements.parameterMaxOutputEnabled.checked = parameters.max_output_tokens !== undefined && !elements.maxOutputRow.hidden;
  elements.parameterMaxOutput.min = String(maxOutput?.min || 1);
  const knownMaximum = Number.isSafeInteger(maxOutput?.max) && maxOutput.max > 0;
  if (knownMaximum) elements.parameterMaxOutput.max = String(maxOutput.max);
  else elements.parameterMaxOutput.removeAttribute('max');
  elements.parameterMaxOutput.value = String(parameters.max_output_tokens ?? (knownMaximum ? maxOutput.max : ''));
  elements.parameterMaxOutput.placeholder = knownMaximum ? String(maxOutput.max) : '填写 Token 数';
  elements.parameterMaxOutputMaximum.disabled = !knownMaximum;
  elements.parameterMaxOutputMaximum.onclick = () => {
    if (!knownMaximum) return;
    elements.parameterMaxOutputEnabled.checked = true;
    elements.parameterMaxOutput.value = String(maxOutput.max);
    elements.parameterMaxOutputEnabled.dispatchEvent(new Event('change', { bubbles: true }));
    elements.parameterMaxOutput.dispatchEvent(new Event('input', { bubbles: true }));
    elements.parameterMaxOutput.focus();
  };
  elements.parameterMaxOutputHint.textContent = knownMaximum
    ? `当前可设上限：${maxOutput.max.toLocaleString()} Tokens。取消勾选使用模型默认值。`
    : '服务商未报告最大值，可手动填写正整数，实际以接口支持为准。取消勾选使用模型默认值。';
  for (const [checkbox, input] of [
    [elements.parameterTemperatureEnabled, elements.parameterTemperature],
    [elements.parameterTopPEnabled, elements.parameterTopP],
    [elements.parameterMaxOutputEnabled, elements.parameterMaxOutput],
  ]) input.disabled = !checkbox.checked;
  elements.parameterHelp.textContent = '设置只影响当前对话，点击保存后生效；上限是允许的最大生成量，不保证模型写满。'
    + (provider.id === 'deepseek' ? ' DeepSeek 的思考 Token 也计入输出额度，思考模式可能忽略随机度设置。' : '');
}

function openModelParameters() {
  if (!state.busy) void workspace.open("parameters");
}

function readModelParameters() {
  if (state.busy) return;
  const capabilities = parameterCapabilities(selectedProvider());
  const result = {};
  const readNumber = (checkbox, input, name, minimum, maximum, integer = false) => {
    if (!checkbox.checked) return true;
    const raw = input.value.trim();
    const value = Number(raw);
    if (!raw || !Number.isFinite(value) || value < minimum || value > maximum
      || (integer && !Number.isSafeInteger(value))) {
      showToast(Number.isFinite(maximum)
        ? `${name}请输入 ${minimum} 到 ${maximum} 之间的${integer ? "整数" : "数字"}。`
        : `${name}请输入不小于 ${minimum} 的安全整数。`);
      input.focus();
      return false;
    }
    return value;
  };
  if (capabilities.temperature === true) {
    const value = readNumber(elements.parameterTemperatureEnabled, elements.parameterTemperature, "随机度", 0, 2);
    if (value === false) return;
    if (value !== true) result.temperature = value;
  }
  if (capabilities.top_p === true) {
    const value = readNumber(elements.parameterTopPEnabled, elements.parameterTopP, "候选范围", 0.01, 1);
    if (value === false) return;
    if (value !== true) result.top_p = value;
  }
  const outputBounds = capabilities.max_output_tokens;
  if (outputBounds) {
    const value = readNumber(elements.parameterMaxOutputEnabled, elements.parameterMaxOutput,
      "单次回复上限", outputBounds.min || 1, outputBounds.max ?? Infinity, true);
    if (value === false) return;
    if (value !== true) result.max_output_tokens = value;
  }
  return result;
}

function applyModelParameters(result) {
  const conversation = ensureConversation();
  conversation.parameters = result;
  conversation.updatedAt = Date.now();
  saveConversations();
  render();
  elements.modelParametersDialog.close();
  showToast(Object.keys(result).length ? "当前对话的模型参数已保存。" : "已使用模型默认参数。");
}

function saveModelParameters() {
  const result = readModelParameters();
  if (result) applyModelParameters(result);
}

function resetModelParameters() {
  if (state.busy) return;
  const conversation = ensureConversation();
  conversation.parameters = {};
  saveConversations();
  render();
  elements.modelParametersDialog.close();
  showToast("已恢复当前对话的默认模型参数。");
}

function saveToken() {
  const token = elements.gatewayToken.value.trim();
  if (token && !tokenTransportIsSafe()) {
    showToast("请通过 HTTPS 打开网站后再保存访问口令。");
    return false;
  }
  return setAccessToken(token);
}

async function loadProviders() {
  try {
    const response = await fetch("/api/providers", {
      cache: "no-store", credentials: "same-origin", headers: { accept: "application/json", ...accountHeaders() },
    });
    const payload = await response.json();
    if (!response.ok || !Array.isArray(payload.providers) || payload.providers.length === 0) {
      throw new Error(payload.error || "没有可用模型");
    }

    state.providers = payload.providers;
    state.contextLimits={maxInputChars:Number.isInteger(payload.limits?.maxInputChars)?payload.limits.maxInputChars:24000,maxMessages:Number.isInteger(payload.limits?.maxMessages)?payload.limits.maxMessages:getLimits().maxMessages};
    requestQueue.setLimit(Number.isInteger(payload.concurrentRequests) ? Math.max(1, Math.min(8, payload.concurrentRequests)) : 2);
    state.defaultProvider = payload.defaultProvider;
    state.features = {
      sharedConversations: payload.features?.sharedConversations === true,
      parallelTasks: payload.features?.parallelTasks !== false,
    };
    if (elements.openSharedConversations) {
      elements.openSharedConversations.disabled = !state.features.sharedConversations;
      elements.openSharedConversations.title = state.features.sharedConversations
        ? "查看和发布所有访问者可见的对话" : "本地后端尚未启用公共对话存储";
    }
    if (elements.openParallelTasks) elements.openParallelTasks.disabled = !state.features.parallelTasks;
    elements.providerSelect.replaceChildren();
    for (const provider of state.providers) {
      const option = document.createElement("option");
      option.value = provider.id;
      option.textContent = provider.label;
      option.title = provider.model;
      elements.providerSelect.append(option);
    }

    const conversation = activeConversation();
    const missingPersonal=conversation?.provider?.startsWith('mine-')&&!state.providers.some(p=>p.id===conversation.provider);
    if(missingPersonal){const unavailable=new Option('个人连接已不可用 · 请重新选择',conversation.provider);unavailable.disabled=true;elements.providerSelect.prepend(unavailable);}
    const selected = missingPersonal?conversation.provider:conversation?.provider && state.providers.some((item) => item.id === conversation.provider)
      ? conversation.provider
      : state.defaultProvider;
    elements.providerSelect.value = selected;
    if (conversation&&!missingPersonal) conversation.provider = selected;
    syncModelOptions(conversation);
    const modelCount = state.providers.reduce((total, provider) =>
      total + modelsFor(provider).length, 0);
    setServiceStatus(
      "online",
      isLoopbackLocation() ? "本地服务已连接" : "网站服务已连接",
      `${state.providers.length} 个服务商 · ${modelCount} 个型号可用`,
    );
    elements.retryConnection.hidden = true;
    render();
    if (accountUser) await privateSync?.sync();
  } catch (error) {
    state.providers = [];
    state.features = { sharedConversations: false, parallelTasks: true };
    elements.providerSelect.replaceChildren();
    const option = document.createElement("option");
    option.textContent = "后端未连接";
    elements.providerSelect.append(option);
    setServiceStatus(
      "offline",
      "无法连接后端",
      isLoopbackLocation() ? "请确认启动窗口仍在运行" : "请稍后重新连接",
    );
    elements.retryConnection.hidden = false;
    showToast(error.message || "无法载入模型，请检查本地后端。");
    updateSendState();
  }
}

function compactMessages(messages, context, projectInput = {}) {
  return prepareChatContext(messages,context,{...state.contextLimits,...projectInput,maxMessages:getLimits().maxMessages,historyBudget:getLimits().historyChars}).messages;
}

function restorePrompt(content) {
  if (!elements.promptInput.value.trim()) {
    elements.promptInput.value = content;
    saveDraft(activeConversation(), content);
    resizeTextarea();
  }
}

async function insertSelectedTextFiles() {
  const files = [...(elements.textFileInput.files || [])];
  elements.textFileInput.value = "";
  await workbench.openFiles(files);
}

async function requestConversation(conversation, userMessage, replacementAssistant = null, options = {}) {
  if (state.backgroundRequests.has(conversation.id)) return;
  const background = options.background === true;
  const controller = new AbortController();
  let partialReply = null, paintTimer, lastSaved = 0, releaseSlot;
  function updatePartial(text) {
    if (!text) return;
    if (!partialReply) {
      partialReply = { role: 'assistant', content: '', createdAt: Date.now(), completion: 'interrupted', streaming: true };
      conversation.messages.push(partialReply);
    }
    if (partialReply.content.length + text.length > getLimits().replyChars) throw new Error('回复超过本次大小限制，已收到的内容已保留。');
    partialReply.content += text;
    conversation.updatedAt = Date.now();
    if (!paintTimer) paintTimer = setTimeout(() => {
      paintTimer = null;
      if (conversation.id !== state.activeId) return;
      const index = conversation.messages.indexOf(partialReply);
      const node = elements.messages.querySelector(`[data-message-index="${index}"] .message-text`);
      const nearBottom = elements.conversation.scrollHeight - elements.conversation.clientHeight - elements.conversation.scrollTop < 140;
      if (node) node.textContent = partialReply.content; else render();
      if (nearBottom) elements.conversation.scrollTop = elements.conversation.scrollHeight;
    }, 80);
    if (partialReply.content.trim() && Date.now() - lastSaved >= 1500) { lastSaved = Date.now(); saveConversations(); }
  }
  state.backgroundRequests.set(conversation.id, controller);
  const task = state.parallelTasks.get(conversation.id) || {};
  state.parallelTasks.set(conversation.id, { ...task, status: 'queued', error: '' });
  renderParallelTaskResults();
  render({ scrollToBottom: conversation.id === state.activeId && !replacementAssistant });

  const headers = {
    "content-type": "application/json",
    accept: "text/event-stream",
    "x-yunjian-ui": "browser",
    ...accountHeaders(),
  };
  let gatewayToken = readAccessToken();

  try {
    const projectInput = await projects.context(conversation);
    const personal=await personalInstructions.prepare({enabled:conversation.context?.usePersonalInstructions!==false,signal:controller.signal});
    const memory=await accountMemory.prepare(userMessage.content,{enabled:conversation.context?.useMemory!==false,signal:controller.signal});
    releaseSlot = await requestQueue.acquire(controller.signal);
    if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    gatewayToken = readAccessToken();
    state.parallelTasks.set(conversation.id, { ...state.parallelTasks.get(conversation.id), status: 'running' });
    renderParallelTaskResults(); renderHistory();
    if (conversation.id === state.activeId) { renderMessages(); updateSendState(); }
    if (gatewayToken && !tokenTransportIsSafe()) {
      throw new Error("当前连接不是 HTTPS，已阻止发送访问口令。");
    }
    if (gatewayToken && !accountUser) headers.authorization = `Bearer ${gatewayToken}`;

    const prepared=prepareChatContext(replacementAssistant?conversation.messages.slice(0,-1):conversation.messages,conversation.context,{...state.contextLimits,...projectInput,maxMessages:getLimits().maxMessages,historyBudget:getLimits().historyChars,memoryChars:memory.chars,memoryCount:memory.entries.length,personalChars:personal.chars});
    state.contextReports.set(conversation.id,prepared.report);
    accountMemory.record(conversation.id,memory.entries);
    const response = await fetchQueuedChat("/api/chat", {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        provider: conversation.provider,
        ...(state.providers.find(p=>p.id===conversation.provider)?.privateConnection?{connectionRevision:state.providers.find(p=>p.id===conversation.provider).connectionRevision}:{}),
        model: conversation.model || undefined,
        parameters: parametersForProvider(
          state.providers.find((item) => item.id === conversation.provider),
          conversation.parameters,
          conversation.model,
        ),
        webSearch: conversation.webSearch === true
          && providerSupportsWebSearch(state.providers.find((item) => item.id === conversation.provider)),
        instructions: projectInput.instructions,
        ...(memory.selection?{memory:memory.selection}:{}),
        ...(personal.selection?{personalInstructions:personal.selection}:{}),
        documents: projectInput.documents,
        messages: prepared.messages,
      }),
    });
    const payload = response.ok && response.headers.get('content-type')?.includes('text/event-stream')
      ? await readChatStream(response, updatePartial, message => { if (conversation.id === state.activeId) elements.liveStatus.textContent = message || '正在生成…'; })
      : await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || `请求失败（${response.status}）`);
      error.status = response.status;
      throw error;
    }
    if (typeof payload.text !== "string" || !payload.text.trim()) {
      throw new Error("模型没有返回可显示的文字。");
    }
    const search = validSearchResult(payload.search);
    const reply = {
      role: "assistant",
      content: payload.text.trim(),
      ...(payload.documentContext ? { documentContext: validateDocumentContext(payload.documentContext) } : {}),
      createdAt: Date.now(),
      ...(payload.finishReason === 'length' ? { completion: 'length' } : {}),
      ...(conversation.provider === "gemini" && search?.used
        ? { groundedAt: Date.now() } : {}),
      ...(search?.enabled ? { search } : {}),
    };
    if (partialReply) {
      Object.assign(partialReply, reply); delete partialReply.streaming;
      if (payload.finishReason !== 'length') delete partialReply.completion;
    } else if (replacementAssistant) {
      const index = conversation.messages.indexOf(replacementAssistant);
      if (index < 0) throw new Error("原回复已变化，请重新操作。");
      conversation.messages.splice(index, 1, reply);
    } else {
      conversation.messages.push(reply);
    }
    conversation.lastUsage = validUsage(payload.usage);
    conversation.updatedAt = Date.now();
    state.parallelTasks.set(conversation.id, { ...state.parallelTasks.get(conversation.id), status: 'done' });
    state.pendingRequests.delete(conversation.id);
    saveConversations();
    void syncPublishedConversation(conversation);
    const providerLabel = state.providers.find((item) => item.id === conversation.provider)?.label || "AI 助手";
    if (conversation.id === state.activeId) {
      setServiceStatus("online", "服务运行正常", providerLabel);
      elements.liveStatus.textContent = search?.used
      ? `${providerLabel} 已联网并完成回复。`
      : search?.enabled
        ? `${providerLabel} 已完成回复，本次未调用搜索。`
        : `${providerLabel} 已完成回复。`;
    } else if (!background) showToast(`“${conversation.title}”已完成回复。`);
  } catch (error) {
    state.parallelTasks.set(conversation.id, { ...state.parallelTasks.get(conversation.id),
      status: error.name === 'AbortError' ? 'cancelled' : 'failed', error: error.status === 401 ? '需要访问口令' : error.message || '任务失败' });
    if (partialReply?.content.trim()) {
      delete partialReply.streaming;
      partialReply.completion = error.name === 'AbortError' ? 'stopped' : 'interrupted';
      conversation.updatedAt = Date.now(); saveConversations();
    } else if (partialReply) {
      conversation.messages = conversation.messages.filter(message => message !== partialReply); partialReply = null;
    }
    if (error.status === 401 && accountUser) {
      saveConversations(false); identityChanged();
    } else if (error.status === 401) {
      state.pendingRequests.set(conversation.id, { conversationId: conversation.id, userMessage, replacementAssistant });
      showToast(gatewayToken
        ? "服务器不接受此浏览器保存的访问口令，请确认服务器口令是否已更换。"
        : "此浏览器尚未保存访问口令，请填写后再重试。");
      openSettings();
    } else {
      state.pendingRequests.delete(conversation.id);
      // Keep the original question in history. A later composer draft belongs to
      // the user and must never be replaced by a failed request's contents.
      conversation.updatedAt = Date.now();
      saveConversations();
      const message = partialReply
        ? error.name === 'AbortError' ? '已停止生成，已收到的回复已保留。' : '生成中断，已收到的回复已保留，可重新生成。'
        : error.name === "AbortError"
        ? replacementAssistant ? "已停止重新生成，原回复已保留。" : "已停止生成，问题已保留，可手动重试。"
        : `${error.message || '请求失败。'} ${replacementAssistant ? '原回复已保留。' : '问题和图片已保留，可点击“重试此问题”。'} 未自动重发。`;
      showToast(conversation.id === state.activeId ? message : `“${conversation.title}”${error.name === 'AbortError' ? '已停止' : '生成失败'}，已保留该对话的内容。`);
      if (conversation.id === state.activeId) elements.liveStatus.textContent = message;
      if (conversation.id === state.activeId && error.name !== "AbortError" && (!error.status || error.status >= 500)) {
        setServiceStatus("offline", "本次请求失败", replacementAssistant ? "可以再次重新生成" : "可以重新发送此消息");
      }
    }
  } finally {
    clearTimeout(paintTimer);
    if (state.backgroundRequests.get(conversation.id) === controller) state.backgroundRequests.delete(conversation.id);
    releaseSlot?.();
    if (accountUser) void privateSync?.sync();
    renderParallelTaskResults();
    if (conversation.id === state.activeId) render();
    else { renderHistory(); updateSendState(); }
    if (!background && conversation.id === state.activeId && !document.querySelector('dialog[open]')) elements.promptInput.focus();
  }
}

async function sendMessage(content, images = []) {
  const selectionIssue=chatSelectionProblem(activeConversation(),selectedProvider(),elements.modelIdSelect.value);
  if(selectionIssue){showToast(selectionIssue);return;}
  let conversation = ensureConversation();
  if (state.sharedIds.has(conversation.id) && !state.sharedEditKeys[conversation.id]) {
    const copied = await copySharedConversation(conversation);
    if (!copied) { saveDraft(conversation, content); if (state.activeId === conversation.id) { restoreDraft(conversation); if (images.length) visionComposer?.setImages(images); } return; }
    conversation = copied;
  }
  if (conversation.id === state.draftBranchId) state.draftBranchId = "";
  conversation.provider = elements.providerSelect.value || state.defaultProvider;
  conversation.model = elements.modelIdSelect.value || "";
  const userMessage = { role: "user", content, createdAt: Date.now(), ...(images.length ? { images } : {}) };
  conversation.messages.push(userMessage);
  if (conversation.messages.length === 1 && !conversation.titleEdited) {
    conversation.title = content.replace(/\s+/g, " ").slice(0, 28) || "新对话";
  }
  conversation.updatedAt = Date.now();
  saveConversations();
  await requestConversation(conversation, userMessage);
}

function renderParallelTaskResults() {
  if (!elements.parallelTaskResults || !elements.parallelTaskSummary) return;
  elements.parallelTaskResults.replaceChildren();
  const tasks = [...state.parallelTasks.entries()];
  const labels = {
    queued: "等待中", running: "运行中", done: "已完成", failed: "失败", cancelled: "已停止",
  };
  for (const [conversationId, task] of tasks) {
    const conversation = state.conversations.find((item) => item.id === conversationId);
    if (!conversation) continue;
    const row = document.createElement("button");
    row.className = "parallel-task-row";
    row.type = "button";
    const copy = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = conversation.title || task.prompt || "并行任务";
    const detail = document.createElement("small");
    detail.textContent = task.error || `${conversation.messages.length} 条消息`;
    copy.append(title, detail);
    const status = document.createElement("span");
    status.className = "parallel-task-state";
    status.textContent = labels[task.status] || "等待中";
    row.append(copy, status);
    row.addEventListener("click", () => {
      selectConversation(conversationId);
      elements.parallelTasksDialog.close();
    });
    elements.parallelTaskResults.append(row);
  }
  const counts = Object.groupBy
    ? Object.groupBy(tasks.map(([, task]) => task), (task) => task.status)
    : null;
  const completed = counts?.done?.length || tasks.filter(([, task]) => task.status === "done").length;
  const failed = tasks.filter(([, task]) => ["failed", "cancelled"].includes(task.status)).length;
  const running = tasks.filter(([, task]) => ["queued", "running"].includes(task.status)).length;
  const activity = document.querySelector('#conversation-activity');
  if (activity) {
    const generating = tasks.filter(([, task]) => task.status === 'running').length;
    const queued = tasks.filter(([, task]) => task.status === 'queued').length;
    activity.hidden = !running;
    activity.textContent = `生成中 ${generating} · 排队 ${queued} · 可切换或新建对话`;
  }
  elements.parallelTaskSummary.textContent = tasks.length
    ? `${tasks.length} 条任务 · ${running} 条进行中 · ${completed} 条完成${failed ? ` · ${failed} 条失败` : ""}`
    : "尚未启动任务";
  elements.startParallelTasks.disabled = state.parallelBatchRunning;
}

function createParallelConversation(prompt, provider, model) {
  const now = Date.now();
  const userMessage = { role: "user", content: prompt, createdAt: now };
  const conversation = {
    id: createConversationId(),
    title: prompt.replace(/\s+/g, " ").slice(0, 28) || "并行任务",
    titleEdited: false,
    pinned: false,
    archived: false,
    provider,
    model,
    parameters: {},
    webSearch: false,
    instructions: "",
    updatedAt: now,
    lastUsage: null,
    messages: [userMessage],
  };
  state.conversations.unshift(conversation);
  state.parallelTasks.set(conversation.id, { prompt, status: "queued" });
  return { conversation, userMessage };
}

async function startParallelTaskBatch() {
  if (state.parallelBatchRunning || state.providers.length === 0) return;
  const prompts = elements.parallelTaskInput.value.split(/\r?\n/)
    .map((item) => item.trim()).filter(Boolean);
  if (prompts.length < 2 || prompts.length > getLimits().parallelTasks) {
    showToast("请填写 当前任务数量预算内的至少2条任务，每行一条。");
    elements.parallelTaskInput.focus();
    return;
  }
  if (prompts.some((item) => item.length > getLimits().promptChars)) {
    showToast(`单条并行任务不能超过 ${getLimits().promptChars} 字。`);
    return;
  }
  const selectionIssue=chatSelectionProblem(activeConversation(),selectedProvider(),elements.modelIdSelect.value);
  if(selectionIssue){showToast(selectionIssue);return;}
  const provider = elements.providerSelect.value || state.defaultProvider;
  const model = elements.modelIdSelect.value || "";
  const jobs = prompts.map((prompt) => createParallelConversation(prompt, provider, model));
  state.parallelBatchRunning = true;
  saveConversations();
  renderParallelTaskResults();
  renderHistory();

  await Promise.all(jobs.map(job => requestConversation(job.conversation, job.userMessage, null, { background: true })));
  state.parallelBatchRunning = false;
  saveConversations();
  renderParallelTaskResults();
  render();
  showToast("并行任务已全部处理，可点击任务查看结果。");
}

function sharedRequestHeaders() {
  const headers = { accept: "application/json" };
  const token = readAccessToken();
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

function sharedConversationPayload(conversation) {
  return {
    id: conversation.id,
    ...(conversation.branch?{branch:validateBranch(conversation.branch,conversation.id)}:{}),
    title: conversation.title || "公开对话",
    author: (elements.sharedAuthorName?.value || "匿名访客").trim() || "匿名访客",
    provider: conversation.provider,
    model: conversation.model,
    titleEdited: conversation.titleEdited,
    pinned: conversation.pinned,
    archived: conversation.archived,
    parameters: conversation.parameters,
    context: conversation.context,
    documents: conversation.documents || [],
    webSearch: conversation.webSearch,
    instructions: conversation.instructions,
    createdAt: conversation.messages[0]?.createdAt || conversation.updatedAt,
    updatedAt: conversation.updatedAt,
    messages: conversation.messages.map(({ role, content, createdAt, groundedAt, completion, images, documentContext, search }) => {
      const normalized = conversation.provider !== 'gemini' ? validSearchResult(search) : null;
      return { role, content, createdAt, groundedAt, completion, ...(documentContext ? { documentContext } : {}), ...(images?.length ? { images } : {}),
        ...(normalized ? { search: { enabled: normalized.enabled, used: normalized.used, sources: normalized.sources, queries: normalized.queries } } : {}) };
    }),
  };
}

async function publishConversation(conversation, quiet = false) {
  if (accountUser) throw Error('个人空间默认私有；如需公开，请先导出并在旧公共空间手动发布。');
  if (!conversation?.messages.length) throw new Error("空对话不能发布。");
  const existingKey = state.sharedEditKeys[conversation.id];
  const editKey = existingKey || createEditKey();
  // Save ownership before the request, so a lost response can be retried safely.
  if (!existingKey) {
    state.sharedEditKeys[conversation.id] = editKey;
    persistSharedEditKeys();
  }
  const snapshot = sharedConversationPayload(conversation);
  const fingerprint = JSON.stringify(snapshot);
  const response = await fetch("/api/shared-conversations", {
    method: "POST",
    headers: { ...sharedRequestHeaders(), "content-type": "application/json" },
    body: JSON.stringify({ conversation: snapshot, editKey }),
    keepalive: new TextEncoder().encode(fingerprint).length < 60_000,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && !quiet) openSettings();
    throw new Error(payload.error || `发布失败（${response.status}）`);
  }
  state.sharedIds.add(conversation.id);
  state.sharedFingerprints.set(conversation.id, fingerprint);
  if (!quiet) showToast("当前对话已发布，所有网站访问者都能看到。");
  return payload.conversation;
}

async function syncPublishedConversation(conversation) {
  void conversation;
  return syncAllConversations();
}

async function syncAllConversations() {
  if (accountUser) return privateSync?.sync();
  // Guest records stay local. Public sharing requires an explicit user action.
}

async function copySharedConversation(shared) {
  const provider = state.providers.find((item) => item.id === shared.provider)
    || state.providers.find((item) => item.id === state.defaultProvider)
    || state.providers[0];
  const model = modelsFor(provider).some((item) => item.id === shared.model)
    ? shared.model : modelsFor(provider)[0]?.id || provider?.model || "";
  const conversation = {
    id: createConversationId(),
    title: `${shared.title} · 续聊副本`.slice(0, 60),
    titleEdited: true,
    pinned: false,
    archived: false,
    provider: provider?.id || state.defaultProvider,
    model,
    parameters: shared.parameters || {},
    documents: validateDocuments(shared.documents), context: normalizeContextSettings(shared.context),
    webSearch: shared.webSearch === true,
    instructions: shared.instructions || "",
    updatedAt: Date.now(),
    lastUsage: null,
    messages: shared.messages.map((message) => ({ ...message })),
  };
  try { await projects.inherit(shared.id, conversation.id); } catch (error) { showToast(error.message); return null; }
  state.conversations.unshift(conversation);
  state.activeId = conversation.id;
  elements.providerSelect.value = conversation.provider;
  syncModelOptions(conversation);
  saveConversations();
  render({ scrollToBottom: true });
  elements.sharedConversationsDialog.close();
  showToast("公共对话已复制到你的本地对话，可以继续提问。");
  return conversation;
}

function renderSharedConversations() {
  elements.sharedConversationsList.replaceChildren();
  if (!state.sharedConversations.length) {
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = "没有旧公共记录。新聊天默认保存在本机或登录后的个人空间。";
    elements.sharedConversationsList.append(empty);
    return;
  }
  for (const shared of state.sharedConversations) {
    const card = document.createElement("article");
    card.className = "shared-conversation-card";
    const header = document.createElement("div");
    header.className = "shared-card-header";
    const heading = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = shared.title;
    const metadata = document.createElement("small");
    metadata.textContent = `${shared.author} · ${new Date(shared.updatedAt).toLocaleString("zh-CN")} · ${shared.messages.length} 条消息`;
    heading.append(title, metadata);
    header.append(heading);
    const preview = document.createElement("p");
    preview.className = "shared-card-preview";
    preview.textContent = shared.messages[0]?.content || "";
    const messages = document.createElement("div");
    messages.className = "shared-card-messages";
    messages.hidden = true;
    for (const message of shared.messages) {
      const block = document.createElement("div");
      block.className = "shared-card-message";
      const author = document.createElement("b");
      author.textContent = message.role === "user" ? "提问：" : "回答：";
      block.append(author, document.createTextNode(message.content));
      messages.append(block);
    }
    const actions = document.createElement("div");
    actions.className = "shared-card-actions";
    const view = document.createElement("button");
    view.className = "secondary-button";
    view.type = "button";
    view.textContent = "展开查看";
    view.addEventListener("click", () => {
      messages.hidden = !messages.hidden;
      view.textContent = messages.hidden ? "展开查看" : "收起";
    });
    const copy = document.createElement("button");
    copy.className = "secondary-button";
    copy.type = "button";
    copy.textContent = "复制到我的对话";
    copy.addEventListener("click", () => copySharedConversation(shared));
    actions.append(view, copy);
    if (state.sharedEditKeys[shared.id]) {
      const remove = document.createElement("button");
      remove.className = "secondary-button";
      remove.type = "button";
      remove.textContent = "归档并保留";
      remove.addEventListener("click", () => { void deleteSharedConversation(shared); });
      actions.append(remove);
    }
    card.append(header, preview, actions, messages);
    elements.sharedConversationsList.append(card);
  }
}

async function loadSharedConversations() {
  elements.sharedConversationsStatus.textContent = "正在载入公共对话…";
  try {
    const response = await fetch("/api/shared-conversations", { headers: sharedRequestHeaders() });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) openSettings();
      throw new Error(payload.error || `载入失败（${response.status}）`);
    }
    state.sharedConversations = Array.isArray(payload.conversations) ? payload.conversations : [];
    if (accountUser) { renderSharedConversations(); elements.sharedConversationsStatus.textContent = '旧公共记录 · 复制到个人空间会创建私有副本，原公开记录仍保留'; return; }
    for (const shared of state.sharedConversations) {
      if (state.backgroundRequests.has(shared.id)) continue;
      state.sharedIds.add(shared.id);
      let local = state.conversations.find((item) => item.id === shared.id);
      if (local && !state.sharedEditKeys[shared.id]
        && !local.messages.every((message, index) => shared.messages[index]?.role === message.role
          && shared.messages[index]?.content === message.content
          && JSON.stringify(shared.messages[index]?.images || []) === JSON.stringify(message.images || []))) {
        const oldId = local.id;
        local.id = createConversationId();
        local.title = `${local.title} · 恢复副本`.slice(0, 60);
        if (state.activeId === oldId) state.activeId = local.id;
        local = undefined;
      }
      if (local && state.sharedEditKeys[shared.id] && (state.sharedSyncRunning
        || local.updatedAt > shared.updatedAt || local.messages.length > shared.messages.length)) continue;
      const restored = {
        id: shared.id, title: shared.title, titleEdited: shared.titleEdited === true,
        pinned: shared.pinned === true, archived: shared.archived === true || local?.archived === true,
        provider: shared.provider, model: shared.model, parameters: shared.parameters || {},
        documents: validateDocuments(shared.documents), context: normalizeContextSettings(shared.context), instructions: shared.instructions || "",
        webSearch: shared.webSearch === true, updatedAt: shared.updatedAt,
        lastUsage: local?.lastUsage || null, messages: shared.messages.map((message) => ({ ...message })),
      };
      if (local) Object.assign(local, restored);
      else state.conversations.push(restored);
      state.sharedFingerprints.set(shared.id, JSON.stringify(sharedConversationPayload(restored)));
    }
    if (!activeConversation()?.messages.length && !activeConversation()?.documents?.length && !elements.promptInput.value.trim() && !visionComposer?.images().length) {
      const restored = state.conversations.filter((item) => item.messages.length && !item.archived)
        .sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (restored) {
        state.activeId = restored.id;
        if (state.providers.some((item) => item.id === restored.provider)) elements.providerSelect.value = restored.provider;
        syncModelOptions(restored);
      }
    }
    saveConversations();
    render();
    elements.sharedConversationsStatus.textContent = `共 ${state.sharedConversations.length} 条公开对话 · 所有网站访问者可见`;
    renderSharedConversations();
  } catch (error) {
    elements.sharedConversationsStatus.textContent = error.message || "无法载入公共对话。";
  }
}

async function deleteSharedConversation(shared) {
  if (!window.confirm(`归档“${shared.title}”？完整记录仍会保留。`)) return;
  const response = await fetch(`/api/shared-conversations/${encodeURIComponent(shared.id)}`, {
    method: "DELETE",
    headers: { ...sharedRequestHeaders(), "content-type": "application/json" },
    body: JSON.stringify({ editKey: state.sharedEditKeys[shared.id] }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    showToast(payload.error || "无法删除公共对话。");
    return;
  }
  await loadSharedConversations();
  showToast("已归档，完整记录保留。");
}

async function regenerateLastReply() {
  const sourceId = state.activeId;
  if (state.busy || state.regeneratingIds.has(sourceId) || state.branchingIds.has(sourceId)) return;
  state.regeneratingIds.add(sourceId);
  renderMessages();
  try {
    let conversation = activeConversation();
    if (conversation && state.sharedIds.has(conversation.id) && !state.sharedEditKeys[conversation.id]) {
      conversation = await copySharedConversation(conversation);
      if (!conversation) return;
    }
    const messages = conversation?.messages;
    const replacementAssistant = messages?.at(-1);
    const userMessage = messages?.at(-2);
    if (replacementAssistant?.role !== "assistant" || userMessage?.role !== "user") return;
    const branch = { ...conversation, id: createConversationId(), title: `${conversation.title.slice(0, 45)} · 重新生成`,
      branch:branchOrigin(conversation,conversation.messages.length-1,'regenerate'),
      pinned: false, archived: false, updatedAt: Date.now(), lastUsage: null,
      messages: conversation.messages.slice(0, -1).map(message => ({ ...message })) };
    try { await projects.inherit(conversation.id, branch.id); } catch (error) { showToast(error.message); return; }
    const activate = state.activeId === conversation.id;
    state.conversations.unshift(branch);
    if (activate) state.activeId = branch.id;
    saveConversations();
    showToast(activate ? '已创建重新生成分支，原对话和回复继续保留。' : '正在后台重新生成，可在对话历史中打开新版本；当前草稿保持不变。');
    void requestConversation(branch, branch.messages.at(-1), null, { background: !activate });
  } finally {
    state.regeneratingIds.delete(sourceId);
    renderMessages();
  }
}

elements.composer.addEventListener("submit", (event) => {
  event.preventDefault();
  voiceComposer?.cancel('语音输入已停止。');
  if (state.busy) {
    state.requestController?.abort();
    return;
  }
  const images = visionComposer?.images() || [];
  if (navigator.onLine === false) { showToast('当前处于离线状态，草稿和图片已保留，请联网后手动发送。'); return; }
  const content = elements.promptInput.value.trim() || (images.length ? '请描述并分析图片内容。' : '');
  if (!content || state.providers.length === 0) return;
  const conversation = activeConversation();
  const selectionIssue=chatSelectionProblem(conversation,selectedProvider(),elements.modelIdSelect.value);
  if(selectionIssue){showToast(selectionIssue);elements.liveStatus.textContent=selectionIssue;return;}
  try {
    validateImages(images);
    const context = compactMessages([...(conversation?.messages || []), { role: 'user', content, images }], conversation?.context,previewProjectInput(conversation));
    if (context.some(message => message.images?.length)) {
      if (!selectedModelSupportsImages()) throw new Error('当前上下文含图片，请选择标有“看图”的型号；也可新建对话或清除上下文后进行纯文字提问。');
      if (conversation?.webSearch) throw new Error('图片对话暂不同时联网搜索，请先关闭联网搜索。');
    }
    const storedSize = [...(conversation?.messages || []), { content, images }].reduce((total, message) => total + message.content.length + (message.images || []).reduce((n, image) => n + image.dataUrl.length, 0), 0);
    if (storedSize > getLimits().conversationChars - getLimits().promptChars) throw new Error('当前对话附件较多，请新建对话后发送；已有记录会保留。');
  } catch (error) { showToast(error.message); return; }
  if (images.length && !visionComposer.setImages([])) return;
  clearDraft(activeConversation());
  elements.promptInput.value = "";
  resizeTextarea();
  updateSendState();
  void sendMessage(content, images);
});

elements.promptInput.addEventListener("input", () => {
  saveDraft();
  resizeTextarea();
  updateSendState();
});

elements.attachTextButton.addEventListener("click", () => elements.textFileInput.click());
elements.textFileInput.addEventListener("change", () => { void insertSelectedTextFiles(); });

elements.promptInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey
    && (workspacePreferences().sendKey === "ctrl-enter" ? event.ctrlKey || event.metaKey : !event.ctrlKey && !event.metaKey)
    && !event.isComposing && event.keyCode !== 229 && !event.altKey && !state.busy) {
    event.preventDefault();
    elements.composer.requestSubmit();
  }
});

elements.providerSelect.addEventListener("change", () => {
  const pendingImages = visionComposer?.images() || [];
  const pendingText = elements.promptInput.value;
  syncModelOptions(null);
  const conversation = activeConversation();
  if (conversation && conversation.messages.length === 0) {
    conversation.provider = elements.providerSelect.value;
    conversation.model = elements.modelIdSelect.value;
    conversation.parameters = {};
    saveConversations();
  } else if (conversation?.messages.length) {
    createConversation();
    if (pendingImages.length) { visionComposer.setImages(pendingImages); restorePrompt(pendingText); }
    showToast("已为新服务商开启对话，可在上方选择具体型号。");
  }
  render();
});

elements.webSearchToggle?.addEventListener("change", () => {
  const provider = selectedProvider();
  if (!providerSupportsWebSearch(provider) || state.busy) {
    syncWebSearchControl();
    return;
  }
  const conversation = ensureConversation();
  conversation.webSearch = elements.webSearchToggle.checked;
  conversation.updatedAt = Date.now();
  saveConversations();
  syncWebSearchControl(conversation);
  showToast(conversation.webSearch
    ? provider.capabilities?.searchEngine && provider.capabilities.searchEngine !== "builtin"
      ? "已开启独立搜索；搜索资料会发送给所选模型，并显示来源。"
      : provider.id === "gemini"
      ? "已开启 Google 搜索；当前对话会发送给 Google，搜索与模型调用会产生额外用量。"
      : provider.id === "openrouter"
        ? `已开启 OpenRouter 联网搜索；${getLimits().searchUses?`每次回答最多搜索 ${getLimits().searchUses} 次`:'本站不另设搜索次数，实际依服务商'}，服务商可能计费。`
        : "已开启联网搜索；当前对话会发送给服务商，并可能产生多次搜索费用。"
    : "已关闭当前对话的联网搜索。");
});

elements.modelIdSelect.addEventListener("change", () => {
  const pendingImages = visionComposer?.images() || [];
  const pendingText = elements.promptInput.value;
  const provider = selectedProvider();
  if (!modelsFor(provider).some((model) => model.id === elements.modelIdSelect.value)) {
    syncModelOptions(activeConversation());
    showToast("请从当前账号可用的型号列表中选择。");
    elements.modelIdSelect.focus();
    return;
  }
  const conversation = activeConversation();
  if (conversation && conversation.messages.length === 0) {
    conversation.model = elements.modelIdSelect.value;
    saveConversations();
  } else if (conversation?.messages.length) {
    createConversation();
    if (pendingImages.length) { visionComposer.setImages(pendingImages); restorePrompt(pendingText); }
    showToast("已为所选型号开启新对话，原对话仍保留。");
  }
  elements.modelNote.textContent = modelNoteText(selectedProvider(), elements.modelIdSelect.value);
  render();
});

elements.openModelParameters.addEventListener("click", openModelParameters);
elements.openModelPicker.addEventListener("click", openModelPicker);
elements.openModelDirectory.addEventListener("click", openModelPicker);
elements.closeModelPicker.addEventListener("click", () => elements.modelPickerDialog.close());
elements.modelPickerInput.addEventListener("input", renderModelPicker);
elements.modelPickerFavorites.addEventListener("change", renderModelPicker);
elements.closeModelParameters.addEventListener("click", () => elements.modelParametersDialog.close());
elements.saveModelParameters.addEventListener("click", saveModelParameters);
elements.resetModelParameters.addEventListener("click", resetModelParameters);
for (const [checkbox, input] of [
  [elements.parameterTemperatureEnabled, elements.parameterTemperature],
  [elements.parameterTopPEnabled, elements.parameterTopP],
  [elements.parameterMaxOutputEnabled, elements.parameterMaxOutput],
]) checkbox.addEventListener("change", () => {
  input.disabled = !checkbox.checked;
  if (checkbox.checked) input.focus();
});

elements.newChat.addEventListener("click", () => {
  createConversation();
});

elements.historySearch?.addEventListener("input", renderHistory);
initHistoryMenu(elements.historyList);
elements.historySearch?.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && elements.historySearch.value) {
    event.preventDefault();
    event.stopPropagation();
    elements.historySearch.value = "";
    renderHistory();
  }
});
elements.historyActiveFilter?.addEventListener("click", () => {
  state.historyMode = "active";
  renderHistory();
});
elements.historyArchivedFilter?.addEventListener("click", () => {
  state.historyMode = "archived";
  renderHistory();
});
elements.exportChat.addEventListener("click", exportConversation);
elements.archiveChat?.addEventListener("click", () => toggleArchivedConversation());
elements.fontToggle.addEventListener("click", () => {
  const current = document.documentElement.dataset.font || "default";
  const next = FONT_CHOICES[(FONT_CHOICES.indexOf(current) + 1) % FONT_CHOICES.length];
  applyFontChoice(next);
  try {
    scopedStorage.setItem(FONT_KEY, next);
  } catch {
    showToast("字体已切换，但当前浏览器无法保存偏好。");
  }
});
elements.conversation.addEventListener("scroll", updateJumpLatestVisibility, { passive: true });
elements.jumpLatest.addEventListener("click", () => {
  elements.conversation.scrollTo({ top: elements.conversation.scrollHeight, behavior: "smooth" });
});
elements.deleteCurrentChat?.addEventListener("click", () => {
  if (state.activeId) deleteConversation(state.activeId);
});

elements.clearHistory.addEventListener("click", () => {
  if (state.busy || state.backgroundRequests.size > 0
    || !state.conversations.some(hasConversationContent)) return;
  if (!window.confirm("将全部对话归档？完整记录保留，可在“已归档”中恢复。")) return;
  for (const conversation of state.conversations) {
    if (!hasConversationContent(conversation)) continue;
    conversation.archived = true;
    conversation.updatedAt = Date.now();
  }
  state.activeId = "";
  saveConversations();
  createConversation();
});

for (const suggestion of elements.suggestions) {
  suggestion.addEventListener("click", () => {
    elements.promptInput.value = suggestion.dataset.prompt || "";
    saveDraft(activeConversation(), elements.promptInput.value);
    resizeTextarea();
    updateSendState();
    elements.promptInput.focus();
  });
}

elements.menuButton.addEventListener("click", openSidebar);
elements.workspaceMenuButton?.addEventListener("click", (event) => {
  event.stopPropagation();
  void workspace.open("connections");
});
elements.workspaceMenuButton?.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    void workspace.open("connections");
  }
});
elements.workspaceMenu?.addEventListener("click", (event) => {
  if (event.target.closest("button")) {
    setWorkspaceMenu(false);
    requestAnimationFrame(() => {
      if (![...document.querySelectorAll("dialog")].some((dialog) => dialog.open)) {
        elements.workspaceMenuButton.focus();
      }
    });
  }
});
elements.workspaceMenu?.addEventListener("keydown", (event) => {
  const items = [...elements.workspaceMenu.querySelectorAll("input:not(:disabled), button:not(:disabled)")];
  const index = items.indexOf(document.activeElement);
  if (event.key === "Escape") {
    event.preventDefault();
    setWorkspaceMenu(false);
    elements.workspaceMenuButton.focus();
  } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) && items.length) {
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
      : event.key === "ArrowDown" ? (index + 1) % items.length
        : (index - 1 + items.length) % items.length;
    items[next].focus();
  }
});
document.addEventListener("click", (event) => {
  if (!elements.workspaceMenu?.hidden
    && !elements.workspaceMenu.contains(event.target)
    && !elements.workspaceMenuButton.contains(event.target)) setWorkspaceMenu(false);
});
elements.sidebarClose.addEventListener("click", () => closeSidebar(true));
elements.sidebarBackdrop.addEventListener("click", () => closeSidebar(true));
elements.openSettings.addEventListener("click", openSettings);
elements.openApiAccess.addEventListener("click", openApiAccess);
elements.openInstructions.addEventListener("click", openInstructions);
elements.openConversationSearch.addEventListener("click", openConversationSearch);
elements.closeConversationSearch.addEventListener("click", () => elements.conversationSearchDialog.close());
elements.conversationSearchInput.addEventListener("input", renderConversationSearch);
elements.conversationSearchRole.addEventListener("change", renderConversationSearch);
elements.openContextSettings.addEventListener("click", openContextSettings);
elements.closeContextSettings.addEventListener("click", () => elements.contextSettingsDialog.close());
elements.saveContextSettings.addEventListener("click", () => saveContextSettings());
elements.resetChatContext.addEventListener("click", () => saveContextSettings("reset"));
elements.restoreChatContext.addEventListener("click", () => saveContextSettings("restore"));
window.addEventListener("pagehide", stopReading);
elements.openPromptLibrary?.addEventListener("click", () => { void openPromptLibrary(); });
elements.closePromptLibrary?.addEventListener("click", () => elements.promptLibraryDialog.close());
elements.openParallelTasks?.addEventListener("click", () => {
  renderParallelTaskResults();
  elements.parallelTasksDialog.showModal();
  if (!state.parallelBatchRunning) elements.parallelTaskInput.focus();
});
elements.closeParallelTasks?.addEventListener("click", () => elements.parallelTasksDialog.close());
elements.clearParallelTasks?.addEventListener("click", () => {
  if (state.parallelBatchRunning) return;
  elements.parallelTaskInput.value = "";
  state.parallelTasks = new Map([...state.parallelTasks].filter(([id]) => state.backgroundRequests.has(id)));
  renderParallelTaskResults();
  elements.parallelTaskInput.focus();
});
elements.startParallelTasks?.addEventListener("click", () => { void startParallelTaskBatch(); });
elements.openSharedConversations?.addEventListener("click", () => {
  if (!state.features.sharedConversations) {
    showToast("本地后端尚未启用公共对话存储。");
    return;
  }
  try {
    elements.sharedAuthorName.value = scopedStorage.getItem(SHARED_AUTHOR_KEY) || "";
  } catch {
    elements.sharedAuthorName.value = "";
  }
  elements.publishCurrentConversation.disabled = Boolean(accountUser) || !activeConversation()?.messages.length;
  elements.sharedConversationsDialog.showModal();
  void loadSharedConversations();
});
elements.closeSharedConversations?.addEventListener("click", () => elements.sharedConversationsDialog.close());
elements.sharedAuthorName?.addEventListener("change", () => {
  try {
    scopedStorage.setItem(SHARED_AUTHOR_KEY, elements.sharedAuthorName.value.trim().slice(0, 30));
  } catch {
    showToast("浏览器无法保存公开昵称。");
  }
});
elements.refreshSharedConversations?.addEventListener("click", () => { void loadSharedConversations(); });
elements.publishCurrentConversation?.addEventListener("click", async () => {
  const conversation = activeConversation();
  if (!conversation?.messages.length) return;
  if (state.sharedIds.has(conversation.id) && !state.sharedEditKeys[conversation.id]) {
    showToast("这条共享记录已保存；继续提问会创建续聊副本。");
    return;
  }
  elements.publishCurrentConversation.disabled = true;
  try {
    await publishConversation(conversation);
    await loadSharedConversations();
  } catch (error) {
    showToast(error.message || "无法发布当前对话。");
  } finally {
    elements.publishCurrentConversation.disabled = false;
  }
});
elements.publishAllConversations?.addEventListener("click", async () => {
  const conversations = state.conversations.filter((item) => item.messages.length > 0);
  if (!conversations.length) {
    showToast("本地还没有可发布的对话。");
    return;
  }
  elements.publishAllConversations.disabled = true;
  let succeeded = 0;
  let failed = 0;
  for (const conversation of conversations) {
    if (state.sharedIds.has(conversation.id) && !state.sharedEditKeys[conversation.id]) continue;
    try {
      await publishConversation(conversation, true);
      succeeded += 1;
    } catch {
      failed += 1;
    }
    elements.sharedConversationsStatus.textContent = `正在发布：${succeeded + failed}/${conversations.length}`;
  }
  elements.publishAllConversations.disabled = false;
  await loadSharedConversations();
  showToast(`已发布 ${succeeded} 条对话${failed ? `，${failed} 条失败` : ""}。`);
});
elements.promptLibrarySearch?.addEventListener("input", renderPromptLibrary);
elements.promptLibraryOrder?.addEventListener("change", renderPromptLibrary);
elements.newLibraryPrompt?.addEventListener("click", newLibraryPrompt);
elements.saveLibraryPrompt?.addEventListener("click", saveLibraryPrompt);
elements.deleteLibraryPrompt?.addEventListener("click", deleteLibraryPrompt);
elements.insertLibraryPrompt?.addEventListener("click", insertLibraryPrompt);
elements.exportPromptLibrary?.addEventListener("click", exportPromptLibrary);
elements.importPromptLibraryFile?.addEventListener("change", () => { void importPromptLibraryFile(); });
elements.closeInstructions.addEventListener("click", () => elements.instructionsDialog.close());
elements.presetSelect.addEventListener("change", () => {
  const selected = elements.presetSelect.value;
  const isCustom = selected.startsWith("custom-");
  elements.deletePreset.disabled = !isCustom;
  elements.updatePreset.disabled = !isCustom;
  elements.presetName.value = "";
  elements.instructionsInput.value = selected === "current"
    ? activeConversation()?.instructions || "" : presetById(selected)?.instructions || "";
});
elements.instructionsInput.addEventListener("input", () => {
  if (!elements.presetSelect.value.startsWith("custom-")) {
    elements.presetSelect.value = "current";
    elements.deletePreset.disabled = true;
    elements.updatePreset.disabled = true;
  }
});
elements.savePreset.addEventListener("click", saveCustomPreset);
elements.deletePreset.addEventListener("click", deleteCustomPreset);
elements.updatePreset.addEventListener("click", updateCustomPreset);
elements.applyInstructions.addEventListener("click", applyInstructions);
elements.closeApiAccess.addEventListener("click", () => elements.apiDialog.close());
elements.copyApiBaseUrl.addEventListener("click", async () => {
  const copied = await copyText(elements.apiBaseUrl.textContent);
  showToast(copied ? "Base URL 已复制。" : "复制失败，请手动选择地址。");
});
elements.copyApiModelId.addEventListener("click", async () => {
  if (!elements.apiModelId.value) return;
  const copied = await copyText(elements.apiModelId.value);
  showToast(copied ? "模型 ID 已复制。" : "复制失败，请手动输入模型 ID。");
});
elements.retryConnection.addEventListener("click", () => {
  elements.retryConnection.disabled = true;
  void loadProviders().finally(() => {
    elements.retryConnection.disabled = false;
  });
});

elements.settingsForm.addEventListener("submit", (event) => {
  if (event.submitter?.value !== "cancel") {
    if (!saveToken()) {
      event.preventDefault();
      return;
    }
    const hasToken = Boolean(elements.gatewayToken.value.trim());
    if (hasToken) void loadSharedConversations().then(syncAllConversations);
    showToast(hasToken ? "访问口令已保存在此浏览器。" : "未保存访问口令。");
    if (hasToken && state.pendingRequests.size) showToast('访问口令已保存，请回到问题点击“重试此问题”。');
  }
});

elements.removeToken.addEventListener("click", () => {
  setAccessToken("");
  elements.gatewayToken.value = "";
  showToast("访问口令已从此浏览器移除。");
});

// Wait for active chat and cloud work; preserve the imported library until reload.
window.addEventListener('plaude-before-backup-import', event => {
  if (state.branchingIds.size || state.regeneratingIds.size || state.backgroundRequests.size || privateSync?.running) event.preventDefault();
});
window.addEventListener('plaude-backup-imported', () => {
  state.backupImportPending = true;
});

window.addEventListener("keydown", (event) => {
  if (event.isComposing || event.keyCode === 229) return;
  if (elements.body.classList.contains('sidebar-open') && !document.querySelector('dialog[open]')) {
    trapSidebarTab(event, elements.sidebar);
  }
  if (event.key === "Escape" && !elements.workspaceMenu?.hidden) {
    setWorkspaceMenu(false);
    elements.workspaceMenuButton.focus();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.isComposing && !document.querySelector("dialog[open]")) {
    if (event.shiftKey && event.key.toLowerCase() === "f") {
      event.preventDefault();
      openConversationSearch();
      return;
    }
    if (!event.shiftKey && event.key.toLowerCase() === "k" && elements.historySearch) {
      event.preventDefault();
      if(modernUI){modernUI.openSearch();return;}
      if (mobileSidebarMedia.matches) openSidebar();
      elements.historySearch.focus();
      elements.historySearch.select();
      return;
    }
    if (event.shiftKey && event.key.toLowerCase() === "o") {
      event.preventDefault();
      createConversation();
      return;
    }
  }
  if (event.key === "Escape" && elements.body.classList.contains("sidebar-open") && !document.querySelector('dialog[open]')) {
    closeSidebar(true);
  }
});

mobileSidebarMedia.addEventListener("change", () => setSidebar(false));

function insertReviewedDocument(text, images = [], documents = []) {
  if (state.busy || activeBackgroundRequest()) { showToast("请等待当前回复完成。"); return false; }
  try {
    const previousDraftKey = draftKey(activeConversation());
    const next = text ? appendDraftText(elements.promptInput.value, text, elements.promptInput.maxLength) : elements.promptInput.value;
    const library = validateDocuments([...(activeConversation()?.documents || []), ...documents]);
    if (images.length && !visionComposer.setImages([...visionComposer.images(), ...images])) return false;
    if (documents.length) {
      const oldKey = draftKey(activeConversation()), draftImages = visionComposer.images();
      const conversation = ensureConversation(); conversation.documents = library;
      if (oldKey !== draftKey(conversation) && draftImages.length) {
        if (!visionComposer.setImages(draftImages, draftKey(conversation))) { conversation.documents = library.slice(0, -documents.length); return false; }
        visionComposer.setImages([], oldKey);
      }
      conversation.updatedAt = Date.now(); saveConversations(); render();
      showToast('资料已加入当前对话，请输入问题；点击文件名可暂停引用。');
    }
    // The first document gives this draft a stable chat ID; save one owned copy.
    if (previousDraftKey !== draftKey(activeConversation())) delete state.drafts[previousDraftKey];
    elements.promptInput.value = next; saveDraft(activeConversation(), next);
    resizeTextarea(); updateSendState(); return true;
  } catch (error) { showToast(error.message); return false; }
}

projects = initProjectWorkspace({
  currentAccount: () => accountUser,
  changed: () => { saveConversations(); render(); },
  active: activeConversation, conversations: () => state.conversations, create: createConversation,
  select: selectConversation, busy: () => state.backgroundRequests.size > 0, toast: showToast,
});

visionComposer = initVisionComposer({
  context: () => draftKey(activeConversation()), supported: selectedModelSupportsImages, toast: showToast,
  changed: updateSendState, busy: () => state.busy || Boolean(activeBackgroundRequest()),
});

voiceComposer = initVoiceComposer({
  context: () => state.activeId, busy: () => state.busy || Boolean(activeBackgroundRequest()),
  changed: () => { saveDraft(); resizeTextarea(); updateSendState(); },
});

workbench = initWorkbench({
  copy: copyText, toast: showToast, render: () => render(), find: openConversationSearch, editPreset: openInstructions,
  busy: () => state.busy || Boolean(activeBackgroundRequest()), context: () => draftKey(activeConversation()),
  ocrLanguage: () => workspacePreferences().ocrLanguage || 'chi_sim+eng', insert: insertReviewedDocument,
  visionSupported: selectedModelSupportsImages,
  setPreset: id => {
    if (state.busy || activeBackgroundRequest()) return;
    const preset = presetById(id);
    if (!preset) { openInstructions(); return; }
    const conversation = ensureConversation(); conversation.instructions = preset.instructions;
    conversation.updatedAt = Date.now(); saveConversations(); render(); showToast(`已应用“${preset.name}”，下次提问生效。`);
  },
});

const executionConsole = initExecutionConsole({
  headers: () => {
    if (readAccessToken() && !tokenTransportIsSafe()) throw Error('请使用 HTTPS 连接网站。');
    return { ...(accountUser ? accountHeaders() : sharedRequestHeaders()), 'content-type': 'application/json' };
  },
  authenticate: () => accountUser ? identityChanged() : openSettings(), insert: insertReviewedDocument, toast: showToast,
});
let modelConnections;
workspace = initWorkspace({
  openPersonalConnections:accountUser?()=>modelConnections?.open():undefined,
  openLogs: executionConsole.openLogs,
  prepareParameters: prepareModelParameters,
  readParameters: readModelParameters,
  applyParameters: applyModelParameters,
  currentModel: () => ({ id: elements.modelIdSelect.value, provider: elements.providerSelect.value,
    parameters: parameterCapabilities(selectedProvider()),
    maxOutput: parameterCapabilities(selectedProvider())?.max_output_tokens?.max }),
  providers: () => state.providers,
  applyFont: applyFontChoice,
  reloadProviders: loadProviders,
  toast: showToast,
  busy: () => state.busy || Boolean(activeBackgroundRequest()) || state.backgroundRequests.size > 0,
  insertDocument: insertReviewedDocument,
});
const searchLabel = elements.webSearchToggle.closest("label");
searchLabel.removeAttribute("role"); elements.webSearchToggle.removeAttribute("role");
searchLabel.classList.add("topbar-search-toggle");
const searchControl = document.createElement("div"); searchControl.className = "topbar-search-control";
searchControl.append(searchLabel);
const searchSettings = document.createElement("button"); searchSettings.type = "button";
searchSettings.className = "text-button"; searchSettings.textContent = "⌄";
searchSettings.setAttribute("aria-label", "配置联网搜索"); searchSettings.title = "配置联网搜索";
searchSettings.addEventListener("click", () => { void workspace.open("general"); });
searchControl.append(searchSettings);
elements.workspaceMenuButton.closest(".workspace-control").before(searchControl);
elements.workspaceMenuButton.setAttribute("aria-haspopup", "dialog");
elements.workspaceMenuButton.setAttribute("aria-controls", "workspace-dialog");
const attachmentInput = elements.textFileInput;
attachmentInput.accept = ".txt,.md,.csv,.json,.pdf,.docx,.png,.jpg,.jpeg,.webp";
elements.attachTextButton.title = "添加文档或图片；图片支持直接看图或 OCR";
elements.attachTextButton.setAttribute("aria-label", "添加文档或图片");

for(const id of ['prompt-input','parallel-task-input'])document.getElementById(id).maxLength=getLimits().promptChars;
 document.getElementById('instructions-input').maxLength=getLimits().instructionChars;
 document.getElementById('library-prompt-content').maxLength=getLimits().promptText;
 for(let n=11;n<=getLimits().historyTurns;n++)elements.contextHistoryTurns.append(new Option(n+'轮历史',String(n)));
 document.getElementById('parallel-tasks-description').textContent=`每行一个独立任务，最多${getLimits().parallelTasks}条；按站点并发额度运行，其余排队。`;
 applyFontChoice(loadFontChoice());
const initialNewDraft = state.drafts['new-conversation'] || '';
const hasNewDraft = Boolean(initialNewDraft.trim() || visionComposer.images('new-conversation').length);
const initialConversation = hasNewDraft ? null
  : state.conversations.find((conversation) => !conversation.archived);
if (initialConversation) {
  state.activeId = initialConversation.id;
} else {
  createConversation({restoredText:initialNewDraft});
}
setSidebar(false);
render();
restoreDraft(activeConversation());
const chatLayout = initMobileLayout();
initAccessibility();
accountUI = initAccountUI({
  busy: () => Boolean(modelConnections?.isBusy()) || Boolean(privateShares?.busy()) || Boolean(personalInstructions?.busy()) || Boolean(accountMemory?.busy()) || state.backgroundRequests.size > 0 || Boolean(document.querySelector('#code-stop:not(:disabled)')) || Boolean(document.querySelector('#attachment-review[open] #attachment-insert:disabled')) || Boolean(document.querySelector('#project-dialog[open] button:disabled')),
  beforeChange: () => {
    const draftSaved = saveDraft();
    if (!draftSaved && elements.promptInput.value.trim()) {
      throw Error('聊天草稿尚未保存，浏览器存储可能已满或不可用。请先复制保留草稿，恢复存储后重试；或确认已复制，再清空输入框切换账户。');
    }
    if(writingDesk && !writingDesk.flush())throw Error('写作画布尚未保存，请先另存副本或导出文稿，再切换账户。');
  },
  importLocal: async () => {
    if (!accountUser) return '请先登录。';
    const old = loadConversations(globalStorage);
    if (!old.length) return '此浏览器没有可导入的旧聊天。其他设备可先导出聊天备份再导入。';
    if (!confirm(`将 ${old.length} 段本机旧聊天复制到此账户的私有空间？旧公开版本不会被删除或撤回，原本机记录也保留。`)) return '未导入，旧记录保留。';
    for (const c of old) { const copy = {...structuredClone(c),id:createConversationId(),title:(c.title+' · 导入副本').slice(0,60),updatedAt:Date.now()}; state.conversations.push(copy); }
    saveConversations(); render(); await privateSync.sync(); return '旧聊天已复制到个人空间的本机缓存，原记录保留。请查看侧栏同步状态，显示已同步后才能在其他设备读取。';
  },
  resolveConflicts: () => privateSync?.resolve() || '请先登录个人账户。',
  syncNow: async () => {
    if (!privateSync) return '请先登录个人账户。';
    const result = await privateSync.sync();
    return result.synced ? '聊天已同步到云端，可在其他设备登录查看。'
      : result.error ? `尚未同步：${result.error}。本机内容保留，请重新连接后重试。`
        : result.conflicts ? `有 ${result.conflicts} 段同步冲突，请点击“处理同步冲突”。`
          : `有 ${result.pending} 段正在生成或等待同步，请完成后再同步。`;
  },
});
if (accountUser) {
  let initialCloudSelection = true;
  elements.publishCurrentConversation.hidden = true;
  elements.publishAllConversations.hidden = true;
  elements.sharedAuthorName.closest('label')?.setAttribute('hidden', '');
  privateSync = createPrivateSync({
    conversations: () => state.conversations, payload: sharedConversationPayload,
    isLinked: c => Boolean(c.projectLinked || c.branch||projects?.projectForConversation?.(c.id)),
    busy: id => state.backupImportPending || state.backgroundRequests.has(id), status: text => accountUI.setStatus(text),
    replace: (cloud, id = cloud?.id) => {
      const at = state.conversations.findIndex(c => c.id === id);
      if (!cloud) { if (at >= 0) state.conversations.splice(at, 1); return; }
      if (at >= 0) state.conversations[at] = {...state.conversations[at],...cloud}; else state.conversations.push(cloud);
    },
    changed: () => {
      if (state.backupImportPending) return;
      if (initialCloudSelection && !activeConversation()?.messages.length && !activeConversation()?.documents?.length && !activeConversation()?.projectLinked&&!activeConversation()?.branch && !elements.promptInput.value.trim() && !visionComposer.images().length) {
        const first = state.conversations.filter(c => c.messages.length && !c.archived).sort((a,b) => b.updatedAt-a.updatedAt)[0];
        if (first) { state.activeId = first.id; restoreDraft(first); }
      }
      initialCloudSelection = false;
      saveConversations(false); render();
    },
  });
}
document.querySelector('.fine-print').textContent = accountUser ? 'AI 可能出错，请核对重要信息 · 此账户聊天与项目私有保存' : 'AI 可能出错，请核对重要信息 · 未登录的新聊天仅保存到此浏览器';
writingDesk=initWritingDesk({toast:showToast,userId:accountUser?.id||null,onIdentityChanged:identityChanged,insert:text=>{if(state.busy){showToast('请等待当前回复完成后插入文稿。');return;}try{elements.promptInput.value=appendDraftText(elements.promptInput.value,text,elements.promptInput.maxLength);saveDraft();resizeTextarea();updateSendState();showToast('已放入当前聊天草稿，请核对后发送。');}catch(e){showToast(e.message);}}});
function openTemporaryChat(){
  if(state.backgroundRequests.size||state.backupImportPending||privateSync?.running){showToast('请先完成生成、导入或聊天同步，再开始临时聊天。');return;}
  if(!saveDraft()){showToast('当前草稿尚未保存，请先复制保留后再打开临时聊天。');return;}
  location.assign('/temporary?theme='+(document.documentElement.dataset.theme==='dark'?'dark':'light'));
}
modernUI=initModernUI({openTemporary:openTemporaryChat,conversations:()=>state.conversations,active:activeConversation,select:selectConversation,create:createConversation,projects,notes:()=>writingDesk.notes(),openNote:(...args)=>writingDesk.open(...args),openWorkspace:()=>workspace.open(),openModels:origin=>chatLayout.open('models',origin),busy:()=>state.backgroundRequests.size>0,closeSidebar:()=>closeSidebar(false),toast:showToast});
branchNavigation=initBranchNavigation({conversations:()=>state.conversations,active:activeConversation,select:selectConversation,toast:showToast});
personalInstructions=initPersonalInstructions({user:accountUser,currentUser:()=>accountUser,identityChanged,changed:updateContextPreview,toast:showToast});
privateShares=initPrivateShares({user:accountUser,currentUser:()=>accountUser,identityChanged,active:activeConversation,busy:()=>state.backgroundRequests.size>0||state.backupImportPending,toast:showToast});
modelConnections=initModelConnections({user:accountUser,reloadProviders:loadProviders,toast:showToast,identityChanged,busy:()=>state.busy||Boolean(activeBackgroundRequest())||state.backgroundRequests.size>0});
accountMemory=initAccountMemory({user:accountUser,currentUser:()=>accountUser,identityChanged,toast:showToast,changed:updateContextPreview,active:activeConversation});
initSiteAdministration({beforeReload:()=>{if(state.backgroundRequests.size||state.backupImportPending||privateSync?.running||modelConnections?.isBusy())throw Error('请先完成生成、同步和其他编辑，再重新载入。');if(!saveDraft()&&elements.promptInput.value.trim())throw Error('草稿尚未保存，请先复制保留。');if(writingDesk&&!writingDesk.flush())throw Error('请先保存或导出文稿。');}});
void loadProviders();
window.setInterval(() => {
  if (accountUser) { if (!state.backgroundRequests.size) void privateSync?.sync().then(() => projects.refresh().catch(() => {})); return; }

}, 15_000);
