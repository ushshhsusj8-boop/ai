import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";

import { loadConfig } from "../src/config.mjs";
import { callProvider } from "../src/providers.mjs";

test("Gemini sends an authenticated OpenAI-compatible request and parses its reply", async () => {
  const config = loadConfig({
    NODE_ENV: "test",
    BIND_HOST: "127.0.0.1",
    GATEWAY_ACCESS_TOKEN: "gateway-test-token-abcdefghijklmnopqrstuvwxyz",
    GEMINI_API_KEY: "gemini-test-key-abcdefghijklmnopqrstuvwxyz",
    SYSTEM_PROMPT: "Answer briefly.",
    MAX_OUTPUT_TOKENS: "600",
  });

  let captured;
  const result = await callProvider({
    provider: config.providers.gemini,
    messages: [{ role: "user", content: "你好" }],
    config,
    request: new EventEmitter(),
    response: new EventEmitter(),
    requestId: "test-gemini",
    fetchImpl: async (url, options) => {
      captured = { url, options, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content: "你好！" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      }), { status: 200, headers: { "x-goog-request-id": "google-test-id" } });
    },
  });

  assert.equal(captured.url,
    "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
  assert.equal(captured.options.method, "POST");
  assert.equal(captured.options.headers.authorization, `Bearer ${config.providers.gemini.apiKey}`);
  assert.equal(captured.options.headers["content-type"], "application/json");
  assert.deepEqual(captured.body, {
    model: "gemini-2.5-flash",
    messages: [
      { role: "system", content: "Answer briefly." },
      { role: "user", content: "你好" },
    ],
    max_tokens: 600,
    stream: false,
    reasoning_effort: "none",
  });
  assert.deepEqual(result, {
    text: "你好！",
    usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
    finishReason: "stop",
    upstreamRequestId: "google-test-id",
  });
});

test("Gemini 3 overrides do not receive unsupported thinking-off settings", async () => {
  const config = loadConfig({
    NODE_ENV: "test",
    BIND_HOST: "127.0.0.1",
    GATEWAY_ACCESS_TOKEN: "gateway-test-token-abcdefghijklmnopqrstuvwxyz",
    GEMINI_API_KEY: "gemini-test-key-abcdefghijklmnopqrstuvwxyz",
    GEMINI_MODEL: "gemini-3.8-flash",
  });
  let body;
  await callProvider({
    provider: config.providers.gemini,
    messages: [{ role: "user", content: "hello" }],
    config,
    request: new EventEmitter(),
    response: new EventEmitter(),
    requestId: "test-gemini-3",
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return new Response(JSON.stringify({
        choices: [{ message: { content: "Hello" }, finish_reason: "length" }],
      }), { status: 200 });
    },
  });
  assert.equal(body.model, "gemini-3.8-flash");
  assert.equal(Object.hasOwn(body, "reasoning_effort"), false);
});
