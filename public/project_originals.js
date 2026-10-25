import {limitObject,withStoredLimits,MAXIMUM_LIMITS} from './site_limits.js';
export const ORIGINAL_LIMITS = limitObject({maxFiles:'originalFiles',maxFileBytes:'originalFileBytes',maxTotalBytes:'originalTotalBytes'});
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export function originalName(name) {
  if (typeof name !== 'string' || !name || name.length > 200 || /[\\/\x00-\x1f\x7f]/.test(name) || !/\.(pdf|docx|txt|md|csv|json)$/i.test(name)) throw Error('原文件支持 PDF、DOCX、TXT、MD、CSV、JSON，请选择有效文件名。');
  const safe = name.replace(/[<>:"|?*\[\]]/g, '_'), dot = safe.lastIndexOf('.'), extension = safe.slice(dot);
  return safe.slice(0, Math.min(dot, 100 - extension.length)) + extension;
}
export function validateOriginalFiles(value, userId) {
  if (!value || value.userId !== userId || !Array.isArray(value.files) || value.files.length > ORIGINAL_LIMITS.maxFiles) throw Error('原文件账户或列表无效。');
  const ids = new Set(), docs = new Set(); let usedBytes = 0;
  const files = value.files.map(f => {
    if (!f || !UUID.test(f.id) || ids.has(f.id) || !/^[a-zA-Z0-9_-]{8,128}$/.test(f.projectId) || !/^[a-zA-Z0-9_-]{8,80}$/.test(f.documentId)
      || docs.has(f.projectId + '/' + f.documentId) || originalName(f.name) !== f.name || !Number.isSafeInteger(f.size) || f.size < 1 || f.size > ORIGINAL_LIMITS.maxFileBytes
      || !/^[a-f0-9]{64}$/.test(f.sha256) || !Number.isSafeInteger(f.createdAt) || f.createdAt < 0 || typeof f.cleanupPending !== 'boolean') throw Error('原文件记录无效。');
    ids.add(f.id); docs.add(f.projectId + '/' + f.documentId); usedBytes += f.size;
    return {id: f.id, projectId: f.projectId, documentId: f.documentId, name: f.name, size: f.size, sha256: f.sha256, createdAt: f.createdAt, cleanupPending: f.cleanupPending};
  });
  if (usedBytes > ORIGINAL_LIMITS.maxTotalBytes || value.usedBytes !== usedBytes) throw Error('原文件容量记录无效。');
  return {userId, files, usedBytes, limits: ORIGINAL_LIMITS};
}
export function createProjectOriginalClient({userId, currentAccount = () => globalThis.PlaudeAccount?.user?.id, fetchImpl = globalThis.fetch}) {
  function checkIdentity() { if (!userId || currentAccount() !== userId) throw Error('账户已切换，请在当前账户重新打开原文件保管区。'); }
  async function request(path = '', {method = 'GET', body, signal, timeoutMs = 30000} = {}) {
    checkIdentity(); const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), timeoutMs);
    const cancel = () => controller.abort(); signal?.addEventListener('abort', cancel, {once: true}); if (signal?.aborted) cancel();
    try {
      const response = await fetchImpl('/api/account/project-files' + path, {method, body, signal: controller.signal, credentials: 'same-origin', cache: 'no-store', headers: {'x-plaude-account-id': userId, ...(method === 'GET' ? {} : {'x-plaude-client': '1'}), ...(body ? {'content-type': 'application/octet-stream'} : {})}});
      checkIdentity();
      if (!response.ok) { const data = await response.json().catch(() => ({})); checkIdentity(); throw Object.assign(Error(response.status === 401 ? '请先登录个人账户。' : response.status === 403 ? '账户已切换或没有权限，请重新打开项目。' : data.error || '原文件操作失败，已有资料保留。'), {status: response.status}); }
      if (path.startsWith('/')&&!path.startsWith('/restore')) { if(path.startsWith('/export')){const size=Number(response.headers.get('content-length'));if(!Number.isSafeInteger(size)||size<22||size>MAXIMUM_LIMITS.originalZipBytes)throw Error('原文件备份响应大小无效。');} const blob = await response.blob(); checkIdentity(); return blob; }
      const value = await response.json(); checkIdentity(); return withStoredLimits(()=>validateOriginalFiles(value, userId));
    } catch (e) { if (controller.signal.aborted) throw Error(`原文件操作已取消或等待超过${timeoutMs/1000}秒；请刷新列表核实后再重试。`); if(path.startsWith('/export')&&e instanceof TypeError)throw Error('备份下载中断，未提供不完整文件；请联网后重新导出。'); throw e; }
    finally { clearTimeout(timeout); signal?.removeEventListener('abort', cancel); }
  }
  return {
    list: () => request(),
    async restore(blob,baseline,{signal}={}) {
      checkIdentity();const snapshot=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(originalSnapshotText(baseline.files))))].map(b=>b.toString(16).padStart(2,'0')).join('');checkIdentity();
      return request('/restore?'+new URLSearchParams({snapshot}),{method:'POST',body:blob,signal,timeoutMs:120000});
    },
    async export(envelope,{signal,progress=()=>{}}={}) {
      envelope=withStoredLimits(()=>validateOriginalFiles(envelope,userId));checkIdentity();
      const snapshot=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(originalSnapshotText(envelope.files))))].map(b=>b.toString(16).padStart(2,'0')).join('');
      progress('正在下载当前账户原文件备份…');const blob=await request('/export?'+new URLSearchParams({snapshot}),{signal,timeoutMs:120000});
      await verifyOriginalZip(blob,envelope,{allowStored:true,progress,check:()=>{checkIdentity();if(signal?.aborted)throw Error('已取消整批备份，未提供下载。');}});
      checkIdentity();return new Blob([blob],{type:'application/zip'});
    },
    upload: ({projectId, documentId, file, signal}) => {
      originalName(file?.name); if (!file.size || file.size > ORIGINAL_LIMITS.maxFileBytes) throw Error('原文件必须大于0且不超过当前单文件容量。');
      return request('?' + new URLSearchParams({projectId, documentId, name: file.name}), {method: 'POST', body: file, signal});
    },
    remove: async id => {
      if (!UUID.test(id)) throw Error('原文件编号无效。');
      // Delete returns a list, unlike the binary download.
      return request('?' + new URLSearchParams({id}), {method: 'DELETE'});
    },
    async download(file) {
      if (!UUID.test(file.id) || file.cleanupPending) throw Error('该原文件不可下载。');
      const blob = await request('/' + file.id);
      if (blob.size !== file.size) throw Error('原文件大小不一致，已停止下载。');
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(b => b.toString(16).padStart(2, '0')).join(''); checkIdentity();
      if (digest !== file.sha256) throw Error('原文件校验失败，已停止下载。');
      return new Blob([blob], {type: 'application/octet-stream'});
    }
  };
}
import {originalSnapshotText, verifyOriginalZip, MAX_ORIGINAL_ZIP_BYTES} from './original_zip.js';
