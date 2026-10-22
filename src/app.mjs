import { callCodeRunner, validateCodeJob } from './code_execution.mjs';
import {validateCodeArtifacts} from '../public/code_artifact_tools.js';
import { createAccountRoutes } from './account_routes.mjs';
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

import { callProvider } from "./providers.mjs";
import { outputTokenLimit, outputTokenBounds } from './output_limits.mjs';
import { externalSearchEnabled, searchWeb } from "./web_search.mjs";
import { documentAsset } from "./document_assets.mjs";
import { validateImages, MAX_CONTEXT_IMAGES } from '../public/image_attachments.js';
import { supportsImageInput } from './vision.mjs';
import { validateDocuments } from '../public/document_library.js';
import { retrieveDocuments } from './document_retrieval.mjs';

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const STATIC_FILES = new Map([
  ["/memory_tools.js", ["../public/memory_tools.js", "text/javascript; charset=utf-8"]],
  ["/account_memory.js", ["../public/account_memory.js", "text/javascript; charset=utf-8"]],
  ["/account.js", ["../public/account.js", "text/javascript; charset=utf-8"]],
  ["/private_sync.js", ["../public/private_sync.js", "text/javascript; charset=utf-8"]],
  ["/scoped_storage.js", ["../public/scoped_storage.js", "text/javascript; charset=utf-8"]],
  ["/project_cloud.js", ["../public/project_cloud.js", "text/javascript; charset=utf-8"]],
  ["/project_drafts.js", ["../public/project_drafts.js", "text/javascript; charset=utf-8"]],
  ["/ui.css", ["../public/ui.css", "text/css; charset=utf-8"]],
  ["/modern_ui.js", ["../public/modern_ui.js", "text/javascript; charset=utf-8"]],
  ["/ui_state.js", ["../public/ui_state.js", "text/javascript; charset=utf-8"]],
  ["/writing_store.js", ["../public/writing_store.js", "text/javascript; charset=utf-8"]],
  ["/writing_desk.js", ["../public/writing_desk.js", "text/javascript; charset=utf-8"]],
  ["/writing_sync.js", ["../public/writing_sync.js", "text/javascript; charset=utf-8"]],
  ["/writing_backups.js", ["../public/writing_backups.js", "text/javascript; charset=utf-8"]],
  ["/projects.js", ["../public/projects.js", "text/javascript; charset=utf-8"]],
  ["/project_workspace.js", ["../public/project_workspace.js", "text/javascript; charset=utf-8"]],
  ["/mobile_layout.js", ["../public/mobile_layout.js", "text/javascript; charset=utf-8"]],
  ["/accessibility.js", ["../public/accessibility.js", "text/javascript; charset=utf-8"]],
  ["/voice_composer.js", ["../public/voice_composer.js", "text/javascript; charset=utf-8"]],
  ["/execution_history.js", ["../public/execution_history.js", "text/javascript; charset=utf-8"]],
  ["/code_workspace.js", ["../public/code_workspace.js", "text/javascript; charset=utf-8"]],
  ["/code_workspace_tools.js", ["../public/code_workspace_tools.js", "text/javascript; charset=utf-8"]],
  ["/code_artifact_tools.js", ["../public/code_artifact_tools.js", "text/javascript; charset=utf-8"]],
  ["/conversation_branches.js", ["../public/conversation_branches.js", "text/javascript; charset=utf-8"]],
  ["/branch_navigation.js", ["../public/branch_navigation.js", "text/javascript; charset=utf-8"]],
  ["/usage_guide.js", ["../public/usage_guide.js", "text/javascript; charset=utf-8"]],
  ["/execution_console.js", ["../public/execution_console.js", "text/javascript; charset=utf-8"]],
  ["/document_library.js", ["../public/document_library.js", "text/javascript; charset=utf-8"]],
  ["/document_search.js", ["../public/document_search.js", "text/javascript; charset=utf-8"]],
  ["/document_reader.js", ["../public/document_reader.js", "text/javascript; charset=utf-8"]],
  ["/", ["../public/index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["../public/index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["../public/app.js", "text/javascript; charset=utf-8"]],
  ["/markdown.js", ["../public/markdown.js", "text/javascript; charset=utf-8"]],
  ["/math_display.js", ["../public/math_display.js", "text/javascript; charset=utf-8"]],
  ["/table_export.js", ["../public/table_export.js", "text/javascript; charset=utf-8"]],
  ["/history_menu.js", ["../public/history_menu.js", "text/javascript; charset=utf-8"]],
  ["/backups.js", ["../public/backups.js", "text/javascript; charset=utf-8"]],
  ["/attachment_utils.js", ["../public/attachment_utils.js", "text/javascript; charset=utf-8"]],
  ["/prompt_sync.js", ["../public/prompt_sync.js", "text/javascript; charset=utf-8"]],
  ["/prompt_library.js", ["../public/prompt_library.js", "text/javascript; charset=utf-8"]],
  ["/conversation_tools.js", ["../public/conversation_tools.js", "text/javascript; charset=utf-8"]],
  ["/workspace.js", ["../public/workspace.js", "text/javascript; charset=utf-8"]],
  ["/workbench.js", ["../public/workbench.js", "text/javascript; charset=utf-8"]],
  ["/workbench_tools.js", ["../public/workbench_tools.js", "text/javascript; charset=utf-8"]],
  ["/event_stream.js", ["../public/event_stream.js", "text/javascript; charset=utf-8"]],
  ["/image_attachments.js", ["../public/image_attachments.js", "text/javascript; charset=utf-8"]],
  ["/vision_composer.js", ["../public/vision_composer.js", "text/javascript; charset=utf-8"]],
  ["/request_queue.js", ["../public/request_queue.js", "text/javascript; charset=utf-8"]],
  ["/documents.js", ["../public/documents.js", "text/javascript; charset=utf-8"]],
  ["/pdf_parse.js", ["../public/pdf_parse.js", "text/javascript; charset=utf-8"]],
  ["/project_originals.js", ["../public/project_originals.js", "text/javascript; charset=utf-8"]],
  ["/original_zip.js", ["../public/original_zip.js", "text/javascript; charset=utf-8"]],
  ["/context_budget.js", ["../public/context_budget.js", "text/javascript; charset=utf-8"]],
  ["/history_cloud.js", ["../public/history_cloud.js", "text/javascript; charset=utf-8"]],
  ["/history_cloud_panel.js", ["../public/history_cloud_panel.js", "text/javascript; charset=utf-8"]],
  ["/original_restore.js", ["../public/original_restore.js", "text/javascript; charset=utf-8"]],
  ["/original_restore_panel.js", ["../public/original_restore_panel.js", "text/javascript; charset=utf-8"]],
  ["/pdf_coverage.js", ["../public/pdf_coverage.js", "text/javascript; charset=utf-8"]],
  ["/pdf_ocr_picker.js", ["../public/pdf_ocr_picker.js", "text/javascript; charset=utf-8"]],
  ["/pdf_ocr.js", ["../public/pdf_ocr.js", "text/javascript; charset=utf-8"]],
  ["/pdf_ocr_worker.js", ["../public/pdf_ocr_worker.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["../public/styles.css", "text/css; charset=utf-8"]],
  ["/favicon.svg", ["../public/favicon.svg", "image/svg+xml"]],
].map(([route, [path, contentType]]) => [
  route,
  { body: readFileSync(new URL(path, import.meta.url)), contentType },
]));

function baseHeaders(contentType) {
  return {
    "content-type": contentType,
    "x-app-name": "huawei-cloud-backend",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  };
}

function sendJson(response, status, payload, headers = {}) {
  if (response.destroyed || response.writableEnded) return false;
  response.writeHead(status, {
    ...baseHeaders("application/json; charset=utf-8"),
    ...headers,
  });
  response.end(JSON.stringify(payload));
  return true;
}

function sendEmpty(response, status, headers = {}) {
  if (response.destroyed || response.writableEnded) return false;
  response.writeHead(status, {
    ...baseHeaders("application/json; charset=utf-8"),
    ...headers,
  });
  response.end();
  return true;
}

function sendStatic(response, requestMethod, staticFile) {
  if (response.destroyed || response.writableEnded) return false;
  response.writeHead(200, {
    ...baseHeaders(staticFile.contentType),
    "cache-control": "no-cache",
    "content-security-policy":
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self'; style-src-attr 'unsafe-inline'; connect-src 'self' blob:; img-src 'self' data: blob:; font-src 'self'; frame-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  });
  response.end(requestMethod === "HEAD" ? undefined : staticFile.body);
  return true;
}

function firstHeaderValue(value) {
  return typeof value === "string" ? value.split(",", 1)[0].trim() : "";
}

function requestOriginContext(request, config) {
  const origin = firstHeaderValue(request.headers.origin);
  let parsedOrigin;
  if (origin) {
    try {
      parsedOrigin = new URL(origin);
    } catch {
      return { origin, parsedOrigin: null, sameOrigin: false };
    }
  }
  const forwardedHost = config.trustProxy
    ? firstHeaderValue(request.headers["x-forwarded-host"])
    : "";
  const requestHost = (forwardedHost || firstHeaderValue(request.headers.host)).toLowerCase();
  const forwardedProtocol = config.trustProxy
    ? firstHeaderValue(request.headers["x-forwarded-proto"]).toLowerCase()
    : "";
  const requestProtocol = forwardedProtocol === "https" || forwardedProtocol === "http"
    ? `${forwardedProtocol}:`
    : request.socket.encrypted
      ? "https:"
      : "http:";
  const sameOrigin = Boolean(parsedOrigin && requestHost
    && parsedOrigin.protocol === requestProtocol
    && parsedOrigin.host.toLowerCase() === requestHost);
  return { origin, parsedOrigin, sameOrigin };
}

function originPolicy(request, config) {
  const context = requestOriginContext(request, config);
  if (!context.origin) return { allowed: true, sameOrigin: false, headers: {} };
  if (!context.parsedOrigin) return { allowed: false, sameOrigin: false, headers: {} };

  const { parsedOrigin, sameOrigin } = context;
  const explicitlyAllowed = config.allowedOrigins.has(parsedOrigin.origin);
  if (!sameOrigin && !explicitlyAllowed) return { allowed: false, sameOrigin: false, headers: {} };

  return {
    allowed: true,
    sameOrigin,
    headers: {
      "access-control-allow-origin": parsedOrigin.origin,
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "Authorization, Content-Type, X-Yunjian-UI",
      "access-control-max-age": "600",
      vary: "Origin",
    },
  };
}

function clientIp(request, config) {
  if (config.trustProxy) {
    const forwarded = firstHeaderValue(request.headers["x-forwarded-for"]);
    if (forwarded) return forwarded;
  }
  return request.socket.remoteAddress || "unknown";
}

function bearerToken(request) {
  const value = request.headers.authorization;
  if (typeof value !== "string" || !value.startsWith("Bearer ")) return "";
  return value.slice(7).trim();
}

function tokenMatches(received, expected) {
  const expectedDigest = createHash("sha256").update(expected).digest();
  const receivedDigest = createHash("sha256").update(received).digest();
  return timingSafeEqual(expectedDigest, receivedDigest);
}

function requestHostIsLoopback(request) {
  const host = firstHeaderValue(request.headers.host);
  if (!host) return false;
  try {
    const hostname = new URL(`http://${host}`).hostname.toLowerCase().replace(/\.$/, "");
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
  } catch {
    return false;
  }
}

async function readJson(request, maxBodyBytes) {
  const contentType = request.headers["content-type"] || "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    const error = new Error("Content-Type must be application/json");
    error.statusCode = 415;
    throw error;
  }

  const declaredLength = Number.parseInt(request.headers["content-length"] || "0", 10);
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
    const error = new Error("Request body is too large");
    error.statusCode = 413;
    throw error;
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      const error = new Error("Request body is too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  try {
    request.jsonBodyBytes = size;
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Request body is not valid JSON");
    error.statusCode = 400;
    throw error;
  }
}

function validateChatInstructions(value) {
  if (value === undefined) return "";
  if (typeof value !== "string") throw new Error("instructions must be text");
  const instructions = value.trim();
  if (instructions.length > 2000) throw new Error("instructions are too long");
  return instructions;
}

function validateMessages(value, maxInputChars, instructionLength = 0) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 24) {
    throw new Error("messages must contain between 1 and 24 items");
  }

  let totalCharacters = instructionLength;
  const messages = value.map((item) => {
    if (!item || typeof item !== "object") throw new Error("Invalid message");
    if (item.role !== "user" && item.role !== "assistant") {
      throw new Error("Only user and assistant roles are accepted");
    }
    if (typeof item.content !== "string") throw new Error("Message content must be text");
    const content = item.content.trim();
    if (!content || content.length > maxInputChars) {
      throw new Error("A message is empty or too long");
    }
    totalCharacters += content.length;
    const images = validateImages(item.images, item.role);
    return { role: item.role, content, ...(images.length ? { images } : {}) };
  });

  if (totalCharacters > maxInputChars) throw new Error("Conversation is too long");
  if (messages.reduce((sum, m) => sum + (m.images?.length || 0), 0) > MAX_CONTEXT_IMAGES) throw new Error('一次请求最多携带 8 张图片，请减少历史上下文或新建对话。');
  if (messages.at(-1).role !== "user") throw new Error("The last message must be from the user");
  return messages;
}

function selectProvider(body, config) {
  const providerId = body?.provider === undefined
    ? config.defaultProvider
    : body.provider;
  if (typeof providerId !== "string" || !Object.hasOwn(config.providers, providerId)) {
    const error = new Error("Provider is not enabled");
    error.statusCode = 400;
    throw error;
  }
  return config.providers[providerId];
}

function allowedModelIds(provider) {
  return Array.isArray(provider.models) && provider.models.length
    ? provider.models
    : [provider.model];
}

function selectModel(body, provider) {
  const model = body?.model === undefined ? provider.model : body.model;
  if (typeof model !== "string" || !allowedModelIds(provider).includes(model)) {
    throw new Error("Model is not enabled for this provider");
  }
  return model;
}

function generationParameterCapabilities(provider, model, config) {
  const maxOutputTokens = outputTokenLimit(provider, model, config.maxOutputTokens);
  if (provider.id === "openai") {
    return { temperature: false, top_p: false, maxOutputTokens };
  }
  const option = provider.modelOptions?.find((item) => item.id === model);
  if (provider.id === "openrouter" && Array.isArray(option?.supportedParameters)) {
    const supported = new Set(option.supportedParameters);
    return {
      temperature: supported.has("temperature"),
      top_p: supported.has("top_p"),
      maxOutputTokens,
    };
  }
  return { temperature: true, top_p: true, maxOutputTokens };
}

function validateGenerationParameters(value, provider, model, config) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("parameters must be an object");
  }
  const allowed = ["temperature", "top_p", "max_output_tokens"];
  const unsupported = Object.keys(value).find((key) => !allowed.includes(key));
  if (unsupported) throw new Error(`Unsupported parameter: ${unsupported}`);

  const capabilities = generationParameterCapabilities(provider, model, config);
  const { temperature, top_p: topP, max_output_tokens: maxOutputTokens } = value;
  if (temperature !== undefined) {
    if (!capabilities.temperature) throw new Error("temperature is not supported for this model");
    if (typeof temperature !== "number" || !Number.isFinite(temperature)
      || temperature < 0 || temperature > 2) {
      throw new Error("temperature must be a number from 0 to 2");
    }
  }
  if (topP !== undefined) {
    if (!capabilities.top_p) throw new Error("top_p is not supported for this model");
    if (typeof topP !== "number" || !Number.isFinite(topP) || topP <= 0 || topP > 1) {
      throw new Error("top_p must be a number greater than 0 and at most 1");
    }
  }
  if (maxOutputTokens !== undefined && (
    !Number.isSafeInteger(maxOutputTokens)
    || maxOutputTokens < 1
    || capabilities.maxOutputTokens === 0
    || maxOutputTokens > capabilities.maxOutputTokens
  )) {
    throw new Error(capabilities.maxOutputTokens === 0 ? "max_output_tokens is not supported for this model"
      : `max_output_tokens must be a positive safe integer${capabilities.maxOutputTokens ? ` at most ${capabilities.maxOutputTokens}` : ''}`);
  }
  return { temperature, top_p: topP, max_output_tokens: maxOutputTokens };
}

