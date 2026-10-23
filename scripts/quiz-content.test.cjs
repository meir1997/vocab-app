'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { getWordContent, getPromptContext, buildChoices, normalizeHebrew } = require('../quiz-content.js');

function seeded(seed = 17) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}
function word(r, w, t) { return Object.freeze({ r, w, t }); }

test('Hebrew comparison ignores niqqud, directional marks, spacing and punctuation', () => {
  assert.equal(normalizeHebrew('  \u200fעַל־יְדֵי '), normalizeHebrew('על ידי'));
  assert.equal(normalizeHebrew('ד״ר'), normalizeHebrew('דר'));
  assert.notEqual(normalizeHebrew('ללכת'), normalizeHebrew('לשבת'));
});

test('the reviewed sense, short example and masked prompt agree with the source Hebrew', () => {
  const can = word(79, 'can', 'פַּחִית');
  const generated = { e: 'All you can do is trust one another.' };
  assert.deepEqual(getWordContent(can, generated), {
    meaning: 'פַּחִית', example: 'She opened a can of beans.',
    context: 'She opened a can of beans.', reviewed: true, ambiguous: true
  });
  assert.equal(getPromptContext(can, 'choice'), 'She opened a can of beans.');
  assert.equal(getPromptContext(can, 'reverse'), 'She opened a ____ of beans.');
  assert.equal(getPromptContext(can, 'typing'), 'She opened a ____ of beans.');
  // A changed source meaning must not inherit the old authored context.
  assert.equal(getWordContent(word(79, 'can', 'יכול'), generated).reviewed, false);
  assert.equal(getWordContent(word(79, 'can', 'יכול'), generated).example, '');
  assert.equal(getPromptContext(word(79, 'can', 'יכול'), 'choice', generated), '');
});

test('generated examples never establish Hebrew sense alignment, even with a single definition', () => {
  for (const item of [word(1, 'the', 'את'), word(8407, 'incomprehensible', 'לא מובן')]) {
    for (const detail of [null, {}, { e: 'A plausible but unverified sentence.' },
      { e: 'An unrelated sense.', d: ['n|one retained definition'] },
      { e: 'An unrelated sense.', d: ['n|first sense', 'v|second sense'] }]) {
      const content = getWordContent(item, detail);
      assert.equal(content.example, '', item.w);
      assert.equal(content.context, '', item.w);
      assert.equal(content.reviewed, false, item.w);
      for (const mode of ['choice', 'reverse', 'typing']) assert.equal(getPromptContext(item, mode, detail), '', item.w);
    }
  }
});

test('review approval is bound to the displayed primary meaning, not an alternative or matching gloss fragment', () => {
  for (const t of ['יכול; פחית', 'פחית שתיה אחרת', '']) {
    const item = word(79, 'can', t);
    const detail = { e: 'All you can do is trust one another.', d: ['v|be able'], t: 'פחית' };
    assert.equal(getWordContent(item, detail).example, '', t);
    assert.equal(getPromptContext(item, 'typing', detail), '', t);
  }
  assert.equal(getWordContent(word(79, 'CAN', '\u200fפַּחִית; יכול')).example, 'She opened a can of beans.');
});

test('for, it, as and directional right teach the displayed Hebrew sense across every surface', () => {
  const vocab = JSON.parse(readFileSync(join(__dirname, '../vocab.json'), 'utf8'));
  const expected = {
    for: ['עבור', 'This gift is for you.'],
    it: ['זה', 'What is it? It is a small bird.'],
    as: ['כמו', 'Do as I do.'],
    right: ['ימינה', 'Turn right at the next street.']
  };
  for (const [w, [meaning, example]] of Object.entries(expected)) {
    const item = vocab.find(item => item.w === w);
    const detail = { e: w === 'for' ? 'You should not give him up for lost.' : 'This is always the way it has been.' };
    const content = getWordContent(item, detail);
    assert.equal(normalizeHebrew(content.meaning), meaning, w);
    assert.equal(content.example, example, w);
    assert.equal(content.context, example, w);
    assert.equal(getPromptContext(item, 'choice', detail), example, w);
    for (const mode of ['reverse', 'typing']) {
      assert.ok(getPromptContext(item, mode, detail).includes('____'), w);
      assert.doesNotMatch(getPromptContext(item, mode, detail), new RegExp('\\b' + w + '\\b', 'i'), w);
    }
  }
});

test('all source entries use the same reviewed-only gate with loaded, missing and late details', () => {
  const vocab = JSON.parse(readFileSync(join(__dirname, '../vocab.json'), 'utf8'));
  const details = JSON.parse(readFileSync(join(__dirname, '../details.json'), 'utf8'));
  const original = JSON.stringify(details);
  for (const item of vocab) {
    const offline = getWordContent(item);
    const loaded = getWordContent(item, details[item.r]);
    assert.equal(loaded.example, offline.example, item.w);
    assert.equal(loaded.context, loaded.example, item.w);
    assert.equal(!!loaded.example, loaded.reviewed, item.w);
    const changed = { ...item, t: 'משמעות שלא נבדקה' };
    assert.equal(getWordContent(changed, details[item.r]).example, '', item.w);
    for (const mode of ['choice', 'reverse', 'typing']) {
      assert.equal(getPromptContext(item, mode, details[item.r]), getPromptContext(item, mode), item.w);
      assert.equal(getPromptContext(changed, mode, details[item.r]), '', item.w);
    }
  }
  assert.equal(JSON.stringify(details), original);
});

