'use strict';
/* ארבע מילים v2 — SRS, cloud sync (Firebase), library, goals. */
const SHEET_CSV = 'https://docs.google.com/spreadsheets/d/1YuNV-TcC_tITIe-SGTzTh-dKTlx4H84-4feTzAM2k4M/export?format=csv&gid=0';
const K = { vocab: 'fw.vocab.v2', progress: 'fw.progress.v2', settings: 'fw.settings.v2', stats: 'fw.stats.v2', bands: 'fw.bands.v1' };
const INTERVALS = [1, 3, 7, 14, 30]; // days, mirrors the iOS app
const DAY = 86400000;
const $ = id => document.getElementById(id);
const readJSON = (key, fb) => { try { return JSON.parse(localStorage.getItem(key)) || fb; } catch { return fb; } };
const save = (key, val) => localStorage.setItem(key, JSON.stringify(val));

let vocab = [];
let settings = Object.assign({ length: 20, mode: 'choice', goal: 20 }, readJSON(K.settings, {}));
let progress = readJSON(K.progress, {});           // word -> {r,w,s,next}
let stats = readJSON(K.stats, { days: {}, attempts: 0, correct: 0 });
/* Bands: practice runs inside one 100-word band by rank. At least 7 correct out
   of the band's 10 most recent answers advances to the next hundred; words that
   never appeared stay untouched (no progress record is created for them). */
const BAND_SIZE = 100;
const BAND_MIN_ANSWERS = 10;   // answers needed in the window before evaluating
const BAND_WINDOW = 10;        // rolling window of recent in-band answers
const BAND_ADVANCE = 0.7;      // at least 70% (7 of 10) advances
let bands = Object.assign({ current: 1, recent: [] }, readJSON(K.bands, {}));
let rankOf = new Map();        // word -> rank, built when vocab loads
let session = { queue: [], index: 0, correct: 0, wrong: 0, active: false };
let dirty = readJSON('fw.pending', true);
let localRevision = readJSON('fw.revision', 0);
let activeUID = readJSON('fw.activeUID', null);                                  // local changes not yet pushed

/* ---------- Vocabulary ---------- */
async function loadVocab() {
  const cached = readJSON(K.vocab, null);
  if (Array.isArray(cached) && cached.length > 1000) { vocab = cached; onVocabReady(); }
  try {
    const res = await fetch('vocab.json', { cache: 'no-store' });
    if (res.ok) {
      const fresh = await res.json();
      if (fresh.length > 1000) { vocab = fresh.map(x => ({ r: x.r, w: x.w, t: x.t })); save(K.vocab, vocab); onVocabReady(); return; }
    }
    throw new Error('snapshot missing');
  } catch {
    try { // last resort: live sheet
      const res = await fetch(SHEET_CSV);
      const rows = parseCSV(await res.text());
      const seen = new Set(); const fresh = [];
      rows.slice(1).forEach(r => {
        const w = (r[2] || '').trim(), t = (r[8] || '').trim(), rank = parseInt((r[0] || '').replace(/,/g, ''), 10);
        if (w && t && rank && !seen.has(w.toLowerCase())) { seen.add(w.toLowerCase()); fresh.push({ r: rank, w, t }); }
      });
      fresh.sort((a, b) => a.r - b.r);
      if (fresh.length > 1000) { vocab = fresh; save(K.vocab, vocab); onVocabReady(); return; }
    } catch {}
    if (!vocab.length) $('sourceNote').textContent = 'מצב אופליין — לא ניתן לטעון את אוצר המילים';
  }
}
function parseCSV(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c; }
    else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  return rows;
}
function onVocabReady() {
  rankOf = new Map(vocab.map(v => [v.w, v.r]));
  $('vocabCount').textContent = vocab.length.toLocaleString('he-IL');
  renderBandSelect();
  refreshHome(); renderLibrary();
}

