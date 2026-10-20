/* Om Wiki Mobile service worker.
   - 겉 화면(이 저장소 파일)은 기기에 저장해 두고 뒤에서 새로 받는다(오프라인에서도 열림).
   - app/ 아래 요청은 Dropbox 앱 폴더의 bundle/에서 받아 기기에 저장해 두고, 그 뒤로는 기기에서 바로 준다. */
importScripts('config.js', 'dbx.js');
const VERSION = 'shell-2026-10-20-1';
const SHELL = 'om-shell-' + VERSION;
const BASE = OMDBX.shellBase(), APP = BASE + 'app/';
const SHELL_FILES = ['./', 'config.js', 'dbx.js', 'boot.js', 'bridge.js', 'mobile.css', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('om-shell-') && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

const relOf = url => { let rel = decodeURIComponent(url.pathname.slice(new URL(APP).pathname.length)); if (!rel || rel.endsWith('/')) rel += 'index.html'; return rel; };
const inflight = new Map();
async function fromBundle(request) {
  const rel = relOf(new URL(request.url)), key = OMDBX.bundleKey(rel);
  const cache = await caches.open(OMDBX.BUNDLE_CACHE);
  const hit = await cache.match(key); if (hit) return hit;
  if (!inflight.has(key)) inflight.set(key, OMDBX.cacheFile(rel, cache).finally(() => inflight.delete(key)));
  try { await inflight.get(key); return (await cache.match(key)) || new Response('', { status: 503 }); }
  catch (e) {
    if (request.mode === 'navigate') return Response.redirect(BASE + (e.code === 'auth' ? '?login' : ''), 302);
    return new Response(e.message, { status: e.code === 'not_found' ? 404 : 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}
// 겉 화면: 저장본을 먼저 주고 뒤에서 새로 받는다. 저장본이 없으면 네트워크. ?login·?settings도 같은 index를 쓴다.
async function fromShell(event) {
  const cache = await caches.open(SHELL), url = new URL(event.request.url);
  const key = url.origin + url.pathname;
  const hit = await cache.match(key);
  const fresh = fetch(event.request).then(r => { if (r.ok && r.type === 'basic') cache.put(key, r.clone()); return r; });
  if (hit) { event.waitUntil(fresh.catch(() => {})); return hit; }
  return fresh;
}
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(BASE)) return;
  event.respondWith(url.href.startsWith(APP) ? fromBundle(event.request) : fromShell(event));
});
