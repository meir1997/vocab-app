// Run with: node --test scripts/book-reviewed.test.cjs
// Every book-coverage card must have a reviewed Hebrew sense plus example, and
// the stored sense must pass the same gate quiz-content.js applies to REVIEWED.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const BookContent = require(path.resolve(__dirname, '..', 'book-reviewed.js'));
const cards = require(path.resolve(__dirname, '..', 'book-vocab.json'));

test('every book card has a gate-passing reviewed example', () => {
  assert.ok(cards.length > 1100, 'book cards present');
  for (const card of cards) {
    const content = BookContent.getWordContent({ w: card.w, t: card.t });
    assert.ok(content.example, `${card.w}: missing example`);
    assert.equal(content.reviewed, true, `${card.w}: sense gate rejected its entry`);
    assert.ok(content.meaning, `${card.w}: empty meaning`);
  }
});

test('a wrong stored sense is rejected by the gate', () => {
  const content = BookContent.getWordContent({ w: 'astonishing', t: 'מַדְהִים' });
  assert.equal(content.reviewed, false);
  assert.equal(content.example, '');
});

test('normalized keys match hyphenated card words', () => {
  const hyphenated = cards.filter(c => c.w.includes('-'));
  assert.ok(hyphenated.length > 30, 'hyphenated cards exist');
  for (const card of hyphenated) {
    assert.ok(BookContent.getWordContent({ w: card.w, t: card.t }).example, `${card.w}: key lookup failed`);
  }
});