/* ---------- Bands ---------- */
const maxBand = () => Math.max(1, Math.ceil(vocab.length / BAND_SIZE));
const bandLo = b => (b - 1) * BAND_SIZE + 1;
const bandHi = b => (vocab.length ? Math.min(b * BAND_SIZE, vocab.length) : b * BAND_SIZE);
const inCurrentBand = v => v.r >= bandLo(bands.current) && v.r <= bands.current * BAND_SIZE;
const bandLabel = () => `רמה ${bands.current} · מילים ${bandLo(bands.current).toLocaleString('he-IL')}–${bandHi(bands.current).toLocaleString('he-IL')}`;
function recordBandAnswer(ok, rank) {
  const thousand = Math.floor((bands.current - 1) / 10);
  if (!(rank > thousand * 1000 && rank <= (thousand + 1) * 1000)) return;
  bands.thousandRecent = [...(bands.thousandRecent || []), ok ? 1 : 0].slice(-100);
  const nextThousand = (thousand + 1) * 10 + 1;
  const thousandCorrect = bands.thousandRecent.reduce((s, x) => s + x, 0);
  if (bands.thousandRecent.length === 100 && thousandCorrect >= 70 && nextThousand <= maxBand()) {
    bands.current = nextThousand; bands.recent = []; bands.thousandRecent = [];
    $('quizBandLabel').textContent = bandLabel();
    showToast('🎉 70 מתוך 100! עוברים לאלף הבא');
    return;
  }
  if (!(rank >= bandLo(bands.current) && rank <= bands.current * BAND_SIZE)) return;
  bands.recent = [...bands.recent, ok ? 1 : 0].slice(-BAND_WINDOW);
  if (bands.current < maxBand() && bands.recent.length >= BAND_MIN_ANSWERS && bands.recent.reduce((s, x) => s + x, 0) / bands.recent.length >= BAND_ADVANCE) {
    bands.current++;
    bands.recent = [];
    if (Math.floor((bands.current - 1) / 10) !== thousand) bands.thousandRecent = [];
    $('quizBandLabel').textContent = bandLabel();
    showToast(`🎉 עוברים לרמה ${bands.current}`);
  }
}
function bandAccuracyNote() {
  const n = bands.recent.length;
  if (!n) return '7 מתוך 10 מעבירים מאה · 70 מתוך 100 תשובות רגילות באלף מעבירים לאלף הבא';
  const c = bands.recent.reduce((s, x) => s + x, 0);
  return `דיוק במאה זו: ${Math.round(c / n * 100)}% (${c}/${n} אחרונות) · 7 מתוך 10 עוברים מאה · באלף: ${(bands.thousandRecent || []).reduce((s, x) => s + x, 0)}/${(bands.thousandRecent || []).length} (70/100 למעבר)`;
}
function setBand(b) {
  const oldThousand = Math.floor((bands.current - 1) / 10);
  bands.current = Math.min(Math.max(1, b), maxBand());
  if (Math.floor((bands.current - 1) / 10) !== oldThousand) bands.thousandRecent = [];
  bands.recent = [];
  persist(); refreshHome();
}

/* ---------- SRS ---------- */
const rec = w => progress[w] || { r: 0, w: 0, s: 0, next: 0 };
function markWord(word, ok) {
  const p = rec(word); const now = Date.now();
  if (ok) { p.r++; p.s++; p.next = now + INTERVALS[Math.min(p.s - 1, INTERVALS.length - 1)] * DAY; }
  else { p.w++; p.s = 0; p.next = now; }
  progress[word] = p;
  const r = rankOf.get(word);
  if (r) recordBandAnswer(ok, r);
}
function priorityOf(w) {
  const p = progress[w];
  if (p && (p.r + p.w) > 0 && p.s === 0) return 0; // failed before
  if (!p || (p.r + p.w) === 0) return 1;           // new
  return 2;
}
function buildQueue() {
  const now = Date.now();
  const attempted = v => { const p = progress[v.w]; return p && (p.r + p.w) > 0; };
  // Current band plus due reviews of words already attempted anywhere;
  // words outside the band that were never attempted are not introduced.
  const due = vocab.filter(v => (progress[v.w] ? progress[v.w].next : 0) <= now && (inCurrentBand(v) || attempted(v)));
  due.sort((a, b) => priorityOf(a.w) - priorityOf(b.w) ||
    ((rec(a.w).r + rec(a.w).w) - (rec(b.w).r + rec(b.w).w)) || a.r - b.r);
  const want = settings.length === 'all' ? due.length : settings.length;
  let picked = due.slice(0, Math.max(want, Math.min(10, due.length)));
  if (picked.length < want && settings.length !== 'all') {
    const ids = new Set(picked.map(v => v.w));
    picked = picked.concat(vocab.filter(v => inCurrentBand(v) && !ids.has(v.w)).slice(0, want - picked.length));
  }
  return shuffle(picked);
}
const shuffle = arr => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/* ---------- Stats / goals ---------- */
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function markAnswer(ok) {
  const k = todayKey();
  stats.days[k] = stats.days[k] || { a: 0, c: 0 };
  stats.days[k].a++; stats.attempts++;
  if (ok) { stats.days[k].c++; stats.correct++; }
}
function dayStreak() {
  let n = 0; const d = new Date();
  if (!stats.days[todayKey()]) d.setDate(d.getDate() - 1);
  for (;;) {
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (stats.days[k] && stats.days[k].a > 0) { n++; d.setDate(d.getDate() - 1); } else break;
  }
  return n;
}
const learnedCount = () => Object.values(progress).filter(p => p.s >= 2).length;
const dueCount = () => { const now = Date.now(); return vocab.filter(v => progress[v.w] && progress[v.w].next <= now && (progress[v.w].r + progress[v.w].w) > 0).length; };
const pct = (a, b) => b ? `${Math.round(a / b * 100)}%` : '—';

