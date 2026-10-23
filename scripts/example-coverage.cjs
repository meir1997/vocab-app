// Reproducible presentation coverage, not a count of raw generated sentences.
// node scripts/example-coverage.cjs [baseline-ref]
// Set GIT_EXECUTABLE if git is not on PATH. No network or user data is used.
'use strict';
const { readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { execFileSync } = require('node:child_process');
const { runInNewContext } = require('node:vm');
const root = resolve(__dirname, '..');
const vocab = JSON.parse(readFileSync(join(root, 'vocab.json'), 'utf8'));
const details = JSON.parse(readFileSync(join(root, 'details.json'), 'utf8'));
const current = require('../quiz-content.js');
const baselineRef = process.argv[2] || '591ed5a13e7355090ab2ab8b781ad7b489232644'; // merged PR 13
const baselineModule = { exports: {} };
const source = execFileSync(process.env.GIT_EXECUTABLE || 'git', ['show', `${baselineRef}:quiz-content.js`], { cwd: root, encoding: 'utf8' });
runInNewContext(source, { module: baselineModule });

function coverage(api, entries) {
  return {
    words: entries.length,
    withExample: entries.filter(item => api.getWordContent(item, details[item.r]).example).length,
    withoutExample: entries.filter(item => !api.getWordContent(item, details[item.r]).example).length,
    reviewed: entries.filter(item => api.getWordContent(item, details[item.r]).reviewed).length,
    withPromptContext: entries.filter(item => api.getPromptContext(item, 'choice', details[item.r])).length,
    withExampleWithoutDetails: entries.filter(item => api.getWordContent(item).example).length
  };
}
function snapshot(api) {
  return { all: coverage(api, vocab), top300: coverage(api, vocab.filter(item => item.r <= 300)) };
}
console.log(JSON.stringify({
  baselineRef,
  policy: 'Only reviewed authored examples matching the displayed primary Hebrew meaning; generated examples are omitted.',
  before: snapshot(baselineModule.exports),
  after: snapshot(current),
  top300WithoutExample: vocab.filter(item => item.r <= 300 && !current.getWordContent(item, details[item.r]).example)
    .map(({ r, w, t }) => ({ r, w, t }))
}, null, 2));
