// Synthetic large notes only; shared by Node and browser served-module QA.
export async function writingLargeCacheScenarios(root){
 const {createWritingStore}=await import(root+'writing_store.js');
 const {createWritingSync}=await import(root+'writing_sync.js');
 const {applyClientLimits,getLimits,DEVELOPER_LIMITS}=await import(root+'site_limits.js');
 const previous=getLimits();applyClientLimits(DEVELOPER_LIMITS);
 const KEY='plaude-writing-sync-v1',text='合成文稿'.repeat(160001),id='large-writing-0001';
 function memory(){const data=new Map();return{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)};}
 function api(){const records=new Map(),calls=[];return{records,calls,async fetch(path,options={}){
  const method=options.method||'GET',key=decodeURIComponent(path.split('/').at(-1)),body=options.body?JSON.parse(options.body):null,old=records.get(key);
  calls.push({method,id:key,revision:body?.revision});let result,status=200;
  if(method==='GET')result={userId:'qa-large-owner',notes:[...records.values()].filter(n=>!n.deleted),deleted:[...records.values()].filter(n=>n.deleted)};
  else if(method==='PUT'){if(old?(old.deleted||old.revision!==body.revision):body.revision!==0)status=409;else{const note={...body.note,revision:(old?.revision||0)+1,updatedAt:1};records.set(key,note);result={userId:'qa-large-owner',note};}}
  else if(!old||old.deleted)status=404;else if(old.revision!==body.revision)status=409;else{const record={id:key,revision:old.revision+1,updatedAt:2,deleted:true};records.set(key,record);result={userId:'qa-large-owner',...record};}
  return Response.json(result||{error:'synthetic conflict'},{status});
 }};}
 function device(remote,storage=memory()){const store=createWritingStore(storage),sync=createWritingSync({userId:'qa-large-owner',store,storage,fetchImpl:remote.fetch});return{store,sync,storage};}
 const note=(key=id,value=text)=>({id:key,title:'合成长文稿',text:value,revision:0});
 try{
  const editingApi=api(),editing=device(editingApi);editing.store.save(note());await editing.sync.sync();
  const metadata=JSON.parse(editing.storage.getItem(KEY)),cachedChars=metadata[id].fingerprint.length;
  editing.store.save({...editing.store.list()[0],text:text+' · offline edit'});
  const reopened=device(editingApi,editing.storage),edited=await reopened.sync.sync();
  const deletionApi=api(),deleting=device(deletionApi);deleting.store.save(note());deleting.store.save(note('ordinary-sibling-0001','合成兄弟文稿'));await deleting.sync.sync();
  const target=deleting.store.list().find(n=>n.id===id);deleting.store.remove(id,target.revision);
  const afterDeletion=device(deletionApi,deleting.storage),deleted=await afterDeletion.sync.sync();
  const conflictApi=api(),conflicting=device(conflictApi);conflicting.store.save(note());await conflicting.sync.sync();
  conflicting.store.save({...conflicting.store.list()[0],text:text+' · local conflict'});
  conflictApi.records.set(id,{...conflictApi.records.get(id),text:text+' · remote conflict',revision:2});
  const conflicted=device(conflictApi,conflicting.storage),conflict=await conflicted.sync.sync();
  return {cachedChars,noteChars:text.length,
   edit:{synced:edited.synced,conflicts:edited.conflicts,localPreserved:reopened.store.list()[0].text===text+' · offline edit',remoteUpdated:editingApi.records.get(id).text===text+' · offline edit',putRevisions:editingApi.calls.filter(c=>c.method==='PUT').map(c=>c.revision)},
   deletion:{reportedSynced:deleted.synced,cloudDeleted:deletionApi.records.get(id).deleted===true,localDeleted:!afterDeletion.store.list().some(n=>n.id===id),deleteRequests:deletionApi.calls.filter(c=>c.method==='DELETE').length,siblingPreserved:deletionApi.records.get('ordinary-sibling-0001').text==='合成兄弟文稿'},
   conflict:{synced:conflict.synced,conflicts:conflict.conflicts,localPreserved:conflicted.store.list()[0].text===text+' · local conflict',remotePreserved:conflictApi.records.get(id).text===text+' · remote conflict'}};
 }finally{applyClientLimits(previous);}
}