/* ---------- Persistence + sync ---------- */
function persist() {
  save(K.progress, progress); save(K.settings, settings); save(K.stats, stats); save(K.bands, bands);
  dirty = true; localRevision++; save('fw.pending', true); save('fw.revision', localRevision); saveAccountState(); schedulePush();
}
/* Firebase */
let fb = { ready: false, user: null, db: null, pushing: false, timer: null, applying: false };
function saveAccountState() {
  save('fw.account.' + (activeUID || 'guest'), { progress, settings, stats, bands, dirty, localRevision });
}
function selectSyncAccount(uid) {
  if (activeUID === uid) return;
  saveAccountState();
  // First sign-in adopts guest work. Switching between known accounts never does.
  const stored = readJSON('fw.account.' + (uid || 'guest'), null);
  if (stored || activeUID !== null || uid === null) {
    progress = stored?.progress || {};
    settings = stored?.settings || { length: 20, mode: 'choice', goal: 20 };
    stats = stored?.stats || { days: {}, attempts: 0, correct: 0 };
    bands = stored?.bands || { current: 1, recent: [] };
    dirty = stored?.dirty || false; localRevision = stored?.localRevision || 0;
  }
  activeUID = uid; save('fw.activeUID', uid);
  save(K.progress, progress); save(K.settings, settings); save(K.stats, stats); save(K.bands, bands);
  save('fw.pending', dirty); save('fw.revision', localRevision);
  session.active = false;
  $('quizCard').classList.add('hidden'); $('summary').classList.add('hidden'); $('practiceHome').classList.remove('hidden');
  applySettingsToUI(); refreshHome(); renderLibrary();
}
function initFirebase() {
  if (fb.initialized || !window.firebase || !window.FIREBASE_CONFIG) return;
  fb.initialized = true;
  try {
    if (!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);
    fb.db = firebase.firestore();
    // App queue remains durable even when IndexedDB persistence is unavailable.
    fb.db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
    firebase.auth().onAuthStateChanged(user => {
      fb.unsubscribe?.(); fb.generation = (fb.generation || 0) + 1;
      selectSyncAccount(user?.uid || null);
      fb.user = user; fb.ready = !!user;
      setAuthUI(user);
      if (user) {
        setSync(navigator.onLine ? 'מסנכן…' : 'אופליין · השינויים שמורים במכשיר');
        const uid = user.uid;
        fb.unsubscribe = fb.db.collection('users').doc(uid).onSnapshot({ includeMetadataChanges: true }, snap => {
          if (fb.user?.uid !== uid) return;
          if (snap.exists && !snap.metadata.hasPendingWrites) mergeRemote(snap.data());
          if (!snap.metadata.fromCache && dirty) schedulePush(0);
        }, () => { setSync('השינויים שמורים · ממתינים לחיבור'); schedulePush(5000); });
        schedulePush(0);
      } else setSync('מצב מקומי · השינויים שמורים במכשיר');
    });
  } catch { fb.initialized = false; setSync('מצב מקומי · ניסיון סנכרון כשיחזור החיבור'); }
}
function setSync(text) { $('syncStatus').textContent = text; }
function setAuthUI(user) {
  const btn = $('authBtn');
  if (user) { btn.textContent = user.displayName ? `מחובר: ${user.displayName}` : 'מחובר'; btn.classList.add('signed'); }
  else { btn.textContent = 'כניסה עם Google'; btn.classList.remove('signed'); }
}
function mergeRemote(data) {
  if (!data || !data.fw) return;
  fb.applying = true;
  const rp = data.fw.progress || {}, rs = data.fw.settings || {}, rt = data.fw.stats || {}, rb = data.fw.bands || {};
  if (typeof rb.current === 'number') {
    if (Math.floor((rb.current - 1) / 10) === Math.floor((bands.current - 1) / 10) && (rb.thousandRecent || []).length > (bands.thousandRecent || []).length) bands.thousandRecent = rb.thousandRecent.slice(-100);
    if (rb.current > bands.current) {
      const retainedThousand = Math.floor((rb.current - 1) / 10) === Math.floor((bands.current - 1) / 10) ? (bands.thousandRecent || []) : [];
      bands = { ...rb, current: rb.current, recent: Array.isArray(rb.recent) ? rb.recent.slice(-BAND_WINDOW) : [], thousandRecent: Array.isArray(rb.thousandRecent) ? rb.thousandRecent.slice(-100) : [] };
      if (retainedThousand.length > bands.thousandRecent.length) bands.thousandRecent = retainedThousand;
    }
    else if (rb.current === bands.current && Array.isArray(rb.recent) && rb.recent.length > bands.recent.length) bands.recent = rb.recent.slice(-BAND_WINDOW);
  }
  Object.keys(rp).forEach(w => {
    const l = progress[w], r = rp[w];
    if (!l || (r.r + r.w) > (l.r + l.w) || ((r.r + r.w) === (l.r + l.w) && (r.next || 0) > (l.next || 0))) progress[w] = r;
  });
  if ((rt.attempts || 0) > stats.attempts) stats = Object.assign({ days: {}, attempts: 0, correct: 0 }, rt);
  Object.keys(rt.days || {}).forEach(d => {
    const l = stats.days[d] || { a: 0, c: 0 }, r = rt.days[d];
    stats.days[d] = { a: Math.max(l.a, r.a || 0), c: Math.max(l.c, r.c || 0) };
  });
  if (!dirty && (data.fwUpdatedAt || 0) > (readJSON('fw.settingsTs', 0)) && rs.length !== undefined) {
    settings = Object.assign({ length: 20, mode: 'choice', goal: 20 }, rs);
    applySettingsToUI();
  }
  fb.applying = false;
  save(K.progress, progress); save(K.settings, settings); save(K.stats, stats); save(K.bands, bands); saveAccountState();
  refreshHome(); renderLibrary();
}
function schedulePush(delay = 2000) {
  if (!fb.ready || fb.applying) return;
  clearTimeout(fb.timer);
  fb.timer = setTimeout(pushNow, delay);
}
async function pushNow() {
  if (!fb.ready || fb.pushing || !dirty || !navigator.onLine) return;
  const uid = fb.user.uid, generation = fb.generation;
  fb.pushing = true;
  try {
    // Read a fresh server copy before writing the local union on reconnect.
    const reference = fb.db.collection('users').doc(uid);
    const remote = await reference.get({ source: 'server' });
    if (fb.user?.uid !== uid || fb.generation !== generation) return;
    if (remote.exists) mergeRemote(remote.data());
    const sentRevision = localRevision;
    const payload = JSON.parse(JSON.stringify({ fw: { progress, settings, stats, bands }, fwUpdatedAt: Date.now(), email: fb.user.email || null }));
    await reference.set(payload, { merge: true });
    if (fb.user?.uid !== uid || fb.generation !== generation) return;
    if (sentRevision === localRevision) { dirty = false; save('fw.pending', false); saveAccountState(); }
    save('fw.settingsTs', payload.fwUpdatedAt);
    setSync(dirty ? 'השינויים שמורים · ממשיכים לסנכרן' : 'מסונכרן ✓');
  } catch { setSync('השינויים שמורים · ממתינים לחיבור'); }
  finally {
    fb.pushing = false;
    if (dirty && fb.ready) schedulePush(5000);
  }
}
window.addEventListener('online', () => { initFirebase(); schedulePush(0); updateOfflineStatus(); });
window.addEventListener('offline', () => { setSync('אופליין · השינויים שמורים במכשיר'); updateOfflineStatus(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { initFirebase(); schedulePush(0); } });

async function updateOfflineStatus() {
  const label = $('offlineStatus');
  if (!label) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const cache = await caches.open('four-words-offline-v4');
    const required = ['index.html', 'app.js', 'vocab.json', 'styles.css', 'firebase-config.js', ...['app','auth','firestore'].map(name => 'https://www.gstatic.com/firebasejs/10.14.1/firebase-' + name + '-compat.js')];
    const prepared = registration?.active && (await Promise.all(required.map(url => cache.match(url)))).every(Boolean);
    if (prepared) label.textContent = 'מוכן לתרגול אופליין במכשיר זה · לפתיחה השתמשו באותה כתובת';
    else label.textContent = 'מכינים שימוש אופליין… השאירו פתוח עם אינטרנט עד שמופיע אישור';
  } catch { label.textContent = 'שמירה אופליין לא זמינה בדפדפן זה'; }
}
/* ---------- Quiz ---------- */
function startSession() {
  if (!vocab.length) return;
  session = { queue: buildQueue(), index: 0, correct: 0, wrong: 0, active: true };
  $('practiceHome').classList.add('hidden'); $('summary').classList.add('hidden'); $('quizCard').classList.remove('hidden');
  $('sessionLabel').textContent = settings.length === 'all' ? 'כל הדחופות' : `${session.queue.length} מילים`;
  $('quizBandLabel').textContent = bandLabel();
  showQuestion();
}
function showQuestion() {
  const item = session.queue[session.index];
  if (!item) return finishSession();
  $('progressText').textContent = `מילה ${session.index + 1} מתוך ${session.queue.length}`;
  $('progressBar').style.width = `${(session.index / session.queue.length) * 100}%`;
  $('serial').textContent = `#${item.r.toLocaleString('he-IL')}`;
  $('hint').textContent = ''; $('hint').className = 'hint';
  $('nextBtn').classList.add('hidden'); $('dontKnowBtn').classList.remove('hidden');
  const mode = settings.mode;
  const answers = $('answers'); answers.replaceChildren();
  if (mode === 'reverse') {
    $('promptLabel').textContent = 'מה המילה באנגלית עבור';
    $('word').textContent = item.t; $('word').setAttribute('lang', 'he');
    $('typingBox').classList.add('hidden');
    const distractors = shuffle(vocab.filter(v => v.w !== item.w)).slice(0, 3).map(v => v.w);
    shuffle([item.w, ...distractors]).forEach(text => {
      const b = document.createElement('button');
      b.className = 'answer'; b.textContent = text; b.dir = 'ltr';
      b.addEventListener('click', () => answerChoice(text === item.w, b, item.w));
      answers.append(b);
    });
  } else if (mode === 'typing') {
    $('promptLabel').textContent = 'כתבו באנגלית את המילה';
    $('word').textContent = item.t; $('word').setAttribute('lang', 'he');
    $('typingBox').classList.remove('hidden');
    const input = $('typingInput'); input.value = ''; input.focus();
  } else {
    $('promptLabel').textContent = 'מה התרגום של';
    $('word').textContent = item.w; $('word').setAttribute('lang', 'en');
    $('typingBox').classList.add('hidden');
    const distractors = shuffle(vocab.filter(v => v.t !== item.t)).slice(0, 3).map(v => v.t);
    shuffle([item.t, ...distractors]).forEach(text => {
      const b = document.createElement('button');
      b.className = 'answer'; b.textContent = text;
      b.addEventListener('click', () => answerChoice(text === item.t, b, item.t));
      answers.append(b);
    });
  }
}
let locked = false;
function answerChoice(ok, btn, correctText) {
  if (locked) return; locked = true;
  const item = session.queue[session.index];
  markWord(item.w, ok); markAnswer(ok);
  document.querySelectorAll('.answer').forEach(b => {
    b.disabled = true;
    if (b.textContent === correctText) b.classList.add(ok ? 'correct' : 'reveal');
  });
  if (ok) { session.correct++; btn.classList.add('correct'); $('hint').textContent = 'מעולה — תשובה נכונה!'; $('hint').classList.add('good'); }
  else { session.wrong++; if (btn) btn.classList.add('wrong'); $('hint').textContent = `התשובה: ${correctText}`; $('hint').classList.add('bad'); }
  persist(); refreshHome();
  setTimeout(() => { locked = false; session.index++; showQuestion(); }, ok ? 900 : 1600);
}
function checkTyping() {
  if (locked) return;
  const item = session.queue[session.index];
  const norm = s => s.toLowerCase().trim().replace(/[.,!?;:'"״׳-]/g, '').replace(/\s+/g, ' ');
  const guess = norm($('typingInput').value);
  const target = norm(item.w);
  const lev = (a, b) => { const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]); for (let j = 1; j <= n; j++) d[0][j] = j; for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[m][n]; };
  const ok = guess === target || (target.length >= 5 && lev(guess, target) <= 1);
  locked = true;
  markWord(item.w, ok); markAnswer(ok); persist(); refreshHome();
  if (ok) { session.correct++; $('hint').textContent = 'מעולה — נכון!'; $('hint').classList.add('good'); }
  else { session.wrong++; $('hint').textContent = `התשובה: ${item.w}`; $('hint').classList.add('bad'); }
  setTimeout(() => { locked = false; session.index++; showQuestion(); }, ok ? 900 : 1800);
}
function finishSession() {
  session.active = false;
  $('quizCard').classList.add('hidden'); $('summary').classList.remove('hidden');
  const total = session.correct + session.wrong;
  $('summaryText').textContent = `ענית נכון על ${session.correct} מתוך ${total} מילים — ${pct(session.correct, total)} הצלחה.`;
  refreshHome();
}
function refreshHome() {
  const today = stats.days[todayKey()] || { a: 0, c: 0 };
  $('todayCount').textContent = today.a;
  $('goalTarget').textContent = settings.goal;
  const p = Math.min(100, Math.round(today.a / settings.goal * 100));
  $('goalRingText').textContent = `${p}%`;
  $('goalRing').style.background = `conic-gradient(var(--accent) ${p}%, var(--accent-soft) ${p}%)`;
  $('dayStreak').textContent = dayStreak();
  $('dueCount').textContent = dueCount().toLocaleString('he-IL');
  $('learnedStat').textContent = learnedCount().toLocaleString('he-IL');
  $('accuracyStat').textContent = pct(stats.correct, stats.attempts);
  $('sessionBtn').textContent = settings.length === 'all' ? 'כל הדחופות' : `${settings.length} מילים`;
  $('modeBtn').textContent = { choice: 'בחירה אנגלית ← עברית', reverse: 'בחירה הפוכה', typing: 'הקלדה' }[settings.mode];
  if (vocab.length) {
    $('bandBtn').textContent = bandLabel();
    $('bandNote').textContent = bandAccuracyNote();
    if ($('bandSelect').options.length) $('bandSelect').value = String(bands.current);
  }
}
function renderBandSelect() {
  const sel = $('bandSelect'); if (!sel) return;
  sel.replaceChildren();
  for (let b = 1; b <= maxBand(); b++) {
    const opt = document.createElement('option');
    opt.value = String(b);
    opt.textContent = `רמה ${b} — מילים ${bandLo(b).toLocaleString('he-IL')}–${bandHi(b).toLocaleString('he-IL')}`;
    sel.append(opt);
  }
  sel.value = String(bands.current);
}
let toastTimer = null;
function showToast(text) {
  const el = $('toast'); if (!el) return;
  el.textContent = text; el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 4000);
}

