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
    of: ['של', 'The roof of the house is red.', []],
    and: ['ו', 'We bought bread and milk.', []],
    to: ['אל', 'She walked to the door.', []],
    in: ['ב', 'The key is in the box.', []],
    i: ['אני', 'I am ready to help.', []],
    that: ['זה', 'What is that?', []],
    was: ['היה', 'He was here yesterday.', []],
    his: ['שלו', 'The blue bicycle is his.', []],
    he: ['הוא', 'He is my brother.', []],
    it: ['זה', 'What is it? It is a small bird.', []],
    with: ['עם', 'She went with her sister.', []],
    is: ['הוא', 'A dolphin is a mammal.', []],
    for: ['עבור', 'This gift is for you.', []],
    as: ['כמו', 'Do as I do.', []],
    you: ['אתה', 'You are my best friend.', []],
    not: ['לא', 'He is not at home.', []],
    be: ['להיות', 'I want to be a doctor.', []],
    her: ['שלה', 'Her dog is sleeping.', []],
    on: ['על', 'The book is on the table.', []],
    at: ['ב', 'We met at the station.', []],
    by: ['על ידי', 'The letter was written by Dana.', []],
    which: ['איזה', 'Which coat is yours?', []],
    have: ['יש', 'I have a question.', []],
    or: ['או', 'Would you like tea or coffee?', []],
    from: ['מן', 'The train came from Haifa.', []],
    this: ['זה', 'What is this?', []],
    him: ['אותו', 'I saw him at the station.', []],
    but: ['אבל', 'I am tired, but I will help.', []],
    all: ['כל', 'All the children are here.', []],
    she: ['היא', 'She is my sister.', []],
    they: ['הם', 'They are my brothers.', []],
    were: ['היו', 'They were here yesterday.', []],
    my: ['שלי', 'My bag is on the chair.', []],
    are: ['הם', 'Whales are mammals.', []],
    me: ['לי', 'Please give me the book.', []],
    one: ['אחד', 'I need one ticket.', []],
    their: ['שלהם', 'Their house has a red door.', []],
    so: ['כך', 'If you think so, tell me why.', []],
    said: ['אמר', 'He said that he was tired.', []],
    them: ['אותם', 'I can see them from here.', []],
    we: ['אנו', 'We are ready to begin.', []],
    would: ['היה', 'He would help if he could.', []],
    been: ['היה', 'He has been here before.', []],
    no: ['לא', 'No, I do not want any tea.', []],
    when: ['כאשר', 'Call me when you arrive.', []],
    there: ['שם', 'Put the box there.', []],
    if: ['אם', 'We will go outside if it stops raining.', []],
    more: ['יותר', 'I need more time.', []],
    out: ['החוצה', 'Please go out and wait in the garden.', []],
    up: ['למעלה', 'Look up at the sky.', []],
    into: ['לתוך', 'She put the key into the bag.', []],
    do: ['לעשות', 'I have work to do today.', []],
    any: ['כל', 'Choose any book you like.', []],
    your: ['שלך', 'Your coat is on the chair.', []],
    what: ['מה', 'What is your name?', []],
    has: ['יש', 'She has a question.', []],
    man: ['אדם', 'A man was waiting at the door.', []],
    could: ['היה יכול', 'As a child, he could swim very well.', []],
    other: ['אחר', 'Please use the other door.', []],
    than: ['מאשר', 'This road is longer than that one.', []],
    our: ['שלנו', 'Our house is near the park.', []],
    some: ['כמה', 'I have some questions.', []],
    very: ['מאוד', 'The water is very cold.', []],
    time: ['זמן', 'We have enough time to walk home.', []],
    upon: ['על', 'The vase stood upon the table.', []],
    about: ['אודות', 'This book is about birds.', []],
    its: ['שלה', 'The bird opened its wings.', []],
    only: ['רק', 'I have only one pencil.', []],
    now: ['עכשיו', 'We must leave now.', []],
    like: ['כמו', 'This stone looks like an egg.', []],
    little: ['קצת', 'Add a little salt to the soup.', []],
    then: ['אז', 'I lived in Haifa then.', []],
    should: ['צריך', 'You should wear a warm coat.', []],
    made: ['עשוי', 'The table is made of wood.', []],
    did: ['עשה', 'He did all the work yesterday.', []],
    us: ['לנו', 'Please give us some water.', []],
    such: ['כזה', 'I have never seen such a large bird.', []],
    great: ['גדול', 'The storm caused great damage.', []],
    before: ['לפני', 'We arrived before noon.', []],
    must: ['חובה', 'A helmet is a must on this ride.', []],
    these: ['אלה', 'These are my books.', []],
    see: ['לראות', 'I can see the mountains from here.', []],
    know: ['לדעת', 'I want to know the answer.', []],
    over: ['מעל', 'A bird flew over the house.', []],
    much: ['הרבה', 'We do not have much time.', []],
    down: ['למטה', 'She walked down the stairs.', []],
    after: ['לאחר', 'We went home after dinner.', []],
    first: ['ראשית', 'First, wash your hands.', []],
    mr: ['מר', 'Mr Green is our teacher.', []],
    good: ['טוב', 'This is a good idea.', []],
    men: ['אנשים', 'Three men were waiting outside.', []],
    own: ['שלו', 'He brought his own lunch.', []],
    never: ['לעולם לא', 'I will never forget your help.', []],
    most: ['רוב', 'Most people are asleep.', []],
    old: ['ישן', 'She replaced her old shoes with new ones.', []],
    where: ['איפה', 'Where is the nearest station?', []],
    those: ['ההן', 'Do you see those girls across the street?', []],
    came: ['הגיע', 'He came home at six.', []],
    come: ['לבוא', 'Please come to my house tomorrow.', []],
    himself: ['עצמו', 'He saw himself in the mirror.', []],
    way: ['דרך', 'Which way leads to the station?', []],
    work: ['עבודה', 'There is a lot of work to do.', []],
    life: ['חיים', 'Water is necessary for life.', []],
    without: ['ללא', 'He left without his coat.', []],
    go: ['ללכת', 'I want to go home.', []],
    make: ['לעשות', 'Everyone can make a mistake.', []],
    through: ['באמצעות', 'We spoke through an interpreter.', []],
    being: ['יצור', 'A whale is a living being.', []],
    long: ['ארוך', 'They crossed a long bridge.', []],
    say: ['לומר', 'What do you want to say?', []],
    how: ['איך', 'How do you open this box?', []],
    too: ['גם', 'My sister is coming too.', []],
    even: ['אפילו', 'Even a small child can do this.', []],
    again: ['שוב', 'Please read the sentence again.', []],
    many: ['רבים', 'Many people came to the concert.', []],
    back: ['בחזרה', 'Please come back tomorrow.', []],
    here: ['כאן', 'Please wait here.', []],
    think: ['לחשוב', 'I need time to think.', []],
    every: ['כל', 'Every room has a window.', []],
    people: ['אנשים', 'Many people live in this city.', []],
    went: ['הלך', 'He went to school on foot.', []],
    same: ['אותו', 'We take the same bus every day.', []],
    last: ['אחרון', 'She was the last person to arrive.', []],
    thought: ['מחשבה', 'A strange thought came to my mind.', []],
    away: ['רחוק', 'The village is five kilometres away.', []],
    under: ['תחת', 'The cat hid under the table.', []],
    take: ['ליטול', 'Please take one tablet with water.', []],
    found: ['נמצא', 'The missing key was found under the table.', []],
    hand: ['יד', 'Raise your hand if you know the answer.', []],
    place: ['מקום', 'This is a quiet place to read.', []],
    while: ['בעוד', 'She read while he cooked.', []],
    just: ['רק', 'I need just one more minute.', []],
    also: ['גם', 'She also speaks French.', []],
    young: ['צעיר', 'He is a young man.', []],
    yet: ['אולם', 'The bag is small, yet it holds many books.', []],
    against: ['נגד', 'We voted against the new rule.', []],
    things: ['דברים', 'Put your things in the bag.', []],
    get: ['לקבל', 'I hope to get a letter from her.', []],
    ever: ['אי פעם', 'Have you ever visited Haifa?', []],
    give: ['לתת', 'I want to give you a present.', []],
    off: ['כבוי', 'The light is off.', []],
    nothing: ['שום דבר', 'There is nothing in the box.', []],
    once: ['פעם', 'I have met him only once.', []],
    another: ['אחר', 'Please choose another book.', []],
    part: ['חלק', 'This is only part of the story.', []],
    house: ['בית', 'They live in a small house.', []],
    world: ['עולם', 'People all over the world need clean water.', []],
    head: ['ראש', 'She wore a hat on her head.', []],
    took: ['לקח', 'He took a book from the shelf.', []],
    new: ['חדש', 'She bought a new bicycle.', []],
    love: ['אהבה', 'Her love for her children is strong.', []],
    mrs: ['גברת', 'Mrs Green is our neighbour.', []],
    put: ['לשים', 'Please put the cup on the table.', []],
    each: ['כל', 'Each child received a book.', []],
    king: ['מלך', 'The king wore a golden crown.', []],
    between: ['בין', 'The bank is between the school and the park.', []],
    tell: ['לספר', 'Please tell me a story.', []],
    heart: ['לב', 'The doctor listened to his heart.', []],
    few: ['מעטים', 'Few people came to the meeting.', []],
    because: ['כי', 'We stayed home because it was raining.', []],
    thing: ['דבר', 'What is that thing on the table?', []],
    whom: ['מי', 'Whom did you invite?', []],
    far: ['רחוק', 'The station is far from here.', []],
    seemed: ['נראה', 'He seemed tired after the journey.', []],
    looked: ['הסתכל', 'He looked out of the window.', []],
    called: ['נקרא', 'This city is called Haifa.', []],
    whole: ['כל', 'The whole family is here.', []],
    both: ['שניהם', 'Both of them are teachers.', []],
    got: ['קיבל', 'He got a letter from his friend.', []],
    find: ['למצוא', 'I hope to find my missing key.', []],
    done: ['נעשה', 'It was done yesterday.', []],
    heard: ['נשמע', 'A loud cry was heard in the street.', []],
    look: ['מבט', 'Take a look at this picture.', []],
    name: ['שם', 'Write your name on the paper.', []],
    told: ['סיפר', 'He told us a story.', []],
    let: ['לאפשר', 'Please let me finish my sentence.', []],
    lord: ['אדון', 'The servant obeyed his lord.', []],
    country: ['מדינה', 'France is a country in Europe.', []],
    asked: ['שאל', 'He asked me a question.', []],
    going: ['הולך', 'He is going to school.', []],
    seen: ['ראה', 'He has seen this film before.', []],
    better: ['לשפר', 'We hope to better last year\'s results.', []],
    home: ['בית', 'Their home has three bedrooms.', []],
    knew: ['ידע', 'He knew the answer.', []],
    side: ['צד', 'Write your name on this side of the paper.', []],
    something: ['משהו', 'There is something in my bag.', []],
    moment: ['רגע', 'Please wait a moment.', []],
    among: ['בין', 'She found her key among the coins.', []],
    enough: ['מספיק', 'We have enough food for everyone.', []],
    words: ['מילים', 'Write three words on the board.', []],
    full: ['מלא', 'The glass is full of water.', []],
    end: ['סוף', 'We reached the end of the road.', []],
    gave: ['נתן', 'He gave me a book.', []],
    room: ['חדר', 'This room has two windows.', []],
    small: ['קטן', 'A small dog ran past the gate.', []],
    cannot: ['לא יכול', 'He cannot lift this heavy box.', []],
    want: ['מחסור', 'The crops died for want of water.', []],
    however: ['אולם', 'The road was long; however, we arrived on time.', []],
    quite: ['די', 'The room is quite small.', []],
    brought: ['מובא', 'The food is brought to the table.', []],
    nor: ['גם לא', 'She does not drink tea, nor does she drink coffee.', []],
    word: ['מלה', 'I do not understand this word.', []],
    whose: ['של מי', 'Whose bag is this?', []],
    given: ['נתון', 'Use the given information to answer the question.', []],
    best: ['טוב ביותר', 'This is the best book I have read.', []],
    turned: ['הסתובב', 'He turned to look behind him.', []],
    taken: ['נלקח', 'The chair was taken to another room.', []],
    does: ['עושה', 'He does his homework after dinner.', []],
    use: ['להשתמש', 'You can use my pen.', []],
    myself: ['עצמי', 'I saw myself in the mirror.', []],
    until: ['עד', 'Please wait until noon.', []],
    since: ['מאז', 'I have lived here since 2020.', []],
    power: ['כוח', 'The engine has enough power to pull the boat.', []],
    themselves: ['עצמם', 'They saw themselves in the mirror.', []],
    used: ['משומש', 'She bought a used car.', []],
    rather: ['אלא', 'He is not angry; rather, he is disappointed.', []],
    began: ['התחילה', 'She began to sing.', []],
    voice: ['קול', 'I heard her voice on the phone.', []],
    white: ['לבן', 'The wall is white.', []],
    works: ['עובד', 'He works in a hospital.', []],
    less: ['פחות', 'This bag costs less than that one.', []],
    next: ['הבא', 'We will get off at the next stop.', []],
    poor: ['ירוד', 'The photo is of poor quality.', []],
    stood: ['עמד', 'He stood beside the door.', []],
    within: ['בתוך', 'Please stay within the marked area.', []],
    together: ['יחד', 'We walked home together.', []],
    till: ['עד', 'The shop is open till six.', []],
    large: ['גדול', 'They live in a large house.', []],
    certain: ['מסוים', 'The shop is open only on certain days.', []],
    herself: ['עצמה', 'She saw herself in the mirror.', []],
    half: ['חצי', 'He ate half of the apple.', []],
    true: ['נכון', 'Is this statement true?', []],
    anything: ['דבר', 'I did not hear anything.', []],
    keep: ['לשמור', 'Please keep this letter in a safe place.', []],
    sent: ['נשלח', 'The letter was sent yesterday.', []],
    wife: ['אשה', 'He lives with his wife and children.', []],
    means: ['אמצעי', 'A bicycle is a means of transport.', []],
    believe: ['להאמין', 'I want to believe your story.', []],
    passed: ['עבר', 'The bus passed our house.', []],
    feet: ['רגליים', 'My feet are cold.', []],
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
    // Generated details have no link to the displayed Hebrew sense. Even one
    // definition is not proof: build-details.py filters/truncates WordNet senses
    // and selects Tatoeba sentences independently. Only a reviewed sentence
    // whose stored Hebrew sense still matches may teach the learned meaning.
    const example = reviewed ? reviewed[1] : '';
    return {
      meaning: meanings(item.t)[0] || item.t || '',
      example,
      context: example,
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
