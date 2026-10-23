import { createHash, timingSafeEqual } from 'node:crypto';
import {ORIGINAL_LIMITS} from '../public/project_originals.js';

async function readOriginal(request,limit=ORIGINAL_LIMITS.maxFileBytes) {
  if (request.headers['content-type'] !== 'application/octet-stream') throw error('原文件须以二进制上传。', 415);
  const declared = request.headers['content-length'];
  const sizeError=limit===ORIGINAL_LIMITS.maxFileBytes?'原文件最多5 MiB。':'原文件ZIP最多65 MiB。';
  if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw error(sizeError, 413);
  const parts = []; let length = 0;
  for await (const chunk of request) { length += chunk.length; if (length > limit) throw error(sizeError, 413); parts.push(chunk); }
  if (!length) throw error('原文件不能为空。');
  return Buffer.concat(parts, length);
}

const MINUTE = 60_000;
const COOKIE = 'plaude_session';
const PRODUCTION_COOKIE = '__Host-plaude_session';
function error(message, statusCode = 400) { return Object.assign(new Error(message), { statusCode }); }
function first(value) { return typeof value === 'string' ? value.split(',')[0].trim() : ''; }
function tokenMatches(received, expected) {
  if (!expected || typeof received !== 'string') return false;
  const hash = value => createHash('sha256').update(value).digest();
  return timingSafeEqual(hash(received), hash(expected));
}
function requestOrigin(request, config) {
  const host = (config.trustProxy ? first(request.headers['x-forwarded-host']) : '') || first(request.headers.host);
  const forwarded = config.trustProxy ? first(request.headers['x-forwarded-proto']) : '';
  const protocol = ['https', 'http'].includes(forwarded) ? forwarded : request.socket.encrypted ? 'https' : 'http';
  try { return new URL(`${protocol}://${host}`).origin; } catch { return ''; }
}
function assertSameOrigin(request, config, mutation) {
  const origin = request.headers.origin, site = request.headers['sec-fetch-site'];
  if (site === 'cross-site' || site === 'same-site') throw error('账号接口只接受本站请求。', 403);
  if (origin !== undefined && (typeof origin !== 'string' || origin !== requestOrigin(request, config))) throw error('账号接口只接受本站请求。', 403);
  if (mutation && (origin === undefined || request.headers['x-plaude-client'] !== '1')) throw error('请求校验失败，请刷新本站后重试。', 403);
}

