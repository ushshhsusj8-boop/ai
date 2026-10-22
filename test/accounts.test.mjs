import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {branchOrigin} from '../public/conversation_branches.js';
import { createAccountStore } from '../src/accounts.mjs';
import { createAccountRoutes } from '../src/account_routes.mjs';
import { normalizeConversation } from '../src/shared_conversations.mjs';

const PASSWORD = 'A-long-test-password-123!';
const INVITATION = 'test-registration-invitation-0123456789';
const conversation = (id = 'private-chat-0001', overrides = {}) => ({ id, title: '私有资料', provider: 'deepseek', model: 'deepseek-flash', messages: [], ...overrides });
const projects = (name = '私人项目') => ({ version: 1, projects: [{ id: 'project-private-0001', name, instructions: '简要回答', revision: 1, documents: [] }], links: [] });
function fixture(options) {
  const directory = mkdtempSync(join(tmpdir(), 'plaude-accounts-'));
  const file = join(directory, 'accounts.json');
  return { directory, file, store: createAccountStore(file, options), dispose: () => rmSync(directory, { force: true, recursive: true }) };
}
async function users(store) {
  return [await store.register({ username: 'Alice', password: PASSWORD, displayName: '小明' }), await store.register({ username: 'Bob', password: PASSWORD })];
}

test('private cloud keeps empty branch ancestry across restart within each account only',async()=>{
  const f=fixture();try{const [alice,bob]=await users(f.store),root=conversation('branch-original',{messages:[{role:'user',content:'父问题'}]}),child=conversation('branch-child-01',{branch:branchOrigin(root,0,'edit',100)});
    f.store.putConversation(alice.user.id,root.id,{conversation:root,revision:0});f.store.putConversation(alice.user.id,child.id,{conversation:child,revision:0});
    const restarted=createAccountStore(f.file),saved=restarted.listConversations(alice.user.id).conversations.find(r=>r.conversation.id===child.id).conversation;
    assert.deepEqual(saved.branch,child.branch);assert.deepEqual(saved.messages,[]);assert.equal(restarted.listConversations(bob.user.id).conversations.length,0);
  }finally{f.dispose();}
});
function status(code) { return failure => failure.statusCode === code; }

test('accounts persist salted passwords and hashed sessions without leaking credentials', async () => {
  const f = fixture();
  try {
    const [alice, bob] = await users(f.store), disk = readFileSync(f.file, 'utf8'), persisted = JSON.parse(disk);
    assert.equal(alice.user.username, 'alice'); assert.equal(alice.user.displayName, '小明');
    for (const secret of [PASSWORD, alice.sessionToken, bob.sessionToken, alice.recoveryCode, bob.recoveryCode]) assert.equal(disk.includes(secret), false);
    assert.notEqual(persisted.users[0].password.hash, persisted.users[1].password.hash);
    assert.notEqual(persisted.users[0].password.salt, persisted.users[1].password.salt);
    assert.deepEqual(Object.keys(alice.user).sort(), ['createdAt', 'displayName', 'id', 'username']);
    assert.equal(createAccountStore(f.file).session(alice.sessionToken).user.id, alice.user.id);
    assert.equal(f.store.session('invalid-cookie'), null);
    assert.equal((await f.store.login({ username: 'ALICE', password: PASSWORD })).user.id, alice.user.id);
    await assert.rejects(f.store.login({ username: 'Alice', password: 'incorrect-password' }), status(401));
    await assert.rejects(f.store.login({ username: 'no-such-user', password: PASSWORD }), { message: '用户名或密码错误。' });
    await assert.rejects(f.store.register({ username: 'ALICE', password: PASSWORD }), status(409));
    await assert.rejects(f.store.register({ username: '非法用户名', password: PASSWORD }), status(400));
    await assert.rejects(f.store.register({ username: 'shortpass', password: '123456' }), status(400));
  } finally { f.dispose(); }
});

