import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// GHSA-xjj6-f33q-929c: malicious upstream content codings must fail without
// terminating the production workspace transport, gateway, or next request.
for(const mode of ['fetch','json','stream']){
  test('malformed upstream encodings preserve '+mode+' transport and subsequent requests',()=>{
    const result=spawnSync(process.execPath,[fileURLToPath(new URL('./undici-security.fixture.mjs',import.meta.url)),'--run',mode],{
      encoding:'utf8',timeout:12000,env:{...process.env,HTTP_PROXY:'',HTTPS_PROXY:'',ALL_PROXY:'',NO_PROXY:'*'}});
    assert.ifError(result.error);
    assert.equal(result.signal,null,result.stderr);
    assert.equal(result.status,0,result.stderr);
    const record=JSON.parse(result.stdout.trim());
    assert.equal(record.rejected,true);
    assert.equal(record.recovered,'Synthetic recovery');
    if(mode!=='fetch'){assert.equal(record.recoveryStatus,200);assert.equal(record.healthStatus,200);}
    if(mode==='json')assert.equal(record.failureStatus,502);
  });
}
