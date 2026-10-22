import assert from "node:assert/strict";
import { once } from "node:events";
import { afterEach, test } from "node:test";

import { createGatewayServer } from "../src/app.mjs";

const servers = [];
const gatewayToken = "gateway-test-token-abcdefghijklmnopqrstuvwxyz";

function config(overrides = {}) {
  return {
    nodeEnv: "test",
    port: 0,
    bindHost: "127.0.0.1",
    localDevNoAuth: false,
    trustProxy: false,
    gatewayAccessToken: gatewayToken,
    providers: {
      nvidia: {
        id: "nvidia",
    label: "NVIDIA / Google DiffusionGemma",
        apiUrl: "http://nvidia.test/v1/chat/completions",
        apiKey: "nvapi-test-abcdefghijklmnopqrstuvwxyz",
        model: "google/gemma-test",
        models: ["google/gemma-test", "google/gemma-alternative"],
        protocol: "chat-completions",
      },
      deepseek: {
        id: "deepseek",
        label: "DeepSeek",
        apiUrl: "http://deepseek.test/responses",
        apiKey: "sk-deepseek-test-abcdefghijklmnopqrstuvwxyz",
        model: "deepseek-test",
        models: ["deepseek-test", "deepseek-v4-pro"],
        protocol: "responses",
      },
    },
    defaultProvider: "deepseek",
    maxOutputTokens: 1200,
    systemPrompt: "Test system prompt",
    allowedOrigins: new Set(),
    rateLimitPerMinute: 100,
    maxRateLimitBuckets: 32,
    maxConcurrentRequests: 2,
    dailyRequestLimit: 100,
    dailyTokenLimit: 200000,
    requestTimeoutMs: 5000,
    maxBodyBytes: 65536,
    maxInputChars: 24000,
    ...overrides,
  };
}

