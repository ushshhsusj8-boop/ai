import {scopedStorage} from './scoped_storage.js';
import {uiPreferences, searchWorkspace} from './ui_state.js';
import {openDocumentReader} from './document_reader.js';
import {initUsageGuide} from './usage_guide.js';
export function initModernUI({conversations, active, select, create, projects, notes, openNote, openWorkspace, openModels, busy, closeSidebar, toast}) {
  const $=s=>document.querySelector(s), node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n;};
  const button=(label,action,cls='ui-nav-button')=>{const b=node('button',cls,label);b.type='button';b.onclick=action;return b;};
  function invoke(id){closeSidebar();const target=$('#'+id);if(!target||target.disabled){toast('此功能当前不可用，请先完成配置或等待任务结束。');return;}document.querySelector('dialog[open]')?.close();target.click();}
  const nav=node('nav','ui-navigation');nav.setAttribute('aria-label','主要功能');$('#new-chat').after(nav);
  const searchButton=button('⌕  搜索与快捷操作',()=>openSearch());searchButton.id='open-global-search';nav.append(searchButton);
  const projectButton=$('#open-projects');projectButton.className='ui-nav-button';projectButton.textContent='▦  项目空间';nav.append(projectButton);
  const writingButton=button('▤  写作画布',()=>{closeSidebar();openNote();});writingButton.id='open-writing-desk';nav.append(writingButton);
  const sidebarTools=node('details','ui-sidebar-tools');sidebarTools.id='sidebar-more-tools';sidebarTools.append(node('summary','','更多工具'));
  const keyboardHelp=$('#open-keyboard-help');keyboardHelp.className='ui-nav-button';
  sidebarTools.append(button('⌘  运行代码',()=>invoke('open-code-runner')),button('✦  提示词库',()=>invoke('open-prompt-library')),keyboardHelp);nav.append(sidebarTools);
  const projectsNav=node('div','ui-sidebar-projects');projectsNav.id='ui-sidebar-projects';nav.after(projectsNav);
  const footer=$('.sidebar-footer'),account=$('#open-account'),accountState=$('#account-sync-state');footer.prepend(account,accountState);
  const settingsButton=button('⚙  设置',()=>settings.showModal());settingsButton.id='open-app-settings';account.before(settingsButton);
  const guide=initUsageGuide({launch:key=>{closeSidebar();const actions={models:()=>modelButton.click(),instructions:()=>invoke('open-instructions'),keyboard:()=>invoke('open-keyboard-help'),account:()=>invoke('open-account'),backup:()=>invoke('open-backup'),prompts:()=>invoke('open-prompt-library'),search:()=>openSearch(),projects:()=>invoke('open-projects'),writing:()=>openNote(),code:()=>invoke('open-code-runner'),logs:()=>invoke('open-activity-log')};actions[key]?.();}});
  const guideButton=button('ⓘ  使用指南',()=>{closeSidebar();guide.open();});guideButton.id='open-usage-guide';
  const footerHelp=node('details','ui-sidebar-help');footerHelp.id='sidebar-help-tools';
  const footerSummary=node('summary','','帮助与连接');footerSummary.setAttribute('aria-expanded','false');footerHelp.append(footerSummary,guideButton,$('.service-state'));settingsButton.before(footerHelp);
  footerHelp.addEventListener('toggle',()=>footerSummary.setAttribute('aria-expanded',String(footerHelp.open)));
  footerHelp.addEventListener('keydown',event=>{if(event.key==='Escape'&&footerHelp.open){event.preventDefault();event.stopPropagation();footerHelp.open=false;footerSummary.focus();}});
  const welcomeGuide=button('了解资料、写作和代码工具',()=>guide.open(),'text-button ui-welcome-guide');welcomeGuide.id='welcome-usage-guide';$('.welcome').append(welcomeGuide);
  $('#history-search').placeholder='筛选对话';$('.history-search-shortcut').textContent='筛选';
  const modelButton=button('选择模型 ⌄',()=>{closeSidebar();openModels(modelButton);},'ui-model-button');modelButton.id='model-launcher';modelButton.setAttribute('aria-haspopup','dialog');modelButton.setAttribute('aria-controls','mobile-tools-dialog');modelButton.setAttribute('aria-expanded','false');$('.topbar .menu-button').after(modelButton);
  const collapse=button('☰',()=>{document.body.classList.toggle('sidebar-collapsed');collapse.setAttribute('aria-expanded',String(!document.body.classList.contains('sidebar-collapsed')));},'icon-button ui-collapse-sidebar');collapse.id='desktop-sidebar-toggle';collapse.setAttribute('aria-label','收起或展开侧栏');collapse.setAttribute('aria-expanded','true');$('.brand-row').append(collapse);
  const expand=button('☰',()=>collapse.click(),'icon-button ui-expand-sidebar');expand.setAttribute('aria-label','展开侧栏');$('.topbar').prepend(expand);
  window.addEventListener('resize',()=>{if(matchMedia('(max-width:760px),(max-width:1024px) and (max-height:500px)').matches){document.body.classList.remove('sidebar-collapsed');collapse.setAttribute('aria-expanded','true');}});
  const tools=node('details','ui-composer-tools');tools.id='composer-tools';const summary=node('summary','','＋');summary.setAttribute('aria-label','添加文件或选择聊天工具');tools.append(summary);
  const menu=node('div','ui-composer-menu');menu.setAttribute('role','group');menu.setAttribute('aria-label','聊天工具');
  const toolActions=[['添加文件 / 图片','attach-text-button'],['项目资料','open-projects'],['对话设定','open-instructions'],['提示词库','open-prompt-library'],['运行代码','open-code-runner']];
  for(const [label,id]of toolActions)menu.append(button(label,()=>{tools.open=false;invoke(id);},'ui-menu-action'));
  const web=button('联网搜索',()=>{const checkbox=$('#web-search-toggle');if(checkbox.disabled){toast($('#web-search-status').textContent);return;}checkbox.click();refresh();},'ui-menu-action');web.id='composer-web-search';web.setAttribute('aria-pressed','false');menu.append(web);
  menu.append(button('更多对话工具  ›',()=>{tools.open=false;invoke('mobile-tools-button');},'ui-menu-action ui-menu-more'));
  const context=node('div','ui-composer-context'),projectChip=button('',()=>invoke('open-projects'),'ui-context-chip'),webChip=button('联网搜索已开启',()=>{tools.open=true;web.focus();},'ui-context-chip');context.setAttribute('aria-label','当前聊天的资料与搜索');context.append(projectChip,webChip);$('#composer').prepend(context);
  $('#web-search-toggle').addEventListener('change',refresh);
  tools.append(menu);$('.composer-actions').prepend(tools);
  document.addEventListener('click',e=>{if(tools.open&&!tools.contains(e.target))tools.open=false;});
  document.addEventListener('focusin',e=>{if(tools.open&&!tools.contains(e.target))tools.open=false;});
  summary.setAttribute('aria-expanded','false');tools.addEventListener('toggle',()=>{summary.setAttribute('aria-expanded',String(tools.open));if(tools.open)toolsPosition();});
  function toolsPosition(){const bounds=summary.getBoundingClientRect();menu.style.maxHeight=Math.max(80,Math.min(400,bounds.top-12))+'px';}
  window.visualViewport?.addEventListener('resize',()=>{if(tools.open)toolsPosition();});
  window.addEventListener('resize',()=>{if(tools.open)toolsPosition();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&tools.open){e.preventDefault();e.stopPropagation();tools.open=false;summary.focus();}},true);
  const search=node('dialog','ui-search-dialog settings-dialog');search.id='global-search-dialog';search.setAttribute('aria-labelledby','global-search-title');
  search.innerHTML='<div class="dialog-card"><div class="dialog-heading"><h2 id="global-search-title">搜索你的工作空间</h2><button type="button" id="global-search-close" class="icon-button" aria-label="关闭全局搜索">×</button></div><label class="sr-only" for="global-search-input">搜索对话、项目、资料和文稿</label><input type="search" id="global-search-input" maxlength="200" autocomplete="off" placeholder="搜索对话内容、项目、资料或文稿…"><div id="global-search-filters" class="ui-search-filters" role="group" aria-label="搜索范围"></div><p class="ui-note" id="global-search-state" role="status"></p><div id="global-search-results"></div><p class="ui-note">仅检索当前空间已载入的资料，不会发送给模型。Ctrl / ⌘ K 打开，↑↓选择，Enter确认。</p></div>';
  document.body.append(search);let kind='all';
  const actions=[['新建对话',()=>create(),'新聊天'],['项目空间',()=>invoke('open-projects'),'项目资料'],['新建文稿',()=>openNote(),'画布写作'],['运行代码',()=>invoke('open-code-runner'),'Python Java'],['运行日志',()=>invoke('open-activity-log'),'日志任务'],['并行任务',()=>invoke('open-parallel-tasks'),'多段同时生成'],['提示词库',()=>invoke('open-prompt-library'),'模板指令'],['设置',()=>settings.showModal(),'主题外观'],['账户与同步',()=>invoke('open-account'),'登录设备私有'],['备份与导入',()=>invoke('open-backup'),'数据导出'],['键盘操作说明',()=>invoke('open-keyboard-help'),'快捷键']];
  actions.push(['使用指南',()=>guide.open(),'如何使用 资料 写作 代码']);
  for(const [value,label]of[['all','全部'],['chat','对话'],['project','项目'],['file','资料'],['note','文稿']]){const b=button(label,()=>{kind=value;drawSearch();},'ui-filter');b.dataset.kind=value;$('#global-search-filters').append(b);}
  const selectResult=result=>{
    search.close();closeSidebar();
    if(result.kind==='chat'){select(result.id);if(result.messageIndex>=0)requestAnimationFrame(()=>{const m=$(`#messages [data-message-index="${result.messageIndex}"]`);m?.classList.add('message-located');m?.scrollIntoView({block:'center'});if(m){m.tabIndex=-1;m.focus({preventScroll:true});setTimeout(()=>m.classList.remove('message-located'),2500);}});}
    else if(result.kind==='note')openNote(undefined,undefined,result.id);
    else if(result.kind==='file'){
      const owner=result.projectId?projects.list().find(p=>p.id===result.projectId):conversations().find(c=>c.id===result.conversationId);
      const doc=owner?.documents?.find(d=>d.id===result.id);
      if(!openDocumentReader(doc,{source:result.source,query:result.query,owner:owner?.name||owner?.title,returnFocus:searchButton}))toast('此资料或匹配位置已经变动，请重新搜索当前内容。');
    }
    else if(result.projectId||result.kind==='project')void projects.openProject(result.projectId||result.id);
    else if(result.conversationId){select(result.conversationId);toast('已打开资料所在对话，点击输入框上方“对话资料”查看原文。');}
  };
  function drawSearch(){
    const query=$('#global-search-input').value,results=searchWorkspace({conversations:conversations(),projects:projects.list(),notes:notes(),query,kind});
    const container=$('#global-search-results');container.replaceChildren();
    for(const b of $('#global-search-filters').children){const chosen=b.dataset.kind===kind;b.classList.toggle('active',chosen);b.setAttribute('aria-pressed',String(chosen));}
    if(kind==='all')for(const [label,action,keywords]of actions)if(!query.trim()|| (label+' '+keywords).toLocaleLowerCase().includes(query.toLocaleLowerCase())){const b=button('',()=>{search.close();closeSidebar();action();},'ui-search-result ui-command-result');b.append(node('span','ui-result-type','操作'),node('strong','',label));container.append(b);}
    for(const result of results){const b=button('',()=>selectResult(result),'ui-search-result');const copy=node('span');copy.append(node('strong','',result.title),node('small','',result.subtitle||'继续此内容'));b.append(node('span','ui-result-type',({chat:'对话',project:'项目',file:'资料',note:'文稿'})[result.kind]),copy);container.append(b);}
    $('#global-search-state').textContent=results.length?`找到 ${results.length} 项${results.length>=60?'（最多显示 60 项，请缩小范围）':''}`:query.trim()?'没有匹配内容，试试其他关键词或范围。':'输入关键词搜索，或选择一个快捷操作。';
  }
  function openSearch(){closeSidebar();tools.open=false;drawSearch();search.showModal();$('#global-search-input').focus();}
  $('#global-search-close').onclick=()=>search.close();$('#global-search-input').oninput=drawSearch;
  search.addEventListener('keydown',e=>{if(e.isComposing||e.keyCode===229)return;const results=[...$('#global-search-results').querySelectorAll('button')];if(['ArrowDown','ArrowUp'].includes(e.key)&&results.length){e.preventDefault();const at=results.indexOf(document.activeElement);results[(at+(e.key==='ArrowDown'?1:-1)+results.length)%results.length].focus();}else if(e.key==='Enter'&&document.activeElement===$('#global-search-input')&&results[0]){e.preventDefault();results[0].click();}});
  const settings=node('dialog','settings-dialog ui-settings-dialog');settings.id='app-settings-dialog';settings.setAttribute('aria-labelledby','app-settings-title');
  settings.innerHTML=`<div class="dialog-card"><div class="dialog-heading"><h2 id="app-settings-title">设置</h2><button type="button" id="app-settings-close" class="icon-button" aria-label="关闭设置中心">×</button></div><p class="ui-note">外观与布局保存在当前浏览器；账户通用指令和长期记忆登录后可跨设备使用。</p><div class="ui-settings-fields"><label>外观<select id="ui-theme"><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label><label>回复字号<select id="ui-text-size"><option value="14">较小 · 14px</option><option value="16">标准 · 16px</option><option value="18">较大 · 18px</option></select></label><label>侧栏密度<select id="ui-density"><option value="comfortable">舒适</option><option value="compact">紧凑</option></select></label></div><label class="ui-reading-width">阅读宽度<select id="ui-reading-width"><option value="standard">标准 · 适合长文阅读</option><option value="wide">宽屏 · 适合代码和表格</option></select></label><p id="ui-preferences-status" role="status"></p><h3>对话与工具</h3><div id="ui-settings-chat" class="ui-settings-links"></div><h3>账户与数据</h3><div id="ui-settings-data" class="ui-settings-links"></div></div>`;
  document.body.append(settings);$('#app-settings-close').onclick=()=>settings.close();
  const legacySize=$('#ws-font-size');if(legacySize){legacySize.closest('label').hidden=true;$('#ws-appearance').append(node('p','ui-note','回复字号与主题请在侧栏“设置”中调整。'));}
  $('#ui-settings-chat').append(button('模型与参数',()=>{settings.close();modelButton.click();},'ui-settings-link'));
  for(const [label,id]of[['对话设定','open-instructions'],['上下文管理','open-context-settings'],['键盘与发送方式','open-keyboard-help']])$('#ui-settings-chat').append(button(label,()=>invoke(id),'ui-settings-link'));
  $('#ui-settings-chat').append(button('模型连接与高级设置',()=>{settings.close();openWorkspace();},'ui-settings-link'));
  $('#ui-settings-chat').append(button('使用指南',()=>{settings.close();guide.open();},'ui-settings-link'));
  for(const [label,id]of[['个人账户与登录设备','open-account'],['备份与导入','open-backup'],['网站访问口令','open-settings'],['旧公共空间','open-shared-conversations'],['字体切换','font-toggle']])$('#ui-settings-data').append(button(label,()=>invoke(id),'ui-settings-link'));
  let preferences;try{preferences=uiPreferences(JSON.parse(scopedStorage.getItem('plaude-ui-preferences-v1')||'{}'));}catch{preferences=uiPreferences();}
  const dark=matchMedia('(prefers-color-scheme: dark)');
  function apply(){const theme=preferences.theme==='system'?(dark.matches?'dark':'light'):preferences.theme;document.documentElement.dataset.theme=theme;document.documentElement.dataset.density=preferences.density;document.body.dataset.readingWidth=preferences.readingWidth;document.documentElement.style.setProperty('--message-font-size',preferences.textSize+'px');document.querySelector('meta[name="theme-color"]').content=theme==='dark'?'#212121':'#ffffff';$('#ui-theme').value=preferences.theme;$('#ui-density').value=preferences.density;$('#ui-text-size').value=String(preferences.textSize);$('#ui-reading-width').value=preferences.readingWidth;}
  for(const id of ['#ui-theme','#ui-density','#ui-text-size','#ui-reading-width'])$(id).onchange=()=>{const next=uiPreferences({theme:$('#ui-theme').value,density:$('#ui-density').value,textSize:Number($('#ui-text-size').value),readingWidth:$('#ui-reading-width').value});try{scopedStorage.setItem('plaude-ui-preferences-v1',JSON.stringify(next));preferences=next;apply();$('#ui-preferences-status').textContent='偏好已保存到此浏览器。';}catch{$('#ui-preferences-status').textContent='浏览器无法保存偏好，原设置保留。';apply();}};
  dark.addEventListener('change',()=>{if(preferences.theme==='system')apply();});apply();
  function refresh(){
    const model=$('#model-id-select');modelButton.textContent=(model.selectedOptions[0]?.textContent||'选择模型')+' ⌄';modelButton.disabled=model.disabled;modelButton.title=modelButton.textContent;
    const conversation=active();document.body.classList.toggle('chat-empty',!conversation?.messages?.length);document.body.classList.toggle('chat-generating',busy());
    web.textContent=$('#web-search-toggle').checked?'联网搜索 · 已开启':'联网搜索';web.setAttribute('aria-pressed',String($('#web-search-toggle').checked));
    webChip.hidden=!$('#web-search-toggle').checked;const project=projects.projectForConversation(conversation?.id);projectChip.hidden=!project;projectChip.textContent=project?'项目 · '+project.name:'';context.hidden=projectChip.hidden&&webChip.hidden;
    projectsNav.replaceChildren();const list=projects.list();if(list.length){projectsNav.append(node('span','ui-section-label','项目'));for(const p of list.slice(0,5))projectsNav.append(button(p.name,()=>{closeSidebar();void projects.openProject(p.id);},'ui-project-link'));}
  }
  for(const id of ['#provider-select','#model-id-select']){const s=$(id);s.addEventListener('change',refresh);new MutationObserver(refresh).observe(s,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled']});}
  new MutationObserver(refresh).observe($('#project-context'),{childList:true,subtree:true});
  refresh();return{refresh,openSearch};
}
