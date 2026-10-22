import { scopedStorage } from './scoped_storage.js';
import { parseDocument, formatDocument } from './documents.js';
import {pdfCoverage} from './pdf_coverage.js';
import { parseModelParameterJson } from './workbench_tools.js';

const PREFS_KEY = 'yunjian-ai-workspace-v1';
export function workspacePreferences() {
  try { return JSON.parse(scopedStorage.getItem(PREFS_KEY) || '{}'); } catch { return {}; }
}
const categories = [
  ['connections', '◫', '模型连接', 'API 与平台'], ['parameters', '◇', '模型参数', '输出与采样'],
  ['custom', '+', '自定义服务', '兼容端点'], ['general', '◎', '通用与服务', '联网与代理'],
  ['appearance', 'Aa', '外观与预设', '字体和提示词'], ['files', '▤', '文件解析', 'OCR 与文档'],
];
const connectionFields = `<div class="ws-grid"><label>服务商名称<input data-connection="label" maxlength="80"></label><label>API 协议<select data-connection="protocol"><option value="chat-completions">Chat Completions</option><option value="responses">Responses</option></select></label></div>
  <label>API 请求地址<input data-connection="apiUrl" type="url" placeholder="https://…/v1/chat/completions"></label>
  <label>API 密钥<input data-connection="apiKey" type="password" autocomplete="new-password" maxlength="4096" placeholder="留空保留已配置密钥"></label>
  <div class="ws-grid"><label>默认模型 ID<input data-connection="model" maxlength="192"></label><label>密钥状态<span id="ws-key-state" class="ws-value"></span></label></div>
  <label>可选模型 ID（每行一个，最多 24 个）<textarea data-connection="models" rows="4" spellcheck="false"></textarea></label>`;
