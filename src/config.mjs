import { readFileSync } from "node:fs";

function readOptionalSecret(environment, name) {
  const fileName = environment[`${name}_FILE`]?.trim();
  if (fileName) return readFileSync(fileName, "utf8").trim();
  return environment[name]?.trim() || undefined;
}

function readRequiredSecret(environment, name) {
  const value = readOptionalSecret(environment, name);
  if (!value) throw new Error(`${name} is required (or set ${name}_FILE)`);
  return value;
}

function integer(environment, name, fallback, minimum, maximum) {
  const raw = environment[name]?.trim();
  if (raw && !/^\d+$/.test(raw)) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  const value = raw ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function httpsUrl(environment, name, fallback, nodeEnv) {
  const value = new URL(environment[name]?.trim() || fallback);
  if (value.protocol !== "https:" && nodeEnv !== "test") {
    throw new Error(`${name} must use HTTPS outside tests`);
  }
  return value.toString();
}

function publicServiceUrl(environment, name, nodeEnv) {
  const raw = environment[name]?.trim();
  if (!raw) return undefined;
  const value = new URL(raw);
  if (!["http:", "https:"].includes(value.protocol) || value.username || value.password) {
    throw new Error(`${name} must be an HTTP(S) URL without embedded credentials`);
  }
  if (value.protocol !== "https:" && nodeEnv === "production") {
    throw new Error(`${name} must use HTTPS in production`);
  }
  value.hash = "";
  return value.toString();
}

function parseOrigins(raw) {
  if (!raw?.trim()) return new Set();

  const origins = new Set();
  for (const candidate of raw.split(",")) {
    const value = candidate.trim();
    if (!value) continue;
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("ALLOWED_ORIGINS only accepts http or https origins");
    }
    if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
      throw new Error("Each ALLOWED_ORIGINS value must be an origin without a path");
    }
    origins.add(url.origin);
  }
  return origins;
}

function modelList(environment, modelName, defaultModel, defaultAlternates = []) {
  const primary = environment[modelName]?.trim() || defaultModel;
  const listName = `${modelName}S`;
  const raw = environment[listName];
  const builtInAlternates = primary === defaultModel ? defaultAlternates : [];
  const candidates = raw === undefined
    ? [primary, ...builtInAlternates]
    : [primary, ...builtInAlternates, ...raw.split(",").map((item) => item.trim())];
  const models = [...new Set(candidates)];
  if (models.length > 24 || models.some((id) =>
    !/^[~A-Za-z0-9][A-Za-z0-9._~:/+-]{0,191}$/.test(id) || id.includes("://")
  )) {
    throw new Error(`${listName} must contain 1 to 24 valid comma-separated model IDs`);
  }
  return Object.freeze(models);
}

function provider(environment, {
  id,
  label,
  secretName,
  urlName,
  defaultUrl,
  modelName,
  defaultModel,
  defaultAlternates = [],
  protocol,
  webSearchProtocol,
  webSearchBaseUrlName,
  defaultWebSearchBaseUrl,
  modelCatalogUrl,
  modelCatalogMode,
  nodeEnv,
}) {
  const apiKey = readOptionalSecret(environment, secretName);
  if (!apiKey) return undefined;
  if (apiKey.length < 20 || /replace|example/i.test(apiKey)) {
    throw new Error(`${secretName} does not look valid`);
  }
  let webSearchApiBaseUrl;
  if (webSearchBaseUrlName && defaultWebSearchBaseUrl) {
    webSearchApiBaseUrl = httpsUrl(
      environment,
      webSearchBaseUrlName,
      defaultWebSearchBaseUrl,
      nodeEnv,
    );
    if (!webSearchApiBaseUrl.endsWith("/")) webSearchApiBaseUrl += "/";
  }
  return Object.freeze({
    id,
    label,
    apiKey,
    apiUrl: httpsUrl(environment, urlName, defaultUrl, nodeEnv),
    model: environment[modelName]?.trim() || defaultModel,
    models: modelList(environment, modelName, defaultModel, defaultAlternates),
    protocol,
    ...(webSearchProtocol ? { webSearchProtocol } : {}),
    ...(webSearchApiBaseUrl ? { webSearchApiBaseUrl } : {}),
    ...(modelCatalogUrl ? { modelCatalogUrl } : {}),
    ...(modelCatalogMode ? { modelCatalogMode } : {}),
  });
}