async function start(fetchImpl, overrides, sharedStore) {
  const server = createGatewayServer({ config: config(overrides), fetchImpl, sharedStore });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

function chatRequest(baseUrl, body, extraHeaders = {}) {
  return fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${gatewayToken}`,
      "content-type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

function compatibleChatRequest(baseUrl, body, extraHeaders = {}) {
  return fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${gatewayToken}`,
      "content-type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

afterEach(async () => {
  while (servers.length) {
    const server = servers.pop();
    if (server.listening) {
      server.close();
      await once(server, "close");
    }
  }
});

test('automatic output omits token fields while explicit large values reach both upstream protocols and compatible API', async () => {
  const captured = [];
  const text = 'synthetic answer '.repeat(2000).trim();
  const baseUrl = await start(async (url, options) => {
    const body = JSON.parse(options.body); captured.push(body);
    return Response.json(url.includes('responses')
      ? { output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }
      : { choices: [{ message: { content: text } }] });
  }, { maxOutputTokens: 0 });
  for (const provider of ['deepseek', 'nvidia']) {
    for (const max of [undefined, 65536]) {
      const response = await chatRequest(baseUrl, { provider,
        parameters: max ? { max_output_tokens: max } : {}, messages: [{ role: 'user', content: 'synthetic' }] });
      assert.equal(response.status, 200); assert.equal((await response.json()).text, text);
      const body = captured.at(-1);
      assert.equal(body.max_output_tokens ?? body.max_tokens, max);
      if (!max) assert.equal(Object.hasOwn(body, 'max_output_tokens') || Object.hasOwn(body, 'max_tokens'), false);
      const compatible = await compatibleChatRequest(baseUrl, { model: provider,
        ...(max ? { max_completion_tokens: max } : {}), messages: [{ role: 'user', content: 'synthetic' }] });
      assert.equal(compatible.status, 200); await compatible.json();
      assert.equal(captured.at(-1).max_output_tokens ?? captured.at(-1).max_tokens, max);
    }
  }
});

test('catalog output maxima apply per model; unknown limits stay editable and unsupported limits stay absent', async () => {
  const provider = { ...config().providers.nvidia, id: 'openrouter', model: 'known', models: ['known', 'unknown', 'unsupported'],
    modelOptions: [{ id: 'known', label: 'Known', maxCompletionTokens: 131072, supportedParameters: ['max_tokens'] },
      { id: 'unknown', label: 'Unknown', supportedParameters: ['max_tokens'] },
      { id: 'unsupported', label: 'Unsupported', supportedParameters: [] }] };
  const bodies = [];
  const baseUrl = await start(async (_url, options) => {
    bodies.push(JSON.parse(options.body)); return Response.json({ choices: [{ message: { content: 'synthetic' } }] });
  }, { maxOutputTokens: 0, providers: { openrouter: provider }, defaultProvider: 'openrouter' });
  const models = (await (await fetch(baseUrl + '/api/providers')).json()).providers[0].models;
  assert.deepEqual(models.map(m => m.parameters), [
    { temperature: false, top_p: false, max_output_tokens: { min: 1, max: 131072 } },
    { temperature: false, top_p: false, max_output_tokens: { min: 1 } }, { temperature: false, top_p: false }]);
  for (const [model, max, status] of [['known', 131072, 200], ['known', 131073, 400], ['unknown', 262144, 200],
    ['unsupported', 1, 400], ['unknown', 0, 400], ['unknown', 1.5, 400], ['unknown', 9007199254740992, 400]]) {
    const response = await chatRequest(baseUrl, { model, parameters: { max_output_tokens: max }, messages: [{ role: 'user', content: 'synthetic' }] });
    assert.equal(response.status, status); await response.json();
  }
  assert.deepEqual(bodies.map(b => b.max_tokens), [131072, 262144]);
  const invalid = await compatibleChatRequest(baseUrl, { model: 'openrouter', max_tokens: 131073, messages: [{ role: 'user', content: 'synthetic' }] });
  assert.equal(invalid.status, 400); await invalid.json(); assert.equal(bodies.length, 2);
});

test('legacy positive site cap is clamped to a smaller model maximum for automatic requests', async () => {
  const provider = { ...config().providers.nvidia, modelOptions: [{ id: 'google/gemma-test', label: 'Synthetic', maxCompletionTokens: 512 }] };
  let body;
  const baseUrl = await start(async (_url, options) => {
    body = JSON.parse(options.body); return Response.json({ choices: [{ message: { content: 'synthetic' } }] });
  }, { providers: { nvidia: provider }, defaultProvider: 'nvidia' });
  const response = await chatRequest(baseUrl, { messages: [{ role: 'user', content: 'synthetic' }] });
  assert.equal(response.status, 200); await response.json(); assert.equal(body.max_tokens, 512);
});

test("health check is public and does not call an upstream API", async () => {
  let called = false;
  const baseUrl = await start(async () => {
    called = true;
    throw new Error("unexpected upstream request");
  });

  const response = await fetch(`${baseUrl}/healthz`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(response.headers.get("x-app-name"), "huawei-cloud-backend");
  assert.equal(called, false);
});

test("provider metadata contains no credentials", async () => {
  const baseUrl = await start(async () => {
    throw new Error("unexpected upstream request");
  });

  const response = await fetch(`${baseUrl}/api/providers`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.defaultProvider, "deepseek");
  assert.deepEqual(payload.features, {
    sharedConversations: false,
    parallelTasks: true,
    codeExecution: false,
    activityLogs: true,
  });
  assert.deepEqual(payload.providers, [
    {
      id: "nvidia", label: "NVIDIA / Google DiffusionGemma", model: "google/gemma-test",
      models: [
        ...["google/gemma-test", "google/gemma-alternative"].map(id => ({ id, label: id,
          parameters: { temperature: true, top_p: true, max_output_tokens: { min: 1, max: 1200 } } })),
      ],
      parameters: {
        temperature: true, top_p: true, max_output_tokens: { min: 1, max: 1200 },
      },
      capabilities: { webSearch: false },
    },
    {
      id: "deepseek", label: "DeepSeek", model: "deepseek-test",
      models: [
        ...["deepseek-test", "deepseek-v4-pro"].map(id => ({ id, label: id,
          parameters: { temperature: true, top_p: true, max_output_tokens: { min: 1, max: 1200 } } })),
      ],
      parameters: {
        temperature: true, top_p: true, max_output_tokens: { min: 1, max: 1200 },
      },
      capabilities: { webSearch: false },
    },
  ]);
  assert.equal(JSON.stringify(payload).includes("apiKey"), false);
  assert.equal(JSON.stringify(payload).includes("abcdefghijklmnopqrstuvwxyz"), false);
});

test("separate Sub2 project is never exposed by the chat gateway", async () => {
  let upstream = 0;
  const baseUrl = await start(async () => { upstream++; throw new Error("unexpected upstream request"); },
    {sub2PublicUrl: "https://isolated-service.example/admin/accounts"});
  const providers = await (await fetch(`${baseUrl}/api/providers`)).json();
  assert.equal(Object.hasOwn(providers.features, "sub2"), false);
  for (const route of ["/sub2", "/sub2/", "/sub2/admin/accounts"]) {
    for (const method of ["GET", "HEAD", "POST"]) {
      const response = await fetch(`${baseUrl}${route}`, {method, redirect: "manual"});
      assert.equal(response.status, 404);
      assert.equal(response.headers.get("location"), null);
    }
  }
  assert.equal(upstream, 0);
});

test("shared conversation API requires access and hides publisher edit keys", async () => {
  const sharedConversation = {
    id: "shared-conversation-001",
    title: "公开对话",
    author: "访客",
    provider: "deepseek",
    model: "deepseek-test",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [{ role: "user", content: "公开问题", createdAt: Date.now() }],
  };
  const stored = [];
  const sharedStore = {
    list: () => [...stored],
    upsert: (conversation, editKey) => {
      assert.equal(editKey, "publisher-edit-key-abcdefghijklmnopqrstuvwxyz");
      stored.splice(0, stored.length, conversation);
      return conversation;
    },
    remove: (id, editKey) => {
      assert.equal(id, sharedConversation.id);
      assert.equal(editKey, "publisher-edit-key-abcdefghijklmnopqrstuvwxyz");
      stored.splice(0);
    },
  };
  const baseUrl = await start(async () => {
    throw new Error("unexpected upstream request");
  }, {}, sharedStore);

  const unauthorized = await fetch(`${baseUrl}/api/shared-conversations`);
  assert.equal(unauthorized.status, 401);

  const created = await fetch(`${baseUrl}/api/shared-conversations`, {
    method: "POST",
    headers: { authorization: `Bearer ${gatewayToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      conversation: sharedConversation,
      editKey: "publisher-edit-key-abcdefghijklmnopqrstuvwxyz",
    }),
  });
  assert.equal(created.status, 200);
  const createdPayload = await created.json();
  assert.equal(JSON.stringify(createdPayload).includes("edit-key"), false);

  const listed = await fetch(`${baseUrl}/api/shared-conversations`, {
    headers: { authorization: `Bearer ${gatewayToken}` },
  });
  assert.equal(listed.status, 200);
  assert.equal((await listed.json()).conversations[0].title, "公开对话");

  const removed = await fetch(`${baseUrl}/api/shared-conversations/${sharedConversation.id}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${gatewayToken}`, "content-type": "application/json" },
    body: JSON.stringify({ editKey: "publisher-edit-key-abcdefghijklmnopqrstuvwxyz" }),
  });
  assert.equal(removed.status, 204);
});

test("the website homepage is served with a same-origin content policy", async () => {
  const baseUrl = await start(async () => {
    throw new Error("unexpected upstream request");
  });

  const response = await fetch(`${baseUrl}/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^text\/html/);
  assert.match(response.headers.get("content-security-policy"), /connect-src 'self'/);
  assert.match(await response.text(), /<!doctype html>/i);

  const icon = await fetch(`${baseUrl}/favicon.svg`);
  assert.equal(icon.status, 200);
  assert.equal(icon.headers.get("content-type"), "image/svg+xml");

  const markdown = await fetch(`${baseUrl}/markdown.js`);
  assert.equal(markdown.status, 200);
  assert.match(markdown.headers.get("content-type"), /^text\/javascript/);
});

test("chat requires the gateway bearer token", async () => {
  let called = false;
  const baseUrl = await start(async () => {
    called = true;
    throw new Error("unexpected upstream request");
  });

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
  });

  assert.equal(response.status, 401);
  assert.equal(called, false);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

test("loopback development mode can chat without a bearer token", async () => {
  let upstreamCalled = false;
  const baseUrl = await start(async () => {
    upstreamCalled = true;
    return new Response(JSON.stringify({
      output: [{ type: "message", content: [{ type: "output_text", text: "本地回复" }] }],
      usage: { input_tokens: 2, output_tokens: 2, total_tokens: 4 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }, { localDevNoAuth: true });

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "你好" }] }),
  });

  assert.equal(response.status, 200);
  assert.equal((await response.json()).text, "本地回复");
  assert.equal(upstreamCalled, true);
});

test("loopback development mode rejects a non-loopback Host header", async () => {
  let upstreamCalled = false;
  const baseUrl = await start(async () => {
    upstreamCalled = true;
    throw new Error("unexpected upstream request");
  }, { localDevNoAuth: true });

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: {
      host: "attacker.example",
      origin: "http://attacker.example",
      "content-type": "application/json",
    },
    body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
  });

  assert.equal(response.status, 403);
  assert.equal(upstreamCalled, false);
});

test("DeepSeek uses the Responses protocol and disables storage", async () => {
  let upstreamRequest;
  const baseUrl = await start(async (url, options) => {
    upstreamRequest = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      output: [{ type: "message", content: [{ type: "output_text", text: "深度求索回复" }] }],
      usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  });

  const response = await chatRequest(baseUrl, {
    provider: "deepseek",
    messages: [{ role: "user", content: "你好" }],
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.text, "深度求索回复");
  assert.equal(payload.provider, "deepseek");
  assert.equal(upstreamRequest.url, "http://deepseek.test/responses");
  assert.equal(upstreamRequest.body.model, "deepseek-test");
  assert.equal(upstreamRequest.body.store, false);
  assert.deepEqual(upstreamRequest.body.input, [{ role: "user", content: "你好" }]);
});

test("NVIDIA uses Chat Completions and injects the server system prompt", async () => {
  let upstreamRequest;
  const baseUrl = await start(async (url, options) => {
    upstreamRequest = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "NVIDIA 回复" } }],
      usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  });

  const response = await chatRequest(baseUrl, {
    provider: "nvidia",
    messages: [{ role: "user", content: "你好" }],
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.text, "NVIDIA 回复");
  assert.equal(payload.provider, "nvidia");
  assert.equal(upstreamRequest.url, "http://nvidia.test/v1/chat/completions");
  assert.equal(upstreamRequest.body.model, "google/gemma-test");
  assert.equal(upstreamRequest.body.stream, false);
  assert.deepEqual(upstreamRequest.body.messages, [
    { role: "system", content: "Test system prompt" },
    { role: "user", content: "你好" },
  ]);
});

