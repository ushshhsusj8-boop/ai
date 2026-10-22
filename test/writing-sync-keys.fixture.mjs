// Pure in-memory scenarios shared by Node regression and served-module browser QA.
export async function writingSyncKeyScenarios(root) {
  const {createWritingSync}=await import(root+'writing_sync.js');
  const {createWritingStore,validateWritingNotes}=await import(root+'writing_store.js');
  const ids=['ordinary-note-0001','constructor','toString','__proto__'];
  const note=id=>({id,title:'合成文稿 '+id,text:'云端原文 '+id,revision:1,updatedAt:1});
  validateWritingNotes(ids.map(note));
  const memory=()=>{const data=new Map();return{getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,String(value)),removeItem:key=>data.delete(key)};};
  function api(){const records=new Map(),calls=[];return{records,calls,async fetch(path,options={}){
    const method=options.method||'GET',id=decodeURIComponent(path.split('/').at(-1)),body=options.body&&JSON.parse(options.body),old=records.get(id);calls.push({method,id,revision:body?.revision});
    if(options.headers['x-plaude-account-id']!=='qa-sync-key-owner')throw Error('Synthetic owner mismatch');
    if(method==='GET')return Response.json({userId:'qa-sync-key-owner',notes:[...records.values()].filter(n=>!n.deleted),deleted:[...records.values()].filter(n=>n.deleted)});
    if(old?.deleted||(old?.revision||0)!==body.revision)return Response.json({error:'conflict'},{status:409});
    if(method==='DELETE'){records.set(id,{id,revision:old.revision+1,updatedAt:2,deleted:true});return Response.json({userId:'qa-sync-key-owner'});}
    const saved={...structuredClone(body.note),revision:(old?.revision||0)+1};records.set(id,saved);return Response.json({userId:'qa-sync-key-owner',note:saved});
  }};}
  const client=(remote,storage=memory())=>{const store=createWritingStore(storage);return{store,storage,sync:createWritingSync({userId:'qa-sync-key-owner',store,storage,fetchImpl:remote.fetch})};};
  const downloadApi=api();for(const id of ids)downloadApi.records.set(id,note(id));const download=client(downloadApi),downloadResult=await download.sync.sync();
  const downloaded=download.store.list();
  const reloadApi=api(),first=client(reloadApi);first.store.save({...note('__proto__'),revision:0});await first.sync.sync();
  const firstMetadata=JSON.parse(first.storage.getItem('plaude-writing-sync-v1'));
  first.store.save({...first.store.list()[0],text:'刷新前离线修改'});const reloaded=client(reloadApi,first.storage),reloadResult=await reloaded.sync.sync();
  const finalMetadata=JSON.parse(first.storage.getItem('plaude-writing-sync-v1'));
  const deleteApi=api();deleteApi.records.set('ordinary-sibling-0001',note('ordinary-sibling-0001'));const deleting=client(deleteApi);deleting.store.save({...note('__proto__'),revision:0});await deleting.sync.sync();
  const reopened=client(deleteApi,deleting.storage);await reopened.sync.sync();const selected=reopened.store.list().find(n=>n.id==='__proto__');reopened.store.remove(selected.id,selected.revision);const deleteResult=await reopened.sync.sync();
  const conflictApi=api(),editing=client(conflictApi);editing.store.save({...note('__proto__'),revision:0});await editing.sync.sync();editing.store.save({...editing.store.list()[0],text:'本机需保留修改'});conflictApi.records.set('__proto__',{...conflictApi.records.get('__proto__'),text:'另一设备需保留修改',revision:2});const conflictResult=await editing.sync.sync();
  return {
    identifiersAccepted:ids,
    downloads:{synced:downloadResult.synced,conflicts:downloadResult.conflicts,ids:downloaded.map(n=>n.id).sort(),contentsPreserved:downloaded.every(n=>n.text===note(n.id).text)},
    reload:{metadataOwnBefore:Object.hasOwn(firstMetadata,'__proto__'),metadataOwnAfter:Object.hasOwn(finalMetadata,'__proto__'),synced:reloadResult.synced,conflicts:reloadResult.conflicts,localText:reloaded.store.list()[0].text,remoteText:reloadApi.records.get('__proto__').text,putRevisions:reloadApi.calls.filter(c=>c.method==='PUT').map(c=>c.revision)},
    deletion:{reportedSynced:deleteResult.synced,cloudDeleted:deleteApi.records.get('__proto__')?.deleted===true,cloudRevision:deleteApi.records.get('__proto__')?.revision,deleteRequests:deleteApi.calls.filter(c=>c.method==='DELETE').length,localDeleted:!reopened.store.list().some(n=>n.id==='__proto__'),siblingPreserved:deleteApi.records.get('ordinary-sibling-0001').text===note('ordinary-sibling-0001').text},
    conflict:{synced:conflictResult.synced,conflicts:conflictResult.conflicts,localText:editing.store.list()[0].text,remoteText:conflictApi.records.get('__proto__').text}
  };
}
