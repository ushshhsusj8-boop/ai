import test from "node:test";
import assert from "node:assert/strict";

import { createBackup, planImport, applyImport } from "../public/backups.js";

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

function conversation(id, content = "你好") {
  return {
    id, title: "对话", titleEdited: false, pinned: true, provider: "deepseek",
    model: "deepseek-flash", parameters: { temperature: 0.7, max_output_tokens: 800 },
    instructions: "请简洁回答", updatedAt: 123,
    lastUsage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
    messages: [{ role: "user", content, createdAt: 100 }],
  };
}

function prompt(id, title = "常用提问") {
  return { id, title, content: "请把这段内容整理成要点。", createdAt: 100, updatedAt: 123 };
}

test('backup roundtrip preserves user output budgets above the removed 32000 ceiling', () => {
  const item = conversation('large-output'); item.parameters.max_output_tokens = 393216;
  const source = storage({ 'yunjian-ai-conversations-v1': JSON.stringify([item]) }), destination = storage();
  applyImport(planImport(createBackup(source), destination), destination);
  assert.equal(JSON.parse(destination.getItem('yunjian-ai-conversations-v1'))[0].parameters.max_output_tokens, 393216);
});

test('chat memory opt out survives JSON backup without including the private memory library', () => {
  const item=conversation('memory-opt-out');item.context={historyTurns:2,resetAt:null,useMemory:false};
  const source=storage({'yunjian-ai-conversations-v1':JSON.stringify([item]),'private-memory-fixture':'private memory text'}),destination=storage(),backup=createBackup(source);
  applyImport(planImport(backup,destination),destination);
  assert.equal(JSON.parse(destination.getItem('yunjian-ai-conversations-v1'))[0].context.useMemory,false);
  assert.equal(backup.includes('private memory text'),false);
});

test("backup restores partial reply text and completion markers", () => {
  const item = conversation("partial-replies");
  for (const completion of ["stopped", "interrupted", "length"]) {
    item.messages.push({ role: "assistant", content: `部分回复 ${completion}`, completion });
  }
  const source = storage({ "yunjian-ai-conversations-v1": JSON.stringify([item]) });
  const destination = storage();
  applyImport(planImport(createBackup(source), destination), destination);
  const restored = JSON.parse(destination.getItem("yunjian-ai-conversations-v1"))[0];
  assert.deepEqual(restored.messages.map(m => [m.content, m.completion]), item.messages.map(m => [m.content, m.completion]));
});

test("backup roundtrip preserves context boundaries and merges model favorites", () => {
  const item = conversation("context-one");
  item.context = { historyTurns: 2, resetAt: 100 };
  const source = storage({
    "yunjian-ai-conversations-v1": JSON.stringify([item]),
    "yunjian-ai-model-favorites-v1": JSON.stringify([{ provider: "deepseek", model: "deepseek-flash" }]),
  });
  const destination = storage({
    "yunjian-ai-model-favorites-v1": JSON.stringify([{ provider: "gemini", model: "gemini-3.8-flash" }]),
  });
  const plan = planImport(createBackup(source), destination);
  applyImport(plan, destination);
  assert.deepEqual(JSON.parse(destination.getItem("yunjian-ai-conversations-v1"))[0].context, item.context);
  assert.equal(JSON.parse(destination.getItem("yunjian-ai-model-favorites-v1")).length, 2);
  const legacy = JSON.parse(createBackup(source));
  delete legacy.favorites;
  delete legacy.conversations[0].context;
  assert.doesNotThrow(() => planImport(JSON.stringify(legacy), storage()));
  legacy.conversations[0].context = { historyTurns: -1 };
  assert.throws(() => planImport(JSON.stringify(legacy), storage()), /历史轮数/);
});

