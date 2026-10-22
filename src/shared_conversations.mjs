import { validateDocuments, validateDocumentContext } from '../public/document_library.js';
import { validateSearch } from '../public/backups.js';
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { validateImages } from '../public/image_attachments.js';
import {validateBranch} from '../public/conversation_branches.js';

const MAX_CONVERSATIONS = 10_000;
const MAX_MESSAGES = 10_000;
const MAX_CONTENT_CHARS = 256_000;
const MAX_TOTAL_CHARS = 4 * 1024 * 1024;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/;
const MODEL_PATTERN = /^[~A-Za-z0-9][A-Za-z0-9._~:/+-]{0,191}$/;

function publicError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function cleanText(value, maximum, field) {
  if (typeof value !== "string") throw publicError(`${field} must be text`);
  const result = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim().slice(0, maximum);
  if (!result) throw publicError(`${field} is required`);
  return result;
}

function validTime(value, fallback = Date.now()) {
  return Number.isSafeInteger(value) && value >= 0 && value <= Date.now() + 300_000
    ? value : fallback;
}

export function normalizeConversation(value, now = Date.now(), { allowEmpty = false } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw publicError("conversation must be an object");
  }
  if (typeof value.id !== "string" || !ID_PATTERN.test(value.id)) {
    throw publicError("conversation id is invalid");
  }
  if (typeof value.provider !== "string" || !/^[a-z][a-z0-9_-]{0,31}$/.test(value.provider)) {
    throw publicError("provider is invalid");
  }
  if (typeof value.model !== "string" || !MODEL_PATTERN.test(value.model) || value.model.includes("://")) {
    throw publicError("model is invalid");
  }
  if (!Array.isArray(value.messages) || value.messages.length < (allowEmpty ? 0 : 1) || value.messages.length > MAX_MESSAGES) {
    throw publicError(`messages must contain between 1 and ${MAX_MESSAGES} items`);
  }
  const documents = validateDocuments(value.documents);
  let totalCharacters = documents.reduce((sum, doc) => sum + doc.sections.reduce((n, section) => n + section.text.length, 0), 0);
  const messages = value.messages.map((message) => {
    if (!message || typeof message !== "object" || Array.isArray(message)
      || !["user", "assistant"].includes(message.role)) {
      throw publicError("shared messages are invalid");
    }
    if (typeof message.content !== "string" || !message.content.trim()
      || message.content.length > MAX_CONTENT_CHARS) throw publicError("message content is empty or too large", 413);
    const content = message.content;
    const images = validateImages(message.images, message.role);
    const documentContext = validateDocumentContext(message.documentContext);
    const search = message.role === 'assistant' && value.provider !== 'gemini' ? validateSearch(message.search) : null;
    totalCharacters += JSON.stringify(search || {}).length;
    if (documentContext && message.role !== "assistant") throw publicError("Only assistant messages may have document references");
    totalCharacters += JSON.stringify(documentContext || {}).length;
    totalCharacters += content.length + images.reduce((sum, image) => sum + image.dataUrl.length, 0);
    return Object.freeze({
      role: message.role,
      content,
      ...(documentContext ? { documentContext } : {}),
      ...(search ? { search } : {}),
      ...(images.length ? { images } : {}),
      ...(message.role === 'assistant' && ['stopped', 'interrupted', 'length'].includes(message.completion)
        ? { completion: message.completion } : {}),
      createdAt: validTime(message.createdAt, now),
      ...(Number.isSafeInteger(message.groundedAt) ? { groundedAt: message.groundedAt } : {}),
    });
  });
  if (totalCharacters > MAX_TOTAL_CHARS) throw publicError("shared conversation is too large", 413);
  const createdAt = validTime(value.createdAt, now);
  return Object.freeze({
    id: value.id,
    ...(value.branch!==undefined?{branch:validateBranch(value.branch,value.id)}:{}),
    title: cleanText(value.title || "公开对话", 60, "title"),
    author: cleanText(value.author || "匿名访客", 30, "author"),
    provider: value.provider,
    model: value.model,
    titleEdited: value.titleEdited === true,
    pinned: value.pinned === true,
    archived: value.archived === true,
    webSearch: value.webSearch === true,
    instructions: typeof value.instructions === "string" ? value.instructions.slice(0, 2000) : "",
    parameters: Object.fromEntries(["temperature", "top_p", "max_output_tokens"]
      .filter((key) => Number.isFinite(value.parameters?.[key]))
      .map((key) => [key, value.parameters[key]])),
    context: {
      historyTurns: Number.isInteger(value.context?.historyTurns) && value.context.historyTurns >= 0
        && value.context.historyTurns <= 10 ? value.context.historyTurns : null,
      resetAt: Number.isSafeInteger(value.context?.resetAt) ? value.context.resetAt : null,
      ...(value.context?.useMemory===false?{useMemory:false}:{}),
    },
    createdAt,
    updatedAt: Math.max(createdAt, validTime(value.updatedAt, now)),
    documents,
    messages: Object.freeze(messages),
  });
}

