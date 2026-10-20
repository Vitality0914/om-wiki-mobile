/* Om Wiki Mobile 첫 화면: 홈 화면 추가 안내 → Dropbox 로그인 → 자료 확인·받기 → app/ 열기. ?settings는 설정 화면. */
(() => {
'use strict';
const D = window.OMDBX, $ = id => document.getElementById(id);
const BASE = D.shellBase(), APP = BASE + 'app/';
const params = new URLSearchParams(location.search);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const mb = n => (n / 1048576).toFixed(n >= 104857600 ? 0 : 1) + 'MB';
const when = t => t ? new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const view = html => { $('view').innerHTML = html; };
const showError = msg => { $('error').textContent = msg || ''; $('error').hidden = !msg; };
const MANIFEST = D.CONFIG.bundle + '/manifest.json';

const swReady = 'serviceWorker' in navigator
  ? navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).catch(e => { console.warn(e); return null; })
  : Promise.resolve(null);
navigator.storage?.persist?.().catch(() => {});
let installEvent = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvent = e; const b = $('install-btn'); if (b) b.hidden = false; });

// ---------- 홈 화면 추가 안내 ----------
function installCard() {
  if (standalone) return '';
  const how = ios
    ? '<ol><li>Safari 아래쪽(iPad는 위쪽)의 공유 버튼 <b>□↑</b>을 누릅니다.</li><li><b>홈 화면에 추가</b>를 누릅니다.</li><li>홈 화면의 <b>Om Wiki</b> 아이콘으로 다시 열고, 그 안에서 로그인합니다.</li></ol>'
    : '<ol><li>아래 <b>앱 설치</b>를 누르거나, Chrome 메뉴 <b>⋮</b> → <b>앱 설치</b>(또는 홈 화면에 추가)를 누릅니다.</li><li>홈 화면의 <b>Om Wiki</b> 아이콘으로 엽니다.</li></ol>';
  return `<div class="card"><h2>홈 화면에 앱 추가</h2><p>${ios ? 'iPhone·iPad는 홈 화면 앱과 Safari의 저장 공간이 따로라서, <b>먼저 홈 화면에 추가한 뒤</b> 그 아이콘에서 로그인해야 합니다.' : '아이콘을 누르면 주소창 없이 바로 열립니다.'}</p>${how}<button id="install-btn" class="primary" type="button" ${installEvent ? '' : 'hidden'}>앱 설치</button></div>`;
}
document.addEventListener('click', async e => {
  if (e.target.id === 'install-btn' && installEvent) { installEvent.prompt(); await installEvent.userChoice.catch(() => {}); installEvent = null; e.target.hidden = true; }
});

// ---------- 로그인 ----------
async function loginView(message = '') {
  showError(message);
  const codeUrl = await D.loginUrl('');            // 코드 붙여 넣기 방식(새 창이 막히지 않도록 미리 만든다)
  const codeFirst = ios && standalone;
  const redirectBtn = '<button id="login-redirect" type="button" class="' + (codeFirst ? '' : 'primary') + '">Dropbox로 로그인</button>';
  const codeBtn = `<a id="login-code" class="btn${codeFirst ? ' primary' : ''}" href="${esc(codeUrl)}" target="_blank" rel="noopener">${codeFirst ? 'Dropbox로 로그인' : '코드로 로그인'}</a>`;
  view(installCard() + `<div class="card"><h2>Dropbox 연결</h2><p>내 Dropbox의 「Apps/Om Wiki Mobile」 폴더만 읽고 씁니다. 비밀번호는 Dropbox 화면에만 입력합니다.</p>
    ${codeFirst ? codeBtn + redirectBtn : redirectBtn + codeBtn}
    <div id="code-box" ${codeFirst ? '' : 'hidden'}><p class="small" style="margin-top:12px">Dropbox에서 「허용」을 누르면 나오는 코드를 복사해 아래에 붙여 넣으세요.</p>
    <div class="row"><input id="code-input" inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="인증 코드"><button id="code-ok" type="button" class="primary" style="flex:0 0 84px;margin:0">확인</button></div></div></div>`);
  $('login-redirect').onclick = async () => { try { location.href = await D.loginUrl(BASE); } catch (e) { showError(e.message); } };
  $('login-code').addEventListener('click', () => { $('code-box').hidden = false; setTimeout(() => $('code-input').focus(), 300); });
  $('code-ok').onclick = async () => {
    const code = $('code-input').value.trim(); if (!code) return;
    $('code-ok').disabled = true;
    try { await D.finishLogin(code); showError(''); await syncAndGo(); }
    catch (e) { showError(e.message); $('code-ok').disabled = false; }
  };
}

