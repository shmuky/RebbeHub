/*
 * Model descriptions and benchmarks: CC BY-NC-ND 4.0. The models are not
 * released; all rights reserved.
 *
 * This file is under that licence, not the repository's AGPL-3.0; so are
 * docs/models.md and the /models page that renders it.
 */

/**
 * RebbeHub's own models and their scores, for the /models page: what each
 * one reads or hears, which one is in use, the test it was scored on (one
 * it never learned from) and every number, as docs/models.md has them.
 * Only descriptions and scores are published, never the models or how they
 * are made. The numbers are kept as written there, strings and all, so the
 * page shows exactly what was measured; a new score goes in both places.
 */

export interface L {
  he: string;
  en: string;
}

/** Where a model stands: the one in use, one an in-use model replaced, the base it started from, or a candidate that did not win. */
export type ModelState = 'inUse' | 'superseded' | 'start' | 'notUsed';

export interface ScoreRow {
  /** A model's own name (Latin, as it is kept), or a description in both languages. */
  name: string | L;
  /** Numbers as measured, or a few words where there is no number. */
  cells: Array<string | L>;
  state?: ModelState;
}

export interface ScoreTable {
  id: string;
  title: L;
  /** The test set, in plain words. */
  test: L;
  columns: L[];
  rows: ScoreRow[];
  note?: L;
}

export interface Model {
  name: string;
  does: L;
  state: ModelState;
}

export interface ModelFamily {
  id: 'ocr' | 'miram' | 'whisper';
  title: L;
  intro: L;
  models: Model[];
  tables: ScoreTable[];
  weak: L[];
  next?: L;
}

export const MODELS_LICENCE: L = {
  he: 'תיאורי המודלים ומדדי הביצוע: CC BY-NC-ND 4.0. המודלים עצמם אינם משוחררים; כל הזכויות שמורות.',
  en: 'Model descriptions and benchmarks: CC BY-NC-ND 4.0. The models are not released; all rights reserved.',
};

export const STATE_NAME: Record<ModelState, L> = {
  inUse: { he: 'בשימוש', en: 'in use' },
  superseded: { he: 'הוחלף', en: 'superseded' },
  start: { he: 'נקודת ההתחלה', en: 'where it started' },
  notUsed: { he: 'לא בשימוש', en: 'not used' },
};

const c = (he: string, en: string): L => ({ he, en });

const LETTERS = c('אותיות', 'Letters');
const WORDS = c('מילים', 'Words');
const LINES = c('שורות מושלמות', 'Lines perfect');
const BODY = c('גוף', 'Body');
const NOTES = c('הערות', 'Notes');
const MISTAKES = c('טעויות', 'Mistakes');
const HARD = c('אותיות דומות', 'Hard');
const DASH = c('מקף נשמט / נוסף', 'Dash dropped / added');
const DOTS = c('נקודות נשמטו / נוספו', 'Dots dropped / added');
const FULL = [c('מודל או מועמד', 'Model or candidate'), LETTERS, WORDS, LINES, BODY, NOTES, MISTAKES, HARD, DASH, DOTS];

const TEST_4500 = c(
  '4,500 שורות מלקוטי שיחות חלק לט שאף מודל לא למד מהן. מפתח התשובות הוא הטקסט המוקלד, מתוקן מול הסריקה, ועוד 35 מקפים ו״. . .״ בקצות שורות שחסרו בו ומופיעים בסריקה.',
  '4,500 lines of Likkutei Sichos vol 39 that no model learned from. The answer key is the typed text, corrected against the scan, with 35 line-edge dashes and ". . ." added that the typed text lacked and the scan has.',
);