/* ---------- Library ---------- */
let libFilter = '', libShown = 0;
const LIB_PAGE = 60;
function filteredVocab() {
  if (!libFilter) return vocab;
  const q = libFilter.toLowerCase();
  return vocab.filter(v => v.w.toLowerCase().includes(q) || v.t.includes(libFilter));
}
function renderLibrary(reset = true) {
  if (reset) { libShown = 0; $('libraryList').replaceChildren(); }
  const items = filteredVocab();
  $('libraryCount').textContent = `${items.length.toLocaleString('he-IL')} מילים${libFilter ? ` עבור "${libFilter}"` : ''}`;
  const page = items.slice(libShown, libShown + LIB_PAGE);
  libShown += page.length;
  const list = $('libraryList');
  page.forEach(v => {
    const p = rec(v.w);
    const row = document.createElement('div');
    row.className = 'word-item';
    const level = (p.r + p.w) === 0 ? '☆' : p.s >= 4 ? '★★★' : p.s >= 2 ? '★★' : p.s >= 1 ? '★' : '☆';
    row.innerHTML = `<span class="rank">#${v.r.toLocaleString('he-IL')}</span><span class="w"></span><span class="t"></span><span class="level" aria-label="רמת שליטה">${level}</span><button class="speak" aria-label="השמעה">🔊</button>`;
    row.querySelector('.w').textContent = v.w;
    row.querySelector('.t').textContent = v.t;
    row.querySelector('.speak').addEventListener('click', () => speak(v.w));
    row.querySelector('.w').addEventListener('click', () => toggleExample(row, v.w));
    list.append(row);
  });
  $('moreBtn').classList.toggle('hidden', libShown >= items.length);
}
async function toggleExample(row, word) {
  const existing = row.querySelector('.example');
  if (existing) { existing.remove(); return; }
  const el = document.createElement('span');
  el.className = 'example'; el.textContent = 'טוען דוגמה…';
  row.append(el);
  try {
    const cache = readJSON('fw.examples.v1', {});
    let entry = cache[word.toLowerCase()];
    if (!entry) {
      const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      const meaning = data[0] && data[0].meanings && data[0].meanings[0];
      entry = { def: meaning && meaning.definitions && meaning.definitions[0] && meaning.definitions[0].definition, ex: meaning && meaning.definitions && (meaning.definitions.find(d => d.example) || {}).example };
      cache[word.toLowerCase()] = entry; save('fw.examples.v1', cache);
    }
    el.textContent = [entry.def, entry.ex ? `דוגמה: ${entry.ex}` : ''].filter(Boolean).join(' — ') || 'אין דוגמה זמינה';
  } catch { el.textContent = 'אין דוגמה זמינה'; }
}
function speak(text) {
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US'; u.rate = 0.92;
    const voice = speechSynthesis.getVoices().find(v => v.lang.startsWith('en'));
    if (voice) u.voice = voice;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  } catch {}
}