test('sessions expire, logout survives restart, and password change revokes all devices', async () => {
  let time = Date.now(); const f = fixture({ now: () => time, sessionDays: 14 });
  try {
    const alice = await f.store.register({ username: 'alice', password: PASSWORD });
    assert.equal(alice.expiresAt - time, 14 * 86_400_000);
    const second = await f.store.login({ username: 'alice', password: PASSWORD });
    f.store.logout(second.sessionToken);
    assert.equal(createAccountStore(f.file, { now: () => time }).session(second.sessionToken), null);
    await assert.rejects(f.store.changePassword(alice.user.id, { currentPassword: 'wrong-password', newPassword: 'new-password-12345' }), status(401));
    await f.store.changePassword(alice.user.id, { currentPassword: PASSWORD, newPassword: 'new-password-12345' });
    assert.equal(f.store.session(alice.sessionToken), null);
    await assert.rejects(f.store.login({ username: 'alice', password: PASSWORD }), status(401));
    const third = await f.store.login({ username: 'alice', password: 'new-password-12345' });
    time = third.expiresAt;
    assert.equal(f.store.session(third.sessionToken), null);
    assert.equal(createAccountStore(f.file, { now: () => time }).session(third.sessionToken), null);
  } finally { f.dispose(); }
});

test('recovery codes rotate, revoke sessions, reject replay and preserve private data', async () => {
  const f = fixture();
  try {
    const alice = await f.store.register({ username: 'alice', password: PASSWORD });
    f.store.putConversation(alice.user.id, 'private-chat-0001', { conversation: conversation(), revision: 0 });
    await assert.rejects(f.store.recover({ username: 'alice', recoveryCode: 'wrong-code', newPassword: 'reset-password-1234' }), status(401));
    const recovered = await createAccountStore(f.file).recover({ username: 'ALICE', recoveryCode: alice.recoveryCode, newPassword: 'reset-password-1234' });
    assert.notEqual(recovered.recoveryCode, alice.recoveryCode);
    const restarted = createAccountStore(f.file);
    assert.equal(restarted.session(alice.sessionToken), null);
    await assert.rejects(restarted.recover({ username: 'alice', recoveryCode: alice.recoveryCode, newPassword: PASSWORD }), status(401));
    assert.equal((await restarted.login({ username: 'alice', password: 'reset-password-1234' })).user.id, alice.user.id);
    assert.equal(restarted.listConversations(alice.user.id).conversations.length, 1);
    assert.equal(readFileSync(f.file, 'utf8').includes(recovered.recoveryCode), false);
  } finally { f.dispose(); }
});

test('private conversations and projects isolate owners even when identifiers coincide', async () => {
  const f = fixture();
  try {
    const [alice, bob] = await users(f.store);
    f.store.putConversation(alice.user.id, 'private-chat-0001', { conversation: conversation(), revision: 0 });
    assert.deepEqual(f.store.listConversations(bob.user.id).conversations, []);
    assert.throws(() => f.store.deleteConversation(bob.user.id, 'private-chat-0001', 1), status(404));
    f.store.putConversation(bob.user.id, 'private-chat-0001', { conversation: conversation('private-chat-0001', { title: 'Bob专用' }), revision: 0 });
    assert.equal(f.store.listConversations(alice.user.id).conversations[0].conversation.title, '私有资料');
    assert.equal(f.store.listConversations(bob.user.id).conversations[0].conversation.title, 'Bob专用');
    f.store.putProjects(alice.user.id, { projects: projects('Alice项目'), revision: 0 });
    f.store.putProjects(bob.user.id, { projects: projects('Bob项目'), revision: 0 });
    assert.equal(createAccountStore(f.file).getProjects(alice.user.id).projects.projects[0].name, 'Alice项目');
    assert.equal(createAccountStore(f.file).getProjects(bob.user.id).projects.projects[0].name, 'Bob项目');
    assert.throws(() => f.store.getProjects('../../accounts'), status(401));
    assert.equal(readdirSync(`${f.file}.workspaces`).length, 2);
  } finally { f.dispose(); }
});