export const MODEL_FAMILIES: ModelFamily[] = [
  {
    id: 'ocr',
    title: c('קורא לקוטי שיחות (OCR)', 'The Likkutei Sichos reader (OCR)'),
    intro: c(
      'קורא כל שורה בעמוד סרוק של לקוטי שיחות לטקסט. ״אותיות״ ו״מילים״: כמה נקראו נכון; ״שורות מושלמות״: שורות שנקראו כולן בלי טעות אחת; ״גוף״ ו״הערות״: ציון האותיות בפנים ובהערות; ״אותיות דומות״: החלפות של ב/כ, ת/ח, ז/ן/ו.',
      'Reads each line of a scanned Likkutei Sichos page into text. Letters and Words: how many were read right; Lines perfect: whole lines read with no mistake at all; Body and Notes: the letter score in the main text and in the footnotes; Hard: mix-ups of the look-alikes ב/כ, ת/ח, ז/ן/ו.',
    ),
    models: [
      { name: 'rebbehub-kraken-ls-v1', does: c('קורא את לקוטי שיחות מהסריקות; קורא עכשיו את חלקים טו-כה', 'Reads Likkutei Sichos from the scans; reading vols 15-25 now'), state: 'inUse' },
      { name: 'rebbehub-kraken-v1', does: c('קורא את המפתחות; לא נבדק כאן', 'Reads the maftechos (indexes); not scored here'), state: 'inUse' },
    ],
    tables: [
      {
        id: 'ocr-headline',
        title: c('עיקר התוצאות', 'Headline'),
        test: TEST_4500,
        columns: [c('מודל', 'Model'), LETTERS, WORDS, LINES],
        rows: [
          { name: c('PP-OCRv6, כמו שהוא', 'PP-OCRv6, as it came'), cells: ['96.45%', '86.39%', c('כ-44%', 'about 44%')], state: 'start' },
          { name: c('מועמד קודם (הטוב שלפניו)', 'An earlier candidate (the best before it)'), cells: ['99.82%', '99.41%', '96.1%'], state: 'superseded' },
          { name: 'rebbehub-kraken-ls-v1', cells: ['99.91%', '99.68%', '97.7%'], state: 'inUse' },
          { name: c('+ בדיקת המילים אחרי הקריאה', '+ the word check after reading'), cells: ['99.88%*', '99.60%*', '97.3%*'], state: 'inUse' },
          { name: c('מועמד מאוחר (הטוב שבו)', 'A later candidate (its best)'), cells: ['99.87%', '99.51%', '97.0%'], state: 'notUsed' },
        ],
        note: c(
          '* נבדק מול מפתח מחמיר יותר (בלי 35 הסימנים שנוספו), ולכן אינו נמוך מהשורה שמעליו: מול אותו מפתח בדיקת המילים רק מתקנת. היא תיקנה 15 מתוך 16 השורות עם טעות באותיות דומות, ולא קלקלה אף שורה.',
          '* Scored on a stricter answer key (without the 35 added marks), so it is not lower than the line above: on the same key the word check only fixes lines. It fixed 15 of the 16 lines with a hard-letter mistake and broke none.',
        ),
      },
      {
        id: 'ocr-candidates',
        title: c('כל המועמדים על 4,500 השורות', 'Every candidate on the 4,500 lines'),
        test: TEST_4500,
        columns: FULL,
        rows: [
          { name: 'recover start', cells: ['99.65', '98.38', '88.9', '99.70', '99.33', '699', '74', '15 / 10', '15 / 2'] },
          { name: '00-0.9985', cells: ['99.81', '99.41', '96.2', '99.82', '99.79', '372', '24', '57 / 1', '43 / 0'] },
          { name: '00-0.9986', cells: ['99.83', '99.37', '96.0', '99.85', '99.73', '338', '19', '41 / 6', '26 / 1'] },
          { name: '00-0.9984', cells: ['99.83', '99.36', '95.9', '99.84', '99.74', '346', '14', '33 / 1', '34 / 2'] },
          { name: '00-0.9986-v1', cells: ['99.80', '99.30', '95.6', '99.82', '99.70', '399', '18', '57 / 0', '47 / 0'] },
          { name: '01-0.9986', cells: ['99.82', '99.36', '95.8', '99.85', '99.65', '366', '20', '55 / 1', '27 / 2'] },
          { name: '01-0.9986-v1', cells: ['99.83', '99.40', '96.0', '99.85', '99.68', '347', '17', '49 / 0', '33 / 0'] },
          { name: '01-0.9987', cells: ['99.82', '99.38', '96.0', '99.84', '99.69', '361', '17', '49 / 0', '41 / 0'] },
          { name: '01-0.9987-v1', cells: ['99.82', '99.41', '96.1', '99.84', '99.69', '357', '18', '51 / 0', '42 / 0'], state: 'superseded' },
          { name: 'rebbehub-kraken-ls-v1', cells: ['99.91', '99.68', '97.7', '99.93', '99.81', '179', '18', '4 / 0', '6 / 1'], state: 'inUse' },
        ],
        note: c(
          'בלי 35 הסימנים שנוספו הוא עדיין מנצח: 99.87% אותיות ו-97.0% שורות מושלמות, מול 99.84% ו-96.3%. הוא חצה את הטעויות (357 ל-179), כמעט כולן סימנים: מקפים שנשמטו מ-51 ל-4, נקודות מ-42 ל-6. באותיות הדומות לא השתנה דבר (18 ל-18).',
          'Without the 35 added marks it still wins: 99.87% letters and 97.0% lines perfect, against 99.84% and 96.3%. It halved the mistakes (357 to 179), almost all of them marks: dropped dashes 51 to 4, dropped dots 42 to 6. The hard letters did not move (18 to 18).',
        ),
      },
      {
        id: 'ocr-later',
        title: c('המועמדים המאוחרים', 'The later candidates'),
        test: c(
          'אותן 4,500 שורות, ומפתח של הטקסט המוקלד ועוד 24 סימנים בקצות שורות; rebbehub-kraken-ls-v1 נקרא שוב באותה דרך להשוואה.',
          'The same 4,500 lines, with a key of the typed text plus 24 line-edge marks; rebbehub-kraken-ls-v1 read again the same way, to compare.',
        ),
        columns: FULL,
        rows: [
          { name: 'rebbehub-kraken-ls-v1', cells: ['99.90', '99.63', '97.5', '99.91', '99.80', '206', '20', '4 / 1', '0 / 10'], state: 'inUse' },
          { name: 'r3-00-0.9982-2347', cells: ['99.83', '99.38', '95.8', '99.84', '99.74', '348', '59', '38 / 0', '10 / 3'] },
          { name: 'r3-00-0.9983-0003', cells: ['99.83', '99.35', '95.8', '99.85', '99.74', '337', '41', '37 / 0', '6 / 5'] },
          { name: 'r3-00-0.9984-0019', cells: ['99.87', '99.51', '97.0', '99.88', '99.81', '258', '22', '21 / 0', '10 / 2'], state: 'notUsed' },
          { name: 'r3-00-0.9986-0035', cells: ['99.83', '99.43', '96.5', '99.83', '99.83', '338', '18', '39 / 1', '11 / 1'] },
          { name: 'r3-01-0.9984-0050', cells: ['99.83', '99.47', '96.5', '99.84', '99.79', '339', '21', '51 / 0', '11 / 1'] },
          { name: 'r3-01-0.9984-v1-0105', cells: ['99.84', '99.48', '96.6', '99.84', '99.82', '323', '21', '47 / 0', '11 / 1'] },
          { name: 'r3-01-0.9984-v2-0137', cells: ['99.84', '99.48', '96.6', '99.84', '99.81', '327', '21', '44 / 0', '11 / 1'] },
          { name: 'r3-01-0.9985-0120', cells: ['99.84', '99.49', '96.8', '99.85', '99.81', '318', '23', '42 / 0', '11 / 2'] },
          { name: 'r3-final-ppm_best', cells: ['99.83', '99.43', '96.5', '99.83', '99.83', '338', '18', '39 / 1', '11 / 1'] },
        ],
        note: c('אף אחד מהם אינו טוב ממנו; הפער כמעט כולו מקפים שנשמטו בפתיחת שורה.', 'None beats it; the gap is almost all dropped line-opening dashes.'),
      },
      {
        id: 'ocr-300',
        title: c('300 שורות בדוקות מחלק לט', '300 checked lines of vol 39'),
        test: c(
          'מבחן מוקדם וקטן יותר: 300 שורות מחלק לט שמפתח התשובות שלהן נבדק שורה שורה מול הסריקה. ההבדלים בין המועמדים כאן הם 1 עד 6 טעויות ב-300 שורות, בגבולות הרעש, ולכן 4,500 השורות מכריעות.',
          'An earlier, smaller test: 300 lines of vol 39 whose answer key was checked line by line against the scan. The differences between candidates here are 1 to 6 mistakes in 300 lines, within noise, which is why the 4,500 lines decide.',
        ),
        columns: [c('מודל או מועמד', 'Model or candidate'), LETTERS, WORDS, LINES, BODY, NOTES, MISTAKES],
        rows: [
          { name: c('PP-OCRv6, כמו שהוא', 'PP-OCRv6, as it came'), cells: ['96.48%', '86.07%', '44.3%', '96.41%', '96.95%', '459'], state: 'start' },
          { name: 's2-00-0.9953', cells: ['99.82%', '99.24%', '94.7%', '99.8%', '99.94%', '24'] },
          { name: 's2-00-0.9982', cells: ['99.9%', '99.64%', '97.7%', '99.89%', '100.0%', '13'] },
          { name: 's2-00-0.9981', cells: ['99.92%', '99.64%', '97.7%', '99.93%', '99.88%', '10'] },
          { name: 's2-abort', cells: ['99.92%', '99.64%', '97.3%', '99.93%', '99.82%', '11'] },
          { name: 's2-00-0.9986', cells: ['99.95%', '99.68%', '98.0%', '99.94%', '100.0%', '7'] },
          { name: 's2-00-0.9982-v1', cells: ['99.95%', '99.72%', '98.0%', '99.94%', '100.0%', '7'] },
          { name: 's2-00-0.9984', cells: ['99.89%', '99.52%', '96.7%', '99.89%', '99.82%', '15'] },
          { name: 's2-00-0.9980', cells: ['99.9%', '99.56%', '97.0%', '99.92%', '99.77%', '13'] },
          { name: 's2-01-0.9982', cells: ['99.92%', '99.6%', '97.0%', '99.95%', '99.77%', '10'] },
          { name: 's2-01-0.9979', cells: ['99.92%', '99.52%', '97.3%', '99.92%', '99.88%', '11'] },
          { name: 's2-00-0.9985', cells: ['99.92%', '99.68%', '98.0%', '99.91%', '100.0%', '10'] },
        ],
      },
      {
        id: 'ocr-yiddish',
        title: c('ספקות הקורא בחלקים טו-יז', "The reader's doubts on vols 15-17"),
        test: c(
          'החלקים הראשונים שקרא (182 שיחות, 725 אלף מילים), רובם ביידיש: 157 שיחות מול 25 בלשון הקודש. אין להם טקסט מוקלד להשוות אליו, ולכן אלה ספקות הקורא עצמו, הערכה ולא ציון שנמדד.',
          'The first volumes it read (182 sichos, 725k words), mostly Yiddish: 157 sichos against 25 Hebrew. There is no typed text of them to compare with, so these are the reader’s own doubts, an estimate, not a measured score.',
        ),
        columns: [c('טקסט', 'Text'), WORDS, c('ביטחון מתחת ל-0.9', 'Confidence below 0.9'), c('מתחת ל-0.6', 'Below 0.6')],
        rows: [
          { name: c('שיחות בלשון הקודש, גוף', 'Hebrew sichos, body'), cells: ['43,178', '1.24%', '0.33%'] },
          { name: c('שיחות ביידיש, גוף', 'Yiddish sichos, body'), cells: ['402,534', '2.81%', '0.64%'] },
          { name: c('שיחות בלשון הקודש, הערות', 'Hebrew sichos, notes'), cells: ['7,548', '2.04%', '0.46%'] },
          { name: c('שיחות ביידיש, הערות (רובן בלשון הקודש)', 'Yiddish sichos, notes (mostly Hebrew)'), cells: ['189,563', '1.85%', '0.49%'] },
        ],
      },
    ],
    weak: [
      c('יידיש: בגוף הטקסט ביידיש הקורא מסופק בערך פי שניים מאשר בלשון הקודש. זה הפער הגדול ביותר.', 'Yiddish: on Yiddish body text the reader is about twice as unsure as on Hebrew. That is the biggest gap.'),
      c('אותיות דומות: ב/כ, ת/ח, ז/ן (כ-18 ב-4,500 השורות; בדיקת המילים מתקנת את רובן).', 'Look-alike letters: ב/כ, ת/ח, ז/ן (about 18 in the 4,500 lines; the word check fixes most).'),
      c('פ ו-ט נקראות ס באות הקטנה של ההערות (פירוש כ״סירוש״, הבעש״ט כ״הבעש״ס״).', 'פ and ט read as ס in the small note type (פירוש as סירוש, הבעש"ט as הבעש"ס).'),
      c('הנקודה שמתחת לאל״ף ביידיש נשמטת לפעמים.', 'The point under a Yiddish alef is dropped now and then.'),
      c('כוכבית ״*״ לבדה אינה נקראת בידי הקורא; היא נלקחת מהדיו.', 'Bare stars "*" are not read by the reader; they are taken from the ink.'),
    ],
    next: c('הבא: סבב ליידיש, ואחריו אותה בדיקה שוב, לראות שהפער נסגר.', 'Next: a round for Yiddish, scored again the same way to see the gap close.'),
  },
  {
    id: 'miram',
    title: c('גלאי המירם (מודגש)', 'The Miram (bold) detector'),
    intro: c(
      'בשיחות הרבי אותיות מירם מסמנות את המילים המודגשות, ו-RebbeHub מציג אותן מודגשות. הגלאי אומר, מילה במילה, אילו מילים בעמוד הן במירם.',
      "In the Rebbe's sichos, Miram type marks the stressed words, and RebbeHub shows them as bold. The detector says, word by word, which words on a page are in Miram.",
    ),
    models: [
      { name: 'rebbehub-facenet-v2', does: c('מוצא אילו מילים בעמוד הן במירם', 'Finds which words on a page are in Miram'), state: 'inUse' },
      { name: 'rebbehub-facenet-v1', does: c('מוצא אילו מילים בעמוד הן במירם', 'Finds which words on a page are in Miram'), state: 'superseded' },
    ],
    tables: [
      {
        id: 'miram-pages',
        title: c('חמישה עמודים שנבדקו בעין', 'Five pages checked by eye'),
        test: c(
          'חמישה עמודי שיחה רגילים (לח:מ, לד:מב, לא:צג, לו:נ, לג:ע), 1,832 מילים, 82 מהן במירם, כל מילה נבדקה בעין.',
          'Five regular sicha pages (38:40, 34:42, 31:93, 36:50, 33:70), 1,832 words, 82 of them in Miram, each word checked by eye.',
        ),
        columns: [c('מודל', 'Model'), c('מילים שמסכימות עם העין', 'Words agreeing with the eye')],
        rows: [
          { name: c('כללי עובי, בלי מודל', 'Thickness rules, no model'), cells: [c('מילים חלקיות; מחמיץ הערות מירם שלמות', 'partial words; misses whole Miram notes')], state: 'superseded' },
          { name: 'rebbehub-facenet-v1', cells: ['1,832 / 1,832'], state: 'superseded' },
          { name: 'rebbehub-facenet-v2', cells: ['1,832 / 1,832'], state: 'inUse' },
        ],
        note: c(
          'סבב הבדיקה הראשון (2026-10-02) מצא 12 מילות מירם שהוחמצו, כולן בעמודים שנבנו לפני ש-rebbehub-facenet-v2 רץ. חמישה עמודים הם מבחן קטן; כל עמוד שנבדק בכלי הבדיקה מוסיף לו.',
          'The first review round (2026-10-02) found 12 Miram misses, all on pages built before rebbehub-facenet-v2 ran. Five pages is a small test; every page checked in the review tool adds to it.',
        ),
      },
    ],
    weak: [c('המבחן קטן: חמישה עמודים.', 'The test is small: five pages.')],
  },
  {
    id: 'whisper',
    title: c('קול הרבי לטקסט (Whisper)', "The Rebbe's voice to text (Whisper)"),
    intro: c(
      'שומע הקלטה של הרבי ביידיש וכותב אותה, כל מילה עם הזמן שלה. הציונים הם מילים שגויות / אותיות שגויות (WER / CER); נמוך יותר טוב יותר.',
      "Hears a recording of the Rebbe's Yiddish and writes it down, each word timed. Scores are words wrong / letters wrong (WER / CER); lower is better.",
    ),
    models: [
      { name: 'rebbehub-whisper-v3', does: c('שומע את היידיש של הרבי וכותב אותה', "Hears the Rebbe's Yiddish and writes it down"), state: 'inUse' },
      { name: 'rebbehub-whisper-v2', does: c('שומע את היידיש של הרבי וכותב אותה', "Hears the Rebbe's Yiddish and writes it down"), state: 'superseded' },
      { name: 'rebbehub-whisper-v1', does: c('שומע את היידיש של הרבי וכותב אותה', "Hears the Rebbe's Yiddish and writes it down"), state: 'superseded' },
    ],
    tables: [
      {
        id: 'whisper-held-out',
        title: c('התוועדויות שלא נלמדו', 'Held-out farbrengens'),
        test: c('התוועדויות שאף גרסה לא למדה מהן, בכתיב החוברות.', "Farbrengens no version learned from, in the booklets' spelling."),
        columns: [c('נבדק על', 'Held out'), c('ivrit.ai Yiddish (נקודת ההתחלה)', 'ivrit.ai Yiddish (where it started)'), c('v1', 'v1'), c('v2', 'v2'), c('v3 (בשימוש)', 'v3 (in use)')],
        rows: [
          { name: c('שלוש התוועדויות תשמ״ב, 395 קטעים', 'Three farbrengens of 5742, 395 clips'), cells: ['', '', '11.8% / 5.7%', '10.1% / 5.2%'] },
          { name: c('י״ז תמוז תשמ״ב, 109 קטעים', '17 Tammuz 5742, 109 clips'), cells: ['', '', '10.8% / 4.6%', '8.2% / 3.8%'] },
          { name: c('י״א ניסן תשל״ג (תקופה מוקדמת), 344 קטעים', '11 Nissan 5733 (an older era), 344 clips'), cells: ['', '', '13.7% / 5.2%', '13.7% / 5.1%'] },
          { name: c('י״ז תמוז תשמ״ב, כל 29 הדקות', '17 Tammuz 5742, the whole 29 minutes'), cells: ['58% / 28%', '13.0% / 5.9%', '11.9% / 5.3%', '11.5% / 5.5%'] },
        ],
      },
      {
        id: 'whisper-when-new',
        title: c('כפי שכל גרסה נבדקה כשהייתה חדשה', 'As each version was scored when it was new'),
        test: c(
          'הציון של v3 על תשמ״ב הוא בכתיב החוברות והקודמים לא, ולכן הטבלה שלמעלה היא זו שמשווים לפיה.',
          "v3's 5742 score is in the booklets' spelling and the earlier ones were not, so the table above is the one to compare by.",
        ),
        columns: [c('מודל', 'Model'), c('התוועדויות תשמ״ב', '5742 farbrengens'), c('י״א ניסן תשל״ג', '11 Nissan 5733'), c('כל י״ז תמוז תשמ״ב (29 דקות)', 'Whole 17 Tammuz 5742 (29 min)')],
        rows: [
          { name: 'ivrit.ai Yiddish', cells: [c('כ-60%', 'about 60%'), '', ''], state: 'start' },
          { name: 'rebbehub-whisper-v1', cells: ['12% / 6%', '22.5% / 9.0%', '13.0% / 5.9%'], state: 'superseded' },
          { name: 'rebbehub-whisper-v2', cells: ['9.5% / 4.8%', '13.8% / 5.2%', '11.9% / 5.3%'], state: 'superseded' },
          { name: 'rebbehub-whisper-v3', cells: ['10.1% / 5.2%', '13.7% / -', '11.5% / 5.5%'], state: 'inUse' },
        ],
      },
    ],
    weak: [
      c('מילים נדירות (״תנות״ במקום ״תענית״).', 'Rarer words (תנות for תענית).'),
      c('השנים המוקדמות (י״א ניסן תשל״ג למעלה).', 'The older years (11 Nissan 5733 above).'),
    ],
    next: c('הבא: v4, שייבדק על אותן התוועדויות ויוכנס לשימוש רק אם יהיה טוב יותר.', 'Next: a v4, scored on the same held-out farbrengens and used only if it scores better.'),
  },
];
