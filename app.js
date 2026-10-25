'use strict';
/* ארבע מילים v2 — SRS, cloud sync (Firebase), library, goals. */
const SHEET_CSV = 'https://docs.google.com/spreadsheets/d/1YuNV-TcC_tITIe-SGTzTh-dKTlx4H84-4feTzAM2k4M/export?format=csv&gid=0';
const K = { vocab: 'fw.vocab.v2', progress: 'fw.progress.v2', settings: 'fw.settings.v2', stats: 'fw.stats.v2', bands: 'fw.bands.v1' };
const INTERVALS = [1, 3, 7, 14, 30]; // days, mirrors the iOS app
const DAY = 86400000;
const $ = id => document.getElementById(id);
const iconMarkup = name => `<svg class="icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><use href="#icon-${name}"/></svg>`;
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
const LEARNING_LIMIT = 200;    // max words in the learning state at once
const BAND_ADVANCE = 0.7;      // at least 70% (7 of 10) advances
let bands = Object.assign({ current: 1, recent: [] }, readJSON(K.bands, {}));
let rankOf = new Map();        // word -> rank, built when vocab loads
let wordByLower = new Map();     // lowercase word -> vocab item, built when vocab loads
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
  wordByLower = new Map(vocab.map(v => [v.w.toLowerCase(), v]));
  $('vocabCount').textContent = vocab.length.toLocaleString('he-IL');
  renderBandSelect();
  refreshHome(); renderLibrary();
  loadDetails().catch(() => {}); // Warm local/offline examples and synonym exclusions.
  loadBookFrequency().catch(() => {}); // Warm per-word book occurrence counts.
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
const isAttempted = p => !!p && (p.r + p.w) > 0;
// A clean first answer is learned immediately; after any miss, two consecutive
// correct answers are still required. Derive this from the unchanged history.
const isLearned = p => isAttempted(p) && p.s >= (p.w === 0 ? 1 : 2);
const isLearning = p => isAttempted(p) && !isLearned(p);
const learningCount = () => Object.values(progress).filter(isLearning).length;
function buildQueue() {
  const now = Date.now();
  const attempted = v => isAttempted(progress[v.w]);
  // Never-attempted words may enter learning only while fewer than
  // LEARNING_LIMIT words are in learning. Existing words are never removed.
  // Queuing a word does not reserve a learning slot. Check the real count again
  // before showing each question, because an earlier miss can fill the cap.
  const canIntroduce = learningCount() < LEARNING_LIMIT;
  const admit = v => attempted(v) || canIntroduce;
  // Current band plus due reviews of words already attempted anywhere;
  // words outside the band that were never attempted are not introduced.
  const due = vocab.filter(v => (progress[v.w] ? progress[v.w].next : 0) <= now && (inCurrentBand(v) || attempted(v)));
  due.sort((a, b) => priorityOf(a.w) - priorityOf(b.w) ||
    ((rec(a.w).r + rec(a.w).w) - (rec(b.w).r + rec(b.w).w)) || a.r - b.r);
  const want = settings.length === 'all' ? due.length : settings.length;
  const floor = Math.max(want, Math.min(10, due.length));
  let picked = [];
  for (const v of due) { if (picked.length >= floor) break; if (admit(v)) picked.push(v); }
  if (picked.length < want && settings.length !== 'all') {
    const ids = new Set(picked.map(v => v.w));
    for (const v of vocab) { if (picked.length >= want) break; if (!ids.has(v.w) && inCurrentBand(v) && admit(v)) { ids.add(v.w); picked.push(v); } }
  }
  return shuffle(picked);
}
function skipUnadmittedQuestions() {
  let removed = false;
  while (session.queue[session.index] && !isAttempted(progress[session.queue[session.index].w]) && learningCount() >= LEARNING_LIMIT) {
    session.queue.splice(session.index, 1);
    removed = true;
  }
  if (removed) $('sessionLabel').textContent = settings.length === 'all' ? 'כל הדחופות' : `${session.queue.length} מילים`;
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
const learnedCount = () => Object.values(progress).filter(isLearned).length;
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
        setSync(navigator.onLine ? 'מסנכן…' : 'אופליין · נשמר במכשיר');
        const uid = user.uid;
        fb.unsubscribe = fb.db.collection('users').doc(uid).onSnapshot({ includeMetadataChanges: true }, snap => {
          if (fb.user?.uid !== uid) return;
          if (snap.exists && !snap.metadata.hasPendingWrites) mergeRemote(snap.data());
          if (!snap.metadata.fromCache && dirty) schedulePush(0);
        }, () => { setSync('נשמר · ממתין לחיבור'); schedulePush(5000); });
        schedulePush(0);
      } else setSync('מצב מקומי · נשמר במכשיר');
    });
  } catch { fb.initialized = false; setSync('מצב מקומי · סנכרון כשהחיבור יחזור'); }
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
    setSync(dirty ? 'נשמר · ממשיך לסנכרן' : 'מסונכרן ✓');
  } catch { setSync('נשמר · ממתין לחיבור'); }
  finally {
    fb.pushing = false;
    if (dirty && fb.ready) schedulePush(5000);
  }
}
window.addEventListener('online', () => { initFirebase(); schedulePush(0); updateOfflineStatus(); });
window.addEventListener('offline', () => { setSync('אופליין · נשמר במכשיר'); updateOfflineStatus(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { initFirebase(); schedulePush(0); } });

async function updateOfflineStatus() {
  const label = $('offlineStatus');
  if (!label) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const cache = await caches.open('four-words-offline-v26');
    const required = ['index.html', 'app.js', 'quiz-content.js', 'vocab.json', 'details.json', 'styles.css', 'firebase-config.js', ...['app','auth','firestore'].map(name => 'https://www.gstatic.com/firebasejs/10.14.1/firebase-' + name + '-compat.js')];
    const prepared = registration?.active && (await Promise.all(required.map(url => cache.match(url)))).every(Boolean);
    if (prepared) label.textContent = 'מוכן לתרגול אופליין במכשיר זה · לפתיחה השתמשו באותה כתובת';
    else label.textContent = 'מכינים שימוש אופליין… השאירו פתוח עם אינטרנט עד שמופיע אישור';
  } catch { label.textContent = 'שמירה אופליין לא זמינה בדפדפן זה'; }
}
/* ---------- Quiz ---------- */
let startingSession = false;
async function startSession() {
  if (!vocab.length || startingSession) return;
  startingSession = true;
  let waitTimer;
  try {
    // A stalled optional details request must not block locally cached practice.
    await Promise.race([loadDetails(), new Promise(resolve => { waitTimer = setTimeout(resolve, 1200); })]);
  } catch {} // Choices still use Hebrew aliases if details are unavailable.
  finally { clearTimeout(waitTimer); startingSession = false; }
  session = { queue: buildQueue(), index: 0, correct: 0, wrong: 0, active: true };
  $('practiceHome').classList.add('hidden'); $('summary').classList.add('hidden'); $('quizCard').classList.remove('hidden');
  $('sessionLabel').textContent = settings.length === 'all' ? 'כל הדחופות' : `${session.queue.length} מילים`;
  $('quizBandLabel').textContent = bandLabel();
  showQuestion();
}
// Shrink the prompt word until it fits on one line; wrapping is the fallback.
function fitWord() {
  const el = $('word'); if (!el) return;
  el.style.fontSize = '';
  let size = parseFloat(getComputedStyle(el).fontSize) || 42;
  el.style.whiteSpace = 'nowrap';
  while (size > 14 && el.scrollWidth > el.clientWidth) { size -= 2; el.style.fontSize = size + 'px'; }
  // Keep the fitted line intact: re-enabling wrapping can add a line because
  // fractional glyph widths round differently from scrollWidth.
}
function renderReviewBadge(item) {
  const badge = $('reviewBadge');
  const reviewing = !inCurrentBand(item);
  badge.textContent = reviewing ? `חזרה · רמה ${Math.ceil(item.r / BAND_SIZE)}` : '';
  badge.setAttribute('aria-hidden', String(!reviewing));
}
function showQuestion() {
  skipUnadmittedQuestions();
  const item = session.queue[session.index];
  if (!item) return finishSession();
  $('progressText').textContent = `מילה ${session.index + 1} מתוך ${session.queue.length}`;
  $('progressBar').style.width = `${(session.index / session.queue.length) * 100}%`;
  $('serial').textContent = `#${item.r.toLocaleString('he-IL')}`;
  renderReviewBadge(item);
  $('hint').textContent = ''; $('hint').className = 'hint';
  $('quizCard').classList.remove('reviewing', 'answering-correct');
  $('answerFeedback').replaceChildren(); $('answerFeedback').classList.add('hidden');
  $('nextBtn').classList.add('hidden'); $('dontKnowBtn').classList.remove('hidden');
  $('typingCheck').disabled = false; $('typingInput').disabled = false;
  const mode = settings.mode;
  const content = VocabQuiz.getWordContent(item, wordDetails[item.r]);
  const context = VocabQuiz.getPromptContext(item, mode, wordDetails[item.r]);
  $('questionContext').textContent = context;
  // Keep the context slot even when a later question needs no example.
  $('questionContext').classList.remove('hidden');
  $('questionContext').classList.toggle('empty', !context);
  const answers = $('answers'); answers.replaceChildren();
  if (mode === 'typing') {
    $('promptLabel').textContent = 'כתבו באנגלית את המילה';
    $('word').textContent = content.meaning; $('word').setAttribute('lang', 'he'); $('word').dir = 'rtl';
    $('typingBox').classList.remove('hidden');
    const input = $('typingInput'); input.value = ''; input.focus({ preventScroll: true });
  } else {
    const reverse = mode === 'reverse';
    $('promptLabel').textContent = reverse ? 'מה המילה באנגלית עבור' : 'מה התרגום של';
    $('word').textContent = reverse ? content.meaning : item.w;
    $('word').setAttribute('lang', reverse ? 'he' : 'en'); $('word').dir = reverse ? 'rtl' : 'ltr';
    $('typingBox').classList.add('hidden');
    VocabQuiz.buildChoices(item, vocab, mode, wordDetails).forEach(choice => {
      const b = document.createElement('button');
      b.className = 'answer'; b.textContent = choice.label; b.dir = reverse ? 'ltr' : 'rtl';
      b.dataset.correct = String(choice.correct);
      b.addEventListener('click', () => answerChoice(choice.correct, b));
      answers.append(b);
    });
  }
  fitWord();
}
let locked = false;
function answerChoice(ok, btn) {
  if (locked) return; locked = true;
  const item = session.queue[session.index];
  markWord(item.w, ok); markAnswer(ok);
  document.querySelectorAll('.answer').forEach(b => {
    b.disabled = true;
    if (b.dataset.correct === 'true') b.classList.add(ok ? 'correct' : 'reveal');
  });
  if (ok) { session.correct++; btn.classList.add('correct'); $('hint').textContent = 'מעולה — תשובה נכונה!'; $('hint').classList.add('good'); }
  else { session.wrong++; if (btn) btn.classList.add('wrong'); $('hint').textContent = btn ? 'נלמד את המילה ונמשיך' : 'זו הזדמנות להכיר את המילה'; }
  persist(); refreshHome();
  completeAnswer(ok, item);
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
  else { session.wrong++; $('hint').textContent = 'נלמד את המילה ונמשיך'; }
  completeAnswer(ok, item);
}
function nextQuestion() {
  if (!locked || !session.active) return;
  locked = false; session.index++; showQuestion();
}
function completeAnswer(ok, item) {
  $('typingCheck').disabled = true; $('typingInput').disabled = true;
  if (ok) {
    $('quizCard').classList.add('answering-correct');
    return advanceWhenReady(nextQuestion, 900);
  }
  $('dontKnowBtn').classList.add('hidden');
  $('quizCard').classList.add('reviewing');
  renderAnswerFeedback(item);
  $('nextBtn').classList.remove('hidden');
  $('nextBtn').focus({ preventScroll: true });
  loadDetails().then(() => {
    if (locked && session.queue[session.index] === item) renderAnswerFeedback(item);
  }).catch(() => {});
}
function renderAnswerFeedback(item) {
  // The answer may have advanced the current band since the prompt rendered.
  renderReviewBadge(item);
  const content = VocabQuiz.getWordContent(item, wordDetails[item.r]);
  const box = $('answerFeedback'); box.replaceChildren(); box.classList.remove('hidden');
  const label = document.createElement('p'); label.className = 'feedback-label'; label.textContent = 'המשמעות הנלמדת';
  const meaning = document.createElement('p'); meaning.className = 'feedback-meaning'; meaning.textContent = content.meaning;
  const word = document.createElement('bdi'); word.lang = 'en'; word.dir = 'ltr'; word.textContent = item.w;
  const example = document.createElement('p'); example.className = 'example-text'; example.lang = 'en'; example.dir = 'ltr';
  example.textContent = content.example || '';
  box.append(label, meaning, word);
  if (content.example) box.append(example);
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
  renderLearningNote();
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
function renderLearningNote() {
  const el = $('learningNote'); if (!el) return;
  const n = learningCount();
  const full = n >= LEARNING_LIMIT;
  el.textContent = full
    ? `בלמידה: ${n}/${LEARNING_LIMIT} · המכסה מלאה, מילים חדשות ייכנסו רק אחרי שמילים ייצאו מהלמידה`
    : `בלמידה: ${n}/${LEARNING_LIMIT} מילים`;
  el.classList.toggle('full', full);
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
    row.innerHTML = `<span class="rank">#${v.r.toLocaleString('he-IL')}</span><span class="w"></span><span class="t"></span><span class="level" aria-label="רמת שליטה">${level}</span><button class="speak" aria-label="השמעה">${iconMarkup('volume')}</button>`;
    row.querySelector('.w').textContent = v.w;
    row.querySelector('.t').textContent = v.t;
    row.querySelector('.speak').addEventListener('click', () => speak(v.w));
    row.querySelector('.w').addEventListener('click', () => openDetails(v));
    row.querySelector('.t').addEventListener('click', () => openDetails(v));
    list.append(row);
  });
  $('moreBtn').classList.toggle('hidden', libShown >= items.length);
}
/* ---------- Book word info (tap any word in the reader) ---------- */
let wordSheetOpen = false, wordSheetItem = null, wordSheetTrigger = null;
function normalizeBookWord(raw) { return (raw || '').toLowerCase().replace(/[’‘]/g, "'").trim(); }
// Exact form first, then common English inflections, so a clicked plural or
// past tense still finds its app card. Never creates or alters progress here.
function lookupBookWord(raw) {
  const base = normalizeBookWord(raw);
  if (!base) return null;
  const cands = [base];
  if (base.endsWith("'s") && base.length > 3) cands.push(base.slice(0, -2));
  if (base.endsWith('ies') && base.length > 4) cands.push(base.slice(0, -3) + 'y');
  if (base.endsWith('ied') && base.length > 4) cands.push(base.slice(0, -3) + 'y');
  if (base.endsWith('ing') && base.length > 5) cands.push(base.slice(0, -3));
  if (base.endsWith('es') && base.length > 4) cands.push(base.slice(0, -2));
  if (base.endsWith('ed') && base.length > 4) cands.push(base.slice(0, -2));
  if (base.endsWith('s') && base.length > 3) cands.push(base.slice(0, -1));
  for (const c of cands) { const hit = wordByLower.get(c); if (hit) return hit; }
  return null;
}
function renderWordSheetState() {
  const state = $('wordSheetState'), knownBtn = $('wordKnownBtn');
  if (!wordSheetItem) {
    state.textContent = 'המילה הזו לא נמצאת ברשימת המילים של האפליקציה.';
    return;
  }
  const known = isLearned(rec(wordSheetItem.w));
  state.textContent = known ? 'מסומנת כידועה' : isAttempted(rec(wordSheetItem.w)) ? 'בתהליך למידה' : 'עוד לא נלמדה';
  knownBtn.textContent = known ? 'סימון כלא ידועה' : 'סימון כידועה';
  knownBtn.setAttribute('aria-pressed', known ? 'true' : 'false');
}
function openWordSheet(surface) {
  const item = lookupBookWord(surface);
  if (!wordSheetOpen) wordSheetTrigger = document.activeElement;
  wordSheetOpen = true; wordSheetItem = item;
  $('wordSheetWord').textContent = item ? item.w : surface;
  $('wordSheetSerial').textContent = item ? `#${item.r.toLocaleString('he-IL')}` : '';
  const inflected = item && normalizeBookWord(surface) !== item.w.toLowerCase();
  $('wordSheetFormRow').classList.toggle('hidden', !inflected);
  if (inflected) $('wordSheetForm').textContent = surface;
  $('wordCardBtn').classList.toggle('hidden', !item);
  $('wordKnownBtn').classList.toggle('hidden', !item);
  renderWordSheetState();
  $('wordSheet').classList.remove('hidden');
  $('wordSheetClose').focus({ preventScroll: true });
}
function closeWordSheet() {
  $('wordSheet').classList.add('hidden');
  wordSheetOpen = false; wordSheetItem = null;
  if (wordSheetTrigger?.isConnected) wordSheetTrigger.focus({ preventScroll: true });
}
// Book marks update learning progress only: they are not quiz answers, so
// band advancement (recordBandAnswer) and quiz stats (markAnswer) stay clean.
// Known mirrors the quiz's learned rule (clean word: streak 1; after a miss:
// 2 in a row) and schedules the review at the longest interval. Unknown puts
// the word back into learning, due now, like the quiz's "לא יודע" button.
function setBookWordKnown(known) {
  const item = wordSheetItem; if (!item) return;
  const p = rec(item.w); const now = Date.now();
  if (known) {
    const need = p.w === 0 ? 1 : 2;
    if (p.s < need) { p.r += need - p.s; p.s = need; }
    p.next = now + INTERVALS[INTERVALS.length - 1] * DAY;
  } else { p.w++; p.s = 0; p.next = now; }
  progress[item.w] = p;
  persist(); refreshHome();
  renderWordSheetState();
}

