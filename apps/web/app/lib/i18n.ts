import type { LocalName } from '@rebbehub/model';

/**
 * Hebrew first, English in full. The language is part of the address -
 * `?lang=en`, carried by every link - and never a cookie, so each address
 * always shows the same page: search engines index both languages and
 * caches never serve one language for the other.
 */
export type Lang = 'he' | 'en';

export function langFrom(request: Request): Lang {
  const url = new URL(request.url);
  const param = url.searchParams.get('lang');
  return param === 'en' ? 'en' : 'he';
}

export const dir = (lang: Lang) => (lang === 'he' ? 'rtl' : 'ltr');

/** A name in the page's language, falling back to Hebrew. */
export function nameOf(name: LocalName | undefined | null, lang: Lang): string {
  if (!name) return '';
  return (lang === 'en' ? name.en : name.he) || name.he || name.en || '';
}

const STRINGS = {
  siteName: { he: 'RebbeHub', en: 'RebbeHub' },
  tabWeek: { he: 'השבוע', en: 'This week' },
  tabFarbrengens: { he: 'התוועדויות', en: 'Farbrengens' },
  tabLibrary: { he: 'ספרייה', en: 'Library' },
  player: { he: 'נגן', en: 'Player' },
  pause: { he: 'השהיה', en: 'Pause' },
  previousPart: { he: 'החלק הקודם', en: 'Previous part' },
  nextPart: { he: 'החלק הבא', en: 'Next part' },
  playError: { he: 'לא ניתן לנגן כעת', en: 'Cannot play right now' },
  position: { he: 'מיקום בהקלטה', en: 'Position' },
  parts: { he: 'חלקים', en: 'Parts' },
  closePlayer: { he: 'סגירת הנגן', en: 'Close the player' },
  parshas: { he: 'פרשת', en: 'Parshas' },
  thisWeekIn: { he: 'השבוע בשנת', en: 'This week in' },
  kviusNote: { he: 'שנה באותה קביעות כמו השנה: הימים והפרשיות חלים כמו השבוע', en: 'A year whose calendar falls like this one: the same days and parshiyos as this week' },
  otherKviusYears: { he: 'שנים נוספות באותה קביעות', en: 'Other years with the same calendar' },
  everyYear: { he: 'השבוע בכל השנים', en: 'This week, every year' },
  todayEveryYear: { he: 'היום בכל השנים', en: 'Today, every year' },
  hanacha: { he: 'הנחה', en: 'Hanacha' },
  texts: { he: 'טקסטים', en: 'Texts' },
  listen: { he: 'האזנה', en: 'Listen' },
  playAll: { he: 'השמעת הכול', en: 'Play all' },
  playsNow: { he: 'מתנגן', en: 'Playing' },
  sameDateOtherYears: { he: 'בתאריך הזה בשנים אחרות', en: 'This date in other years' },
  previous: { he: 'הקודם', en: 'Previous' },
  next: { he: 'הבא', en: 'Next' },
  noFarbrengensThisWeek: { he: 'לא נמצאו התוועדויות בשבוע הזה בשנה זו.', en: 'No farbrengens are listed for this week in that year.' },
  allOfYear: { he: 'כל השנה', en: 'The whole year' },
  allOfMonth: { he: 'כל החודש', en: 'The whole month' },
  moreResults: { he: 'עוד', en: 'More' },
  openPdf: { he: 'פתיחת PDF', en: 'Open PDF' },
  kind_mugah: { he: 'מוגה', en: 'Edited (mugah)' },
  'kind_bilti-mugah': { he: 'בלתי מוגה', en: 'Unedited hanacha' },
  kind_maamar: { he: 'מאמר', en: 'Maamar' },
  kind_hagahos: { he: 'הגהות', en: "The Rebbe's glosses" },
  kind_hosofos: { he: 'הוספות', en: 'Additions' },
  kind_other: { he: 'עוד', en: 'More' },
  farbrengensCount: { he: 'התוועדויות', en: 'farbrengens' },
  minutes: { he: 'דק׳', en: 'min' },
  hours: { he: 'שע׳', en: 'h' },
  saidThere: { he: 'מה שנאמר בה', en: 'What was said' },
  searchHint: { he: 'אפשר לחפש פרשה, חג, תאריך או שנה, או שם של ספר. למשל:', en: 'Search a parsha, a chag, a date or a year, or the name of a sefer. For example:' },
  allFarbrengens: { he: 'כל ההתוועדויות', en: 'All farbrengens' },
  buildingTogether: { he: 'הקהילה בונה יחד', en: 'Building it together' },
  howToHelp: { he: 'איך עוזרים', en: 'How to help' },
  taskRecordings: { he: 'התוועדויות בלי הקלטה מקושרת', en: 'farbrengens with no recording linked' },
  outOf: { he: 'מתוך', en: 'of' },
  alreadyLinked: { he: 'כבר מקושרות', en: 'already linked' },
  helpLink: { he: 'לעזור לקשר', en: 'Help link them' },
  taskTexts: { he: 'התוועדויות בלי הנחה', en: 'farbrengens with no hanacha' },
  taskTextsNote: { he: 'יודעים איפה נדפסה? כל מקור שנוסף פתוח לכולם.', en: 'Know where it was printed? Every source added is open to all.' },
  helpFind: { he: 'לעזור למצוא', en: 'Help find them' },
  reportsWaiting: { he: 'דיווחים ממתינים לבדיקה', en: 'reports waiting for review' },
  noReportsWaiting: { he: 'אין דיווחים ממתינים', en: 'No reports waiting' },
  reportHint: { he: 'מצאתם טעות? בכל דף יש ״דיווח על בעיה״, בלי חשבון.', en: 'Found a mistake? Every page has "Report a problem", no account needed.' },
  howToReport: { he: 'איך מדווחים', en: 'How to report' },
  whatsNew: { he: 'מה חדש', en: "What's new" },
  changes: { he: 'שינויים', en: 'changes' },
  recordingParts: { he: 'הקלטות', en: 'recordings' },
  tabHelp: { he: 'לעזור', en: 'Help' },
  helpIntro: { he: 'RebbeHub נבנה על ידי כולם. כל תיקון, מקור או הקלטה שמוסיפים נפתחים לכל הלומדים.', en: 'RebbeHub is built by everyone. Every fix, source or recording added is open to every learner.' },
  helpReportTitle: { he: 'מצאתם טעות? דווחו עליה', en: 'Found a mistake? Report it' },
  helpReportText: { he: 'בתחתית כל דף יש ״דיווח על בעיה״: משפט אחד מספיק, בלי חשבון. שומרי האוסף בודקים כל דיווח.', en: 'Every page ends with "Report a problem": one sentence is enough, no account needed. The set keepers check every report.' },
  helpRecordingsTitle: { he: 'השבוע: התוועדויות בלי הקלטה', en: 'This week: farbrengens with no recording' },
  helpRecordingsText: { he: 'יודעים שיש הקלטה של אחת מאלה? דווחו בדף ההתוועדות היכן היא נמצאת.', en: 'Know of a recording of one of these? Say where it is from the farbrengen’s page.' },
  helpNothingThisWeek: { he: 'לכל התוועדויות השבוע יש הקלטה.', en: 'Every farbrengen this week has a recording.' },
  helpTextsTitle: { he: 'התוועדויות בלי הנחה', en: 'Farbrengens with no hanacha' },
  helpTextsText: { he: 'יודעים איפה נדפסה הנחה של אחת מאלה? ספרו בדף ההתוועדות.', en: 'Know where a hanacha of one of these was printed? Say so from its page.' },
  helpSoonTitle: { he: 'בקרוב: הצעת תיקון ישירה', en: 'Soon: suggest a fix directly' },
  helpSoonText: { he: 'עם כניסה לחשבון תוכלו לערוך דף, לשלוח לבדיקה, לעקוב אחרי ספרים ולהצטרף לפרויקטים של הגהה.', en: 'With sign-in you will edit a page, send it for review, follow sefarim and join proofreading projects.' },
  helpCodeTitle: { he: 'כותבים קוד?', en: 'Write code?' },
  helpCodeText: { he: 'הקוד פתוח. יבואנים חדשים, תיקוני באגים ושיפורים מתקבלים בברכה.', en: 'The code is open. New importers, bug fixes and improvements are welcome.' },
  addedItems: { he: 'הוסיף', en: 'added' },
  tellUs: { he: 'לספר לנו', en: 'Tell us' },
  missingSefer: { he: 'חסר כאן ספר?', en: 'A sefer missing here?' },
  missingSeferText: { he: 'ספרו לנו עליו, וכל מי שמחפש ימצא אותו.', en: 'Tell us about it, and everyone who looks will find it.' },
  knowPrinting: { he: 'יודעים על הוצאה, סריקה או הקלטה של הספר?', en: 'Know of a printing, a scan or a recording of it?' },
  knowPrintingText: { he: 'כל פרט שנוסף כאן נפתח לכולם.', en: 'Every detail added here is open to everyone.' },
  moreInShelf: { he: 'עוד במדף', en: 'More on this shelf' },
  noContentsYet: { he: 'התוכן עוד לא פורט', en: 'Contents not listed yet' },
  volumes: { he: 'כרכים', en: 'volumes' },
  allVolumes: { he: 'כל הכרכים', en: 'All volumes' },
  whereToRead: { he: 'איפה לקרוא', en: 'Where to read' },
  sections: { he: 'חלקי הדף', en: 'Sections' },
  librarySearch: { he: 'ספר, שיחה, מאמר, שנה…', en: 'A sefer, a sicha, a maamar, a year…' },
  byRebbe: { he: 'לפי רבי', en: 'By Rebbe' },
  shelves: { he: 'מדפים', en: 'Shelves' },
  wellKnown: { he: 'ספרים מוכרים', en: 'Well-known sefarim' },
  seforim: { he: 'ספרים', en: 'sefarim' },
  unitsShort: { he: 'פריטים', en: 'items' },
  understood: { he: 'מה שהובן מהחיפוש', en: 'What the search understood' },
  tagline: { he: 'המפתח הפתוח לתורת חב״ד ולהקלטותיה, בבנייה משותפת', en: 'The open, community-built index of Chabad Torah and media' },
  search: { he: 'חיפוש', en: 'Search' },
  searchPlaceholder: { he: 'ספר, שיחה, תאריך - למשל יו״ד שבט תשי״א', en: 'A sefer, a sicha, a date - e.g. 10 Shvat 5711' },
  sets: { he: 'אוספים', en: 'Sets' },
  calendar: { he: 'לוח אירועים', en: 'Calendar' },
  about: { he: 'אודות', en: 'About' },
  home: { he: 'ראשי', en: 'Home' },
  language: { he: 'English', en: 'עברית' },
  thisDay: { he: 'ביום הזה בשנים אחרות', en: 'On this day in other years' },
  nothingThisDay: { he: 'עדיין אין אירועים רשומים ליום זה.', en: 'No events are listed for this day yet.' },
  inCatalog: { he: 'בקטלוג', en: 'In the catalog' },
  works: { he: 'חיבורים', en: 'Works' },
  units: { he: 'יחידות', en: 'Units' },
  events: { he: 'אירועים', en: 'Events' },
  authors: { he: 'מחברים', en: 'Authors' },
  publications: { he: 'הוצאות', en: 'Publications' },
  recordings: { he: 'הקלטות', en: 'Recordings' },
  contents: { he: 'תוכן העניינים', en: 'Contents' },
  more: { he: 'עוד', en: 'More' },
  by: { he: 'מאת', en: 'By' },
  date: { he: 'תאריך', en: 'Date' },
  place: { he: 'מקום', en: 'Place' },
  sources: { he: 'מקורות', en: 'Sources' },
  editions: { he: 'עותקים', en: 'Copies' },
  openAtSource: { he: 'פתיחה במקור', en: 'Open at the source' },
  text: { he: 'טקסט', en: 'Text' },
  textWithheld: { he: 'המילים של טקסט זה אינן מוצגות כאן בשל זכויות היוצרים; ראו את המקור.', en: "This text's words are not shown here because of its rights; see the source." },
  machineText: { he: 'טקסט ממוחשב שטרם נבדק בידי אדם - אין לצטט אותו כדברי הרבי.', en: "Machine text not yet checked by a person - do not quote it as the Rebbe's words." },
  scans: { he: 'סריקות', en: 'Scans' },
  page: { he: 'עמוד', en: 'Page' },
  scanLinkOnly: { he: 'סריקה זו מוצגת באתר המקור בלבד.', en: 'This scan is shown on its source site only.' },
  printedIn: { he: 'נדפס ב', en: 'Printed in' },
  contentsMap: { he: 'מה יש בו', en: 'What it contains' },
  pages: { he: 'עמ׳', en: 'pp.' },
  simcha: { he: 'שמחה', en: 'Simcha' },
  families: { he: 'משפחות', en: 'Families' },
  publisher: { he: 'הוצאה', en: 'Publisher' },
  printing: { he: 'מהדורה', en: 'Printing' },
  identifiers: { he: 'מזהים', en: 'Identifiers' },
  play: { he: 'השמעה', en: 'Play' },
  part: { he: 'חלק', en: 'Part' },
  video: { he: 'וידאו', en: 'Video' },
  history: { he: 'היסטוריה', en: 'History' },
  historyOf: { he: 'היסטוריה של', en: 'History of' },
  changedBy: { he: 'שינוי של', en: 'Changed by' },
  approvedBy: { he: 'אושר בידי', en: 'approved by' },
  version: { he: 'גרסה', en: 'Version' },
  permanentLink: { he: 'קישור קבוע', en: 'Permanent link' },
  report: { he: 'דיווח על בעיה', en: 'Report a problem' },
  reportWhat: { he: 'מה לא בסדר?', en: 'What is wrong?' },
  reportNote: { he: 'כמה מילים (לא חובה)', en: 'A few words (optional)' },
  reportSend: { he: 'שליחה', en: 'Send' },
  reportThanks: { he: 'תודה! הדיווח נשלח לאחראי האוסף.', en: "Thank you! The report went to the set's keepers." },
  reportFailed: { he: 'הדיווח לא נשלח:', en: 'The report was not sent:' },
  results: { he: 'תוצאות', en: 'Results' },
  noResults: { he: 'לא נמצא דבר. נסו מילים אחרות, או תאריך.', en: 'Nothing found. Try other words, or a date.' },
  dateFound: { he: 'התאריך שבחיפוש', en: 'The date you searched for' },
  eventsOnDate: { he: 'אירועים בתאריך זה', en: 'Events on this date' },
  notFound: { he: 'הדף לא נמצא', en: 'Page not found' },
  notFoundText: { he: 'אין כאן דבר. אולי הקישור שגוי, או שהפריט הוסר.', en: 'Nothing is here. The link may be wrong, or the item was removed.' },
  error: { he: 'משהו השתבש', en: 'Something went wrong' },
  errorText: { he: 'נסו שוב בעוד רגע.', en: 'Please try again in a moment.' },
  year: { he: 'שנה', en: 'Year' },
  previousYear: { he: 'השנה הקודמת', en: 'Previous year' },
  nextYear: { he: 'השנה הבאה', en: 'Next year' },
  noEvents: { he: 'אין אירועים רשומים.', en: 'No events listed.' },
  members: { he: 'בסט זה', en: 'In this set' },
  keepers: { he: 'אחראים', en: 'Keepers' },
  noKeepers: { he: 'טרם מונו', en: 'not yet appointed' },
  policy: { he: 'מדיניות', en: 'Policy' },
  details: { he: 'פרטים', en: 'Details' },
  genre: { he: 'סוגה', en: 'Genre' },
  links: { he: 'קשרים', en: 'Links' },
  pointsHere: { he: 'מפנים לכאן', en: 'Points here' },
  footerOpen: { he: 'הקטלוג כולו פתוח להורדה: עובדות ב-CC0, טקסט קהילתי ב-CC BY-SA.', en: 'The whole catalog is open to download: facts under CC0, community text under CC BY-SA.' },
  code: { he: 'קוד המקור', en: 'Source code' },
  help: { he: 'איך לעזור', en: 'How to help' },
} as const satisfies Record<string, { he: string; en: string }>;

