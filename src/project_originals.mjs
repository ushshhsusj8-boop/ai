import {withStoredLimits,MAXIMUM_LIMITS} from '../public/site_limits.js';
import {createHash, randomUUID} from 'node:crypto';
import {closeSync, constants, existsSync, fstatSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {ORIGINAL_LIMITS, originalName, validateOriginalFiles} from '../public/project_originals.js';
import {originalSnapshotText, originalZipPlan, originalZipChunks} from '../public/original_zip.js';
import {inspectOriginalBackup,planOriginalRestore} from '../public/original_restore.js';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const MAX_INDEX = 128 * 1024;
function fail(message, statusCode = 400) { throw Object.assign(Error(message), {statusCode}); }
function atomicIndex(path, value) {
  const temp = path + '.' + randomUUID() + '.tmp'; let handle;
  try { handle = openSync(temp, 'wx', 0o600); writeFileSync(handle, JSON.stringify(value)); fsyncSync(handle); closeSync(handle); handle = undefined; renameSync(temp, path); }
  finally { if (handle !== undefined) closeSync(handle); rmSync(temp, {force: true}); }
}
/** One server process owns each account vault. Original binaries never enter project JSON. */
export function createProjectOriginalStore(root, {requireUser, getProjects, now = Date.now, writeIndex = atomicIndex, removeBlob = path => rmSync(path, {force: true})}) {
  root = resolve(root);
  function read(...args){return withStoredLimits(()=>readStored(...args));}
  function readStored(userId) {
    requireUser(userId); if (!UUID.test(userId)) fail('账户编号无效。', 401);
    const directory = join(root, userId), index = join(directory, 'index.json');
    let value = {userId, files: [], usedBytes: 0};
    if (existsSync(index)) {
      if (statSync(index).size > Math.max(MAX_INDEX,MAXIMUM_LIMITS.originalFiles*1024)) throw Error('Invalid original file index');
      value = JSON.parse(readFileSync(index, 'utf8'));
    }
    return {directory, index, value: validateOriginalFiles(value, userId)};
  }
  function save(index, value) { validateOriginalFiles(value, value.userId); writeIndex(index, value); }
  const envelope = value => structuredClone(value);
  function bytes(directory, item) {
    let handle;
    try {
      handle = openSync(join(directory, item.id + '.bin'), constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      const stats = fstatSync(handle);
      if (!stats.isFile() || stats.size !== item.size || stats.size > MAXIMUM_LIMITS.originalFileBytes) throw Error('Original size mismatch');
      const content = readFileSync(handle);
      if (createHash('sha256').update(content).digest('hex') !== item.sha256) throw Error('Original checksum mismatch');
      return content;
    } finally { if (handle !== undefined) closeSync(handle); }
  }
  return {
    list(userId) { return envelope(read(userId).value); },
    async restore(userId, blob, snapshot, {check = () => {}} = {}) {
      check(); requireUser(userId);
      let archive;
      try{archive=await inspectOriginalBackup(blob,userId,{check});}catch(error){if(error.statusCode)throw error;fail('原文件ZIP校验失败或不是同账户备份，整批未恢复。',400);}check();
      const {value,directory,index} = read(userId);
      if (snapshot !== createHash('sha256').update(originalSnapshotText(value.files)).digest('hex')) fail('原文件列表已变化，请重新预览；整批未恢复。',409);
      let plan; try {plan=planOriginalRestore(value,archive.envelope);} catch(error) {fail(error.message,/超过/.test(error.message)?413:409);}
      // Read all existing duplicates before creating anything; never claim a corrupt copy is restored.
      for(const file of archive.envelope.files) if(!plan.additions.some(a=>a.id===file.id)) {
        const existing=value.files.find(f=>f.projectId===file.projectId&&f.documentId===file.documentId); bytes(directory,existing);
      }
      if(!plan.additions.length)return envelope(value);
      // Stage one bounded file at a time; these blobs are invisible until the index commit.
      mkdirSync(directory,{recursive:true,mode:0o700}); const created=[];let committed=false;
      try {
        for(const file of plan.additions){const slice=archive.slices.find(s=>s.file.id===file.id),content=Buffer.from(await blob.slice(slice.offset,slice.offset+slice.size).arrayBuffer());check();
          if(createHash('sha256').update(content).digest('hex')!==file.sha256)throw Error('Original restore checksum changed');
          let handle;const target=join(directory,file.id+'.bin');
          try{handle=openSync(target,'wx',0o600);created.push(target);writeFileSync(handle,content);fsyncSync(handle);}finally{if(handle!==undefined)closeSync(handle);}}
        check();const fresh=read(userId);
        if(originalSnapshotText(fresh.value.files)!==plan.baseline)fail('原文件列表已变化，请重新预览；整批未恢复。',409);
        save(index,{...value,files:[...value.files,...plan.additions],usedBytes:plan.usedBytes});committed=true;
        return envelope(read(userId).value);
      }finally{if(!committed){let failure;for(const target of created){try{rmSync(target,{force:true});}catch(error){failure=error;}}if(failure)throw failure;}}
    },
    export(userId, snapshot) {
      const {value}=read(userId), digest=createHash('sha256').update(originalSnapshotText(value.files)).digest('hex');
      if(snapshot!==digest)fail('原文件列表已变化，请刷新并重新确认整批备份。',409);
      if(!value.files.some(f=>!f.cleanupPending))fail('当前账户没有可备份的原文件。');
      const plan=withStoredLimits(()=>originalZipPlan(value));
      return {size:plan.size,chunks:originalZipChunks(plan,item=>this.download(userId,item.id).content)};
    },
    upload(userId, {projectId, documentId, name}, content) {
      const current = read(userId), {value, directory, index} = current; name = originalName(name);
      const project = getProjects(userId).projects.find(p => p.id === projectId);
      if (!project?.documents.some(d => d.id === documentId)) fail('目标项目或资料已不存在，请重新打开项目。', 409);
      if (!Buffer.isBuffer(content) || !content.length || content.length > ORIGINAL_LIMITS.maxFileBytes) fail('原文件必须大于0且不超过当前单文件容量。', 413);
      const sha256 = createHash('sha256').update(content).digest('hex'), existing = value.files.find(f => f.projectId === projectId && f.documentId === documentId);
      if (existing) {
        if (!existing.cleanupPending && existing.sha256 === sha256 && existing.size === content.length && existing.name === name) { bytes(directory, existing); return envelope(value); }
        fail('此资料已有原文件或待清理记录，未覆盖；请先下载保留并明确删除旧原文件。', 409);
      }
      if (value.files.length >= ORIGINAL_LIMITS.maxFiles || value.usedBytes + content.length > ORIGINAL_LIMITS.maxTotalBytes) fail('原文件保管区超过当前容量预算，请先下载备份并清理，已有资料保留。', 413);
      mkdirSync(directory, {recursive: true, mode: 0o700});
      const item = {id: randomUUID(), projectId, documentId, name, size: content.length, sha256, createdAt: now(), cleanupPending: false};
      const file = join(directory, item.id + '.bin'); let handle, committed = false;
      try {
        handle = openSync(file, 'wx', 0o600); writeFileSync(handle, content); fsyncSync(handle); closeSync(handle); handle = undefined;
        save(index, {...value, files: [...value.files, item], usedBytes: value.usedBytes + item.size}); committed = true;
        return envelope(read(userId).value);
      } finally { if (handle !== undefined) closeSync(handle); if (!committed) rmSync(file, {force: true}); }
    },
    download(userId, id) {
      if (!UUID.test(id)) fail('原文件不存在。', 404);
      const {value, directory} = read(userId), item = value.files.find(f => f.id === id && !f.cleanupPending);
      if (!item) fail('原文件不存在或正在删除。', 404);
      return {file: structuredClone(item), content: bytes(directory, item)};
    },
    remove(userId, id) {
      if (!UUID.test(id)) fail('原文件不存在。', 404);
      let {value, directory, index} = read(userId); const item = value.files.find(f => f.id === id);
      if (!item) return envelope(value); // lost acknowledgements/repeated deletes are harmless
      // A lower intake quota must not prevent removing an existing original.
      // Retain the durable pending marker before touching the file itself.
      if (!item.cleanupPending) { item.cleanupPending = true; withStoredLimits(()=>save(index, value)); }
      try {
        removeBlob(join(directory, item.id + '.bin'));
        withStoredLimits(()=>save(index, {...value, files: value.files.filter(f => f.id !== id), usedBytes: value.usedBytes - item.size}));
      } catch { /* Tombstone remains visible and charged until explicit retry. Other files are untouched. */ }
      return envelope(read(userId).value);
    }
  };
}
