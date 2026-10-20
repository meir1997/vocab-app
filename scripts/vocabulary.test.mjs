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

test('regular quiz automatically advances a thousand at 70/100 and retains the hundred rule', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('function recordBandAnswer('), source.indexOf('function bandAccuracyNote('));
  const run = Function('bands', 'answers', `const BAND_SIZE=100,BAND_WINDOW=10,BAND_MIN_ANSWERS=10,BAND_ADVANCE=.7;
    const maxBand=()=>100,bandLo=b=>(b-1)*100+1,bandLabel=()=>'', $=()=>({}),showToast=()=>{};
    ${code}; for(const [ok,rank] of answers)recordBandAnswer(ok,rank);return bands;`);
  let bands={current:5,recent:[],thousandRecent:[...Array(69).fill(1),...Array(30).fill(0)]};
  assert.equal(run(structuredClone(bands),[[true,100]]).current,11);
  assert.equal(run(structuredClone(bands),[[false,100]]).current,5);
  assert.deepEqual(run(structuredClone(bands),[[true,2000]]),bands);
  bands={current:5,recent:[1,1,1,1,1,1,0,0,0],thousandRecent:[1,0]};
  const hundred=run(structuredClone(bands),[[true,450]]);
  assert.equal(hundred.current,6);assert.deepEqual(hundred.thousandRecent,[1,0,1]);
  bands.current=10;
  assert.deepEqual(run(bands,[[true,950]]).thousandRecent,[]);
  const incomplete=run({current:5,recent:[],thousandRecent:Array(98).fill(1)},[[true,100]]);
  assert.equal(incomplete.current,5);
});