test('single primary labels never combine a correct sense with a distractor sense', () => {
  const target = word(1, 'light', 'אוֹר');
  const vocab = Object.freeze([
    target, word(2, 'glow', 'אור'), word(3, 'easy', 'קל'), word(4, 'bright', 'בהיר'),
    word(5, 'illumination', 'הארה'), word(6, 'shine', 'זוהר; אור'),
    word(7, 'table', 'שולחן'), word(8, 'bookcase', 'כוננית'), word(9, 'tree', 'עץ')
  ]);
  const details = Object.freeze({ 1: { s: ['illumination'] } });
  for (const mode of ['choice', 'reverse']) {
    const choices = buildChoices(target, vocab, mode, details, seeded());
    assert.equal(choices.length, 4);
    assert.deepEqual(choices.filter(value => !value.correct).map(value => value.item.w).sort(), ['bookcase', 'table', 'tree']);
    assert.equal(choices.filter(value => value.correct).length, 1);
  }
  assert.equal(getWordContent(word(10, 'example', 'ראשון; שני / שלישי')).meaning, 'ראשון');
});

test('reverse choices exclude source synonyms even when their Hebrew labels differ', () => {
  const target = word(1, 'house', 'בית');
  const vocab = Object.freeze([
    target, word(2, 'home', 'בַּיִת'), word(3, 'dwelling', 'מעון'),
    word(4, 'river', 'נהר'), word(5, 'door', 'דלת'), word(6, 'garden', 'גן')
  ]);
  const details = Object.freeze({ 1: { s: ['dwelling'] } });
  const choices = buildChoices({ ...target }, vocab, 'reverse', details, seeded());
  assert.equal(choices.length, 4);
  assert.deepEqual(choices.filter(value => !value.correct).map(value => value.label).sort(), ['door', 'garden', 'river']);
});

test('distractors cannot overlap each other, including Hebrew synonym spellings', () => {
  const target = word(1, 'tree', 'עץ');
  const vocab = Object.freeze([
    target, word(2, 'here', 'פה'), word(3, 'hither', 'כאן'),
    word(4, 'red', 'אדום'), word(5, 'crimson', 'אָדוֹם'),
    word(6, 'car', 'מכונית'), word(7, 'blue', 'כחול')
  ]);
  for (let seed = 1; seed < 50; seed++) {
    const choices = buildChoices(target, vocab, 'choice', undefined, seeded(seed));
    assert.equal(choices.length, 4);
    const labels = choices.map(value => normalizeHebrew(value.label));
    assert.equal(new Set(labels).size, labels.length);
    assert.ok(!(labels.includes('פה') && labels.includes('כאן')));
  }
});

test('small libraries return fewer safe choices and never loop to fill duplicates', () => {
  const target = word(1, 'good', 'טוֹב');
  const vocab = Object.freeze([target, word(2, 'well', 'טוב'), word(3, 'nice', 'טוֹב')]);
  assert.deepEqual(buildChoices(target, vocab, 'choice', undefined, () => 0), [
    { item: target, label: target.t, correct: true }
  ]);
});

test('every reviewed source word has an example containing its English word and a masked reverse clue', () => {
  const vocab = JSON.parse(readFileSync(join(__dirname, '../vocab.json'), 'utf8'));
  const reviewed = vocab.filter(item => getWordContent(item).reviewed);
  assert.ok(reviewed.length >= 60);
  for (const item of reviewed) {
    const content = getWordContent(item);
    assert.equal(content.meaning, item.t, item.w);
    assert.match(content.example.toLowerCase(), new RegExp('\\b' + item.w.toLowerCase() + '\\b'), item.w);
    assert.ok(getPromptContext(item, 'typing').includes('____'), item.w);
    assert.ok(!new RegExp('\\b' + item.w + '\\b', 'i').test(getPromptContext(item, 'reverse')), item.w);
  }
});

test('the full snapshot yields four distinct choices for every word, with or without offline details', () => {
  const vocab = JSON.parse(readFileSync(join(__dirname, '../vocab.json'), 'utf8'));
  const details = JSON.parse(readFileSync(join(__dirname, '../details.json'), 'utf8'));
  const original = JSON.stringify(vocab);
  const rng = seeded(20261023);
  for (const detailSource of [undefined, details]) {
    for (const item of vocab) {
      for (const mode of ['choice', 'reverse']) {
        const choices = buildChoices(item, vocab, mode, detailSource, rng);
        assert.equal(choices.length, 4, item.w);
        assert.equal(choices.filter(value => value.correct).length, 1, item.w);
        const labels = choices.map(value => mode === 'choice' ? normalizeHebrew(value.label) : value.label.toLowerCase());
        assert.equal(new Set(labels).size, 4, item.w);
      }
    }
  }
  assert.equal(JSON.stringify(vocab), original);
});
