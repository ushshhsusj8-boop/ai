import {getLimits} from './site_limits.js';
import {inspectOriginalBackup,planOriginalRestore} from './original_restore.js';
export function initOriginalRestorePanel({dialog,parent,run,working,currentAccount,client,accept,projects,status}) {
  const section=document.createElement('section');section.id='project-original-restore';
  section.innerHTML=`<h4>从原文件ZIP恢复</h4><p class="project-note">只接受本站导出的同账户ZIP，先完整校验并预览，确认后整批追加。相同文件跳过，现有内容冲突则整批不恢复。缺失项目只恢复到私有保管区，不猜测关联；解析资料、项目和聊天仍需另存JSON。</p><div class="project-actions"><button type="button" id="original-restore-choose">选择并预览原文件ZIP</button><input id="original-restore-file" type="file" accept=".zip,application/zip" hidden><button type="button" id="original-restore-abort" hidden>取消校验或恢复</button></div><section id="original-restore-preview" hidden aria-labelledby="original-restore-title"><h4 id="original-restore-title">整批恢复预览</h4><p id="original-restore-summary" class="project-note"></p><ul id="original-restore-items"></ul><div class="project-actions"><button type="button" id="original-restore-confirm">确认整批恢复</button><button type="button" id="original-restore-cancel">取消预览</button></div></section>`;
  parent.append(section);
  const $=id=>section.querySelector('#original-restore-'+id);let preview,controller;
  function refresh(){ $('choose').disabled=working()||!currentAccount()?.id;$('confirm').disabled=working()||!preview?.plan.additions.length;$('cancel').disabled=working(); }
  function cancel(){preview=null;$('preview').hidden=true;$('items').replaceChildren();refresh();}
  $('choose').onclick=()=>{if(!working()&&currentAccount()?.id)$('file').click();};
  $('abort').onclick=()=>controller?.abort();
  $('cancel').onclick=()=>{cancel();status('已取消恢复预览，原文件未改变。');};
  async function operation(fn){controller=new AbortController();$('abort').hidden=false;$('abort').disabled=false;try{await fn(controller);}finally{controller=undefined;$('abort').hidden=true;}}
  $('file').onchange=()=>{
    const file=$('file').files[0];$('file').value='';if(!file||working())return;cancel();
    return run(()=>operation(async control=>{
      const owner=currentAccount()?.id,check=()=>{if(control.signal.aborted)throw Error('已取消校验或恢复，请刷新列表核实；已有原文件保留。');if(owner!==currentAccount()?.id)throw Error('账户已切换，未恢复文件。');};
      const archive=await inspectOriginalBackup(file,owner,{check,progress:status}),api=client(owner),baseline=await api.list();check();accept(baseline);
      const plan=planOriginalRestore(baseline,archive.envelope);
      const missing=archive.envelope.files.filter(f=>!projects().some(p=>p.id===f.projectId&&p.documents.some(d=>d.id===f.documentId))).length;
      preview={owner,file,baseline,archive,plan};
      $('summary').textContent=`已完整校验 ${archive.envelope.files.length} 个原文件，将追加 ${plan.additions.length} 个、跳过 ${plan.skipped} 个相同文件；恢复后 ${plan.total}/${getLimits().originalFiles} 个、${(plan.usedBytes/1024/1024).toFixed(2)}/${getLimits().originalTotalBytes/1048576} MiB。${missing} 个原项目或解析资料已不存在，恢复后只在私有保管区显示，不自动关联新项目。`;
      for(const item of archive.envelope.files){const row=document.createElement('li');row.textContent=`${item.name} · ${(item.size/1024).toFixed(1)} KiB · ${plan.additions.some(a=>a.id===item.id)?'追加恢复':'相同文件跳过'}`;$('items').append(row);}
      $('preview').hidden=false;status(plan.additions.length?'校验完成，请核实恢复预览后确认；尚未上传。':'全部原文件已存在，无须再次恢复。');
    }));
  };
  $('confirm').onclick=()=>{
    if(working()||!preview?.plan.additions.length)return;
    const pending=preview;
    if(!confirm(`向当前账户追加 ${pending.plan.additions.length} 个原文件、跳过 ${pending.plan.skipped} 个相同文件？旧原文件和解析文字保留，缺失项目不自动重新关联，不执行文件。`))return;
    return run(()=>operation(async control=>{
      if(pending.owner!==currentAccount()?.id)throw Error('账户已切换，请重新预览。');
      const result=await client(pending.owner).restore(pending.file,pending.baseline,{signal:control.signal});
      for(const file of [...pending.baseline.files,...pending.plan.additions])if(!result.files.some(f=>f.id===file.id&&f.sha256===file.sha256&&f.name===file.name&&f.cleanupPending===file.cleanupPending))throw Error('恢复确认不完整，请刷新列表核实；未声称恢复成功。');
      accept(result);cancel();status(`整批恢复已确认：追加 ${pending.plan.additions.length} 个，跳过 ${pending.plan.skipped} 个。旧原文件和解析资料保留，未执行文件。`);
    }));
  };
  dialog.addEventListener('close',()=>{controller?.abort();cancel();});
  refresh();return{refresh,cancel};
}