export type StringKey = keyof typeof STRINGS;

export function t(lang: Lang, key: StringKey): string {
  return STRINGS[key][lang];
}

export const TYPE_NAMES: Record<string, { he: string; en: string }> = {
  set: { he: 'אוסף', en: 'Set' },
  author: { he: 'מחבר', en: 'Author' },
  work: { he: 'חיבור', en: 'Work' },
  unit: { he: 'יחידה', en: 'Unit' },
  event: { he: 'אירוע', en: 'Event' },
  publication: { he: 'הוצאה', en: 'Publication' },
  scan: { he: 'סריקה', en: 'Scan' },
  recording: { he: 'הקלטה', en: 'Recording' },
  text: { he: 'טקסט', en: 'Text' },
  segment: { he: 'פסקה', en: 'Paragraph' },
  person: { he: 'אדם', en: 'Person' },
  place: { he: 'מקום', en: 'Place' },
  topic: { he: 'נושא', en: 'Topic' },
  source: { he: 'מקור', en: 'Source' },
  schema: { he: 'סכמה', en: 'Schema' },
};

const KINDS: Record<string, { he: string; en: string }> = {
  text: { he: 'טקסט', en: 'Text' },
  scan: { he: 'סריקה', en: 'Scan' },
  pdf: { he: 'PDF', en: 'PDF' },
  audio: { he: 'שמע', en: 'Audio' },
  video: { he: 'וידאו', en: 'Video' },
};

