import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildVocabulary, parseCSV, MINIMUM_WORDS } from './vocabulary.mjs';

test('CSV handles CRLF, quoted commas, escaped quotes, quoted newlines, BOM and final empty fields', () => {
  assert.deepEqual(parseCSV('\uFEFFa,b,c\r\n1,"two, too",\r\n2,"say ""hi""\r\nagain",3\r\n'), [
    ['a', 'b', 'c'], ['1', 'two, too', ''], ['2', 'say "hi"\r\nagain', '3']
  ]);
  assert.deepEqual(parseCSV('a,b\r1,2\n3,4'), [['a', 'b'], ['1', '2'], ['3', '4']]);
});

test('CSV refuses malformed quotes instead of silently importing truncated fields', () => {
  for (const text of ['a,"unfinished', 'a,b"c', 'a,"b"junk']) assert.throws(() => parseCSV(text));
});

test('source columns, first occurrence, preserved rank policy and omissions are explicit', () => {
  const text = 'Rank,B,Word,D,E,F,G,H,I\r\n1,x,Hello,x,x,x,x,x,שלום\r\n"1,002",x,world,x,x,x,x,x,עולם\r\n3,x,hello,x,x,x,x,x,שלום\r\n';
  const outputs = buildVocabulary(text, { minimumWords: 2 });
  const entries = JSON.parse(outputs.get('ios/VocabularyTrainer/Resources/vocabulary.json'));
  assert.deepEqual(entries, [{ rank: 1, english: 'Hello', hebrew: 'שלום' }, { rank: 2, english: 'world', hebrew: 'עולם' }]);
  const metadata = JSON.parse(outputs.get('data/vocabulary-source.json'));
  assert.equal(metadata.duplicates[0].firstSheetRow, 2);
  assert.equal(metadata.duplicates[0].sameTranslation, true);
  assert.equal(metadata.entries[1].sourceRank, '1,002');
  assert.throws(() => buildVocabulary(text.replace('3,x,hello,x,x,x,x,x,שלום', '3,x,hello,x,x,x,x,x,היי'), { minimumWords: 2 }), /conflicting translations/);
  assert.throws(() => buildVocabulary(text), /partial library/);
  assert.throws(() => buildVocabulary(text.replace('עולם', ''), { minimumWords: 1 }), /incomplete source/);
  assert.throws(() => buildVocabulary('a,b,c'), /Unexpected source header/);
});

test('complete committed snapshot matches every generated asset and contains all 9,998 unique words', async () => {
  const root = new URL('../', import.meta.url);
  const text = await readFile(new URL('data/source-vocabulary.csv', root), 'utf8');
  const outputs = buildVocabulary(text);
  for (const [file, expected] of outputs) assert.equal(await readFile(new URL(file, root), 'utf8'), expected, file);
  const words = JSON.parse(outputs.get('data/vocabulary.json'));
  assert.equal(words.length, MINIMUM_WORDS);
  assert.equal(new Set(words.map(item => item.word.toLowerCase())).size, MINIMUM_WORDS);
  assert.equal(words[0].word, 'the');
  assert.equal(words.at(-1).word, 'calves');
  const metadata = JSON.parse(outputs.get('data/vocabulary-source.json'));
  assert.deepEqual(metadata.duplicates.map(item => item.word), ['ll', 'cause']);
  assert.deepEqual(metadata.omissions, []);
});

// Exercise the actual browser implementation, with no DOM or duplicated policy.
test('placement samples 100 distinct words from the entire current thousand', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const functions = source.slice(source.indexOf('function placementSample('), source.indexOf('function startPlacement('));
  const { sample, target } = Function(functions + '; return {sample:placementSample,target:placementTarget};')();
  const words = Array.from({length: 2000}, (_, i) => ({r:i+1,w:'word'+i,t:'t'+i}));
  for (const band of [1, 5, 10, 11, 20]) {
    const selected = sample(words, band);
    const thousand = Math.floor((band-1)/10);
    assert.equal(selected.length, 100);
    assert.equal(new Set(selected.map(w=>w.w)).size, 100);
    assert.ok(selected.every(w=>w.r>thousand*1000 && w.r<=(thousand+1)*1000));
  }
  assert.equal(sample(words.slice(0,99),1).length,0);
  assert.equal(sample(Array(110).fill(words[0]),1).length,0);
  assert.equal(target(5,5,100,70,100),11);
  assert.equal(target(5,5,100,69,100),null);
  assert.equal(target(5,5,99,99,100),null);
  assert.equal(target(5,6,100,100,100),null);
  assert.equal(target(15,15,100,70,100),21);
  assert.equal(target(95,95,100,100,100),null);
});