test("backup contains conversations, presets and prompt library but never access tokens", () => {
  const grounded = conversation("one");
  grounded.provider = "openai";
  grounded.webSearch = true;
  grounded.archived = true;
  grounded.messages.push({
    role: "assistant",
    content: "这是联网回答。",
    createdAt: 110,
    search: {
      enabled: true,
      used: true,
      queries: ["测试搜索"],
      sources: [{ title: "资料", url: "https://example.com/source" }],
    },
  });
  const data = storage({
    "yunjian-ai-conversations-v1": JSON.stringify([grounded]),
    "yunjian-ai-presets-v1": JSON.stringify([{ id: "custom-one", name: "简洁", instructions: "少说几句" }]),
    "yunjian-ai-prompt-library-v1": JSON.stringify([prompt("prompt-one")]),
    "yunjian-ai-gateway-token": "private-test-token",
  });
  const json = createBackup(data, new Date("2026-09-21T00:00:00Z"));
  const backup = JSON.parse(json);
  assert.equal(backup.format, "yunjian-ai-local-backup");
  assert.equal(backup.version, 1);
  assert.equal(backup.conversations[0].instructions, "请简洁回答");
  assert.equal(backup.conversations[0].pinned, true);
  assert.equal(backup.conversations[0].archived, true);
  assert.equal(backup.conversations[0].model, "deepseek-flash");
  assert.equal(backup.conversations[0].parameters.temperature, 0.7);
  assert.equal(backup.conversations[0].messages[0].createdAt, 100);
  assert.equal(backup.conversations[0].webSearch, true);
  assert.equal(backup.conversations[0].messages[1].search.sources[0].url, "https://example.com/source");
  assert.equal(backup.presets[0].name, "简洁");
  assert.equal(backup.prompts[0].title, "常用提问");
  assert.equal(json.includes("private-test-token"), false);
  assert.equal(json.includes("gateway-token"), false);
});

test("backup preserves long OpenRouter model IDs up to the shared limit", () => {
  const longModel = `vendor/${"model-".repeat(25)}latest`;
  assert.ok(longModel.length > 128 && longModel.length <= 192);
  const item = conversation("long-model");
  item.provider = "openrouter";
  item.model = longModel;
  const json = createBackup(storage({
    "yunjian-ai-conversations-v1": JSON.stringify([item]),
  }));
  assert.equal(JSON.parse(json).conversations[0].model, longModel);
});

test("import merges new records without overwriting duplicate IDs", () => {
  const existing = storage({
    "yunjian-ai-conversations-v1": JSON.stringify([conversation("one", "保留本地内容")]),
    "yunjian-ai-presets-v1": JSON.stringify([{ id: "custom-one", name: "本地预设", instructions: "本地说明" }]),
    "yunjian-ai-prompt-library-v1": JSON.stringify([prompt("prompt-one", "本地提示")]),
  });
  const incoming = JSON.parse(createBackup(storage({
    "yunjian-ai-conversations-v1": JSON.stringify([conversation("one", "外部内容"), conversation("two")]),
    "yunjian-ai-presets-v1": JSON.stringify([
      { id: "custom-one", name: "外部预设", instructions: "外部说明" },
      { id: "custom-two", name: "新预设", instructions: "新的说明" },
    ]),
    "yunjian-ai-prompt-library-v1": JSON.stringify([
      prompt("prompt-one", "外部提示"), prompt("prompt-two", "新增提示"),
    ]),
  })));
  const plan = planImport(JSON.stringify(incoming), existing);
  assert.deepEqual([
    plan.addedConversations, plan.skippedConversations, plan.addedPresets, plan.skippedPresets,
    plan.addedPrompts, plan.skippedPrompts,
  ], [1, 1, 1, 1, 1, 1]);
  applyImport(plan, existing);
  const merged = JSON.parse(existing.getItem("yunjian-ai-conversations-v1"));
  assert.equal(merged.length, 2);
  assert.equal(merged.find((item) => item.id === "one").messages[0].content, "保留本地内容");
  assert.equal(merged.find((item) => item.id === "two").pinned, true);
  assert.equal(merged.find((item) => item.id === "two").parameters.max_output_tokens, 800);
  assert.equal(JSON.parse(existing.getItem("yunjian-ai-presets-v1")).length, 2);
  const mergedPrompts = JSON.parse(existing.getItem("yunjian-ai-prompt-library-v1"));
  assert.equal(mergedPrompts.length, 2);
  assert.equal(mergedPrompts.find((item) => item.id === "prompt-one").title, "本地提示");
});

