// Synthetic local upstream only. Run in a child because the old dependency crashes Node.
import {createServer} from 'node:http';
import {once} from 'node:events';
import {gzipSync} from 'node:zlib';
import {createWorkspaceSettings} from '../src/workspace_settings.mjs';
import {createGatewayServer} from '../src/app.mjs';
import {loadConfig} from '../src/config.mjs';
import {readChatStream} from '../public/event_stream.js';

export async function startSecurityFixture() {
  const upstream=createServer(async(req,res)=>{
    let payload='';for await(const part of req)payload+=part;
    const input=payload?JSON.parse(payload):{};
    if(req.url==='/malformed'||input.messages?.some(m=>m.content==='security-failure')){
      res.writeHead(200,{'Content-Encoding':'gzip, gzip, gzip, gzip, gzip, gzip','Content-Length':'42','Connection':'close'});
      res.end();return;
    }
    if(input.stream){
      res.writeHead(200,{'Content-Type':'text/event-stream'});
      res.end('data: '+JSON.stringify({choices:[{index:0,delta:{content:'Synthetic recovery'},finish_reason:null}]})+'\n\n'
        +'data: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');return;
    }
    const body=gzipSync(JSON.stringify({choices:[{message:{role:'assistant',content:'Synthetic recovery'},finish_reason:'stop'}]}));
    res.writeHead(200,{'Content-Type':'application/json','Content-Encoding':'gzip'});res.end(body);
  });
  upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
  const upstreamOrigin='http://127.0.0.1:'+upstream.address().port;
  const config=loadConfig({NODE_ENV:'test',BIND_HOST:'127.0.0.1',
    GATEWAY_ACCESS_TOKEN:'security-fixture-abcdefghijklmnopqrstuvwxyz',
    NVIDIA_API_KEY:'nvapi-synthetic-abcdefghijklmnopqrstuvwxyz',
    NVIDIA_API_URL:upstreamOrigin+'/chat/completions',REQUEST_TIMEOUT_MS:'2000'});
  const workspace=createWorkspaceSettings(config);
  const gateway=createGatewayServer({config,fetchImpl:workspace.fetch});
  gateway.listen(0,'127.0.0.1');await once(gateway,'listening');
  const origin='http://127.0.0.1:'+gateway.address().port;
  const request=(content,stream=false)=>fetch(origin+'/api/chat',{
    method:'POST',headers:{authorization:'Bearer '+config.gatewayAccessToken,'Content-Type':'application/json',...(stream?{accept:'text/event-stream'}:{})},
    body:JSON.stringify({provider:'nvidia',messages:[{role:'user',content}]}),signal:AbortSignal.timeout(5000)});
  return {origin,upstreamOrigin,workspace,request,token:config.gatewayAccessToken,async close(){
    workspace.close();gateway.closeAllConnections();upstream.closeAllConnections();
    await Promise.all([new Promise(r=>gateway.close(r)),new Promise(r=>upstream.close(r))]);
  }};
}
if(process.argv.includes('--run')){
  const mode=process.argv.at(-1),fixture=await startSecurityFixture();
  try{
    let rejected=false,result={mode};
    if(mode==='fetch'){
      try{await fixture.workspace.fetch(fixture.upstreamOrigin+'/malformed');}catch{rejected=true;}
      // Give an orphaned body error time to surface before testing process recovery.
      await new Promise(r=>setTimeout(r,150));
      result.recovered=(await(await fixture.workspace.fetch(fixture.upstreamOrigin+'/healthy')).json()).choices[0].message.content;
    }else{
      const bad=await fixture.request('security-failure',mode==='stream');
      if(mode==='stream'){try{await readChatStream(bad,()=>{});}catch{rejected=true;}}
      else{result.failureStatus=bad.status;const body=await bad.json();rejected=bad.status===502&&Boolean(body.error);}
      await new Promise(r=>setTimeout(r,150));
      const good=await fixture.request('security-recovery',mode==='stream');
      result.recoveryStatus=good.status;
      result.recovered=mode==='stream'?(await readChatStream(good,()=>{})).text:(await good.json()).text;
      result.healthStatus=(await fetch(fixture.origin+'/healthz')).status;
    }
    result.rejected=rejected;console.log(JSON.stringify(result));
  }finally{await fixture.close();}
}
