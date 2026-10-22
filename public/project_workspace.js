import { createProjectStore, projectContext, PROJECT_BYTES } from './projects.js';
import { createCloudProjectStore } from './project_cloud.js';
import { parseDocument } from './documents.js';
import {pdfCoverage} from './pdf_coverage.js';
import {checkAbort} from './pdf_parse.js';
import {createProjectOriginalClient} from './project_originals.js';
import {initOriginalRestorePanel} from './original_restore_panel.js';
import { createProjectDraftStore } from './project_drafts.js';
export function initProjectWorkspace({ active, conversations, create, select, busy, toast, changed = () => {}, currentAccount = () => globalThis.PlaudeAccount?.user }) {
  const localStore = createProjectStore();
  let store = localStore, accountId = '', generation = 0, refreshSequence = 0;
  let snapshot = { version: 1, projects: [], links: [] }, selected = '', editing, working = false, loadError = '', parseController;
  let draftStore = createProjectDraftStore(), restoredDraft = null, draftError = '';
  let originals = null, originalError = '', originalExportController;
  const button = document.createElement('button'); button.id = 'open-projects'; button.className = 'new-chat-button'; button.textContent = '项目空间与知识库';
  document.querySelector('#new-chat').after(button);
  const badge = document.createElement('button'); badge.id = 'project-context'; badge.className = 'text-button'; document.querySelector('#prompt-input').before(badge);
  const dialog = document.createElement('dialog'); dialog.id = 'project-dialog'; dialog.className = 'project-dialog'; dialog.setAttribute('aria-labelledby', 'project-heading');
  dialog.innerHTML = `<div class="project-header"><h2 id="project-heading">项目空间与知识库</h2><button type="button" id="project-close" aria-label="关闭项目空间">×</button></div>
    <p class="project-note" id="project-storage-note"></p><p id="project-sync-state" class="project-note" role="status" aria-live="polite"></p>
    <div class="project-actions"><label>选择项目 <select id="project-select" aria-label="选择项目"></select></label><button type="button" id="project-new">新建项目</button></div>
    <label>项目名称<input id="project-name" maxlength="60" placeholder="例如：网站开发 / 论文 / 工作资料"></label>
    <label>项目指令<textarea id="project-instructions" maxlength="2000" rows="4" placeholder="关联对话共用的背景和回答要求"></textarea></label>
    <div class="project-actions"><button type="button" id="project-save">保存名称与指令</button><button type="button" id="project-copy">另存为新项目</button><button type="button" id="project-discard">放弃当前编辑</button><button type="button" id="project-delete">删除项目</button></div>
    <p id="project-draft-state" class="project-note" role="status" aria-live="polite"></p><div class="project-actions"><label>本机编辑草稿 <select id="project-drafts" aria-label="本机编辑草稿"></select></label><button type="button" id="project-restore">恢复所选草稿</button><button type="button" id="project-draft-delete">删除所选草稿</button></div>
    <h3>统一资料</h3><p class="project-note">每项目最多 3 份，每份 5 MiB / 12 万字符，PDF 200 页；添加文件先保存解析文字，原文件需另外明确选择上传。项目和对话每次合计最多引用 3 份。修改只影响后续提问，已有回答和引用保留。</p>
    <label>添加项目文件<input type="file" id="project-files" accept=".txt,.md,.csv,.json,.pdf,.docx" multiple></label><button type="button" id="project-parse-cancel" hidden>取消文件解析</button><div id="project-documents"></div>
    <details id="project-original-vault"><summary>原文件私有保管区</summary><p class="project-note">原文件需在资料旁明确选择并上传；账户内最多60个 / 64 MiB，单个5 MiB。JSON项目备份不含原文件，可另行整批备份ZIP或逐个下载。删除项目或解析资料会保留原文件，需在此单独确认删除。</p><p id="project-original-status" class="project-note" role="status"></p><div class="project-actions"><button type="button" id="project-original-refresh">刷新原文件列表</button><button type="button" id="project-original-export">备份全部原文件 ZIP</button><button type="button" id="project-original-export-cancel" hidden>取消整批备份</button></div><div id="project-original-list"></div></details>
    <h3>关联对话</h3><p class="project-note">加入已有对话会携带其原有历史；需要隔离主题时请在项目中新建对话。普通“开启新对话”不自动关联项目。</p>
    <div class="project-actions"><button type="button" id="project-link">关联当前对话</button><button type="button" id="project-unlink">移出当前对话</button><button type="button" id="project-chat">在项目中新建对话</button></div><div id="project-conversations"></div>
    <div class="project-actions"><button type="button" id="project-refresh">重新读取云端项目</button><button type="button" id="project-migrate" hidden>导入本机项目到此账户</button><button type="button" id="project-export">导出全部项目备份</button><label>导入项目备份<input type="file" id="project-import" accept=".json"></label></div>
    <p class="project-note">项目备份含指令、资料和关联 ID，不含聊天正文。迁移时还需使用原聊天备份；导入遇到冲突会拒绝，不覆盖现有项目。</p><p id="project-status" role="status" aria-live="polite"></p>`;
  document.body.append(dialog);
  const overview=document.createElement('div');overview.id='project-overview';overview.className='project-overview';overview.setAttribute('aria-label','项目概览');
  dialog.querySelector('.project-actions').before(overview);
  const el = id => dialog.querySelector('#project-' + id);
  const status = text => { el('status').textContent = text; };
  const current = () => snapshot.projects.find(p => p.id === selected);
  const download = (name, text, type = 'application/json') => { const url = URL.createObjectURL(new Blob([text], { type })), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  const originalClient = owner => createProjectOriginalClient({userId: owner, currentAccount: () => currentAccount()?.id});
  const originalRestore=initOriginalRestorePanel({dialog,parent:el('original-vault'),run,working:()=>working,currentAccount,client:originalClient,
    accept:value=>{originals=value;originalError='';},projects:()=>snapshot.projects,status});
  function drawOriginals() {
    originalRestore.refresh();
    el('original-status').textContent = !accountId ? '请登录个人账户使用原文件云保管。访客资料仍保留在本机。' : originalError || !originals ? originalError || '原文件列表尚未读取，请刷新。' : `${originals.files.length}/60 个 · ${(originals.usedBytes / 1024 / 1024).toFixed(2)}/64 MiB；只有列表中的记录才确认已保存。`;
    el('original-refresh').disabled = working || !accountId;
    el('original-export').disabled = working || !accountId || !originals?.files.some(f => !f.cleanupPending);
    el('original-list').replaceChildren();
    for (const file of originals?.files || []) {
      const row = document.createElement('div'); row.className = 'project-original-row';
      const text = document.createElement('p'), project = snapshot.projects.find(p => p.id === file.projectId);
      text.textContent = `${file.name} · ${(file.size / 1024).toFixed(1)} KiB · ${project?.name || '原项目已移除'}${project && !project.documents.some(d => d.id === file.documentId) ? '（解析资料已移除）' : ''} · SHA256 ${file.sha256.slice(0, 12)}${file.cleanupPending ? ' · 删除待清理，请重试；容量仍占用' : ''}`;
      const get = document.createElement('button'); get.type = 'button'; get.textContent = '下载原文件'; get.disabled = working || file.cleanupPending;
      get.onclick = () => run(async () => { const owner = accountId, blob = await originalClient(owner).download(file); if (owner !== currentAccount()?.id) throw Error('账户已切换，未下载文件。'); download(file.name, blob, 'application/octet-stream'); status('原文件校验通过并交给浏览器下载，请检查下载目录。'); });
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = file.cleanupPending ? '重试删除原文件' : '删除原文件'; remove.disabled = working;
      remove.onclick = () => run(async () => { if (!file.cleanupPending && !confirm(`删除云端原文件“${file.name}”？请先下载备份。解析文字和聊天保留。`)) return; const owner = accountId, result = await originalClient(owner).remove(file.id); if (owner !== currentAccount()?.id) throw Error('账户已切换，请重新打开列表。'); originals = result; originalError = ''; drawOriginals(); status(result.files.some(f => f.id === file.id) ? '删除清理尚未完成，记录与容量保留，请重试删除。' : '原文件已删除，解析文字和聊天保留。'); });
      row.append(text, get, remove); el('original-list').append(row);
    }
    for (const input of dialog.querySelectorAll('[data-original-document]')) input.disabled = working || !accountId || !originals || Boolean(originals.files.some(f => f.projectId === selected && f.documentId === input.dataset.originalDocument));
  }
  async function refreshOriginals(turn = generation) {
    if (!accountId) { originals = null; originalError = ''; drawOriginals(); return; }
    const owner = accountId;
    try { const result = await originalClient(owner).list(); if (turn !== generation || owner !== currentAccount()?.id) return; originals = result; originalError = ''; }
    catch (e) { if (turn !== generation || owner !== currentAccount()?.id) return; originals = null; originalError = `原文件列表读取失败：${e.message}，请刷新核实，不能据此判断文件丢失。`; }
    drawOriginals();
  }
  function sync() {
    const link = snapshot.links.find(l => l.conversationId === active()?.id), p = snapshot.projects.find(p => p.id === link?.projectId);
    badge.textContent = loadError ? '项目库读取失败 · 点击重试' : p ? `项目：${p.name} · ${p.documents.filter(d => d.enabled).length} 份启用资料` : '未关联项目 · 打开项目空间';
    el('storage-note').textContent = accountId
      ? '项目、指令和资料保存在当前账户的云端私有空间，登录同一账户可在电脑和手机使用。旧本机项目不会自动上传，需手动导入；请同时保留导出备份。'
      : '访客项目仅保存在当前浏览器，不跨设备同步。登录后可手动导入项目到自己的私有账户；本机原资料仍保留。';
    const cloud = store.status;
    el('sync-state').textContent = loadError ? `读取失败：${loadError}` : !accountId ? '本机项目库 · 尚未登录'
      : cloud?.offline ? '离线缓存 · 联网后才能上传修改或发送项目资料；名称和指令可保留本机草稿。'
        : cloud?.revision == null ? '正在读取当前账户的云端项目…'
          : `云端已同步 · 版本 ${cloud.revision}${cloud.cacheUnavailable ? ' · 此浏览器无法保存离线缓存' : ''}`;
    el('migrate').hidden = !accountId;
    el('refresh').textContent = accountId ? '重新读取云端项目' : '重新读取本机项目';
    badge.hidden = !p && !loadError;
    overview.replaceChildren();
    for(const project of snapshot.projects) {
      const card=document.createElement('button');card.type='button';card.className='project-overview-card';card.setAttribute('aria-pressed',String(project.id===selected));
      const title=document.createElement('strong'),detail=document.createElement('span');title.textContent=project.name;detail.textContent=`${project.documents.length} 份资料 · ${snapshot.links.filter(l=>l.projectId===project.id).length} 段对话`;card.append(title,detail);
      card.onclick=()=>{if(!working&&keepDraft()){selected=project.id;draw();el('name').focus();}};overview.append(card);
    }
    renderDrafts();
    drawOriginals();
  }
  function ensureAccount() {
    const nextId = currentAccount()?.id || '';
    if (nextId === accountId) return;
    parseController?.abort();
    originalExportController?.abort();
    originals = null; originalError = '';
    accountId = nextId; store = accountId ? createCloudProjectStore({ userId: accountId }) : localStore;
    generation++; refreshSequence++; snapshot = { version: 1, projects: [], links: [] }; selected = ''; editing = undefined; loadError = '';
    draftStore = createProjectDraftStore({userId: accountId}); restoredDraft = null; draftError = '';
    draw(); status('');
  }
  async function refresh() {
    ensureAccount(); const target = store, turn = generation, sequence = ++refreshSequence;
    try { const value = await target.read(); if (turn !== generation || target !== store || sequence !== refreshSequence) return; snapshot = value; loadError = ''; sync(); updateLinkedConversations(); await refreshOriginals(turn); }
    catch (e) { if (turn !== generation || target !== store || sequence !== refreshSequence) return; loadError = e.message; sync(); throw e; }
  }
  function dirty() { return editing && (el('name').value !== editing.name || el('instructions').value !== editing.instructions); }
  function renderDrafts() {
    try {
      const selectedKey = el('drafts').value, drafts = draftStore.list();
      el('drafts').replaceChildren(...(drafts.length ? drafts.map(d => new Option(`${d.name || '未命名项目'} · ${new Date(d.updatedAt).toLocaleString()}`, d.key)) : [new Option('没有本机编辑草稿', '')]));
      if (drafts.some(d => d.key === selectedKey)) el('drafts').value = selectedKey;
      const stale = editing && current() && editing.revision !== current().revision;
      el('draft-state').textContent = draftError || (dirty() ? '名称与指令已保留本机草稿，尚未上传。' : '名称与指令编辑时自动保留本机草稿；刷新后可恢复。草稿不跨设备，不包含未上传文件。')
        + (stale ? ' 云端版本已更新；本机编辑仍保留，可另存为新项目。' : '');
    } catch { draftError = '此浏览器无法保存或读取编辑草稿，请复制修改后再离开。'; el('draft-state').textContent = draftError; }
  }
  function keepDraft() {
    if (!editing || !dirty()) return true;
    try {
      draftStore.save({projectId: editing.id, revision: editing.revision, name: el('name').value, instructions: el('instructions').value, baselineName: editing.name, baselineInstructions: editing.instructions});
      draftError = ''; renderDrafts(); return true;
    } catch (e) { draftError = `本机草稿未保存：${e.message} 请复制修改后再离开。`; renderDrafts(); return false; }
  }
  function clearDraft() {
    try {
      const ownKey = editing && draftStore.keyFor(editing.id);
      if (ownKey) draftStore.remove(ownKey);
      if (restoredDraft && restoredDraft.key !== ownKey) draftStore.remove(restoredDraft.key, restoredDraft.raw);
    } catch (e) { toast(e.message); }
    restoredDraft = null; draftError = '';
  }
  const discard = () => {
    if (!dirty()) return true;
    if (!confirm('名称或指令尚未上传，放弃当前编辑草稿？')) return false;
    clearDraft(); el('name').value = editing.name; el('instructions').value = editing.instructions; return true;
  };
  function draw() {
    // Starting another editor retains the previous slot, including a different draft of the same project.
    draftStore = createProjectDraftStore({userId: accountId});
    el('select').replaceChildren(new Option('选择项目 / 新建', ''), ...snapshot.projects.map(p => new Option(p.name, p.id)));
    el('select').value = selected;
    editing = structuredClone(current() || { id: crypto.randomUUID(), revision: 0, name: '', instructions: '', documents: [] });
    restoredDraft = null;
    el('name').value = editing.name; el('instructions').value = editing.instructions;
    for (const id of ['delete', 'files', 'link', 'unlink', 'chat']) el(id).disabled = !current();
    el('documents').replaceChildren();
    for (const doc of editing.documents) {
      const row = document.createElement('div'); row.className = 'project-file';
      const details = document.createElement('details'), title = document.createElement('summary'), pre = document.createElement('pre');
      title.textContent = `${doc.name} · ${doc.sections.reduce((n,s) => n+s.text.length, 0)} 字符`; pre.textContent = doc.sections.map(s => `${s.label}\n${s.text}`).join('\n\n');
      const coverage = document.createElement('p'); coverage.className = 'ui-note'; coverage.textContent = pdfCoverage(doc.pdfInfo); details.append(title, coverage, pre); row.append(details);
      const add = (label, action) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.onclick = action; row.append(b); };
      add(doc.enabled ? '暂停引用' : '恢复引用', () => run(async store => { if (!discard()) return; const p = structuredClone(editing); p.documents.find(d => d.id === doc.id).enabled = !doc.enabled; await store.save(p); await reloadSaved(store); }));
      add('下载文字', () => download(doc.name + '.txt', pre.textContent, 'text/plain;charset=utf-8'));
      const originalInput = document.createElement('input'); originalInput.type = 'file'; originalInput.hidden = true; originalInput.accept = '.pdf,.docx,.txt,.md,.csv,.json';
      const upload = document.createElement('button'); upload.type = 'button'; upload.textContent = '选择并保存原文件'; upload.dataset.originalDocument = doc.id;
      upload.onclick = () => { if (!working) originalInput.click(); };
      originalInput.onchange = () => {
        const file = originalInput.files?.[0]; originalInput.value = ''; if (!file || working) return;
        const projectId = editing.id;
        if (!confirm(`将所选“${file.name}”作为资料“${doc.name}”的原文件上传到当前个人账户？原始内容会保存在服务器，JSON备份不含它。请确认选择正确；已有原文件不会被覆盖。`)) return;
        void run(async () => { const owner = accountId, result = await originalClient(owner).upload({projectId, documentId: doc.id, file}); if (owner !== currentAccount()?.id) throw Error('账户已切换，请重新打开列表核实。'); originals = result; originalError = ''; el('original-vault').open = true; drawOriginals(); status('原文件已确认保存到当前账户，可在保管区下载；解析文字和指令没有改变。'); });
      };
      row.append(upload, originalInput);
      add('删除文件', () => run(async store => { if (!discard() || !confirm(`删除项目文件“${doc.name}”？已有回复与引用不会删除。`)) return; await store.save({ ...editing, documents: editing.documents.filter(d => d.id !== doc.id) }); await reloadSaved(store); }));
      el('documents').append(row);
    }
    el('conversations').replaceChildren();
    const links = snapshot.links.filter(l => l.projectId === selected);
    for (const link of links) {
      const c = conversations().find(c => c.id === link.conversationId), b = document.createElement('button'); b.type = 'button'; b.className = 'text-button';
      b.textContent = c ? (c.title || '新对话') + (c.archived ? '（已归档）' : '') : '对话尚未载入（可恢复聊天备份）'; b.disabled = !c;
      b.onclick = () => { if (discard()) { select(c.id); dialog.close(); } }; el('conversations').append(b);
    }
    sync();
  }
  async function reload({ discardDraft = false } = {}) { await refresh(); if (discardDraft || !dirty()) draw(); }
  async function reloadSaved(target) { if (target !== store) throw Error('账户已切换，请重新打开项目。'); await reload({ discardDraft: true }); if (target !== store) throw Error('账户已切换，请重新打开项目。'); }
  async function run(action) {
    if (working) return;
    ensureAccount(); const turn = generation, target = store;
    working = true; dialog.setAttribute('aria-busy', 'true');
    const controls = [...dialog.querySelectorAll('button,input,select,textarea')]; const disabled = controls.map(e => e.disabled); controls.forEach(e => e.disabled = true);
    try { await action(target); } catch (e) { if (turn === generation) { status(e.message); if (e.name !== 'AbortError') toast(e.message); sync(); } }
    finally { working = false; dialog.removeAttribute('aria-busy'); controls.forEach((e,i) => e.disabled = turn === generation ? disabled[i] : false); for (const id of ['delete','files','link','unlink','chat']) el(id).disabled = !current(); drawOriginals(); }
  }
  async function open() { if (working) return; if (dialog.open) { el('name').focus(); return; } await run(async target => {
    try { await refresh(); } catch(e) { if ([401,403].includes(e.status) || !draftStore.list().length) throw e; }
    if (target !== store) return;
    if (!dirty()) { selected = snapshot.links.find(l => l.conversationId === active()?.id)?.projectId || selected; draw(); }
    status(loadError ? '项目读取失败；本机名称与指令草稿仍可查看。资料上传需要重新连接。' : ''); dialog.showModal();
  }); if (dialog.open) { el('close').focus(); dialog.scrollTop = 0; } }
  button.onclick = badge.onclick = open;
  for (const id of ['name','instructions']) el(id).addEventListener('input', keepDraft);
  window.addEventListener('pagehide', keepDraft);
  el('close').onclick = () => { if (!working && keepDraft()) dialog.close(); };
  dialog.addEventListener('cancel', e => { if (working || !keepDraft()) e.preventDefault(); });
  el('new').onclick = () => { if (keepDraft()) { selected = ''; draw(); el('name').focus(); } };
  el('select').onchange = () => { if (!keepDraft()) { el('select').value = selected; return; } selected = el('select').value; draw(); status(''); };
  el('save').onclick = () => run(async store => { keepDraft(); const p = { ...editing, name: el('name').value, instructions: el('instructions').value }; await store.save(p); if (store !== activeStore()) return; clearDraft(); selected = p.id; await reloadSaved(store); status(accountId ? '项目已保存到云端。' : '项目已保存到本机。'); });
  el('copy').onclick = () => run(async store => {
    keepDraft(); if (!el('name').value.trim()) throw Error('请先填写项目名称。');
    if (!confirm('将当前名称、指令及已显示的文件另存为新项目？原项目与聊天关联保留，新项目不复制聊天关联。恢复草稿时，文件采用当前显示的已保存版本。')) return;
    const p = {...editing, id: crypto.randomUUID(), revision: 0, name: (el('name').value.trim().slice(0,51) + ' · 草稿副本'), instructions: el('instructions').value};
    await store.save(p); if (store !== activeStore()) return; clearDraft(); selected = p.id; await reloadSaved(store); status(accountId ? '草稿副本已保存到云端，原项目未覆盖。' : '草稿副本已保存到本机，原项目未覆盖。');
  });
  el('discard').onclick = () => { if (!working && discard()) { clearDraft(); draw(); status('已放弃当前编辑，已保存的项目保留。'); } };
  el('restore').onclick = () => run(async target => {
    if (!keepDraft()) return; if (!el('drafts').value) throw Error('请先选择可恢复的本机草稿。'); const draft = draftStore.read(el('drafts').value); if (!draft) throw Error('所选草稿已不存在，请重新选择。');
    try { await refresh(); } catch(e) { if ([401,403].includes(e.status)) throw e; } if (target !== store) return;
    selected = draft.projectId; draw();
    editing.id = draft.projectId; editing.revision = draft.revision; editing.name = draft.baselineName; editing.instructions = draft.baselineInstructions;
    el('name').value = draft.name; el('instructions').value = draft.instructions; restoredDraft = draft;
    keepDraft(); status('已恢复名称与指令草稿，尚未上传。文件采用当前已保存项目版本；原项目已删除时可另存为新项目。');
  });
  el('draft-delete').onclick = () => { try { const draft = draftStore.read(el('drafts').value); if (draft && confirm('删除所选本机编辑草稿？若是当前编辑草稿，也会放弃当前修改；已保存的项目不会删除。')) { const own = editing && draft.key === draftStore.keyFor(editing.id); draftStore.remove(draft.key, draft.raw); if (own) draw(); else renderDrafts(); status('所选本机草稿已删除，其他草稿和已保存项目保留。'); } } catch(e) { status(e.message); } };
  el('delete').onclick = () => run(async store => { if (!discard() || !confirm('删除此项目及其资料、解除关联？聊天和已有引用仍保留。请先导出备份。')) return; await store.remove(selected, editing.revision); if (store !== activeStore()) return; selected = ''; await reloadSaved(store); status('项目已删除，聊天保留。'); });
  el('files').onchange = () => { const files = [...el('files').files]; el('files').value = ''; void run(async store => {
    if (!files.length || !discard()) return;
    const p = structuredClone(editing); if (p.documents.length + files.length > 3) throw Error('每项目最多 3 份资料，请先删除不需要的文件。');
    parseController = new AbortController(); el('parse-cancel').hidden = false; el('parse-cancel').disabled = false;
    try {
      for (const file of files) { const result = await parseDocument(file, { full: true, signal: parseController.signal, progress: status }); p.documents.push({ id: crypto.randomUUID(), name: result.name, sections: result.sections, enabled: true, ...(result.pdfInfo ? {pdfInfo: result.pdfInfo} : {}) }); }
      checkAbort(parseController.signal);
      if (store !== activeStore()) throw Error('账户已切换，本次文件未保存，请在目标账户重新添加。');
      el('parse-cancel').disabled = true;
      await store.save(p); await reloadSaved(store); status('解析文字已保存，后续关联对话可重复引用。PDF 读取情况见各文件详情。');
    } finally { el('parse-cancel').hidden = true; parseController = undefined; }
  }); };
  el('parse-cancel').onclick = () => parseController?.abort();
  el('original-refresh').onclick = () => run(() => refreshOriginals());
  el('original-export-cancel').onclick = () => originalExportController?.abort();
  el('original-export').onclick = () => run(async () => {
    const owner=accountId, client=originalClient(owner), latest=await client.list(), active=latest.files.filter(f=>!f.cleanupPending);
    originals=latest;originalError='';
    if(!active.length)throw Error('当前账户没有可备份的原文件。');
    if(!confirm(`下载当前账户全部 ${active.length} 个原文件的 ZIP 备份（${(active.reduce((n,f)=>n+f.size,0)/1024/1024).toFixed(2)} MiB，加校验清单）？包含已移除项目的原文件，不包含待删除文件；请另行保留项目JSON备份。`))return;
    originalExportController=new AbortController();el('original-export-cancel').hidden=false;el('original-export-cancel').disabled=false;
    try { const blob=await client.export(latest,{signal:originalExportController.signal,progress:status});if(owner!==currentAccount()?.id)throw Error('账户已切换，未下载备份。');download('plaude-originals-'+new Date().toISOString().replace(/[:.]/g,'-')+'.zip',blob,'application/zip');status('全部原文件与ZIP结构校验通过，已交给浏览器下载；请同时保留项目JSON备份。'); }
    finally {originalExportController=undefined;el('original-export-cancel').hidden=true;}
  });
  el('link').onclick = () => run(async store => {
    if (busy()) throw Error('请等待回复完成后关联项目。'); if (!discard()) return;
    const c = active(); if (!c) throw Error('请先打开对话。');
    const previous = snapshot.links.find(l => l.conversationId === c.id);
    if (previous && previous.projectId !== selected && c.messages.length) throw Error('有历史消息的对话不能直接跨项目移动，请在目标项目新建对话。');
    if (c.messages.length && !confirm('关联后将同时使用此对话原有历史及项目资料。继续？')) return;
    await store.link(c.id, selected); await reloadSaved(store); status('当前对话已关联。');
  });
  el('unlink').onclick = () => run(async store => { if (busy()) throw Error('请等待回复完成。'); if (!discard() || !confirm('移出当前对话？已有历史内容仍保留，后续不再自动引用项目资料。')) return; await store.link(active()?.id, null); await reloadSaved(store); status('已解除当前对话关联。'); });
  el('chat').onclick = () => run(async store => { if (!discard()) return; const c = create(); await store.link(c.id, selected); await reloadSaved(store); dialog.close(); });
  el('export').onclick = () => run(async target => { await refresh(); if (target !== store) return; download('plaude-projects-backup.json', JSON.stringify(snapshot, null, 2)); status('已导出已保存的项目，请另行导出聊天备份。'); });
  el('import').onchange = () => { const file = el('import').files[0]; el('import').value = ''; if (file) void run(async store => { if (!discard()) return; if (file.size > PROJECT_BYTES) throw Error('项目备份超过 16 MiB。'); const data = JSON.parse(await file.text()); if (!confirm('导入项目备份及对话关联？相同 ID 的冲突会拒绝。')) return; await store.import(data); await reloadSaved(store); status('项目已导入。'); }); };
  el('refresh').onclick = () => run(async () => { keepDraft(); await reload(); status('已重新读取已保存的项目；本机编辑草稿保留，冲突时可另存为新项目。'); });
  el('migrate').onclick = () => run(async store => {
    if (!accountId || !discard()) return;
    if (!confirm('将此浏览器的旧项目指令和资料复制到当前登录账户？旧资料保留，旧聊天关联不会迁移；导入后可手动关联私有对话。请仅导入属于自己的资料。')) return;
    const local = await localStore.read();
    if (!local.projects.length) { status('当前浏览器没有可导入的本机项目。'); return; }
    await store.import({ ...local, links: [] }); await reloadSaved(store); status('已复制本机项目到当前账户；原本机资料保留，请手动关联私有对话。');
  });
  window.addEventListener('focus', () => { if (!dialog.open && !working) void refresh().catch(() => {}); });
  void refresh().catch(e => toast(e.message));
  function activeStore() { ensureAccount(); return store; }
  function projectForConversation(id) { const link = snapshot.links.find(l => l.conversationId === id); return snapshot.projects.find(p => p.id === link?.projectId); }
  function updateLinkedConversations() {
    let modified = false;
    for (const c of conversations()) {
      const linked = Boolean(projectForConversation(c.id));
      if (linked !== Boolean(c.projectLinked)) { c.projectLinked = linked; modified = true; }
    }
    if (modified) changed();
  }
  return { sync, reload, refresh, projectForConversation, preview(conversation) {ensureAccount();if(loadError)throw Error('项目读取失败，请重新打开项目后核实上下文。');return projectContext(snapshot,conversation);}, list:()=>structuredClone(snapshot.projects), async openProject(id) {if(working||!keepDraft())return;await open();if(!dialog.open)return;if(!snapshot.projects.some(p=>p.id===id)){status('项目已不存在，请重新选择。');return;}selected=id;draw();}, async inherit(sourceId, targetId) { const target = activeStore(); await target.inherit(sourceId, targetId); if (target === store) await refresh(); }, async context(conversation) { const target = activeStore(); await refresh(); if (target !== store) throw Error('账户已切换，请重新发送。'); if (accountId && store.status?.offline) throw Error('云端项目无法连接，请联网后再发送项目资料。'); return projectContext(snapshot, conversation); } };
}