export function loadConfig(environment = process.env) {
  const nodeEnv = environment.NODE_ENV?.trim() || "production";
  const bindHost = environment.BIND_HOST?.trim() || "0.0.0.0";
  const localDevNoAuth = environment.LOCAL_DEV_NO_AUTH === "1";
  if (localDevNoAuth && (nodeEnv === "production" || !["127.0.0.1", "::1", "localhost"].includes(bindHost))) {
    throw new Error(
      "LOCAL_DEV_NO_AUTH is only allowed outside production when BIND_HOST is loopback",
    );
  }
  const gatewayAccessToken = readRequiredSecret(environment, "GATEWAY_ACCESS_TOKEN");
  if (gatewayAccessToken.length < 32) {
    throw new Error("GATEWAY_ACCESS_TOKEN must contain at least 32 characters");
  }
  const geminiSearchConfigured = !environment.GEMINI_API_URL?.trim()
    || Boolean(environment.GEMINI_SEARCH_API_BASE_URL?.trim());
  const openRouterCatalogConfigured = !environment.OPENROUTER_API_URL?.trim()
    || Boolean(environment.OPENROUTER_MODEL_CATALOG_URL?.trim());
  const openRouterCatalogUrl = openRouterCatalogConfigured
    ? httpsUrl(
      environment,
      "OPENROUTER_MODEL_CATALOG_URL",
      "https://openrouter.ai/api/v1/models/user",
      nodeEnv,
    ) : undefined;
  const openRouterChatUrl = httpsUrl(
    environment,
    "OPENROUTER_API_URL",
    "https://openrouter.ai/api/v1/chat/completions",
    nodeEnv,
  );
  if (openRouterCatalogUrl) {
    const chatOrigin = new URL(openRouterChatUrl).origin;
    if (new URL(openRouterCatalogUrl).origin !== chatOrigin) {
      throw new Error("OPENROUTER_MODEL_CATALOG_URL must use the same origin as OPENROUTER_API_URL");
    }
  }

  const configuredProviders = [
    provider(environment, {
      id: "nvidia",
      label: "NVIDIA / Google DiffusionGemma",
      secretName: "NVIDIA_API_KEY",
      urlName: "NVIDIA_API_URL",
      defaultUrl: "https://integrate.api.nvidia.com/v1/chat/completions",
      modelName: "NVIDIA_MODEL",
      defaultModel: "google/diffusiongemma-26b-a4b-it",
      protocol: "chat-completions",
      nodeEnv,
    }),
    provider(environment, {
      id: "deepseek",
      label: "DeepSeek",
      secretName: "DEEPSEEK_API_KEY",
      urlName: "DEEPSEEK_API_URL",
      defaultUrl: "https://api.deepseek.com/responses",
      modelName: "DEEPSEEK_MODEL",
      defaultModel: "deepseek-flash",
      defaultAlternates: ["deepseek-v4-pro"],
      protocol: "responses",
      nodeEnv,
    }),
    provider(environment, {
      id: "gemini",
      label: "Google Gemini API",
      secretName: "GEMINI_API_KEY",
      urlName: "GEMINI_API_URL",
      defaultUrl: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      modelName: "GEMINI_MODEL",
      defaultModel: "gemini-2.5-flash",
      defaultAlternates: ["gemini-2.5-pro"],
      protocol: "chat-completions",
      webSearchProtocol: geminiSearchConfigured ? "google-search" : undefined,
      webSearchBaseUrlName: geminiSearchConfigured ? "GEMINI_SEARCH_API_BASE_URL" : undefined,
      defaultWebSearchBaseUrl: geminiSearchConfigured
        ? "https://generativelanguage.googleapis.com/v1beta/models/" : undefined,
      nodeEnv,
    }),
    provider(environment, {
      id: "openrouter",
      label: "OpenRouter · 精选模型",
      secretName: "OPENROUTER_API_KEY",
      urlName: "OPENROUTER_API_URL",
      defaultUrl: openRouterChatUrl,
      modelName: "OPENROUTER_MODEL",
      defaultModel: "openrouter/auto",
      defaultAlternates: [
        "openrouter/free",
        "qwen/qwen3.8-27b:free",
        "z-ai/glm-5.2:free",
        "nvidia/nemotron-3-ultra-550b-a55b:free",
        "google/gemma-4-31b-it:free",
        "~openai/gpt-sol-latest",
        "~openai/gpt-astra-latest",
        "~openai/gpt-terra-latest",
        "~anthropic/claude-opus-latest",
        "~anthropic/claude-sonnet-latest",
        "~anthropic/claude-haiku-latest",
        "~google/gemini-pro-latest",
        "~google/gemini-flash-latest",
        "~deepseek/deepseek-pro-latest",
        "~deepseek/deepseek-flash-latest",
        "~x-ai/grok-latest",
        "qwen/qwen3.8-max-0902",
        "qwen/qwen3.8-flash",
        "~moonshotai/kimi-latest",
        "moonshotai/kimi-k2.7-code",
        "~z-ai/glm-latest",
        "~z-ai/glm-flash-latest",
        "minimax/minimax-m3",
      ],
      protocol: "chat-completions",
      webSearchProtocol: "openrouter-web-search",
      modelCatalogUrl: openRouterCatalogUrl,
      modelCatalogMode: "curated",
      nodeEnv,
    }),
    provider(environment, {
      id: "openai",
      label: "OpenAI",
      secretName: "OPENAI_API_KEY",
      urlName: "OPENAI_API_URL",
      defaultUrl: "https://api.openai.com/v1/responses",
      modelName: "OPENAI_MODEL",
      defaultModel: "gpt-5.6-terra",
      protocol: "responses",
      webSearchProtocol: "openai-web-search",
      nodeEnv,
    }),
  ].filter(Boolean);

  if (configuredProviders.length === 0) {
    throw new Error(
      "At least one provider key is required: NVIDIA_API_KEY, DEEPSEEK_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY, or OPENAI_API_KEY",
    );
  }

  const providers = Object.freeze(Object.fromEntries(
    configuredProviders.map((item) => [item.id, item]),
  ));
  const defaultProvider = environment.DEFAULT_PROVIDER?.trim() || configuredProviders[0].id;
  if (!providers[defaultProvider]) {
    throw new Error(`DEFAULT_PROVIDER is not configured: ${defaultProvider}`);
  }

  return Object.freeze({
    nodeEnv,
    port: integer(environment, "PORT", 3000, 1, 65535),
    bindHost,
    localDevNoAuth,
    trustProxy: environment.TRUST_PROXY === "1",
    gatewayAccessToken,
    providers,
    defaultProvider,
    maxOutputTokens: integer(environment, "MAX_OUTPUT_TOKENS", 0, 0, Number.MAX_SAFE_INTEGER),
    systemPrompt:
      environment.SYSTEM_PROMPT?.trim() || "You are a concise and helpful assistant.",
    allowedOrigins: parseOrigins(environment.ALLOWED_ORIGINS),
    rateLimitPerMinute: integer(environment, "RATE_LIMIT_PER_MINUTE", 10, 1, 600),
    maxRateLimitBuckets: integer(environment, "MAX_RATE_LIMIT_BUCKETS", 2048, 16, 100000),
    maxConcurrentRequests: integer(environment, "MAX_CONCURRENT_REQUESTS", 2, 1, 20),
    dailyRequestLimit: integer(environment, "DAILY_REQUEST_LIMIT", 100, 1, 100000),
    dailyTokenLimit: integer(environment, "DAILY_TOKEN_LIMIT", 200000, 1000, 1000000000),
    requestTimeoutMs: integer(environment, "REQUEST_TIMEOUT_MS", 90000, 1000, 300000),
    maxBodyBytes: integer(environment, "MAX_BODY_BYTES", 65536, 1024, 1048576),
    maxInputChars: integer(environment, "MAX_INPUT_CHARS", 24000, 1000, 200000),
    codeRunnerSocket: environment.CODE_RUNNER_SOCKET?.trim() || undefined,
    sharedConversationsFile: environment.SHARED_CONVERSATIONS_FILE?.trim() || undefined,
    accountStoreFile: environment.ACCOUNT_STORE_FILE?.trim() || undefined,
    sharedSyncUrl: publicServiceUrl(environment, "SHARED_SYNC_URL", nodeEnv),
    sharedSyncToken: readOptionalSecret(environment, "SHARED_SYNC_TOKEN"),
  });
}
