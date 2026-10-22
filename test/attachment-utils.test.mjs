import test from "node:test";
import assert from "node:assert/strict";

import { formatAttachment, readTextFile, validateTextAttachment } from "../public/attachment_utils.js";

const bytes = (text) => new TextEncoder().encode(text);
const file = (name, content) => ({
  name, size: content.byteLength, arrayBuffer: async () => content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength),
});

test("reads supported UTF-8 text files and formats a visible prompt section", async () => {
  for (const name of ["notes.txt", "plan.md", "data.csv", "config.json"]) {
    const result = await readTextFile(file(name, bytes("第一行\n第二行")));
    assert.equal(result.name, name);
    assert.equal(result.text, "第一行\n第二行");
    assert.equal(formatAttachment(result.name, result.text), `【文本附件：${name}】\n第一行\n第二行\n【附件结束：${name}】`);
  }
  assert.equal(validateTextAttachment("bom.txt", bytes("\uFEFF内容")).text, "内容");
});

test("rejects unsupported, oversized and malformed files before adding them to a prompt", async () => {
  await assert.rejects(readTextFile(file("photo.png", bytes("not an image"))), /只支持/);
  await assert.rejects(readTextFile(file("large.txt", new Uint8Array(64 * 1024 + 1))), /64 KiB/);
  await assert.rejects(readTextFile(file("too-long.md", bytes("字".repeat(6001)))), /6000/);
  assert.throws(() => validateTextAttachment("bad.txt", new Uint8Array([0xc3, 0x28])), /UTF-8/);
  assert.throws(() => validateTextAttachment("binary.txt", new Uint8Array([0x41, 0x00, 0x42])), /二进制/);
  assert.throws(() => validateTextAttachment("empty.txt", new Uint8Array()), /空文件/);
});

test("sanitizes file paths and unsafe display characters", () => {
  const result = validateTextAttachment("C:\\secret\\[draft].txt", bytes("可读内容"));
  assert.equal(result.name, "_draft_.txt");
  assert.equal(formatAttachment(result.name, result.text).includes("secret"), false);
  const longName = validateTextAttachment(`${"笔记".repeat(50)}.md`, bytes("正文")).name;
  assert.equal(longName.length, 80);
  assert.equal(longName.endsWith(".md"), true);
});
