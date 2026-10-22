import test from "node:test";
import assert from "node:assert/strict";
import { buildChatContext, findConversationMessages, speechChunks, filterModelOptions, validateModelFavorites } from "../public/conversation_tools.js";

const message = (role, content, createdAt) => ({ role, content, createdAt });
const history = [
  message("user", "以前的私人问题", 10), message("assistant", "以前的回答", 20),
  message("user", "新话题", 30), message("assistant", "新回答", 40),
  message("user", "当前问题", 50),
];

test("context reset excludes earlier content without modifying saved messages", () => {
  const original = structuredClone(history);
  const result = buildChatContext(history, { resetAt: 25 });
  assert.deepEqual(result.messages.map(x => x.content), ["新话题", "新回答", "当前问题"]);
  assert.deepEqual(history, original);
  assert.deepEqual(buildChatContext(history, { resetAt: 55 }).messages, [{ role: "user", content: "当前问题" }]);
  const withoutTimes = history.map(({ role, content }) => ({ role, content }));
  assert.equal(buildChatContext(withoutTimes, { resetAt: 25 }).messages.length, 1);
});

test("history limits keep complete turns and always include the current question", () => {
  assert.equal(buildChatContext(history, { historyTurns: 0 }).messages.length, 1);
  assert.deepEqual(buildChatContext(history, { historyTurns: 1 }).messages.map(x => x.role), ["user", "assistant", "user"]);
  assert.equal(buildChatContext(history, {}, { maxMessages: 4, maxChars: 100 }).messages.length, 3);
  assert.equal(buildChatContext(history, {}, { maxMessages: 24, maxChars: 4 }).messages.length, 1);
  assert.throws(() => buildChatContext(history, {}, { maxChars: 3 }), /长度上限/);
  const unpaired = [...history.slice(0, 2), message("user", "没有回复的旧问题", 25), ...history.slice(2)];
  assert.equal(buildChatContext(unpaired, {}).messages.some(x => x.content === "没有回复的旧问题"), false);
});

test("conversation search treats regex characters literally and filters roles", () => {
  const messages = [message("user", "Find [a.*] and [a.*]", 1), message("assistant", "[A.*] 回答", 2)];
  const result = findConversationMessages(messages, "[a.*]");
  assert.equal(result.length, 2);
  assert.equal(result[0].count, 2);
  assert.equal(result[1].match, "[A.*]");
  assert.deepEqual(findConversationMessages(messages, "[a.*]", "assistant").map(x => x.index), [1]);
  assert.deepEqual(findConversationMessages(messages, " "), []);
});

test("speech chunks handle long replies and preserve readable text", () => {
  const chunks = speechChunks("# 标题\n**你好**。[来源](https://example.com)\n" + "文字".repeat(500));
  assert.ok(chunks.every(x => x.length <= 181));
  assert.equal(chunks.join("").includes("https://"), false);
  assert.ok(chunks.join("").includes("你好"));
  assert.ok(chunks.length > 5);
});

test("model directory supports case-insensitive multi-word name and ID searches", () => {
  const models = [{ id: "vendor/chat-pro", label: "Vendor · Chat Pro" }, { id: "vendor/chat-fast", label: "Fast model" }];
  assert.deepEqual(filterModelOptions(models, "CHAT pro"), [models[0]]);
  assert.deepEqual(filterModelOptions(models, "vendor/ fast"), [models[1]]);
  assert.deepEqual(filterModelOptions(models, "unknown"), []);
  assert.deepEqual(filterModelOptions(models, ""), models);
});

test("favorites reject credential fields, duplicate records and unsafe model IDs", () => {
  const item = { provider: "openrouter", model: "~google/gemini-flash-latest" };
  assert.deepEqual(validateModelFavorites([item]), [item]);
  assert.throws(() => validateModelFavorites([{ ...item, apiKey: "private-value" }]), /格式/);
  assert.throws(() => validateModelFavorites([item, item]), /重复/);
  assert.throws(() => validateModelFavorites([{ provider: "openrouter", model: "https://example.com" }]), /格式/);
});