const LANGUAGES: Record<string, { he: string; en: string }> = {
  he: { he: 'עברית', en: 'Hebrew' },
  en: { he: 'אנגלית', en: 'English' },
  yi: { he: 'אידיש', en: 'Yiddish' },
  ru: { he: 'רוסית', en: 'Russian' },
  fr: { he: 'צרפתית', en: 'French' },
  es: { he: 'ספרדית', en: 'Spanish' },
  ar: { he: 'ערבית', en: 'Arabic' },
};

/** What kind of copy it is (text, scan, audio…), in the page's language. */
export const kindName = (kind: string, lang: Lang) => KINDS[kind]?.[lang] ?? kind;

/** A language's name, in the page's language. */
export const languageName = (code: string, lang: Lang) => LANGUAGES[code]?.[lang] ?? code;

export const typeName = (type: string, lang: Lang) => TYPE_NAMES[type]?.[lang] ?? type;

export const REPORT_REASONS: Array<{ id: string; he: string; en: string }> = [
  { id: 'wrong-fact', he: 'פרט שגוי (תאריך, שם, מקום)', en: 'A fact is wrong (date, name, place)' },
  { id: 'missing-page', he: 'עמוד חסר או לא במקומו', en: 'A page is missing or out of order' },
  { id: 'bad-scan', he: 'הסריקה פגומה', en: 'The scan is bad' },
  { id: 'audio-problem', he: 'בעיה בהקלטה', en: 'The audio has a problem' },
  { id: 'wrong-text', he: 'טעות בטקסט', en: 'The text has mistakes' },
  { id: 'duplicate', he: 'רשום פעמיים', en: 'It is listed twice' },
  { id: 'rights', he: 'שאלת זכויות', en: 'A rights question' },
  { id: 'other', he: 'אחר', en: 'Something else' },
];
