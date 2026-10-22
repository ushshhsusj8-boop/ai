import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createSharedConversationStore } from "../src/shared_conversations.mjs";

function sample(overrides = {}) {
  const now = Date.now();
  return {
    id: "conversation-test-001",
    title: "公开测试对话",
    author: "测试访客",
    provider: "deepseek",
    model: "deepseek-flash",
    createdAt: now,
    updatedAt: now,
    messages: [{ role: "user", content: "你好", createdAt: now }],
    ...overrides,
  };
}

test("shared storage keeps incomplete replies after reload and a subsequent completion", () => {
  const directory = mkdtempSync(join(tmpdir(), "huawei-stream-state-"));
  const file = join(directory, "conversations.json");
  const key = "publisher-edit-key-abcdefghijklmnopqrstuvwxyz";
  try {
    const item = sample();
    item.messages.push({ role: "assistant", content: "已收到的部分", completion: "interrupted" });
    createSharedConversationStore(file).upsert(item, key);
    assert.equal(createSharedConversationStore(file).list()[0].messages[1].completion, "interrupted");
    item.updatedAt += 1;
    item.messages[1] = { role: "assistant", content: "已收到的部分以及后续完整回复" };
    createSharedConversationStore(file).upsert(item, key);
    const restored = createSharedConversationStore(file).list()[0].messages[1];
    assert.equal(restored.content, item.messages[1].content);
    assert.equal(restored.completion, undefined);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("shared conversations persist publicly while edit keys stay private", () => {
  const directory = mkdtempSync(join(tmpdir(), "huawei-shared-"));
  const fileName = join(directory, "conversations.json");
  const editKey = "publisher-edit-key-abcdefghijklmnopqrstuvwxyz";
  try {
    const store = createSharedConversationStore(fileName);
    const created = store.upsert(sample(), editKey);
    assert.equal(created.title, "公开测试对话");
    assert.equal("editHash" in created, false);
    assert.equal(JSON.stringify(store.list()).includes(editKey), false);

    assert.throws(() => store.upsert(sample({ title: "篡改" }),
      "another-edit-key-abcdefghijklmnopqrstuvwxyz"), /Only the publisher/);
    const updated = store.upsert(sample({ title: "更新后的公开对话" }), editKey);
    assert.equal(updated.title, "更新后的公开对话");

    const reloaded = createSharedConversationStore(fileName);
    assert.equal(reloaded.list()[0].title, "更新后的公开对话");
    assert.equal(readFileSync(fileName, "utf8").includes(editKey), false);
    assert.equal(reloaded.remove(sample().id, editKey), true);
    assert.equal(reloaded.list()[0].archived, true);
    assert.equal(reloaded.list()[0].messages[0].content, "你好");
    assert.equal(createSharedConversationStore(fileName).list()[0].archived, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("storage retains long histories, rejects stale truncation and journals earlier replies", () => {
  const directory = mkdtempSync(join(tmpdir(), "huawei-shared-"));
  const file = join(directory, "conversations.json");
  const key = "publisher-edit-key-abcdefghijklmnopqrstuvwxyz";
  try {
    const store = createSharedConversationStore(file);
    const now = Date.now();
    const messages = Array.from({ length: 125 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `message ${i}`, createdAt: now }));
    store.upsert(sample({ messages, updatedAt: now }), key);
    assert.equal(createSharedConversationStore(file).list()[0].messages.length, 125);
    assert.throws(() => store.upsert(sample({ messages: messages.slice(0, 20), updatedAt: now }), key), /cannot be removed/);
    assert.throws(() => store.upsert(sample({ messages, updatedAt: now - 1, createdAt: now - 1 }), key), /newer version/);
    const replaced = messages.map((m) => ({ ...m }));
    replaced[1].content = "regenerated reply";
    store.upsert(sample({ messages: replaced, updatedAt: now }), key);
    const revisions = readFileSync(`${file}.history.jsonl`, "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(revisions[0].changes[0].messages[1].content, "message 1");
    assert.equal(revisions[1].changes[0].messages[1].content, "regenerated reply");
    assert.equal(store.list()[0].messages.length, 125);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("a failed disk save leaves the last committed conversations intact", () => {
  const directory = mkdtempSync(join(tmpdir(), "huawei-shared-"));
  const file = join(directory, "conversations.json");
  const key = "publisher-edit-key-abcdefghijklmnopqrstuvwxyz";
  try {
    const store = createSharedConversationStore(file);
    store.upsert(sample(), key);
    const before = readFileSync(file, "utf8");
    rmSync(`${file}.history.jsonl`);
    mkdirSync(`${file}.history.jsonl`);
    assert.throws(() => store.upsert(sample({ title: "unsaved change" }), key));
    assert.equal(store.list()[0].title, "公开测试对话");
    assert.equal(readFileSync(file, "utf8"), before);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("shared conversations reject oversized or malformed public data", () => {
  const directory = mkdtempSync(join(tmpdir(), "huawei-shared-"));
  try {
    const store = createSharedConversationStore(join(directory, "conversations.json"));
    assert.throws(() => store.upsert(sample({ id: "bad" }),
      "publisher-edit-key-abcdefghijklmnopqrstuvwxyz"), /id is invalid/);
    assert.throws(() => store.upsert(sample({
      messages: [{ role: "system", content: "unsafe" }],
    }), "publisher-edit-key-abcdefghijklmnopqrstuvwxyz"), /messages are invalid/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
