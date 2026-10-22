const ALLOWED_EXTENSIONS = new Set(["txt", "md", "csv", "json"]);
export const MAX_ATTACHMENT_BYTES = 64 * 1024;
export const MAX_ATTACHMENT_CHARS = 6000;

function filenameForDisplay(value) {
  if (typeof value !== "string") throw new Error("文件名无效。");
  const leaf = value.replaceAll("\\", "/").split("/").at(-1) || "";
  const clean = leaf.replace(/[<>:"|?*\[\]\x00-\x1f\x7f]/g, "_").trim();
  const dot = clean.lastIndexOf(".");
  const extension = dot >= 0 ? clean.slice(dot + 1).toLowerCase() : "";
  const base = dot >= 0 ? clean.slice(0, dot).trim().slice(0, 79 - extension.length) : "";
  if (!base || !ALLOWED_EXTENSIONS.has(extension)) {
    throw new Error("只支持 .txt、.md、.csv 和 .json 文本文件。");
  }
  return `${base}.${extension}`;
}

export function validateTextAttachment(name, bytes) {
  const displayName = filenameForDisplay(name);
  if (!(bytes instanceof Uint8Array)) throw new Error("无法读取文件内容。");
  if (bytes.byteLength === 0) throw new Error("不能添加空文件。");
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new Error("单个文本文件不能超过 64 KiB。");
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  } catch {
    throw new Error("文件不是有效的 UTF-8 文本。");
  }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) {
    throw new Error("文件包含二进制或不可显示的控制字符。");
  }
  if (!text.trim()) throw new Error("文件没有可读取的文字。");
  if (Array.from(text).length > MAX_ATTACHMENT_CHARS) {
    throw new Error("单个文本文件最多支持 6000 个字符。");
  }
  return { name: displayName, text };
}

export async function readTextFile(file) {
  if (!file || typeof file.arrayBuffer !== "function") throw new Error("无法读取所选文件。");
  filenameForDisplay(file.name);
  if (typeof file.size === "number" && file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error("单个文本文件不能超过 64 KiB。");
  }
  const buffer = await file.arrayBuffer();
  return validateTextAttachment(file.name, new Uint8Array(buffer));
}

export function formatAttachment(name, text) {
  const displayName = filenameForDisplay(name);
  if (typeof text !== "string" || !text.trim()) throw new Error("附件内容为空。");
  return `【文本附件：${displayName}】\n${text.trim()}\n【附件结束：${displayName}】`;
}
