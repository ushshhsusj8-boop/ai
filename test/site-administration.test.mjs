import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once,EventEmitter} from 'node:events';
import {test} from 'node:test';
import {createSiteAdministration} from '../src/site_administration.mjs';
import {createAccountStore} from '../src/accounts.mjs';
import {createGatewayServer} from '../src/app.mjs';
import {loadConfig} from '../src/config.mjs';
import {callProvider} from '../src/providers.mjs';
import {withSiteLimits} from '../src/limit_context.mjs';
import {LEGACY_LIMITS,DEVELOPER_LIMITS,OPEN_LIMITS,validateSiteLimits,getLimits,withStoredLimits} from '../public/site_limits.js';
import {prepareChatContext} from '../public/context_budget.js';
import {validateDocuments} from '../public/document_library.js';
import {validateProjects} from '../public/projects.js';
import {validateMemories} from '../public/memory_tools.js';
import {createWritingStore} from '../public/writing_store.js';
import {collectProviderStream} from '../src/provider_stream.mjs';
import {createBackup,planImport} from '../public/backups.js';
import {loadPromptLibrary,exportPromptLibrary} from '../public/prompt_library.js';
import {createProjectOriginalStore} from '../src/project_originals.mjs';
import {verifyOriginalZip} from '../public/original_zip.js';
import {createHash,randomUUID} from 'node:crypto';

