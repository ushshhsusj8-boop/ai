import { createExecutionHistory, executionRecord, searchExecutionHistory, HISTORY_IMPORT_BYTES } from './execution_history.js';
import { getStorageScope } from './scoped_storage.js';
import { initHistoryCloudPanel } from './history_cloud_panel.js';
import {initCodeWorkspace} from './code_workspace.js';
import {validateCodeArtifacts,ARTIFACT_LIFETIME_MS} from './code_artifact_tools.js';
const RESULT_LABELS = { completed: '执行成功', failed: '执行失败', timeout: '超过 20 秒，已终止', output_limit: '输出超过 64 KiB，已终止', cancelled: '已停止', interrupted: '未收到完整结果' };
const SAMPLES = {
  python: 'name = input().strip() or "world"\nprint(f"Hello, {name}!")\nprint("1 到 10 的和:", sum(range(1, 11)))',
  java: 'import java.util.Scanner;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner scanner = new Scanner(System.in);\n        String name = scanner.hasNextLine() ? scanner.nextLine() : "world";\n        System.out.println("Hello, " + name + "!");\n        System.out.println("1 到 10 的和: " + (10 * 11 / 2));\n    }\n}',
};
const LABELS = { chat_started: '模型请求开始', chat_completed: '回复完成', chat_failed: '请求失败', chat_cancelled: '回复停止',
  documents: '读取资料', search: '联网搜索', code_started: '代码开始', code_completed: '代码完成', code_failed: '代码失败',
  code_timeout: '代码超时', code_output_limit: '输出超限', code_cancelled: '代码已停止' };
