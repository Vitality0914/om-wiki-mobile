/* Om Wiki Mobile · Wiki 화면(app/index.html) 안에서 돌아간다. 원본 화면 코드보다 먼저 읽힌다.
   1) 휴대폰 판은 KAMC 지침·Om Wiki만 연다(다른 화면으로 가는 저장값·링크를 막는다).
   2) window.OM_DATA_FILES를 Dropbox판으로 바꿔 문서 메모를 PC와 같은 「HTML 작업공간/@ 메모 데이터/문서 메모/문서 메모.json」과 맞춘다.
      PC의 om-data-files.js와 같은 규칙: 같은 문서는 updated가 늦은 쪽을 남긴다. 메모는 먼저 이 기기에 저장된다. */
(() => {
'use strict';
const D = window.OMDBX, MEMO = D.CONFIG.memo, BASE = D.shellBase();
document.documentElement.classList.add('om-mobile');

// ---------- 1) 화면 제한 ----------
// 화면 번호는 원본에서 바뀔 수 있으므로(Textbook 추가 등) 번호 대신 버튼으로 확인한다: 열린 화면이 KAMC·Om Wiki가 아니면 Om Wiki로.
const ALLOWED = ['wiki-slide', 'learning-slide'];
if (/^#(?:concept|game)=/.test(location.hash)) history.replaceState(null, '', location.pathname);

function toast(text) {
  let el = document.getElementById('om-toast');
  if (!el) { el = document.createElement('div'); el.id = 'om-toast'; el.setAttribute('role', 'status'); document.body.append(el); }
  el.textContent = text; el.classList.add('on'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('on'), 2600);
}

// ---------- 2) 문서 메모 ↔ Dropbox ----------
let state = 'idle', message = '', timer = 0, running = null, dirty = false, lastRun = 0;
const listeners = new Set();
const status = () => ({ state, message, connected: state === 'connected' || state === 'syncing' });
const notify = () => { for (const fn of listeners) { try { fn(status()); } catch (e) { console.error(e); } } };
const setState = (s, m = '') => { state = s; message = m; notify(); };
const keyOf = n => (n.updated || '') + '\u0000' + n.text;

async function syncNotes() {
  if (running) { dirty = true; return running; }
  running = (async () => {
    const api = window.OM_WIKI_NOTES; if (!api) return;
    if (!(await D.loggedIn())) { setState('need-permission', 'Dropbox 로그인이 필요합니다. 눌러서 로그인하세요.'); return; }
    if (!navigator.onLine) { setState('offline', '오프라인입니다. 메모는 이 기기에 저장되고, 연결되면 Dropbox에 맞춥니다.'); dirty = true; return; }
    setState('syncing', 'Dropbox와 맞추는 중…');
    for (let attempt = 0; attempt < 4; attempt++) {
      dirty = false;
      let remote = [], rev = null;
      try {
        const f = await D.download(MEMO);
        rev = f.rev || (await D.metadata(MEMO))?.rev || null;
        const j = JSON.parse(await f.blob.text());
        if (j?.format === 'om-medical-notes' && Array.isArray(j.notes)) remote = j.notes;
      } catch (e) { if (e.code !== 'not_found') throw e; }
      api.merge(remote);
      // 파일 쪽 항목은 그대로 두고, 이 기기에서 더 늦게 고친 메모만 덮는다.
      const out = new Map(remote.filter(n => n && typeof n.key === 'string').map(n => [n.key, n]));
      let changed = false;
      for (const n of api.all()) { const r = out.get(n.key); if (!r || String(n.updated || '') > String(r.updated || '') || (!r.updated && keyOf(n) !== keyOf(r))) { out.set(n.key, n); changed = true; } }
      if (!changed) break;
      const notes = [...out.values()].sort((a, b) => a.key.localeCompare(b.key));
      try { await D.upload(MEMO, JSON.stringify({ format: 'om-medical-notes', version: 1, savedAt: new Date().toISOString(), notes }, null, 2) + '\n', rev); break; }
      catch (e) { if (e.code !== 'conflict' || attempt === 3) throw e; }
    }
    lastRun = Date.now();
    setState('connected', '메모를 Dropbox에 저장하고 PC와 맞춥니다.');
  })().catch(e => {
    if (e.code === 'auth') setState('need-permission', e.message);
    else if (e.code === 'net' && !navigator.onLine) { dirty = true; setState('offline', '오프라인입니다. 연결되면 Dropbox에 맞춥니다.'); }
    else { dirty = true; setState('error', '동기화 실패: ' + e.message); }
  }).finally(() => { running = null; if (dirty && navigator.onLine && state !== 'need-permission') { clearTimeout(timer); timer = setTimeout(syncNotes, 4000); } });
  return running;
}

// om-wiki-view.js·om-test.js가 쓰는 자리(PC판 om-data-files.js와 같은 모양). om-data-files.js는 이것을 보고 스스로 멈춘다.
window.OM_DATA_FILES = {
  DIRS: {}, status, supported: () => true,
  async connect(interactive = true) {
    if (!(await D.loggedIn())) { if (interactive) location.href = BASE + '?login'; return null; }
    await syncNotes(); return true;
  },
  writeJson: async () => false, readJson: async () => null, list: async () => [], remove: async () => false,
  subscribe(fn) { listeners.add(fn); fn(status()); return () => listeners.delete(fn); },
  onSync() {},
  label: () => state === 'syncing' ? '동기화 중…' : state === 'offline' ? '오프라인' : state === 'error' ? '다시 동기화' : state === 'need-permission' ? 'Dropbox 로그인' : 'Dropbox 동기화',
  title: () => message || '메모를 Dropbox에 저장하고 PC와 맞춥니다.',
  person: () => '',
  notesChanged() { dirty = true; clearTimeout(timer); timer = setTimeout(syncNotes, 1500); },
};

addEventListener('online', () => syncNotes());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - lastRun > 30000) syncNotes();
  else if (document.visibilityState === 'hidden' && dirty) syncNotes();
});

// ---------- 원본 화면 코드가 다 읽힌 뒤 ----------
document.addEventListener('DOMContentLoaded', () => {
  const current = document.querySelector('#med-nav [aria-pressed="true"]');
  if (!current || !ALLOWED.includes(current.id)) document.getElementById('wiki-slide')?.click();
  const nav = window.MEDICAL_NAV;
  if (nav) {
    const off = name => () => toast('휴대폰 판에는 ' + name + ' 화면이 없습니다.');
    nav.openConcept = off('개념'); nav.openGame = off('etc.');
  }
  // 머리줄: 설정(⚙) 버튼
  const bar = document.querySelector('.appbar-actions');
  if (bar && !document.getElementById('om-settings')) {
    const a = document.createElement('a'); a.id = 'om-settings'; a.href = BASE + '?settings'; a.textContent = '⚙'; a.title = '설정 · 자료 업데이트 · 이미지 받기'; a.setAttribute('aria-label', '설정');
    bar.append(a);
  }
  // 좁은 화면에서는 목록 아래에 본문이 있으므로, 목록에서 문서를 고르면 본문으로 내려간다.
  document.addEventListener('click', e => {
    const list = e.target.closest('nav[id$="-list"]');
    if (!list || !e.target.closest('button,a,[role="option"],li') || innerWidth > 700) return;
    const article = list.parentElement?.querySelector('article');
    if (article) setTimeout(() => { if (!article.hidden) article.scrollIntoView({ block: 'start' }); }, 80);
  }, true);   // 목록이 다시 그려지기 전에 잡는다
  syncNotes();
});
})();
