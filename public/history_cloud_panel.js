import { getStorageScope } from './scoped_storage.js';
import { createHistoryCloud } from './history_cloud.js';

export function initHistoryCloudPanel({ runner, parent, history, busy, busyChanged, restored, onIdentityChanged }) {
  const section = document.createElement('section'); section.id = 'code-history-cloud';
  section.innerHTML = `<h4>私有云备份</h4><p class="ws-help">手动预览并确认后，把代码、标准输入和文字运行结果备份到当前账户；最多100条 / 8 MiB。换设备登录同一账户可合并恢复。不会上传编辑草稿或生成附件，不会运行代码。本机删除与云端删除各自独立。</p><div class="code-runner-actions"><button class="secondary-button" id="code-cloud-upload" type="button">备份历史到云端</button><button class="secondary-button" id="code-cloud-restore" type="button">从云端恢复</button><button class="text-button" id="code-cloud-delete" type="button">删除云端备份</button></div><p id="code-cloud-status" role="status" aria-live="polite"></p><section id="code-cloud-preview" class="code-history-import-preview" hidden aria-labelledby="code-cloud-preview-title"><h4 id="code-cloud-preview-title"></h4><p id="code-cloud-summary"></p><div class="code-runner-actions"><button class="primary-button" id="code-cloud-confirm" type="button">确认</button><button class="secondary-button" id="code-cloud-cancel" type="button">取消预览</button></div></section>`;
  parent.append(section);
  const $ = id => section.querySelector('#code-cloud-' + id), owner = getStorageScope();
  let working = false, preview = null, sequence = 0;
  const client = owner ? createHistoryCloud({ userId: owner, history, isCurrent: () => owner === getStorageScope(), onIdentityChanged }) : null;
  const message = text => { $('status').textContent = text; };
  function paint() {
    for (const id of ['upload', 'restore', 'delete']) $(id).disabled = !client || working || busy();
    $('confirm').disabled = !preview || working || busy() || !preview.summary.added;
    $('cancel').disabled = working;
  }
  function cancel() { preview = null; sequence++; $('preview').hidden = true; paint(); }
  async function action(fn) {
    if (!client || working || busy()) return;
    working = true; paint(); busyChanged(true);
    try { await fn(); } catch (error) { cancel(); message(error.message); }
    finally { working = false; busyChanged(false); paint(); }
  }
  async function prepare(kind) {
    cancel(); const attempt = sequence;
    message('正在读取并检查记录，尚未上传或恢复…');
    const next = await (kind === 'upload' ? client.previewUpload() : client.previewRestore());
    if (!runner.open || attempt !== sequence) return;
    preview = next;
    $('preview-title').textContent = kind === 'upload' ? '云端备份预览' : '本机恢复预览';
    $('summary').textContent = `将新增 ${next.summary.added} 条，跳过 ${next.summary.skipped} 条重复，${next.summary.renamed} 条编号冲突另存；合并后 ${next.summary.total}/100 条，${(next.summary.bytes / 1024).toFixed(1)} KiB / 8 MiB。${kind === 'upload' ? '代码、标准输入和文字结果将保存到当前账户的云端。' : '仅追加到本机当前账户，现有记录和代码草稿保留。'}不会运行代码。`;
    $('confirm').textContent = kind === 'upload' ? '确认备份到云端' : '确认合并恢复';
    $('preview').hidden = false; message(next.summary.added ? '请核实范围后确认；尚未写入。' : '全部内容已存在，无须再次写入。');
  }
  $('upload').onclick = () => action(() => prepare('upload'));
  $('restore').onclick = () => action(() => prepare('restore'));
  $('cancel').onclick = () => { cancel(); message('已取消预览，未上传或恢复。'); };
  $('confirm').onclick = () => action(async () => {
    const pending = preview; if (!pending?.summary.added) return;
    const answer = pending.kind === 'upload' ? await client.upload(pending) : await client.restore(pending);
    cancel();
    if (pending.kind === 'restore') await restored();
    message(`${pending.kind === 'upload' ? '云端备份已确认' : '恢复已完成'}：新增 ${answer.added} 条，跳过 ${answer.skipped} 条重复，${answer.renamed} 条编号冲突另存。本机原记录和代码草稿保留，未运行代码。`);
  });
  $('delete').onclick = () => action(async () => {
    cancel(); const cloud = await client.list();
    if (!runner.open || !confirm(`删除当前账户全部 ${cloud.runs.length} 条云端运行历史备份？请先导出需要的副本。本机运行历史、代码草稿和聊天保留，不会运行代码。`)) return;
    await client.remove(cloud); message('云端备份已确认删除，本机历史、代码草稿和聊天保留。');
  });
  runner.addEventListener('close', cancel);
  if (!client) message('请登录个人账户后使用私有云备份。访客历史不会自动复制到登录账户。');
  paint();
  return { busy: () => working, refresh: paint, cancel };
}