/* ---------- Stats view ---------- */
function renderStats() {
  $('totalAttempts').textContent = stats.attempts.toLocaleString('he-IL');
  $('totalAccuracy').textContent = pct(stats.correct, stats.attempts);
  $('statsLearned').textContent = learnedCount().toLocaleString('he-IL');
  $('statsDue').textContent = dueCount().toLocaleString('he-IL');
  const bars = $('weekBars'); bars.replaceChildren();
  const names = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
  const days = [];
  for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days.push(d); }
  const max = Math.max(1, ...days.map(d => { const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; return (stats.days[k] || {}).a || 0; }));
  days.forEach(d => {
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const a = (stats.days[k] || {}).a || 0;
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.innerHTML = `<i style="height:${Math.round(a / max * 100)}%" title="${a} מילים"></i><span>${names[d.getDay()]}</span>`;
    bars.append(bar);
  });
}

/* ---------- Settings / export ---------- */
function applySettingsToUI() {
  $('goalSelect').value = String(settings.goal);
  $('lengthSelect').value = String(settings.length);
  $('modeSelect').value = settings.mode;
}
function exportData() {
  const blob = new Blob([JSON.stringify({ app: 'fourWords', version: 2, exportedAt: new Date().toISOString(), settings, progress, stats, bands }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `four-words-backup-${todayKey()}.json`;
  a.click(); URL.revokeObjectURL(a.href);
}
function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (data.progress) Object.keys(data.progress).forEach(w => {
        const l = progress[w], r = data.progress[w];
        if (!l || (r.r + r.w) > (l.r + l.w)) progress[w] = r;
      });
      if (data.stats) {
        stats.attempts = Math.max(stats.attempts, data.stats.attempts || 0);
        stats.correct = Math.max(stats.correct, data.stats.correct || 0);
        Object.keys(data.stats.days || {}).forEach(d => {
          const l = stats.days[d] || { a: 0, c: 0 }, r = data.stats.days[d];
          stats.days[d] = { a: Math.max(l.a, r.a || 0), c: Math.max(l.c, r.c || 0) };
        });
      }
      if (data.settings) { settings = Object.assign(settings, data.settings); applySettingsToUI(); }
      if (data.bands && typeof data.bands.current === 'number') {
        if (Math.floor((data.bands.current - 1) / 10) === Math.floor((bands.current - 1) / 10) && (data.bands.thousandRecent || []).length > (bands.thousandRecent || []).length) bands.thousandRecent = data.bands.thousandRecent.slice(-100);
        if (data.bands.current > bands.current) {
          const retainedThousand = Math.floor((data.bands.current - 1) / 10) === Math.floor((bands.current - 1) / 10) ? (bands.thousandRecent || []) : [];
          bands = { ...data.bands, current: data.bands.current, recent: Array.isArray(data.bands.recent) ? data.bands.recent.slice(-BAND_WINDOW) : [], thousandRecent: Array.isArray(data.bands.thousandRecent) ? data.bands.thousandRecent.slice(-100) : [] };
          if (retainedThousand.length > bands.thousandRecent.length) bands.thousandRecent = retainedThousand;
        }
        else if (data.bands.current === bands.current && Array.isArray(data.bands.recent) && data.bands.recent.length > bands.recent.length) bands.recent = data.bands.recent.slice(-BAND_WINDOW);
        renderBandSelect();
      }
      persist(); refreshHome(); renderLibrary(); renderStats();
      alert('הגיבוי שוחזר בהצלחה');
    } catch { alert('קובץ לא תקין'); }
  };
  reader.readAsText(file);
}

