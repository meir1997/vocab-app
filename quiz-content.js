/* Quiz presentation only: source vocabulary, scores and learning rules stay intact. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VocabQuiz = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // These short examples are authored for the Hebrew sense in the source list.
  // WordNet/Tatoeba examples are not sense-aligned: e.g. "can" is a container
  // here, while its generated example uses the modal verb. Keep the expected
  // Hebrew alongside each override so a later source correction cannot silently
  // leave a mismatched example in the quiz.
  const REVIEWED = {
    can: ['פחית', 'She opened a can of beans.', ['יכול', 'להיות מסוגל']],
    will: ['רצון', 'She has the will to succeed.', ['צוואה', 'יהיה']],
    may: ['מאי', 'The flowers bloom in May.', ['עשוי', 'יכול']],
    might: ['יכול', 'It might rain this afternoon.', ['עוצמה', 'כוח']],
    right: ['ימינה', 'Turn right at the next street.', ['נכון', 'זכות', 'ימין']],
    left: ['שמאל', 'The door is on your left.', ['עזב', 'נותר']],
    light: ['אור', 'The room was full of light.', ['קל', 'להדליק', 'בהיר']],
    bank: ['בנק', 'She put her money in the bank.', ['גדה']],
    address: ['כתובת', 'Write your address on the envelope.', ['לפנות', 'נאום']],
    mean: ['ממוצע', 'The mean of two and four is three.', ['להתכוון', 'מרושע']],
    kind: ['סוג', 'What kind of fruit is this?', ['אדיב', 'נחמד']],
    close: ['לסגור', 'Please close the door behind you.', ['קרוב', 'סמוך']],
    lie: ['שקר', 'He told a lie about his age.', ['לשכב']],
    match: ['להתאים', 'These shoes match my blue coat.', ['גפרור', 'משחק', 'תחרות']],
    present: ['להציג', 'Please present your idea to the class.', ['מתנה', 'נוכח', 'הווה']],
    set: ['מערכת', 'This set of tools has everything I need.', ['להניח', 'לקבוע']],
    saw: ['מסור', 'He cut the wood with a saw.', ['ראה']],
    felt: ['לבד', 'The hat is made of soft felt.', ['הרגיש']],
    well: ['טוב', 'She plays the piano very well.', ['באר']],
    spring: ['אביב', 'The flowers bloom in spring.', ['מעיין', 'קפיץ', 'לקפוץ']],
    fine: ['עדין', 'The cloth has a fine, delicate texture.', ['קנס', 'בסדר']],
    watch: ['לצפות', 'We watch the birds from the window.', ['שעון']],
    date: ['תאריך', 'Write the date at the top of the page.', ['תמר', 'פגישה']],
    change: ['לשנות', 'We need to change our plans.', ['עודף', 'שינוי']],
    fair: ['הוגן', 'Both teams agreed that the rules were fair.', ['יריד', 'בהיר']],
    record: ['רשומה', 'Each record in the list has a name and date.', ['להקליט', 'שיא']],
    object: ['להתנגד', 'I object to the new rule.', ['חפץ', 'עצם']],
    minute: ['דקה', 'Please wait for one minute.', ['זעיר']],
    lead: ['עופרת', 'The old pipe was made of lead.', ['להוביל']],
    train: ['רכבת', 'The train arrived at the station.', ['לאמן', 'להתאמן']],
    book: ['ספר', 'She borrowed a book from the library.', ['להזמין']],
    second: ['שניה', 'The light flashed for one second.', ['שני']],
    hard: ['קשה', 'This question is hard to answer.', ['קשה', 'חזק']],
    current: ['נוכחי', 'What is your current address?', ['זרם']],
    case: ['מקרה', 'In this case, we need more information.', ['תיק', 'מארז']],
    rock: ['רוק', 'The band plays rock music.', ['סלע', 'לנדנד']],
    bear: ['דוב', 'A bear walked through the forest.', ['לשאת', 'לסבול']],
    point: ['נקודה', 'Mark the point where the two lines meet.', ['להצביע', 'טעם']],
    charge: ['תשלום', 'There is a small charge for delivery.', ['לטעון', 'להאשים', 'מטען']],
    free: ['לשחרר', 'They will free the bird from its cage.', ['חופשי', 'חינם']],
    order: ['להזמין', 'We would like to order some food.', ['סדר', 'פקודה']],
    sound: ['קול', 'I heard the sound of a bell.', ['בריא', 'תקין']],
    still: ['עוד', 'She is still waiting for the bus.', ['דומם', 'שקט']],
    letter: ['מכתב', 'She sent a letter to her friend.', ['אות']],
    face: ['פנים', 'She washed her face with cold water.', ['להתמודד']],
    mind: ['דעה', 'Speak your mind and tell us what you think.', ['אכפת', 'מוח']],
    line: ['קו', 'Draw a straight line across the page.', ['תור', 'שורה']],
    matter: ['חומר', 'Scientists study matter and energy.', ['עניין', 'לשנות']],
    form: ['טופס', 'Please fill in this form.', ['צורה', 'ליצור']],
    reason: ['לנמק', 'Can you reason out your answer?', ['סיבה']],
    rest: ['לנוח', 'You should rest after the long walk.', ['שאר', 'מנוחה']],
    land: ['ארץ', 'They travelled to a distant land.', ['לנחות', 'אדמה']],
    return: ['לחזור', 'We will return home before dark.', ['החזר', 'תשואה']],
    break: ['לשבור', 'Be careful not to break the glass.', ['הפסקה']],
    cold: ['קר', 'The water is too cold to swim in.', ['הצטננות']],
    hot: ['חם', 'Be careful; the soup is hot.', ['חריף']],
    flat: ['שטוח', 'The road is straight and flat.', ['דירה']],
    patient: ['חולה', 'The patient is waiting to see a doctor.', ['מטופל', 'סבלני']],
    capital: ['הון', 'The company needs capital to buy new equipment.', ['עיר בירה', 'אות גדולה']],
    bright: ['בהיר', 'The room is bright in the morning sun.', ['חכם']]
  };

  const HEBREW_MARKS = /[\u0591-\u05BD\u05BF\u05C1-\u05C2\u05C4-\u05C5\u05C7]/g;
  function normalizeHebrew(text) {
    return String(text || '').normalize('NFKC').replace(HEBREW_MARKS, '')
      .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
      .replace(/["'\u05F3\u05F4]/g, '').replace(/[-\u05BE]/g, ' ')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().replace(/\s+/g, ' ').toLowerCase();
  }
  function normalizeEnglish(text) {
    return String(text || '').normalize('NFKC').toLowerCase().trim()
      .replace(/[_-]/g, ' ').replace(/\s+/g, ' ');
  }
  function meanings(text) {
    return String(text || '').split(/[,;\/\n]+/).map(value => value.trim()).filter(Boolean);
  }
  function reviewedFor(item) {
    const entry = REVIEWED[normalizeEnglish(item.w)];
    return entry && normalizeHebrew(entry[0]) === normalizeHebrew(meanings(item.t)[0]) ? entry : null;
  }
  function getWordContent(item, detail = null) {
    const reviewed = reviewedFor(item);
    return {
      meaning: meanings(item.t)[0] || item.t || '',
      example: reviewed ? reviewed[1] : (detail && detail.e) || '',
      context: reviewed ? reviewed[1] : '',
      reviewed: !!reviewed,
      ambiguous: !!reviewed || !!(detail && Array.isArray(detail.d) && detail.d.length > 1)
    };
  }
  function getPromptContext(item, mode = 'choice', detail = null) {
    const context = getWordContent(item, detail).context;
    if (!context || mode === 'choice') return context;
    const escaped = String(item.w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return context.replace(new RegExp('\\b' + escaped + '\\b', 'gi'), '____');
  }

  // Conservative equivalence groups cover common Hebrew synonyms and spelling
  // variants that cannot be discovered by removing niqqud alone.
  const EQUIVALENTS = [
    ['אדם', 'איש', 'בן אדם'], ['אנשים', 'בני אדם'], ['אשה', 'אישה', 'רעיה'],
    ['אמא', 'אימא', 'אם'], ['אבא', 'אב'], ['אנו', 'אנחנו'], ['כל', 'כול'],
    ['הכל', 'הכול'], ['כח', 'כוח'], ['ליטול', 'לקחת'], ['לומר', 'להגיד'],
    ['לראות', 'לצפות'], ['לעשות', 'לבצע'], ['מאד', 'מאוד'], ['מעל', 'למעלה'],
    ['בשביל', 'עבור', 'בעבור'], ['בגלל', 'מפני', 'משום'], ['כמו', 'כפי'],
    ['מעט', 'קצת'], ['גדול', 'עצום'], ['אחר', 'שונה'], ['כאן', 'פה'],
    ['אולם', 'אבל', 'אך'], ['לשנות', 'להחליף'], ['סוג', 'מין'], ['דקה', 'דקה אחת']
  ];
  const equivalence = new Map();
  for (const group of EQUIVALENTS) {
    const normalized = group.map(normalizeHebrew);
    for (const meaning of normalized) equivalence.set(meaning, normalized);
  }
  function addHebrew(set, text) {
    for (const value of meanings(text)) {
      const normalized = normalizeHebrew(value);
      if (!normalized) continue;
      set.add(normalized);
      for (const alias of equivalence.get(normalized) || []) set.add(alias);
    }
  }
  const EMPTY_DETAILS = Object.freeze({});
  const caches = new WeakMap();
  function profilesFor(vocab, details) {
    let cached = caches.get(vocab);
    if (cached && cached.details === details) return cached.profiles;
    const byWord = new Map(vocab.map(item => [normalizeEnglish(item.w), item]));
    const profiles = new Map();
    for (const item of vocab) {
      const hebrew = new Set();
      addHebrew(hebrew, item.t);
      const reviewed = reviewedFor(item);
      if (reviewed) for (const alias of reviewed[2]) addHebrew(hebrew, alias);
      const detail = details[item.r];
      const english = new Set([normalizeEnglish(item.w)]);
      for (const synonym of (detail && detail.s) || []) {
        english.add(normalizeEnglish(synonym));
        const related = byWord.get(normalizeEnglish(synonym));
        if (related) addHebrew(hebrew, related.t);
      }
      profiles.set(item, { hebrew, english });
    }
    caches.set(vocab, { details, profiles });
    return profiles;
  }
  function intersects(a, b) { for (const value of a) if (b.has(value)) return true; return false; }
  function conflict(a, b) { return intersects(a.hebrew, b.hebrew) || intersects(a.english, b.english); }
  function shuffled(values, rng) {
    const result = values.slice();
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.min(i, Math.max(0, Math.floor(rng() * (i + 1))));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
  function buildChoices(item, vocab, mode = 'choice', details = EMPTY_DETAILS, rng = Math.random) {
    const profiles = profilesFor(vocab, details);
    const selected = [item];
    const canonical = profiles.has(item) ? item : vocab.find(value => normalizeEnglish(value.w) === normalizeEnglish(item.w));
    const targetProfile = profiles.get(canonical) || {
      hebrew: new Set(meanings(item.t).map(normalizeHebrew)), english: new Set([normalizeEnglish(item.w)])
    };
    // Partial Fisher-Yates samples without replacement, without shuffling all
    // 9,998 words on each question. If a tiny library has too few distinct
    // meanings, return fewer choices rather than adding an ambiguous answer.
    const swaps = new Map();
    for (let remaining = vocab.length; remaining > 0 && selected.length < 4; remaining--) {
      const index = Math.min(remaining - 1, Math.max(0, Math.floor(rng() * remaining)));
      const picked = swaps.has(index) ? swaps.get(index) : index;
      const last = swaps.has(remaining - 1) ? swaps.get(remaining - 1) : remaining - 1;
      swaps.set(index, last);
      const candidate = vocab[picked];
      if (candidate === item || normalizeEnglish(candidate.w) === normalizeEnglish(item.w)) continue;
      const candidateProfile = profiles.get(candidate);
      if (selected.some(value => conflict(candidateProfile, profiles.get(value) || targetProfile))) continue;
      if (!getWordContent(candidate, details[candidate.r]).meaning) continue;
      selected.push(candidate);
    }
    return shuffled(selected.map(value => ({
      item: value,
      label: mode === 'reverse' ? value.w : getWordContent(value, details[value.r]).meaning,
      correct: value === item
    })), rng);
  }

  return Object.freeze({ getWordContent, getPromptContext, buildChoices, normalizeHebrew });
});
