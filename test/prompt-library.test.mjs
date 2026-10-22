import test from "node:test";
import assert from "node:assert/strict";

import {
  PROMPT_LIBRARY_KEY,
  MAX_PROMPTS,
  validatePromptLibrary,
  loadPromptLibrary,
  savePromptLibrary,
  createPrompt,
  updatePrompt,
  deletePrompt,
  searchPrompts,
  orderPrompts,
  exportPromptLibrary,
  planPromptImport,
} from "../public/prompt_library.js";

function prompt(id, title, content, createdAt, updatedAt = createdAt) {
  return { id, title, content, createdAt, updatedAt };
}

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test("storage load and save validate data and return detached values", () => {
  const data = memoryStorage();
  const source = [prompt("prompt-one", " 周报 ", " 总结本周工作 ", 10)];
  const saved = savePromptLibrary(data, source);
  assert.deepEqual(saved, [prompt("prompt-one", "周报", "总结本周工作", 10)]);
  assert.deepEqual(loadPromptLibrary(data), saved);
  assert.notEqual(loadPromptLibrary(data)[0], saved[0]);
  assert.equal(JSON.parse(data.getItem(PROMPT_LIBRARY_KEY))[0].title, "周报");
  assert.deepEqual(loadPromptLibrary(memoryStorage()), []);
});

test("strict validation rejects unknown fields, duplicate IDs, bad time, and limits", () => {
  assert.throws(() => validatePromptLibrary([{ ...prompt("prompt-a", "A", "内容", 1), extra: true }]), /不支持的字段/);
  assert.throws(() => validatePromptLibrary([
    prompt("prompt-a", "A", "内容", 1),
    prompt("prompt-a", "B", "内容", 2),
  ]), /重复/);
  assert.throws(() => validatePromptLibrary([prompt("bad id!", "A", "内容", 1)]), /ID/);
  assert.throws(() => validatePromptLibrary([prompt("prompt-a", "A", "内容", 2, 1)]), /不能早于/);
  assert.throws(() => validatePromptLibrary([prompt("prompt-a", "A".repeat(51), "内容", 1)]), /50/);
  assert.throws(() => validatePromptLibrary([prompt("prompt-a", "A", "字".repeat(6001), 1)]), /6000/);
  assert.throws(() => validatePromptLibrary(Array.from({ length: MAX_PROMPTS + 1 }, (_, index) => (
    prompt(`prompt-${index}`, `标题${index}`, "内容", index)
  ))), /30/);
  assert.throws(() => loadPromptLibrary(memoryStorage({ [PROMPT_LIBRARY_KEY]: "not json" })), /JSON/);
});

test("create, update, and delete are immutable and preserve creation metadata", () => {
  const original = [prompt("prompt-one", "原标题", "原内容", 100)];
  const created = createPrompt(original, { title: " 翻译 ", content: " 翻译成中文 " }, { id: "prompt-two", now: 200 });
  assert.equal(original.length, 1);
  assert.deepEqual(created[1], prompt("prompt-two", "翻译", "翻译成中文", 200));

  const updated = updatePrompt(created, "prompt-one", { title: "新标题" }, { now: 300 });
  assert.deepEqual(updated[0], prompt("prompt-one", "新标题", "原内容", 100, 300));
  assert.equal(created[0].title, "原标题");
  assert.deepEqual(deletePrompt(updated, "prompt-two"), [updated[0]]);

  assert.throws(() => createPrompt(created, { title: "重复", content: "内容" }, { id: "prompt-one", now: 400 }), /已存在/);
  assert.throws(() => updatePrompt(created, "prompt-missing", { content: "内容" }), /找不到/);
  assert.throws(() => deletePrompt(created, "prompt-missing"), /找不到/);
});

test("search covers title and content while ordering is deterministic", () => {
  const values = [
    prompt("prompt-b", "邮件", "写一封英文邮件", 10, 30),
    prompt("prompt-c", "代码审查", "检查 JavaScript", 20, 20),
    prompt("prompt-a", "摘要", "提炼 EMAIL 要点", 5, 30),
  ];
  assert.deepEqual(orderPrompts(values).map((item) => item.id), ["prompt-b", "prompt-a", "prompt-c"]);
  assert.deepEqual(orderPrompts(values, "oldest").map((item) => item.id), ["prompt-c", "prompt-b", "prompt-a"]);
  assert.deepEqual(orderPrompts(values, "title").map((item) => item.title), ["代码审查", "邮件", "摘要"]);
  assert.deepEqual(searchPrompts(values, "邮件").map((item) => item.id), ["prompt-b"]);
  assert.deepEqual(searchPrompts(values, "email").map((item) => item.id), ["prompt-a"]);
  assert.deepEqual(searchPrompts(values, "javascript").map((item) => item.id), ["prompt-c"]);
  assert.deepEqual(values.map((item) => item.id), ["prompt-b", "prompt-c", "prompt-a"]);
});

test("export/import is strict and merges new IDs without overwriting local entries", () => {
  const local = [prompt("prompt-one", "本地版本", "保留", 1)];
  const incoming = [
    prompt("prompt-one", "外部版本", "不覆盖", 2),
    prompt("prompt-two", "新增内容", "加入", 3),
  ];
  const json = exportPromptLibrary(incoming, new Date("2026-09-21T00:00:00Z"));
  const plan = planPromptImport(json, local);
  assert.deepEqual({ added: plan.added, skipped: plan.skipped }, { added: 1, skipped: 1 });
  assert.equal(plan.prompts[0].title, "本地版本");
  assert.equal(plan.prompts[1].id, "prompt-two");

  const parsed = JSON.parse(json);
  assert.throws(() => planPromptImport(JSON.stringify({ ...parsed, secret: "x" }), local), /不支持的字段/);
  assert.throws(() => planPromptImport(JSON.stringify({ ...parsed, version: 99 }), local), /版本/);
  assert.throws(() => planPromptImport(JSON.stringify({ ...parsed, prompts: [{ ...incoming[0], unknown: true }] }), local), /不支持的字段/);
  assert.throws(() => planPromptImport("not-json", local), /JSON/);
});

test("import and creation refuse to exceed the 30-item cap", () => {
  const full = Array.from({ length: MAX_PROMPTS }, (_, index) => (
    prompt(`prompt-${index}`, `标题${index}`, "内容", index)
  ));
  assert.throws(() => createPrompt(full, { title: "更多", content: "内容" }, { id: "prompt-more", now: 100 }), /30/);
  const incoming = exportPromptLibrary([prompt("prompt-more", "更多", "内容", 100)]);
  assert.throws(() => planPromptImport(incoming, full), /超过 30/);
});
