import {documentMatches,sectionMatches,searchTerms} from './document_search.js';
import {pdfCoverage} from './pdf_coverage.js';

/** Read a snapshot of one already-loaded document; never send it to a model. */
export function openDocumentReader(doc,{source=null,query='',owner='',returnFocus=null}={}) {
  if(!doc?.sections?.length)return null;
  if(source){const section=doc.sections[source.sectionIndex];if(source.documentId!==doc.id||!section||section.label!==source.location||section.text.slice(source.offset,source.offset+source.text.length)!==source.text)return null;}
  doc=structuredClone(doc);
  const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const button=(text,action)=>{const b=node('button','secondary-button',text);b.type='button';b.onclick=action;return b;};
  const dialog=node('dialog','source-reader document-reader');dialog.id='document-reader';dialog.setAttribute('aria-label','资料阅读器');
  const header=node('div','document-reader-header'),heading=node('h2','',doc.name),close=button('关闭原文',()=>dialog.close());close.id='document-reader-close';header.append(heading,close);
  const ownerLabel=node('p','ui-note',owner?`来源：${owner} · 当前已保存的文字快照`:'当前已保存的文字快照');
  const controls=node('div','document-reader-controls'),label=node('label','','页码 / 段落'),select=node('select');select.id='document-reader-section';
  doc.sections.forEach((s,index)=>{const option=node('option','',s.label);option.value=index;select.append(option);});label.append(select);
  const searchLabel=node('label','','查找此资料'),input=node('input');input.type='search';input.id='document-reader-query';input.maxLength=200;input.placeholder='输入关键词，多个词用空格分隔';input.value=query;searchLabel.append(input);controls.append(label,searchLabel);
  const navigation=node('div','document-reader-navigation'),previous=button('上一处',()=>step(-1)),next=button('下一处',()=>step(1)),status=node('span','ui-note');status.id='document-reader-status';status.setAttribute('role','status');navigation.append(previous,next,status);
  const info=node('p','ui-note','显示保存的解析文字；PDF按页、其他资料按段落定位。查找要求同页或同段包含全部关键词，最多定位2000处。');
  const content=node('pre');content.id='document-reader-content';content.tabIndex=0;content.setAttribute('aria-label','资料原文');
  const coverage=node('p','ui-note',pdfCoverage(doc.pdfInfo));coverage.id='document-reader-coverage';coverage.hidden=!doc.pdfInfo;
  dialog.append(header,ownerLabel,coverage,controls,navigation,info,content);document.body.append(dialog);
  let sectionIndex=source?.sectionIndex||0,matches=documentMatches(doc,query),current=source?matches.findIndex(m=>m.sectionIndex===sectionIndex&&m.offset===source.offset):-1;
  if(!source&&matches.length){current=0;sectionIndex=matches[0].sectionIndex;}
  function draw() {
    select.value=sectionIndex;content.replaceChildren();const section=doc.sections[sectionIndex];
    let ranges=sectionMatches(section.text,searchTerms(input.value));
    if(!input.value.trim()&&source&&sectionIndex===source.sectionIndex)ranges=[{offset:source.offset,length:source.text.length}];
    let start=0,activeMark;
    for(const range of ranges){content.append(document.createTextNode(section.text.slice(start,range.offset)));const mark=node('mark','',section.text.slice(range.offset,range.offset+range.length));if(matches[current]?.sectionIndex===sectionIndex&&matches[current]?.offset===range.offset){mark.className='document-reader-current';activeMark=mark;}content.append(mark);start=range.offset+range.length;}
    content.append(document.createTextNode(section.text.slice(start)));
    previous.disabled=next.disabled=!matches.length;
    status.textContent=input.value.trim()?(matches.length?`${current>=0?current+1:'—'} / ${matches.length}${matches.length>=2000?'（已到定位上限）':''} · ${section.label}`:`没有匹配内容 · ${section.label}`):`${section.label} · 已保存 ${doc.sections.length} 页 / 段`;
    requestAnimationFrame(()=>{if(!dialog.open)return;const target=activeMark||content.querySelector('mark');if(target)content.scrollTop=Math.max(0,target.offsetTop-content.offsetTop-24);else content.scrollTop=0;});
  }
  function step(direction){if(!matches.length)return;current=(current+direction+matches.length)%matches.length;sectionIndex=matches[current].sectionIndex;draw();}
  select.onchange=()=>{sectionIndex=Number(select.value);current=matches.findIndex(m=>m.sectionIndex===sectionIndex);draw();};
  let timer;
  input.oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>{matches=documentMatches(doc,input.value);current=matches.length?0:-1;if(matches.length)sectionIndex=matches[0].sectionIndex;draw();},120);};
  input.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing&&e.keyCode!==229){e.preventDefault();clearTimeout(timer);const fresh=documentMatches(doc,input.value);const changed=fresh.length!==matches.length||fresh[0]?.text!==matches[0]?.text;matches=fresh;if(changed){current=0;if(matches.length)sectionIndex=matches[0].sectionIndex;draw();}else step(e.shiftKey?-1:1);}};
  dialog.addEventListener('close',()=>{clearTimeout(timer);dialog.remove();if(returnFocus?.isConnected&&!returnFocus.closest('dialog:not([open])'))returnFocus.focus({preventScroll:true});},{once:true});
  draw();dialog.showModal();close.focus();return dialog;
}
