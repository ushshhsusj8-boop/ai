// Separate, private Unix-socket service. The website never gets Docker access.
import { createServer } from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, writeFile, chmod, rm, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { validateCodeJob } from './code_execution.mjs';
import {collectCodeArtifacts} from './artifact_collection.mjs';

const execute = promisify(execFile);
const qa = process.env.PLAUDE_RUNNER_QA || '';
if(qa && !/^[a-z0-9][a-z0-9-]{1,40}$/.test(qa)) throw Error('Invalid isolated QA name');
const socket = qa ? `/run/plaude-runner-qa-${qa}/runner.sock` : '/run/plaude-runner/runner.sock';
const jobs = qa ? `/var/lib/plaude-runner/qa-${qa}` : '/var/lib/plaude-runner/jobs';
const label = qa ? `plaude.runner=qa-${qa}` : 'plaude.runner=1';
const images = { python: process.env.PLAUDE_PYTHON_IMAGE, java: process.env.PLAUDE_JAVA_IMAGE };
for (const image of Object.values(images)) if (!image || !/^(?:[a-z0-9./:_-]+@)?sha256:[a-f0-9]{64}$/.test(image)) throw Error('Runner requires pinned image digests');
const TIMEOUT = 20000, OUTPUT_LIMIT = 65536;
let busy = false; const active = new Set();
await mkdir(jobs, { recursive: true, mode: 0o700 });
const old = await execute('/usr/bin/docker', ['ps', '-aq', '--filter', 'label='+label], { timeout: 10000 });
for (const id of old.stdout.trim().split(/\s+/).filter(Boolean)) {
  if (!/^[a-f0-9]{12,64}$/.test(id)) throw Error('Invalid container ID');
  await execute('/usr/bin/docker', ['rm', '-f', id], { timeout: 10000 });
}
await unlink(socket).catch(error => { if (error.code !== 'ENOENT') throw error; });