/* ---------- Word details card (synonyms, meanings, example) ---------- */
let detailsPromise = null, wordDetails = {}, sheetOpen = false, pendingAdvance = null, sheetTrigger = null;
const POS_HE = { n: 'שם עצם', v: 'פועל', a: 'תואר', r: 'תואר הפועל' };
function loadDetails() {
  if (!detailsPromise) detailsPromise = fetch('details.json').then(r => { if (!r.ok) throw new Error('details'); return r.json(); }).then(data => { wordDetails = data; return data; }).catch(err => { detailsPromise = null; throw err; });
  return detailsPromise;
}
let freqPromise = null, bookFrequency = null;
function loadBookFrequency() {
  if (!freqPromise) freqPromise = fetch('book-frequency.json').then(r => { if (!r.ok) throw new Error('book-frequency'); return r.json(); }).then(data => { bookFrequency = data; return data; }).catch(err => { freqPromise = null; throw err; });
  return freqPromise;
}
function addDetailSection(parent, title, nodes) {
  const sec = document.createElement('section'); sec.className = 'detail-section';
  const h = document.createElement('h3'); h.textContent = title; sec.append(h, ...nodes); parent.append(sec);
}
async function openDetails(item) {
  const body = $('detailBody');
  if (!sheetOpen) sheetTrigger = document.activeElement;
  $('detailWord').textContent = item.w; $('detailSerial').textContent = `#${item.r.toLocaleString('he-IL')}`;
  $('detailTranslation').textContent = VocabQuiz.getWordContent(item).meaning;
  $('detailSpeak').onclick = () => speak(item.w);
  body.replaceChildren(); const loading = document.createElement('p'); loading.className = 'detail-empty'; loading.textContent = 'טוען…'; body.append(loading);
  $('detailSheet').classList.remove('hidden'); sheetOpen = true;
  $('detailClose').focus({ preventScroll: true });
  let data;
  try { data = (await loadDetails())[item.r] || null; }
  catch {
    if (!sheetOpen || $('detailWord').textContent !== item.w) return;
    data = null;
  }
  if (!sheetOpen || $('detailWord').textContent !== item.w) return;
  body.replaceChildren();
  const content = VocabQuiz.getWordContent(item, data);
  if (content.example) {
    const row = document.createElement('div'); row.className = 'example-row';
    const q = document.createElement('p'); q.className = 'example-text'; q.lang = 'en'; q.dir = 'ltr'; q.textContent = content.example;
    const b = document.createElement('button'); b.className = 'speak-btn'; b.setAttribute('aria-label', 'השמעת המשפט'); b.innerHTML = iconMarkup('volume'); b.addEventListener('click', () => speak(content.example));
    row.append(q, b); addDetailSection(body, 'משפט לדוגמה', [row]);
  }
  let freq = null;
  try { freq = await loadBookFrequency(); } catch {}
  if (!sheetOpen || $('detailWord').textContent !== item.w) return;
  if (freq) {
    const n = (freq.counts && freq.counts[item.r]) || 0;
    const line = document.createElement('p');
    line.className = 'freq-line';
    line.textContent = n === 1 ? 'מופיע פעם אחת בספר:'
      : n > 1 ? `מופיע ${n.toLocaleString('he-IL')} פעמים בספר:`
      : 'לא מופיע בספר:';
    const bookTitle = document.createElement('span');
    bookTitle.className = 'freq-book';
    bookTitle.dir = 'ltr'; bookTitle.lang = 'en';
    bookTitle.textContent = freq.book;
    const note = document.createElement('p');
    note.className = 'freq-note';
    note.textContent = 'הספירה לפי צורת המילה המדויקת בלבד (ללא הטיות), בכל הספר כולל כותרות רצות ודפי פתיחה.';
    addDetailSection(body, 'שכיחות בספר', [line, bookTitle, note]);
  }
  const disclosure = (label, node) => {
    const extra = document.createElement('details'); extra.className = 'detail-extra';
    const summary = document.createElement('summary'); summary.textContent = label;
    extra.append(summary, node); body.append(extra);
  };
  if (data?.d?.length) {
    const list = document.createElement('ol'); list.className = 'meaning-list'; list.dir = 'ltr';
    data.d.forEach(entry => {
      const cut = entry.indexOf('|'); const pos = entry.slice(0, cut), text = entry.slice(cut + 1);
      const li = document.createElement('li');
      const tag = document.createElement('span'); tag.className = 'pos-tag'; tag.textContent = POS_HE[pos] || pos; tag.dir = 'rtl';
      const definition = document.createElement('span'); definition.lang = 'en'; definition.textContent = text;
      li.append(tag, definition); list.append(li);
    });
    disclosure('עוד משמעויות באנגלית', list);
  }
  if (data?.s?.length) {
    const wrap = document.createElement('div'); wrap.className = 'chips-row'; wrap.dir = 'ltr'; wrap.lang = 'en';
    data.s.forEach(s => { const c = document.createElement('span'); c.className = 'syn-chip'; c.textContent = s; wrap.append(c); });
    disclosure('מילים נרדפות', wrap);
  }
}
function closeDetails() {
  $('detailSheet').classList.add('hidden'); sheetOpen = false;
  if (sheetTrigger?.isConnected) sheetTrigger.focus({ preventScroll: true });
  if (pendingAdvance) { const fn = pendingAdvance; pendingAdvance = null; fn(); }
}
function advanceWhenReady(fn, delay) {
  setTimeout(() => { if (sheetOpen) pendingAdvance = fn; else fn(); }, delay);
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
  if (btn.dataset.tab === 'book' && window.VocabReader) VocabReader.showBookTab();
}));
$('startBtn').addEventListener('click', startSession);
$('againBtn').addEventListener('click', startSession);
$('homeBtn').addEventListener('click', () => { $('summary').classList.add('hidden'); $('practiceHome').classList.remove('hidden'); });
$('dontKnowBtn').addEventListener('click', () => {
  if (settings.mode === 'typing') { locked || checkTypingDontKnow(); }
  else answerChoice(false, null);
});
function checkTypingDontKnow() {
  locked = true;
  const item = session.queue[session.index];
  markWord(item.w, false); markAnswer(false); session.wrong++; persist(); refreshHome();
  $('hint').textContent = 'זו הזדמנות להכיר את המילה';
  completeAnswer(false, item);
}
$('nextBtn').addEventListener('click', nextQuestion);
$('typingCheck').addEventListener('click', checkTyping);
$('typingInput').addEventListener('keydown', e => { if (e.key === 'Enter') checkTyping(); });
$('detailBtn').addEventListener('click', () => { const item = session.queue[session.index]; if (item) openDetails(item); });
$('detailClose').addEventListener('click', closeDetails);
$('detailSheet').addEventListener('click', e => { if (e.target === $('detailSheet')) closeDetails(); });
$('bookContent').addEventListener('click', e => {
  const span = e.target.closest('.bw');
  if (span) openWordSheet(span.textContent);
});
$('wordSheetClose').addEventListener('click', closeWordSheet);
$('wordSheet').addEventListener('click', e => { if (e.target === $('wordSheet')) closeWordSheet(); });
$('wordCardBtn').addEventListener('click', () => { const item = wordSheetItem; if (!item) return; closeWordSheet(); openDetails(item); });
$('wordKnownBtn').addEventListener('click', () => { if (wordSheetItem) setBookWordKnown(!isLearned(rec(wordSheetItem.w))); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && wordSheetOpen) closeWordSheet(); });
document.addEventListener('keydown', e => {
  if (!sheetOpen) return;
  if (e.key === 'Escape') closeDetails();
  if (e.key === 'Tab') {
    const focusable = [...$('detailSheet').querySelectorAll('button, summary')];
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus({ preventScroll: true }); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus({ preventScroll: true }); }
  }
});
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
  if (!session.active || locked || sheetOpen || e.target.matches('input, select, textarea')) return;
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
