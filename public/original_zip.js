import {getLimits,MAXIMUM_LIMITS} from './site_limits.js';
// Stored ZIP records: PKWARE APPNOTE 4.3; no compression, encryption or executable entries.
export const MAX_ORIGINAL_ZIP_BYTES = getLimits().originalZipBytes;
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', {fatal: true});
const table = Uint32Array.from({length: 256}, (_, n) => {let crc = n; for (let i = 0; i < 8; i++) crc = crc & 1 ? 0xedb88320 ^ crc >>> 1 : crc >>> 1; return crc >>> 0;});
export function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ crc >>> 8; return (crc ^ 0xffffffff) >>> 0; }
export function originalSnapshotText(files) { return JSON.stringify([...files].sort((a,b) => a.id.localeCompare(b.id)).map(f => [f.id,f.projectId,f.documentId,f.name,f.size,f.sha256,f.createdAt,f.cleanupPending])); }
export function originalZipPath(file) { return `files/${file.id}.${file.name.split('.').at(-1).toLowerCase()}`; }
export function zipHeader(name, size, crc, offset = null) {
  const nameBytes = encoder.encode(name), central = offset !== null, bytes = new Uint8Array((central ? 46 : 30) + nameBytes.length), d = new DataView(bytes.buffer);
  d.setUint32(0, central ? 0x02014b50 : 0x04034b50, true);
  if (central) {d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x800,true);d.setUint16(14,0x21,true);d.setUint32(16,crc,true);d.setUint32(20,size,true);d.setUint32(24,size,true);d.setUint16(28,nameBytes.length,true);d.setUint32(42,offset,true);}
  else {d.setUint16(4,20,true);d.setUint16(6,0x800,true);d.setUint16(12,0x21,true);d.setUint32(14,crc,true);d.setUint32(18,size,true);d.setUint32(22,size,true);d.setUint16(26,nameBytes.length,true);}
  bytes.set(nameBytes,central ? 46 : 30); return bytes;
}
export function zipEnd(count, centralSize, centralOffset) {
  const bytes=new Uint8Array(22),d=new DataView(bytes.buffer);d.setUint32(0,0x06054b50,true);d.setUint16(8,count,true);d.setUint16(10,count,true);d.setUint32(12,centralSize,true);d.setUint32(16,centralOffset,true);return bytes;
}
export function originalZipPlan(envelope, exportedAt = new Date().toISOString()) {
  const files = envelope.files.filter(f => !f.cleanupPending).sort((a,b) => a.id.localeCompare(b.id));
  if (!files.length) throw Error('当前账户没有可备份的原文件。');
  const manifest = {version:1,exportedAt,userId:envelope.userId,files:files.map(f => ({...f,archivePath:originalZipPath(f)})),usedBytes:files.reduce((n,f)=>n+f.size,0)};
  const content = encoder.encode(JSON.stringify(manifest,null,2));
  const entries=[{name:'manifest.json',size:content.length,content},...files.map(file=>({name:originalZipPath(file),size:file.size,file}))];
  const size=22+entries.reduce((n,e)=>n+76+2*encoder.encode(e.name).length+e.size,0);
  if(content.length>Math.max(128*1024,getLimits().originalFiles*1024)||size>getLimits().originalZipBytes)throw Error('原文件备份超过容量限制。');
  return {entries,size,manifest};
}
export function* originalZipChunks(plan, readFile) {
  const central=[];let offset=0;
  for(const entry of plan.entries){const content=entry.content||readFile(entry.file);if(content.length!==entry.size)throw Error('原文件大小变化，备份已停止。');const crc=crc32(content),header=zipHeader(entry.name,entry.size,crc);central.push(zipHeader(entry.name,entry.size,crc,offset));yield header;yield content;offset+=header.length+content.length;}
  const centralOffset=offset;for(const part of central){yield part;offset+=part.length;}yield zipEnd(plan.entries.length,offset-centralOffset,centralOffset);
}
const equal = (a,b) => a.length===b.length && a.every((v,i)=>v===b[i]);
/** Validate only our bounded stored format, including each SHA256, before offering a download. */
export async function verifyOriginalZip(blob, envelope, {check = () => {}, progress = () => {}, entryChecked = () => {},allowStored=false} = {}) {
  const limits=allowStored?MAXIMUM_LIMITS:getLimits();
  if(blob.size>limits.originalZipBytes||blob.size<22)throw Error('原文件备份大小无效。');
  let offset=0,files,entries,manifest;const central=[];
  const read=async size=>{check();if(size<0||offset+size>blob.size)throw Error('原文件备份不完整。');const bytes=new Uint8Array(await blob.slice(offset,offset+size).arrayBuffer());check();offset+=size;return bytes;};
  for(let i=0;i<(entries?.length||1);i++){
    const start=offset,header=await read(30),view=new DataView(header.buffer),size=view.getUint32(22,true),crc=view.getUint32(14,true),name=decoder.decode(await read(view.getUint16(26,true)));
    if(view.getUint32(0,true)!==0x04034b50||view.getUint16(4,true)!==20||view.getUint16(6,true)!==0x800||view.getUint16(8,true)!==0||view.getUint16(28,true)!==0||view.getUint32(18,true)!==size||size>(i ? limits.originalFileBytes : Math.max(128*1024,limits.originalFiles*1024)))throw Error('原文件备份格式无效。');
    const content=await read(size);if(crc32(content)!==crc)throw Error('原文件备份 CRC 校验失败。');
    if(i===0){if(name!=='manifest.json')throw Error('原文件备份缺少清单。');manifest=JSON.parse(decoder.decode(content));
      files=envelope.files.filter(f=>!f.cleanupPending).sort((a,b)=>a.id.localeCompare(b.id));
      if(manifest.version!==1||manifest.userId!==envelope.userId||!Array.isArray(manifest.files)||originalSnapshotText(manifest.files)!==originalSnapshotText(files)||manifest.files.some(f=>f.archivePath!==originalZipPath(f))||manifest.usedBytes!==files.reduce((n,f)=>n+f.size,0))throw Error('原文件备份清单与当前账户不一致。');
      entries=[{name:'manifest.json',size},...files.map(f=>({name:originalZipPath(f),size:f.size,file:f}))];
    }
    const entry=entries[i];if(name!==entry.name||size!==entry.size)throw Error('原文件备份条目不一致。');
    if(entry.file){const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',content))].map(b=>b.toString(16).padStart(2,'0')).join('');check();if(digest!==entry.file.sha256)throw Error('原文件备份 SHA256 校验失败。');progress(`校验原文件 ${i}/${files.length}…`);entryChecked({file:entry.file,offset:offset-size,size});}
    if(!equal(header,zipHeader(name,size,crc).slice(0,30)))throw Error('原文件备份头部无效。');central.push(zipHeader(name,size,crc,start));
  }
  const centralOffset=offset;for(const part of central)if(!equal(await read(part.length),part))throw Error('原文件备份目录无效。');const centralSize=offset-centralOffset;
  if(!equal(await read(22),zipEnd(entries.length,centralSize,centralOffset))||offset!==blob.size)throw Error('原文件备份尾部不完整。');
  check();return manifest;
}
