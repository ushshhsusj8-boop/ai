import { createHash, randomBytes, randomUUID, scrypt as deriveKey, timingSafeEqual } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { PROJECT_BYTES, validateProjects } from '../public/projects.js';
import { normalizeConversation } from './shared_conversations.mjs';
import { createPromptCloud } from './prompt_cloud.mjs';
import { createWritingNotes } from './writing_notes.mjs';
import { createHistoryCloudStore } from './history_cloud.mjs';
import {createProjectOriginalStore} from './project_originals.mjs';
import {createAccountMemory} from './account_memory.mjs';
import {createAccountInstructions} from './account_instructions.mjs';
import {createAccountShares} from './account_shares.mjs';

const scrypt = promisify(deriveKey);
const DAY = 86_400_000;
const MAX_USERS = 500;
const MAX_CONVERSATIONS = 1000;
const MAX_CONVERSATION_RECORDS = 10_000;
const MAX_WORKSPACE_BYTES = 64 * 1024 * 1024;
const MAX_ACCOUNT_BYTES = 4 * 1024 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const CHAT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/;
const usernamePattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{2,31}$/;
const digest = token => createHash('sha256').update(token).digest('hex');
// A display reference cannot be used as a cookie or reveal its stored digest.
const sessionReference = session => createHash('sha256').update('plaude-session-display-v1:' + session.digest).digest('base64url');
function deviceLabel(agent = '') {
  agent = typeof agent === 'string' ? agent.slice(0, 512) : '';
  const browser = /Edg\//.test(agent) ? 'Edge' : /Firefox\//.test(agent) ? 'Firefox' : /(?:Chrome|CriOS)\//.test(agent) ? 'Chrome' : /Safari\//.test(agent) ? 'Safari' : '浏览器';
  const platform = /Android/.test(agent) ? 'Android' : /iPhone|iPad/.test(agent) ? 'iOS' : /Windows/.test(agent) ? 'Windows' : /Macintosh/.test(agent) ? 'macOS' : /Linux/.test(agent) ? 'Linux' : '设备未识别';
  return `${browser} · ${platform}`;
}
const copy = value => structuredClone(value);
const emptyProjects = () => ({ version: 1, projects: [], links: [] });
function fail(message, statusCode = 400) { throw Object.assign(new Error(message), { statusCode }); }
function publicUser(user) { return { id: user.id, username: user.username, displayName: user.displayName, createdAt: user.createdAt }; }
function password(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 256 || Buffer.byteLength(value) > 1024) fail('密码须为 12–256 个字符。');
  return value;
}
async function passwordHash(value, salt = randomBytes(16).toString('hex')) {
  const hash = await scrypt(value, Buffer.from(salt, 'hex'), 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return { salt, hash: hash.toString('hex') };
}
async function passwordMatches(value, stored) {
  const actual = await passwordHash(typeof value === 'string' && value.length <= 256 ? value : '', stored?.salt || '00'.repeat(16));
  return timingSafeEqual(Buffer.from(actual.hash, 'hex'), Buffer.from(stored?.hash || '00'.repeat(64), 'hex')) && Boolean(stored);
}
function atomicWrite(file, value, maximum) {
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized) > maximum) fail('云端空间已满，请导出备份后清理资料。', 413);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomBytes(12).toString('hex')}.tmp`;
  let handle;
  try {
    handle = openSync(temp, 'wx', 0o600);
    writeFileSync(handle, serialized, 'utf8'); fsyncSync(handle); closeSync(handle); handle = undefined;
    renameSync(temp, file);
  } finally {
    if (handle !== undefined) closeSync(handle);
    rmSync(temp, { force: true });
  }
}
function readFile(file, maximum) {
  if (statSync(file).size > maximum) throw Error('Account storage exceeds its configured limit');
  return JSON.parse(readFileSync(file, 'utf8'));
}
function metadataValid(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.users) || !Array.isArray(value.sessions)
    || value.users.length > MAX_USERS || value.sessions.length > MAX_USERS * 8) return false;
  const ids = new Set(), names = new Set(), sessions = new Set();
  for (const user of value.users) {
    if (!user || !UUID.test(user.id) || ids.has(user.id) || !usernamePattern.test(user.username)
      || user.username !== user.username.toLowerCase() || names.has(user.username)
      || typeof user.displayName !== 'string' || user.displayName.length > 60
      || !Number.isSafeInteger(user.createdAt) || !/^[a-f0-9]{32}$/.test(user.password?.salt)
      || !/^[a-f0-9]{128}$/.test(user.password?.hash)
      || (user.recoveryHash !== undefined && !/^[a-f0-9]{64}$/.test(user.recoveryHash))) return false;
    ids.add(user.id); names.add(user.username);
  }
  for (const session of value.sessions) {
    if (!session || !/^[a-f0-9]{64}$/.test(session.digest) || sessions.has(session.digest) || !ids.has(session.userId)
      || !Number.isSafeInteger(session.createdAt) || !Number.isSafeInteger(session.expiresAt) || session.expiresAt <= session.createdAt
      || (session.device !== undefined && (typeof session.device !== 'string' || session.device.length > 60 || /[\u0000-\u001f\u007f]/.test(session.device)))) return false;
    sessions.add(session.digest);
  }
  return true;
}

/** One process owns this store. Passwords and raw cookie tokens never enter public responses or disk. */
export function createAccountStore(filePath, { now = Date.now, sessionDays = 30 } = {}) {
  if (!filePath || ![14, 30].includes(sessionDays)) throw Error('Account store needs a file path and a 14 or 30 day session');
  const file = resolve(filePath), workspaceDirectory = `${file}.workspaces`;
  let state = existsSync(file) ? readFile(file, MAX_ACCOUNT_BYTES) : { version: 1, users: [], sessions: [] };
  if (!metadataValid(state)) throw Error('Invalid account metadata; refusing to replace existing data');
  function save(next) { atomicWrite(file, next, MAX_ACCOUNT_BYTES); state = next; }
  function userFor(id) {
    const user = typeof id === 'string' && UUID.test(id) ? state.users.find(item => item.id === id) : undefined;
    if (!user) fail('请登录个人账号。', 401);
    return user;
  }
  function addSession(next, user, agent) {
    const time = now(), sessionToken = randomBytes(32).toString('base64url'), expiresAt = time + sessionDays * DAY;
    next.sessions = next.sessions.filter(item => item.expiresAt > time);
    const mine = next.sessions.filter(item => item.userId === user.id).sort((a, b) => a.createdAt - b.createdAt);
    const removed = new Set(mine.slice(0, Math.max(0, mine.length - 7)).map(item => item.digest));
    next.sessions = next.sessions.filter(item => !removed.has(item.digest));
    next.sessions.push({ digest: digest(sessionToken), userId: user.id, createdAt: time, expiresAt, device: deviceLabel(agent) });
    return { user: publicUser(user), sessionToken, expiresAt };
  }
  function workspace(id) {
    userFor(id);
    const target = join(workspaceDirectory, `${id}.json`);
    const value = existsSync(target) ? readFile(target, MAX_WORKSPACE_BYTES)
      : { version: 1, userId: id, conversations: [], projects: emptyProjects(), projectsRevision: 0 };
    if (!value || value.version !== 1 || value.userId !== id || !Array.isArray(value.conversations)
      || value.conversations.length > MAX_CONVERSATION_RECORDS || !Number.isSafeInteger(value.projectsRevision) || value.projectsRevision < 0) {
      throw Error('Invalid private workspace; refusing to replace existing data');
    }
    const ids = new Set();
    value.conversations = value.conversations.map(item => {
      if (!item || !CHAT_ID.test(item.id) || ids.has(item.id) || !Number.isSafeInteger(item.revision) || item.revision < 1
        || (!item.deleted && item.conversation?.id !== item.id)) throw Error('Invalid private conversation storage');
      ids.add(item.id);
      return item.deleted ? { id: item.id, revision: item.revision, deleted: true }
        : { id: item.id, revision: item.revision, conversation: normalizeConversation(item.conversation, now(), { allowEmpty: true }) };
    });
    value.projects = validateProjects(value.projects);
    return { target, value };
  }
  function revision(value) { if (!Number.isSafeInteger(value) || value < 0) fail('资料版本无效。'); }
  function conflict() { fail('此内容已在其他设备更新，请刷新同步后再修改。', 409); }
  function currentSession(id, token) {
    userFor(id);
    const entry = typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token)
      ? state.sessions.find(item => item.userId === id && item.digest === digest(token) && item.expiresAt > now()) : null;
    if (!entry) fail('请重新登录个人账户。', 401);
    return entry;
  }
  const prompts=createPromptCloud(`${file}.prompts`,{requireUser:userFor,now});
  const writing=createWritingNotes(`${file}.writing`,{requireUser:userFor,now});
  const memory=createAccountMemory(`${file}.memories`,{requireUser:userFor});
  const shares=createAccountShares(`${file}.shares.json`,{requireUser:userFor,now});
  const instructions=createAccountInstructions(`${file}.instructions`,{requireUser:userFor});
  const codeHistory=createHistoryCloudStore(`${file}.code-history`,{requireUser:userFor});
  const originals=createProjectOriginalStore(`${file}.originals`,{requireUser:userFor,getProjects:id=>workspace(id).value.projects,now});
  return Object.freeze({
    listPrompts:prompts.list,putPrompts:prompts.put,
    listMemories:memory.list,putMemories:memory.put,resolveMemories:memory.resolve,
    listShares:shares.list,createShare:shares.create,revokeShare:shares.revoke,resolveShare:shares.resolve,
    listInstructions:instructions.list,putInstructions:instructions.put,resolveInstructions:instructions.resolve,
    listWriting:writing.list,putWriting:writing.put,deleteWriting:writing.remove,
    listCodeHistory:codeHistory.list,mergeCodeHistory:codeHistory.merge,deleteCodeHistory:codeHistory.remove,
    listOriginals: originals.list, uploadOriginal: originals.upload, downloadOriginal: originals.download, deleteOriginal: originals.remove,
    exportOriginals: originals.export.bind(originals),
    restoreOriginals: originals.restore.bind(originals),
    limits: Object.freeze({ maxConversations: MAX_CONVERSATIONS, workspaceBytes: MAX_WORKSPACE_BYTES, maxProjects: 20 }),
    async register({ username, password: secret, displayName } = {}, { userAgent } = {}) {
      if (typeof username !== 'string' || !usernamePattern.test(username)) fail('用户名须为 3–32 位英文字母、数字、下划线、短横线或点。');
      username = username.toLowerCase(); password(secret);
      displayName = typeof displayName === 'string' ? displayName.trim() : username;
      if (!displayName || displayName.length > 60 || /[\u0000-\u001f\u007f]/.test(displayName)) fail('显示名称须为 1–60 个字符。');
      const hashed = await passwordHash(secret);
      if (state.users.some(item => item.username === username)) fail('该用户名不可用，请换一个。', 409);
      if (state.users.length >= MAX_USERS) fail('当前账号名额已满，请联系网站管理员。', 503);
      const recoveryCode = randomBytes(32).toString('base64url');
      const next = copy(state), user = { id: randomUUID(), username, displayName, password: hashed, recoveryHash: digest(recoveryCode), createdAt: now() };
      next.users.push(user); const result = addSession(next, user, userAgent); save(next); return { ...result, recoveryCode };
    },
    async login({ username, password: secret } = {}, { userAgent } = {}) {
      const name = typeof username === 'string' && usernamePattern.test(username) ? username.toLowerCase() : '';
      const user = state.users.find(item => item.username === name);
      const valid = await passwordMatches(secret, user?.password);
      if (!valid || !user || state.users.find(item => item.id === user.id)?.password.hash !== user.password.hash) fail('用户名或密码错误。', 401);
      const next = copy(state), result = addSession(next, user, userAgent); save(next); return result;
    },
    session(token) {
      if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
      const session = state.sessions.find(item => item.digest === digest(token) && item.expiresAt > now());
      const user = session && state.users.find(item => item.id === session.userId);
      return user ? { user: publicUser(user), expiresAt: session.expiresAt } : null;
    },
    logout(token) {
      if (typeof token !== 'string' || token.length > 256) return;
      const hash = digest(token), next = copy(state); next.sessions = next.sessions.filter(item => item.digest !== hash);
      if (next.sessions.length !== state.sessions.length) save(next);
    },
    listSessions(id, token) {
      const current = currentSession(id, token);
      return { userId: id, sessions: state.sessions.filter(item => item.userId === id && item.expiresAt > now())
        .sort((a, b) => b.createdAt - a.createdAt).map(item => ({ id: sessionReference(item), current: item.digest === current.digest,
          device: item.device || '旧登录 · 设备未识别', createdAt: item.createdAt, expiresAt: item.expiresAt })) };
    },
    revokeSession(id, token, reference) {
      const current = currentSession(id, token);
      if (typeof reference !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(reference)) fail('登录设备编号无效。');
      const target = state.sessions.find(item => item.userId === id && item.expiresAt > now() && sessionReference(item) === reference);
      if (!target) fail('该登录已失效，请刷新设备列表。', 404);
      if (target.digest === current.digest) fail('请使用“退出登录”退出当前设备。', 409);
      const next = copy(state); next.sessions = next.sessions.filter(item => item.digest !== target.digest); save(next);
      return { userId: id, revoked: 1 };
    },
    revokeOtherSessions(id, token) {
      const current = currentSession(id, token), next = copy(state);
      const revoked = next.sessions.filter(item => item.userId === id && item.digest !== current.digest && item.expiresAt > now()).length;
      next.sessions = next.sessions.filter(item => item.userId !== id || item.digest === current.digest);
      if (next.sessions.length !== state.sessions.length) save(next);
      return { userId: id, revoked };
    },
    async changePassword(id, { currentPassword, newPassword } = {}) {
      password(newPassword); const user = userFor(id);
      if (!await passwordMatches(currentPassword, user.password)) fail('当前密码错误。', 401);
      const hashed = await passwordHash(newPassword), current = userFor(id);
      if (current.password.hash !== user.password.hash) fail('密码已修改，请重新登录。', 401);
      const next = copy(state); next.users.find(item => item.id === id).password = hashed;
      next.sessions = next.sessions.filter(item => item.userId !== id); save(next); return publicUser(current);
    },
    async recover({ username, recoveryCode, newPassword } = {}) {
      const name = typeof username === 'string' && usernamePattern.test(username) ? username.toLowerCase() : '';
      const user = state.users.find(item => item.username === name);
      const code = typeof recoveryCode === 'string' && /^[A-Za-z0-9_-]{43}$/.test(recoveryCode) ? recoveryCode : '';
      const valid = timingSafeEqual(Buffer.from(digest(code), 'hex'), Buffer.from(user?.recoveryHash || '00'.repeat(32), 'hex'));
      if (!valid || !user?.recoveryHash) fail('用户名或恢复码错误。', 401);
      password(newPassword); const hashed = await passwordHash(newPassword);
      if (userFor(user.id).recoveryHash !== user.recoveryHash) fail('用户名或恢复码错误。', 401);
      const nextCode = randomBytes(32).toString('base64url'), next = copy(state), target = next.users.find(item => item.id === user.id);
      target.password = hashed; target.recoveryHash = digest(nextCode);
      next.sessions = next.sessions.filter(item => item.userId !== user.id); save(next);
      return { user: publicUser(user), recoveryCode: nextCode };
    },
    listConversations(id) {
      const { value } = workspace(id);
      return { userId: id, conversations: value.conversations.filter(item => !item.deleted).map(({ conversation, revision }) => ({ conversation, revision })) };
    },
    putConversation(id, conversationId, body = {}) {
      revision(body.revision); if (!CHAT_ID.test(conversationId)) fail('对话编号无效。');
      let conversation;
      try { conversation = normalizeConversation(body.conversation, now(), { allowEmpty: true }); }
      catch (failure) { fail(failure.message, Number.isInteger(failure.statusCode) ? failure.statusCode : 400); }
      if (conversation.id !== conversationId) fail('对话编号不一致。');
      const { target, value } = workspace(id), index = value.conversations.findIndex(item => item.id === conversationId), previous = value.conversations[index];
      if (previous ? previous.revision !== body.revision || previous.deleted : body.revision !== 0) conflict();
      if (index < 0 && value.conversations.filter(item => !item.deleted).length >= MAX_CONVERSATIONS) fail('云端对话数量已满，请先备份并清理。', 413);
      if (index < 0 && value.conversations.length >= MAX_CONVERSATION_RECORDS) fail('历史对话编号已达上限，请联系管理员清理。', 413);
      const entry = { id: conversationId, conversation, revision: (previous?.revision || 0) + 1 };
      if (index < 0) value.conversations.push(entry); else value.conversations[index] = entry;
      atomicWrite(target, value, MAX_WORKSPACE_BYTES);
      return { userId: id, conversation: copy(conversation), revision: entry.revision };
    },
    deleteConversation(id, conversationId, expectedRevision) {
      revision(expectedRevision); const { target, value } = workspace(id), index = value.conversations.findIndex(item => item.id === conversationId), item = value.conversations[index];
      if (!item || item.deleted) fail('对话不存在。', 404);
      if (item.revision !== expectedRevision) conflict();
      value.conversations[index] = { id: conversationId, revision: item.revision + 1, deleted: true };
      value.projects.links = value.projects.links.filter(link => link.conversationId !== conversationId);
      value.projectsRevision += 1;
      atomicWrite(target, value, MAX_WORKSPACE_BYTES); return { userId: id, deleted: true, revision: item.revision + 1, projectsRevision: value.projectsRevision };
    },
    getProjects(id) { const { value } = workspace(id); return { userId: id, projects: copy(value.projects), revision: value.projectsRevision }; },
    putProjects(id, body = {}) {
      revision(body.revision); let projects;
      if (Buffer.byteLength(JSON.stringify(body.projects) || '') > PROJECT_BYTES) fail('项目库已满（16 MiB），请先导出并清理资料。', 413);
      try { projects = validateProjects(body.projects); } catch (error) { fail(error.message); }
      const { target, value } = workspace(id);
      if (value.projectsRevision !== body.revision) conflict();
      value.projects = projects; value.projectsRevision += 1; atomicWrite(target, value, MAX_WORKSPACE_BYTES);
      return { userId: id, projects: copy(projects), revision: value.projectsRevision };
    },
  });
}