test("website selects allowlisted models and forwards generation parameters for both protocols", async () => {
  const upstreamRequests = [];
  const baseUrl = await start(async (url, options) => {
    upstreamRequests.push({ url, body: JSON.parse(options.body) });
    const payload = url.includes("responses")
      ? {
        output: [{ type: "message", content: [{ type: "output_text", text: "DeepSeek reply" }] }],
        usage: { input_tokens: 2, output_tokens: 2, total_tokens: 4 },
      }
      : {
        choices: [{ message: { role: "assistant", content: "NVIDIA reply" } }],
        usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
      };
    return new Response(JSON.stringify(payload), { status: 200 });
  });
  for (const [provider, model] of [
    ["deepseek", "deepseek-v4-pro"],
    ["nvidia", "google/gemma-alternative"],
  ]) {
    const response = await chatRequest(baseUrl, {
      provider, model,
      parameters: { temperature: 0, top_p: 0.75, max_output_tokens: 350 },
      messages: [{ role: "user", content: "hello" }],
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).model, model);
  }
  assert.deepEqual(upstreamRequests.map(({ body }) => ({
    model: body.model,
    temperature: body.temperature,
    top_p: body.top_p,
    max: body.max_output_tokens ?? body.max_tokens,
  })), [
    { model: "deepseek-v4-pro", temperature: 0, top_p: 0.75, max: 350 },
    { model: "google/gemma-alternative", temperature: 0, top_p: 0.75, max: 350 },
  ]);
});