function validateWebSearch(value, provider, config) {
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw new Error("webSearch must be a boolean");
  if (value && !provider.webSearchProtocol && !externalSearchEnabled(config)) {
    throw new Error("当前服务商接口不支持官方联网搜索。");
  }
  return value;
}

function publicProviders(config) {
  return Object.values(config.providers).map((provider) => ({
    id: provider.id,
    label: provider.label,
    model: provider.model,
    models: (provider.modelOptions?.length ? provider.modelOptions
      : allowedModelIds(provider).map(id => ({ id, label: id }))).map(({ id, label }) => {
        const capabilities = generationParameterCapabilities(provider, id, config);
        return {
          id,
          label,
          ...(supportsImageInput(provider, id) ? { vision: true } : {}),
          parameters: {
            temperature: capabilities.temperature,
            top_p: capabilities.top_p,
            ...outputTokenBounds(capabilities.maxOutputTokens),
          },
        };
      }),
    parameters: {
      temperature: provider.id !== "openai",
      top_p: provider.id !== "openai",
      ...outputTokenBounds(outputTokenLimit(provider, provider.model, config.maxOutputTokens)),
    },
    capabilities: {
      webSearch: Boolean(provider.webSearchProtocol) || externalSearchEnabled(config),
      ...(externalSearchEnabled(config) ? { searchEngine: config.workspaceSearch.engine } : {}),
    },
    ...(provider.modelCatalogUrl ? {
      modelCatalog: {
        dynamic: true,
        loaded: provider.modelCatalogLoaded === true,
        count: allowedModelIds(provider).length,
      },
    } : {}),
  }));
}