const password='Synthetic-password-123456!',token='synthetic-gateway-token-1234567890';
const fails=code=>error=>error.statusCode===code;
async function fixture(){const dir=mkdtempSync(join(tmpdir(),'plaude-admin-')),file=join(dir,'accounts.json'),accounts=createAccountStore(file);
 const users=await Promise.all(['owner','developer','regular'].map(username=>accounts.register({username,password})));
 const factory=options=>createSiteAdministration({file:accounts.administrationFile,findUser:accounts.findUserByUsername,requireUser:accounts.requireUser,...options});
 return {dir,file,accounts,users,admin:factory(),factory,cleanup:()=>rmSync(dir,{recursive:true,force:true})};
}
test('only an explicit existing owner can bootstrap; permission changes persist without altering accounts',async()=>{
 const f=await fixture();try{const [owner,developer,regular]=f.users,before=readFileSync(f.file);
 assert.equal(existsSync(f.accounts.administrationFile),false);assert.equal(f.admin.access(owner.user.id).role,'user');assert.equal(f.admin.limits().searchUses,0);
 assert.throws(()=>f.admin.bootstrapOwner('missing'),fails(404));assert.equal(existsSync(f.accounts.administrationFile),false);
 assert.throws(()=>f.admin.view(owner.user.id),fails(403));assert.throws(()=>f.admin.putLimits(regular.user.id,{revision:0,limits:OPEN_LIMITS}),fails(403));
 const first=f.admin.bootstrapOwner('OWNER');assert.equal(first.role,'owner');assert.equal(first.administrators.length,1);
 assert.equal(f.admin.bootstrapOwner('owner').revision,1);assert.throws(()=>f.admin.bootstrapOwner('developer'),fails(409));
 const grant=f.admin.setAdministrator(owner.user.id,{revision:1,username:'developer',administrator:true});assert.equal(grant.revision,2);
 const restarted=f.factory();assert.equal(restarted.access(developer.user.id).role,'admin');assert.equal(restarted.view(developer.user.id).administrators,undefined);
 assert.throws(()=>restarted.setAdministrator(developer.user.id,{revision:2,username:'regular',administrator:true}),fails(403));
 assert.throws(()=>restarted.setAdministrator(owner.user.id,{revision:2,username:'owner',administrator:false}),fails(400));
 const saved=restarted.putLimits(developer.user.id,{revision:2,limits:OPEN_LIMITS});assert.equal(saved.revision,3);
 assert.throws(()=>restarted.putLimits(owner.user.id,{revision:2,limits:LEGACY_LIMITS}),fails(409));
 restarted.setAdministrator(owner.user.id,{revision:3,username:'developer',administrator:false});assert.throws(()=>restarted.view(developer.user.id),fails(403));
 assert.deepEqual(readFileSync(f.file),before);assert.equal(f.accounts.listConversations(developer.user.id).conversations.length,0);
 }finally{f.cleanup();}
});
test('invalid policy, corrupt role files and failed atomic writes retain the previous private state',async()=>{
 const f=await fixture();try{f.admin.bootstrapOwner('owner');const id=f.users[0].user.id,original=readFileSync(f.accounts.administrationFile);
 for(const limits of [{...OPEN_LIMITS,unknown:1},{...OPEN_LIMITS,maxConcurrentRequests:999},{...OPEN_LIMITS,promptChars:NaN},{...OPEN_LIMITS,originalZipBytes:65*1048576}])assert.throws(()=>f.admin.putLimits(id,{revision:1,limits}),fails(400));
 assert.deepEqual(readFileSync(f.accounts.administrationFile),original);
 const broken=f.factory({write:()=>{throw Error('synthetic disk failure');}});assert.throws(()=>broken.putLimits(id,{revision:1,limits:OPEN_LIMITS}),/synthetic disk/);assert.deepEqual(readFileSync(f.accounts.administrationFile),original);
 writeFileSync(f.accounts.administrationFile,'broken');assert.throws(()=>f.admin.limits(),fails(503));assert.throws(()=>f.admin.bootstrapOwner('developer'),fails(503));assert.equal(readFileSync(f.accounts.administrationFile,'utf8'),'broken');
 }finally{f.cleanup();}
});
test('owner self-binding requires a private one-time server code, rejects expiry and replay, and binds only the session account',async()=>{
 const f=await fixture();try{let time=1000000;const admin=f.factory({now:()=>time}),[owner,developer]=f.users;
 assert.throws(()=>admin.claimOwner(owner.user.id,{code:'x'.repeat(43)}),fails(403));const expired=admin.issueSetupCode();time+=30*60*1000;assert.throws(()=>admin.claimOwner(owner.user.id,{code:expired}),fails(403));
 const code=admin.issueSetupCode(),disk=readFileSync(f.accounts.administrationFile,'utf8');assert.equal(disk.includes(code),false);assert.equal(admin.access(owner.user.id).ownerConfigured,false);
 assert.throws(()=>admin.claimOwner(owner.user.id,{code,userId:developer.user.id}),fails(403));assert.throws(()=>admin.claimOwner(owner.user.id,{code:'x'.repeat(43)}),fails(403));
 const claimed=admin.claimOwner(owner.user.id,{code});assert.equal(claimed.role,'owner');assert.equal(claimed.administrators[0].id,owner.user.id);assert.equal(admin.access(developer.user.id).role,'user');assert.equal(JSON.parse(readFileSync(f.accounts.administrationFile)).setup,undefined);
 assert.throws(()=>admin.claimOwner(developer.user.id,{code}),fails(409));assert.throws(()=>admin.issueSetupCode(),fails(409));
 }finally{f.cleanup();}
});
test('request policies remain isolated across overlapping async operations and stored reads restore the request context',async()=>{
 validateSiteLimits(DEVELOPER_LIMITS);validateSiteLimits(OPEN_LIMITS);validateSiteLimits(LEGACY_LIMITS);
 const values=await Promise.all([LEGACY_LIMITS,DEVELOPER_LIMITS].map(limits=>withSiteLimits(limits,async()=>{await new Promise(resolve=>setTimeout(resolve,5));assert.equal(getLimits(),limits);assert.equal(withStoredLimits(()=>getLimits().documentChars),OPEN_LIMITS.documentChars);assert.equal(getLimits(),limits);return getLimits().searchUses;})));
 assert.deepEqual(values,[2,0]);assert.equal(getLimits(),LEGACY_LIMITS);
});
test('developer context, documents, projects, memory and local writing accept content above the former ceilings',()=>withSiteLimits(DEVELOPER_LIMITS,()=>{
 const doc={id:'synthetic-doc-01',name:'synthetic.txt',sections:[{label:'段落1',text:'a'.repeat(130000)}]};assert.equal(validateDocuments([doc, ...Array.from({length:3},(_,i)=>({...doc,id:'synthetic-doc-'+i}))]).length,4);
 const projects={version:1,projects:Array.from({length:21},(_,i)=>({id:'synthetic-project-'+i,name:'test',instructions:'x'.repeat(3000),revision:1,documents:[]})),links:[]};assert.equal(validateProjects(projects).projects.length,21);
 const memory={enabled:true,entries:Array.from({length:41},(_,i)=>({id:'synthetic-memory-'+i,text:'x'.repeat(600),enabled:true,always:true}))};assert.equal(validateMemories(memory).entries.length,41);
 const prepared=prepareChatContext([{role:'user',content:'x'.repeat(50000)}],{}, {instructions:'x'.repeat(3000)});assert.equal(prepared.messages[0].content.length,50000);
 const data=new Map(),storage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)},store=createWritingStore(storage);store.save({id:'synthetic-note-01',revision:0,title:'long',text:'x'.repeat(300000)});assert.equal(store.list()[0].text.length,300000);
 withSiteLimits(LEGACY_LIMITS,()=>assert.equal(store.list()[0].text.length,300000));
}));
test('large generated replies survive backup, private cloud restart and a subsequent policy reduction',async()=>{
 const f=await fixture();try{const id=f.users[0].user.id,conversation={id:'synthetic-long-chat',title:'test',provider:'deepseek',model:'test-model',messages:[{role:'user',content:'q'},{role:'assistant',content:'x'.repeat(300000)}]};
 withSiteLimits(DEVELOPER_LIMITS,()=>f.accounts.putConversation(id,conversation.id,{revision:0,conversation}));
 const restarted=createAccountStore(f.file);assert.equal(withSiteLimits(LEGACY_LIMITS,()=>restarted.listConversations(id).conversations[0].conversation.messages[1].content.length),300000);
 const data=new Map([['yunjian-ai-conversations-v1',JSON.stringify([conversation])]]),storage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};
 const backup=withSiteLimits(LEGACY_LIMITS,()=>createBackup(storage));withSiteLimits(DEVELOPER_LIMITS,()=>assert.equal(planImport(backup,{getItem:()=>null}).conversations[0].messages[1].content.length,300000));
 }finally{f.cleanup();}
});
test('OpenRouter omits website search/tool ceilings at zero and honors explicit administrator budgets',async()=>{
 const config={systemPrompt:'test',maxOutputTokens:0,requestTimeoutMs:1000},provider={id:'openrouter',model:'test-model',protocol:'chat-completions',apiUrl:'https://model.test',apiKey:'synthetic',webSearchProtocol:'openrouter-web-search'};
 for(const limits of [DEVELOPER_LIMITS,{...DEVELOPER_LIMITS,searchUses:50,toolCalls:30,searchResults:15,searchTotalResults:100}]){let payload;
 await withSiteLimits(limits,()=>callProvider({config,provider,messages:[{role:'user',content:'test'}],request:new EventEmitter(),response:new EventEmitter(),webSearch:true,fetchImpl:async(_url,options)=>{payload=JSON.parse(options.body);return Response.json({choices:[{message:{content:'synthetic'},finish_reason:'stop'}],usage:{total_tokens:1}});}}));
 assert.equal(payload.max_tokens,undefined);const settings=payload.tools[0].parameters;assert.equal(settings.max_uses,limits.searchUses||undefined);assert.equal(settings.max_results,limits.searchResults||undefined);assert.equal(settings.max_total_results,limits.searchTotalResults||undefined);assert.equal(payload.max_tool_calls,limits.toolCalls||undefined);assert.equal(settings.search_context_size,'high');
 }
});
test('lowering policy retains readable/exportable long prompts and original files; new oversized uploads remain rejected',async()=>{
 const f=await fixture();try{const prompts=[{id:'synthetic-long-prompt',title:'test',content:'x'.repeat(8000),createdAt:1,updatedAt:1}],storage={getItem:()=>JSON.stringify(prompts)};
 withSiteLimits(LEGACY_LIMITS,()=>{const loaded=loadPromptLibrary(storage);assert.equal(loaded[0].content.length,8000);assert.equal(JSON.parse(exportPromptLibrary(loaded)).prompts[0].content.length,8000);});
 const id=f.users[0].user.id,projectId='synthetic-project-01',documentId='synthetic-document-01',content=Buffer.alloc(6*1024*1024,65);
 const store=createProjectOriginalStore(join(f.dir,'originals'),{requireUser:f.accounts.requireUser,getProjects:()=>({projects:[{id:projectId,documents:[{id:documentId}]}]})});
 withSiteLimits(DEVELOPER_LIMITS,()=>store.upload(id,{projectId,documentId,name:'test.txt'},content));
 const value=withSiteLimits(LEGACY_LIMITS,()=>store.list(id)),snapshot=createHash('sha256').update(JSON.stringify([...value.files].sort((a,b)=>a.id.localeCompare(b.id)).map(f=>[f.id,f.projectId,f.documentId,f.name,f.size,f.sha256,f.createdAt,f.cleanupPending]))).digest('hex');
 assert.equal(withSiteLimits(LEGACY_LIMITS,()=>store.download(id,value.files[0].id).content.length),content.length);
 const archive=withSiteLimits(LEGACY_LIMITS,()=>store.export(id,snapshot));const blob=new Blob([...archive.chunks]);await withSiteLimits(LEGACY_LIMITS,()=>verifyOriginalZip(blob,value,{allowStored:true}));
 assert.throws(()=>withSiteLimits(LEGACY_LIMITS,()=>store.upload(id,{projectId,documentId,name:'test.txt'},content)),fails(413));
 }finally{f.cleanup();}
});
test('stream collection accepts a reply above 240k and still refuses the configured reply ceiling without losing prior deltas',async()=>{
 const body=text=>new Response('data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\n\ndata: [DONE]\n\n').body;
 let got='';await withSiteLimits(DEVELOPER_LIMITS,()=>collectProviderStream(body('x'.repeat(300000)),'chat-completions',d=>got+=d));assert.equal(got.length,300000);
 await assert.rejects(withSiteLimits(LEGACY_LIMITS,()=>collectProviderStream(body('x'.repeat(300000)),'chat-completions',()=>{})),/too large/);
});
test('HTTP administration enforces cookie, identity, origin, role and revision; quotas can be removed then changed live',async()=>{
 const f=await fixture();let server;try{const setupCode=f.admin.issueSetupCode();let calls=0;
 const config=loadConfig({NODE_ENV:'test',BIND_HOST:'127.0.0.1',GATEWAY_ACCESS_TOKEN:token,DEEPSEEK_API_KEY:'synthetic-key-1234567890',MAX_OUTPUT_TOKENS:'0',RATE_LIMIT_PER_MINUTE:'1',DAILY_REQUEST_LIMIT:'1',DAILY_TOKEN_LIMIT:'1000'});
 server=createGatewayServer({config,accountStore:f.accounts,administration:f.admin,fetchImpl:async()=>{calls++;return Response.json({output_text:'synthetic',choices:[{message:{content:'synthetic'},finish_reason:'stop'}],usage:{total_tokens:10,input_tokens:5,output_tokens:5}});}});server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 const headers=user=>({'content-type':'application/json',cookie:'plaude_session='+user.sessionToken,origin:base,'x-plaude-client':'1','x-plaude-account-id':user.user.id});const [owner,developer,regular]=f.users;
 const req=(path,{user=owner,body,extra={},method=body?'PUT':'GET'}={})=>fetch(base+'/api/account/administration'+path,{method,headers:{...headers(user),...extra},...(body?{body:JSON.stringify(body)}:{})});
 assert.equal((await req('/claim',{method:'POST',body:{code:setupCode},extra:{origin:'https://evil.test'}})).status,403);
 assert.equal((await req('/claim',{method:'POST',body:{code:'x'.repeat(43)}})).status,403);
 assert.equal((await req('/claim',{method:'POST',body:{code:setupCode,userId:regular.user.id}})).status,400);
 assert.equal((await req('/claim',{method:'POST',body:{code:setupCode}})).status,200);
 assert.equal((await req('/claim',{user:regular,method:'POST',body:{code:setupCode}})).status,409);
 assert.equal((await req('',{user:regular})).status,403);assert.equal((await req('',{extra:{cookie:''}})).status,401);assert.equal((await req('',{extra:{'x-plaude-account-id':regular.user.id}})).status,403);
 assert.equal((await req('/limits',{body:{revision:1,limits:OPEN_LIMITS},extra:{origin:'https://evil.test'}})).status,403);
 assert.equal((await req('/limits',{body:{revision:1,limits:OPEN_LIMITS},extra:{'x-plaude-client':''}})).status,403);
 assert.equal((await req('/limits',{user:regular,body:{revision:1,limits:OPEN_LIMITS,role:'owner'}})).status,403);
 let response=await req('/administrators',{body:{revision:2,username:'developer',administrator:true}});assert.equal(response.status,200);const granted=await response.json();
 assert.equal((await req('/administrators',{user:developer,body:{revision:granted.revision,username:'regular',administrator:true}})).status,403);
 const policy=await (await fetch(base+'/api/site-policy')).json();assert.equal(policy.limits.dailyRequestLimit,0);assert.equal(Object.hasOwn(policy,'administrators'),false);
 const catalog=await(await fetch(base+'/api/providers')).json();assert.equal(catalog.concurrentRequests,4);assert.equal(catalog.limits.maxMessages,256);
 const chat=()=>fetch(base+'/api/chat',{method:'POST',headers:headers(regular),body:JSON.stringify({provider:'deepseek',messages:[{role:'user',content:'x'.repeat(50000)}]})});
 for(let i=0;i<3;i++){const answer=await chat();assert.equal(answer.status,200,await answer.text());}assert.equal(calls,3);
 response=await req('/limits',{user:developer,body:{revision:granted.revision,limits:{...DEVELOPER_LIMITS,dailyRequestLimit:1}}});assert.equal(response.status,200);const saved=await response.json();assert.equal((await chat()).status,429);assert.equal(calls,3);
 assert.equal((await req('/limits',{body:{revision:granted.revision,limits:DEVELOPER_LIMITS}})).status,409);
 response=await req('/administrators',{body:{revision:saved.revision,username:'developer',administrator:false}});assert.equal(response.status,200);assert.equal((await req('',{user:developer})).status,403);
 }finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}f.cleanup();}
});
