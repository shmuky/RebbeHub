import type { Lang } from './i18n.js';

/**
 * The words of phase 6's pages (search in the texts and by meaning, an
 * item's links, the health of the catalog), Hebrew first and English in
 * full, as in i18n.ts; kept in their own table beside it.
 */
const STRINGS = {
  noTranscriptYet: { he: 'עוד אין תמלול', en: 'no transcript yet' },
  partsWithoutTranscript: { he: 'חלקים בלי תמלול', en: 'parts without a transcript' },
  inTheTexts: { he: 'בתוך הטקסטים', en: 'In the texts' },
  inTheTextsHint: { he: 'שורות בסריקות ופסקאות בתמלולים: הקישור פותח את המקום עצמו.', en: 'Lines on scans and paragraphs of transcripts: each link opens the very place.' },
  onScanPage: { he: 'עמוד', en: 'page' },
  heardAt: { he: 'נשמע ב־', en: 'heard at ' },
  transcriptOf: { he: 'תמלול', en: 'Transcript' },
  textOf: { he: 'טקסט', en: 'Text' },
  machineRead: { he: 'קריאת מכונה, לא נבדקה', en: 'machine reading, not checked' },
  machineHeard: { he: 'תמלול מכונה, לא נבדק', en: 'machine transcript, not checked' },
  byWords: { he: 'לפי מילים', en: 'By words' },
  byMeaning: { he: 'לפי רעיון', en: 'By idea' },
  byMeaningHint: {
    he: 'כתבו רעיון או שאלה, ונמצא שיחות ודברים שעוסקים בו, גם במילים אחרות.',
    en: 'Write an idea or a question, and find sichos and passages about it, even in other words.',
  },
  byMeaningMachine: {
    he: 'התוצאות נבחרו במכונה, לפי קרבת משמעות, ולא נבדקו בידי אדם. בדקו במקור.',
    en: 'These results were chosen by machine, by nearness of meaning, and no person has checked them. Check the source.',
  },
  foundByMachine: { he: 'נמצא במכונה', en: 'found by machine' },
  nearness: { he: 'קרבה', en: 'nearness' },
  playFromHere: { he: 'השמעה מכאן', en: 'Play from here' },
  foundHere: { he: 'כאן נמצא מה שחיפשתם', en: 'What you searched for is here' },
  // An item's links.
  links: { he: 'קישורים', en: 'Links' },
  rel_out_cites: { he: 'מביא את', en: 'Cites' },
  rel_in_cites: { he: 'מובא ב', en: 'Cited by' },
  'rel_out_printed-in': { he: 'נדפס ב', en: 'Printed in' },
  'rel_in_printed-in': { he: 'נדפס כאן', en: 'Printed here' },
  'rel_out_based-on': { he: 'מיוסד על ההתוועדות', en: 'Based on this farbrengen' },
  'rel_in_based-on': { he: 'מה שמיוסד על זה', en: 'Based on this' },
  'rel_out_translation-of': { he: 'תרגום של', en: 'Translation of' },
  'rel_in_translation-of': { he: 'תרגומים', en: 'Translations' },
  'rel_out_answer-to': { he: 'מענה על', en: 'Answer to' },
  'rel_in_answer-to': { he: 'מענות', en: 'Answers' },
  'rel_out_same-recording-as': { he: 'אותה הקלטה כמו', en: 'Same recording as' },
  'rel_in_same-recording-as': { he: 'אותה הקלטה כמו', en: 'Same recording as' },
  rel_out_reproduces: { he: 'מעתיק את', en: 'Reproduces' },
  rel_in_reproduces: { he: 'הועתק ב', en: 'Reproduced in' },
  machineLinks: { he: 'קישורים שנמצאו במכונה מסומנים; עדיין לא נבדקו בידי אדם.', en: 'Links found by machine are marked; no person has checked them yet.' },
  // The health of the catalog.
  healthTitle: { he: 'מצב הקטלוג', en: 'Health of the catalog' },
  healthIntro: {
    he: 'כמה מהקטלוג כבר מלא, ומה עוד מחכה לעזרה: לפי שנה ולפי סט, עמודים שלא נבדקו, הקלטות שלא סונכרנו, קישורים שאינם עונים, והצעות שמחכות הכי הרבה זמן.',
    en: 'How much of the catalog is filled in, and what still waits for help: by year and by set, pages nobody has checked, recordings not synced, links that no longer answer, and the suggestions waiting longest.',
  },
  healthYears: { he: 'התוועדויות לפי שנה', en: 'Farbrengens by year' },
  healthYear: { he: 'שנה', en: 'Year' },
  healthEvents: { he: 'התוועדויות', en: 'Farbrengens' },
  healthWithRecording: { he: 'עם הקלטה', en: 'With a recording' },
  healthWithText: { he: 'עם טקסט', en: 'With a text' },
  healthWithTranscript: { he: 'עם תמלול', en: 'With a transcript' },
  healthSets: { he: 'לפי סט', en: 'By set' },
  healthItems: { he: 'פריטים', en: 'items' },
  healthPages: { he: 'עמודים שלא נבדקו', en: 'Pages nobody has checked' },
  healthPagesLine: { he: 'עמודי סריקות שנקראו במכונה; מהם נבדקו בידי אדם:', en: 'Pages of scans read by machine; checked by a person:' },
  healthRecordings: { he: 'הקלטות שלא סונכרנו', en: 'Recordings not synced' },
  healthRecordingsLine: { he: 'הקלטות; עם תמלול; מסונכרנות:', en: 'Recordings; with a transcript; synced:' },
  healthLinks: { he: 'קישורים שאינם עונים', en: 'Links that do not answer' },
  healthLinksLine: { he: 'קישורים שנבדקו; אינם עונים:', en: 'Links checked; not answering:' },
  healthLinksNever: { he: 'הקישורים עוד לא נבדקו.', en: 'The links have not been checked yet.' },
  healthLastChecked: { he: 'נבדקו לאחרונה', en: 'last checked' },
  healthFailingSince: { he: 'לא עונה מאז', en: 'failing since' },
  healthSuggestions: { he: 'הצעות שמחכות הכי הרבה זמן', en: 'Suggestions waiting longest' },
  healthNoSuggestions: { he: 'אין הצעות שמחכות לבדיקה.', en: 'No suggestions are waiting for review.' },
  healthWaitingSince: { he: 'מחכה מאז', en: 'waiting since' },
  healthMeaning: { he: 'חיפוש לפי רעיון', en: 'Search by idea' },
  healthMeaningLine: { he: 'פריטים שכבר נקראו לחיפוש לפי רעיון; מחכים:', en: 'Items read for search by idea; waiting:' },
  healthNothing: { he: 'אין כאן כלום כרגע.', en: 'Nothing here right now.' },
  bot: { he: 'מכונה', en: 'machine' },
} as const;

export type NetworkStringKey = keyof typeof STRINGS;

export function tn(lang: Lang, key: NetworkStringKey): string {
  return STRINGS[key][lang];
}

/** "Cites", "Cited by", "Printed in"...: a link's heading, seen from the page it is shown on. */
export function relationHeading(kind: string, direction: 'in' | 'out', lang: Lang): string {
  const key = `rel_${direction}_${kind}` as NetworkStringKey;
  return key in STRINGS ? tn(lang, key) : kind;
}

/** Minutes and seconds (or hours) of a moment in a recording: 12:34, 1:02:03. */
export function clockOf(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