// ---------- 자료 확인·받기 ----------
async function coreReady() {
  const m = await D.get('manifest'); if (!m) return false;
  const cache = await caches.open(D.BUNDLE_CACHE);
  for (const rel of m.core) if (!(await cache.match(D.bundleKey(rel)))) return false;
  return true;
}
async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); })); }
// Dropbox의 manifest가 바뀌었으면 바뀐 파일만 기기에서 지우고, 기본 자료(이미지 제외)를 채운다.
async function update(progress) {
  const cache = await caches.open(D.BUNDLE_CACHE);
  let manifest = await D.get('manifest');
  const meta = await D.metadata(MANIFEST);
  if (!meta) throw Object.assign(new Error('Dropbox에 휴대폰용 자료가 아직 없습니다. PC에서 build-mobile.js를 실행해 주세요.'), { code: 'empty' });
  if (!manifest || meta.rev !== await D.get('manifestRev')) {
    const next = JSON.parse(await (await D.download(MANIFEST)).blob.text());
    if (manifest) for (const [rel, info] of Object.entries(manifest.files)) { const n = next.files[rel]; if (!n || n[1] !== info[1]) await cache.delete(D.bundleKey(rel)); }
    manifest = next; await D.set('manifest', next); await D.set('manifestRev', meta.rev);
  }
  const need = [];
  for (const rel of manifest.core) if (!(await cache.match(D.bundleKey(rel)))) need.push(rel);
  const total = need.reduce((s, r) => s + (manifest.files[r]?.[0] || 0), 0);
  let done = 0, bytes = 0;
  if (need.length) progress(0, need.length, 0, total);
  await pool(need, 4, async rel => { bytes += await D.cacheFile(rel, cache); progress(++done, need.length, bytes, total); });
  await D.set('lastSync', Date.now());
  return need.length;
}
function progressView(title) {
  view(`<div class="card"><h2>${esc(title)}</h2><div class="bar"><i id="bar"></i></div><p id="progress" class="small">Dropbox를 확인하고 있습니다…</p></div>`);
  return (done, count, bytes, total) => {
    $('bar').style.width = (total ? Math.round(bytes / total * 100) : 0) + '%';
    $('progress').textContent = `${done} / ${count}개 · ${mb(bytes)} / ${mb(total)}` + (done < count ? ' · 처음 한 번만 오래 걸립니다' : '');
  };
}
async function go() { await swReady; location.replace(APP); }
async function syncAndGo() {
  showError('');
  const ready = await coreReady();
  if (ready && !navigator.onLine) return go();
  const progress = progressView(ready ? '새 자료 확인' : 'Wiki 자료 받기');
  // 이미 받아 둔 자료가 있으면 확인이 늦어도(3초) 기다리지 않고 연다.
  const work = update(progress);
  try {
    if (ready) { const r = await Promise.race([work, new Promise(ok => setTimeout(() => ok('slow'), 3000))]); if (r === 'slow') work.catch(() => {}); }
    else await work;
    return go();
  } catch (e) {
    if (e.code === 'auth') return loginView(e.message);
    if (await coreReady()) return go();
    showError(e.message);
    view(`<div class="card"><h2>자료를 받지 못했습니다</h2><p>${e.code === 'empty' ? 'PC에서 자료를 만든 뒤 다시 시도해 주세요.' : e.code === 'net' && !navigator.onLine ? '인터넷 연결을 확인한 뒤 다시 시도해 주세요.' : '아래 오류를 확인한 뒤 다시 시도해 주세요.'}</p><button id="retry" class="primary" type="button">다시 시도</button></div>`);
    $('retry').onclick = syncAndGo;
  }
}