test("website rejects unlisted models and malformed parameters before contacting a provider", async () => {
  let calls = 0;
  const baseUrl = await start(async () => { calls += 1; throw new Error("unexpected upstream request"); });
  const messages = [{ role: "user", content: "hello" }];
  const invalidBodies = [
    { provider: "__proto__" },
    { provider: "deepseek", model: "__proto__" },
    { provider: "deepseek", model: "deepseek-v4-pro-unknown" },
    { provider: "nvidia", model: "deepseek-v4-pro" },
    { provider: "deepseek", parameters: null },
    { provider: "deepseek", parameters: [] },
    { provider: "deepseek", parameters: { temperature: "0.5" } },
    { provider: "deepseek", parameters: { temperature: -0.1 } },
    { provider: "deepseek", parameters: { temperature: 2.1 } },
    { provider: "deepseek", parameters: { top_p: 0 } },
    { provider: "deepseek", parameters: { top_p: 1.1 } },
    { provider: "deepseek", parameters: { max_output_tokens: 0 } },
    { provider: "deepseek", parameters: { max_output_tokens: 1201 } },
    { provider: "deepseek", parameters: { max_output_tokens: 1.5 } },
    { provider: "deepseek", parameters: { api_url: "https://attacker.example" } },
    { provider: "deepseek", webSearch: "yes" },
    { provider: "deepseek", webSearch: true },
  ];
  for (const body of invalidBodies) {
    const response = await chatRequest(baseUrl, { ...body, messages });
    assert.equal(response.status, 400, JSON.stringify(body));
  }
  assert.equal(calls, 0);
});

test("OpenAI provider exposes only output length and rejects unsupported sampling", async () => {
  let upstreamCalls = 0;
  const openai = {
    id: "openai",
    label: "OpenAI",
    apiUrl: "http://openai.test/responses",
    apiKey: "sk-openai-test-abcdefghijklmnopqrstuvwxyz",
    model: "gpt-5.6-terra",
    models: ["gpt-5.6-terra", "gpt-5.6-luna"],
    protocol: "responses",
  };
  const baseUrl = await start(async (_url, options) => {
    upstreamCalls += 1;
    const body = JSON.parse(options.body);
    assert.equal(body.model, "gpt-5.6-luna");
    assert.equal(body.max_output_tokens, 40);
    assert.equal(Object.hasOwn(body, "temperature"), false);
    assert.equal(Object.hasOwn(body, "top_p"), false);
    return new Response(JSON.stringify({
      output: [{ type: "message", content: [{ type: "output_text", text: "okay" }] }],
      usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
    }), { status: 200 });
  }, { providers: { openai }, defaultProvider: "openai" });
  const providers = await (await fetch(`${baseUrl}/api/providers`)).json();
  assert.deepEqual(providers.providers[0].parameters, {
    temperature: false, top_p: false, max_output_tokens: { min: 1, max: 1200 },
  });
  const invalid = await chatRequest(baseUrl, {
    model: "gpt-5.6-luna",
    parameters: { temperature: 0.5 },
    messages: [{ role: "user", content: "hello" }],
  });
  assert.equal(invalid.status, 400);
  assert.equal(upstreamCalls, 0);
  const valid = await chatRequest(baseUrl, {
    model: "gpt-5.6-luna",
    parameters: { max_output_tokens: 40 },
    messages: [{ role: "user", content: "hello" }],
  });
  assert.equal(valid.status, 200);
  assert.equal((await valid.json()).model, "gpt-5.6-luna");
  assert.equal(upstreamCalls, 1);
});

