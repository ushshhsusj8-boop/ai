import {getStorageScope} from './scoped_storage.js';
export function initUsageGuide({launch}) {
  const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const dialog=node('dialog','settings-dialog usage-guide');dialog.id='usage-guide-dialog';dialog.setAttribute('aria-labelledby','usage-guide-title');const card=node('div','dialog-card'),heading=node('div','dialog-heading'),title=node('h2','','plaude chat 使用指南');title.id='usage-guide-title';const close=node('button','icon-button','×');close.id='usage-guide-close';close.type='button';close.setAttribute('aria-label','关闭使用指南');close.onclick=()=>dialog.close();heading.append(title,close);
  const scope=node('p','ui-note');scope.id='usage-guide-scope';scope.setAttribute('role','status');card.append(heading,scope);
  const sections=[
    ['开始聊天','点击顶部模型名称展开模型选择；右上角“···”展开对话工具，次要选项点标题再展开。输入框“＋”可添加文件、项目资料和使用常用工具。侧栏“更多工具”收纳代码、提示词和键盘说明，侧栏也可整体收起。每段对话有独立回答要求；新建对话可设置另一套提示词。在“上下文管理”查看按当前草稿计算的历史范围、省略原因和字符预算；轮数选择保存后生效。启用资料会为引用预留空间，旧消息仍保留。生成期间可以切换其他对话，停止只影响当前任务。',[['模型与参数','models'],['独立对话设定','instructions'],['键盘与发送方式','keyboard']]],
    ['保存与跨设备','登录同一账户可继续私有聊天、项目、文稿和提示词库。项目资料旁可明确选择并保存原文件，再从“原文件私有保管区”跨设备下载、备份全部原文件ZIP，或选择同账户ZIP完整校验并预览整批恢复；相同文件跳过，冲突整批拒绝；JSON项目备份不含这些原文件，请同时保留JSON和原文件备份。只在服务确认后显示云端完成；离线修改先留在本机，遇到冲突保留两个版本。重要资料可分别导出聊天、项目、文稿和提示词库备份。',[['账户与同步','account'],['聊天备份','backup'],['提示词库','prompts']]],
    ['资料与写作','在项目中保存共用资料与指令，再关联多个对话。扫描或混合 PDF 会提示未读页，手动选择最多20页进行本机 OCR；文件详情和阅读器显示缺页与识别限制。全局搜索可查找资料后半部分，点击页码或段落阅读原文。回复上的“在画布中编辑”创建独立文稿，可修改、预览、备份或放入聊天草稿。',[['搜索资料','search'],['项目空间','projects'],['写作画布','writing']]],
    ['代码与版本','在代码工作区导入Python或Java脚本，填写标准输入后手动运行；将生成文件写入output文件夹，在“运行结果”下载，15分钟内及时保存。在“历史记录”按语言、代码或输出检索，导出JSON或预览后导入备份；登录后还能确认私有云备份，并在另一设备预览合并恢复，代码草稿保留；重复跳过、编号冲突另存，导入不运行代码。对话顶部“版本”可返回或比较分支。',[['代码工作区','code'],['运行日志','logs']]],
  ];
  for(const [label,text,actions]of sections){const section=node('section','usage-guide-section');section.append(node('h3','',label),node('p','',text));const links=node('div','usage-guide-actions');for(const [label,key]of actions){const b=node('button','secondary-button',label);b.type='button';b.onclick=()=>{dialog.close();launch(key);};links.append(b);}section.append(links);card.append(section);}
  card.append(node('p','ui-note','搜索、阅读资料、编辑文稿、查看历史和比较版本不会自动请求模型。发送聊天、重新生成和服务器运行代码需要联网。'));dialog.append(card);document.body.append(dialog);
  function open(){scope.textContent=getStorageScope()?'当前是账户私有空间。聊天、项目、文稿和提示词库支持云同步；未发草稿、界面偏好和运行历史默认保存在此浏览器；运行历史另支持手动确认云备份与恢复。':'当前是访客本机空间。新聊天不会自动公开；登录后可以手动导入原本机资料，原资料会保留。';dialog.showModal();close.focus();}
  return {open};
}