// ---------- 설정 ----------
async function settingsView() {
  const m = await D.get('manifest'), cache = await caches.open(D.BUNDLE_CACHE);
  const media = m ? Object.keys(m.files).filter(r => r.startsWith('media/')) : [];
  const cachedKeys = new Set((await cache.keys()).map(r => r.url));
  const haveMedia = media.filter(r => cachedKeys.has(D.bundleKey(r))).length;
  const mediaBytes = media.filter(r => !cachedKeys.has(D.bundleKey(r))).reduce((s, r) => s + m.files[r][0], 0);
  const est = await navigator.storage?.estimate?.().catch(() => null);
  view(installCard() + `<div class="card"><h2>설정</h2><dl>
    <dt>자료 생성</dt><dd>${esc(m?.built ? when(m.built) : '—')}</dd>
    <dt>마지막 확인</dt><dd>${esc(when(await D.get('lastSync')))}</dd>
    <dt>받아 둔 이미지</dt><dd>${haveMedia.toLocaleString('ko-KR')} / ${media.length.toLocaleString('ko-KR')}</dd>
    <dt>기기 사용량</dt><dd>${est ? mb(est.usage || 0) : '—'}</dd></dl>
    <button id="open" class="primary" type="button">Wiki 열기</button>
    <button id="check" type="button">새 자료 확인</button>
    <button id="media" type="button" ${media.length - haveMedia ? '' : 'disabled'}>이미지 모두 받기 (${(media.length - haveMedia).toLocaleString('ko-KR')}장 · ${mb(mediaBytes)})</button>
    <div id="media-progress" hidden><div class="bar"><i id="mbar"></i></div><p id="mtext" class="small"></p></div></div>
    <div class="card"><h2>기기 정리</h2><p>문서 메모는 Dropbox에 저장되어 있어 지워지지 않습니다.</p>
    <button id="clear" type="button">받아 둔 자료 지우기</button><button id="logout" type="button">Dropbox 연결 끊기</button></div>`);
  $('open').onclick = go;
  $('check').onclick = syncAndGo;
  $('media').onclick = async () => {
    const todo = media.filter(r => !cachedKeys.has(D.bundleKey(r)));
    $('media').disabled = true; $('media-progress').hidden = false;
    let done = 0, bytes = 0;
    try {
      await pool(todo, 6, async rel => { bytes += await D.cacheFile(rel, cache); done++; $('mbar').style.width = Math.round(bytes / mediaBytes * 100) + '%'; $('mtext').textContent = `${done} / ${todo.length}장 · ${mb(bytes)} / ${mb(mediaBytes)}`; });
      $('mtext').textContent = '모두 받았습니다.';
    } catch (e) { showError(e.message); $('media').disabled = false; }
  };
  $('clear').onclick = async () => {
    if (!confirm('기기에 받아 둔 Wiki 자료와 이미지를 지울까요? 다음에 열 때 다시 받습니다.')) return;
    await caches.delete(D.BUNDLE_CACHE); await D.del('manifest'); await D.del('manifestRev'); settingsView();
  };
  $('logout').onclick = async () => {
    if (!confirm('이 기기의 Dropbox 연결을 끊고 받아 둔 자료를 지울까요?')) return;
    await D.logout(); await caches.delete(D.BUNDLE_CACHE); await D.del('manifest'); await D.del('manifestRev'); location.replace(BASE);
  };
}

async function main() {
  if (!D.CONFIG.appKey) return view('<div class="card"><h2>설정이 필요합니다</h2><p>config.js에 Dropbox App key를 넣어 주세요.</p></div>');
  if (params.get('error')) { showError('Dropbox 로그인을 취소했거나 허용하지 않았습니다.'); history.replaceState(null, '', BASE); }
  const code = params.get('code');
  if (code) {
    try { await D.finishLogin(code, params.get('state')); } catch (e) { showError(e.message); }
    history.replaceState(null, '', BASE);
  }
  if (!(await D.loggedIn())) return loginView();
  if (params.has('settings')) return settingsView();
  await syncAndGo();
}
main().catch(e => showError(e.message || String(e)));
})();
