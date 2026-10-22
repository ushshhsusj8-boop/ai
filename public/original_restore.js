import { validateOriginalFiles, ORIGINAL_LIMITS } from './project_originals.js';
import { verifyOriginalZip, MAX_ORIGINAL_ZIP_BYTES, originalSnapshotText } from './original_zip.js';

export async function inspectOriginalBackup(blob, userId, options = {}) {
  options.check?.();
  if (!blob || blob.size < 30 || blob.size > MAX_ORIGINAL_ZIP_BYTES) throw Error('请选择本站导出的原文件ZIP，最多65 MiB。');
  const header = new DataView(await blob.slice(0, 30).arrayBuffer());
  const nameLength = header.getUint16(26, true), size = header.getUint32(22, true);
  if (header.getUint32(0, true) !== 0x04034b50 || nameLength !== 13 || size > 128 * 1024 || 30 + nameLength + size > blob.size) throw Error('本站原文件备份清单无效。');
  const decode = new TextDecoder('utf-8', { fatal: true });
  if (decode.decode(await blob.slice(30, 43).arrayBuffer()) !== 'manifest.json') throw Error('ZIP缺少本站原文件清单。');
  let manifest;
  try { manifest = JSON.parse(decode.decode(await blob.slice(43, 43 + size).arrayBuffer())); } catch { throw Error('原文件备份清单损坏。'); }
  if (manifest?.version !== 1 || manifest.userId !== userId || typeof manifest.exportedAt !== 'string' || manifest.exportedAt.length > 80 || !Number.isFinite(Date.parse(manifest.exportedAt))) throw Error('请登录导出备份时的原账户，不能把其他账户ZIP恢复到此账户。');
  const envelope = validateOriginalFiles(manifest, userId);
  if (!envelope.files.length || envelope.files.some(f => f.cleanupPending)) throw Error('备份为空或含待清理记录，尚未恢复。');
  const slices = [];
  await verifyOriginalZip(blob, envelope, { ...options, entryChecked: entry => slices.push(entry) });
  options.check?.();
  return { envelope, slices, exportedAt: manifest.exportedAt };
}
export function planOriginalRestore(current, archive) {
  current = validateOriginalFiles(current, archive.userId); archive = validateOriginalFiles(archive, archive.userId);
  const additions = []; let skipped = 0;
  for (const file of archive.files) {
    const sameDocument = current.files.find(f => f.projectId === file.projectId && f.documentId === file.documentId);
    if (sameDocument) {
      if (sameDocument.cleanupPending || sameDocument.name !== file.name || sameDocument.size !== file.size || sameDocument.sha256 !== file.sha256) throw Error(`原文件“${file.name}”与现有记录冲突，整批不恢复；请先下载保留并核实旧文件。`);
      skipped++; continue;
    }
    if (current.files.some(f => f.id === file.id)) throw Error('备份文件编号与现有记录冲突，整批不恢复。');
    additions.push(file);
  }
  const total = current.files.length + additions.length, usedBytes = current.usedBytes + additions.reduce((n, f) => n + f.size, 0);
  if (total > ORIGINAL_LIMITS.maxFiles || usedBytes > ORIGINAL_LIMITS.maxTotalBytes) throw Error('恢复后超过60个 / 64 MiB，整批不恢复；已有原文件保留。');
  return { additions, skipped, total, usedBytes, baseline: originalSnapshotText(current.files) };
}
