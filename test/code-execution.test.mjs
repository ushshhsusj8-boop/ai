import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { createGatewayServer } from '../src/app.mjs';
import { loadConfig } from '../src/config.mjs';
import { validateCodeJob } from '../src/code_execution.mjs';
const config = loadConfig({ NODE_ENV: 'test', BIND_HOST: '127.0.0.1', GATEWAY_ACCESS_TOKEN: 'code-test-token-abcdefghijklmnopqrstuvwxyz', DEEPSEEK_API_KEY: 'sk-test-abcdefghijklmnopqrstuvwxyz', DEFAULT_PROVIDER: 'deepseek', CODE_RUNNER_SOCKET: '/run/test/runner.sock', RATE_LIMIT_PER_MINUTE: '600' });
const headers = { 'content-type': 'application/json', authorization: `Bearer ${config.gatewayAccessToken}` };
async function server(t, runCode, overrides={}) {
 const app = createGatewayServer({ config:{...config,...overrides}, runCode }); app.listen(0,'127.0.0.1');await once(app,'listening');
 t.after(()=>{app.closeAllConnections();app.close();});return `http://127.0.0.1:${app.address().port}`;
}
const post = (url, value, options={}) => fetch(url+'/api/code/run',{method:'POST',headers,body:JSON.stringify(value),...options});
test('code input validation enforces UTF8 sizes and does not accept execution options',()=>{
 assert.deepEqual(validateCodeJob({language:'python',code:'print(1)',stdin:'a',image:'evil',timeout:999}),{language:'python',code:'print(1)',stdin:'a'});
 assert.throws(()=>validateCodeJob({language:'shell',code:'id'}),/Python/);
 assert.throws(()=>validateCodeJob({language:'python',code:'中'.repeat(12000)}),/32 KiB/);
 assert.throws(()=>validateCodeJob({language:'java',code:'class Main {}',stdin:'a'.repeat(16385)}),/16 KiB/);
});
test('code and activity routes require website access and respect origin policy',async t=>{
 let called=0; const url=await server(t,async()=>{called++;});
 assert.equal((await post(url,{language:'python',code:'print(1)'},{headers:{'content-type':'application/json'}})).status,401);
 assert.equal((await fetch(url+'/api/activity')).status,401);
 assert.equal((await post(url,{language:'python',code:'print(1)'},{headers:{...headers,origin:'https://evil.example'}})).status,403);
 assert.equal(called,0);
});
test('runner receives validated job and logs execution metadata without code stdin output or credentials',async t=>{
 const url=await server(t,async(socket,job)=>{assert.equal(socket,config.codeRunnerSocket);assert.deepEqual(job,{language:'python',code:'print("PRIVATE_CODE")',stdin:'PRIVATE_INPUT'});return {id:'job-test',language:'python',stdout:'PRIVATE_OUTPUT',stderr:'',exitCode:0,status:'completed',durationMs:20};});
 const res=await post(url,{language:'python',code:'print("PRIVATE_CODE")',stdin:'PRIVATE_INPUT',command:'no'});assert.equal(res.status,200);assert.equal((await res.json()).stdout,'PRIVATE_OUTPUT');
 const logs=await(await fetch(url+'/api/activity',{headers})).json();assert.deepEqual(logs.events.map(e=>e.type),['code_started','code_completed']);
 assert.equal(/PRIVATE_|code-test-token|sk-test/.test(JSON.stringify(logs)),false);
});
test('one concurrent code job and cancellation propagates to runner',async t=>{
 let entered,aborted; const started=new Promise(r=>entered=r), cancelled=new Promise(r=>aborted=r);
 const url=await server(t,async(_,job,signal)=>{entered();await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted();reject(new DOMException('Aborted','AbortError'));},{once:true}));});
 const controller=new AbortController();const pending=post(url,{language:'python',code:'while True: pass'},{signal:controller.signal});await started;
 assert.equal((await post(url,{language:'python',code:'print(2)'})).status,429);controller.abort();await assert.rejects(pending);await cancelled;
});
test('disabled runner and invalid code fail before execution',async t=>{
 let called=false;let url=await server(t,async()=>{called=true;},{codeRunnerSocket:undefined});assert.equal((await post(url,{language:'python',code:'print(1)'})).status,503);
 url=await server(t,async()=>{called=true;});assert.equal((await post(url,{language:'python',code:''})).status,400);assert.equal(called,false);
});
