/* Book-word lookup: resolve a tapped book form to an app card.
   Pure and dependency-free so scripts/book-lookup.test.cjs can run it in Node.
   Rules are conservative: derivational suffixes (-ly, -er/-est, -ness) only
   resolve when the matched base card is an adjective, so "gingerly" never
   shows the "ginger" card and "forest" never shows "fore". */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BookLookup = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function normalizeBookWord(raw) {
    return (raw || '').toLowerCase().replace(/[’‘]/g, "'").trim();
  }

  // Forms the suffix rules cannot derive, verified one by one against the
  // base card's own sense. 'lightest' and 'crossly' stay unmapped: their only
  // base cards carry noun/verb senses, so resolving would show a wrong gloss.
  const IRREGULAR_FORMS = { bidden: 'bid', froze: 'freeze' };
  const VERIFIED_DERIVATIONS = { longingly: 'longing' };

  const undouble = stem => (stem.length > 2 && stem[stem.length - 1] === stem[stem.length - 2]
    && /[bcdfghjklmnpqrstvwxz]/.test(stem[stem.length - 1])) ? [stem.slice(0, -1)] : [];

  // Inflectional candidates: same word, no POS guard needed.
  function inflectionCandidates(base) {
    const cands = [base];
    if (base.endsWith("'s") && base.length > 3) cands.push(base.slice(0, -2));
    for (const suffix of ["'ll", "'re", "'ve", "'d", "'m", "n't"]) {
      if (base.endsWith(suffix) && base.length > suffix.length + 1) cands.push(base.slice(0, -suffix.length));
    }
    if (base.endsWith('ies') && base.length > 4) cands.push(base.slice(0, -3) + 'y');
    if (base.endsWith('ied') && base.length > 4) cands.push(base.slice(0, -3) + 'y');
    if (base.endsWith('ing') && base.length > 5) {
      const stem = base.slice(0, -3);
      cands.push(stem, stem + 'e', ...undouble(stem));
    }
    if (base.endsWith('es') && base.length > 4) cands.push(base.slice(0, -2));
    if (base.endsWith('ed') && base.length > 4) {
      const stem = base.slice(0, -2);
      cands.push(stem, base.slice(0, -1), ...undouble(stem)); // grabbed->grab, dived->dive
    }
    if (base.endsWith('s') && base.length > 3) cands.push(base.slice(0, -1));
    return cands;
  }

  // Derivational candidates: different part of speech, so the caller must
  // confirm the matched base card is an adjective before showing it.
  function derivationalCandidates(base) {
    const cands = [];
    if (base.endsWith('iest') && base.length > 5) cands.push(base.slice(0, -4) + 'y');
    if (base.endsWith('ier') && base.length > 4) cands.push(base.slice(0, -3) + 'y');
    if (base.endsWith('est') && base.length > 4) {
      const stem = base.slice(0, -3);
      cands.push(stem, stem + 'e', ...undouble(stem));
    }
    if (base.endsWith('er') && base.length > 3) {
      const stem = base.slice(0, -2);
      cands.push(stem, stem + 'e', base.slice(0, -1), ...undouble(stem));
    }
    if (base.endsWith('iness') && base.length > 6) cands.push(base.slice(0, -5) + 'y');
    if (base.endsWith('ness') && base.length > 5) cands.push(base.slice(0, -4), base.slice(0, -4) + 'e');
    if (base.endsWith('ily') && base.length > 4) cands.push(base.slice(0, -3) + 'y');
    if (base.endsWith('ily') && base.length > 5) cands.push(base.slice(0, -3)); // stiffily->stiff
    if (base.endsWith('ically') && base.length > 7) cands.push(base.slice(0, -6) + 'ic');
    if (base.endsWith('ally') && base.length > 5) cands.push(base.slice(0, -4) + 'al', base.slice(0, -4) + 'ic');
    if (base.endsWith('bly') && base.length > 4) cands.push(base.slice(0, -3) + 'le', base.slice(0, -3) + 'ble');
    if (base.endsWith('edly') && base.length > 5) cands.push(base.slice(0, -4) + 'ed');
    if (base.endsWith('ly') && base.length > 3) cands.push(base.slice(0, -2), base.slice(0, -2) + 'e');
    return cands;
  }

  // wordByLower: Map lowercase word -> vocab item. wordPos: plain object
  // lowercase word -> POS code ('n'/'v'/'a'/'r'), may be empty when unloaded.
  function lookupBookWord(raw, wordByLower, wordPos) {
    const base = normalizeBookWord(raw);
    if (!base) return null;
    for (const c of inflectionCandidates(base)) {
      const hit = wordByLower.get(c);
      if (hit) return hit;
    }
    const mapped = VERIFIED_DERIVATIONS[base] || IRREGULAR_FORMS[base];
    if (mapped) {
      const hit = wordByLower.get(mapped);
      if (hit) return hit;
    }
    const pos = wordPos || {};
    for (const c of derivationalCandidates(base)) {
      const hit = wordByLower.get(c);
      if (hit && pos[c] === 'a') return hit;
    }
    return null;
  }

  return Object.freeze({ normalizeBookWord, lookupBookWord, inflectionCandidates, derivationalCandidates, IRREGULAR_FORMS, VERIFIED_DERIVATIONS });
});