test('optimistic revisions reject stale writes and tombstones prevent deleted conversations reappearing', async () => {
  const f = fixture();
  try {
    const alice = await f.store.register({ username: 'alice', password: PASSWORD }), id = alice.user.id;
    assert.equal(f.store.putConversation(id, 'private-chat-0001', { conversation: conversation(), revision: 0 }).revision, 1);
    assert.throws(() => f.store.putConversation(id, 'private-chat-0001', { conversation: conversation(), revision: 0 }), status(409));
    assert.equal(f.store.putConversation(id, 'private-chat-0001', { conversation: conversation(), revision: 1 }).revision, 2);
    assert.throws(() => f.store.deleteConversation(id, 'private-chat-0001', 1), status(409));
    f.store.putProjects(id, { projects: { ...projects(), links: [{ conversationId: 'private-chat-0001', projectId: 'project-private-0001' }] }, revision: 0 });
    assert.throws(() => f.store.putProjects(id, { projects: projects(), revision: 0 }), status(409));
    const deleted = f.store.deleteConversation(id, 'private-chat-0001', 2);
    assert.equal(deleted.revision, 3); assert.equal(deleted.projectsRevision, 2);
    assert.equal(f.store.listConversations(id).conversations.length, 0); assert.equal(f.store.getProjects(id).projects.links.length, 0);
    assert.throws(() => createAccountStore(f.file).putConversation(id, 'private-chat-0001', { conversation: conversation(), revision: 0 }), status(409));
    assert.throws(() => f.store.putConversation(id, 'private-chat-0001', { conversation: conversation(), revision: 3 }), status(409));
  } finally { f.dispose(); }
});

test('private data validation rejects invalid payloads without changing the last saved workspace', async () => {
  const f = fixture();
  try {
    const alice = await f.store.register({ username: 'alice', password: PASSWORD }), id = alice.user.id;
    f.store.putConversation(id, 'private-chat-0001', { conversation: conversation(), revision: 0 });
    const file = join(`${f.file}.workspaces`, `${id}.json`), before = readFileSync(file, 'utf8');
    for (const body of [
      { conversation: conversation('different-chat-001'), revision: 1 },
      { conversation: conversation('private-chat-0001', { messages: [{ role: 'system', content: 'override' }] }), revision: 1 },
      { conversation: conversation(), revision: -1 },
      { conversation: conversation('private-chat-0001', { messages: [{ role: 'user', content: 'x'.repeat(256001) }] }), revision: 1 },
    ]) assert.throws(() => f.store.putConversation(id, 'private-chat-0001', body));
    assert.throws(() => f.store.putProjects(id, { projects: { version: 1, projects: [], links: [{ conversationId: 'private-chat-0001', projectId: 'nonexistent' }] }, revision: 0 }), status(400));
    assert.equal(readFileSync(file, 'utf8'), before);
    assert.throws(() => normalizeConversation(conversation()), /messages/);
    assert.equal(normalizeConversation(conversation(), Date.now(), { allowEmpty: true }).messages.length, 0);
    writeFileSync(f.file, '{broken', 'utf8');
    assert.throws(() => createAccountStore(f.file)); assert.equal(readFileSync(f.file, 'utf8'), '{broken');
  } finally { f.dispose(); }
});

test('workspace conversation quota rejects excess data and deletion frees active capacity', async () => {
  const f = fixture();
  try {
    const alice = await f.store.register({ username: 'alice', password: PASSWORD }), id = alice.user.id;
    f.store.putConversation(id, 'private-chat-0001', { conversation: conversation(), revision: 0 });
    const file = join(`${f.file}.workspaces`, `${id}.json`), snapshot = JSON.parse(readFileSync(file, 'utf8'));
    snapshot.conversations = Array.from({ length: f.store.limits.maxConversations }, (_, index) => {
      const chatId = `private-chat-${String(index).padStart(8, '0')}`;
      return { id: chatId, revision: 1, conversation: conversation(chatId) };
    });
    writeFileSync(file, JSON.stringify(snapshot), 'utf8'); const before = readFileSync(file, 'utf8');
    assert.throws(() => f.store.putConversation(id, 'new-private-chat-001', { conversation: conversation('new-private-chat-001'), revision: 0 }), status(413));
    assert.equal(readFileSync(file, 'utf8'), before);
    f.store.deleteConversation(id, snapshot.conversations[0].id, 1);
    assert.equal(f.store.putConversation(id, 'new-private-chat-001', { conversation: conversation('new-private-chat-001'), revision: 0 }).revision, 1);
    assert.equal(f.store.listConversations(id).conversations.length, f.store.limits.maxConversations);
  } finally { f.dispose(); }
});

