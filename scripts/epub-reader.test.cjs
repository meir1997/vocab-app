// Run with: node --test scripts/epub-reader.test.cjs
// Unit coverage for the dependency-free EPUB/ZIP parsing used by the Book tab.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildZip, buildTestEpub } = require('./epub-fixture.cjs');
const path = require('node:path');
const reader = require(path.resolve(__dirname, '..', 'reader.js'));

test('zip parser reads stored and deflated entries by name', async () => {
  const zip = await reader.openZip(buildZip([
    { name: 'plain.txt', content: 'hello world' },
    { name: 'dir/compressed.txt', content: 'compressed content '.repeat(50), compress: true }
  ]));
  assert.equal(await zip.text('plain.txt'), 'hello world');
  assert.equal(await zip.text('dir/compressed.txt'), 'compressed content '.repeat(50));
  assert.deepEqual(zip.names.sort(), ['dir/compressed.txt', 'plain.txt']);
  await assert.rejects(() => zip.text('missing.txt'), /missing/);
});

test('zip parser rejects non-zip buffers with a Hebrew error', async () => {
  await assert.rejects(() => reader.openZip(Buffer.from('not a zip file at all')), /EPUB/);
});

// Minimal DOMParser shim backed by regex-free parsing is out of scope for Node;
// loadEpub structure is covered end-to-end in scripts/reader-browser.test.cjs.
// Here we cover resolvePath-driven chapter resolution through a DOMParser stub.
test('loadEpub resolves spine paths relative to the OPF location', async () => {
  const epub = buildTestEpub();
  const { DOMParser } = await tryLinkedom();
  const book = await reader.loadEpub(epub, new DOMParser());
  assert.equal(book.title, 'Fixture Book');
  assert.equal(book.creator, 'Fixture Author');
  assert.deepEqual(book.chapters, ['OEBPS/ch1.xhtml', 'OEBPS/ch2.xhtml']);
  assert.deepEqual(book.toc, [{ label: 'Beginning', index: 0 }, { label: 'Middle', index: 1 }]);
  const ch1 = await book.zip.text(book.chapters[0]);
  assert.match(ch1, /The Beginning/);
});

async function tryLinkedom() {
  try { return require('linkedom'); } catch {}
  return { DOMParser: MiniParser };
}

// Tiny DOMParser fallback good enough for the well-formed fixture XML above.
class MiniDoc {
  constructor(text) { this.text = text; }
  querySelector(sel) {
    if (sel === 'rootfile') {
      const m = this.text.match(/<rootfile[^>]*full-path="([^"]+)"/);
      return m ? { getAttribute: () => m[1] } : null;
    }
    if (sel === 'metadata title' || sel === 'metadata creator') {
      const tag = sel.split(' ')[1];
      const m = this.text.match(new RegExp(`<dc:${tag}[^>]*>([^<]*)</dc:${tag}>`));
      return m ? { textContent: m[1] } : null;
    }
    if (sel === 'navLabel > text') return null;
    return null;
  }
  querySelectorAll(sel) {
    const text = this.text;
    const items = [];
    if (sel === 'manifest > item') {
      for (const m of text.matchAll(/<item\s+([^>]+?)\/?>(?:<\/item>)?/g)) {
        const attrs = Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(a => [a[1], a[2]]));
        items.push({ getAttribute: k => attrs[k] ?? null });
      }
    } else if (sel === 'spine > itemref') {
      for (const m of text.matchAll(/<itemref\s+([^>]+?)\/?>/g)) {
        const attrs = Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(a => [a[1], a[2]]));
        items.push({ getAttribute: k => attrs[k] ?? null });
      }
    } else if (sel === 'navPoint') {
      for (const m of text.matchAll(/<navPoint[\s\S]*?<text>([^<]*)<\/text>[\s\S]*?src="([^"]*)"[\s\S]*?<\/navPoint>/g)) {
        items.push({
          querySelector: s2 => s2 === 'navLabel > text' ? { textContent: m[1] } : s2 === 'content' ? { getAttribute: () => m[2] } : null
        });
      }
    }
    return items;
  }
}
class MiniParser {
  parseFromString(text) { return new MiniDoc(text); }
}
