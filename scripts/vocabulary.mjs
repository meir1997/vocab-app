import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SOURCE_URL = 'https://docs.google.com/spreadsheets/d/1YuNV-TcC_tITIe-SGTzTh-dKTlx4H84-4feTzAM2k4M/export?format=csv&gid=0';
export const MINIMUM_WORDS = 9998;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_FILE = 'data/source-vocabulary.csv';
const IOS_FILE = 'ios/VocabularyTrainer/Resources/vocabulary.json';
const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';

// Parse records rather than lines: quoted cells may contain commas or CR/LF.
export function parseCSV(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], field = '', quoted = false, closedQuote = false;
  const finishField = () => { row.push(field); field = ''; closedQuote = false; };
  const finishRow = () => { finishField(); if (row.some(cell => cell !== '')) rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') { quoted = false; closedQuote = true; }
      else field += char;
    } else if (char === ',') finishField();
    else if (char === '\r' || char === '\n') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      finishRow();
    } else if (char === '"' && !field && !closedQuote) quoted = true;
    else {
      if (char === '"' || closedQuote) throw new Error('Malformed CSV quotes');
      field += char;
    }
  }
  if (quoted) throw new Error('Unterminated CSV quote');
  if (field || row.length || closedQuote) finishRow();
  return rows;
}

export function buildVocabulary(text, { minimumWords = MINIMUM_WORDS } = {}) {
  const rows = parseCSV(text);
  if (rows[0]?.[0] !== 'Rank' || rows[0]?.[2] !== 'Word') throw new Error('Unexpected source header: expected Rank in A and Word in C');
  const entries = [], metadata = [], duplicates = [], omissions = [], seen = new Map();
  for (let offset = 1; offset < rows.length; offset++) {
    const row = rows[offset];
    const word = row[2]?.trim() ?? '', translation = row[8]?.trim() ?? '';
    const source = { sheetRow: offset + 1, sourceRank: row[0] ?? '', word };
    if (!word || !translation) {
      omissions.push({ ...source, reason: !word ? 'missing-word' : 'missing-translation' });
      continue;
    }
    const key = word.toLowerCase();
    if (seen.has(key)) {
      const first = seen.get(key);
      duplicates.push({ ...source, translation, firstSheetRow: first.sheetRow, firstSourceRank: first.sourceRank, sameTranslation: translation === first.translation });
      continue;
    }
    // Match the existing iOS rank policy; do not renumber or change entry IDs.
    const rank = /^[-+]?\d+$/.test(row[0]) ? Number(row[0]) : offset;
    entries.push({ rank, english: word, hebrew: translation });
    metadata.push(source);
    seen.set(key, { ...source, translation });
  }
  if (duplicates.some(item => !item.sameTranslation)) throw new Error('Refusing conflicting translations for a duplicate English word; review source rows before importing');
  if (omissions.length) throw new Error('Refusing an incomplete source: ' + omissions.length + ' rows lack a word or translation');
  if (entries.length < minimumWords) throw new Error('Refusing a partial library: ' + entries.length + ' words; at least ' + minimumWords + ' required');
  entries.sort((a, b) => a.rank - b.rank);
  const web = json(entries.map(({ english, hebrew }) => ({ word: english, translation: hebrew })));
  const ios = json(entries);
  const sourceMetadata = json({ columns: { rank: 'A', word: 'C', translation: 'I' }, duplicatePolicy: 'First occurrence of each case-insensitive English word; preserve source text and order.', entries: metadata, duplicates, omissions });
  const manifest = {
    schemaVersion: 1,
    source: { spreadsheetId: '1YuNV-TcC_tITIe-SGTzTh-dKTlx4H84-4feTzAM2k4M', sheet: 'גיליון1', gid: 0, csvURL: SOURCE_URL },
    sourceRowCount: rows.length - 1,
    entryCount: entries.length,
    duplicateRowCount: duplicates.length,
    omittedRowCount: omissions.length,
    files: {
      [SOURCE_FILE]: { sha256: sha256(text), bytes: Buffer.byteLength(text) },
      'data/vocabulary.json': { sha256: sha256(web), bytes: Buffer.byteLength(web) },
      [IOS_FILE]: { sha256: sha256(ios), bytes: Buffer.byteLength(ios) },
      'data/vocabulary-source.json': { sha256: sha256(sourceMetadata), bytes: Buffer.byteLength(sourceMetadata) }
    }
  };
  const bundleManifest = json({ schemaVersion: 1, entryCount: entries.length, sha256: sha256(ios), sourceURL: SOURCE_URL });
  return new Map([
    [SOURCE_FILE, text],
    ['data/vocabulary.json', web],
    [IOS_FILE, ios],
    ['data/vocabulary-source.json', sourceMetadata],
    ['data/vocabulary-manifest.json', json(manifest)],
    ['ios/VocabularyTrainer/Resources/vocabulary-manifest.json', bundleManifest]
  ]);
}

async function main(args) {
  const check = args.includes('--check');
  const inputIndex = args.indexOf('--input');
  const input = inputIndex === -1 ? null : args[inputIndex + 1];
  if (args.some(arg => !['--check', '--input', input].includes(arg)) || (inputIndex !== -1 && !input)) throw new Error('Usage: node scripts/vocabulary.mjs [--check | --input path.csv]');
  if (check && input) throw new Error('--check validates the committed source snapshot; omit --input');
  let minimumWords = MINIMUM_WORDS;
  try {
    const previous = JSON.parse(await readFile(path.join(ROOT, 'data/vocabulary-manifest.json'), 'utf8'));
    minimumWords = Math.max(minimumWords, previous.entryCount);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let text;
  if (check || input) text = await readFile(input ? path.resolve(input) : path.join(ROOT, SOURCE_FILE), 'utf8');
  else {
    const response = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(30000), headers: { Accept: 'text/csv' } });
    if (!response.ok) throw new Error('Source download failed: HTTP ' + response.status);
    text = await response.text();
  }
  const outputs = buildVocabulary(text, { minimumWords });
  // Validate every output before changing files, so failed downloads preserve the good library.
  if (check) {
    for (const [relative, expected] of outputs) {
      const actual = await readFile(path.join(ROOT, relative), 'utf8');
      if (actual !== expected) throw new Error('Stale or modified asset: ' + relative + '; refresh using the import script');
    }
  } else {
    for (const [relative, content] of outputs) {
      const destination = path.join(ROOT, relative);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, content, 'utf8');
    }
  }
  const manifest = JSON.parse(outputs.get('data/vocabulary-manifest.json'));
  console.log((check ? 'Verified' : 'Imported') + ' ' + manifest.entryCount.toLocaleString('en-US') + ' words from ' + manifest.sourceRowCount.toLocaleString('en-US') + ' source rows; ' + manifest.duplicateRowCount + ' duplicates, ' + manifest.omittedRowCount + ' omissions.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