/* ---------- Tabs & events ---------- */
document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
  $(`tab-${btn.dataset.tab}`).classList.remove('hidden');
  if (btn.dataset.tab === 'stats') renderStats();
  if (btn.dataset.tab === 'library') renderLibrary();
}));
$('startBtn').addEventListener('click', startSession);
$('againBtn').addEventListener('click', startSession);
$('homeBtn').addEventListener('click', () => { $('summary').classList.add('hidden'); $('practiceHome').classList.remove('hidden'); });
$('dontKnowBtn').addEventListener('click', () => {
  if (settings.mode === 'typing') { locked || checkTypingDontKnow(); }
  else answerChoice(false, null, settings.mode === 'reverse' ? session.queue[session.index].w : session.queue[session.index].t);
});
function checkTypingDontKnow() {
  locked = true;
  const item = session.queue[session.index];
  markWord(item.w, false); markAnswer(false); session.wrong++; persist(); refreshHome();
  $('hint').textContent = `התשובה: ${item.w}`; $('hint').classList.add('bad');
  setTimeout(() => { locked = false; session.index++; showQuestion(); }, 1800);
}
$('typingCheck').addEventListener('click', checkTyping);
$('typingInput').addEventListener('keydown', e => { if (e.key === 'Enter') checkTyping(); });
$('speakBtn').addEventListener('click', () => { const item = session.queue[session.index]; if (item) speak(item.w); });
$('sessionBtn').addEventListener('click', () => switchTab('settings'));
$('modeBtn').addEventListener('click', () => switchTab('settings'));
function switchTab(name) { document.querySelector(`.tab-btn[data-tab="${name}"]`).click(); }
$('searchInput').addEventListener('input', e => { libFilter = e.target.value.trim(); renderLibrary(); });
$('moreBtn').addEventListener('click', () => renderLibrary(false));
$('goalSelect').addEventListener('change', e => { settings.goal = Number(e.target.value); persist(); refreshHome(); });
$('lengthSelect').addEventListener('change', e => { settings.length = e.target.value === 'all' ? 'all' : Number(e.target.value); persist(); refreshHome(); });
$('modeSelect').addEventListener('change', e => { settings.mode = e.target.value; persist(); refreshHome(); });
$('bandSelect').addEventListener('change', e => { setBand(Number(e.target.value)); showToast(`הרמה שונתה — ${bandLabel()}`); });
$('bandBtn').addEventListener('click', () => switchTab('settings'));
$('exportBtn').addEventListener('click', exportData);
$('importBtn').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', e => { if (e.target.files[0]) importData(e.target.files[0]); });
$('resetBtn').addEventListener('click', () => {
  if (confirm('לאפס את כל ההתקדמות? הפעולה בלתי הפיכה.')) {
    progress = {}; stats = { days: {}, attempts: 0, correct: 0 };
    bands = { current: 1, recent: [] };
    persist(); renderBandSelect(); refreshHome(); renderLibrary(); renderStats();
  }
});
$('authBtn').addEventListener('click', async () => {
  if (!window.firebase) return;
  if (fb.user) { if (confirm('להתנתק מהסנכרון?')) { await firebase.auth().signOut(); } return; }
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    await firebase.auth().signInWithPopup(provider);
  } catch (e) {
    try { await firebase.auth().signInWithRedirect(new firebase.auth.GoogleAuthProvider()); } catch {}
  }
});
document.addEventListener('keydown', e => {
  if (!session.active || locked) return;
  const idx = ['1', '2', '3', '4'].indexOf(e.key);
  if (idx >= 0) { const btns = document.querySelectorAll('.answer'); if (btns[idx]) btns[idx].click(); }
});
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('controllerchange', updateOfflineStatus);
if ('serviceWorker' in navigator) window.addEventListener('load', async () => {
  try {
    await navigator.serviceWorker.register('sw.js');
    await navigator.serviceWorker.ready;
    updateOfflineStatus();
  } catch { $('offlineStatus').textContent = 'לא הושלמה הכנה לאופליין. פתחו שוב עם אינטרנט ונסו לרענן.'; }
});

applySettingsToUI();
loadVocab();
refreshHome();
initFirebase();
