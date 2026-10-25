import { configureStorageScope, globalStorage } from './scoped_storage.js';

export let accountUser = null;
export let accountsEnabled = false;
export let accountAdministration=null;
export const accountReady = (async () => {
  const response = await fetch('/api/account/session', {cache: 'no-store', credentials: 'same-origin'});
  if (response.status === 404) { configureStorageScope(null); return; }
  if (!response.ok) throw Error('无法确认登录状态，请刷新重试。');
  const data = await response.json(); accountsEnabled = data.enabled === true; accountUser = data.user || null;accountAdministration=data.administration||null;
  configureStorageScope(accountUser?.id || null);
})();
try { await accountReady; } catch {
  document.body.replaceChildren();
  const message = document.createElement('p'); message.textContent = '暂时无法确认账户状态。为保护资料，尚未加载聊天。请检查连接后刷新。';
  const retry = document.createElement('button'); retry.textContent = '重新连接'; retry.onclick = () => location.reload();
  document.body.append(message, retry); throw Error('Account initialization failed');
}
export function accountHeaders() { return accountUser ? {'x-plaude-client': '1', 'x-plaude-account-id': accountUser.id} : {}; }
let changingIdentity = false;
export function identityChanged() {
  if (changingIdentity) return;
  changingIdentity = true;
  document.querySelector('.app-shell')?.setAttribute('inert', '');
  document.documentElement.style.visibility = 'hidden';
  location.reload();
}
const identityNoticeKey = 'plaude-account-change-v1';
let channel;
try { if (typeof BroadcastChannel === 'function') channel = new BroadcastChannel('plaude-account-change'); } catch {}
channel?.addEventListener('message', identityChanged);
window.addEventListener('storage', event => { if (event.key === identityNoticeKey && event.newValue) identityChanged(); });
window.addEventListener('pageshow', event => { if (event.persisted) identityChanged(); });
function notifyIdentityChanged() {
  // A storage notice also reaches browsers without BroadcastChannel support.
  try { globalStorage.setItem(identityNoticeKey, crypto.randomUUID()); } catch {}
  channel?.postMessage('changed');
}

