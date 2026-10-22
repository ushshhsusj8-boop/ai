import assert from "node:assert/strict";
import { test } from "node:test";

import { loadConfig } from "../src/config.mjs";

const baseEnvironment = Object.freeze({
  NODE_ENV: "test",
  BIND_HOST: "127.0.0.1",
  GATEWAY_ACCESS_TOKEN: "gateway-test-token-abcdefghijklmnopqrstuvwxyz",
  DEEPSEEK_API_KEY: "sk-deepseek-test-abcdefghijklmnopqrstuvwxyz",
  DEEPSEEK_API_URL: "https://deepseek.test/responses",
  DEFAULT_PROVIDER: "deepseek",
});

test("local no-auth mode is accepted only for non-production loopback use", () => {
  const local = loadConfig({
    ...baseEnvironment,
    NODE_ENV: "development",
    LOCAL_DEV_NO_AUTH: "1",
  });
  assert.equal(local.localDevNoAuth, true);
  assert.equal(local.bindHost, "127.0.0.1");

  assert.throws(() => loadConfig({
    ...baseEnvironment,
    NODE_ENV: "production",
    LOCAL_DEV_NO_AUTH: "1",
  }), /only allowed outside production/);

  assert.throws(() => loadConfig({
    ...baseEnvironment,
    NODE_ENV: "development",
    BIND_HOST: "0.0.0.0",
    LOCAL_DEV_NO_AUTH: "1",
  }), /only allowed outside production/);
});

test("integer settings reject partial and decimal values", () => {
  assert.throws(() => loadConfig({
    ...baseEnvironment,
    RATE_LIMIT_PER_MINUTE: "10oops",
  }), /RATE_LIMIT_PER_MINUTE must be an integer/);

  assert.throws(() => loadConfig({
    ...baseEnvironment,
    DAILY_REQUEST_LIMIT: "1.9",
  }), /DAILY_REQUEST_LIMIT must be an integer/);
});

test("chat configuration ignores retired Sub2 integration settings", () => {
  for (const nodeEnv of ["development", "production"]) {
    const config = loadConfig({
      ...baseEnvironment,
      NODE_ENV: nodeEnv,
      SUB2_PUBLIC_URL: "retired-invalid-value",
    });
    assert.equal(Object.hasOwn(config, "sub2PublicUrl"), false);
  }
});

test("NVIDIA defaults to the hosted DiffusionGemma model", () => {
  const config = loadConfig({
    ...baseEnvironment,
    NVIDIA_API_KEY: "nvapi-test-abcdefghijklmnopqrstuvwxyz",
  });

  assert.equal(config.providers.nvidia.label, "NVIDIA / Google DiffusionGemma");
  assert.equal(config.providers.nvidia.model, "google/diffusiongemma-26b-a4b-it");
});