async function httpFixture(options = {}) {
  const f = fixture();
  const config = { nodeEnv: 'test', trustProxy: false, gatewayAccessToken: INVITATION, ...options };
  const routes = createAccountRoutes({ store: f.store, config,
    async readJson(request, maximum) {
      if (!request.headers['content-type']?.startsWith('application/json')) throw Object.assign(Error('Expected JSON'), { statusCode: 415 });
      let text = ''; for await (const chunk of request) { text += chunk; if (Buffer.byteLength(text) > maximum) throw Object.assign(Error('Too large'), { statusCode: 413 }); }
      return JSON.parse(text);
    },
    sendJson(response, status, payload, headers) { response.writeHead(status, { 'content-type': 'application/json', ...headers }); response.end(JSON.stringify(payload)); },
  });
  const server = createServer(async (request, response) => {
    if (!await routes.handle(request, response, new URL(request.url, 'http://localhost'))) { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { ...f, routes, origin,
    async request(path, { method = 'GET', body, headers = {}, cookie, accountId, noGuard = false } = {}) {
      const response = await fetch(`${origin}/api/account${path}`, { method, headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(!noGuard && method !== 'GET' ? { origin, 'x-plaude-client': '1' } : {}),
        ...(cookie ? { cookie } : {}), ...(accountId ? { 'x-plaude-account-id': accountId } : {}), ...headers,
      }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie'), headers: response.headers };
    },
    async dispose() { await new Promise(resolve => server.close(resolve)); f.dispose(); },
  };
}
const registerBody = { username: 'alice', password: PASSWORD, displayName: '账户A' };

test('private writing persists independently, isolates owners and rejects stale changes and resurrection',async()=>{
  const f=fixture();try{
    const alice=await f.store.register({username:'writer-a',password:PASSWORD}),bob=await f.store.register({username:'writer-b',password:PASSWORD});
    const id='writing-fixture-0001',note={id,title:'独立文稿',text:'正文 <script>inert</script>'};
    assert.deepEqual(f.store.listWriting(alice.user.id).notes,[]);
    const saved=f.store.putWriting(alice.user.id,id,{note,revision:0});assert.equal(saved.note.revision,1);
    assert.deepEqual(f.store.listWriting(bob.user.id).notes,[]);assert.equal(createAccountStore(f.file).listWriting(alice.user.id).notes[0].text,note.text);
    const file=f.file+'.writing/'+alice.user.id+'.json',before=readFileSync(file,'utf8');
    assert.throws(()=>f.store.putWriting(alice.user.id,id,{note:{...note,text:'stale'},revision:0}),status(409));assert.equal(readFileSync(file,'utf8'),before);
    assert.throws(()=>f.store.deleteWriting(alice.user.id,id,0),status(409));assert.equal(readFileSync(file,'utf8'),before);
    f.store.deleteWriting(alice.user.id,id,1);assert.equal(f.store.listWriting(alice.user.id).deleted[0].revision,2);
    assert.throws(()=>f.store.putWriting(alice.user.id,id,{note,revision:0}),status(409));
    assert.throws(()=>f.store.putWriting(alice.user.id,id,{note:{...note,id:'another-note'},revision:2}),status(400));
    assert.deepEqual(f.store.listConversations(alice.user.id).conversations,[]);
  }finally{f.dispose();}
});

test('writing capacity, bad inputs and corrupt storage preserve previous bytes',async()=>{
  const f=fixture();try{const {user}=await f.store.register({username:'writer-limit',password:PASSWORD});
    for(let i=0;i<50;i++){const id='writing-limit-'+String(i).padStart(4,'0');f.store.putWriting(user.id,id,{note:{id,title:'文稿'+i,text:'正文'},revision:0});}
    const file=f.file+'.writing/'+user.id+'.json',before=readFileSync(file,'utf8');
    assert.throws(()=>f.store.putWriting(user.id,'writing-limit-extra',{note:{id:'writing-limit-extra',title:'extra',text:'正文'},revision:0}),status(413));
    assert.throws(()=>f.store.putWriting(user.id,'writing-limit-0000',{note:{id:'writing-limit-0000',title:'bad',text:'x'.repeat(256001)},revision:1}),status(400));
    assert.equal(readFileSync(file,'utf8'),before);
    writeFileSync(file,'{broken');assert.throws(()=>createAccountStore(f.file).listWriting(user.id));assert.equal(readFileSync(file,'utf8'),'{broken');
  }finally{f.dispose();}
});

test('writing HTTP guards sessions, CSRF and stale account headers on every read and mutation',async()=>{
  const f=await httpFixture();try{
    const registered=await f.request('/register',{method:'POST',headers:{authorization:'Bearer '+INVITATION},body:registerBody});const cookie=registered.cookie,accountId=registered.body.user.id;
    const id='writing-http-0001',note={id,title:'HTTP文稿',text:'完整正文'};
    assert.equal((await f.request('/writing-notes')).status,401);
    assert.equal((await f.request('/writing-notes',{cookie,accountId:'wrong-owner'})).status,403);
    assert.equal((await f.request('/writing-notes/'+id,{method:'PUT',cookie,accountId,noGuard:true,body:{note,revision:0}})).status,403);
    const saved=await f.request('/writing-notes/'+id,{method:'PUT',cookie,accountId,body:{note,revision:0}});assert.equal(saved.status,200);assert.equal(saved.body.userId,accountId);
    assert.equal((await f.request('/writing-notes',{cookie,accountId})).body.notes[0].text,note.text);
    assert.equal((await f.request('/writing-notes/'+id,{method:'PUT',cookie,accountId,body:{note,revision:0}})).status,409);
    assert.equal((await f.request('/writing-notes/'+id,{method:'DELETE',cookie,accountId,body:{revision:1}})).status,200);
    assert.equal((await f.request('/writing-notes',{cookie,accountId})).body.notes.length,0);
  }finally{await f.dispose();}
});

test('device management isolates owners, preserves the current login and private data, and survives restart', async () => {
  let time = Date.now(); const f = fixture({ now: () => time });
  try {
    const [alice, bob] = await users(f.store);
    const second = await f.store.login({username: 'alice', password: PASSWORD}, {userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/140.0 Edg/140.0'});
    const third = await f.store.login({username: 'alice', password: PASSWORD}, {userAgent: 'Mozilla/5.0 (iPhone) Safari/605.1 private-raw-agent'});
    f.store.putConversation(alice.user.id, 'private-chat-0001', {conversation: conversation(), revision: 0});
    const disk = JSON.parse(readFileSync(f.file, 'utf8'));
    delete disk.sessions.find(s => s.userId === alice.user.id).device;
    writeFileSync(f.file, JSON.stringify(disk)); const before = readFileSync(f.file, 'utf8');
    const restarted = createAccountStore(f.file, {now: () => time});
    const listing = restarted.listSessions(alice.user.id, alice.sessionToken);
    assert.equal(readFileSync(f.file, 'utf8'), before, 'GET must not rewrite legacy metadata');
    assert.equal(listing.sessions.length, 3); assert.equal(listing.sessions.filter(s => s.current).length, 1);
    assert.ok(listing.sessions.some(s => s.device === 'Edge · Windows'));
    assert.ok(listing.sessions.some(s => s.device === '旧登录 · 设备未识别'));
    const serialized = JSON.stringify(listing);
    for (const secret of [alice.sessionToken, third.sessionToken, disk.sessions[0].digest, 'private-raw-agent', bob.user.id]) assert.equal(serialized.includes(secret), false);
    const own = listing.sessions.find(s => s.current), other = listing.sessions.find(s => s.device === 'Edge · Windows');
    assert.throws(() => restarted.revokeSession(alice.user.id, alice.sessionToken, own.id), status(409));
    assert.throws(() => restarted.revokeSession(bob.user.id, bob.sessionToken, other.id), status(404));
    assert.throws(() => restarted.listSessions(bob.user.id, alice.sessionToken), status(401));
    restarted.revokeSession(alice.user.id, alice.sessionToken, other.id);
    assert.equal(createAccountStore(f.file).session(second.sessionToken), null);
    assert.equal(restarted.revokeOtherSessions(alice.user.id, alice.sessionToken).revoked, 1);
    assert.ok(restarted.session(alice.sessionToken)); assert.ok(restarted.session(bob.sessionToken)); assert.equal(restarted.session(third.sessionToken), null);
    assert.equal(restarted.listConversations(alice.user.id).conversations.length, 1);
    time = alice.expiresAt;
    assert.throws(() => restarted.listSessions(alice.user.id, alice.sessionToken), status(401));
  } finally { f.dispose(); }
});

test('device HTTP APIs require same-origin and current account identity; revoked cookies immediately lose private access', async () => {
  const f = await httpFixture();
  try {
    const created = await f.request('/register', {method: 'POST', body: registerBody, headers: {authorization: `Bearer ${INVITATION}`}});
    const cookie = created.cookie.split(';')[0], accountId = created.body.user.id;
    const second = await f.request('/login', {method: 'POST', body: registerBody});
    const bob = await f.store.register({username: 'bob', password: PASSWORD});
    assert.equal((await f.request('/sessions', {cookie})).status, 403);
    assert.equal((await f.request('/sessions', {cookie, accountId, headers: {origin: 'https://evil.example'}})).status, 403);
    const listing = await f.request('/sessions', {cookie, accountId});
    assert.equal(listing.headers.get('cache-control'), 'no-store'); assert.equal(listing.body.sessions.length, 2);
    const sessionId = listing.body.sessions.find(s => !s.current).id;
    assert.equal((await f.request('/sessions/revoke', {method: 'POST', cookie, accountId, body: {sessionId}, noGuard: true})).status, 403);
    assert.equal((await f.request('/sessions/revoke', {method: 'POST', cookie, accountId: bob.user.id, body: {sessionId}})).status, 403);
    assert.equal((await f.request('/sessions/revoke', {method: 'POST', cookie: `plaude_session=${bob.sessionToken}`, accountId: bob.user.id, body: {sessionId}})).status, 404);
    assert.equal((await f.request('/sessions/revoke-others', {method: 'POST', cookie, accountId, body: {ownerId: bob.user.id}})).status, 400);
    assert.equal((await f.request('/sessions/revoke', {method: 'POST', cookie, accountId, body: {sessionId}})).body.revoked, 1);
    assert.equal((await f.request('/conversations', {cookie: second.cookie.split(';')[0], accountId})).status, 401);
    assert.equal((await f.request('/sessions/revoke-others', {method: 'POST', cookie, accountId, body: {}})).body.revoked, 0);
    assert.equal((await f.request('/session', {cookie})).body.user.id, accountId);
  } finally { await f.dispose(); }
});

test('account HTTP requires invite and same-origin custom header, returns protected cookies and no secret hashes', async () => {
  const f = await httpFixture();
  try {
    assert.deepEqual((await f.request('/session')).body, { enabled: true, user: null });
    assert.equal((await f.request('/register', { method: 'POST', body: registerBody })).status, 403);
    assert.equal((await f.request('/register', { method: 'POST', body: registerBody, noGuard: true, headers: { authorization: `Bearer ${INVITATION}` } })).status, 403);
    assert.equal((await f.request('/register', { method: 'POST', body: registerBody, headers: { origin: 'https://evil.example', authorization: `Bearer ${INVITATION}` } })).status, 403);
    const created = await f.request('/register', { method: 'POST', body: registerBody, headers: { authorization: `Bearer ${INVITATION}` } });
    assert.equal(created.status, 201); assert.match(created.cookie, /HttpOnly; SameSite=Strict/); assert.equal(created.body.recoveryCode.length, 43);
    assert.equal(JSON.stringify(created.body).includes(PASSWORD), false); assert.equal(Object.hasOwn(created.body, 'sessionToken'), false);
    const cookie = created.cookie.split(';')[0], accountId = created.body.user.id;
    assert.equal((await f.request('/session', { cookie })).body.user.id, accountId);
    assert.equal((await f.request('/conversations', { cookie, accountId })).status, 200);
    assert.equal((await f.request('/conversations', { cookie })).status, 403);
    assert.equal((await f.request('/conversations', { headers: { authorization: `Bearer ${INVITATION}`, 'x-plaude-account-id': accountId } })).status, 401);
    assert.equal((await f.request('/session', { cookie, headers: { origin: 'https://evil.example' } })).status, 403);
    assert.equal((await f.request('/logout', { method: 'POST', cookie, body: {}, headers: { 'x-plaude-client': '' } })).status, 403);
    const loggedOut = await f.request('/logout', { method: 'POST', cookie, accountId, body: {} });
    assert.equal(loggedOut.status, 200); assert.match(loggedOut.cookie, /Max-Age=0/);
    assert.equal((await f.request('/session', { cookie })).body.user, null);
  } finally { await f.dispose(); }
});

test('private HTTP rejects forged owners and stale-tab cookie switches on reads and writes', async () => {
  const f = await httpFixture();
  try {
    const [alice, bob] = await users(f.store), cookie = `plaude_session=${alice.sessionToken}`, accountId = alice.user.id;
    const path = '/conversations/private-chat-0001', body = { conversation: conversation(), revision: 0 };
    assert.equal((await f.request(path, { method: 'PUT', cookie, accountId, body: { ...body, ownerId: bob.user.id } })).status, 400);
    assert.equal((await f.request(path, { method: 'PUT', cookie, accountId: bob.user.id, body })).status, 403);
    assert.equal((await f.request('/conversations', { cookie, accountId: bob.user.id })).status, 403);
    const saved = await f.request(path, { method: 'PUT', cookie, accountId, body });
    assert.equal(saved.status, 200); assert.equal(saved.body.userId, accountId); assert.equal(saved.body.revision, 1);
    assert.equal((await f.request(path, { method: 'PUT', cookie, accountId, body })).status, 409);
    assert.equal((await f.request('/conversations', { cookie: `plaude_session=${bob.sessionToken}`, accountId: bob.user.id })).body.conversations.length, 0);
    assert.equal((await f.request('/projects', { method: 'PUT', cookie, accountId, body: { projects: projects(), revision: 0 } })).status, 200);
    assert.equal((await f.request('/projects', { cookie, accountId: bob.user.id })).status, 403);
    assert.equal((await f.request(path, { method: 'DELETE', cookie, accountId, body: { revision: 1 } })).status, 200);
    assert.equal((await f.request('/conversations', { cookie, accountId })).body.conversations.length, 0);
  } finally { await f.dispose(); }
});

test('production account cookies use __Host Secure and honor forwarded origin only with trusted proxy', async () => {
  const f = await httpFixture({ nodeEnv: 'production', trustProxy: true });
  try {
    const headers = { origin: 'https://chat.example', 'x-forwarded-host': 'chat.example', 'x-forwarded-proto': 'https', authorization: `Bearer ${INVITATION}` };
    const created = await f.request('/register', { method: 'POST', body: registerBody, headers });
    assert.equal(created.status, 201); assert.match(created.cookie, /^__Host-plaude_session=/); assert.match(created.cookie, /; Secure/); assert.equal(created.cookie.includes('Domain='), false);
    assert.equal((await f.request('/login', { method: 'POST', body: registerBody, headers: { ...headers, 'x-forwarded-proto': 'http' } })).status, 403);
  } finally { await f.dispose(); }
});

test('HTTP recovery is origin protected, rotates codes and password route revokes all sessions', async () => {
  const f = await httpFixture();
  try {
    const alice = await f.store.register(registerBody), cookie = `plaude_session=${alice.sessionToken}`, accountId = alice.user.id;
    const recoveryBody = { username: 'alice', recoveryCode: alice.recoveryCode, newPassword: 'new-private-password-123' };
    assert.equal((await f.request('/recover', { method: 'POST', body: recoveryBody, noGuard: true })).status, 403);
    const result = await f.request('/recover', { method: 'POST', body: recoveryBody });
    assert.equal(result.status, 200); assert.notEqual(result.body.recoveryCode, alice.recoveryCode); assert.equal(result.body.user, null);
    assert.equal(f.store.session(alice.sessionToken), null);
    const login = await f.request('/login', { method: 'POST', body: { username: 'alice', password: recoveryBody.newPassword } });
    assert.equal(login.status, 200);
    const changed = await f.request('/password', { method: 'POST', cookie: login.cookie.split(';')[0], accountId,
      body: { currentPassword: recoveryBody.newPassword, newPassword: PASSWORD } });
    assert.equal(changed.status, 200); assert.equal((await f.request('/session', { cookie: login.cookie.split(';')[0] })).body.user, null);
    assert.equal((await f.request('/conversations', { cookie, accountId })).status, 401);
  } finally { await f.dispose(); }
});

test('HTTP login throttles repeated generic failures', async () => {
  const f = await httpFixture();
  try {
    for (let i = 0; i < 10; i += 1) {
      const response = await f.request('/login', { method: 'POST', body: { username: 'unknown-user', password: PASSWORD } });
      assert.equal(response.status, 401); assert.equal(response.body.error, '用户名或密码错误。');
    }
    const response = await f.request('/login', { method: 'POST', body: { username: 'unknown-user', password: PASSWORD } });
    assert.equal(response.status, 429); assert.equal(response.headers.get('retry-after'), '900');
  } finally { await f.dispose(); }
});