/** Mount before the legacy gateway Bearer guard; account cookies do not grant shared-space access. */
export function createAccountRoutes({ store, config, readJson, sendJson, clientIp = request => request.socket.remoteAddress || 'unknown', now = Date.now }) {
  const cookieName = config.nodeEnv === 'production' ? PRODUCTION_COOKIE : COOKIE;
  const buckets = new Map();
  let credentialRequests = 0;
  let originalUploads = 0;
  let originalExports = 0;
  let originalRestores = 0;
  async function credentials(operation) {
    if (credentialRequests >= 4) throw error('账号服务繁忙，请稍后重试。', 503);
    credentialRequests += 1;
    try { return await operation(); } finally { credentialRequests -= 1; }
  }
  function cookieToken(request) {
    const header = request.headers.cookie;
    if (typeof header !== 'string' || header.length > 16384) return '';
    const found = header.split(';').map(part => part.trim()).filter(part => part.startsWith(`${cookieName}=`));
    if (found.length !== 1) return '';
    return found[0].slice(cookieName.length + 1);
  }
  function cookie(token = '', expiresAt = 0) {
    return `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.max(0, Math.floor((expiresAt - now()) / 1000))}${config.nodeEnv === 'production' ? '; Secure' : ''}`;
  }
  function authenticate(request) { return store?.session(cookieToken(request)) || null; }
  function rateLimit(key, limit, window) {
    const time = now();
    if (buckets.size >= 5000) for (const [old, value] of buckets) if (value.until <= time) buckets.delete(old);
    if (buckets.size >= 5000 && !buckets.has(key)) throw error('登录请求过于频繁，请稍后再试。', 429);
    const previous = buckets.get(key);
    const bucket = previous && previous.until > time ? previous : { count: 0, until: time + window };
    if (bucket.count >= limit) throw error('登录请求过于频繁，请 15 分钟后重试。', 429);
    bucket.count += 1; buckets.set(key, bucket);
  }
  async function body(request, limit = 8192) {
    const value = await readJson(request, limit);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw error('请求内容无效。');
    if (['ownerId', 'accountId', 'userId'].some(key => Object.hasOwn(value, key))) throw error('账号身份只能由登录会话决定。');
    return value;
  }
  function requireSession(request, expectedIdentity = false) {
    const session = authenticate(request);
    if (!session) throw error('请先登录个人账号。', 401);
    const expected = request.headers['x-plaude-account-id'];
    if ((expectedIdentity || expected !== undefined) && expected !== session.user.id) throw error('账号已在其他页面切换，请刷新并重新登录。', 403);
    return session;
  }
  async function handle(request, response, url) {
    if (url.pathname !== '/api/account' && !url.pathname.startsWith('/api/account/')) return false;
    const headers = { 'cache-control': 'no-store', vary: 'Cookie' };
    try {
      const path = url.pathname.slice('/api/account'.length), method = request.method;
      assertSameOrigin(request, config, !['GET', 'HEAD', 'OPTIONS'].includes(method));
      if (path === '/session' && method === 'GET') {
        const session = authenticate(request);
        sendJson(response, 200, { enabled: Boolean(store), user: session?.user || null, ...(session ? { expiresAt: session.expiresAt, limits: store.limits } : {}) }, headers); return true;
      }
      if (!store) throw error('个人账号服务尚未启用。', 503);
      if (path === '/register' && method === 'POST') {
        rateLimit(`register:${clientIp(request, config)}`, 10, 60 * MINUTE);
        const authorization = request.headers.authorization;
        const invitation = typeof authorization === 'string' && authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
        if (!tokenMatches(invitation, config.gatewayAccessToken)) throw error('注册需要有效的网站邀请口令。', 403);
        const value = await body(request), result = await credentials(() => store.register(value, { userAgent: request.headers['user-agent'] }));
        sendJson(response, 201, { user: result.user, expiresAt: result.expiresAt, recoveryCode: result.recoveryCode }, { ...headers, 'set-cookie': cookie(result.sessionToken, result.expiresAt) }); return true;
      }
      if (path === '/login' && method === 'POST') {
        rateLimit(`login:${clientIp(request, config)}`, 30, 15 * MINUTE);
        const value = await body(request);
        const name = typeof value.username === 'string' ? value.username.toLowerCase().slice(0, 32) : '';
        rateLimit(`login-name:${clientIp(request, config)}:${name}`, 10, 15 * MINUTE);
        const result = await credentials(() => store.login(value, { userAgent: request.headers['user-agent'] }));
        sendJson(response, 200, { user: result.user, expiresAt: result.expiresAt }, { ...headers, 'set-cookie': cookie(result.sessionToken, result.expiresAt) }); return true;
      }
      if (path === '/logout' && method === 'POST') {
        if (authenticate(request)) requireSession(request);
        store.logout(cookieToken(request));
        sendJson(response, 200, { user: null }, { ...headers, 'set-cookie': cookie() }); return true;
      }
      if (path === '/recover' && method === 'POST') {
        rateLimit(`recover:${clientIp(request, config)}`, 10, 15 * MINUTE);
        const value = await body(request), result = await credentials(() => store.recover(value));
        sendJson(response, 200, { user: null, recoveryCode: result.recoveryCode, message: '密码已重置，所有设备已退出登录。请保存新的恢复码，并用新密码登录。' }, { ...headers, 'set-cookie': cookie() }); return true;
      }
      if (path === '/password' && method === 'POST') {
        const session = requireSession(request, true);
        rateLimit(`password:${session.user.id}`, 10, 15 * MINUTE);
        const value = await body(request);
        await credentials(() => store.changePassword(session.user.id, value));
        sendJson(response, 200, { user: null, message: '密码已修改，所有设备已退出登录，请用新密码登录。' }, { ...headers, 'set-cookie': cookie() }); return true;
      }
      const session = requireSession(request, true), id = session.user.id;
      if(path==='/project-files/restore'&&method==='POST'){
        if(originalRestores>=1)throw error('原文件恢复繁忙，请稍后重试。',503);
        originalRestores++;
        try{
          const content=await readOriginal(request,65*1024*1024);requireSession(request,true);
          const value=await store.restoreOriginals(id,new Blob([content]),url.searchParams.get('snapshot'),{check:()=>requireSession(request,true)});
          sendJson(response,200,value,headers);
        }finally{originalRestores--;}
        return true;
      }
      if(path==='/project-files/export'&&method==='GET'){
        if(originalExports>=2)throw error('原文件备份繁忙，请稍后重试。',503);
        const archive=store.exportOriginals(id,url.searchParams.get('snapshot'));originalExports++;
        try{
          response.writeHead(200,{...headers,'content-type':'application/zip','content-length':archive.size,'content-disposition':'attachment; filename="plaude-originals.zip"','x-content-type-options':'nosniff','content-security-policy':"sandbox; default-src 'none'",'cross-origin-resource-policy':'same-origin'});
          for(const chunk of archive.chunks){requireSession(request,true);if(response.destroyed)throw Error('Backup client disconnected');if(!response.write(chunk))await new Promise((resolve,reject)=>{const done=()=>{response.removeListener('drain',ready);response.removeListener('close',closed);};const ready=()=>{done();resolve();},closed=()=>{done();reject(Error('Backup client disconnected'));};response.once('drain',ready);response.once('close',closed);});}
          response.end();
        }catch{response.destroy();}finally{originalExports--;}
        return true;
      }
      if(path==='/connections'&&method==='GET'){sendJson(response,200,store.getConnections(id),headers);return true;}
      if(path==='/connections'&&method==='PUT'){rateLimit('connections:'+id,30,MINUTE);const value=await body(request,128*1024);requireSession(request,true);sendJson(response,200,store.putConnections(id,value),headers);return true;}
      if (path === '/project-files' && method === 'GET') { sendJson(response, 200, store.listOriginals(id), headers); return true; }
      if (path === '/project-files' && method === 'POST') {
        if (originalUploads >= 2) throw error('原文件上传繁忙，请稍后重试。', 503);
        originalUploads++;
        try {
          const content = await readOriginal(request); requireSession(request, true);
          sendJson(response, 201, store.uploadOriginal(id, {projectId: url.searchParams.get('projectId'), documentId: url.searchParams.get('documentId'), name: url.searchParams.get('name')}, content), headers);
        } finally { originalUploads--; }
        return true;
      }
      if (path === '/project-files' && method === 'DELETE') { sendJson(response, 200, store.deleteOriginal(id, url.searchParams.get('id')), headers); return true; }
      const originalMatch = /^\/project-files\/([a-f0-9-]{36})$/.exec(path);
      if (originalMatch && method === 'GET') {
        const {file, content} = store.downloadOriginal(id, originalMatch[1]);
        const encodedName = encodeURIComponent(file.name).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
        response.writeHead(200, {...headers, 'content-type': 'application/octet-stream', 'content-length': content.length, 'content-disposition': `attachment; filename="original.bin"; filename*=UTF-8''${encodedName}`, 'x-content-type-options': 'nosniff', 'content-security-policy': "sandbox; default-src 'none'", 'cross-origin-resource-policy': 'same-origin'}); response.end(content); return true;
      }
      if (path === '/sessions' && method === 'GET') { sendJson(response, 200, store.listSessions(id, cookieToken(request)), headers); return true; }
      if (path === '/sessions/revoke' && method === 'POST') {
        const value = await body(request);
        sendJson(response, 200, store.revokeSession(id, cookieToken(request), value.sessionId), headers); return true;
      }
      if (path === '/sessions/revoke-others' && method === 'POST') {
        await body(request);
        sendJson(response, 200, store.revokeOtherSessions(id, cookieToken(request)), headers); return true;
      }
      if (path === '/conversations' && method === 'GET') { sendJson(response, 200, store.listConversations(id), headers); return true; }
      const match = /^\/conversations\/([A-Za-z0-9][A-Za-z0-9_-]{7,79})$/.exec(path);
      if (match && method === 'PUT') {
        sendJson(response, 200, store.putConversation(id, match[1], await body(request, 18 * 1024 * 1024)), headers); return true;
      }
      if (match && method === 'DELETE') {
        const value = await body(request);
        sendJson(response, 200, store.deleteConversation(id, match[1], value.revision), headers); return true;
      }
      if (path === '/projects' && method === 'GET') { sendJson(response, 200, store.getProjects(id), headers); return true; }
      if (path === '/instructions' && method === 'GET') { sendJson(response,200,store.listInstructions(id),headers);return true; }
      if (path === '/instructions' && method === 'PUT') { const value=await body(request,16384);requireSession(request,true);sendJson(response,200,store.putInstructions(id,value),headers);return true; }
      if(path==='/shares'&&method==='GET'){requireSession(request,true);sendJson(response,200,store.listShares(id),headers);return true;}
      if(path==='/shares'&&method==='POST'){const value=await body(request,132*1024);requireSession(request,true);rateLimit('shares:'+id,30,MINUTE);sendJson(response,201,store.createShare(id,value),headers);return true;}
      const shareMatch=/^\/shares\/([0-9a-f-]{36})$/.exec(path);
      if(shareMatch&&method==='DELETE'){const value=await body(request);requireSession(request,true);sendJson(response,200,store.revokeShare(id,shareMatch[1],value),headers);return true;}
      if (path === '/memories' && method === 'GET') { sendJson(response, 200, store.listMemories(id), headers); return true; }
      if (path === '/memories' && method === 'PUT') { const value=await body(request,128*1024);requireSession(request,true);sendJson(response,200,store.putMemories(id,value),headers);return true; }
      if (path === '/code-history' && method === 'GET') { sendJson(response, 200, store.listCodeHistory(id), headers); return true; }
      if (path === '/code-history' && method === 'POST') {
        const value = await body(request, 10 * 1024 * 1024); requireSession(request, true);
        sendJson(response, 200, store.mergeCodeHistory(id, value), headers); return true;
      }
      if (path === '/code-history' && method === 'DELETE') {
        const value = await body(request); requireSession(request, true);
        sendJson(response, 200, store.deleteCodeHistory(id, value), headers); return true;
      }
      if(path==='/prompt-library'&&method==='GET'){sendJson(response,200,store.listPrompts(id),headers);return true;}
      if(path==='/prompt-library'&&method==='PUT'){sendJson(response,200,store.putPrompts(id,await body(request,1024*1024)),headers);return true;}
      if (path === '/writing-notes' && method === 'GET') { sendJson(response, 200, store.listWriting(id), headers); return true; }
      const writingMatch=/^\/writing-notes\/([A-Za-z0-9_-]{8,128})$/.exec(path);
      if(writingMatch&&method==='PUT'){sendJson(response,200,store.putWriting(id,writingMatch[1],await body(request,2*1024*1024)),headers);return true;}
      if(writingMatch&&method==='DELETE'){const value=await body(request);sendJson(response,200,store.deleteWriting(id,writingMatch[1],value.revision),headers);return true;}
      if (path === '/projects' && method === 'PUT') {
        sendJson(response, 200, store.putProjects(id, await body(request, 18 * 1024 * 1024)), headers); return true;
      }
      sendJson(response, 404, { error: '账号接口不存在或请求方法不正确。' }, headers);
    } catch (failure) {
      const status = Number.isInteger(failure?.statusCode) ? failure.statusCode : 500;
      sendJson(response, status, { error: status >= 500 ? '账号服务暂时不可用，请稍后重试。' : failure.message }, { ...headers, ...(status === 429 ? { 'retry-after': '900' } : {}) });
    }
    return true;
  }
  return Object.freeze({ handle, authenticate });
}
