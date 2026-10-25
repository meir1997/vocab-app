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

  function sanitizeInto(sourceBody, targetDoc) {
    const frag = targetDoc.createDocumentFragment();
    const walk = (node, out) => {
      for (const child of node.childNodes) {
        if (child.nodeType === 3) { out.appendChild(targetDoc.createTextNode(child.nodeValue)); continue; }
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

  async function renderChapter(index, keepScroll) {
    chapterIndex = index;
    const content = els.content;
    content.innerHTML = '<p class="book-loading">טוען…</p>';
    const raw = await book.zip.text(book.chapters[index]);
    const doc = new DOMParser().parseFromString(raw, 'text/html');
    const frag = sanitizeInto(doc.body || doc, document);
    content.replaceChildren(frag);
    if (!content.textContent.trim()) content.innerHTML = '<p class="book-loading">(הקטע ריק או מכיל תמונה בלבד)</p>';
    els.chapter.value = String(index);
    if (!keepScroll) content.scrollTop = 0;
    persistPosition();
  }

  function persistPosition() {
    if (!book) return;
    savePosition({ chapter: chapterIndex, ratio: els.content.scrollHeight > 0 ? els.content.scrollTop / els.content.scrollHeight : 0, font: fontScale });
  }

  function applyFont() {
    els.content.style.fontSize = `${Math.round(fontScale * 100)}%`;
  }

  function showLoaded() {
    els.empty.classList.add('hidden');
    els.loaded.classList.remove('hidden');
    els.title.textContent = book.title;
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

  async function openBook(buffer) {
    book = await loadEpub(buffer, new DOMParser());
    showLoaded();
    const pos = loadPosition();
    fontScale = pos && typeof pos.font === 'number' ? Math.min(1.6, Math.max(0.8, pos.font)) : 1;
    applyFont();
    const start = pos && Number.isInteger(pos.chapter) && pos.chapter >= 0 && pos.chapter < book.chapters.length ? pos.chapter : 0;
    await renderChapter(start);
    if (pos && start === pos.chapter && pos.ratio > 0) {
      els.content.scrollTop = Math.round(pos.ratio * els.content.scrollHeight);
    }
  }

  async function importFile(file) {
    els.error.textContent = '';
    try {
      const buffer = await file.arrayBuffer();
      localStorage.removeItem(POS_KEY); // a fresh import starts at its own beginning
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
    localStorage.removeItem(POS_KEY);
    book = null;
    els.loaded.classList.add('hidden');
    els.empty.classList.remove('hidden');
    els.file.value = '';
  }

  function initBookTab() {
    if (initialized || typeof document === 'undefined') return;
    initialized = true;
    els = {
      empty: $('bookEmpty'), loaded: $('bookLoaded'), title: $('bookTitle'), author: $('bookAuthor'),
      chapter: $('bookChapter'), content: $('bookContent'), error: $('bookError'),
      importBtn: $('bookImportBtn'), removeBtn: $('bookRemoveBtn'), file: $('bookFile'),
      fontUp: $('bookFontUp'), fontDown: $('bookFontDown')
    };
    els.importBtn.addEventListener('click', () => els.file.click());
    els.file.addEventListener('change', e => { if (e.target.files[0]) importFile(e.target.files[0]); });
    els.removeBtn.addEventListener('click', () => { if (confirm('להסיר את הספר מהמכשיר?')) removeBook(); });
    els.chapter.addEventListener('change', e => renderChapter(Number(e.target.value)));
    els.fontUp.addEventListener('click', () => { fontScale = Math.min(1.6, fontScale + 0.1); applyFont(); persistPosition(); });
    els.fontDown.addEventListener('click', () => { fontScale = Math.max(0.8, fontScale - 0.1); applyFont(); persistPosition(); });
    let scrollTimer = null;
    els.content.addEventListener('scroll', () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(persistPosition, 400);
    });
  }

  async function showBookTab() {
    initBookTab();
    if (book) return;
    let record = null;
    try { record = await loadBookFile(); } catch {}
    if (record && record.buffer) {
      try { await openBook(record.buffer); return; }
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
        }
      } catch {}
    }
  }

  return { parseZipEntries, inflateRaw, openZip, loadEpub, sanitizeInto, initBookTab, showBookTab,
    bufferToBase64, base64ToBuffer, cloudSaveBook, cloudLoadBook, cloudClearBook,
    _state: () => ({ book, chapterIndex, fontScale }) };
});
