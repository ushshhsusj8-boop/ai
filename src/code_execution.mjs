import { request } from 'node:http';

export function validateCodeJob(value) {
  if (!value || !['python', 'java'].includes(value.language)) throw Error('请选择 Python 或 Java。');
  if (typeof value.code !== 'string' || !value.code.trim() || Buffer.byteLength(value.code) > 32768) throw Error('代码不能为空，且最多 32 KiB。');
  if (value.stdin !== undefined && (typeof value.stdin !== 'string' || Buffer.byteLength(value.stdin) > 16384)) throw Error('标准输入最多 16 KiB。');
  return { language: value.language, code: value.code, stdin: value.stdin || '' };
}
export function callCodeRunner(socketPath, body, signal) {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath, path: '/run', method: 'POST', signal, timeout: 45000,
      headers: { 'content-type': 'application/json' } }, res => {
      let bytes = 0; const chunks = [];
      res.on('data', chunk => { bytes += chunk.length; if (bytes > 1024*1024) req.destroy(Error('运行结果过大。')); else chunks.push(chunk); });
      res.on('end', () => {
        try {
          const result = JSON.parse(Buffer.concat(chunks));
          if (res.statusCode !== 200) throw Object.assign(Error(result.error || '代码执行服务暂不可用。'), { statusCode: res.statusCode });
          resolve(result);
        } catch (error) { reject(error); }
      });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(Error('代码执行服务响应超时。')));
    req.on('error', error => reject(error.name === 'AbortError' ? error : Object.assign(Error('代码执行服务暂不可用。'), { statusCode: 503 })));
    req.end(JSON.stringify(validateCodeJob(body)));
  });
}
