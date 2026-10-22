import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Agent, EnvHttpProxyAgent, ProxyAgent, fetch as networkFetch } from 'undici';

const DEFAULTS = { connections: [], network: { mode: 'direct', url: '' },
  search: { engine: 'builtin', url: '', apiKey: '', maxResults: 5, depth: 'basic', timeRange: '' } };
const modelPattern = /^[~A-Za-z0-9][A-Za-z0-9._~:/+-]{0,191}$/;
function text(value, max = 2048) {
  if (typeof value !== 'string' || value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw Error('设置文字无效或过长。');
  return value.trim();
}
function serviceUrl(value, { proxy = false, optional = false } = {}) {
  const raw = text(value);
  if (!raw && optional) return '';
  let url; try { url = new URL(raw); } catch { throw Error('请输入完整的服务 URL。'); }
  if (!(proxy ? ['http:', 'https:', 'socks5:'] : ['http:', 'https:']).includes(url.protocol)
    || url.hash || (!proxy && (url.username || url.password))) throw Error('服务 URL 格式不受支持。');
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (!proxy && url.protocol !== 'https:' && !loopback) throw Error('外部服务必须使用 HTTPS；本机端点可以使用 HTTP。');
  return url.toString();
}
export function createWorkspaceSettings(baseConfig, { file, keyFile = `${file}.key` } = {}) {
  let masterKey;
  let settings = structuredClone(DEFAULTS);
  let activeConfig = baseConfig;
  let catalogs = {};
  let dispatcher;
  function key() {
    if (masterKey) return masterKey;
    if (existsSync(keyFile)) masterKey = readFileSync(keyFile);
    else {
      mkdirSync(dirname(keyFile), { recursive: true, mode: 0o700 });
      masterKey = randomBytes(32); writeFileSync(keyFile, masterKey, { mode: 0o600, flag: 'wx' });
    }
    if (masterKey.length !== 32) throw Error('工作区密钥文件无效。');
    return masterKey;
  }
  if (file && existsSync(file)) {
    const envelope = JSON.parse(readFileSync(file, 'utf8'));
    const cipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(envelope.iv, 'base64'));
    cipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    settings = JSON.parse(Buffer.concat([cipher.update(Buffer.from(envelope.data, 'base64')), cipher.final()]).toString());
  }
  function buildConfig(value) {
    const providers = Object.fromEntries(Object.entries(baseConfig.providers).map(([id, p]) => [id,
      catalogs[id]?.apiUrl === p.apiUrl ? { ...p, ...catalogs[id] } : p]));
    for (const connection of value.connections) {
      const original = providers[connection.id];
      const changedEndpoint = original && (original.apiUrl !== connection.apiUrl || original.protocol !== connection.protocol);
      providers[connection.id] = { ...original, ...connection,
        apiKey: connection.apiKey || original?.apiKey,
        ...(changedEndpoint ? { webSearchProtocol: undefined, webSearchApiBaseUrl: undefined,
          modelCatalogUrl: undefined, modelCatalogMode: undefined } : {}),
        modelOptions: connection.models.map(id => original?.modelOptions?.find(m => m.id === id) || { id, label: id }) };
      if (connection.id === 'gemini' && connection.protocol === 'chat-completions' && connection.apiUrl === 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions') {
        providers[connection.id].webSearchProtocol = 'google-search';
        providers[connection.id].webSearchApiBaseUrl = 'https://generativelanguage.googleapis.com/v1beta/models/';
      }
    }
    return { ...baseConfig, providers, workspaceSearch: value.search };
  }
  function makeDispatcher(value) {
    if (value.mode === 'custom') return new ProxyAgent(value.url);
    if (value.mode === 'system') return new EnvHttpProxyAgent();
    return new Agent();
  }
  activeConfig = buildConfig(settings);
  dispatcher = makeDispatcher(settings.network);
  const runtimeConfig = new Proxy({}, { get(_target, name) { return activeConfig[name]; },
    ownKeys() { return Reflect.ownKeys(activeConfig); },
    getOwnPropertyDescriptor(_target, name) { return name in activeConfig ? { enumerable: true, configurable: true } : undefined; } });
  function publicSettings() {
    return { connections: Object.values(activeConfig.providers).map(p => ({ id: p.id, label: p.label,
      apiUrl: p.apiUrl, protocol: p.protocol, model: p.model, models: [...p.models],
      keyConfigured: Boolean(p.apiKey), custom: !Object.hasOwn(baseConfig.providers, p.id) })),
      network: { ...settings.network, url: settings.network.url.replace(/\/\/[^/@]+@/, '//***@') },
      search: { ...settings.search, apiKey: undefined, keyConfigured: Boolean(settings.search.apiKey) },
      encrypted: Boolean(file), maxOutputTokens: baseConfig.maxOutputTokens };
  }
  function save(input) {
    if (!input || typeof input !== 'object' || !Array.isArray(input.connections) || input.connections.length > 12) throw Error('连接设置无效。');
    const ids = new Set();
    const connections = input.connections.map(item => {
      const id = text(item.id, 48);
      if (!/^[a-z][a-z0-9_-]{0,47}$/.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id) || ids.has(id)) throw Error('服务商 ID 无效或重复。');
      ids.add(id);
      const original = baseConfig.providers[id];
      if (!original && !id.startsWith('custom-') && id !== 'gemini') throw Error('自定义服务 ID 必须以 custom- 开头。');
      const previous = settings.connections.find(c => c.id === id);
      const apiKey = text(item.apiKey || '', 4096) || previous?.apiKey || original?.apiKey;
      if (!apiKey || apiKey.length < 20) throw Error('请为新服务填写有效的 API 密钥。');
      const models = [...new Set((Array.isArray(item.models) ? item.models : []).map(m => text(m, 192)))];
      if (!models.length || models.length > 24 || models.some(m => !modelPattern.test(m) || m.includes('://'))) throw Error('每个服务支持 1–24 个有效模型 ID。');
      const model = text(item.model || models[0], 192);
      if (!models.includes(model)) throw Error('默认模型必须在模型列表内。');
      if (!['responses', 'chat-completions'].includes(item.protocol)) throw Error('请选择受支持的 API 协议。');
      return { id, label: text(item.label, 80) || id, apiUrl: serviceUrl(item.apiUrl), protocol: item.protocol, model, models, apiKey };
    });
    if (!['direct', 'system', 'custom'].includes(input.network?.mode)) throw Error('代理模式无效。');
    const mode = input.network.mode;
    const proxyInput = input.network.url === settings.network.url.replace(/\/\/[^/@]+@/, '//***@')
      ? settings.network.url : input.network.url;
    const network = { mode, url: mode === 'custom' ? serviceUrl(proxyInput, { proxy: true }) : '' };
    const raw = input.search;
    if (!['builtin', 'tavily', 'searxng'].includes(raw?.engine)) throw Error('搜索引擎无效。');
    if (!Number.isInteger(raw.maxResults) || raw.maxResults < 1 || raw.maxResults > 10) throw Error('搜索结果数必须是 1–10。');
    if (!['basic', 'advanced'].includes(raw.depth) || !['', 'day', 'week', 'month', 'year'].includes(raw.timeRange)) throw Error('搜索参数无效。');
    if (raw.engine === 'searxng' && raw.timeRange === 'week') throw Error('SearXNG 时间范围支持一天、一月或一年，请重新选择。');
    const search = { engine: raw.engine, url: raw.engine === 'tavily' ? 'https://api.tavily.com/search'
      : serviceUrl(raw.url || '', { optional: raw.engine !== 'searxng' }),
      apiKey: text(raw.apiKey || '', 4096) || settings.search.apiKey,
      maxResults: raw.maxResults, depth: raw.depth, timeRange: raw.timeRange };
    if (search.engine === 'tavily' && !search.apiKey) throw Error('Tavily 搜索需要独立的搜索 API 密钥。');
    const next = { connections, network, search };
    const nextDispatcher = makeDispatcher(network);
    try {
      if (file) {
        mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
        const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(), iv);
        const data = Buffer.concat([cipher.update(JSON.stringify(next)), cipher.final()]);
        writeFileSync(`${file}.tmp`, JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }), { mode: 0o600 });
        renameSync(`${file}.tmp`, file);
      }
    } catch (error) { void nextDispatcher.close(); throw error; }
    void dispatcher.close().catch(() => {}); dispatcher = nextDispatcher;
    settings = next; activeConfig = buildConfig(settings);
    return publicSettings();
  }
  return { config: runtimeConfig, get: publicSettings, save,
    updateCatalog(loadedConfig) { catalogs = loadedConfig.providers; activeConfig = buildConfig(settings); },
    fetch: (url, options = {}) => networkFetch(url, { ...options, dispatcher }),
    close() { void dispatcher.close().catch(() => {}); } };
}
