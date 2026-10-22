import test from 'node:test';
import assert from 'node:assert/strict';
import {codeFileDraft,codeErrorLines,codeLineRange} from '../public/code_workspace_tools.js';
test('code imports detect Python/Java files, preserve plain-text choice and reject oversized or unsupported input',()=>{
  assert.deepEqual(codeFileDraft('MAIN.JAVA','class Main {}'),{language:'java',code:'class Main {}'});
  assert.equal(codeFileDraft('script.py','print(1)','java').language,'python');assert.equal(codeFileDraft('snippet.txt','print(1)','java').language,'java');
  assert.throws(()=>codeFileDraft('bad.js','alert(1)'));assert.throws(()=>codeFileDraft('empty.py','  '));assert.throws(()=>codeFileDraft('large.py','中'.repeat(11000)));
});
test('only own Python/Java file errors become bounded deduplicated source-line links',()=>{
  const code='one\ntwo\nthree';
  assert.deepEqual(codeErrorLines('python','File "/input/main.py", line 2\nFile "/input/main.py", line 2\nFile "/lib/tool.py", line 1\nFile "/input/main.py", line 999',code),[2]);
  assert.deepEqual(codeErrorLines('java','/input/Main.java:3: error\nat Main.main(Main.java:2)\nTool.java:1: error',code),[3,2]);
});
test('source line ranges preserve Unicode and CRLF offsets and reject out of range numbers',()=>{
  assert.deepEqual(codeLineRange('甲😀\r\nsecond\n',2),{start:5,end:11});assert.equal(codeLineRange('one',2),null);assert.equal(codeLineRange('one',0),null);
});
