// Account caches never fall back to the browser's original shared workspace.
const ACCOUNT_PREFIX = 'plaude-account:';
let scope;

export function configureStorageScope(userId) {
  if (userId !== null && (typeof userId !== 'string' || !userId.trim() || userId !== userId.trim() || userId.length > 128)) {
    throw Error('账户存储标识无效。');
  }
  scope = userId;
}

export const getStorageScope = () => scope;

function nativeStorage() {
  if (!globalThis.localStorage) throw Error('浏览器存储不可用。');
  return globalThis.localStorage;
}

function prefix() {
  if (scope === undefined) throw Error('账户身份尚未确认，暂不读取浏览器数据。');
  return scope === null ? '' : `${ACCOUNT_PREFIX}${encodeURIComponent(scope)}:`;
}

function keys(storage, selectedPrefix) {
  const selected = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (typeof key !== 'string') continue;
    if (selectedPrefix ? key.startsWith(selectedPrefix) : !key.startsWith(ACCOUNT_PREFIX)) selected.push(key);
  }
  return selected;
}

export const scopedStorage = Object.freeze({
  getItem(key) { return nativeStorage().getItem(prefix() + String(key)); },
  setItem(key, value) { nativeStorage().setItem(prefix() + String(key), String(value)); },
  removeItem(key) { nativeStorage().removeItem(prefix() + String(key)); },
  key(index) {
    const selectedPrefix = prefix();
    const key = keys(nativeStorage(), selectedPrefix)[index];
    return key === undefined ? null : key.slice(selectedPrefix.length);
  },
  get length() { return keys(nativeStorage(), prefix()).length; },
  clear() {
    const selectedPrefix = prefix(), storage = nativeStorage();
    for (const key of keys(storage, selectedPrefix)) storage.removeItem(key);
  },
});

// Only the gateway invitation token and identity-change notices use this proxy.
export const globalStorage = Object.freeze({
  getItem(key) { return nativeStorage().getItem(String(key)); },
  setItem(key, value) { nativeStorage().setItem(String(key), String(value)); },
  removeItem(key) { nativeStorage().removeItem(String(key)); },
});