export function initAccountUI({busy, importLocal, resolveConflicts, syncNow, beforeChange}) {
  const button = document.createElement('button'); button.type = 'button'; button.id = 'open-account'; button.className = 'new-chat-button account-button';
  button.textContent = accountUser ? `个人账户 · ${accountUser.displayName}` : '登录 / 创建个人账户';
  document.querySelector('#open-projects').after(button);
  const stateLine = document.createElement('p'); stateLine.id = 'account-sync-state'; stateLine.className = 'account-sync-state';
  stateLine.textContent = accountUser ? '个人私有空间 · 正在连接云端' : '未登录 · 新聊天仅保存在此浏览器';
  button.after(stateLine);
  const dialog = document.createElement('dialog'); dialog.id = 'account-dialog'; dialog.className = 'settings-dialog account-dialog';
  dialog.innerHTML = `<div class="dialog-card"><div class="dialog-heading"><h2>个人账户与私有空间</h2><button class="icon-button" type="button" id="account-close" aria-label="关闭账户">×</button></div><p id="account-description"></p><form id="account-form"><label for="account-action">操作</label><select id="account-action"><option value="login">登录</option><option value="register">创建账户</option><option value="recover">使用恢复码重设密码</option></select><label for="account-username">用户名</label><input id="account-username" autocomplete="username" minlength="3" maxlength="32" required placeholder="3–32 位英文字母、数字、点、横线或下划线"><div id="account-register-fields" hidden><label for="account-display">显示名称</label><input id="account-display" maxlength="60" placeholder="可使用中文"><label for="account-invite">邀请码（原网站访问口令）</label><input id="account-invite" type="password" autocomplete="off"></div><div id="account-recovery-fields" hidden><label for="account-recovery">恢复码</label><input id="account-recovery" autocomplete="off"></div><label for="account-password">密码</label><input id="account-password" type="password" autocomplete="current-password" maxlength="128" required><p>创建或重设密码至少 12 个字符。账户资料默认私有，旧公共聊天不会自动转成私有。</p><button class="primary-button" type="submit">继续</button></form><div id="account-manage" hidden><button class="secondary-button" type="button" id="account-import-local">复制本机旧聊天到个人空间</button><button class="secondary-button" type="button" id="account-conflicts">处理同步冲突</button><details><summary>修改密码</summary><form id="account-password-form"><label for="account-old-password">当前密码</label><input id="account-old-password" type="password" autocomplete="current-password" required><label for="account-new-password">新密码</label><input id="account-new-password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required><button class="secondary-button" type="submit">修改并退出全部设备</button></form></details><button class="secondary-button" type="button" id="account-logout">退出登录</button><p>退出后隐藏此账户的聊天、项目、图片草稿与运行历史。本机旧公共记录仍保留。请在共用设备上退出账户。</p></div><div id="account-recovery-result" hidden><strong>请立即保存恢复码</strong><p>忘记密码时凭用户名和此码恢复账户。请保存在自己的密码管理器中。</p><pre id="account-recovery-code"></pre><button class="primary-button" id="account-recovery-done" type="button">我已保存，进入个人空间</button></div><p id="account-status" role="status" aria-live="polite"></p></div>`;
  document.body.append(dialog);
  const $ = id => dialog.querySelector('#account-' + id);
  const syncButton = document.createElement('button'); syncButton.id = 'account-sync-now'; syncButton.type = 'button'; syncButton.className = 'secondary-button'; syncButton.textContent = '立即同步聊天';
  $('manage').prepend(syncButton);
  const devices = document.createElement('details'); devices.id = 'account-devices';
  devices.innerHTML = '<summary>登录设备</summary><p>显示仍有效的登录。退出设备会使其后续请求失效，不删除聊天或项目。设备名称根据浏览器识别，仅供参考。</p><div class="project-actions"><button class="secondary-button" type="button" id="account-devices-refresh">刷新设备列表</button><button class="secondary-button" type="button" id="account-devices-others">退出其他设备</button></div><div id="account-devices-list"></div>';
  $('logout').before(devices);
  $('description').textContent = accountUser ? `当前账户：${accountUser.displayName}（${accountUser.username}）。聊天和项目仅此账户可见，可在手机与电脑登录同一账户继续。` : '登录后，聊天与项目私有保存到服务器。注册需要原网站访问口令作为邀请码。';
  $('form').hidden = Boolean(accountUser); $('manage').hidden = !accountUser;
  if (!accountsEnabled) { button.disabled = true; stateLine.textContent = '本机模式 · 账户服务尚未启用'; }
  let working = false;
  const readyToChange = () => {
    const codeRunning = document.querySelector('#code-stop') && !document.querySelector('#code-stop').disabled;
    const projectWorking = Boolean(document.querySelector('#project-dialog[aria-busy="true"]'));
    if (busy() || codeRunning || projectWorking) throw Error('请先等待所有回复、代码运行和项目保存结束，或停止后再切换账户。');
    beforeChange?.();
  };
  const reload = () => { notifyIdentityChanged(); identityChanged(); };
  async function action(fn) {
    if (working) return; working = true;
    const controls = [...dialog.querySelectorAll('button')]; controls.forEach(b => b.disabled = true);
    try { await fn(); } catch (e) { $('status').textContent = e.message; }
    finally { working = false; controls.forEach(b => b.disabled = false); }
  }
  async function request(path, body, extraHeaders = {}, method = 'POST') {
    if (!window.isSecureContext) throw Error('请通过 HTTPS 打开网站后操作账户。');
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch('/api/account/' + path, {method, credentials: 'same-origin', cache: 'no-store', signal: controller.signal, headers: {'content-type': 'application/json', 'x-plaude-client': '1', ...accountHeaders(), ...extraHeaders}, ...(method === 'GET' ? {} : {body: JSON.stringify(body)})});
      const data = await response.json().catch(e => { if (controller.signal.aborted) throw e; return {}; });
      if (accountUser && [401,403].includes(response.status)) identityChanged();
      if (!response.ok) throw Error(data.error || '账户操作失败，请稍后重试。');
      if (data.userId && data.userId !== accountUser?.id) throw Error('账户身份不匹配，请刷新重试。');
      return data;
    } catch (e) { if (controller.signal.aborted) throw Error('账户请求超时，请重新连接后重试。'); throw e; }
    finally { clearTimeout(timeout); }
  }
  async function refreshDevices() {
    const data = await request('sessions', undefined, {}, 'GET');
    if (!Array.isArray(data.sessions) || data.userId !== accountUser?.id) throw Error('登录设备列表无效，请重试。');
    $('devices-list').replaceChildren();
    for (const session of data.sessions) {
      const row = document.createElement('div'); row.className = 'account-device';
      const description = document.createElement('p');
      description.textContent = `${session.device}${session.current ? '（当前登录）' : ''}；登录：${new Date(session.createdAt).toLocaleString()}；到期：${new Date(session.expiresAt).toLocaleString()}`;
      row.append(description);
      if (!session.current) {
        const revoke = document.createElement('button'); revoke.type = 'button'; revoke.className = 'secondary-button'; revoke.textContent = '退出此设备';
        revoke.onclick = () => void action(async () => {
          if (!confirm(`退出“${session.device}”的这次登录？该设备后续需要重新登录。`)) return;
          await request('sessions/revoke', {sessionId: session.id}); await refreshDevices(); $('status').textContent = '此设备的登录已退出，云端资料保留。';
        }); row.append(revoke);
      }
      $('devices-list').append(row);
    }
  }
  function recoverResult(data) {
    if (!data.recoveryCode) return reload();
    notifyIdentityChanged(); $('form').hidden = true; $('recovery-result').hidden = false; $('recovery-code').textContent = data.recoveryCode;
    if (!data.user) { $('recovery-done').textContent = '我已保存，返回登录'; $('status').textContent = data.message || '请用新密码重新登录。'; }
  }
  button.onclick = () => { $('status').textContent = ''; dialog.showModal(); };
  $('close').onclick = () => { if (!working) { if (!$('recovery-result').hidden) reload(); else dialog.close(); } };
  dialog.addEventListener('cancel', e => { if (working || !$('recovery-result').hidden) e.preventDefault(); });
  $('action').onchange = () => { const mode = $('action').value; $('register-fields').hidden = mode !== 'register'; $('recovery-fields').hidden = mode !== 'recover'; $('password').autocomplete = mode === 'login' ? 'current-password' : 'new-password'; $('password').minLength = mode === 'login' ? 1 : 12; };
  $('form').onsubmit = e => { e.preventDefault(); void action(async () => {
    readyToChange(); const mode = $('action').value;
    let invite = '';
    if (mode === 'register') {
      invite = $('invite').value.trim();
      if (!invite) { try { invite = globalStorage.getItem('yunjian-ai-gateway-token') || ''; } catch {} }
      if (!invite) throw Error('创建账户需要邀请码。请在“邀请码”中手动填写原网站访问口令；浏览器无法读取已保存的邀请码时也可直接填写。');
    }
    const data = await request(mode, {username: $('username').value, password: $('password').value, newPassword: $('password').value, displayName: $('display').value, recoveryCode: $('recovery').value}, mode === 'register' ? {authorization: `Bearer ${invite}`} : {});
    $('password').value = ''; $('invite').value = ''; $('recovery').value = ''; recoverResult(data);
  }); };
  $('recovery-done').onclick = reload;
  $('logout').onclick = () => void action(async () => { readyToChange(); await request('logout', {}); reload(); });
  $('password-form').onsubmit = e => { e.preventDefault(); void action(async () => { readyToChange(); await request('password', {currentPassword: $('old-password').value, newPassword: $('new-password').value}); reload(); }); };
  $('import-local').onclick = () => void action(async () => { readyToChange(); $('status').textContent = await importLocal(); });
  $('conflicts').onclick = () => void action(async () => { readyToChange(); $('status').textContent = await resolveConflicts(); });
  syncButton.onclick = () => void action(async () => { $('status').textContent = await syncNow(); });
  $('devices-refresh').onclick = () => void action(refreshDevices);
  devices.addEventListener('toggle', () => { if (devices.open) void action(refreshDevices); });
  $('devices-others').onclick = () => void action(async () => {
    if (!confirm('退出当前账户的其他所有登录？当前登录保持，云端聊天和项目保留。')) return;
    const data = await request('sessions/revoke-others', {}); await refreshDevices(); $('status').textContent = `已退出 ${data.revoked} 个其他登录，当前登录保持。`;
  });
  return { setStatus(text) { stateLine.textContent = text; }, open() { button.click(); } };
}
