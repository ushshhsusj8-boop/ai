// Reuse the existing controls so mobile and desktop share state and handlers.
export function initMobileLayout() {
  const media = matchMedia('(max-width: 760px), (max-width: 1024px) and (max-height: 500px)');
  const header = document.querySelector('.topbar');
  const trigger = document.createElement('button');
  trigger.id = 'mobile-tools-button'; trigger.className = 'secondary-button mobile-tools-button'; trigger.type = 'button';
  trigger.textContent = '···'; trigger.setAttribute('aria-label', '展开对话工具'); trigger.title = '对话工具'; trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-controls', 'mobile-tools-dialog'); trigger.setAttribute('aria-expanded', 'false');
  header.append(trigger);
  const model = document.createElement('span'); model.className = 'mobile-model-name';
  document.querySelector('.chat-context').append(model);
  const dialog = document.createElement('dialog'); dialog.id = 'mobile-tools-dialog'; dialog.className = 'mobile-tools-dialog';
  dialog.setAttribute('aria-labelledby', 'mobile-tools-title');
  dialog.innerHTML = `<div class="mobile-tools-heading"><h2 id="mobile-tools-title">对话工具</h2><button type="button" class="icon-button" aria-label="关闭对话工具">×</button></div><section class="chat-tool-shortcuts" aria-label="常用对话工具"></section><details class="mobile-model-tools ui-tools-section"><summary>模型与参数</summary></details><details class="mobile-chat-tools ui-tools-section"><summary>提示词与显示方式</summary></details><details class="mobile-input-tools ui-tools-section"><summary>语音与对话信息</summary></details><details class="mobile-more-tools ui-tools-section"><summary>更多设置与数据</summary></details>`;
  document.body.append(dialog);
  const shortcuts = dialog.querySelector('.chat-tool-shortcuts');
  for (const [label, id] of [['对话设定','open-instructions'],['上下文管理','open-context-settings'],['提示词库','open-prompt-library'],['查找对话','open-conversation-search'],['运行代码','open-code-runner'],['运行日志','open-activity-log'],['并行任务','open-parallel-tasks'],['模型连接与设置','workspace-menu-button']]) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'chat-tool-shortcut'; button.textContent = label; button.dataset.target = id;
    button.onclick = () => { const target = document.getElementById(id); if (target && !target.disabled) { close(); target.click(); } };
    shortcuts.append(button);
  }
  let returnFocus = trigger;
  const close = () => dialog.open && dialog.close();
  function position() {
    const bounds = returnFocus.getBoundingClientRect(), viewport = window.visualViewport;
    const width = viewport?.width || innerWidth, height = viewport?.height || innerHeight;
    const left = Math.max(12, Math.min(bounds.left, width - dialog.getBoundingClientRect().width - 12));
    const top = Math.min(bounds.bottom + 8, Math.max(12, height - 140));
    dialog.style.left = left + 'px'; dialog.style.top = top + 'px'; dialog.style.maxHeight = Math.max(100, height - top - 12) + 'px';
  }
  function open(mode = 'tools', origin = trigger) {
    if (dialog.open) close();
    returnFocus = origin;
    dialog.dataset.mode = mode;
    dialog.querySelector('#mobile-tools-title').textContent = mode === 'models' ? '选择模型' : '对话工具';
    shortcuts.hidden = mode === 'models';
    for (const details of dialog.querySelectorAll('.ui-tools-section')) {
      details.open = mode === 'models' && details.classList.contains('mobile-model-tools');
      details.hidden = mode === 'models' && !details.classList.contains('mobile-model-tools');
    }
    for (const button of shortcuts.querySelectorAll('[data-target]')) {
      const target = document.getElementById(button.dataset.target); button.disabled = !target || target.disabled;
    }
    dialog.showModal(); position();
    trigger.setAttribute('aria-expanded', 'true');
    origin.setAttribute('aria-expanded', 'true');
    if (mode === 'models') document.querySelector('#provider-select').focus();
  }
  trigger.onclick = () => open();
  dialog.querySelector('.mobile-tools-heading button').onclick = close;
  dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close(); } });
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    trigger.setAttribute('aria-expanded', 'false'); returnFocus.setAttribute('aria-expanded', 'false');
    requestAnimationFrame(() => { if (!document.querySelector('dialog[open]') && returnFocus.getClientRects().length) returnFocus.focus({ preventScroll: true }); });
  });
  // Close first when a tool opens its own dialog, preserving normal modal focus.
  dialog.addEventListener('click', event => { if (event.target.closest('button') && !event.target.closest('.mobile-tools-heading')) close(); }, true);
  const moves = [];
  const composer = document.querySelector('#composer');
  const attachments = document.createElement('details'); attachments.className = 'mobile-attachments';
  const summary = document.createElement('summary');
  const attachmentBody = document.createElement('div'); attachmentBody.className = 'mobile-attachments-body';
  attachments.append(summary, attachmentBody); document.querySelector('#prompt-input').before(attachments);
  function move(selector, section) {
    const node = document.querySelector(selector);
    if (!node) return;
    if (node.matches('button[role="menuitem"]')) node.removeAttribute('role');
    const home = document.createComment('mobile control home'); node.before(home);
    moves.push({node, home, section: dialog.querySelector(section)});
  }
  for (const s of ['.model-control', '.model-id-control', '#open-model-parameters', '#model-note']) move(s, '.mobile-model-tools');
  move('.topbar-search-control', '.chat-tool-shortcuts');
  for (const s of ['.workbench-quickbar', '#project-context']) move(s, '.mobile-chat-tools');
  for (const s of ['.workspace-control', '#export-chat', '#archive-chat', '#open-backup', '#open-api-access', '#open-shared-conversations', '#delete-current-chat']) move(s, '.mobile-more-tools');
  for (const s of ['#voice-language', '.voice-help', '.composer-topline', '.fine-print']) move(s, '.mobile-input-tools');
  for (const selector of ['#image-draft-tray', '#vision-model-hint', '#document-library']) {
    const node = document.querySelector(selector);
    if (!node) continue;
    const home = document.createComment('attachment home'); node.before(home);
    moves.push({node, home, section: attachmentBody});
  }
  function syncAttachments() {
    const documents = document.querySelectorAll('#document-library .document-library-row').length;
    const images = document.querySelectorAll('#image-draft-tray .image-draft-card').length;
    const label = [documents && `${documents} 份文件`, images && `${images} 张图片`].filter(Boolean).join(' · ');
    const text = label ? `对话资料 · ${label} · ${attachments.open ? '收起' : '展开查看'}` : '对话资料';
    if (summary.textContent !== text) summary.textContent = text;
    if (attachments.hidden !== !label) attachments.hidden = !label;
    if (!label) attachments.open = false;
  }
  attachments.addEventListener('toggle', syncAttachments);
  new MutationObserver(syncAttachments).observe(composer, {childList: true, subtree: true, attributes: true, attributeFilter: ['hidden']});
  const voiceStatus = document.querySelector('#voice-status');
  if (voiceStatus.dataset.passive === 'true') {
    const help = document.createElement('p'); help.className = 'mobile-voice-help'; help.textContent = voiceStatus.textContent;
    dialog.querySelector('.mobile-input-tools').append(help);
  }
  function syncModel() {
    const select = document.querySelector('#model-id-select');
    model.textContent = select.selectedOptions[0]?.textContent || '选择模型'; model.title = model.textContent;
  }
  for (const id of ['#provider-select', '#model-id-select']) {
    const select = document.querySelector(id);
    select.addEventListener('change', syncModel);
    new MutationObserver(syncModel).observe(select, {childList: true, subtree: true, attributes: true});
  }
  function viewport() {
    const v = window.visualViewport;
    document.body.classList.toggle('mobile-short-viewport', media.matches && (v?.height || innerHeight) <= 500);
    if (media.matches && v && Math.abs(v.scale - 1) < .05) document.documentElement.style.setProperty('--chat-viewport-height', `${v.height}px`);
    else document.documentElement.style.removeProperty('--chat-viewport-height');
  }
  let mobileMode;
  function layout() {
    close();
    for (const {node, home, section} of moves) {
      // One tools surface on both desktop and phone; avoid filling the chat header.
      section.append(node);
    }
    document.body.classList.toggle('mobile-chat-layout', media.matches);
    mobileMode = media.matches;
    syncModel(); syncAttachments(); viewport();
  }
  media.addEventListener('change', layout);
  window.visualViewport?.addEventListener('resize', () => { viewport(); if (dialog.open) position(); });
  window.addEventListener('resize', () => {
    if (mobileMode !== media.matches) layout();
    else { viewport(); if (dialog.open) position(); }
  });
  layout();
  return { open };
}
