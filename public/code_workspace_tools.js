export function codeFileDraft(name,text,currentLanguage='python') {
  if(typeof text!=='string'||!text.trim()||new TextEncoder().encode(text).length>32768)throw Error('代码文件必须非空且最多32 KiB。');
  const extension=String(name).split('.').at(-1).toLowerCase();
  if(!['py','java','txt'].includes(extension))throw Error('请选择.py、.java或.txt代码文件。');
  return {language:extension==='java'?'java':extension==='py'?'python':currentLanguage,code:text};
}
export function codeErrorLines(language,stderr,code) {
  const pattern=language==='python'?/File ["'][^"'\n]*\bmain\.py["'], line (\d+)/g:/\bMain\.java:(\d+)(?::|\))/g;
  const count=String(code).split('\n').length;
  return [...new Set([...String(stderr||'').matchAll(pattern)].map(m=>Number(m[1])).filter(n=>Number.isSafeInteger(n)&&n>0&&n<=count))].slice(0,20);
}
export function codeLineRange(code,line) {
  const lines=code.split('\n');if(!Number.isInteger(line)||line<1||line>lines.length)return null;
  const start=lines.slice(0,line-1).reduce((n,s)=>n+s.length+1,0);return {start,end:start+lines[line-1].length};
}
