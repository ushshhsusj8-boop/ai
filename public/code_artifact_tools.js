export const ARTIFACT_COUNT = 4;
export const ARTIFACT_FILE_BYTES = 64 * 1024;
export const ARTIFACT_TOTAL_BYTES = 256 * 1024;
export const ARTIFACT_LIFETIME_MS = 15 * 60 * 1000;
export function validArtifactName(name) {
  if (typeof name !== 'string' || name.length > 240 || name.startsWith('/') || name.includes('\\') || /[\x00-\x1f\x7f]/.test(name)) return false;
  const parts = name.split('/');
  return parts.length <= 4 && parts.every(part => part && part !== '.' && part !== '..' && part.length <= 80);
}
export function validateCodeArtifacts(value = []) {
  if (!Array.isArray(value) || value.length > ARTIFACT_COUNT) throw Error('生成文件数量超过限制。');
  const names = new Set(); let total = 0;
  return value.map(file => {
    if (!file || typeof file !== 'object' || !validArtifactName(file.name) || names.has(file.name) ||
        !Number.isSafeInteger(file.size) || file.size < 0 || file.size > ARTIFACT_FILE_BYTES ||
        typeof file.data !== 'string' || file.data.length > Math.ceil(ARTIFACT_FILE_BYTES / 3) * 4 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.data)) throw Error('生成文件名称、大小或内容无效。');
    const decoded = Uint8Array.from(atob(file.data), ch => ch.charCodeAt(0));
    if (decoded.length !== file.size || (total += file.size) > ARTIFACT_TOTAL_BYTES) throw Error('生成文件大小超过限制或不匹配。');
    names.add(file.name); return {name:file.name,size:file.size,data:file.data};
  });
}
export function artifactDownloadName(name) { return name.replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g,'_').slice(0,180) || 'plaude-output.bin'; }
export function artifactBytes(file) { return Uint8Array.from(atob(file.data), ch => ch.charCodeAt(0)); }