test("import rejects malformed content and keeps more than 30 conversations without changing storage", () => {
  const existingConversations = Array.from({ length: 30 }, (_, index) => conversation(`local-${index}`));
  const existing = storage({ "yunjian-ai-conversations-v1": JSON.stringify(existingConversations) });
  const before = existing.getItem("yunjian-ai-conversations-v1");
  const backup = JSON.parse(createBackup(storage({
    "yunjian-ai-conversations-v1": JSON.stringify([conversation("new")]),
  })));
  assert.throws(() => planImport("not json", existing), /JSON/);
  assert.throws(() => planImport(JSON.stringify({ ...backup, unexpected: true }), existing), /不支持的字段/);
  assert.throws(() => planImport(JSON.stringify({ ...backup, conversations: [{ ...conversation("new"), messages: [{ role: "system", content: "bad" }] }] }), existing), /消息角色/);
  assert.throws(() => planImport(JSON.stringify({ ...backup, conversations: [{ ...conversation("new"), pinned: "yes" }] }), existing), /置顶状态/);
  assert.throws(() => planImport(JSON.stringify({ ...backup, conversations: [{ ...conversation("new"), archived: "yes" }] }), existing), /归档状态/);
  assert.throws(() => planImport(JSON.stringify({ ...backup, conversations: [{ ...conversation("new"), parameters: { temperature: "hot" } }] }), existing), /随机度/);
  assert.throws(() => planImport(JSON.stringify({ ...backup, conversations: [{ ...conversation("new"), messages: [{ role: "user", content: "bad time", createdAt: -1 }] }] }), existing), /消息时间/);
  assert.throws(() => planImport(JSON.stringify({ ...backup, conversations: [{ ...conversation("new"), webSearch: "yes" }] }), existing), /联网搜索状态/);
  assert.throws(() => planImport(JSON.stringify({ ...backup, conversations: [{ ...conversation("new"), messages: [{ role: "user", content: "bad source", search: { enabled: true, used: true, queries: [], sources: [] } }] }] }), existing), /用户消息不能包含联网来源/);
  assert.throws(() => planImport(JSON.stringify({ ...backup, conversations: [{ ...conversation("new"), messages: [{ role: "assistant", content: "bad source", search: { enabled: true, used: true, queries: [], sources: [{ title: "bad", url: "javascript:alert(1)" }] } }] }] }), existing), /来源地址无效/);
  assert.throws(() => planImport(JSON.stringify({ ...backup, conversations: [{ ...conversation("new"), provider: "gemini", messages: [{ role: "assistant", content: "grounded", search: { enabled: true, used: true, queries: [], sources: [] } }] }] }), existing), /不能保存 Gemini/);
  assert.throws(() => planImport(JSON.stringify({ ...backup, conversations: [{ ...conversation("new"), messages: [{ role: "assistant", content: "suggestions", search: { enabled: true, used: true, queries: [], sources: [], suggestionsHtml: "<div>bad</div>" } }] }] }), existing), /不支持的字段/);
  assert.throws(() => planImport(JSON.stringify({ ...backup, prompts: [{ ...prompt("prompt-new"), content: "" }] }), existing), /不能为空/);
  assert.equal(planImport(JSON.stringify(backup), existing).conversations.length, 31);
  assert.equal(existing.getItem("yunjian-ai-conversations-v1"), before);
});

test("failed storage write rolls back earlier imported data", () => {
  const values = new Map([
    ["yunjian-ai-conversations-v1", JSON.stringify([conversation("old")])],
    ["yunjian-ai-presets-v1", "[]"],
  ]);
  const failingStorage = {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => {
      if (key === "yunjian-ai-presets-v1") throw new Error("storage full");
      values.set(key, value);
    },
    removeItem: (key) => values.delete(key),
  };
  const before = values.get("yunjian-ai-conversations-v1");
  assert.throws(() => applyImport({ conversations: [conversation("new")], presets: [] }, failingStorage), /无法保存/);
  assert.equal(values.get("yunjian-ai-conversations-v1"), before);
});
