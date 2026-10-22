import {codeFileDraft,codeErrorLines,codeLineRange} from './code_workspace_tools.js';
import {sectionMatches} from './document_search.js';
import {getStorageScope} from './scoped_storage.js';
import {artifactBytes,artifactDownloadName} from './code_artifact_tools.js';

export function initCodeWorkspace({runner,last,busy,download,toast,artifacts=()=>({files:[],notice:''})}) {
  const $=id=>runner.querySelector('#'+id),node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const button=(id,text,action)=>{const b=node('button','secondary-button',text);b.id=id;b.type='button';b.onclick=action;return b;};
  const card=runner.querySelector('.dialog-card'),heading=card.querySelector('.dialog-heading'),help=card.querySelector('.ws-help'),runActions=$('code-run').parentElement;
  $('code-runner-title').textContent='代码工作区';
  const top=node('div','code-workspace-top');top.append(heading,runActions);card.prepend(top);
  const tabs=node('div','code-workspace-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','代码工作区页面');
  const panels=node('div','code-workspace-panels'),editor=node('section','code-workspace-editor'),results=node('section','code-workspace-results'),history=card.querySelector('.code-history');
  const panes={editor,results,history},buttons={};
  for(const [key,label]of[['editor','代码与输入'],['results','运行结果'],['history','历史记录']]){const b=button('code-tab-'+key,label,()=>view(key));b.setAttribute('role','tab');b.setAttribute('aria-controls','code-pane-'+key);const pane=panes[key];pane.id='code-pane-'+key;pane.setAttribute('role','tabpanel');pane.setAttribute('aria-labelledby',b.id);tabs.append(b);panels.append(pane);buttons[key]=b;}
  top.append(tabs);card.append(panels);
  const languageActions=$('code-language').closest('.code-runner-actions'),sourceLabel=card.querySelector('label[for="code-source"]'),stdinLabel=card.querySelector('label[for="code-stdin"]'),source=$('code-source'),stdin=$('code-stdin');
  const editorTools=node('div','code-runner-actions'),importInput=node('input');importInput.id='code-file-input';importInput.type='file';importInput.accept='.py,.java,.txt';importInput.hidden=true;
  const importButton=button('code-import-source','导入代码文件',()=>importInput.click()),exportButton=button('code-export-source','下载代码文件',()=>download(source.value,$('code-language').value==='java'?'Main.java':'main.py'));
  editorTools.append(importButton,exportButton,importInput);
  const count=node('p','ws-help');count.id='code-editor-count';count.setAttribute('role','status');
  const editorGrid=node('div','code-workspace-editor-grid'),codePane=node('div'),inputPane=node('div'),sourceBox=node('div','code-source-box'),gutter=node('pre','code-line-numbers');gutter.setAttribute('aria-hidden','true');
  sourceBox.append(gutter,source);codePane.append(sourceLabel,sourceBox,count);inputPane.append(stdinLabel,stdin,help,node('p','ws-help','Ctrl / Command + Enter 运行当前代码。运行前请检查标准输入；导入、载入历史或定位错误行都不会自动执行。'));
  editorGrid.append(codePane,inputPane);editor.append(languageActions,editorTools,editorGrid);
  const outputGrid=node('div','code-workspace-output-grid'),stdoutPane=node('section'),stderrPane=node('section');stdoutPane.append($('code-result-caption').previousElementSibling,$('code-stdout'));stderrPane.append($('code-stderr').previousElementSibling,$('code-stderr'));
  // Caption was previously directly above stdout; move it to the results header.
  const caption=$('code-result-caption');results.append(caption);
  const outputTools=node('div','code-runner-actions'),copyOutput=button('code-copy-output','复制标准输出',async()=>{try{await navigator.clipboard.writeText(last()?.stdout||'');toast('标准输出已复制。');}catch{toast('浏览器无法复制，请下载结果。');}}),downloadOutput=button('code-export-output','下载标准输出',()=>download(last()?.stdout||'','plaude-output.txt'));
  const wrap=button('code-output-wrap','自动换行：开',()=>{const enabled=!results.classList.toggle('code-output-nowrap');wrap.textContent='自动换行：'+(enabled?'开':'关');wrap.setAttribute('aria-pressed',String(enabled));});wrap.setAttribute('aria-pressed','true');outputTools.append(copyOutput,downloadOutput,wrap);
  const findLabel=node('label','','查找输出'),find=node('input');find.id='code-output-search';find.type='search';find.maxLength=200;find.placeholder='查找标准输出和错误输出';findLabel.append(find);const findState=node('p','ws-help');findState.id='code-output-search-status';findState.setAttribute('role','status');
  const errorNav=node('div','code-error-lines');errorNav.id='code-error-lines';errorNav.setAttribute('aria-label','错误行定位');stderrPane.append(errorNav);
  results.append(outputTools,findLabel,findState,outputGrid);outputGrid.append(stdoutPane,stderrPane);results.append($('code-insert-result').parentElement);
  const filePanel=node('section','code-generated-files'),fileList=node('div','code-runner-actions'),fileState=node('p','ws-help');fileState.id='code-file-status';fileState.setAttribute('role','status');fileList.id='code-generated-file-list';
  filePanel.append(node('h3','','生成文件'),node('p','ws-help','程序须将文件写入 output 文件夹。最多4个常规文件，单个64 KiB、总计256 KiB。下载仅在本次结果保留15分钟，新运行或刷新后失效；请及时下载。'),fileState,fileList);results.append(filePanel);
  $('code-stdout').tabIndex=$('code-stderr').tabIndex=0;
  function view(key){for(const [name,pane]of Object.entries(panes)){pane.hidden=name!==key;buttons[name].setAttribute('aria-selected',String(name===key));buttons[name].tabIndex=name===key?0:-1;}runner.dataset.codePane=key;}
  tabs.onkeydown=e=>{if(e.isComposing||e.keyCode===229)return;const names=Object.keys(buttons),at=names.findIndex(k=>buttons[k]===document.activeElement);if(at<0)return;let next;if(e.key==='ArrowRight')next=(at+1)%3;else if(e.key==='ArrowLeft')next=(at+2)%3;else if(e.key==='Home')next=0;else if(e.key==='End')next=2;else return;e.preventDefault();view(names[next]);buttons[names[next]].focus();};
  function editorState(){const lines=source.value.split('\n').length;gutter.textContent=Array.from({length:lines},(_,i)=>i+1).join('\n');gutter.scrollTop=source.scrollTop;count.textContent=`${lines} 行 · ${new TextEncoder().encode(source.value).length} / 32768 字节 · ${$('code-language').value==='java'?'Main.java':'main.py'}`;}
  source.addEventListener('input',editorState);source.addEventListener('scroll',()=>{gutter.scrollTop=source.scrollTop;});
  importInput.onchange=async()=>{const file=importInput.files[0];importInput.value='';if(!file||busy())return;const scope=getStorageScope(),before=source.value,language=$('code-language').value;
    try{if(file.size>32768)throw Error('代码文件最多32 KiB。');const draft=codeFileDraft(file.name,await file.text(),language);if(busy()||scope!==getStorageScope()||source.value!==before||$('code-language').value!==language)throw Error('编辑内容或账户已经改变，未覆盖，请重新导入。');if(before.trim()&&before!==draft.code&&!confirm('用此文件替换编辑区代码？如需保留当前脚本，请先下载代码文件。'))return;$('code-language').value=draft.language;source.value=draft.code;source.dispatchEvent(new Event('input'));view('editor');source.focus();toast('代码文件已载入，标准输入保留；检查后再运行。');}catch(error){toast(error.message);}};
  function paintOutput(){const value=last(),query=find.value.trim();let total=0;for(const [id,text]of[['code-stdout',value?.resultReceived?value.stdout||'（无输出）':value?'没有收到完整结果，服务器实际执行结果未知。':busy()?'等待结果…':'尚未运行'],['code-stderr',value?.stderr||value?.error||(busy()?'—':'（无错误输出）')]]){const pre=$(id);pre.replaceChildren();const ranges=query?sectionMatches(text,[query]):[];let start=0;for(const range of ranges){pre.append(document.createTextNode(text.slice(start,range.offset)));const mark=node('mark','',text.slice(range.offset,range.offset+range.length));pre.append(mark);start=range.offset+range.length;}pre.append(document.createTextNode(text.slice(start)));total+=ranges.length;}
    findState.textContent=query?(total?`高亮 ${total} 处${total>=2000?'（最多每项2000处）':''}`:'没有匹配内容。'):'';
  }
  find.oninput=paintOutput;
  function refresh(){editorState();const value=last(),running=busy(),same=value&&value.code===source.value&&value.language===$('code-language').value;
    fileList.replaceChildren();const available=artifacts();fileState.textContent=available.notice||(available.files.length?`可下载 ${available.files.length} 个文件（不自动打开）`:'本次没有可下载的生成文件。');
    for(const file of available.files){const b=button('code-generated-file-'+fileList.children.length,`${file.name} · ${file.size} 字节`,()=>{
      const current=artifacts().files.find(item=>item.name===file.name);if(busy()||!current){toast('生成文件已失效或正在运行，请检查当前结果。');refresh();return;}
      download(artifactBytes(current),artifactDownloadName(current.name),'application/octet-stream');
    });b.disabled=running;fileList.append(b);}
    importButton.disabled=exportButton.disabled=running;copyOutput.disabled=downloadOutput.disabled=running||!value?.resultReceived;errorNav.replaceChildren();
    if(same&&!running)for(const line of codeErrorLines(value.language,value.stderr,value.code)){errorNav.append(button('code-error-line-'+line,'查看第 '+line+' 行',()=>{const range=codeLineRange(source.value,line);if(!range||busy()||last()?.code!==source.value)return;view('editor');source.focus();source.setSelectionRange(range.start,range.end);source.scrollTop=Math.max(0,(line-3)*parseFloat(getComputedStyle(source).lineHeight));gutter.scrollTop=source.scrollTop;}));}
    paintOutput();
  }
  runner.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&!e.isComposing&&e.keyCode!==229&&['code-source','code-stdin'].includes(e.target.id)){e.preventDefault();if(!$('code-run').disabled)$('code-run').click();}});
  const saveState=node('p','ws-help');saveState.id='code-workspace-save-state';saveState.setAttribute('role','status');top.append(saveState);
  view('editor');refresh();return {view,refresh,status:message=>{saveState.textContent=message;}};
}