export function initWorkspace(callbacks) {
  const dialog = document.createElement('dialog');
  dialog.id = 'workspace-dialog'; dialog.className = 'workspace-dialog';
  dialog.setAttribute('aria-labelledby', 'workspace-title');
  dialog.innerHTML = `<header class="ws-heading"><div><span class="dialog-kicker">工作区偏好</span><h2 id="workspace-title">设置中心</h2><p>管理模型、连接、工具与界面偏好</p></div><button class="icon-button" id="ws-close" aria-label="关闭设置中心" type="button">×</button></header>
    <div class="ws-body"><nav class="ws-nav" aria-label="设置分类">${categories.map(([id, icon, title, subtitle]) => `<button type="button" data-section="${id}"><span class="ws-nav-icon" aria-hidden="true">${icon}</span><span><strong>${title}</strong><small>${subtitle}</small></span></button>`).join('')}</nav>
    <div class="ws-content" id="ws-scroll" tabindex="0" aria-label="设置内容，可上下滚动">
      <section class="ws-card" id="ws-connections"><div class="ws-card-heading"><div><span class="dialog-kicker">连接管理</span><h3>模型连接与平台参数</h3></div><span class="ws-badge" id="ws-security">密钥仅在后端</span></div>
        <div class="ws-provider-tabs" id="ws-provider-tabs" role="group" aria-label="配置服务商"></div><div class="ws-inline ws-connection-summary"><p class="ws-help">选择服务商查看连接；密钥保存在后端。</p><button class="text-button" id="ws-expand-connection" type="button" aria-expanded="false" aria-controls="ws-connection-details">配置当前连接 ⌄</button></div><div id="ws-connection-details" hidden><div id="ws-connection-editor">${connectionFields}</div><p class="ws-help">已有密钥不会显示在页面。修改只在点击底部“保存设置”后生效。</p><div class="ws-tool-grid" id="ws-connection-tools"></div></div>
      </section>
      <section class="ws-card" id="ws-parameters"><div class="ws-card-heading"><div><span class="dialog-kicker">模型参数</span><h3>当前模型专属设置</h3></div><span class="ws-model" id="ws-current-model"></span></div>
        <div class="ws-inline"><p class="ws-help">勾选后发送参数，取消勾选使用模型默认值。</p><button class="secondary-button" id="ws-custom-model" type="button">自定义模型 ID</button></div>
        <div class="ws-capabilities"><span id="ws-output-cap"></span><span>上下文长度：未报告</span><button class="text-button" id="ws-refresh-models" type="button">↻ 手动拉取最新</button></div>
        <div id="ws-parameter-fields"></div><p class="ws-help" id="ws-parameter-note"></p><button class="secondary-button" id="ws-default-parameters" type="button">使用模型默认参数</button>
      </section>
      <section class="ws-card" id="ws-custom"><div class="ws-card-heading"><div><span class="dialog-kicker">兼容端点</span><h3>自定义服务</h3></div><span class="ws-badge">最多 12 个连接</span></div><p class="ws-help">接入支持 OpenAI Chat Completions 或 Responses 的服务，填写真实端点、API 密钥与模型 ID。</p><div class="ws-inline"><button class="primary-button" id="ws-add-service" type="button">＋ 添加兼容服务</button><button class="secondary-button" id="ws-add-gemini" type="button">＋ 官方 Gemini API</button></div><div id="ws-custom-services"></div><p class="ws-help">Gemini 这里使用官方 API 密钥，账号密码不能用作 API 密钥。</p></section>
      <section class="ws-card" id="ws-general"><div class="ws-card-heading"><div><span class="dialog-kicker">通用与服务</span><h3>联网搜索与网络代理</h3></div></div>
        <div class="ws-subheading" id="ws-search-anchor"><h4>联网搜索配置</h4><span id="ws-search-summary" class="ws-badge"></span></div>
        <label>搜索方式<select id="ws-search-engine"><option value="builtin">服务商内置搜索（Gemini / OpenRouter / OpenAI）</option><option value="tavily">Tavily（独立搜索，可配合任意模型）</option><option value="searxng">SearXNG（自建搜索，可配合任意模型）</option></select></label>
        <div id="ws-search-external"><label id="ws-search-url-row">SearXNG 服务地址<input id="ws-search-url" type="url" placeholder="https://search.example.com/"></label><label id="ws-search-key-row">搜索服务 API 密钥<input id="ws-search-key" type="password" autocomplete="new-password" placeholder="留空保留现有密钥"></label>
        <div class="ws-grid"><label>最多搜索结果<input id="ws-search-results" type="number" min="1" max="10" value="5"></label><label id="ws-search-depth-row">搜索深度<select id="ws-search-depth"><option value="basic">基础搜索</option><option value="advanced">深度搜索（更多用量）</option></select></label><label>时间范围<select id="ws-search-time"><option value="">不限时间</option><option value="day">一天内</option><option value="week">一周内</option><option value="month">一月内</option><option value="year">一年内</option></select></label></div></div>
        <p class="ws-help" id="ws-search-help"></p><div class="ws-inline"><input id="ws-search-query" placeholder="输入搜索测试问题" aria-label="搜索测试问题" maxlength="500"><button class="secondary-button" id="ws-test-search" type="button">测试已保存的配置</button></div><div id="ws-search-test-result" role="status"></div>
        <div class="ws-subheading"><h4>网络代理</h4><button class="secondary-button" id="ws-open-proxy" type="button">🌐 网络代理配置</button></div><p class="ws-help" id="ws-proxy-summary"></p>
        <p class="ws-help">代理作用于此后端的模型请求与联网搜索。本机 127.0.0.1 指运行后端的电脑；上传云端后指服务器。</p><div class="ws-tool-grid" id="ws-general-tools"></div>
      </section>
      <section class="ws-card" id="ws-appearance"><div class="ws-card-heading"><div><span class="dialog-kicker">外观与预设</span><h3>字体、消息布局与提示词</h3></div><span class="ws-badge">沿用当前配色</span></div><div class="ws-grid"><label>界面字体<select id="ws-font"><option value="default">默认字体</option><option value="system">系统字体</option><option value="serif">衬线字体</option></select></label><label>消息字号<input id="ws-font-size" type="number" min="12" max="22" value="15"></label><label>阅读宽度<select id="ws-width"><option value="comfortable">舒适</option><option value="wide">宽屏</option></select></label><label>发送快捷键<select id="ws-send-key"><option value="enter">Enter 发送，Shift + Enter 换行</option><option value="ctrl-enter">Ctrl / Command + Enter 发送</option></select></label></div><div class="ws-tool-grid" id="ws-appearance-tools"></div></section>
      <section class="ws-card" id="ws-files"><div class="ws-card-heading"><div><span class="dialog-kicker">文件解析</span><h3>OCR 与文档</h3></div><span class="ws-badge">在浏览器内读取</span></div><p class="ws-help">支持文本、PDF、DOCX、PNG/JPEG/WebP 图片。原始文件不会上传；解析文字经你确认发送后才交给模型。文档或图片最多 5 MiB，PDF 最多 40 页。</p><label>图片识别语言<select id="ws-ocr-language"><option value="chi_sim+eng">简体中文 + 英文</option><option value="eng">英文</option></select></label><label class="ws-file-label">选择文件预览<input id="ws-document-file" type="file" accept=".txt,.md,.csv,.json,.pdf,.docx,.png,.jpg,.jpeg,.webp"></label><p id="ws-document-status" role="status" aria-live="polite"></p><label>识别结果（可编辑，最多 6000 字）<textarea id="ws-document-preview" rows="7" maxlength="6000" placeholder="选择文件后会在这里显示文字"></textarea></label><button class="primary-button" id="ws-insert-document" type="button" disabled>插入到消息输入框</button></section>
    </div></div><footer class="ws-footer"><button class="secondary-button" id="ws-open-logs" type="button">查看运行日志</button><span id="ws-save-status" role="status" aria-live="polite"></span><button class="primary-button" id="ws-save" type="button">保存设置</button><button class="secondary-button" id="ws-cancel" type="button">取消</button></footer>`;
  document.body.append(dialog);
  const $ = selector => dialog.querySelector(selector);
  let draft, loaded = false, saving = false, selectedId, parsedName = '', parsing = false, selection = 'connections', parseController;
  const nav = [...dialog.querySelectorAll('[data-section]')];
  const editor = $('#ws-connection-editor');
  function expandConnection(open = true) {
    $('#ws-connection-details').hidden = !open;
    $('#ws-expand-connection').setAttribute('aria-expanded', String(open));
    $('#ws-expand-connection').textContent = open ? '收起连接设置 ⌃' : '配置当前连接 ⌄';
  }
  $('#ws-expand-connection').onclick = () => expandConnection($('#ws-connection-details').hidden);
  const fields = [...editor.querySelectorAll('[data-connection]')];
  const jsonEditor = document.createElement('details'); jsonEditor.className = 'ws-json-editor';
  jsonEditor.innerHTML = `<summary>查看 / 编辑模型参数 JSON</summary><p class="ws-help">与上方勾选和数值同步。仅包含当前模型支持的生成参数，输出上限以服务器为准。</p><label class="sr-only" for="ws-parameter-json">模型参数 JSON</label><textarea id="ws-parameter-json" rows="7" spellcheck="false"></textarea><div class="ws-inline"><button class="secondary-button" id="ws-json-apply" type="button">应用 JSON</button><button class="text-button" id="ws-json-restore" type="button">从控件恢复</button></div><p id="ws-json-status" role="status"></p>`;
  $('#ws-parameters').append(jsonEditor);
  let jsonDirty = false;
  const jsonInput = $('#ws-parameter-json');
  const parameterInputs = { temperature: ['parameter-temperature-enabled', 'parameter-temperature'],
    top_p: ['parameter-top-p-enabled', 'parameter-top-p'], max_output_tokens: ['parameter-max-output-enabled', 'parameter-max-output'] };
  function syncParameterJson() {
    const values = {};
    for (const [name, [check, input]] of Object.entries(parameterInputs)) {
      if (document.getElementById(check).checked && callbacks.currentModel().parameters?.[name]) values[name] = Number(document.getElementById(input).value);
    }
    jsonInput.value = JSON.stringify(values, null, 2); jsonDirty = false; $('#ws-json-status').textContent = '';
  }
  function applyParameterJson() {
    try {
      const values = parseModelParameterJson(jsonInput.value, callbacks.currentModel().parameters);
      for (const [name, [check, input]] of Object.entries(parameterInputs)) {
        const checkbox = document.getElementById(check), number = document.getElementById(input);
        checkbox.checked = Object.hasOwn(values, name); checkbox.dispatchEvent(new Event('change'));
        if (checkbox.checked) number.value = String(values[name]);
        number.dispatchEvent(new Event('input'));
      }
      jsonInput.value = JSON.stringify(values, null, 2); jsonDirty = false;
      $('#ws-json-status').textContent = '已同步到控件，点击底部保存设置后生效。'; return true;
    } catch (error) { $('#ws-json-status').textContent = error.message; jsonInput.focus(); return false; }
  }
  jsonInput.oninput = () => { jsonDirty = true; $('#ws-json-status').textContent = 'JSON 待应用，保存时会检查格式与模型限制。'; };
  $('#ws-json-apply').onclick = applyParameterJson; $('#ws-json-restore').onclick = syncParameterJson;
  function setConnectionAccess(enabled) {
    for (const field of fields) field.disabled = !enabled;
    for (const node of dialog.querySelectorAll('#ws-general input, #ws-general select')) node.disabled = !enabled;
    for (const id of ['ws-add-service','ws-add-gemini','ws-custom-model','ws-refresh-models','ws-test-search','ws-open-proxy']) $('#'+id).disabled = !enabled;
  }
  const movable = { 'ws-connection-tools': ['open-model-directory', 'open-api-access', 'open-settings'],
    'ws-general-tools': ['open-parallel-tasks', 'open-context-settings', 'open-conversation-search', 'open-shared-conversations', 'open-backup', 'export-chat', 'archive-chat'],
    'ws-appearance-tools': ['open-prompt-library', 'open-instructions'] };
  for (const [container, ids] of Object.entries(movable)) {
    for (const id of ids) {
      const button = document.getElementById(id);
      if (!button) continue;
      button.removeAttribute('role');
      button.addEventListener('click', () => dialog.close(), { capture: true });
      $(`#${container}`).append(button);
    }
  }
  for (const id of ['temperature-row', 'top-p-row', 'max-output-row']) {
    const row = document.getElementById(id); $('#ws-parameter-fields').append(row);
    const number = row.querySelector('input[type="number"]');
    if (id !== 'max-output-row') {
      const range = document.createElement('input'); range.type = 'range';
      range.min = number.min; range.max = number.max; range.step = number.step;
      range.setAttribute('aria-label', number.getAttribute('aria-label') + '滑块');
      range.addEventListener('input', () => { number.value = range.value; });
      number.addEventListener('input', () => { range.value = number.value; });
      const checkbox = row.querySelector('input[type="checkbox"]');
      checkbox.addEventListener('change', () => { range.disabled = !checkbox.checked; });
      row.append(range);
    }
  }
  $('#ws-parameter-fields').addEventListener('input', syncParameterJson);
  $('#ws-parameter-fields').addEventListener('change', syncParameterJson);
  async function api(path, body) {
    const response = await fetch(`/api/workspace/${path}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { 'x-yunjian-workspace': '1', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const payload = await response.json(); if (!response.ok) throw Error(payload.error || '工作区请求失败。'); return payload;
  }
  function setActive(id) {
    selection = id;
    for (const button of nav) { const active = button.dataset.section === id;
      button.classList.toggle('active', active); if (active) button.setAttribute('aria-current', 'true'); else button.removeAttribute('aria-current'); }
  }
  function navigate(id) { setActive(id); $(`#ws-${id}`).scrollIntoView({ block: 'start', behavior: 'instant' }); }
  for (const button of nav) button.addEventListener('click', () => navigate(button.dataset.section));
  $('#ws-scroll').addEventListener('scroll', () => {
    const top = $('#ws-scroll').getBoundingClientRect().top;
    const current = [...dialog.querySelectorAll('.ws-card')].filter(card => card.getBoundingClientRect().top <= top + 100).at(-1);
    if (current) setActive(current.id.slice(3));
  });
  function stashConnection() {
    const item = draft?.connections.find(c => c.id === selectedId); if (!item) return;
    for (const field of fields) { const name = field.dataset.connection;
      item[name] = name === 'models' ? field.value.split(/[\n,]/).map(s => s.trim()).filter(Boolean) : field.value.trim(); }
  }
  function showConnection(id) {
    selectedId = id; const item = draft.connections.find(c => c.id === id);
    for (const field of fields) field.value = item ? (field.dataset.connection === 'models' ? item.models.join('\n') : item[field.dataset.connection] || '') : '';
    $('#ws-key-state').textContent = item?.keyConfigured ? '已配置，留空保留' : '待填写';
    $('#ws-provider-tabs').replaceChildren();
    for (const connection of draft.connections) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = connection.label;
      button.classList.toggle('active', connection.id === id); button.setAttribute('aria-pressed', String(connection.id === id));
      button.addEventListener('click', () => { stashConnection(); showConnection(connection.id); expandConnection(); }); $('#ws-provider-tabs').append(button);
    }
    $('#ws-custom-services').replaceChildren();
    for (const connection of draft.connections.filter(c => c.custom)) {
      const row = document.createElement('div'); row.className = 'ws-custom-service';
      const label = document.createElement('span'); label.textContent = connection.label;
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'secondary-button'; edit.textContent = '编辑';
      edit.onclick = () => { stashConnection(); showConnection(connection.id); expandConnection(); navigate('connections'); };
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'text-button'; remove.textContent = '移除连接';
      remove.onclick = () => { stashConnection(); draft.connections = draft.connections.filter(c => c.id !== connection.id); showConnection(draft.connections[0].id); };
      row.append(label, edit, remove); $('#ws-custom-services').append(row);
    }
  }
  function searchFields() {
    const engine = $('#ws-search-engine').value;
    $('#ws-search-external').hidden = engine === 'builtin'; $('#ws-search-url-row').hidden = engine !== 'searxng';
    $('#ws-search-depth-row').hidden = engine !== 'tavily';
    $('#ws-search-time option[value="week"]').disabled = engine === 'searxng';
    if (engine === 'searxng' && $('#ws-search-time').value === 'week') $('#ws-search-time').value = '';
    $('#ws-search-help').textContent = engine === 'builtin' ? '使用当前服务商原生搜索，不需要独立搜索密钥。DeepSeek 等不支持原生搜索的模型请配置下方独立引擎。'
      : engine === 'tavily' ? '需要 Tavily 搜索密钥，和模型 API 密钥分别计费。保存后所有模型都可联网，并显示真实来源。'
        : '需要启用了 JSON 格式的 SearXNG 服务。公开实例可能禁用 JSON；自建服务不需要搜索 API 密钥。';
    $('#ws-search-summary').textContent = engine === 'builtin' ? '模型内置' : engine === 'tavily' ? '独立搜索 API' : '自建搜索';
  }
  function readSearch() {
    return { engine: $('#ws-search-engine').value, url: $('#ws-search-url').value.trim(), apiKey: $('#ws-search-key').value.trim(),
      maxResults: Number($('#ws-search-results').value), depth: $('#ws-search-depth').value, timeRange: $('#ws-search-time').value };
  }
  function proxySummary() {
    $('#ws-proxy-summary').textContent = draft.network.mode === 'direct' ? '当前：不使用代理'
      : draft.network.mode === 'system' ? '当前：使用 HTTP_PROXY / HTTPS_PROXY / NO_PROXY 环境变量'
        : `当前：自定义代理 ${draft.network.url}`;
  }
  function applyAppearance(prefs) {
    const fontSize = Number(prefs.fontSize);
    if (!document.body.classList.contains('modern-ui') && fontSize >= 12 && fontSize <= 22) document.documentElement.style.setProperty('--message-font-size', `${fontSize}px`);
    document.body.dataset.readingWidth = prefs.width === 'wide' ? 'wide' : 'comfortable';
    const hint = document.querySelector('.composer-hint');
    if (hint) hint.textContent = prefs.sendKey === 'ctrl-enter' ? 'Ctrl / ⌘ + Enter 发送 · Enter 换行' : 'Enter 发送 · Shift + Enter 换行';
  }
  applyAppearance(workspacePreferences());
  async function open(section = 'connections') {
    if (saving || parsing) return;
    const previousFocus = document.activeElement;
    callbacks.prepareParameters(); syncParameterJson(); setConnectionAccess(false);
    expandConnection(false);
    for (const row of $('#ws-parameter-fields').querySelectorAll('.parameter-row')) {
      const range = row.querySelector('input[type="range"]'); if (range) { range.value = row.querySelector('input[type="number"]').value; range.disabled = !row.querySelector('input[type="checkbox"]').checked; }
    }
    const model = callbacks.currentModel(); $('#ws-current-model').textContent = model.id || '尚未选择模型';
    $('#ws-output-cap').textContent = model.maxOutput ? `可设输出上限：${model.maxOutput.toLocaleString()} Tokens` : '输出上限未报告，可手动设置';
    $('#ws-parameter-note').textContent = document.getElementById('parameter-help').textContent;
    const prefs = workspacePreferences(); $('#ws-font').value = document.documentElement.dataset.font || 'default';
    $('#ws-font-size').value = String(prefs.fontSize || 15); $('#ws-width').value = prefs.width || 'comfortable';
    $('#ws-send-key').value = prefs.sendKey || 'enter'; $('#ws-ocr-language').value = prefs.ocrLanguage || 'chi_sim+eng';
    $('#ws-save-status').textContent = '正在读取设置…'; $('#ws-save').disabled = true; loaded = false; draft = undefined;
    if (!dialog.open) dialog.showModal();
    dialog.addEventListener('close', () => previousFocus?.focus(), { once: true });
    requestAnimationFrame(() => navigate(section));
    try {
      const result = await api('settings'); if (!dialog.open) return;
      draft = result; loaded = true; showConnection(draft.connections.find(c => c.id === model.provider)?.id || draft.connections[0]?.id);
      $('#ws-security').textContent = draft.encrypted ? '后端加密存储' : '密钥仅在后端';
      const search = draft.search; $('#ws-search-engine').value = search.engine; $('#ws-search-url').value = search.url || '';
      $('#ws-search-key').value = ''; $('#ws-search-key').placeholder = search.keyConfigured ? '已配置，留空保留' : '填写搜索 API 密钥';
      $('#ws-search-results').value = search.maxResults; $('#ws-search-depth').value = search.depth; $('#ws-search-time').value = search.timeRange;
      searchFields(); proxySummary(); $('#ws-save-status').textContent = '修改后点击保存设置'; $('#ws-save').disabled = false;
      setConnectionAccess(true);
    } catch (error) {
      if (!dialog.open) return;
      $('#ws-security').textContent = '连接由管理员维护';
      $('#ws-provider-tabs').replaceChildren();
      for (const provider of callbacks.providers()) {
        const label = document.createElement('span'); label.className = 'ws-badge'; label.textContent = provider.label; $('#ws-provider-tabs').append(label);
      }
      $('#ws-custom-services').replaceChildren();
      for (const field of fields) field.value = '';
      $('#ws-key-state').textContent = '服务器配置';
      $('#ws-search-help').textContent = '联网服务与代理由管理员配置。聊天顶部可切换当前模型支持的联网搜索。';
      $('#ws-proxy-summary').textContent = '代理由管理员维护。';
      $('#ws-save-status').textContent = '可保存模型参数、外观和快捷键。服务连接及密钥请在本机管理。';
      setConnectionAccess(false);
      $('#ws-save').disabled = false;
    }
  }
  const close = () => { if (!saving) { parseController?.abort(); dialog.close(); } };
  $('#ws-close').onclick = close; $('#ws-cancel').onclick = close;
  dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); else parseController?.abort(); });
  dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close(); } });
  dialog.addEventListener('close', () => { draft = undefined; for (const field of fields.filter(x => x.type === 'password')) field.value = ''; $('#ws-search-key').value = ''; });
  $('#ws-search-engine').onchange = searchFields;
  $('#ws-custom-model').onclick = () => { expandConnection(); navigate('connections'); editor.querySelector('[data-connection="models"]').focus(); };
  $('#ws-default-parameters').onclick = () => { for (const row of $('#ws-parameter-fields').querySelectorAll('.parameter-row')) {
    row.querySelector('input[type="checkbox"]').checked = false;
    for (const input of row.querySelectorAll('input:not([type="checkbox"])')) input.disabled = true;
  } syncParameterJson(); };
  $('#ws-add-service').onclick = () => {
    if (!loaded || draft.connections.length >= 12) return callbacks.toast('请在本机打开设置，最多 12 个连接。');
    stashConnection(); const id = `custom-${crypto.randomUUID().slice(0, 8)}`;
    draft.connections.push({ id, label: '自定义服务', protocol: 'chat-completions', apiUrl: '', apiKey: '', model: '', models: [], custom: true });
    showConnection(id); expandConnection(); navigate('connections'); fields[0].focus();
  };
  $('#ws-add-gemini').onclick = () => {
    if (!loaded) return;
    if (draft.connections.length >= 12 && !draft.connections.some(c => c.id === 'gemini')) return callbacks.toast('最多支持 12 个连接。');
    stashConnection();
    if (!draft.connections.some(c => c.id === 'gemini')) draft.connections.push({ id: 'gemini', label: 'Google Gemini API', protocol: 'chat-completions',
      apiUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', apiKey: '', model: 'gemini-2.5-flash', models: ['gemini-2.5-flash', 'gemini-2.5-pro'], custom: true });
    showConnection('gemini'); expandConnection(); navigate('connections'); editor.querySelector('[data-connection="apiKey"]').focus();
  };
  $('#ws-refresh-models').onclick = async () => {
    if (!loaded) return;
    const button = $('#ws-refresh-models'); button.disabled = true;
    try { const result = await api('models', { provider: selectedId });
      $('#ws-save-status').textContent = `已获取 ${result.models.length} 个模型；显示前 24 个，可编辑后保存。`;
      editor.querySelector('[data-connection="models"]').value = [...new Set([editor.querySelector('[data-connection="model"]').value, ...result.models])].filter(Boolean).slice(0, 24).join('\n');
      expandConnection(); navigate('connections');
    } catch (error) { $('#ws-save-status').textContent = error.message; } finally { button.disabled = false; }
  };
  $('#ws-test-search').onclick = async () => {
    const button = $('#ws-test-search'), output = $('#ws-search-test-result'); button.disabled = true; output.textContent = '正在搜索…';
    try { const result = await api('search-test', { query: $('#ws-search-query').value }); output.replaceChildren();
      for (const source of result.sources) { const link = document.createElement('a'); link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = source.title; output.append(link); }
    } catch (error) { output.textContent = error.message; } finally { button.disabled = false; }
  };
  $('#ws-save').onclick = async () => {
    if (saving || parsing) return;
    if (callbacks.busy()) return callbacks.toast('请等待正在运行的对话任务结束后保存设置。');
    if (jsonDirty && !applyParameterJson()) { jsonEditor.open = true; navigate('parameters'); return; }
    const parameters = callbacks.readParameters(); if (!parameters) return;
    const prefs = { fontSize: Number($('#ws-font-size').value), width: $('#ws-width').value, sendKey: $('#ws-send-key').value, ocrLanguage: $('#ws-ocr-language').value };
    if (!Number.isInteger(prefs.fontSize) || prefs.fontSize < 12 || prefs.fontSize > 22) return callbacks.toast('字号请输入 12–22 的整数。');
    try { scopedStorage.setItem(`${PREFS_KEY}-check`, '1'); scopedStorage.removeItem(`${PREFS_KEY}-check`); } catch { return callbacks.toast('浏览器无法保存设置，请检查网站存储权限。'); }
    saving = true; $('#ws-save').disabled = true; $('#ws-save-status').textContent = '正在保存…';
    try {
      if (loaded) { stashConnection(); draft.search = readSearch(); await api('settings', draft); }
      scopedStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); scopedStorage.setItem('yunjian-ai-font-v1', $('#ws-font').value);
      applyAppearance(prefs); callbacks.applyFont($('#ws-font').value);
      callbacks.applyParameters(parameters); await callbacks.reloadProviders(); dialog.close(); callbacks.toast('设置已保存。');
    } catch (error) { $('#ws-save-status').textContent = error.message; } finally { saving = false; $('#ws-save').disabled = false; }
  };
  const proxy = document.createElement('dialog'); proxy.className = 'settings-dialog ws-proxy-dialog'; proxy.id = 'network-proxy-dialog';
  proxy.setAttribute('aria-labelledby', 'ws-proxy-title'); proxy.innerHTML = `<div class="dialog-card"><div class="dialog-heading"><h2 id="ws-proxy-title">🌐 网络代理配置</h2><button class="icon-button" id="proxy-close" aria-label="关闭网络代理配置" type="button">×</button></div><fieldset><legend>代理模式：</legend><label><input type="radio" name="ws-proxy-mode" value="direct"> 不使用代理</label><label><input type="radio" name="ws-proxy-mode" value="system"> 使用系统代理（环境变量）</label><label><input type="radio" name="ws-proxy-mode" value="custom"> 自定义代理 URL</label></fieldset><label class="token-label" for="ws-proxy-url">代理 URL：</label><input id="ws-proxy-url" type="url" placeholder="http://127.0.0.1:10809"><p class="ws-help">支持 HTTP、HTTPS、SOCKS5。本机常用代理监听端口请按你的代理软件填写。系统模式读取后端环境变量。</p><div class="dialog-actions"><button class="primary-button" id="proxy-apply" type="button">应用代理</button><button class="secondary-button" id="proxy-cancel" type="button">取消</button></div></div>`;
  document.body.append(proxy);
  const proxyUrl = proxy.querySelector('#ws-proxy-url');
  const syncProxy = () => { proxyUrl.disabled = proxy.querySelector('input[name="ws-proxy-mode"]:checked')?.value !== 'custom'; };
  proxy.addEventListener('change', syncProxy);
  $('#ws-open-proxy').onclick = () => {
    if (!loaded) return callbacks.toast('网络代理只允许在本机工作区管理。');
    proxy.querySelector(`[name="ws-proxy-mode"][value="${draft.network.mode}"]`).checked = true;
    proxyUrl.value = draft.network.url; syncProxy(); proxy.showModal();
  };
  proxy.querySelector('#proxy-close').onclick = () => proxy.close(); proxy.querySelector('#proxy-cancel').onclick = () => proxy.close();
  proxy.querySelector('#proxy-apply').onclick = () => {
    const mode = proxy.querySelector('input[name="ws-proxy-mode"]:checked').value, url = proxyUrl.value.trim();
    if (mode === 'custom') { try { const parsed = new URL(url); if (!['http:', 'https:', 'socks5:'].includes(parsed.protocol)) throw Error(); } catch { return callbacks.toast('请输入有效的 HTTP、HTTPS 或 SOCKS5 代理 URL。'); } }
    draft.network = { mode, url: mode === 'custom' ? url : '' }; proxySummary(); proxy.close(); $('#ws-save-status').textContent = '代理已加入待保存设置，请点击底部保存。';
  };
  $('#ws-open-logs').onclick = () => callbacks.openLogs();
  $('#ws-document-file').onchange = async () => {
    const file = $('#ws-document-file').files?.[0]; $('#ws-document-file').value = ''; if (!file || parsing) return;
    parsing = true; parseController = new AbortController(); $('#ws-insert-document').disabled = true; $('#ws-document-preview').value = ''; parsedName = '';
    try { const result = await parseDocument(file, { signal: parseController.signal, language: $('#ws-ocr-language').value, progress: text => { $('#ws-document-status').textContent = text; } });
      if (!dialog.open) return;
      parsedName = result.name; $('#ws-document-preview').value = result.text;
      $('#ws-document-status').textContent = (result.truncated ? `${result.name}：显示前 6000 字，请编辑后插入。` : `${result.name}：解析完成，可编辑后插入。`) + pdfCoverage(result.pdfInfo);
      $('#ws-insert-document').disabled = false;
    } catch (error) { $('#ws-document-status').textContent = error.message || '解析失败。'; } finally { parsing = false; }
  };
  $('#ws-insert-document').onclick = () => {
    if (!parsedName || !$('#ws-document-preview').value.trim()) return;
    if (callbacks.insertDocument(formatDocument(parsedName, $('#ws-document-preview').value))) dialog.close();
  };
  return { open };
}
