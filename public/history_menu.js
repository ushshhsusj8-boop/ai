// History rows are rebuilt when their order/title changes. Follow the stable ID,
// but leave deliberate focus moves (search, composer, a new dialog) alone.
export function preserveHistoryFocus(list) {
  const active=document.activeElement,row=active?.closest('.history-row');
  if(!row||!list.contains(row))return;
  const id=row.dataset.conversationId,index=[...list.querySelectorAll('.history-row')].indexOf(row);
  const selector=active.matches('.history-item')?'.history-item':'.history-more-button';
  requestAnimationFrame(()=>{
    const focused=document.activeElement;
    if(document.querySelector('dialog[open]')||(focused!==document.body&&focused?.isConnected))return;
    const rows=[...list.querySelectorAll('.history-row')];
    const target=(rows.find(item=>item.dataset.conversationId===id)||rows[Math.min(index,rows.length-1)])?.querySelector(selector)
      ||document.querySelector('#history-active-filter[aria-pressed="true"], #history-archived-filter[aria-pressed="true"]');
    if(!target||target.disabled||target.closest('[inert], [hidden], dialog:not([open])')||!target.getClientRects().length)return;
    target.focus({preventScroll:true});target.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
  });
}

// One shared dialog keeps history actions reachable without narrowing every title.
export function initHistoryMenu(list) {
  const dialog=document.createElement('dialog');dialog.className='history-action-dialog';
  dialog.setAttribute('aria-label','对话操作');document.body.append(dialog);
  let trigger,restore;
  function close({focus=true}={}) {
    if(dialog.open)dialog.close();
    restore?.();restore=null;
    if(focus && trigger?.isConnected)trigger.focus({preventScroll:true});
    trigger?.setAttribute('aria-expanded','false');trigger=null;
  }
  function position() {
    if(!trigger?.isConnected){close({focus:false});return;}
    const bounds=trigger.getBoundingClientRect(),width=Math.min(220,innerWidth-20),height=dialog.scrollHeight;
    dialog.style.width=width+'px';
    dialog.style.left=Math.max(10,Math.min(innerWidth-width-10,bounds.right-width))+'px';
    dialog.style.top=Math.max(10,Math.min(innerHeight-height-10,bounds.bottom+6))+'px';
  }
  list.addEventListener('click',event=>{
    const button=event.target.closest('.history-more-button');if(!button)return;
    close({focus:false});trigger=button;
    const actions=button.parentElement.querySelector('.history-actions');if(!actions)return;
    const controls=[...actions.children];
    restore=()=>{actions.append(...controls);dialog.replaceChildren();};
    dialog.replaceChildren(...controls);button.setAttribute('aria-expanded','true');
    dialog.showModal();position();dialog.querySelector('button:not(:disabled)')?.focus();
  });
  dialog.addEventListener('click',event=>{
    if(event.target.closest('button'))close();
    else if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close();}
  },true);
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  dialog.addEventListener('keydown',event=>{
    if(event.isComposing||event.keyCode===229)return;
    const buttons=[...dialog.querySelectorAll('button:not(:disabled)')];
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)&&buttons.length){event.preventDefault();
      const at=buttons.indexOf(document.activeElement),next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(at+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[next].focus();}
  });
  new MutationObserver(()=>{if(dialog.open&&!trigger?.isConnected)close({focus:false});}).observe(list,{childList:true});
  window.addEventListener('resize',()=>{if(dialog.open)position();});
  list.addEventListener('scroll',()=>{if(dialog.open)close();},{passive:true});
}
