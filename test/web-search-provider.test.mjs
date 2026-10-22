import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { callProvider } from "../src/providers.mjs";

function connectionObjects() {
  return { request: new EventEmitter(), response: new EventEmitter() };
}

const baseConfig = {
  systemPrompt: "Answer with sources.",
  maxOutputTokens: 800,
  requestTimeoutMs: 5000,
};

test("OpenAI web search is required and returns safe cited sources", async () => {
  let captured;
  const { request, response } = connectionObjects();
  const result = await callProvider({
    provider: {
      id: "openai",
      apiUrl: "http://openai.test/responses",
      apiKey: "sk-openai-test-abcdefghijklmnopqrstuvwxyz",
      model: "gpt-5.6-terra",
      protocol: "responses",
      webSearchProtocol: "openai-web-search",
    },
    messages: [{ role: "user", content: "What changed today?" }],
    config: baseConfig,
    request,
    response,
    requestId: "search-openai",
    webSearch: true,
    fetchImpl: async (url, options) => {
      captured = { url, options, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({
        status: "completed",
        output: [
          {
            type: "web_search_call",
            action: {
              type: "search",
              query: "today changes",
              sources: [
                { title: "Example duplicate", url: "https://example.com/news" },
                { title: "Second", url: "https://second.example/story" },
                { title: "Unsafe", url: "javascript:alert(1)" },
              ],
            },
          },
          {
            type: "message",
            content: [{
              type: "output_text",
              text: "Fresh result",
              annotations: [{
                type: "url_citation",
                url: "https://example.com/news",
                title: "Example",
                start_index: 0,
                end_index: 5,
              }],
            }],
          },
        ],
        usage: { input_tokens: 9, output_tokens: 3, total_tokens: 12 },
      }), { status: 200, headers: { "x-request-id": "upstream-search" } });
    },
  });

  assert.equal(captured.url, "http://openai.test/responses");
  assert.equal(captured.options.redirect, "error");
  assert.deepEqual(captured.body.tools, [{ type: "web_search" }]);
  assert.equal(captured.body.tool_choice, "required");
  assert.equal(captured.body.max_tool_calls, 3);
  assert.deepEqual(captured.body.include, ["web_search_call.action.sources"]);
  assert.equal(captured.body.store, false);
  assert.equal(result.text, "Fresh [1](https://example.com/news) result");
  assert.equal(result.searchUsed, true);
  assert.deepEqual(result.searchQueries, ["today changes"]);
  assert.deepEqual(result.sources, [
    { title: "Example", url: "https://example.com/news" },
    { title: "Second", url: "https://second.example/story" },
  ]);
});

test("OpenRouter web search is bounded and returns citation annotations", async () => {
  let captured;
  const { request, response } = connectionObjects();
  const result = await callProvider({
    provider: {
      id: "openrouter",
      apiUrl: "http://openrouter.test/api/v1/chat/completions",
      apiKey: "sk-or-v1-test-abcdefghijklmnopqrstuvwxyz",
      model: "anthropic/claude-sonnet-test",
      protocol: "chat-completions",
      webSearchProtocol: "openrouter-web-search",
    },
    messages: [{ role: "user", content: "今天有什么更新？" }],
    config: baseConfig,
    request,
    response,
    requestId: "search-openrouter",
    webSearch: true,
    fetchImpl: async (url, options) => {
      captured = { url, options, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({
        choices: [{
          message: {
            role: "assistant",
            content: "今日有更新",
            annotations: [{
              type: "url_citation",
              url_citation: {
                url: "https://example.com/update",
                title: "Update",
                start_index: 0,
                end_index: 2,
              },
            }],
          },
          finish_reason: "stop",
        }],
        usage: {
          prompt_tokens: 8,
          completion_tokens: 4,
          total_tokens: 12,
          server_tool_use: { web_search_requests: 1 },
        },
      }), { status: 200 });
    },
  });

  assert.equal(captured.options.redirect, "error");
  assert.deepEqual(captured.body.tools, [{
    type: "openrouter:web_search",
    parameters: {
      engine: "auto",
      max_results: 5,
      max_total_results: 10,
      max_uses: 2,
      search_context_size: "low",
    },
  }]);
  assert.equal(captured.body.max_tool_calls, 3);
  assert.equal(result.searchUsed, true);
  assert.deepEqual(result.sources, [{ title: "Update", url: "https://example.com/update" }]);
  assert.equal(result.text, "今日 [1](https://example.com/update)有更新");
});