function sendOpenAIError(response, status, message, headers = {}, code = null) {
  const type = status === 401 ? "authentication_error"
    : status === 429 ? "rate_limit_error"
      : status >= 500 ? "api_error" : "invalid_request_error";
  return sendJson(response, status, {
    error: { message, type, param: null, code },
  }, headers);
}

function validateOpenAIMessages(value, maxInputChars) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 24) {
    throw new Error("messages must contain between 1 and 24 items");
  }

  let totalCharacters = 0;
  let instructions = "";
  const messages = [];
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Invalid message");
    }
    if (typeof item.content !== "string") {
      throw new Error("Message content must be text");
    }
    const content = item.content.trim();
    if (!content || content.length > maxInputChars) {
      throw new Error("A message is empty or too long");
    }
    totalCharacters += content.length;
    if (totalCharacters > maxInputChars) throw new Error("Conversation is too long");

    if (item.role === "system") {
      if (index !== 0) throw new Error("A system message is only allowed first");
      instructions = content;
    } else if (item.role === "user" || item.role === "assistant") {
      messages.push({ role: item.role, content });
    } else {
      throw new Error("Only system, user and assistant text messages are accepted");
    }
  }
  if (!messages.length || messages.at(-1).role !== "user") {
    throw new Error("The last message must be from the user");
  }
  return { messages, instructions };
}

function selectOpenAIProvider(body, config) {
  if (typeof body?.model !== "string" || !Object.hasOwn(config.providers, body.model)) {
    throw new Error("model must be an enabled model ID from /v1/models");
  }
  return config.providers[body.model];
}

