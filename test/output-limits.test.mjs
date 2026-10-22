import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {loadConfig} from '../src/config.mjs';
import {outputTokenLimit, outputTokenBounds} from '../src/output_limits.mjs';
import {callProvider} from '../src/providers.mjs';

test('site output ceiling is opt-in and accepts model maxima above 32000', () => {
  const env = { NODE_ENV: 'test', GATEWAY_ACCESS_TOKEN: 'synthetic-output-token-abcdefghijklmnopqrstuvwxyz', DEEPSEEK_API_KEY: 'sk-synthetic-key-abcdefghijklmnopqrstuvwxyz' };
  assert.equal(loadConfig(env).maxOutputTokens, 0);
  assert.equal(loadConfig({...env, MAX_OUTPUT_TOKENS:'393216'}).maxOutputTokens, 393216);
  for (const invalid of ['-1', '1.5', '9007199254740992']) assert.throws(() => loadConfig({...env, MAX_OUTPUT_TOKENS:invalid}));
});

test('reviewed official model maxima and unknown/custom endpoints remain distinct', () => {
  const nvidia = {apiUrl:'https://integrate.api.nvidia.com/v1/chat/completions'};
  const deepseek = {apiUrl:'https://api.deepseek.com/responses'};
  assert.equal(outputTokenLimit(nvidia, 'google/diffusiongemma-26b-a4b-it'), 32768);
  for (const model of ['deepseek-flash', 'deepseek-v4-pro']) assert.equal(outputTokenLimit(deepseek, model), 393216);
  assert.equal(outputTokenLimit(deepseek, 'future-model'), undefined);
  assert.equal(outputTokenLimit({...deepseek, apiUrl:'https://custom.test/responses'}, 'deepseek-flash'), undefined);
  assert.equal(outputTokenLimit(nvidia, 'google/diffusiongemma-26b-a4b-it', 1200), 1200);
  assert.deepEqual(outputTokenBounds(undefined), {max_output_tokens:{min:1}});
  assert.deepEqual(outputTokenBounds(0), {});
});

test('Gemini search omits automatic limit and forwards explicit large output budgets', async () => {
  for (const max of [0, 65536]) {
    let body;
    await callProvider({provider:{id:'gemini', protocol:'chat-completions', model:'gemini-2.5-flash', apiKey:'synthetic',
      webSearchProtocol:'google-search', webSearchApiBaseUrl:'https://gemini.test/v1beta/models/'},
      messages:[{role:'user',content:'synthetic'}], config:{systemPrompt:'synthetic',maxOutputTokens:max,requestTimeoutMs:5000},
      request:new EventEmitter(),response:new EventEmitter(),requestId:'synthetic',webSearch:true,
      fetchImpl:async(_url,options)=>{body=JSON.parse(options.body);return Response.json({candidates:[{content:{parts:[{text:'synthetic'}]},finishReason:'STOP'}]});}});
    assert.equal(body.generationConfig.maxOutputTokens, max || undefined);
    assert.equal(Object.hasOwn(body.generationConfig,'maxOutputTokens'), max > 0);
  }
});
