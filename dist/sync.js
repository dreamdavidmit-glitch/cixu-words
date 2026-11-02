(function (root) {
  'use strict';
  const CONFIG_KEY = 'cixu.github-sync.v1';
  const FILE = 'progress.json';
  const WAIT_MS = 45000;
  let config = readConfig(), timer = null, pending = null, writing = false;
  let status = {mode: config ? 'idle' : 'off', message: config ? '等待同步' : '尚未连接', syncedAt: null};
  const listeners = new Set();

  function readConfig() {
    try {
      const c = JSON.parse(localStorage.getItem(CONFIG_KEY));
      return c && c.owner && c.repo && c.token ? c : null;
    } catch (_) { return null; }
  }
  function emit(mode, message, extra = {}) {
    status = {...status, mode, message, ...extra};
    listeners.forEach(fn => { try { fn({...status}); } catch (_) {} });
  }
  function utf8ToBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let out = '';
    for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(out);
  }
  function base64ToUtf8(value) {
    const raw = atob(String(value).replace(/\s/g, '')), bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function endpoint(path = '') {
    return `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}${path}`;
  }
  async function request(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${config.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.headers || {})
      }
    });
    if (response.status === 404 && options.allow404) return null;
    if (!response.ok) {
      let detail = '';
      try { detail = (await response.json()).message || ''; } catch (_) {}
      const err = new Error(response.status === 401 ? '密钥无效或已过期' : response.status === 403 ? '密钥没有读写权限' : response.status === 404 ? '找不到进度仓库' : `GitHub 同步失败（${response.status}）`);
      err.detail = detail; throw err;
    }
    return response.status === 204 ? null : response.json();
  }
  async function readRemote() {
    const file = await request(endpoint(`/contents/${FILE}?t=${Date.now()}`), {allow404: true, cache: 'no-store'});
    if (!file) return null;
    try {
      const payload = JSON.parse(base64ToUtf8(file.content));
      return {payload, sha: file.sha};
    } catch (_) { throw new Error('云端进度文件无法读取'); }
  }
  async function connect(next) {
    const previous = config;
    config = {owner: String(next.owner || '').trim(), repo: String(next.repo || '').trim(), token: String(next.token || '').trim()};
    if (!config.owner || !config.repo || !config.token) { config = previous; throw new Error('请填写 GitHub 密钥'); }
    emit('syncing', '正在连接 GitHub…');
    try {
      const repo = await request(endpoint());
      if (!repo.private) throw new Error('为了保护学习记录，请使用私有仓库');
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
      const remote = await readRemote();
      emit('idle', remote ? '已读取云端进度' : '已连接，等待首次上传');
      return remote?.payload || null;
    } catch (err) {
      config = previous; emit(previous ? 'idle' : 'off', previous ? '仍使用原来的连接' : '尚未连接'); throw err;
    }
  }
  async function pull() {
    if (!config) return null;
    emit('syncing', '正在读取云端进度…');
    try {
      await request(endpoint());
      const remote = await readRemote();
      emit('idle', remote ? '已读取云端进度' : '云端还没有进度');
      return remote?.payload || null;
    } catch (err) {
      emit('error', err.message); return null;
    }
  }
  function queue(payload, immediate = false) {
    if (!config) return;
    pending = {...payload, app: 'reading30', updatedAt: Date.now()};
    emit('pending', '有新进度待上传');
    clearTimeout(timer);
    if (immediate) void flush();
    else timer = setTimeout(() => void flush(), WAIT_MS);
  }
  async function flush() {
    clearTimeout(timer); timer = null;
    if (!config || !pending || writing) return false;
    writing = true; const payload = pending; pending = null;
    emit('syncing', '正在保存到 GitHub…');
    try {
      const current = await readRemote();
      const body = {message: 'Update learning progress', content: utf8ToBase64(JSON.stringify(payload))};
      if (current?.sha) body.sha = current.sha;
      await request(endpoint(`/contents/${FILE}`), {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
      const at = Date.now(); emit('synced', '已保存到 GitHub', {syncedAt: at});
      localStorage.setItem(CONFIG_KEY, JSON.stringify({...config, lastSyncedAt: at}));
      return true;
    } catch (err) {
      pending = pending || payload; emit('error', err.message); return false;
    } finally {
      writing = false;
      if (pending && !timer) timer = setTimeout(() => void flush(), WAIT_MS);
    }
  }
  function disconnect() {
    clearTimeout(timer); timer = null; pending = null; config = null;
    localStorage.removeItem(CONFIG_KEY); emit('off', '尚未连接', {syncedAt: null});
  }
  function onStatus(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function info() { return {configured: !!config, owner: config?.owner || '', repo: config?.repo || '', ...status}; }
  root.CloudProgress = {connect, disconnect, pull, queue, flush, onStatus, info};
})(typeof window !== 'undefined' ? window : globalThis);
