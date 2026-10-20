/* Om Wiki Mobile · Dropbox 연결. 화면(boot.js·bridge.js)과 service worker(sw.js)가 함께 쓴다.
   - 로그인: OAuth PKCE(App secret 없음). 토큰은 이 기기의 IndexedDB에만 둔다.
   - 앱 폴더 권한만 받으므로 Dropbox의 「Apps/Om Wiki Mobile」 밖은 읽거나 쓸 수 없다. */
(function (g) {
'use strict';
const CONFIG = g.OM_MOBILE_CONFIG;
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
const DB = 'om-wiki-mobile', STORE = 'kv';

// ---------- IndexedDB ----------
let dbOpen = null;
function idb() {
  dbOpen = dbOpen || new Promise((ok, fail) => {
    const q = indexedDB.open(DB, 1);
    q.onupgradeneeded = () => q.result.createObjectStore(STORE);
    q.onsuccess = () => ok(q.result);
    q.onerror = () => { dbOpen = null; fail(q.error); };
  });
  return dbOpen;
}
async function kv(mode, fn) {
  const db = await idb();
  return new Promise((ok, fail) => { const t = db.transaction(STORE, mode), r = fn(t.objectStore(STORE)); t.oncomplete = () => ok(r?.result); t.onerror = t.onabort = () => fail(t.error); });
}
const get = k => kv('readonly', s => s.get(k));
const set = (k, v) => kv('readwrite', s => s.put(v, k));
const del = k => kv('readwrite', s => s.delete(k));

const fail = (code, message) => Object.assign(new Error(message), { code });

// ---------- 로그인 ----------
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
// redirect: 돌아올 주소(Android·PC). 없으면 Dropbox가 코드를 보여 주고 사용자가 붙여 넣는다(iPhone·iPad 홈 화면 앱).
async function loginUrl(redirect = '') {
  if (!CONFIG.appKey) throw fail('config', 'config.js에 Dropbox App key가 없습니다.');
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  await set('pkce', { verifier, state, redirect });
  const p = new URLSearchParams({ client_id: CONFIG.appKey, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', token_access_type: 'offline' });
  if (redirect) { p.set('redirect_uri', redirect); p.set('state', state); }
  return 'https://www.dropbox.com/oauth2/authorize?' + p;
}
async function finishLogin(code, state = null) {
  const pk = await get('pkce'); if (!pk) throw fail('auth', '로그인을 처음부터 다시 시작해 주세요.');
  if (pk.redirect && state !== pk.state) throw fail('auth', '로그인 확인값이 맞지 않습니다. 다시 시도해 주세요.');
  const body = new URLSearchParams({ code: String(code).trim(), grant_type: 'authorization_code', client_id: CONFIG.appKey, code_verifier: pk.verifier });
  if (pk.redirect) body.set('redirect_uri', pk.redirect);
  const r = await fetch(TOKEN_URL, { method: 'POST', body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.refresh_token) throw fail('auth', '로그인하지 못했습니다: ' + (j.error_description || j.error || r.status));
  await set('token', { refresh: j.refresh_token, access: j.access_token, exp: Date.now() + (j.expires_in - 120) * 1000, account: j.account_id });
  await del('pkce');
}
const loggedIn = async () => Boolean(await get('token'));
let refreshing = null;
async function accessToken(force = false) {
  const t = await get('token'); if (!t) throw fail('auth', 'Dropbox 로그인이 필요합니다.');
  if (!force && t.access && t.exp > Date.now()) return t.access;
  refreshing = refreshing || (async () => {
    const r = await fetch(TOKEN_URL, { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refresh, client_id: CONFIG.appKey }) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 400 || r.status === 401) { await del('token'); throw fail('auth', 'Dropbox 연결이 끊겼습니다. 다시 로그인해 주세요.'); }
    if (!r.ok) throw fail('net', '토큰을 새로 받지 못했습니다(' + r.status + ').');
    const next = { ...t, access: j.access_token, exp: Date.now() + (j.expires_in - 120) * 1000 };
    await set('token', next); return next.access;
  })().finally(() => { refreshing = null; });
  return refreshing;
}

// ---------- API ----------
// Dropbox-API-Arg 머리글은 ASCII만 받으므로 한글 경로는 \uXXXX로 적는다.
const arg = o => JSON.stringify(o).replace(/[\u007f-￿]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
async function call(url, init = {}, retry = 2) {
  let r;
  try { r = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: 'Bearer ' + await accessToken() } }); }
  catch (e) { if (e.code) throw e; throw fail('net', '인터넷에 연결되어 있지 않습니다.'); }
  if (r.status === 401 && retry) { await accessToken(true); return call(url, init, retry - 1); }
  if ((r.status === 429 || r.status >= 500) && retry) {
    await new Promise(ok => setTimeout(ok, Math.min(10, Number(r.headers.get('Retry-After')) || 2) * 1000));
    return call(url, init, retry - 1);
  }
  return r;
}
async function download(path) {
  const r = await call('https://content.dropboxapi.com/2/files/download', { method: 'POST', headers: { 'Dropbox-API-Arg': arg({ path }) } });
  if (r.status === 409) throw fail('not_found', '파일이 없습니다: ' + path);
  if (!r.ok) throw fail('net', '받지 못했습니다(' + r.status + '): ' + path);
  let meta = {}; try { meta = JSON.parse(r.headers.get('Dropbox-API-Result') || '{}'); } catch {}
  return { blob: await r.blob(), rev: meta.rev || null };
}
async function metadata(path) {
  const r = await call('https://api.dropboxapi.com/2/files/get_metadata', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) });
  if (r.status === 409) return null;
  if (!r.ok) throw fail('net', '파일 정보를 읽지 못했습니다(' + r.status + ').');
  return r.json();
}
// rev가 있으면 그 판일 때만 덮어쓴다(그 사이 다른 기기가 썼으면 conflict).
async function upload(path, text, rev = null) {
  const mode = rev ? { '.tag': 'update', update: rev } : { '.tag': 'add' };
  const r = await call('https://content.dropboxapi.com/2/files/upload', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': arg({ path, mode, autorename: false, mute: true, strict_conflict: true }) }, body: new Blob([text]) });
  if (r.status === 409) throw fail('conflict', '다른 기기가 먼저 저장했습니다.');
  if (!r.ok) throw fail('net', '저장하지 못했습니다(' + r.status + ').');
  return r.json();
}
async function logout() {
  try { if (await get('token')) await call('https://api.dropboxapi.com/2/auth/token/revoke', { method: 'POST' }, 0); } catch {}
  await del('token');
}

// ---------- 기기에 저장한 묶음 ----------
// bundle 안 경로 → Cache Storage 열쇠. sw.js·boot.js가 같은 규칙을 쓴다(물음표 뒤는 버린다).
const BUNDLE_CACHE = 'om-bundle';
const shellBase = () => new URL('./', g.registration ? g.registration.scope : document.querySelector('script[src$="dbx.js"]').src).href;
const bundleKey = rel => new URL('app/' + rel, shellBase()).href;
const TYPES = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff', woff2: 'font/woff2' };
const typeOf = rel => TYPES[(rel.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase()] || 'application/octet-stream';
async function cacheFile(rel, cache) {
  cache = cache || await caches.open(BUNDLE_CACHE);
  const { blob } = await download(CONFIG.bundle + '/' + rel);
  await cache.put(bundleKey(rel), new Response(blob, { headers: { 'Content-Type': typeOf(rel) } }));
  return blob.size;
}

g.OMDBX = { CONFIG, get, set, del, loginUrl, finishLogin, loggedIn, download, metadata, upload, logout, BUNDLE_CACHE, shellBase, bundleKey, typeOf, cacheFile };
})(self);
