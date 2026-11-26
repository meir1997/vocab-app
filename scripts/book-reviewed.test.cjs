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

test('book examples use the card word or a known inflection', () => {
  const irregular = {
    threequarters: ['three-quarters'],
    hoof: ['hooves'],
    freeze: ['froze', 'frozen'],
    unstick: ['unstuck'],
    slink: ['slunk'],
    overhear: ['overheard'],
    weave: ['wove', 'woven'],
    stink: ['stank', 'stunk'],
    tapdance: ['tap-danced', 'tap-dancing'],
    wring: ['wrung']
  };
  const forms = word => {
    const out = new Set([word, ...(irregular[word] || [])]);
    if (word.endsWith('e')) {
      out.add(word.slice(0, -1) + 'ing');
      out.add(word + 'd');
    }
    if (word.endsWith('y') && !/[aeiou]y$/.test(word)) {
      out.add(word.slice(0, -1) + 'ies');
      out.add(word.slice(0, -1) + 'ied');
    }
    if (/(s|x|z|ch|sh)$/.test(word)) out.add(word + 'es');
    if (/[^aeiou][aeiou][bcdfgklmnprstz]$/.test(word)) {
      out.add(word + word.at(-1) + 'ed');
      out.add(word + word.at(-1) + 'ing');
    }
    out.add(word + 's');
    out.add(word + 'ed');
    out.add(word + 'ing');
    return [...out];
  };
  for (const card of cards) {
    const content = BookContent.getWordContent(card);
    const text = ` ${content.example.toLowerCase().replace(/-/g, ' ').replace(/[^a-z' ]+/g, ' ')} `;
    assert.ok(
      forms(card.w).some(form => text.includes(` ${form.replace(/-/g, ' ')} `)),
      `${card.w}: example does not use the card word: ${content.example}`
    );
  }
});

test('swish entries do not use the unrelated Hebrew slang sense', () => {
  const swish = BookContent.getWordContent({ w: 'swish', t: 'להשמיע שריקה בתנועה' });
  assert.equal(swish.reviewed, true);
  assert.equal(swish.meaning, 'להשמיע שריקה בתנועה');
  assert.equal(swish.example, 'The stick swished through the air.');
  const swishy = BookContent.getWordContent({ w: 'swishy', t: 'מְרַשְׁרֵשׁ' });
  assert.equal(swishy.reviewed, true);
  assert.equal(swishy.meaning, 'מְרַשְׁרֵשׁ');
  assert.equal(swishy.example, 'The swishy skirt moved softly.');
});
