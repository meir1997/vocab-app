const SHEET_CSV = 'https://docs.google.com/spreadsheets/d/1YuNV-TcC_tITIe-SGTzTh-dKTlx4H84-4feTzAM2k4M/export?format=csv&gid=0';
const CACHE_KEY = 'fourWords.vocab.v1';
const PROGRESS_KEY = 'fourWords.progress.v1';
const SETTINGS_KEY = 'fourWords.settings.v1';
const FALLBACK = [
  ['the','ה־ / ה'],['be','להיות'],['and','ו־ / וגם'],['of','של'],['a','אחד / ה'],
  ['to','אל / ל־'],['in','בתוך / ב־'],['have','יש / להחזיק'],['it','זה'],['you','אתה / את']
].map(([word,translation]) => ({word, translation}));

const $ = (id) => document.getElementById(id);
const els = Object.fromEntries(['quizCard','summary','word','hint','answers','dontKnowBtn','progressText','progressBar','learnedStat','accuracyStat','streakStat','summaryText','againBtn','helpBtn','helpDialog','closeHelp','sessionBtn','sessionDialog','closeSession','sourceNote'].map(id => [id, $(id)]));

let vocab = [];
let queue = [];
let current = null;
let locked = false;
let session = { index: 0, correct: 0, wrong: 0, streak: 0 };
let settings = readJSON(SETTINGS_KEY, { length: 20 });
let progress = readJSON(PROGRESS_KEY, { seen: {}, correct: 0, attempts: 0 });

function readJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; }
}

function parseCSV(text) {
  const rows = []; let row = []; let cell = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  return rows;
}

function normalizeRows(rows) {
  const seen = new Set();
  return rows.slice(1).map(r => ({ word: (r[2] || '').trim(), translation: (r[8] || '').trim() }))
    .filter(item => item.word && item.translation && !seen.has(item.word.toLowerCase()) && seen.add(item.word.toLowerCase()));
}

async function loadVocabulary() {
  const cached = readJSON(CACHE_KEY, null);
  if (Array.isArray(cached) && cached.length > 100) vocab = cached;
  try {
    const response = await fetch(SHEET_CSV, { cache: 'no-store' });
    if (!response.ok) throw new Error('sheet unavailable');
    const fresh = normalizeRows(parseCSV(await response.text()));
    if (fresh.length <= 100) throw new Error('invalid sheet data');
    vocab = fresh; localStorage.setItem(CACHE_KEY, JSON.stringify(fresh));
  } catch {
    if (!vocab.length) { vocab = FALLBACK; els.sourceNote.textContent = 'מצב אופליין — מוצגות מילות תרגול בסיסיות'; }
  }
  startSession();
}

function shuffled(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; }
  return copy;
}

function buildQueue() {
  const weighted = vocab.map(item => {
    const p = progress.seen[item.word] || { right: 0, wrong: 0 };
    return { item, priority: Math.random() + p.wrong * 1.7 - p.right * .18 };
  }).sort((a,b) => b.priority - a.priority);
  return weighted.slice(0, Math.min(settings.length, weighted.length)).map(x => x.item);
}

function startSession() {
  queue = buildQueue();
  session = { index: 0, correct: 0, wrong: 0, streak: 0 };
  els.quizCard.classList.remove('hidden'); els.summary.classList.add('hidden');
  els.sessionBtn.textContent = `${settings.length} מילים`;
  showQuestion(); updateStats();
}

function showQuestion() {
  locked = false; current = queue[session.index];
  if (!current) return finishSession();
  els.word.textContent = current.word;
  els.hint.textContent = 'בחרו את התשובה הנכונה';
  els.progressText.textContent = `מילה ${session.index + 1} מתוך ${queue.length}`;
  els.progressBar.style.width = `${(session.index / queue.length) * 100}%`;
  els.answers.replaceChildren();
  const distractors = shuffled(vocab.filter(v => v.translation !== current.translation)).slice(0, 3).map(v => v.translation);
  shuffled([current.translation, ...distractors]).forEach(text => {
    const button = document.createElement('button');
    button.className = 'answer'; button.textContent = text;
    button.addEventListener('click', () => answer(text === current.translation, button));
    els.answers.append(button);
  });
}

function answer(isCorrect, selected) {
  if (locked) return; locked = true;
  const record = progress.seen[current.word] || { right: 0, wrong: 0 };
  progress.attempts++; els.answers.querySelectorAll('button').forEach(b => { b.disabled = true; if (b.textContent === current.translation) b.classList.add(isCorrect ? 'correct' : 'reveal'); });
  if (isCorrect) {
    session.correct++; session.streak++; progress.correct++; record.right++;
    selected.classList.add('correct'); els.hint.textContent = 'מעולה — תשובה נכונה!';
  } else {
    session.wrong++; session.streak = 0; record.wrong++;
    if (selected) selected.classList.add('wrong'); els.hint.textContent = `התשובה: ${current.translation}`;
  }
  progress.seen[current.word] = record; localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress)); updateStats();
  window.setTimeout(() => { session.index++; showQuestion(); }, 1050);
}

function finishSession() {
  els.quizCard.classList.add('hidden'); els.summary.classList.remove('hidden');
  const pct = Math.round((session.correct / Math.max(1, queue.length)) * 100);
  els.summaryText.textContent = `ענית נכון על ${session.correct} מתוך ${queue.length} מילים — ${pct}% הצלחה.`;
}

function updateStats() {
  els.learnedStat.textContent = Object.values(progress.seen).filter(x => x.right >= 2).length;
  els.accuracyStat.textContent = progress.attempts ? `${Math.round(progress.correct / progress.attempts * 100)}%` : '—';
  els.streakStat.textContent = session.streak;
}

els.dontKnowBtn.addEventListener('click', () => answer(false, null));
els.againBtn.addEventListener('click', startSession);
els.helpBtn.addEventListener('click', () => els.helpDialog.showModal());
els.closeHelp.addEventListener('click', () => els.helpDialog.close());
els.sessionBtn.addEventListener('click', () => els.sessionDialog.showModal());
els.closeSession.addEventListener('click', () => els.sessionDialog.close());
document.querySelectorAll('[data-length]').forEach(button => button.addEventListener('click', () => {
  settings.length = Number(button.dataset.length); localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  els.sessionDialog.close(); startSession();
}));
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js'));
loadVocabulary();
