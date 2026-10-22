// Final speech segments enter the draft once; interim speech stays outside it.
export function createVoiceSession({ Recognition, input, context, busy, changed, status, active, timer = setTimeout, clearTimer = clearTimeout }) {
  let session;
  function cancel(message = '') {
    const old = session; session = undefined;
    if (old) { clearTimer(old.timeout); try { old.recognition.abort(); } catch {} }
    active(false); if (message && old) status(message);
  }
  function sync() {
    if (session && (session.context !== context() || busy() || input.value !== session.expected)) cancel('语音输入已停止，已识别的草稿保留。');
  }
  function start(language = 'zh-CN') {
    if (session || busy()) return;
    let recognition;
    try { recognition = new Recognition(); } catch { status('当前浏览器无法启动语音识别，请使用键盘输入。'); return; }
    const current = { recognition, context: context(), expected: input.value, cursor: input.selectionStart ?? input.value.length,
      end: input.selectionEnd ?? input.value.length, handled: new Set(), stopping: false };
    session = current;
    const valid = () => { sync(); return session === current; };
    recognition.lang = language; recognition.continuous = true; recognition.interimResults = true;
    recognition.onstart = () => { if (valid()) status('正在聆听…识别内容会放入草稿，不会自动发送。'); };
    recognition.onresult = event => {
      if (!valid()) return;
      let interim = '';
      for (let index = 0; index < event.results.length; index++) {
        const result = event.results[index], text = result[0]?.transcript || '';
        if (!result.isFinal) { interim += text; continue; }
        if (current.handled.has(index)) continue;
        current.handled.add(index);
        const room = Math.max(0, (input.maxLength > 0 ? input.maxLength : 12000) - (input.value.length - (current.end - current.cursor)));
        const accepted = text.slice(0, room);
        input.value = input.value.slice(0, current.cursor) + accepted + input.value.slice(current.end);
        current.cursor += accepted.length; current.end = current.cursor; current.expected = input.value;
        input.setSelectionRange(current.cursor, current.cursor); changed();
        if (accepted.length < text.length) { cancel('草稿已达到字数上限，语音输入已停止；请检查末尾文字。'); return; }
      }
      if (valid()) status(interim ? `识别中：${interim.slice(0, 200)}` : current.stopping ? '正在结束识别…' : '正在聆听…已识别文字已保存为草稿。');
    };
    recognition.onerror = event => {
      if (!valid()) return;
      const messages = { 'not-allowed': '未获得麦克风权限，请在浏览器地址栏允许麦克风后重试。', 'service-not-allowed': '浏览器不允许语音识别服务，请更换支持的浏览器。',
        'audio-capture': '未找到可用的麦克风，请检查设备连接。', network: '浏览器语音服务连接失败，请检查网络或改用键盘输入。',
        'no-speech': '没有识别到语音，请点击语音输入重试。', 'language-not-supported': '浏览器不支持所选识别语言。', aborted: '语音输入已停止。' };
      cancel(`${messages[event.error] || '语音识别失败，请重试或使用键盘输入。'} 已有草稿保留。`);
    };
    recognition.onend = () => { if (session === current) { clearTimer(current.timeout); session = undefined; active(false); status('语音输入已结束，请检查草稿后发送。'); } };
    current.timeout = timer(() => { if (session === current) stop(); }, 120000);
    active(true); status('正在申请麦克风权限…');
    try { recognition.start(); } catch { cancel('无法启动语音输入，请检查浏览器权限或使用键盘输入。'); }
  }
  function stop() {
    if (!session || session.stopping) return;
    session.stopping = true; clearTimer(session.timeout);
    const current = session;
    current.timeout = timer(() => { if (session === current) cancel('语音输入已停止，已有草稿保留。'); }, 5000);
    status('正在结束识别…'); try { current.recognition.stop(); } catch { cancel('语音输入已停止。'); }
  }
  return { start, stop, cancel, sync, isActive: () => Boolean(session) };
}

export function initVoiceComposer(callbacks) {
  const input = document.querySelector('#prompt-input'), button = document.querySelector('#voice-input'), language = document.querySelector('#voice-language'), notice = document.querySelector('#voice-status');
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const supported = Boolean(Recognition && window.isSecureContext);
  const session = createVoiceSession({ Recognition, input, ...callbacks,
    status: message => { notice.textContent = message; notice.dataset.passive = 'false'; },
    active: value => { button.textContent = value ? '■ 停止听写' : '语音输入'; button.title = value ? '停止听写' : '语音输入'; button.setAttribute('aria-pressed', String(value)); language.disabled = value || callbacks.busy(); },
  });
  if (!supported) { button.disabled = true; language.disabled = true; notice.dataset.passive = 'true'; notice.textContent = '当前浏览器不支持语音输入。请使用支持语音识别的浏览器，通过 HTTPS 打开；也可继续键盘输入。'; button.title = notice.textContent; }
  button.onclick = () => session.isActive() ? session.stop() : session.start(language.value);
  input.addEventListener('input', () => { if (session.isActive()) session.cancel('已切换为手动编辑，语音输入停止。'); });
  window.addEventListener('pagehide', () => session.cancel());
  return { cancel: session.cancel, sync: () => { session.sync(); button.disabled = !supported || callbacks.busy(); language.disabled = !supported || callbacks.busy() || session.isActive(); } };
}