test("website web search exposes capability, requires the tool and returns sources", async () => {
  let upstreamBody;
  const openai = {
    id: "openai",
    label: "OpenAI",
    apiUrl: "http://openai.test/responses",
    apiKey: "sk-openai-test-abcdefghijklmnopqrstuvwxyz",
    model: "gpt-5.6-terra",
    models: ["gpt-5.6-terra"],
    protocol: "responses",
    webSearchProtocol: "openai-web-search",
  };
  const baseUrl = await start(async (_url, options) => {
    upstreamBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      status: "completed",
      output: [
        {
          type: "web_search_call",
          action: {
            type: "search",
            query: "current answer",
            sources: [{ title: "Official source", url: "https://example.com/current" }],
          },
        },
        { type: "message", content: [{ type: "output_text", text: "Current answer" }] },
      ],
      usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
    }), { status: 200 });
  }, { providers: { openai }, defaultProvider: "openai" });

  const metadata = await (await fetch(`${baseUrl}/api/providers`)).json();
  assert.deepEqual(metadata.providers[0].capabilities, { webSearch: true });
  const response = await chatRequest(baseUrl, {
    provider: "openai",
    webSearch: true,
    messages: [{ role: "user", content: "What is current?" }],
  });
  assert.equal(response.status, 200);
  assert.deepEqual(upstreamBody.tools, [{ type: "web_search" }]);
  const payload = await response.json();
  assert.deepEqual(payload.search, {
    enabled: true,
    used: true,
    queries: ["current answer"],
    sources: [{ title: "Official source", url: "https://example.com/current" }],
  });
});

test("website returns Gemini grounding sources and required search suggestions", async () => {
  let upstreamRequest;
  const gemini = {
    id: "gemini",
    label: "Google Gemini API",
    apiUrl: "http://gemini.test/v1/chat/completions",
    webSearchApiBaseUrl: "http://gemini-search.test/v1beta/models/",
    apiKey: "gemini-test-key-abcdefghijklmnopqrstuvwxyz",
    model: "gemini-2.5-flash",
    models: ["gemini-2.5-flash"],
    protocol: "chat-completions",
    webSearchProtocol: "google-search",
  };
  const baseUrl = await start(async (url, options) => {
    upstreamRequest = { url, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      candidates: [{
        content: { parts: [{ text: "Gemini grounded answer" }] },
        finishReason: "STOP",
        groundingMetadata: {
          webSearchQueries: ["grounded query"],
          groundingChunks: [{ web: { title: "Grounded source", uri: "https://example.com/grounded" } }],
          searchEntryPoint: { renderedContent: "<div>Google Search</div>" },
        },
      }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3, totalTokenCount: 8 },
    }), { status: 200 });
  }, { providers: { gemini }, defaultProvider: "gemini" });

  const response = await chatRequest(baseUrl, {
    provider: "gemini",
    webSearch: true,
    messages: [{ role: "user", content: "latest" }],
  }, {
    origin: baseUrl,
    "sec-fetch-site": "same-origin",
    "x-yunjian-ui": "browser",
  });
  assert.equal(response.status, 200);
  assert.match(upstreamRequest.url, /gemini-2\.5-flash:generateContent$/);
  assert.deepEqual(upstreamRequest.body.tools, [{ google_search: {} }]);
  const payload = await response.json();
  assert.equal(payload.text, "Gemini grounded answer");
  assert.deepEqual(payload.search, {
    enabled: true,
    used: true,
    queries: ["grounded query"],
    sources: [{ title: "Grounded source", url: "https://example.com/grounded" }],
    suggestionsHtml: "<div>Google Search</div>",
  });
});

test("Gemini website search rejects non-site API collection before upstream use", async () => {
  let upstreamCalls = 0;
  const gemini = {
    id: "gemini",
    label: "Google Gemini API",
    apiUrl: "http://gemini.test/v1/chat/completions",
    webSearchApiBaseUrl: "http://gemini-search.test/v1beta/models/",
    apiKey: "gemini-test-key-abcdefghijklmnopqrstuvwxyz",
    model: "gemini-2.5-flash",
    models: ["gemini-2.5-flash"],
    protocol: "chat-completions",
    webSearchProtocol: "google-search",
  };
  const baseUrl = await start(async () => {
    upstreamCalls += 1;
    throw new Error("unexpected upstream request");
  }, { providers: { gemini }, defaultProvider: "gemini" });

  const response = await chatRequest(baseUrl, {
    provider: "gemini",
    webSearch: true,
    messages: [{ role: "user", content: "latest" }],
  });
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /本站页面/);
  assert.equal(upstreamCalls, 0);
});

