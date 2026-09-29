/**
 * One spelling for the Rebbe's Yiddish in transcripts: the farbrengen
 * booklets' written style (Shmuly, 2026-09-29: "booklets is good"). Most
 * booklets write אויך, דעמאלט, ברענגט, וואנענט and keep abbreviations as
 * written (ע"י). People correcting a transcript are shown it, so what they
 * check trains the next model in one spelling; the training run rewrites
 * other texts into it the same way (the transcripts thread's spelling.py,
 * which follows this list: this copy is the master). The editor only
 * hints; `toHouseSpelling` is the rewrite a training run makes.
 */

/** Whole words, as sometimes written by ear, and as the booklets write them. */
export const HOUSE_SPELLING_WORDS: Readonly<Record<string, string>> = {
  אויכעט: 'אויך',
  דעמולט: 'דעמאלט',
  וואנעט: 'וואנענט',
  ואדרבה: 'ואדרבא',
  אדרבה: 'אדרבא',
  קאן: 'קען',
  קאנען: 'קענען',
  געקאנט: 'געקענט',
  יעדערען: 'יעדערן',
  גוים: 'גויים',
  תהילים: 'תהלים',
  שלושה: 'שלשה',
  שלושים: 'שלשים',
  שישים: 'ששים',
};

/** Inside words too (אראפבריינגען, בחמישה). */
export const HOUSE_SPELLING_PARTS: Readonly<Record<string, string>> = {
  בריינג: 'ברענג',
  פארליינג: 'פארלאנג',
  חמישה: 'חמשה',
};

/** After עם, words that make it Loshon Kodesh (עם ישראל, עם זה); otherwise עם is the Yiddish "him", written אים. */
export const HOUSE_SPELLING_HEBREW_AFTER: ReadonlySet<string> = new Set(['זה', 'ישראל', 'הדרת', 'הארץ', 'אחד', 'כל', 'קדוש', 'סגולה', 'ולשון', 'נח', 'לבדד', 'ועם', 'בני', 'חכם', 'נבון', 'רב']);

/** A token's leading marks, a מ' or ס' contraction, its word, and its trailing marks. */
function parts(token: string): [string, string, string, string] {
  const m = /^([^א-ת]*)((?:[מס]')?)(.*?)([^א-ת']*)$/.exec(token)!;
  return [m[1]!, m[2]!, m[3]!, m[4]!];
}

function houseWord(word: string): string {
  let house = HOUSE_SPELLING_WORDS[word] ?? word;
  for (const [from, to] of Object.entries(HOUSE_SPELLING_PARTS)) house = house.replaceAll(from, to);
  return house;
}

/** A text rewritten into the house spelling, word for word (and ׳ ״ as ' "): what a training run does to text written otherwise. */
export function toHouseSpelling(text: string): string {
  const tokens = text.replaceAll('׳', "'").replaceAll('״', '"').split(/\s+/).filter(Boolean);
  return tokens
    .map((token, i) => {
      const [lead, contraction, word, trail] = parts(token);
      let house = houseWord(word);
      if (word === 'עם' && !contraction) {
        const next = i + 1 < tokens.length ? parts(tokens[i + 1]!)[2] : '';
        if (!HOUSE_SPELLING_HEBREW_AFTER.has(next) && !next.startsWith("ה'")) house = 'אים';
      }
      return lead + contraction + house + trail;
    })
    .join(' ');
}

/** The words of a text written other than the house way, each once, with the house spelling; עם is left alone (often Loshon Kodesh). */
export function spellingHints(text: string): Array<{ written: string; house: string }> {
  const hints = new Map<string, string>();
  if (/[׳״]/.test(text)) hints.set('׳ ״', `' "`);
  for (const token of text.replaceAll('׳', "'").split(/\s+/)) {
    const word = parts(token)[2];
    if (!word) continue;
    const house = houseWord(word);
    if (house !== word) hints.set(word, house);
  }
  return [...hints].map(([written, house]) => ({ written, house }));
}