test("Gemini web search uses GenerateContent and parses grounding without thoughts", async () => {
  let captured;
  const { request, response } = connectionObjects();
  const result = await callProvider({
    provider: {
      id: "gemini",
      apiUrl: "http://gemini.test/v1/chat/completions",
      webSearchApiBaseUrl: "http://gemini-search.test/v1beta/models/",
      apiKey: "gemini-test-key-abcdefghijklmnopqrstuvwxyz",
      model: "gemini-2.5-pro",
      protocol: "chat-completions",
      webSearchProtocol: "google-search",
    },
    messages: [
      { role: "user", content: "第一问" },
      { role: "assistant", content: "旧回复" },
      { role: "user", content: "查一下最新资料" },
    ],
    config: baseConfig,
    generationParameters: { temperature: 0.4, top_p: 0.8 },
    request,
    response,
    requestId: "search-gemini",
    webSearch: true,
    fetchImpl: async (url, options) => {
      captured = { url, options, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({
        candidates: [{
          content: { parts: [{ thought: true, text: "hidden reasoning" }, { text: "联网回答" }] },
          finishReason: "STOP",
          groundingMetadata: {
            webSearchQueries: ["最新资料 2026", "最新资料 2026"],
            groundingChunks: [
              { web: { title: "资料来源", uri: "https://source.example/report" } },
              { web: { title: "Bad", uri: "https://user:pass@unsafe.example/" } },
            ],
            searchEntryPoint: { renderedContent: "<style>.chip{color:green}</style><a class=\"chip\" href=\"https://www.google.com/search?q=test\">test</a>" },
          },
        }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4, totalTokenCount: 14 },
      }), { status: 200, headers: { "x-goog-request-id": "google-search-id" } });
    },
  });

  assert.equal(captured.url, "http://gemini-search.test/v1beta/models/gemini-2.5-pro:generateContent");
  assert.equal(captured.options.redirect, "error");
  assert.equal(captured.options.headers["x-goog-api-key"], "gemini-test-key-abcdefghijklmnopqrstuvwxyz");
  assert.equal(Object.hasOwn(captured.options.headers, "authorization"), false);
  assert.deepEqual(captured.body.tools, [{ google_search: {} }]);
  assert.deepEqual(captured.body.systemInstruction, { parts: [{ text: "Answer with sources." }] });
  assert.deepEqual(captured.body.contents.map(({ role }) => role), ["user", "model", "user"]);
  assert.deepEqual(captured.body.generationConfig, {
    maxOutputTokens: 800,
    temperature: 0.4,
    topP: 0.8,
    thinkingConfig: { thinkingBudget: 128 },
  });
  assert.equal(result.text, "联网回答");
  assert.equal(result.finishReason, "stop");
  assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 4, totalTokens: 14 });
  assert.deepEqual(result.sources, [{ title: "资料来源", url: "https://source.example/report" }]);
  assert.deepEqual(result.searchQueries, ["最新资料 2026"]);
  assert.match(result.searchSuggestions, /Google|google/);
  assert.equal(result.searchUsed, true);
});

test("unsupported providers reject web search before any upstream call", async () => {
  let calls = 0;
  const { request, response } = connectionObjects();
  await assert.rejects(callProvider({
    provider: {
      id: "deepseek",
      apiUrl: "http://deepseek.test/responses",
      apiKey: "sk-deepseek-test-abcdefghijklmnopqrstuvwxyz",
      model: "deepseek-test",
      protocol: "responses",
    },
    messages: [{ role: "user", content: "search" }],
    config: baseConfig,
    request,
    response,
    requestId: "search-unsupported",
    webSearch: true,
    fetchImpl: async () => { calls += 1; },
  }), (error) => error.statusCode === 400);
  assert.equal(calls, 0);
});

test("Gemini rejects grounded output when required search suggestions are absent", async () => {
  const { request, response } = connectionObjects();
  await assert.rejects(callProvider({
    provider: {
      id: "gemini",
      apiUrl: "http://gemini.test/v1/chat/completions",
      webSearchApiBaseUrl: "http://gemini-search.test/v1beta/models/",
      apiKey: "gemini-test-key-abcdefghijklmnopqrstuvwxyz",
      model: "gemini-2.5-flash",
      protocol: "chat-completions",
      webSearchProtocol: "google-search",
    },
    messages: [{ role: "user", content: "latest" }],
    config: baseConfig,
    request,
    response,
    requestId: "search-no-suggestions",
    webSearch: true,
    fetchImpl: async () => new Response(JSON.stringify({
      candidates: [{
        content: { parts: [{ text: "Grounded answer" }] },
        groundingMetadata: {
          webSearchQueries: ["latest"],
          groundingChunks: [{ web: { title: "Source", uri: "https://example.com/latest" } }],
        },
      }],
      usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 2, totalTokenCount: 4 },
    }), { status: 200 }),
  }), (error) => error.statusCode === 502 && error.usage?.totalTokens === 4);
});
