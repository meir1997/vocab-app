// Run with: node --test scripts/book-lookup.test.cjs
// Coverage for the Book tab word lookup: inflections resolve to the base card,
// derivational forms resolve only to adjective cards (never a wrong-POS gloss),
// and words already in the library always win by exact match.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { lookupBookWord } = require(path.resolve(__dirname, '..', 'book-lookup.js'));

const word = r => ({ r });
const library = new Map(Object.entries({
  grab: word(1), dive: word(2), slam: word(3), crane: word(4), brave: word(5),
  tall: word(6), thin: word(7), big: word(8), red: word(9), nice: word(10),
  gloomy: word(11), normal: word(12), possible: word(13), humble: word(14),
  basic: word(15), sleepy: word(16), black: word(17), slow: word(18),
  fixed: word(19), bid: word(20), longing: word(21), stiff: word(22),
  ginger: word(23), order: word(24), bell: word(25), on: word(26),
  fore: word(27), hone: word(28), ear: word(29), late: word(30),
  belly: word(31), only: word(32), early: word(33), forest: word(34),
  honest: word(35), cover: word(36), butter: word(37), water: word(38),
  ally: word(39), best: word(40), sly: word(41), that: word(42), must: word(43),
  wizard: word(44), sorcerer: word(45), potion: word(46),
}));
// POS as shipped in word-pos.json; note 'fixed', 'stiff', 'order', 'on', 'fore',
// 'ear', 'bid', 'that', 'must', 'grab', 'dive', 'slam' deliberately lack 'a'.
const pos = {
  brave: 'a', tall: 'a', thin: 'a', big: 'a', red: 'a', nice: 'a', gloomy: 'a',
  normal: 'a', possible: 'a', humble: 'a', basic: 'a', sleepy: 'a', black: 'a',
  slow: 'a', late: 'a', belly: 'n', early: 'a', forest: 'n', honest: 'a',
  cover: 'v', butter: 'n', water: 'n', ginger: 'n', order: 'n', bell: 'n',
  fore: 'n', ear: 'n', ally: 'n', best: 'a', sly: 'a', fixed: 'v', stiff: 'a',
  longing: 'v', wizard: 'n', sorcerer: 'n', potion: 'n',
};

test('inflections resolve to their base card', () => {
  assert.equal(lookupBookWord('grabbed', library, pos).r, 1);
  assert.equal(lookupBookWord('slammed', library, pos).r, 3);
  assert.equal(lookupBookWord('dived', library, pos).r, 2);
  assert.equal(lookupBookWord('craning', library, pos).r, 4);
  assert.equal(lookupBookWord('cropping', library, pos) === null, true); // crop not in library
  assert.equal(lookupBookWord('wizards', library, pos).r, 44);
  assert.equal(lookupBookWord("sorcerer's", library, pos).r, 45);
  assert.equal(lookupBookWord('potions', library, pos).r, 46);
});

test('contractions resolve to their base card', () => {
  assert.equal(lookupBookWord("that'll", library, pos).r, 42);
  assert.equal(lookupBookWord("must've", library, pos).r, 43);
});

test('comparative, superlative, adverb and -ness forms resolve to adjective cards', () => {
  assert.equal(lookupBookWord('braver', library, pos).r, 5);
  assert.equal(lookupBookWord('tallest', library, pos).r, 6);
  assert.equal(lookupBookWord('thinner', library, pos).r, 7);
  assert.equal(lookupBookWord('bigger', library, pos).r, 8);
  assert.equal(lookupBookWord('redder', library, pos).r, 9);
  assert.equal(lookupBookWord('nicer', library, pos).r, 10);
  assert.equal(lookupBookWord('gloomily', library, pos).r, 11);
  assert.equal(lookupBookWord('normally', library, pos).r, 12);
  assert.equal(lookupBookWord('possibly', library, pos).r, 13);
  assert.equal(lookupBookWord('humbly', library, pos).r, 14);
  assert.equal(lookupBookWord('basically', library, pos).r, 15);
  assert.equal(lookupBookWord('sleepiness', library, pos).r, 16);
  assert.equal(lookupBookWord('blackness', library, pos).r, 17);
  assert.equal(lookupBookWord('slowly', library, pos).r, 18);
});

test('counterexamples never resolve to a wrong-POS card', () => {
  assert.equal(lookupBookWord('gingerly', library, pos), null);   // ginger is a noun
  assert.equal(lookupBookWord('orderly', library, pos), null);    // order is a noun
  assert.equal(lookupBookWord('belly', library, pos).r, 31);      // exact word, never "bell"
  assert.equal(lookupBookWord('only', library, pos).r, 32);       // exact word, never "on"
  assert.equal(lookupBookWord('early', library, pos).r, 33);      // exact word, never "ear"
  assert.equal(lookupBookWord('forest', library, pos).r, 34);     // exact word, never "fore"
  assert.equal(lookupBookWord('honest', library, pos).r, 35);     // exact word, never "hone"
  assert.equal(lookupBookWord('cover', library, pos).r, 36);      // exact word, never "cove"
  assert.equal(lookupBookWord('butter', library, pos).r, 37);     // exact word, never "butt"
  assert.equal(lookupBookWord('water', library, pos).r, 38);      // exact word, never "wat"
  assert.equal(lookupBookWord('ally', library, pos).r, 39);       // exact word, no -ally strip
  assert.equal(lookupBookWord('best', library, pos).r, 40);       // exact word, no -est strip
  assert.equal(lookupBookWord('sly', library, pos).r, 41);        // too short to strip
  assert.equal(lookupBookWord('family', library, pos), null);     // no base at all
  assert.equal(lookupBookWord('gingerly', library, {}), null);    // POS data missing: stay safe
});

test('offline-verified derivations and irregular forms resolve explicitly', () => {
  assert.equal(lookupBookWord('bidden', library, pos).r, 20);
  assert.equal(lookupBookWord('longingly', library, pos).r, 21);
});

test('derivational rules require POS data', () => {
  assert.equal(lookupBookWord('braver', library, {}), null);
  assert.equal(lookupBookWord('gloomily', library, {}), null);
});

test('adverbs resolve to adjective base cards with matching senses', () => {
  assert.equal(lookupBookWord('stiffly', library, pos).r, 22);
  assert.equal(lookupBookWord('stiffily', library, pos).r, 22);
  // 'lily' must never resolve: too short to strip, and 'lil' is no card.
  assert.equal(lookupBookWord('lily', library, pos), null);
  // bare -ily strip stays POS-guarded: without POS data nothing resolves.
  assert.equal(lookupBookWord('stiffily', library, {}), null);
  // -ily->y wins before the bare strip when both could apply.
  assert.equal(lookupBookWord('happily', new Map([...library, ['happy', word(47)]]), {...pos, happy: 'a'}).r, 47);
  assert.equal(lookupBookWord('happily', library, pos), null); // no happy card: 'happ' is not one either
  // fixed is a verb card here: fixedly must NOT resolve (book sense is 'intently').
  assert.equal(lookupBookWord('fixedly', library, pos), null);
});