function hashEditKey(value) {
  if (typeof value !== "string" || value.length < 32 || value.length > 160) {
    throw publicError("edit key is invalid");
  }
  return createHash("sha256").update(value).digest("hex");
}

function publicConversation(item) {
  const { editHash: _editHash, ...conversation } = item;
  return Object.freeze(conversation);
}

function retainsImages(previous, next) {
  return (previous.documents || []).every(doc => next.documents?.some(item => item.id === doc.id && item.name === doc.name && JSON.stringify(item.sections) === JSON.stringify(doc.sections)))
    && previous.messages.every((message, index) => !message.images?.length
    || JSON.stringify(message.images) === JSON.stringify(next.messages[index]?.images));
}

export function createSharedConversationStore(fileName) {
  if (typeof fileName !== "string" || !fileName.trim()) {
    throw new Error("A shared conversation file is required");
  }
  const storagePath = fileName.trim();
  let records = [];
  if (existsSync(storagePath)) {
    const raw = readFileSync(storagePath);
    if (raw.length > MAX_FILE_BYTES) throw new Error("Shared conversation file is too large");
    const parsed = JSON.parse(raw.toString("utf8"));
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.conversations)
      || parsed.conversations.length > MAX_CONVERSATIONS) {
      throw new Error("Shared conversation file is invalid");
    }
    records = parsed.conversations.map((item) => ({
      ...normalizeConversation(item),
      editHash: typeof item.editHash === "string" && /^[a-f0-9]{64}$/.test(item.editHash)
        ? item.editHash : (() => { throw new Error("Shared conversation edit hash is invalid"); })(),
    }));
  }

  const persist = (next, changes) => {
    const directory = dirname(storagePath);
    mkdirSync(directory, { recursive: true, mode: 0o750 });
    const temporary = `${storagePath}.tmp`;
    const payload = `${JSON.stringify({ version: 1, conversations: next })}\n`;
    if (Buffer.byteLength(payload) > MAX_FILE_BYTES) throw publicError("Shared storage is full", 507);
    writeFileSync(temporary, payload, { encoding: "utf8", mode: 0o640 });
    // Retain every saved version; no rotation or automatic removal of old chats.
    appendFileSync(`${storagePath}.history.jsonl`, `${JSON.stringify({ savedAt: Date.now(), changes })}\n`,
      { encoding: "utf8", mode: 0o640 });
    renameSync(temporary, storagePath);
    records = next;
  };

  return Object.freeze({
    list() {
      return records
        .map(publicConversation)
        .sort((a, b) => b.updatedAt - a.updatedAt);
    },
    upsert(conversationInput, editKey) {
      const conversation = normalizeConversation(conversationInput);
      const editHash = hashEditKey(editKey);
      const index = records.findIndex((item) => item.id === conversation.id);
      const next = [...records];
      if (index >= 0) {
        if (records[index].editHash !== editHash) throw publicError("Only the publisher can update this conversation", 403);
        if (conversation.updatedAt < records[index].updatedAt) throw publicError("A newer version is already saved", 409);
        if (conversation.messages.length < records[index].messages.length) {
          throw publicError("Saved messages cannot be removed; create a branch instead", 409);
        }
        if (!retainsImages(records[index], conversation)) throw publicError('Saved attachments cannot be removed or replaced; create a branch instead', 409);
        next[index] = { ...conversation, createdAt: records[index].createdAt, editHash };
      } else {
        if (records.length >= MAX_CONVERSATIONS) throw publicError("Shared conversation limit reached", 409);
        next.push({ ...conversation, editHash });
      }
      persist(next, [next[index >= 0 ? index : next.length - 1]]);
      return publicConversation(records.find((item) => item.id === conversation.id));
    },
    remove(id, editKey) {
      if (typeof id !== "string" || !ID_PATTERN.test(id)) throw publicError("conversation id is invalid");
      const editHash = hashEditKey(editKey);
      const index = records.findIndex((item) => item.id === id);
      if (index < 0) throw publicError("Shared conversation was not found", 404);
      if (records[index].editHash !== editHash) throw publicError("Only the publisher can delete this conversation", 403);
      const next = [...records];
      next[index] = { ...records[index], archived: true, updatedAt: Date.now() };
      persist(next, [next[index]]);
      return true;
    },
    mergeRemote(conversations) {
      const next = [...records];
      const changes = [];
      for (const input of conversations) {
        const item = normalizeConversation(input);
        const index = next.findIndex((record) => record.id === item.id);
        if (index < 0) {
          if (next.length >= MAX_CONVERSATIONS) throw publicError("Shared conversation limit reached", 409);
          const created = { ...item, editHash: "0".repeat(64) };
          next.push(created);
          changes.push(created);
        } else if (item.updatedAt >= next[index].updatedAt
          && retainsImages(next[index], item)
          && item.messages.length >= next[index].messages.length
          && JSON.stringify(publicConversation(next[index])) !== JSON.stringify(item)) {
          next[index] = { ...item, editHash: next[index].editHash };
          changes.push(next[index]);
        }
      }
      if (changes.length) persist(next, changes);
    },
  });
}
