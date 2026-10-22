// Keep native modal/Escape semantics; wrap Tab within the page controls.
export function initAccessibility() {
  const visible = node => node?.isConnected && !node.closest('[inert], [hidden]') && node.getClientRects().length > 0;
  const origins = new WeakMap();
  document.addEventListener('keydown', event => {
    const dialog = document.activeElement?.closest('dialog[open]') || [...document.querySelectorAll('dialog[open]')].at(-1);
    if (dialog) trapSidebarTab(event, dialog);
  }, true);
  document.addEventListener('beforetoggle', event => {
    if (event.target instanceof HTMLDialogElement && event.newState === 'open') {
      origins.set(event.target, document.activeElement);
    }
  }, true);
  document.addEventListener('close', event => {
    if (!(event.target instanceof HTMLDialogElement)) return;
    requestAnimationFrame(() => {
      if (document.querySelector('dialog[open]')) return;
      const active = document.activeElement;
      if (active !== document.body && visible(active) && !active.closest('dialog:not([open])')) return;
      const origin = origins.get(event.target);
      // Tools move back into a closed dialog on mobile. Return to its visible trigger.
      const target = visible(origin) && !origin.closest('dialog:not([open])') ? origin
        : visible(document.querySelector('#mobile-tools-button')) ? document.querySelector('#mobile-tools-button')
          : document.querySelector('#prompt-input');
      if (visible(target)) target.focus({preventScroll: true});
    });
  }, true);
  document.querySelector('#open-keyboard-help').addEventListener('click', () => document.querySelector('#keyboard-help-dialog').showModal());
  document.querySelector('#close-keyboard-help').addEventListener('click', () => document.querySelector('#keyboard-help-dialog').close());
  document.querySelector('#import-prompt-library').addEventListener('click', () => document.querySelector('#import-prompt-library-file').click());
}

export function trapSidebarTab(event, sidebar) {
  if (event.key !== 'Tab') return;
  const controls = [...sidebar.querySelectorAll('a[href], button, input, select, textarea, summary, [tabindex]')]
    .filter(node => !node.disabled && node.tabIndex >= 0 && !node.closest('[hidden], [inert]') && node.getClientRects().length);
  const first = controls[0], last = controls.at(-1);
  if (!first) { event.preventDefault(); return; }
  if (!sidebar.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
    event.preventDefault(); (event.shiftKey ? last : first).focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault(); first.focus();
  }
}
