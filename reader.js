/* Local EPUB reader for the Book tab. The imported book is stored only in this
   device's IndexedDB and is never uploaded anywhere; the hosted site ships no
   book content, only the reader code and per-word occurrence counts. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VocabReader = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const textDecoder = new TextDecoder('utf-8');

  /* ---------- Minimal ZIP reader (stored + raw-deflate entries) ---------- */
  function parseZipEntries(buffer) {
    const dv = new DataView(buffer);
    let eocd = -1;
    for (let i = dv.byteLength - 22; i >= Math.max(0, dv.byteLength - 22 - 65536); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('זה לא קובץ EPUB תקין (חתימת ZIP חסרה)');
    const count = dv.getUint16(eocd + 10, true);
    let off = dv.getUint32(eocd + 16, true);
    const entries = new Map();
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(off, true) !== 0x02014b50) throw new Error('קובץ EPUB פגום (ספרייה מרכזית)');
      const method = dv.getUint16(off + 10, true);
      const compressed = dv.getUint32(off + 20, true);
      const nameLen = dv.getUint16(off + 28, true);
      const extraLen = dv.getUint16(off + 30, true);
      const commentLen = dv.getUint16(off + 32, true);
      const localOff = dv.getUint32(off + 42, true);
      const name = textDecoder.decode(new Uint8Array(buffer, off + 46, nameLen));
      const lNameLen = dv.getUint16(localOff + 26, true);
      const lExtraLen = dv.getUint16(localOff + 28, true);
      const dataOff = localOff + 30 + lNameLen + lExtraLen;
      entries.set(name, { method, raw: new Uint8Array(buffer, dataOff, compressed) });
      off += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'undefined') {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    if (typeof require === 'function') { // Node, tests only
      return new Uint8Array(require('node:zlib').inflateRawSync(bytes));
    }
    throw new Error('הדפדפן לא תומך בפתיחת EPUB דחוס');
  }

  async function openZip(buffer) {
    if (ArrayBuffer.isView(buffer)) buffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    const entries = parseZipEntries(buffer);
    return {
      names: [...entries.keys()],
      async bytes(name) {
        const entry = entries.get(name);
        if (!entry) throw new Error('קובץ חסר בתוך ה-EPUB: ' + name);
        if (entry.method === 0) return entry.raw;
        if (entry.method === 8) return inflateRaw(entry.raw);
        throw new Error('שיטת דחיסה לא נתמכת ב-EPUB: ' + entry.method);
      },
      async text(name) { return textDecoder.decode(await this.bytes(name)); }
    };
  }

  /* ---------- EPUB structure ---------- */
  function resolvePath(base, href) {
    try { href = decodeURIComponent(href); } catch {}
    const parts = (base + href).split('/');
    const out = [];
    for (const part of parts) {
      if (part === '..') out.pop();
      else if (part !== '.' && part !== '') out.push(part);
    }
    return out.join('/');
  }

  async function loadEpub(buffer, parser) {
    const zip = await openZip(buffer);
    const container = parser.parseFromString(await zip.text('META-INF/container.xml'), 'application/xml');
    const rootfile = container.querySelector('rootfile');
    if (!rootfile) throw new Error('קובץ EPUB ללא מצביע תוכן');
    const opfPath = rootfile.getAttribute('full-path');
    const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
    const opf = parser.parseFromString(await zip.text(opfPath), 'application/xml');
    const manifest = new Map();
    opf.querySelectorAll('manifest > item').forEach(item => {
      manifest.set(item.getAttribute('id'), { href: item.getAttribute('href'), type: item.getAttribute('media-type') });
    });
    const chapters = [];
    opf.querySelectorAll('spine > itemref').forEach(ref => {
      const item = manifest.get(ref.getAttribute('idref'));
      if (item) chapters.push(resolvePath(base, item.href));
    });
    if (!chapters.length) throw new Error('לא נמצאו פרקים בקובץ');
    const title = (opf.querySelector('metadata title') || {}).textContent || 'ספר מיובא';
    let creator = (opf.querySelector('metadata creator') || {}).textContent || '';
    creator = creator.trim();
    // Some conversions stuff a chapter heading into dc:creator; hide that.
    if (/^[A-Z0-9\s.,'’-]+$/.test(creator) && /[A-Z]/.test(creator)) creator = '';
    const toc = [];
    const ncxItem = [...manifest.values()].find(item => item.type === 'application/x-dtbncx+xml');
    if (ncxItem) {
      try {
        const ncx = parser.parseFromString(await zip.text(resolvePath(base, ncxItem.href)), 'application/xml');
        ncx.querySelectorAll('navPoint').forEach(point => {
          const label = (point.querySelector('navLabel > text') || {}).textContent || '';
          const src = (point.querySelector('content') || {}).getAttribute?.('src') || '';
          const index = chapters.indexOf(resolvePath(base, src.split('#')[0]));
          if (label && index >= 0 && !toc.some(t => t.index === index)) toc.push({ label: label.trim(), index });
        });
      } catch {}
    }
    return { zip, title: title.trim(), creator, chapters, toc };
  }

  /* ---------- Sanitizer: keep reading markup, drop active/embedded content ---------- */
  const KEEP_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BR', 'HR', 'EM', 'I', 'STRONG', 'B', 'U', 'SMALL', 'SUB', 'SUP', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'DIV', 'SPAN']);
  const DROP_WITH_CONTENT = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'AUDIO', 'VIDEO', 'IMG', 'SVG', 'LINK', 'META', 'TITLE', 'HEAD', 'NOSCRIPT', 'CANVAS', 'FORM', 'INPUT', 'BUTTON']);

  // Split visible text into word and non-word tokens so every word in the
  // book can be tapped for its app card. Word cores keep inner apostrophes
  // (straight or curly) and hyphens; surrounding punctuation stays plain text.
  const BOOK_WORD_RE = /[A-Za-z]+(?:[’'\-][A-Za-z]+)*/g;
  function splitBookTokens(text) {
    const tokens = [];
    let last = 0;
    for (const m of text.matchAll(BOOK_WORD_RE)) {
      if (m.index > last) tokens.push({ text: text.slice(last, m.index), word: false });
      tokens.push({ text: m[0], word: true });
      last = m.index + m[0].length;
    }
    if (last < text.length) tokens.push({ text: text.slice(last), word: false });
    return tokens;
  }

  function sanitizeInto(sourceBody, targetDoc, wrapWords) {
    const frag = targetDoc.createDocumentFragment();
    const walk = (node, out) => {
      for (const child of node.childNodes) {
        if (child.nodeType === 3) {
          if (!wrapWords) { out.appendChild(targetDoc.createTextNode(child.nodeValue)); continue; }
          for (const token of splitBookTokens(child.nodeValue)) {
            if (!token.word) { out.appendChild(targetDoc.createTextNode(token.text)); continue; }
            const span = targetDoc.createElement('span');
            span.className = 'bw';
            span.textContent = token.text;
            out.appendChild(span);
          }
          continue;
        }
        if (child.nodeType !== 1) continue;
        if (DROP_WITH_CONTENT.has(child.tagName)) continue;
        if (KEEP_TAGS.has(child.tagName)) {
          const clean = targetDoc.createElement(child.tagName.toLowerCase());
          walk(child, clean);
          out.appendChild(clean);
        } else walk(child, out); // unwrap unknown wrappers, keep their text
      }
    };
    walk(sourceBody, frag);
    return frag;
  }

  /* ---------- Local persistence (IndexedDB + localStorage position) ---------- */
  const DB_NAME = 'vocab-reader', DB_STORE = 'book', DB_KEY = 'current';
  const POS_KEY = 'vocab-reader-position';

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function saveBookFile(record) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(record, DB_KEY);
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
  }
  async function loadBookFile() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(DB_STORE).objectStore(DB_STORE).get(DB_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }
  async function clearBookFile() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).delete(DB_KEY);
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
  }
  function savePosition(pos) { try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch {} }
  function loadPosition() { try { return JSON.parse(localStorage.getItem(POS_KEY)) || null; } catch { return null; } }

  /* ---------- Word highlights: device-local marks, never learning data ---------- */
  // A highlight id is chapter index + the word's ordinal among the chapter's
  // word spans. Rendering is deterministic, so ids survive reloads, font and
  // page changes. Like the reading position, highlights stay on this device.
  const HIL_KEY = 'vocab-reader-highlights', HIL_STAMP_KEY = 'vocab-reader-highlights-at';
  let highlights = new Set(), highlightsLoaded = false;
  function localHighlightsStamp() { try { return Number(localStorage.getItem(HIL_STAMP_KEY)) || 0; } catch { return 0; } }
  function loadHighlights() {
    highlightsLoaded = true;
    try { highlights = new Set(JSON.parse(localStorage.getItem(HIL_KEY)) || []); } catch { highlights = new Set(); }
  }
  function saveHighlights(stamp) {
    try {
      localStorage.setItem(HIL_KEY, JSON.stringify([...highlights]));
      localStorage.setItem(HIL_STAMP_KEY, String(stamp || Date.now()));
    } catch {}
  }
  function clearHighlights() { highlights = new Set(); try { localStorage.removeItem(HIL_KEY); } catch {} }
  function highlightId(index) { return `${chapterIndex}:${index}`; }
  function applyHighlights() {
    if (!els || !els.content) return;
    if (!highlightsLoaded) loadHighlights();
    els.content.querySelectorAll('.bw').forEach((span, i) => span.classList.toggle('hl', highlights.has(highlightId(i))));
  }
  function toggleWordHighlight(span) {
    if (!span || !els || !els.content) return false;
    if (!highlightsLoaded) loadHighlights();
    const index = [...els.content.querySelectorAll('.bw')].indexOf(span);
    if (index < 0) return false;
    const id = highlightId(index);
    const on = !highlights.has(id);
    if (on) highlights.add(id); else highlights.delete(id);
    span.classList.toggle('hl', on);
    saveHighlights();
    cloudSaveHighlightsList([...highlights]).catch(() => {});
    return on;
  }
  function isWordHighlighted(span) { return !!(span && span.classList && span.classList.contains('hl')); }

  /* ---------- Optional account cloud copy (signed-in users only) ---------- */
  // The book lives in the user's own Firebase account data (users/{uid}),
  // never on the public site. Everything here is a no-op when signed out.
  function bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let out = '';
    for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    return btoa(out);
  }
  function base64ToBuffer(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }
  function getFb() { try { return typeof fb !== 'undefined' ? fb : null; } catch { return null; } }
  function fbReady() { const f = getFb(); return f && f.ready && f.user && f.db; }

  async function cloudSaveBook(name, buffer, title) {
    if (!fbReady()) return false;
    const f = getFb();
    const data = { name, title: title || '', b64: bufferToBase64(buffer), addedAt: Date.now() };
    const userDoc = f.db.collection('users').doc(f.user.uid);
    try { await userDoc.collection('books').doc('main').set(data); return true; }
    catch { return false; }
  }

  async function cloudLoadBook() {
    if (!fbReady()) return null;
    const f = getFb();
    const userDoc = f.db.collection('users').doc(f.user.uid);
    try {
      const snap = await userDoc.collection('books').doc('main').get();
      if (snap.exists && snap.data().b64) return snap.data();
    } catch {}
    return null;
  }

  async function cloudClearBook() {
    if (!fbReady()) return;
    const f = getFb();
    const userDoc = f.db.collection('users').doc(f.user.uid);
    try { await userDoc.collection('books').doc('main').delete(); } catch {}
  }

  // Highlights ride the account too, as a small separate doc so a toggle
  // never rewrites the book blob.
  async function cloudSaveHighlightsList(list) {
    if (!fbReady()) return false;
    const f = getFb();
    const userDoc = f.db.collection('users').doc(f.user.uid);
    try { await userDoc.collection('books').doc('highlights').set({ list, updatedAt: Date.now() }); return true; }
    catch { return false; }
  }
  async function cloudLoadHighlightsDoc() {
    if (!fbReady()) return null;
    const f = getFb();
    const userDoc = f.db.collection('users').doc(f.user.uid);
    try {
      const snap = await userDoc.collection('books').doc('highlights').get();
      if (snap.exists) return snap.data();
    } catch {}
    return null;
  }
  async function cloudClearHighlights() {
    if (!fbReady()) return;
    const f = getFb();
    const userDoc = f.db.collection('users').doc(f.user.uid);
    try { await userDoc.collection('books').doc('highlights').delete(); } catch {}
  }
  // Last write wins on the whole list, so a mark removed on one device stays
  // removed everywhere; an empty cloud copy is seeded from this device (that
  // is also how marks made before sync existed migrate up).
  async function syncHighlightsFromCloud() {
    if (!highlightsLoaded) loadHighlights();
    if (await waitForSyncAuth(3000) === false) return;
    const remote = await cloudLoadHighlightsDoc();
    if (remote === null) {
      if (highlights.size) cloudSaveHighlightsList([...highlights]).catch(() => {});
      return;
    }
    const remoteStamp = remote.updatedAt || 0;
    const remoteList = Array.isArray(remote.list) ? remote.list : [];
    if (remoteStamp > localHighlightsStamp()) {
      highlights = new Set(remoteList);
      saveHighlights(remoteStamp);
      applyHighlights();
    } else if (JSON.stringify([...highlights]) !== JSON.stringify(remoteList)) {
      cloudSaveHighlightsList([...highlights]).catch(() => {});
    }
  }

  async function waitForSyncAuth(ms) {
    const start = Date.now();
    while (Date.now() - start < ms) {
      if (fbReady()) return true;
      await new Promise(r => setTimeout(r, 200));
    }
    return fbReady();
  }

  /* ---------- Book tab controller (browser only) ---------- */
  let book = null, chapterIndex = 0, fontScale = 1, initialized = false, els = null;

  function $(id) { return document.getElementById(id); }

  function chapterLabel(i) {
    const hit = book && book.toc.find(t => t.index === i);
    return (hit && hit.label) || `קטע ${i + 1}`;
  }

  /* ---------- Paged layout: one screen per page, turned with arrows ---------- */
  const PAGE_GAP = 48; // wider than the viewport side padding, so the next page never peeks into the gutter
  let pageIndex = 0, pageCount = 1, pageAdvance = 0;

  function layoutPages() {
    const content = els.content;
    const width = content.clientWidth;
    if (width <= 0) return; // hidden tab; relaid out when the tab shows
    content.style.columnWidth = width + 'px';
    content.style.columnGap = PAGE_GAP + 'px';
    pageAdvance = width + PAGE_GAP;
    pageCount = Math.max(1, Math.ceil(content.scrollWidth / pageAdvance));
    pageIndex = Math.min(Math.max(0, pageIndex), pageCount - 1);
    showPage();
  }

  let slideTimer = null;
  function showPage() {
    els.content.style.transform = `translateX(${-pageIndex * pageAdvance}px)`;
    els.pageInfo.textContent = `עמוד ${pageIndex + 1} מתוך ${pageCount}`;
    // While the strip slides, moving words must not catch taps meant as
    // page turns; re-enable them once the page settles.
    els.content.classList.add('sliding');
    clearTimeout(slideTimer);
    slideTimer = setTimeout(() => els.content.classList.remove('sliding'), 200);
  }

  function goToPage(i) {
    pageIndex = Math.min(Math.max(0, i), pageCount - 1);
    showPage();
    persistPosition();
  }

  function pageRatio() { return pageCount > 1 ? pageIndex / (pageCount - 1) : 0; }

  async function renderChapter(index, startPage) {
    chapterIndex = index;
    els.chapter.value = String(index);
    const content = els.content;
    content.innerHTML = '<p class="book-loading">טוען…</p>';
    const raw = await book.zip.text(book.chapters[index]);
    const doc = new DOMParser().parseFromString(raw, 'text/html');
    const frag = sanitizeInto(doc.body || doc, document, true);
    content.replaceChildren(frag);
    if (!content.textContent.trim()) content.innerHTML = '<p class="book-loading">(הקטע ריק או מכיל תמונה בלבד)</p>';
    applyHighlights();
    pageIndex = 0;
    layoutPages();
    if (Number.isInteger(startPage) && startPage > 0) pageIndex = Math.min(startPage, pageCount - 1);
    showPage();
    persistPosition();
  }

  function persistPosition() {
    if (!book) return;
    savePosition({ chapter: chapterIndex, page: pageIndex, font: fontScale });
  }

  function applyFont() {
    els.content.style.fontSize = `${Math.round(fontScale * 100)}%`;
    layoutPages();
  }

  function showLoaded() {
    els.empty.classList.add('hidden');
    els.loaded.classList.remove('hidden');
    document.body.classList.add('reading');
    els.title.textContent = book.title;
    els.readerTitle.textContent = book.title;
    els.author.textContent = book.creator || '';
    els.author.classList.toggle('hidden', !book.creator);
    const select = els.chapter;
    select.replaceChildren();
    book.chapters.forEach((_, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = chapterLabel(i);
      select.append(opt);
    });
  }

  // Front matter (cover, title page) is often an image-only or near-empty
  // segment; a fresh open skips those, but keeps any short REAL opening text.
  // A saved position always wins, so a deliberate choice (even the cover) is
  // never overridden, and every section stays reachable in the selector.
  const MIN_READABLE_CHARS = 50;
  async function firstReadableChapter() {
    const limit = Math.min(book.chapters.length, 10);
    for (let i = 0; i < limit; i++) {
      try {
        const raw = await book.zip.text(book.chapters[i]);
        const doc = new DOMParser().parseFromString(raw, 'text/html');
        if (sanitizeInto(doc.body || doc, document).textContent.trim().length >= MIN_READABLE_CHARS) return i;
      } catch {}
    }
    return 0;
  }

  async function openBook(buffer) {
    book = await loadEpub(buffer, new DOMParser());
    const pos = loadPosition();
    fontScale = pos && typeof pos.font === 'number' ? Math.min(1.6, Math.max(0.8, pos.font)) : 1;
    const start = pos && Number.isInteger(pos.chapter) && pos.chapter >= 0 && pos.chapter < book.chapters.length ? pos.chapter : await firstReadableChapter();
    showLoaded();
    applyFont();
    await renderChapter(start);
    if (pos && start === pos.chapter) {
      if (Number.isInteger(pos.page) && pos.page > 0) goToPage(pos.page);
      else if (pos.ratio > 0) goToPage(Math.round(pos.ratio * (pageCount - 1))); // scroll-era saves
    }
  }

  async function importFile(file) {
    els.error.textContent = '';
    try {
      const buffer = await file.arrayBuffer();
      localStorage.removeItem(POS_KEY); // a fresh import starts at its own beginning
      clearHighlights();
      cloudSaveHighlightsList([]).catch(() => {});
      await openBook(buffer); // validate before persisting
      await saveBookFile({ name: file.name, buffer });
      cloudSaveBook(file.name, buffer, book && book.title).catch(() => {});
    } catch (err) {
      book = null;
      els.error.textContent = (err && err.message) || 'הקובץ לא נפתח. ודאו שזה קובץ EPUB תקין.';
    }
  }

  async function removeBook() {
    await clearBookFile();
    cloudClearBook().catch(() => {});
    cloudClearHighlights().catch(() => {});
    localStorage.removeItem(POS_KEY);
    clearHighlights();
    book = null;
    document.body.classList.remove('reading');
    els.loaded.classList.add('hidden');
    els.empty.classList.remove('hidden');
    els.pageInfo.textContent = '';
    els.file.value = '';
  }

  function initBookTab() {
    if (initialized || typeof document === 'undefined') return;
    initialized = true;
    els = {
      empty: $('bookEmpty'), loaded: $('bookLoaded'), title: $('bookTitle'), author: $('bookAuthor'),
      chapter: $('bookChapter'), content: $('bookContent'), error: $('bookError'),
      importBtn: $('bookImportBtn'), removeBtn: $('bookRemoveBtn'), file: $('bookFile'),
      fontUp: $('bookFontUp'), fontDown: $('bookFontDown'),
      pageInfo: $('bookPageInfo'), viewport: $('bookViewport'),
      closeBtn: $('readerClose'), menuBtn: $('readerMenu'), panel: $('readerPanel'), readerTitle: $('readerTitle')
    };
    els.importBtn.addEventListener('click', () => els.file.click());
    els.file.addEventListener('change', e => { if (e.target.files[0]) importFile(e.target.files[0]); });
    els.removeBtn.addEventListener('click', () => { if (confirm('להסיר את הספר מהמכשיר?')) removeBook(); });
    els.chapter.addEventListener('change', e => renderChapter(Number(e.target.value)));
    // Immersive reading: X leaves the book, the menu toggles the controls
    // panel, and pages turn by tapping the outer edges of the page (or the
    // arrow keys). Taps on words are the app's clickable-word feature.
    els.closeBtn.addEventListener('click', () => {
      document.body.classList.remove('reading');
      els.panel.classList.add('hidden');
      if (typeof switchTab === 'function') switchTab('practice');
    });
    els.menuBtn.addEventListener('click', () => {
      const open = els.panel.classList.toggle('hidden');
      els.menuBtn.setAttribute('aria-expanded', open ? 'false' : 'true');
    });
    // Long-press (hold ~550ms) on a word toggles its highlight without
    // opening the word sheet; a plain tap still opens the sheet (app.js).
    let pressTimer = null, pressX = 0, pressY = 0;
    els.content.addEventListener('pointerdown', e => {
      const span = e.target.closest('.bw');
      if (!span) return;
      pressX = e.clientX; pressY = e.clientY;
      clearTimeout(pressTimer);
      pressTimer = setTimeout(() => {
        pressTimer = null;
        toggleWordHighlight(span);
        window.bookSuppressWordTapUntil = Date.now() + 700;
      }, 550);
    });
    els.content.addEventListener('pointermove', e => {
      if (pressTimer && Math.hypot(e.clientX - pressX, e.clientY - pressY) > 10) { clearTimeout(pressTimer); pressTimer = null; }
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(type => els.content.addEventListener(type, () => { clearTimeout(pressTimer); pressTimer = null; }));
    els.viewport.addEventListener('click', e => {
      if (e.target.closest('.bw')) return;
      if (!els.panel.classList.contains('hidden')) {
        els.panel.classList.add('hidden');
        els.menuBtn.setAttribute('aria-expanded', 'false');
        return;
      }
      const r = els.viewport.getBoundingClientRect();
      const f = (e.clientX - r.left) / r.width;
      if (f < 0.22) goToPage(pageIndex - 1);
      else if (f > 0.78) goToPage(pageIndex + 1);
    });
    document.addEventListener('keydown', e => {
      if (!document.body.classList.contains('reading')) return;
      if (e.target.matches('input, select, textarea')) return;
      if (typeof sheetOpen !== 'undefined' && sheetOpen) return;
      if (typeof wordSheetOpen !== 'undefined' && wordSheetOpen) return;
      if (e.key === 'ArrowRight') goToPage(pageIndex + 1);
      else if (e.key === 'ArrowLeft') goToPage(pageIndex - 1);
    });
    els.fontUp.addEventListener('click', () => { const r = pageRatio(); fontScale = Math.min(1.6, fontScale + 0.1); applyFont(); goToPage(Math.round(r * (pageCount - 1))); });
    els.fontDown.addEventListener('click', () => { const r = pageRatio(); fontScale = Math.max(0.8, fontScale - 0.1); applyFont(); goToPage(Math.round(r * (pageCount - 1))); });
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      if (!book || els.loaded.classList.contains('hidden')) return;
      const r = pageRatio();
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { layoutPages(); goToPage(Math.round(r * (pageCount - 1))); }, 150);
    });
  }

  async function showBookTab() {
    initBookTab();
    if (book) { document.body.classList.add('reading'); layoutPages(); syncHighlightsFromCloud().catch(() => {}); return; }
    let record = null;
    try { record = await loadBookFile(); } catch {}
    if (record && record.buffer) {
      try { await openBook(record.buffer); syncHighlightsFromCloud().catch(() => {}); return; }
      catch { els.loaded.classList.add('hidden'); els.empty.classList.remove('hidden'); els.error.textContent = 'הספר השמור לא נפתח. ייבאו אותו שוב.'; return; }
    }
    // No local copy: restore from the signed-in account's cloud copy.
    if (await waitForSyncAuth(3000)) {
      try {
        const data = await cloudLoadBook();
        if (data && data.b64) {
          const buffer = base64ToBuffer(data.b64);
          await openBook(buffer);
          saveBookFile({ name: data.name || 'book.epub', buffer }).catch(() => {});
          syncHighlightsFromCloud().catch(() => {});
        }
      } catch {}
    }
  }

  return { parseZipEntries, inflateRaw, openZip, loadEpub, sanitizeInto, splitBookTokens, initBookTab, showBookTab,
    bufferToBase64, base64ToBuffer, cloudSaveBook, cloudLoadBook, cloudClearBook,
    toggleWordHighlight, isWordHighlighted, applyHighlights, clearHighlights,
    cloudSaveHighlightsList, cloudLoadHighlightsDoc, cloudClearHighlights, syncHighlightsFromCloud,
    _state: () => ({ book, chapterIndex, fontScale, highlights: [...highlights] }) };
});
