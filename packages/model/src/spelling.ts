/**
 * One spelling for the Rebbe's Yiddish in transcripts: the farbrengen
 * booklets' written style (Shmuly, 2026-09-29: "booklets is good"). Most
 * booklets write אויך, דעמאלט, ברענגט, וואנענט and keep abbreviations as
 * written (ע"י). People correcting a transcript are shown it, so what they
 * check trains the next model in one spelling; the training run rewrites
 * other texts into it the same way (the transcripts thread's spelling.py,
 * whose list this mirrors). Hints only: nothing is changed for anyone.
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

/** The words of a text written other than the house way, each once, with the house spelling. */
export function spellingHints(text: string): Array<{ written: string; house: string }> {
  const hints = new Map<string, string>();
  if (/[׳״]/.test(text)) hints.set('׳ ״', `' "`);
  for (const token of text.split(/\s+/)) {
    const word = token.replace(/^[^א-ת]+|[^א-ת']+$/g, '').replace(/^[מס]'/, '');
    if (!word) continue;
    let house = HOUSE_SPELLING_WORDS[word] ?? word;
    for (const [from, to] of Object.entries(HOUSE_SPELLING_PARTS)) house = house.replaceAll(from, to);
    if (house !== word) hints.set(word, house);
  }
  return [...hints].map(([written, house]) => ({ written, house }));
}