export function createGatewayServer({ config, fetchImpl = fetch, sharedStore, workspaceStore, accountStore, runCode = callCodeRunner }) {
  const accountRoutes = accountStore && createAccountRoutes({store: accountStore, config, readJson, sendJson, clientIp: req => clientIp(req, config)});
  function validAccount(request) {
    const session = accountRoutes?.authenticate(request);
    const origin = requestOriginContext(request, config);
    const site = firstHeaderValue(request.headers['sec-fetch-site']);
    const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    return session && request.headers['x-plaude-client'] === '1'
      && request.headers['x-plaude-account-id'] === session.user.id
      && (!origin.origin || origin.sameOrigin) && (!mutation || origin.sameOrigin)
      && site !== 'cross-site' && site !== 'same-site' ? session : null;
  }
  const requestOwners = new WeakMap();
  const ownerOf = request => requestOwners.get(request) || null;
  const runtimeLogs = [], activity = [];
  const visibleLogs = (entries, ownerId) => entries.filter(item => item.ownerId === ownerId)
    .map(({ ownerId: _privateOwner, ...item }) => item);
  const recordActivity = (type, detail, requestId = '', ownerId = null) => {
    activity.push({ time: new Date().toISOString(), type, detail, requestId, ownerId });
    if (activity.length > 200) activity.shift();
  };
  let codeBusy = false;
  let codeBusyOwner = null;
  let codeDay = { date: '', count: 0 };
  const rateBuckets = new Map();
  let lastRateBucketSweep = 0;
  let activeRequests = 0;
  let dailyRequests = { date: "", count: 0 };
  let dailyTokens = { date: "", used: 0 };

  function consumeRateLimit(ip) {
    const now = Date.now();
    let bucketKey = ip;
    if (!rateBuckets.has(bucketKey) && rateBuckets.size >= config.maxRateLimitBuckets - 1) {
      if (now - lastRateBucketSweep >= MINUTE_MS) {
        for (const [key, value] of rateBuckets) {
          if (value.resetAt <= now) rateBuckets.delete(key);
        }
        lastRateBucketSweep = now;
      }
      if (rateBuckets.size >= config.maxRateLimitBuckets - 1) bucketKey = "__overflow__";
    }

    let bucket = rateBuckets.get(bucketKey);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + MINUTE_MS };
      rateBuckets.set(bucketKey, bucket);
    }
    bucket.count += 1;
    return {
      allowed: bucket.count <= config.rateLimitPerMinute,
      remaining: Math.max(0, config.rateLimitPerMinute - bucket.count),
      resetSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  function utcDayState(current) {
    const now = Date.now();
    const date = new Date(now).toISOString().slice(0, 10);
    if (current.date !== date) {
      current.date = date;
      if ("count" in current) current.count = 0;
      if ("used" in current) current.used = 0;
    }
    const nextMidnight = Date.parse(`${date}T00:00:00Z`) + DAY_MS;
    return Math.max(1, Math.ceil((nextMidnight - now) / 1000));
  }

  function tokenStatus() {
    const resetSeconds = utcDayState(dailyTokens);
    return {
      allowed: dailyTokens.used < config.dailyTokenLimit,
      used: dailyTokens.used,
      remaining: Math.max(0, config.dailyTokenLimit - dailyTokens.used),
      resetSeconds,
    };
  }

  function tokenHeaders(status) {
    return {
      "x-daily-token-limit": String(config.dailyTokenLimit),
      "x-daily-token-used": String(status.used),
      "x-daily-token-remaining": String(status.remaining),
      "x-daily-token-reset": String(status.resetSeconds),
    };
  }

  function recordTokens(totalTokens) {
    const status = tokenStatus();
    if (!Number.isSafeInteger(totalTokens) || totalTokens < 0) {
      return { ...status, recorded: false };
    }
    dailyTokens.used = Math.min(Number.MAX_SAFE_INTEGER, dailyTokens.used + totalTokens);
    return { ...tokenStatus(), recorded: true };
  }

  function consumeDailyRequest() {
    const resetSeconds = utcDayState(dailyRequests);
    if (dailyRequests.count >= config.dailyRequestLimit) {
      return { allowed: false, remaining: 0, resetSeconds };
    }
    dailyRequests.count += 1;
    return {
      allowed: true,
      remaining: config.dailyRequestLimit - dailyRequests.count,
      resetSeconds,
    };
  }

  function checkWebsiteAccess(request, response, corsHeaders = {}, allowAccount = false) {
    if (allowAccount && validAccount(request)) return true;
    if (config.localDevNoAuth) {
      if (requestHostIsLoopback(request)) return true;
      sendJson(response, 403, { error: "本地开发接口只接受本机地址。" }, corsHeaders);
      return false;
    }
    if (!tokenMatches(bearerToken(request), config.gatewayAccessToken)) {
      sendJson(response, 401, { error: "访问口令无效。" }, {
        ...corsHeaders,
        "www-authenticate": "Bearer",
      });
      return false;
    }
    return true;
  }

  async function handleChat(request, response, corsHeaders, sameOriginRequest = false) {
    const requestId = randomUUID();
    const commonHeaders = { ...corsHeaders, "x-request-id": requestId };
    if (config.localDevNoAuth && !requestHostIsLoopback(request)) {
      sendJson(response, 403, { error: "本地开发接口只接受本机地址。", requestId }, commonHeaders);
      return;
    }
    const rate = consumeRateLimit(clientIp(request, config));
    const rateHeaders = {
      ...commonHeaders,
      "ratelimit-limit": String(config.rateLimitPerMinute),
      "ratelimit-remaining": String(rate.remaining),
      "ratelimit-reset": String(rate.resetSeconds),
    };

    if (!rate.allowed) {
      sendJson(response, 429, { error: "请求过于频繁，请稍后重试。", requestId }, {
        ...rateHeaders,
        "retry-after": String(rate.resetSeconds),
      });
      return;
    }
    if (!config.localDevNoAuth && !validAccount(request) && !tokenMatches(bearerToken(request), config.gatewayAccessToken)) {
      sendJson(response, 401, { error: "访问口令无效。", requestId }, rateHeaders);
      return;
    }
    if (activeRequests >= config.maxConcurrentRequests) {
        sendJson(response, 503, { error: "当前请求较多，请稍后重试。", requestId }, {
          ...rateHeaders,
          "retry-after": "2",
          "x-yunjian-busy": "1",
      });
      return;
    }

    activeRequests += 1;
    let dailyHeaders = {};
    let currentTokenStatus = tokenStatus();
    let currentTokenHeaders = tokenHeaders(currentTokenStatus);
    let selectedProvider;
    const wantsStream = firstHeaderValue(request.headers.accept).includes('text/event-stream');
    let heartbeat;
    function streamEvent(event, payload) {
      if (response.destroyed || response.writableEnded) return;
      if (response.writableLength > 1024 * 1024) {
        response.destroy();
        throw new Error('Streaming client is too slow');
      }
      response.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    }

    try {
      const body = await readJson(request, Math.max(config.maxBodyBytes, 4 * 1024 * 1024));
      const instructions = validateChatInstructions(body?.instructions);
      let memoryContext='';
      if(body?.memory!==undefined){
        const owner=validAccount(request)?.user?.id;
        if(!owner)throw Object.assign(Error('长期记忆仅可由当前登录账户使用。'),{statusCode:403});
        memoryContext=accountStore.resolveMemories(owner,body.memory).text;
      }
      const messages = validateMessages(body?.messages, config.maxInputChars, instructions.length+memoryContext.length);
      const documents = validateDocuments(body?.documents);
      const documentBytes = body?.documents ? Buffer.byteLength(JSON.stringify(documents)) : 0;
      const imageBytes = messages.reduce((total, m) => total + (m.images || []).reduce((n, image) => n + image.dataUrl.length, 0), 0);
      if (request.jsonBodyBytes - imageBytes - documentBytes > config.maxBodyBytes) {
        const error = new Error('Request body is too large'); error.statusCode = 413; throw error;
      }
      selectedProvider = selectProvider(body, config);
      const selectedModel = selectModel(body, selectedProvider);
      const hasImages = messages.some(message => message.images?.length);
      if (hasImages && !supportsImageInput(selectedProvider, selectedModel)) throw new Error('当前模型未确认支持图片，请选择标有“看图”的模型，或使用 OCR 提取文字。');
      if (hasImages && body.webSearch === true) throw new Error('图片对话暂不同时联网搜索，请关闭联网搜索后重试。');
      const generationParameters = validateGenerationParameters(
        body?.parameters,
        selectedProvider,
        selectedModel,
        config,
      );
      const webSearch = validateWebSearch(body?.webSearch, selectedProvider, config);
      if (webSearch && documents.some(doc => doc.enabled)) throw Error('资料阅读暂不同时联网搜索，请先关闭联网或暂停资料引用。');
      const documentResult = retrieveDocuments(documents, messages.at(-1).content,
        config.maxInputChars - instructions.length - memoryContext.length - messages.reduce((sum, message) => sum + message.content.length, 0));
      recordActivity('chat_started', `${selectedProvider.id} / ${selectedModel} · ${messages.length} 条上下文${hasImages ? ' · 图片理解' : ''}`, requestId, ownerOf(request));
      if (documentResult) recordActivity('documents', `资料${documentResult.context.mode === 'overview' ? '抽样' : '检索'} · ${documentResult.context.sources.length} 个片段`, requestId, ownerOf(request));
      if (webSearch) recordActivity('search', '开始联网搜索', requestId, ownerOf(request));
      const externalSearch = webSearch && externalSearchEnabled(config);
      if (webSearch && !externalSearch && selectedProvider.webSearchProtocol === "google-search") {
        const uiMarker = firstHeaderValue(request.headers["x-yunjian-ui"]);
        const fetchSite = firstHeaderValue(request.headers["sec-fetch-site"]).toLowerCase();
        if (!sameOriginRequest || uiMarker !== "browser" || fetchSite !== "same-origin") {
          const error = new Error("Gemini 联网搜索只可从本站页面使用。");
          error.statusCode = 403;
          throw error;
        }
      }

      if (!currentTokenStatus.allowed) {
        sendJson(response, 429, { error: "今日 Token 软额度已用完，请稍后再试。", requestId }, {
          ...rateHeaders,
          ...currentTokenHeaders,
          "retry-after": String(currentTokenStatus.resetSeconds),
        });
        return;
      }

      const daily = consumeDailyRequest();
      dailyHeaders = {
        "x-daily-request-limit": String(config.dailyRequestLimit),
        "x-daily-request-remaining": String(daily.remaining),
        "x-daily-request-reset": String(daily.resetSeconds),
      };
      if (!daily.allowed) {
        sendJson(response, 429, { error: "今日请求次数已用完，请稍后再试。", requestId }, {
          ...rateHeaders,
          ...dailyHeaders,
          "retry-after": String(daily.resetSeconds),
        });
        return;
      }

      if (wantsStream) {
        response.writeHead(200, { ...baseHeaders('text/event-stream; charset=utf-8'), ...rateHeaders,
          ...dailyHeaders, ...currentTokenHeaders, 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' });
        response.flushHeaders();
        streamEvent('status', { requestId, message: webSearch ? '正在联网检索，核对来源后显示完整回答…' : '正在等待模型开始回复…' });
        heartbeat = setInterval(() => { if (!response.destroyed && !response.writableEnded && response.writableLength < 65536) response.write(': keepalive\n\n'); }, 10000);
        heartbeat.unref();
      }
      const searchController = new AbortController();
      const abortSearch = () => { if (!response.writableEnded) searchController.abort(); };
      response.once('close', abortSearch);
      let searchResult;
      try {
        if (externalSearch) searchResult = await searchWeb(config.workspaceSearch, messages.at(-1).content, fetchImpl, searchController.signal);
      } finally { response.off('close', abortSearch); }
      if (response.destroyed) {
        recordActivity('chat_cancelled', '连接中断或用户停止', requestId, ownerOf(request));
        return;
      }
      const requestConfig = {
        ...config,
        systemPrompt: (instructions ? `${config.systemPrompt}\n\n${instructions}` : config.systemPrompt) + memoryContext + (searchResult?.context || ''),
        maxOutputTokens: generationParameters.max_output_tokens ?? (config.maxOutputTokens > 0
          ? outputTokenLimit(selectedProvider, selectedModel, config.maxOutputTokens) : 0),
      };
      const result = await callProvider({
        provider: { ...selectedProvider, model: selectedModel },
        messages: documentResult ? messages.map((message, index) => index === messages.length - 1
          ? { ...message, content: documentResult.text + message.content } : message) : messages,
        config: requestConfig,
        generationParameters,
        webSearch: webSearch && !externalSearch,
        request,
        response,
        requestId,
        fetchImpl,
        ...(wantsStream ? { onDelta: text => streamEvent('delta', { text }) } : {}),
      });
      currentTokenStatus = recordTokens(result.usage?.totalTokens);
      currentTokenHeaders = tokenHeaders(currentTokenStatus);
      if (!currentTokenStatus.recorded) {
        console.error(JSON.stringify({
          level: "error",
          event: "upstream_usage_missing",
          requestId,
          upstreamRequestId: result.upstreamRequestId,
          provider: selectedProvider.id,
        }));
      }

      const payload = {
        ...(documentResult ? { documentContext: documentResult.context } : {}),
        text: result.text,
        finishReason: result.finishReason,
        usage: result.usage,
        provider: selectedProvider.id,
        model: selectedModel,
        requestId,
        search: {
          enabled: webSearch,
          used: webSearch && (Boolean(searchResult) || result.searchUsed === true),
          queries: webSearch ? searchResult?.queries || result.searchQueries : [],
          sources: webSearch ? searchResult?.sources || result.sources : [],
          ...(webSearch && result.searchSuggestions
            ? { suggestionsHtml: result.searchSuggestions } : {}),
        },
      };
      recordActivity('chat_completed', `回复完成 · ${result.usage?.totalTokens ?? '未知'} Token`, requestId, ownerOf(request));
      if (wantsStream) { streamEvent('done', payload); response.end(); }
      else sendJson(response, 200, payload, { ...rateHeaders, ...dailyHeaders, ...currentTokenHeaders });
    } catch (error) {
      if (error?.usage) {
        currentTokenStatus = recordTokens(error.usage.totalTokens);
        currentTokenHeaders = tokenHeaders(currentTokenStatus);
      }
      const status = Number.isInteger(error?.statusCode) ? error.statusCode : 400;
      const publicMessage = status >= 500
        ? "上游服务暂时不可用，请稍后重试。"
        : status === 429
          ? "上游额度或速率受限，请稍后重试。"
          : error.message || "请求无效。";
      const headers = { ...rateHeaders, ...dailyHeaders, ...currentTokenHeaders };
      if (error?.retryAfter) headers["retry-after"] = error.retryAfter;
      recordActivity(response.destroyed ? 'chat_cancelled' : 'chat_failed', response.destroyed ? '连接中断或用户停止' : `请求失败 · 状态 ${status}`, requestId, ownerOf(request));
      if (response.headersSent && wantsStream) {
        streamEvent('error', { error: publicMessage, status, requestId }); response.end();
      } else sendJson(response, status, { error: publicMessage, requestId }, headers);
    } finally {
      clearInterval(heartbeat);
      activeRequests -= 1;
    }
  }

  function checkOpenAIAccess(request, response, corsHeaders) {
    if (config.localDevNoAuth && !requestHostIsLoopback(request)) {
      sendOpenAIError(response, 403, "Local development API only accepts loopback hosts", corsHeaders);
      return false;
    }
    if (!tokenMatches(bearerToken(request), config.gatewayAccessToken)) {
      sendOpenAIError(response, 401, "Invalid API key", {
        ...corsHeaders,
        "www-authenticate": "Bearer",
      }, "invalid_api_key");
      return false;
    }
    return true;
  }

  async function handleOpenAIChat(request, response, corsHeaders) {
    if (!checkOpenAIAccess(request, response, corsHeaders)) return;

    const requestId = randomUUID();
    const commonHeaders = { ...corsHeaders, "x-request-id": requestId };
    const rate = consumeRateLimit(clientIp(request, config));
    const rateHeaders = {
      ...commonHeaders,
      "ratelimit-limit": String(config.rateLimitPerMinute),
      "ratelimit-remaining": String(rate.remaining),
      "ratelimit-reset": String(rate.resetSeconds),
    };
    if (!rate.allowed) {
      sendOpenAIError(response, 429, "Rate limit exceeded", {
        ...rateHeaders,
        "retry-after": String(rate.resetSeconds),
      }, "rate_limit_exceeded");
      return;
    }
    if (activeRequests >= config.maxConcurrentRequests) {
      sendOpenAIError(response, 503, "Too many concurrent requests", {
        ...rateHeaders,
        "retry-after": "2",
      });
      return;
    }

    activeRequests += 1;
    let dailyHeaders = {};
    let currentTokenStatus = tokenStatus();
    let currentTokenHeaders = tokenHeaders(currentTokenStatus);
    let selectedProvider;
    try {
      const body = await readJson(request, config.maxBodyBytes);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw new Error("Request body must be a JSON object");
      }
      if (body.stream !== undefined && body.stream !== false) {
        throw new Error("streaming is not supported; set stream to false");
      }
      const unsupported = Object.keys(body).find((key) => ![
        "model", "messages", "stream", "max_tokens", "max_completion_tokens",
      ].includes(key));
      if (unsupported) throw new Error(`Unsupported parameter: ${unsupported}`);

      selectedProvider = selectOpenAIProvider(body, config);
      const { messages, instructions } = validateOpenAIMessages(body.messages, config.maxInputChars);
      if (body.max_tokens !== undefined && body.max_completion_tokens !== undefined) {
        throw new Error("Provide either max_tokens or max_completion_tokens, not both");
      }
      const requestedMaxTokens = body.max_tokens ?? body.max_completion_tokens;
      validateGenerationParameters({ max_output_tokens: requestedMaxTokens },
        selectedProvider, selectedProvider.model, config);

      if (!currentTokenStatus.allowed) {
        sendOpenAIError(response, 429, "Daily token limit exceeded", {
          ...rateHeaders,
          ...currentTokenHeaders,
          "retry-after": String(currentTokenStatus.resetSeconds),
        }, "rate_limit_exceeded");
        return;
      }
      const daily = consumeDailyRequest();
      dailyHeaders = {
        "x-daily-request-limit": String(config.dailyRequestLimit),
        "x-daily-request-remaining": String(daily.remaining),
        "x-daily-request-reset": String(daily.resetSeconds),
      };
      if (!daily.allowed) {
        sendOpenAIError(response, 429, "Daily request limit exceeded", {
          ...rateHeaders,
          ...dailyHeaders,
          "retry-after": String(daily.resetSeconds),
        }, "rate_limit_exceeded");
        return;
      }

      const requestConfig = {
        ...config,
        systemPrompt: instructions ? `${config.systemPrompt}\n\n${instructions}` : config.systemPrompt,
        maxOutputTokens: requestedMaxTokens ?? (config.maxOutputTokens > 0
          ? outputTokenLimit(selectedProvider, selectedProvider.model, config.maxOutputTokens) : 0),
      };
      const result = await callProvider({
        provider: selectedProvider,
        messages,
        config: requestConfig,
        request,
        response,
        requestId,
        fetchImpl,
      });
      currentTokenStatus = recordTokens(result.usage?.totalTokens);
      currentTokenHeaders = tokenHeaders(currentTokenStatus);
      if (!currentTokenStatus.recorded) {
        console.error(JSON.stringify({
          level: "error",
          event: "upstream_usage_missing",
          requestId,
          upstreamRequestId: result.upstreamRequestId,
          provider: selectedProvider.id,
        }));
      }
      sendJson(response, 200, {
        id: `chatcmpl-${requestId}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: selectedProvider.id,
        choices: [{
          index: 0,
          message: { role: "assistant", content: result.text },
          finish_reason: result.finishReason || "stop",
        }],
        usage: result.usage ? {
          prompt_tokens: result.usage.inputTokens,
          completion_tokens: result.usage.outputTokens,
          total_tokens: result.usage.totalTokens,
        } : null,
      }, { ...rateHeaders, ...dailyHeaders, ...currentTokenHeaders });
    } catch (error) {
      if (error?.usage) {
        currentTokenStatus = recordTokens(error.usage.totalTokens);
        currentTokenHeaders = tokenHeaders(currentTokenStatus);
      }
      const status = Number.isInteger(error?.statusCode) ? error.statusCode : 400;
      const message = status >= 500 ? "Upstream service is temporarily unavailable"
        : status === 429 ? "Upstream rate limit exceeded"
          : error.message || "Invalid request";
      const headers = { ...rateHeaders, ...dailyHeaders, ...currentTokenHeaders };
      if (error?.retryAfter) headers["retry-after"] = error.retryAfter;
      sendOpenAIError(response, status, message, headers);
    } finally {
      activeRequests -= 1;
    }
  }

  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://backend.local");
    const started = Date.now();
    requestOwners.set(request, accountRoutes?.authenticate(request)?.user.id || null);
    let logged = false;
    const recordRequest = cancelled => {
      if (logged || /^\/api\/account\/(session|register|login|logout|password|recover)$/.test(url.pathname)) return;
      logged = true;
      runtimeLogs.push({ time: new Date().toISOString(), method: request.method,
        path: url.pathname.startsWith('/api/shared-conversations') ? '/api/shared-conversations'
          : url.pathname.startsWith('/api/account/conversations') ? '/api/account/conversations' : url.pathname.slice(0, 80),
        status: cancelled ? 499 : response.statusCode, durationMs: Date.now() - started, ownerId: ownerOf(request) });
      if (runtimeLogs.length > 200) runtimeLogs.shift();
    };
    response.once('finish', () => recordRequest(false));
    response.once('close', () => { if (!response.writableEnded) recordRequest(true); });
    const cors = originPolicy(request, config);
    if (!cors.allowed) {
      if (url.pathname.startsWith("/v1/")) {
        sendOpenAIError(response, 403, "Origin is not allowed");
      } else {
        sendJson(response, 403, { error: "Origin is not allowed" });
      }
      return;
    }

    if (url.pathname.startsWith('/api/account/')) {
      if (accountRoutes && await accountRoutes.handle(request, response, url)) return;
      if (url.pathname === '/api/account/session' && request.method === 'GET') { sendJson(response, 200, {enabled: false, user: null}); return; }
      sendJson(response, 404, {error: '账户服务尚未启用。'}); return;
    }
    if (request.headers['x-plaude-account-id'] !== undefined && !validAccount(request)) {
      const authenticated = accountRoutes?.authenticate(request);
      const identityMatches = authenticated && request.headers['x-plaude-account-id'] === authenticated.user.id;
      sendJson(response, identityMatches ? 403 : 401, {error: identityMatches ? '账户请求必须从本站页面发起，请刷新后重试。' : '账户登录状态已改变，请重新登录。'}); return;
    }
    if (ownerOf(request) && !validAccount(request) && !tokenMatches(bearerToken(request), config.gatewayAccessToken)
      && ['/api/chat', '/api/code/run', '/api/activity'].includes(url.pathname)) {
      sendJson(response, 403, {error: '账户请求校验失败，请刷新本站后重试。'}); return;
    }

    if (url.pathname === '/api/activity' || url.pathname === '/api/code/run') {
      if (!checkWebsiteAccess(request, response, cors.headers, true)) return;
      if (url.pathname === '/api/activity' && request.method === 'GET') {
        sendJson(response, 200, { events: visibleLogs(activity, ownerOf(request)),
          requests: visibleLogs(runtimeLogs.filter(item => item.path.startsWith('/api/') && item.path !== '/api/activity'), ownerOf(request)),
          codeEnabled: Boolean(config.codeRunnerSocket), codeBusy: codeBusy && codeBusyOwner === ownerOf(request) }, cors.headers); return;
      }
      if (url.pathname !== '/api/code/run' || request.method !== 'POST') { sendJson(response, 405, { error: 'Method not allowed' }); return; }
      if (!config.codeRunnerSocket) { sendJson(response, 503, { error: '代码执行环境尚未配置。' }); return; }
      if (!consumeRateLimit(clientIp(request, config)).allowed) { sendJson(response, 429, { error: '请求过于频繁，请稍后重试。' }); return; }
      if (codeBusy) { sendJson(response, 429, { error: '代码服务繁忙，请稍后重试。' }); return; }
      utcDayState(codeDay);
      if (codeDay.count >= 200) { sendJson(response, 429, { error: '今日代码运行次数已达 200 次。' }); return; }
      const requestId = randomUUID(), controller = new AbortController();
      codeBusy = true;
      codeBusyOwner = ownerOf(request);
      response.once('close', () => { if (!response.writableEnded) controller.abort(); });
      try {
        const job = validateCodeJob(await readJson(request, 200000));
        codeDay.count++;
        recordActivity('code_started', `${job.language === 'python' ? 'Python' : 'Java'} · 开始隔离执行`, requestId, ownerOf(request));
        const result = await runCode(config.codeRunnerSocket, job, controller.signal);
        try { result.files = validateCodeArtifacts(result.files); }
        catch { result.files = []; result.fileNotice = '生成文件校验失败，程序输出仍保留。'; }
        recordActivity('code_' + result.status, `${job.language} · ${result.durationMs}ms · 退出码 ${result.exitCode ?? '无'}`, requestId, ownerOf(request));
        if (!response.destroyed) sendJson(response, 200, { ...result, requestId }, cors.headers);
      } catch (error) {
        recordActivity(controller.signal.aborted ? 'code_cancelled' : 'code_failed', controller.signal.aborted ? '用户停止执行或连接已断开' : '代码请求失败', requestId, ownerOf(request));
        if (!response.destroyed) sendJson(response, error.statusCode || 400, { error: error.message || '代码执行失败。', requestId }, cors.headers);
      } finally { codeBusy = false; codeBusyOwner = null; }
      return;
    }

    if (url.pathname.startsWith('/api/workspace')) {
      const localSocket = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress);
      if (!workspaceStore || !config.localDevNoAuth || !requestHostIsLoopback(request) || !localSocket
        || (request.headers.origin && !cors.sameOrigin) || request.headers['x-yunjian-workspace'] !== '1') {
        sendJson(response, 403, { error: '连接与代理设置只允许在本机工作区管理。' }); return;
      }
      try {
        if (url.pathname === '/api/workspace/logs' && request.method === 'GET') {
          sendJson(response, 200, { logs: visibleLogs(runtimeLogs, ownerOf(request)) }); return;
        }
        if (url.pathname === '/api/workspace/settings' && request.method === 'GET') {
          sendJson(response, 200, workspaceStore.get()); return;
        }
        if (url.pathname === '/api/workspace/settings' && request.method === 'POST') {
          const body = await readJson(request, 128 * 1024);
          sendJson(response, 200, workspaceStore.save(body)); return;
        }
        if (url.pathname === '/api/workspace/search-test' && request.method === 'POST') {
          const body = await readJson(request, 4096);
          if (!externalSearchEnabled(config)) throw Error('请先保存 Tavily 或 SearXNG 搜索配置；内置搜索在发送消息时运行。');
          if (typeof body.query !== 'string' || !body.query.trim()) throw Error('请输入测试问题。');
          const result = await searchWeb(config.workspaceSearch, body.query, fetchImpl);
          sendJson(response, 200, { sources: result.sources, queries: result.queries }); return;
        }
        if (url.pathname === '/api/workspace/models' && request.method === 'POST') {
          const body = await readJson(request, 4096);
          const provider = Object.hasOwn(config.providers, body?.provider || '') ? config.providers[body.provider] : undefined;
          if (!provider) throw Error('请先保存该服务商的连接设置。');
          const endpoint = new URL(provider.apiUrl);
          if (!/\/(chat\/completions|responses)\/?$/.test(endpoint.pathname)) throw Error('该端点没有兼容的模型目录，请手动填写模型 ID。');
          endpoint.pathname = endpoint.pathname.replace(/\/(chat\/completions|responses)\/?$/, '/models'); endpoint.search = '';
          const result = await fetchImpl(endpoint, { headers: { authorization: `Bearer ${provider.apiKey}`, accept: 'application/json' }, signal: AbortSignal.timeout(15_000), redirect: 'error' });
          if (!result.ok) throw Error(`模型目录返回 ${result.status}，可手动填写模型 ID。`);
          const raw = await result.text();
          if (raw.length > 4 * 1024 * 1024) throw Error('模型目录过大。');
          const catalog = JSON.parse(raw);
          const models = (Array.isArray(catalog.data) ? catalog.data : []).map(item => item.id)
            .filter(id => typeof id === 'string' && /^[~A-Za-z0-9][A-Za-z0-9._~:/+-]{0,191}$/.test(id) && !id.includes('://')).slice(0, 1000);
          if (!models.length) throw Error('服务商没有返回兼容的模型目录。');
          sendJson(response, 200, { models }); return;
        }
        sendJson(response, 405, { error: '不支持的工作区操作。' });
      } catch (error) { sendJson(response, 400, { error: error.message || '设置保存失败。' }); }
      return;
    }

    if (url.pathname.startsWith('/vendor/')) {
      if (!['GET', 'HEAD'].includes(request.method)) { sendJson(response, 405, { error: 'Method not allowed' }); return; }
      const asset = documentAsset(url.pathname);
      if (!asset) { sendJson(response, 404, { error: 'Not found' }); return; }
      sendStatic(response, request.method, asset); return;
    }

    if (url.pathname === "/v1/models" || url.pathname === "/v1/chat/completions") {
      const isModels = url.pathname === "/v1/models";
      if (request.method === "OPTIONS") {
        sendEmpty(response, 204, cors.headers);
        return;
      }
      if (request.method !== (isModels ? "GET" : "POST")) {
        sendOpenAIError(response, 405, "Method not allowed", {
          ...cors.headers,
          allow: isModels ? "GET, OPTIONS" : "POST, OPTIONS",
        });
        return;
      }
      if (isModels) {
        if (!checkOpenAIAccess(request, response, cors.headers)) return;
        sendJson(response, 200, {
          object: "list",
          data: Object.values(config.providers).map(({ id }) => ({
            id,
            object: "model",
            created: 0,
            owned_by: "local-gateway",
          })),
        }, cors.headers);
      } else {
        await handleOpenAIChat(request, response, cors.headers);
      }
      return;
    }

    if (url.pathname === "/healthz") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        sendJson(response, 405, { error: "Method not allowed" }, { allow: "GET, HEAD" });
        return;
      }
      if (request.method === "HEAD") sendEmpty(response, 200);
      else sendJson(response, 200, { ok: true });
      return;
    }

    if (url.pathname === "/api/providers") {
      if (request.method === "OPTIONS") {
        sendEmpty(response, 204, cors.headers);
        return;
      }
      if (request.method !== "GET") {
        sendJson(response, 405, { error: "Method not allowed" }, {
          ...cors.headers,
          allow: "GET, OPTIONS",
        });
        return;
      }
      sendJson(response, 200, {
        defaultProvider: config.defaultProvider,
        concurrentRequests: Math.min(2, config.maxConcurrentRequests),
        limits: {maxInputChars: config.maxInputChars, maxMessages: 24},
        providers: publicProviders(config),
        features: {
          sharedConversations: Boolean(sharedStore),
          parallelTasks: true,
          codeExecution: Boolean(config.codeRunnerSocket),
          activityLogs: true,
        },
      }, cors.headers);
      return;
    }

    const sharedMatch = url.pathname.match(/^\/api\/shared-conversations(?:\/([A-Za-z0-9][A-Za-z0-9_-]{7,79}))?$/);
    if (sharedMatch) {
      if (request.method === "OPTIONS") {
        sendEmpty(response, 204, cors.headers);
        return;
      }
      if (!sharedStore) {
        sendJson(response, 404, { error: "公共对话空间尚未启用。" }, cors.headers);
        return;
      }
      if (!checkWebsiteAccess(request, response, cors.headers)) return;
      try {
        if (request.method === "GET" && !sharedMatch[1]) {
          sendJson(response, 200, { conversations: await sharedStore.list() }, cors.headers);
          return;
        }
        if (request.method === "POST" && !sharedMatch[1]) {
          const body = await readJson(request, Math.max(config.maxBodyBytes, 8 * 1024 * 1024));
          const conversation = sharedStore.upsert(body?.conversation, body?.editKey);
          sendJson(response, 200, { conversation }, cors.headers);
          return;
        }
        if (request.method === "DELETE" && sharedMatch[1]) {
          const body = await readJson(request, 16_384);
          sharedStore.remove(sharedMatch[1], body?.editKey);
          sendEmpty(response, 204, cors.headers);
          return;
        }
        sendJson(response, 405, { error: "Method not allowed" }, {
          ...cors.headers,
          allow: sharedMatch[1] ? "DELETE, OPTIONS" : "GET, POST, OPTIONS",
        });
      } catch (error) {
        sendJson(response, Number.isInteger(error?.statusCode) ? error.statusCode : 400, {
          error: error.message || "公共对话请求无效。",
        }, cors.headers);
      }
      return;
    }

    if (url.pathname === "/api/chat") {
      if (request.method === "OPTIONS") {
        sendEmpty(response, 204, cors.headers);
        return;
      }
      if (request.method !== "POST") {
        sendJson(response, 405, { error: "Method not allowed" }, {
          ...cors.headers,
          allow: "POST, OPTIONS",
        });
        return;
      }
      await handleChat(request, response, cors.headers, cors.sameOrigin);
      return;
    }

    const staticFile = STATIC_FILES.get(url.pathname);
    if (staticFile && (request.method === "GET" || request.method === "HEAD")) {
      sendStatic(response, request.method, staticFile);
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  });

  server.requestTimeout = config.requestTimeoutMs + 10_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  return server;
}