test("website instructions are trimmed and appended for both upstream protocols", async () => {
  const upstreamRequests = [];
  const baseUrl = await start(async (url, options) => {
    upstreamRequests.push({ url, body: JSON.parse(options.body) });
    const payload = url.includes("responses")
      ? {
        output: [{ type: "message", content: [{ type: "output_text", text: "Responses reply" }] }],
        usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
      }
      : {
        choices: [{ message: { role: "assistant", content: "Chat reply" } }],
        usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
      };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  for (const provider of ["deepseek", "nvidia"]) {
    const response = await chatRequest(baseUrl, {
      provider,
      instructions: "  请用中文回答。  ",
      messages: [{ role: "user", content: "你好" }],
    });
    assert.equal(response.status, 200);
  }
  assert.equal(upstreamRequests[0].body.instructions, "Test system prompt\n\n请用中文回答。");
  assert.equal(upstreamRequests[1].body.messages[0].content, "Test system prompt\n\n请用中文回答。");

  const unchanged = await chatRequest(baseUrl, {
    provider: "deepseek",
    messages: [{ role: "user", content: "再见" }],
  });
  assert.equal(unchanged.status, 200);
  assert.equal(upstreamRequests[2].body.instructions, "Test system prompt");
});

test("website instructions reject invalid types, oversize text and combined input overflow before upstream use", async () => {
  let upstreamCalls = 0;
  const baseUrl = await start(async () => {
    upstreamCalls += 1;
    throw new Error("unexpected upstream request");
  }, { maxInputChars: 2005 });
  const messages = [{ role: "user", content: "hello!" }];
  for (const instructions of [null, 42, ["text"], "x".repeat(2001), "x".repeat(2000)]) {
    const response = await chatRequest(baseUrl, { instructions, messages });
    assert.equal(response.status, 400);
  }
  assert.equal(upstreamCalls, 0);
});

test("minute rate limiting stops excess calls before upstream use", async () => {
  let upstreamCalls = 0;
  const baseUrl = await start(async () => {
    upstreamCalls += 1;
    return new Response(JSON.stringify({
      output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }, { rateLimitPerMinute: 1 });

  const first = await chatRequest(baseUrl, {
    messages: [{ role: "user", content: "first" }],
  });
  const second = await chatRequest(baseUrl, {
    messages: [{ role: "user", content: "second" }],
  });

  assert.equal(first.status, 200);
  assert.equal(second.status, 429);
  assert.equal(second.headers.get("ratelimit-remaining"), "0");
  assert.equal(upstreamCalls, 1);
});

test("daily request limiting stops excess calls before upstream use", async () => {
  let upstreamCalls = 0;
  const baseUrl = await start(async () => {
    upstreamCalls += 1;
    return new Response(JSON.stringify({
      output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }, { dailyRequestLimit: 1 });

  const first = await chatRequest(baseUrl, {
    messages: [{ role: "user", content: "first" }],
  });
  const second = await chatRequest(baseUrl, {
    messages: [{ role: "user", content: "second" }],
  });

  assert.equal(first.status, 200);
  assert.equal(second.status, 429);
  assert.equal(second.headers.get("x-daily-request-remaining"), "0");
  assert.equal(upstreamCalls, 1);
});

test("daily token limiting is enforced after recorded upstream usage", async () => {
  let upstreamCalls = 0;
  const baseUrl = await start(async () => {
    upstreamCalls += 1;
    return new Response(JSON.stringify({
      output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }],
      usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }, { dailyTokenLimit: 5 });

  const first = await chatRequest(baseUrl, {
    messages: [{ role: "user", content: "first" }],
  });
  const second = await chatRequest(baseUrl, {
    messages: [{ role: "user", content: "second" }],
  });

  assert.equal(first.status, 200);
  assert.equal(first.headers.get("x-daily-token-remaining"), "0");
  assert.equal(second.status, 429);
  assert.equal(upstreamCalls, 1);
});

test("concurrency limiting releases its slot after the first request", async () => {
  let releaseUpstream;
  let markStarted;
  let upstreamCalls = 0;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  const baseUrl = await start(async () => {
    upstreamCalls += 1;
    if (upstreamCalls === 1) {
      markStarted();
      await new Promise((resolve) => {
        releaseUpstream = resolve;
      });
    }
    return new Response(JSON.stringify({
      output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }, { maxConcurrentRequests: 1 });

  const firstPromise = chatRequest(baseUrl, {
    messages: [{ role: "user", content: "first" }],
  });
  await started;
  const blocked = await chatRequest(baseUrl, {
    messages: [{ role: "user", content: "second" }],
  });
  assert.equal(blocked.status, 503);

  releaseUpstream();
  const first = await firstPromise;
  assert.equal(first.status, 200);

  const next = await chatRequest(baseUrl, {
    messages: [{ role: "user", content: "third" }],
  });
  assert.equal(next.status, 200);
  assert.equal(upstreamCalls, 2);
});

test("an upstream timeout returns 504 and releases the concurrency slot", async () => {
  let upstreamCalls = 0;
  const baseUrl = await start(async (_url, options) => {
    upstreamCalls += 1;
    if (upstreamCalls === 1) {
      await new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        }, { once: true });
      });
    }
    return new Response(JSON.stringify({
      output: [{ type: "message", content: [{ type: "output_text", text: "recovered" }] }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }, { requestTimeoutMs: 20, maxConcurrentRequests: 1 });

  const timedOut = await chatRequest(baseUrl, {
    messages: [{ role: "user", content: "first" }],
  });
  assert.equal(timedOut.status, 504);

  const recovered = await chatRequest(baseUrl, {
    messages: [{ role: "user", content: "second" }],
  });
  assert.equal(recovered.status, 200);
  assert.equal((await recovered.json()).text, "recovered");
});

test("a provider outside the server allowlist is rejected", async () => {
  let called = false;
  const baseUrl = await start(async () => {
    called = true;
    throw new Error("unexpected upstream request");
  });

  const response = await chatRequest(baseUrl, {
    provider: "unconfigured",
    messages: [{ role: "user", content: "你好" }],
  });
  assert.equal(response.status, 400);
  assert.equal(called, false);
});

test("cross-origin requests are rejected unless explicitly allowed", async () => {
  const baseUrl = await start(async () => {
    throw new Error("unexpected upstream request");
  });
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "OPTIONS",
    headers: {
      origin: "https://attacker.example",
      "access-control-request-method": "POST",
    },
  });
  assert.equal(response.status, 403);
});

test("same-host origins still have to match the forwarded protocol", async () => {
  const baseUrl = await start(async () => {
    throw new Error("unexpected upstream request");
  }, { trustProxy: true });

  const rejected = await fetch(`${baseUrl}/api/chat`, {
    method: "OPTIONS",
    headers: {
      origin: "http://chat.example",
      "x-forwarded-host": "chat.example",
      "x-forwarded-proto": "https",
    },
  });
  assert.equal(rejected.status, 403);

  const accepted = await fetch(`${baseUrl}/api/chat`, {
    method: "OPTIONS",
    headers: {
      origin: "https://chat.example",
      "x-forwarded-host": "chat.example",
      "x-forwarded-proto": "https",
    },
  });
  assert.equal(accepted.status, 204);
  assert.equal(accepted.headers.get("access-control-allow-origin"), "https://chat.example");
});

test("oversized request bodies are rejected before upstream use", async () => {
  let called = false;
  const baseUrl = await start(async () => {
    called = true;
    throw new Error("unexpected upstream request");
  }, { maxBodyBytes: 1024 });

  const response = await chatRequest(baseUrl, {
    messages: [{ role: "user", content: "a".repeat(2000) }],
  });
  assert.equal(response.status, 413);
  assert.equal(called, false);
});

test("compatible models and chat require the bearer key even in no-auth local development", async () => {
  let called = false;
  const baseUrl = await start(async () => {
    called = true;
    throw new Error("unexpected upstream request");
  }, { localDevNoAuth: true });

  const models = await fetch(`${baseUrl}/v1/models`);
  assert.equal(models.status, 401);
  assert.equal((await models.json()).error.type, "authentication_error");
  const chat = await compatibleChatRequest(baseUrl, {
    model: "deepseek",
    messages: [{ role: "user", content: "hello" }],
  }, { authorization: "Bearer wrong-key" });
  assert.equal(chat.status, 401);
  assert.equal((await chat.json()).error.code, "invalid_api_key");
  assert.equal(called, false);
});

test("compatible models expose only configured public IDs", async () => {
  const baseUrl = await start(async () => {
    throw new Error("unexpected upstream request");
  });
  const response = await fetch(`${baseUrl}/v1/models`, {
    headers: { authorization: `Bearer ${gatewayToken}` },
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.object, "list");
  assert.deepEqual(payload.data.map((item) => item.id), ["nvidia", "deepseek"]);
  assert.equal(JSON.stringify(payload).includes("apiKey"), false);
  assert.equal(JSON.stringify(payload).includes("http://"), false);
});

test("compatible chat maps public model IDs and returns OpenAI-shaped text and usage", async () => {
  let upstreamRequest;
  const baseUrl = await start(async (url, options) => {
    upstreamRequest = { url, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      output: [{ type: "message", content: [{ type: "output_text", text: "Gateway reply" }] }],
      usage: { input_tokens: 7, output_tokens: 3, total_tokens: 10 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const response = await compatibleChatRequest(baseUrl, {
    model: "deepseek",
    messages: [
      { role: "system", content: "Respond briefly" },
      { role: "user", content: "hello" },
    ],
    max_tokens: 40,
    stream: false,
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.match(payload.id, /^chatcmpl-/);
  assert.equal(payload.object, "chat.completion");
  assert.equal(payload.model, "deepseek");
  assert.deepEqual(payload.choices, [{
    index: 0,
    message: { role: "assistant", content: "Gateway reply" },
    finish_reason: "stop",
  }]);
  assert.deepEqual(payload.usage, {
    prompt_tokens: 7,
    completion_tokens: 3,
    total_tokens: 10,
  });
  assert.equal(upstreamRequest.url, "http://deepseek.test/responses");
  assert.equal(upstreamRequest.body.model, "deepseek-test");
  assert.equal(upstreamRequest.body.max_output_tokens, 40);
  assert.equal(upstreamRequest.body.instructions, "Test system prompt\n\nRespond briefly");
});

test("compatible chat preserves an upstream truncation reason", async () => {
  const baseUrl = await start(async () => new Response(JSON.stringify({
    choices: [{ message: { role: "assistant", content: "Partial answer" }, finish_reason: "length" }],
    usage: { prompt_tokens: 5, completion_tokens: 12, total_tokens: 17 },
  }), { status: 200, headers: { "content-type": "application/json" } }));
  const response = await compatibleChatRequest(baseUrl, {
    model: "nvidia",
    messages: [{ role: "user", content: "hello" }],
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).choices[0].finish_reason, "length");
});

test("compatible chat rejects unknown models, streaming and non-text messages before upstream use", async () => {
  let calls = 0;
  const baseUrl = await start(async () => {
    calls += 1;
    throw new Error("unexpected upstream request");
  });
  const validMessages = [{ role: "user", content: "hello" }];
  for (const body of [
    { model: "__proto__", messages: validMessages },
    { model: "unconfigured", messages: validMessages },
    { model: "deepseek", messages: validMessages, stream: true },
    { model: "deepseek", messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }] },
    { model: "deepseek", messages: validMessages, api_url: "https://attacker.example" },
  ]) {
    const response = await compatibleChatRequest(baseUrl, body);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.type, "invalid_request_error");
  }
  assert.equal(calls, 0);
});

test("compatible chat shares daily request limits with the website", async () => {
  let upstreamCalls = 0;
  const baseUrl = await start(async () => {
    upstreamCalls += 1;
    return new Response(JSON.stringify({
      output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }, { dailyRequestLimit: 1 });
  const first = await chatRequest(baseUrl, { messages: [{ role: "user", content: "first" }] });
  assert.equal(first.status, 200);
  const second = await compatibleChatRequest(baseUrl, {
    model: "deepseek",
    messages: [{ role: "user", content: "second" }],
  });
  assert.equal(second.status, 429);
  assert.equal((await second.json()).error.type, "rate_limit_error");
  assert.equal(upstreamCalls, 1);
});

test("compatible chat shares minute and token limits with the website", async () => {
  let upstreamCalls = 0;
  const upstream = async () => {
    upstreamCalls += 1;
    return new Response(JSON.stringify({
      output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }],
      usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const rateBaseUrl = await start(upstream, { rateLimitPerMinute: 1 });
  const first = await chatRequest(rateBaseUrl, {
    messages: [{ role: "user", content: "first" }],
  });
  assert.equal(first.status, 200);
  const rateLimited = await compatibleChatRequest(rateBaseUrl, {
    model: "deepseek",
    messages: [{ role: "user", content: "second" }],
  });
  assert.equal(rateLimited.status, 429);
  assert.equal(rateLimited.headers.get("ratelimit-remaining"), "0");

  const tokenBaseUrl = await start(upstream, { dailyTokenLimit: 5 });
  const usedTokens = await chatRequest(tokenBaseUrl, {
    messages: [{ role: "user", content: "first" }],
  });
  assert.equal(usedTokens.status, 200);
  const tokenLimited = await compatibleChatRequest(tokenBaseUrl, {
    model: "deepseek",
    messages: [{ role: "user", content: "second" }],
  });
  assert.equal(tokenLimited.status, 429);
  assert.equal(tokenLimited.headers.get("x-daily-token-remaining"), "0");
  assert.equal(upstreamCalls, 2);
});

test("compatible chat rejects oversized bodies before upstream use", async () => {
  let called = false;
  const baseUrl = await start(async () => {
    called = true;
    throw new Error("unexpected upstream request");
  }, { maxBodyBytes: 1024 });
  const response = await compatibleChatRequest(baseUrl, {
    model: "deepseek",
    messages: [{ role: "user", content: "x".repeat(2000) }],
  });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.type, "invalid_request_error");
  assert.equal(called, false);
});