export async function runCode(body, signal) {
  const job = validateCodeJob(body), id = randomUUID(), name = `plaude-code-${qa ? 'qa-'+qa+'-' : ''}${id}`, started = Date.now();
  const directory = await mkdtemp(jobs + '/job-');
  let child, timer, reason = '', stopping;
  const stop = kind => {
    if (reason) return stopping;
    reason = kind;
    stopping = execute('/usr/bin/docker', ['rm', '-f', name], { timeout: 5000 }).catch(() => {})
      .finally(() => child?.kill('SIGKILL'));
    return stopping;
  };
  const abort = () => { void stop('cancelled'); };
  const stdout = [], stderr = []; let bytes = 0;
  try {
    await chmod(directory, 0o755);
    const file = job.language === 'python' ? 'main.py' : 'Main.java';
    await writeFile(`${directory}/${file}`, job.code, { mode: 0o444 });
    await chmod(`${directory}/${file}`, 0o444);
    if (signal.aborted) return { id, language: job.language, status: 'cancelled', stdout: '', stderr: '', exitCode: null, durationMs: 0 };
    const command = job.language === 'python' ? ['python', '-I', '-B', '/input/main.py']
      : ['java', '-Xmx128m', '-XX:MaxMetaspaceSize=96m', '-XX:ReservedCodeCacheSize=32m', '-XX:ActiveProcessorCount=1', '-XX:+UseSerialGC', '-Djava.io.tmpdir=/tmp', '/input/Main.java'];
    const args = ['create', '--name', name, '--label', label, '--pull=never', '--network=none', '--read-only',
      '--cap-drop=ALL', '--security-opt=no-new-privileges:true', '--user=65534:65534', '--cpus=0.5', '--memory=384m', '--memory-swap=384m',
      '--pids-limit=64', '--ulimit=nofile=128:128', '--ulimit=fsize=1048576:1048576', '--log-driver=none', '--init',
      '--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777', '--tmpfs=/work:rw,noexec,nosuid,nodev,size=64m,mode=1777',
      '--workdir=/work', '--mount', `type=bind,src=${directory},dst=/input,readonly`, '--entrypoint=/bin/sh', images[job.language], '-c', 'sleep 60'];
    await execute('/usr/bin/docker', args, { timeout: 10000 });
    await execute('/usr/bin/docker', ['start', name], { timeout: 10000 });
    if (signal.aborted) return { id, language: job.language, status: 'cancelled', stdout: '', stderr: '', exitCode: null, durationMs: Date.now() - started };
    const exitCode = await new Promise((resolve, reject) => {
      child = spawn('/usr/bin/docker', ['exec', '-i', name, ...command], { stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin', HOME: '/nonexistent' } });
      active.add(abort); signal.addEventListener('abort', abort, { once: true });
      const capture = target => data => {
        const remaining = Math.max(0, OUTPUT_LIMIT - bytes); target.push(data.subarray(0, remaining)); bytes += data.length;
        if (bytes > OUTPUT_LIMIT) void stop('output_limit');
      };
      child.stdout.on('data', capture(stdout)); child.stderr.on('data', capture(stderr));
      child.on('error', reject); child.on('close', code => resolve(code));
      child.stdin.on('error', () => {}); child.stdin.end(job.stdin);
      timer = setTimeout(() => { void stop('timeout'); }, TIMEOUT);
      if (signal.aborted) abort();
    });
    clearTimeout(timer);
    await stopping;
    let artifacts={files:[],fileNotice:reason?'任务已终止，未提取生成文件。':''};
    if(!reason && !signal.aborted) {
      try {
        // Freeze surviving descendants before touching their output; tmpfs stays mounted.
        await execute('/usr/bin/docker',['pause',name],{timeout:5000});
        const inspected=await execute('/usr/bin/docker',['inspect','--format','{{.State.Pid}}',name],{timeout:5000});
        const pid=inspected.stdout.trim();if(!/^[1-9][0-9]{0,9}$/.test(pid))throw Error('Invalid runner PID');
        artifacts=await collectCodeArtifacts('/proc/'+pid+'/root/work/output');
      } catch {artifacts={files:[],fileNotice:'生成文件未能安全提取，程序输出仍保留。'};}
    }
    return { id, language: job.language, status: reason || (exitCode === 0 ? 'completed' : 'failed'),
      stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), exitCode,
      durationMs: Date.now() - started,...artifacts };
  } finally {
    clearTimeout(timer); signal.removeEventListener('abort', abort); active.delete(abort);
    await execute('/usr/bin/docker', ['rm', '-f', name], { timeout: 10000 }).catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
}
const server = createServer(async (req, res) => {
  const json = (status, value) => { if (!res.destroyed) { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); } };
  if (req.method === 'GET' && req.url === '/health') return json(200, { ok: true, busy });
  if (req.method !== 'POST' || req.url !== '/run') return json(404, { error: 'Not found' });
  if (busy) return json(429, { error: '另一个代码任务正在运行，请稍后重试。' });
  busy = true; const controller = new AbortController();
  res.once('close', () => { if (!res.writableEnded) controller.abort(); });
  try {
    let length = 0; const chunks = [];
    for await (const chunk of req) { length += chunk.length; if (length > 200000) throw Error('Request too large'); chunks.push(chunk); }
    const job = validateCodeJob(JSON.parse(Buffer.concat(chunks)));
    json(200, await runCode(job, controller.signal));
  } catch { json(400, { error: '执行请求无效或隔离环境启动失败。' }); }
  finally { busy = false; }
});
server.requestTimeout = 25000; server.headersTimeout = 5000;
server.listen(socket, async () => { await chmod(socket, 0o660); console.log('plaude code runner ready'); });
for (const event of ['SIGTERM', 'SIGINT']) process.on(event, () => {
  for (const abort of active) abort(); server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 12000).unref();
});