export function initExecutionConsole(callbacks) {
  const toolbar = document.querySelector('.quick-actions');
  for (const [id, text] of [['open-code-runner', '▷ 运行代码'], ['open-activity-log', '运行日志']]) {
    const button = document.createElement('button'); button.id = id; button.type = 'button'; button.className = 'text-button'; button.textContent = text; toolbar.append(button);
  }
  async function api(path, body, signal) {
    const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: callbacks.headers(),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal });
    const result = await response.json();
    if (!response.ok) { if (response.status === 401) callbacks.authenticate(); throw Error(result.error || '请求失败。'); }
    return result;
  }
  const runner = document.createElement('dialog'); runner.id = 'code-runner-dialog'; runner.className = 'settings-dialog code-runner-dialog';
  runner.setAttribute('aria-labelledby', 'code-runner-title');
  runner.innerHTML = `<div class="dialog-card"><div class="dialog-heading"><h2 id="code-runner-title">服务器代码运行</h2><button class="icon-button" id="code-close" type="button" aria-label="关闭代码运行">×</button></div><p class="ws-help">Python / Java 标准库 · 无外网 · 最长 20 秒 · 384 MiB 内存 · 一次一个任务。先检查代码，再点击运行。</p><div class="code-runner-actions"><label>语言 <select id="code-language"><option value="python">Python</option><option value="java">Java</option></select></label><button class="secondary-button" id="code-example" type="button">载入示例</button></div><label for="code-source">代码（最多 32 KiB）</label><textarea id="code-source" rows="13" maxlength="32768" spellcheck="false"></textarea><label for="code-stdin">标准输入（可选，运行开始时一次性传入）</label><textarea id="code-stdin" rows="2" maxlength="16384" spellcheck="false"></textarea><div class="code-runner-actions"><button class="primary-button" id="code-run" type="button">在服务器运行</button><button class="secondary-button" id="code-stop" type="button" disabled>停止</button><span id="code-status" role="status"></span></div><h3>标准输出</h3><pre id="code-stdout">尚未运行</pre><h3>错误输出</h3><pre id="code-stderr">—</pre><div class="code-runner-actions"><button class="secondary-button" id="code-insert-result" type="button" disabled>结果放入聊天草稿</button><button class="text-button" id="code-download" type="button" disabled>下载完整结果</button></div></div>`;
  document.body.append(runner);
  const $ = id => runner.querySelector('#' + id);
  const history = createExecutionHistory();
  const historyPanel = document.createElement('section'); historyPanel.className = 'code-history';
  historyPanel.innerHTML = `<h3>本机运行历史</h3><p class="ws-help">保存在此浏览器，不与其他设备或网站共享聊天同步。最多 100 条 / 8 MiB，满后保留旧记录并提示下载；不会自动删除。清除浏览器数据或隐私窗口关闭会丢失。</p><p id="code-history-status" role="status"></p><div class="code-runner-actions"><label for="code-history-select">选择记录</label><select id="code-history-select" aria-label="选择本机运行记录"></select><button class="secondary-button" id="code-history-load" type="button">查看记录</button><button class="text-button" id="code-history-delete" type="button">删除所选</button></div><div class="code-runner-actions"><button class="secondary-button" id="code-history-save" type="button" disabled>保存当前结果</button><button class="text-button" id="code-history-export" type="button">下载全部历史 JSON</button><button class="text-button" id="code-history-clear" type="button">清空本机历史</button></div>`;
  runner.querySelector('.dialog-card').append(historyPanel);
  if (getStorageScope()) historyPanel.querySelector('.ws-help').textContent = '保存在此浏览器的当前账户空间，不会显示给其他登录账户。可在下方确认私有云备份，再在另一设备恢复；不会自动上传。最多 100 条 / 8 MiB，满后保留旧记录并提示下载。清除浏览器数据或隐私窗口关闭会丢失。';
  const historyTools = document.createElement('div'); historyTools.className = 'code-history-tools';
  historyTools.innerHTML = `<div class="code-runner-actions"><label>检索历史 <input id="code-history-search" type="search" maxlength="200" placeholder="查找代码、输入或输出"></label><label>语言 <select id="code-history-language"><option value="all">全部语言</option><option value="python">Python</option><option value="java">Java</option></select></label><label>范围 <select id="code-history-field"><option value="all">代码、输入和输出</option><option value="code">仅代码</option><option value="output">仅输出和错误</option></select></label></div><p class="ws-help" id="code-history-search-status" role="status"></p><button class="secondary-button" id="code-history-import" type="button">导入历史 JSON</button><input id="code-history-import-file" type="file" accept=".json,application/json" hidden><section class="code-history-import-preview" id="code-history-import-preview" hidden aria-labelledby="code-history-import-title"><h4 id="code-history-import-title">导入预览</h4><p id="code-history-import-summary" role="status"></p><ul id="code-history-import-items"></ul><p class="ws-help">仅追加到此浏览器当前空间，原历史和编辑草稿保留，不会运行代码。最多 10 MiB JSON / 100 条，保存总量最多 8 MiB。</p><div class="code-runner-actions"><button id="code-history-import-confirm" class="primary-button" type="button">确认追加导入</button><button id="code-history-import-cancel" class="secondary-button" type="button">取消导入</button></div></section>`;
  historyPanel.querySelector('#code-history-status').after(historyTools);
  const resultCaption = document.createElement('p'); resultCaption.id = 'code-result-caption'; resultCaption.className = 'ws-help';
  $('code-stdout').before(resultCaption);
  let controller, last, records = [], readyToRun = false, storeError = false, importPlan = null, importScope, importing = false, previewSequence = 0, historyCloud, cloudBusy = false;
  let currentFiles = [], filesLocalId, filesScope = getStorageScope(), filesExpires = 0, fileNotice = '', fileTimer;
  $('code-source').value = SAMPLES.python;
  const codeWorkspace=initCodeWorkspace({runner,last:()=>last,busy:()=>Boolean(controller)||importing||cloudBusy,download,toast:callbacks.toast,artifacts:()=>{
    if (filesScope !== getStorageScope()) return {files:[],notice:'账户已改变，请刷新后查看生成文件。'};
    if (!last || last.localId !== filesLocalId) return {files:[],notice:'历史只保存代码和文字结果。生成文件仅本次新运行可下载，请将文件写入 output 文件夹。'};
    if (filesExpires && Date.now() >= filesExpires) { currentFiles=[]; fileNotice='生成文件已过期，请重新运行或使用已经下载的副本。'; }
    return {files:currentFiles,notice:fileNotice};
  }});
  function jobDraft() { return { language: $('code-language').value, code: $('code-source').value, stdin: $('code-stdin').value }; }
  function storageMessage(message) { $('code-history-status').textContent = message; codeWorkspace.status(message); }
  async function saveDraft() {
    if (last) updateResultCaption();
    codeWorkspace.refresh();
    try { await history.saveDraft(jobDraft()); }
    catch (error) { if (!storeError) { storeError = true; storageMessage(error.message); } }
  }
  function updateResultCaption() {
    const different = last && (last.code !== $('code-source').value || last.stdin !== $('code-stdin').value || last.language !== $('code-language').value);
    resultCaption.textContent = last ? `结果对应 ${new Date(last.createdAt).toLocaleString('zh-CN')} 的 ${last.language} 任务。${different ? '编辑区已修改或恢复其他草稿，下方仍显示原任务结果；新代码尚未运行。' : '查看或修改记录不会自动运行。'}` : '';
  }
  function download(text, name, type = 'text/plain;charset=utf-8') {
    const url = URL.createObjectURL(new Blob([text], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function showResult(record, restoreCode = false) {
    last = record;
    if (restoreCode) { $('code-language').value = last.language; $('code-source').value = last.code; $('code-stdin').value = last.stdin; }
    updateResultCaption();
    $('code-stdout').textContent = last.resultReceived ? last.stdout || '（无输出）' : '没有收到完整结果，服务器实际执行结果未知。';
    $('code-stderr').textContent = last.stderr || last.error || '（无错误输出）';
    $('code-status').textContent = last.resultReceived ? `${RESULT_LABELS[last.status]} · 退出码 ${last.exitCode ?? '无'} · ${(last.durationMs / 1000).toFixed(2)} 秒` : `未收到完整结果 · ${last.error}`;
    for (const id of ['code-insert-result', 'code-download', 'code-history-save']) $(id).disabled = false;
    codeWorkspace.refresh();
  }
  async function refreshHistory(selectedId = last?.localId) {
    records = await history.list(); paintHistory(selectedId);
  }
  function paintHistory(selectedId = $('code-history-select').value) {
    const filtered = searchExecutionHistory(records, $('code-history-search').value, $('code-history-language').value, $('code-history-field').value);
    $('code-history-select').replaceChildren();
    if (!filtered.length) { const option = document.createElement('option'); option.textContent = records.length ? '没有匹配记录' : '暂无记录'; option.value = ''; $('code-history-select').append(option); }
    for (const record of filtered) { const option = document.createElement('option'); option.value = record.localId;
      const code = record.code.replace(/\s+/g, ' ').slice(0, 36); option.textContent = `${new Date(record.createdAt).toLocaleString('zh-CN')} · ${record.language} · ${RESULT_LABELS[record.status]} · ${code}`; $('code-history-select').append(option); }
    if (filtered.some(record => record.localId === selectedId)) $('code-history-select').value = selectedId;
    $('code-history-search-status').textContent = `匹配 ${filtered.length} / ${records.length} 条 · 检索不会运行代码`;
    for (const id of ['code-history-load','code-history-delete']) $(id).disabled = Boolean(controller) || importing || cloudBusy || !filtered.length;
    for (const id of ['code-history-clear','code-history-export']) $(id).disabled = Boolean(controller) || importing || cloudBusy || !records.length;
    $('code-history-import').disabled = Boolean(controller) || importing || cloudBusy;
    $('code-history-import-cancel').disabled = importing;
    $('code-history-save').disabled = Boolean(controller) || importing || cloudBusy || !last;
    $('code-history-import-confirm').disabled = Boolean(controller) || importing || cloudBusy || !importPlan?.additions.length;
    historyCloud?.refresh();
  }
  for (const id of ['code-history-search','code-history-language','code-history-field']) $(id).addEventListener(id === 'code-history-search' ? 'input' : 'change', () => paintHistory());
  function cancelImport() { previewSequence++; importPlan = null; $('code-history-import-preview').hidden = true; }
  $('code-history-import-cancel').onclick = cancelImport;
  $('code-history-import').onclick = () => { if (!controller && !importing && !cloudBusy) $('code-history-import-file').click(); };
  $('code-history-import-file').onchange = async () => {
    const file = $('code-history-import-file').files[0]; $('code-history-import-file').value = '';
    if (!file || controller || importing || cloudBusy) return;
    cancelImport(); const sequence = previewSequence, scope = getStorageScope();
    try {
      if (file.size > HISTORY_IMPORT_BYTES) throw Error('运行历史备份最多 10 MiB。');
      const plan = await history.previewImport(await file.text());
      if (sequence !== previewSequence || controller || scope !== getStorageScope()) throw Error('账户或操作已经改变，请重新选择文件。');
      importPlan = plan; importScope = scope; $('code-history-import-preview').hidden = false;
      $('code-history-import-summary').textContent = `${file.name.slice(0,160)}：追加 ${plan.additions.length} 条，跳过 ${plan.skipped} 条相同记录，${plan.renamed} 条编号冲突另存；确认后共 ${plan.total}/100 条，${(plan.bytes/1048576).toFixed(2)}/8 MiB。`;
      $('code-history-import-items').replaceChildren();
      for (const record of plan.additions.slice(0,5)) { const item = document.createElement('li'); item.textContent = `${record.language} · ${RESULT_LABELS[record.status]} · ${record.code.replace(/\s+/g,' ').slice(0,80)}`; $('code-history-import-items').append(item); }
      if (plan.additions.length > 5) { const item = document.createElement('li'); item.textContent = `另有 ${plan.additions.length-5} 条`; $('code-history-import-items').append(item); }
      paintHistory(); $('code-history-import-cancel').focus();
    } catch (error) { if (sequence === previewSequence) { cancelImport(); storageMessage(error.message); } }
  };
  $('code-history-import-confirm').onclick = async () => {
    if (controller || importing || cloudBusy || !importPlan || importScope !== getStorageScope()) return;
    if (!confirm(`向${importScope ? '当前登录账户的本机空间' : '当前访客本机空间'}追加 ${importPlan.additions.length} 条运行历史？原记录和编辑草稿保留，不会运行代码。`)) return;
    importing = true; $('code-run').disabled = true; paintHistory();
    try { const result = await history.importBackup(importPlan); cancelImport(); await refreshHistory(); storageMessage(`导入完成：追加 ${result.added} 条，跳过 ${result.skipped} 条重复，${result.renamed} 条冲突另存。代码草稿保留，未运行代码。`); }
    catch (error) { cancelImport(); storageMessage(error.message); }
    finally { importing = false; $('code-run').disabled = Boolean(controller) || !readyToRun; paintHistory(); }
  };
  async function persistResult(record) {
    try { await history.save(record); await refreshHistory(record.localId); storageMessage(`已保存到本机 · ${records.length}/100 条。代码、标准输入和收到的输出均保留。`); }
    catch (error) { try { await refreshHistory(); } catch {} storageMessage(error.message); }
  }
  async function initializeHistory() {
    try {
      const draft = await history.readDraft(); await refreshHistory();
      if (records[0]) showResult(records[0], !draft);
      if (draft && ['python', 'java'].includes(draft.language)) { $('code-language').value = draft.language; $('code-source').value = draft.code; $('code-stdin').value = draft.stdin; }
      if (last) updateResultCaption();
      storageMessage(records.length ? `已恢复 ${records.length} 条本机历史，当前显示最近一次结果。编辑区保留最近的代码草稿，查看历史可同时恢复对应代码。` : '完成任务后自动保存到此浏览器。代码草稿也会自动保存。');
    } catch (error) { storageMessage(error.message); }
    finally { readyToRun = true; $('code-run').disabled = false; codeWorkspace.refresh(); historyCloud?.refresh(); }
  }
  // Avoid asynchronous restoration overwriting edits made immediately after page load.
  const initialized = initializeHistory(); $('code-run').disabled = true;
  historyCloud = initHistoryCloudPanel({runner,parent:historyPanel,history,busy:()=>Boolean(controller)||importing||!readyToRun,
    busyChanged:value=>{cloudBusy=value;$('code-run').disabled=value||Boolean(controller)||importing||!readyToRun;paintHistory();codeWorkspace.refresh();},
    restored:()=>refreshHistory(),onIdentityChanged:callbacks.authenticate});
  function open(language, source) {
    if (!readyToRun) { void initialized.then(() => open(language, source)); return; }
    if (!controller && source !== undefined) {
      $('code-language').value = language.toLowerCase() === 'java' ? 'java' : 'python'; $('code-source').value = source;
      $('code-stdin').value = ''; void saveDraft();
    }
    codeWorkspace.view(controller?'results':'editor');codeWorkspace.refresh();
    if (!runner.open) runner.showModal(); (controller?$('code-stop'):$('code-source')).focus();
    void refreshHistory().catch(error => storageMessage(error.message));
  }
  window.openServerCode = open;
  document.querySelector('#open-code-runner').onclick = () => open();
  $('code-close').onclick = () => runner.close();
  for (const id of ['code-source', 'code-stdin', 'code-language']) $(id).addEventListener(id === 'code-language' ? 'change' : 'input', () => { void saveDraft(); });
  $('code-example').onclick = () => { $('code-source').value = SAMPLES[$('code-language').value]; $('code-stdin').value = 'plaude chat'; void saveDraft(); };
  $('code-stop').onclick = () => controller?.abort();
  const resultText = () => `服务器运行结果（${last.language}）\n状态：${RESULT_LABELS[last.status]} · 退出码：${last.exitCode ?? '无'} · ${last.durationMs}ms${!last.resultReceived ? '\n未收到完整结果，实际执行结果未知：' + last.error : ''}\n\n标准输出：\n${last.stdout || '（空）'}\n\n错误输出：\n${last.stderr || '（空）'}`;
  $('code-insert-result').onclick = () => {
    if (!last) return;
    const text = resultText(), clipped = text.length > 6000 ? text.slice(0, 6000) + '\n（草稿仅包含前 6000 字符，完整结果请下载）' : text;
    if (callbacks.insert(`请分析以下代码及实际运行结果：\n\n${last.code.slice(0, 3000)}${last.code.length > 3000 ? '\n（代码节选）' : ''}\n\n${clipped}`)) runner.close();
  };
  $('code-download').onclick = () => {
    if (last) download(`代码：\n${last.code}\n\n标准输入：\n${last.stdin}\n\n${resultText()}`, `plaude-code-${last.localId}.txt`);
  };
  $('code-history-load').onclick = () => { if (controller || importing || cloudBusy) return; const record = records.find(r => r.localId === $('code-history-select').value); if (record) { showResult(record, true); void saveDraft();codeWorkspace.view('editor');$('code-source').focus(); storageMessage('正在查看已保存的结果；不会自动重新执行。需要重跑请检查后点击“在服务器运行”。'); } };
  $('code-history-save').onclick = () => { if (last && !controller && !importing && !cloudBusy) void persistResult(last); };
  $('code-history-delete').onclick = async () => {
    const id = $('code-history-select').value;
    if (controller || importing || cloudBusy || !id || !window.confirm('删除所选本机运行记录？不会删除聊天；如需保留，请先下载。')) return;
    try { await history.remove(id); await refreshHistory(); storageMessage('所选本机记录已删除。当前页面结果仍可下载；刷新后按剩余历史恢复。'); } catch (error) { storageMessage(error.message); }
  };
  $('code-history-clear').onclick = async () => {
    if (controller || importing || cloudBusy || !window.confirm(`清空全部 ${records.length} 条本机运行历史？此操作无法撤销，不影响聊天或代码草稿。`)) return;
    try { await history.clear(); await refreshHistory(); storageMessage('本机运行历史已清空，代码草稿保留。'); } catch (error) { storageMessage(error.message); }
  };
  $('code-history-export').onclick = async () => { try { const values = await history.list(); download(JSON.stringify({ format: 'plaude-code-history', version: 1, exportedAt: new Date().toISOString(), runs: values }, null, 2), `plaude-code-history-${Date.now()}.json`, 'application/json'); } catch (error) { storageMessage(error.message); } };
  $('code-run').onclick = async () => {
    if (controller || importing || cloudBusy || !readyToRun) return;
    cancelImport();
    const job = jobDraft();
    if (!job.code.trim()) { $('code-status').textContent = '请先输入代码。'; return; }
    if (new TextEncoder().encode(job.code).length > 32768 || new TextEncoder().encode(job.stdin).length > 16384) { $('code-status').textContent = '代码最多 32 KiB，标准输入最多 16 KiB（按 UTF-8 字节计算）。'; return; }
    const startedAt = Date.now(); void saveDraft();
    const runScope = getStorageScope(); clearTimeout(fileTimer); currentFiles=[]; filesLocalId=undefined; filesExpires=0; filesScope=runScope; fileNotice='';
    controller = new AbortController();
    paintHistory();
    for (const id of ['code-run', 'code-source', 'code-language', 'code-example', 'code-stdin', 'code-insert-result', 'code-download', 'code-history-load', 'code-history-delete', 'code-history-clear', 'code-history-export', 'code-history-save']) $(id).disabled = true;
    $('code-stop').disabled = false; $('code-status').textContent = '正在服务器隔离环境执行…'; $('code-stdout').textContent = '等待结果…'; $('code-stderr').textContent = '—'; last = undefined;
    codeWorkspace.view('results');codeWorkspace.refresh();
    try {
      const result=await api('/api/code/run', job, controller.signal);
      if (runScope !== getStorageScope()) throw Error('账户身份已改变，未载入原账户的生成文件，请刷新页面。');
      const record=executionRecord(job,result,{createdAt:startedAt});filesLocalId=record.localId;
      try { currentFiles=validateCodeArtifacts(result.files); fileNotice=typeof result.fileNotice==='string'?result.fileNotice.slice(0,200):''; }
      catch { currentFiles=[]; fileNotice='生成文件校验失败，程序输出仍保留。'; }
      filesExpires=Date.now()+ARTIFACT_LIFETIME_MS;
      fileTimer=setTimeout(()=>{currentFiles=[];fileNotice='生成文件已过期，请重新运行或使用已经下载的副本。';codeWorkspace.refresh();},ARTIFACT_LIFETIME_MS);
      showResult(record);
      await persistResult(last);
      if (!runner.open) callbacks.toast(`代码任务：${RESULT_LABELS[last.status]}，打开“运行代码”查看结果。`);
    } catch (error) {
      const message = error.name === 'AbortError' ? '已请求停止，服务器正在清理任务。' : error.message;
      showResult(executionRecord(job, { status: 'interrupted', stdout: '', stderr: '', exitCode: null, durationMs: Date.now() - startedAt }, { createdAt: startedAt, resultReceived: false, error: message }));
      await persistResult(last);
    }
    finally {
      controller = undefined; $('code-stop').disabled = true;
      for (const id of ['code-run', 'code-source', 'code-language', 'code-example', 'code-stdin']) $(id).disabled = false;
      for (const id of ['code-insert-result', 'code-download', 'code-history-save']) $(id).disabled = !last;
      for (const id of ['code-history-load', 'code-history-delete', 'code-history-clear', 'code-history-export']) $(id).disabled = !records.length;
      paintHistory();
      codeWorkspace.refresh();
    }
  };
  const logs = document.createElement('dialog'); logs.id = 'activity-log-dialog'; logs.className = 'settings-dialog activity-log-dialog';
  logs.setAttribute('aria-labelledby', 'activity-log-title');
  logs.innerHTML = `<div class="dialog-card"><div class="dialog-heading"><h2 id="activity-log-title">运行日志</h2><button class="icon-button" type="button" aria-label="关闭运行日志">×</button></div><p class="ws-help">查看当前服务启动后的最近 200 条活动与请求。每 2 秒刷新；需要网站访问口令。日志沿用网站共享范围，不显示密钥、聊天正文、代码或程序输出。</p><p id="activity-status" role="status"></p><h3>任务活动</h3><pre id="activity-events"></pre><details><summary>请求记录</summary><pre id="activity-requests"></pre></details><button class="secondary-button" id="activity-refresh" type="button">立即刷新</button></div>`;
  document.body.append(logs); let refreshing = false, poll;
  if (getStorageScope()) logs.querySelector('.ws-help').textContent = '查看当前账户最近的任务活动与请求，每 2 秒刷新。不会显示密钥、聊天正文、代码或程序输出。';
  async function refresh() {
    if (refreshing || !logs.open) return; refreshing = true;
    try {
      const result = await api('/api/activity');
      logs.querySelector('#activity-status').textContent = result.codeEnabled ? `代码环境已启用 · ${result.codeBusy ? '有任务运行中' : '空闲'}` : '代码环境尚未启用';
      const time = value => new Date(value).toLocaleTimeString('zh-CN');
      logs.querySelector('#activity-events').textContent = [...result.events].reverse().map(e => `${time(e.time)}  ${LABELS[e.type] || e.type}\n${e.detail}${e.requestId ? ' · #' + e.requestId.slice(0, 8) : ''}`).join('\n\n') || '暂时没有任务，发送消息或运行代码后会显示。';
      logs.querySelector('#activity-requests').textContent = [...result.requests].reverse().map(e => `${time(e.time)}  ${e.method} ${e.path}  ${e.status}  ${e.durationMs}ms`).join('\n') || '暂无请求记录。';
    } catch (error) { logs.querySelector('#activity-status').textContent = error.message; clearInterval(poll); }
    finally { refreshing = false; }
  }
  const openLogs = () => { if (!logs.open) logs.showModal(); void refresh(); clearInterval(poll); poll = setInterval(refresh, 2000); };
  logs.querySelector('.icon-button').onclick = () => logs.close(); logs.addEventListener('close', () => clearInterval(poll));
  logs.querySelector('#activity-refresh').onclick = refresh;
  document.querySelector('#open-activity-log').onclick = openLogs;
  return { openLogs };
}