test("a Gemini API key enables the official Google endpoint", () => {
  const config = loadConfig({
    NODE_ENV: "test",
    BIND_HOST: "127.0.0.1",
    GATEWAY_ACCESS_TOKEN: baseEnvironment.GATEWAY_ACCESS_TOKEN,
    GEMINI_API_KEY: "gemini-test-key-abcdefghijklmnopqrstuvwxyz",
  });

  assert.equal(config.defaultProvider, "gemini");
  assert.deepEqual(Object.keys(config.providers), ["gemini"]);
  assert.equal(config.providers.gemini.label, "Google Gemini API");
  assert.equal(config.providers.gemini.apiUrl,
    "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
  assert.equal(config.providers.gemini.model, "gemini-2.5-flash");
  assert.deepEqual(config.providers.gemini.models, ["gemini-2.5-flash", "gemini-2.5-pro"]);
  assert.equal(config.providers.gemini.protocol, "chat-completions");
  assert.equal(config.providers.gemini.webSearchProtocol, "google-search");
  assert.equal(config.providers.gemini.webSearchApiBaseUrl,
    "https://generativelanguage.googleapis.com/v1beta/models/");
});

test("model options are server allowlisted and DeepSeek includes its official alternate", () => {
  const config = loadConfig(baseEnvironment);
  assert.deepEqual(config.providers.deepseek.models, ["deepseek-flash", "deepseek-v4-pro"]);

  const expanded = loadConfig({
    ...baseEnvironment,
    DEEPSEEK_MODELS: "deepseek-v4-pro,deepseek-flash",
    NVIDIA_API_KEY: "nvapi-test-abcdefghijklmnopqrstuvwxyz",
    NVIDIA_MODELS: "google/diffusiongemma-26b-a4b-it,google/gemma-4-31b-it",
  });
  assert.deepEqual(expanded.providers.deepseek.models, ["deepseek-flash", "deepseek-v4-pro"]);
  assert.deepEqual(expanded.providers.nvidia.models, [
    "google/diffusiongemma-26b-a4b-it", "google/gemma-4-31b-it",
  ]);
  assert.throws(() => loadConfig({ ...baseEnvironment, DEEPSEEK_MODELS: "" }), /DEEPSEEK_MODELS/);
  assert.throws(() => loadConfig({ ...baseEnvironment, DEEPSEEK_MODELS: "https:\/\/evil.test" }), /DEEPSEEK_MODELS/);
  assert.throws(() => loadConfig({ ...baseEnvironment, DEEPSEEK_MODEL: "../../bad" }), /DEEPSEEK_MODELS/);
});

test("Gemini model and API URL can be configured without changing other providers", () => {
  const config = loadConfig({
    ...baseEnvironment,
    GEMINI_API_KEY: "gemini-test-key-abcdefghijklmnopqrstuvwxyz",
    GEMINI_MODEL: "gemini-2.5-pro",
    GEMINI_API_URL: "https://proxy.example/v1/chat/completions",
    GEMINI_SEARCH_API_BASE_URL: "https://proxy.example/v1beta/models",
  });

  assert.equal(config.defaultProvider, "deepseek");
  assert.equal(config.providers.gemini.model, "gemini-2.5-pro");
  assert.equal(config.providers.gemini.apiUrl, "https://proxy.example/v1/chat/completions");
  assert.equal(config.providers.gemini.webSearchApiBaseUrl, "https://proxy.example/v1beta/models/");
  assert.equal(config.providers.deepseek.model, "deepseek-flash");

  const appended = loadConfig({
    ...baseEnvironment,
    GEMINI_API_KEY: "gemini-test-key-abcdefghijklmnopqrstuvwxyz",
    GEMINI_MODELS: "gemini-3.8-flash",
  });
  assert.deepEqual(appended.providers.gemini.models, [
    "gemini-2.5-flash", "gemini-2.5-pro", "gemini-3.8-flash",
  ]);

  const customChatOnly = loadConfig({
    ...baseEnvironment,
    GEMINI_API_KEY: "gemini-test-key-abcdefghijklmnopqrstuvwxyz",
    GEMINI_API_URL: "https://proxy.example/v1/chat/completions",
  });
  assert.equal(customChatOnly.providers.gemini.webSearchProtocol, undefined);
  assert.equal(customChatOnly.providers.gemini.webSearchApiBaseUrl, undefined);
});

test("an OpenRouter key enables its curated account-filtered model catalog and web search", () => {
  const config = loadConfig({
    ...baseEnvironment,
    OPENROUTER_API_KEY: "sk-or-v1-test-abcdefghijklmnopqrstuvwxyz",
  });
  const provider = config.providers.openrouter;
  assert.equal(provider.label, "OpenRouter · 精选模型");
  assert.equal(provider.apiUrl, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(provider.modelCatalogUrl, "https://openrouter.ai/api/v1/models/user");
  assert.equal(provider.model, "openrouter/auto");
  assert.equal(provider.webSearchProtocol, "openrouter-web-search");
  assert.equal(provider.modelCatalogMode, "curated");
  assert.equal(provider.models.length, 24);
  assert.ok(provider.models.includes("openrouter/free"));
  assert.ok(provider.models.includes("qwen/qwen3.8-27b:free"));
  assert.ok(provider.models.includes("z-ai/glm-5.2:free"));
  assert.ok(provider.models.includes("nvidia/nemotron-3-ultra-550b-a55b:free"));
  assert.ok(provider.models.includes("google/gemma-4-31b-it:free"));
  assert.ok(provider.models.includes("~openai/gpt-astra-latest"));
  assert.ok(provider.models.includes("~anthropic/claude-opus-latest"));
  assert.ok(provider.models.includes("~anthropic/claude-sonnet-latest"));
  assert.ok(provider.models.includes("~google/gemini-pro-latest"));
  assert.ok(provider.models.includes("~deepseek/deepseek-pro-latest"));
  assert.ok(provider.models.includes("~x-ai/grok-latest"));
  assert.ok(provider.models.includes("qwen/qwen3.8-max-0902"));
  assert.ok(provider.models.includes("~moonshotai/kimi-latest"));
  assert.ok(provider.models.includes("~z-ai/glm-latest"));
  assert.ok(provider.models.includes("minimax/minimax-m3"));

  const customChatOnly = loadConfig({
    ...baseEnvironment,
    OPENROUTER_API_KEY: "sk-or-v1-test-abcdefghijklmnopqrstuvwxyz",
    OPENROUTER_API_URL: "https://router-proxy.example/api/v1/chat/completions",
  });
  assert.equal(customChatOnly.providers.openrouter.modelCatalogUrl, undefined);
  assert.throws(() => loadConfig({
    ...baseEnvironment,
    OPENROUTER_API_KEY: "sk-or-v1-test-abcdefghijklmnopqrstuvwxyz",
    OPENROUTER_API_URL: "https://router-proxy.example/api/v1/chat/completions",
    OPENROUTER_MODEL_CATALOG_URL: "https://openrouter.ai/api/v1/models/user",
  }), /same origin/);
  assert.throws(() => loadConfig({
    ...baseEnvironment,
    OPENROUTER_API_KEY: "sk-or-v1-test-abcdefghijklmnopqrstuvwxyz",
    OPENROUTER_MODEL_CATALOG_URL: "https://catalog-elsewhere.example/api/v1/models/user",
  }), /same origin/);
});
