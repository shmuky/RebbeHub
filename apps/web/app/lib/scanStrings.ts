import type { Lang } from './i18n.js';

/**
 * The words of the scans-and-files pages (the plan's phase 3): the page
 * viewer, what an upload is, "Map a teshura", printings, and a family's
 * request. Kept beside i18n.ts, in the same form, Hebrew first.
 */
const SCAN_STRINGS = {
  // The viewer
  pageImages: { he: 'עמודי הסריקה', en: 'Pages of the scan' },
  previousPage: { he: 'העמוד הקודם', en: 'Previous page' },
  nextPage: { he: 'העמוד הבא', en: 'Next page' },
  pageOf: { he: 'מתוך', en: 'of' },
  iiif: { he: 'IIIF (לכל מציג ספריות)', en: 'IIIF (for any library viewer)' },
  // Printings
  printingsHead: { he: 'ההוצאות והדפוסים של הספר', en: "The sefer's printings" },
  otherPrintings: { he: 'הוצאות אחרות של הספר', en: 'Other printings of the sefer' },
  reprintOf: { he: 'הדפסה חוזרת של', en: 'Reprints' },
  scansCount: { he: 'סריקות', en: 'scans' },
  noScanYet: { he: 'אין סריקה עדיין', en: 'no scan yet' },
  printingNo: { he: 'דפוס', en: 'printing' },
  // What an upload is
  checking: { he: 'בודקים אם הקובץ כבר אצלנו…', en: 'Checking whether we have this already…' },
  weHaveIt: { he: 'הקובץ הזה כבר אצלנו:', en: 'We already have this file:' },
  looksSame: { he: 'בדיקת מחשב: נראה שזו אותה סריקה כמו', en: 'Machine check: this looks like the same scan as' },
  pagesAlike: { he: 'עמודים דומים', en: 'pages alike' },
  sharesPages: { he: 'בדיקת מחשב: יש עמודים משותפים עם', en: 'Machine check: it shares pages with' },
  sendAnyway: { he: 'זו סריקה אחרת, להמשיך', en: 'It is a different scan; go on' },
  whatIsIt: { he: 'מה זה?', en: 'What is it?' },
  asScanOf: { he: 'סריקה נוספת של הוצאה שכבר רשומה', en: 'Another scan of a printing already listed' },
  asPrinting: { he: 'הוצאה או דפוס חדשים של הספר', en: 'A new printing of the sefer' },
  asTeshura: { he: 'תשורה חדשה', en: 'A new teshura' },
  whichPrinting: { he: 'איזו הוצאה?', en: 'Which printing?' },
  publisher: { he: 'הוצאה לאור', en: 'Publisher' },
  year: { he: 'שנה', en: 'Year' },
  yearHint: { he: 'למשל תשמ״ב או 1982', en: 'e.g. 5742 or 1982' },
  printingNumber: { he: 'מספר הדפוס', en: 'Printing number' },
  families: { he: 'המשפחות, כפי שנדפס', en: 'The families, as printed' },
  familiesHint: { he: 'למשל: כהן – לוי', en: 'e.g. Cohen – Levi' },
  simchaDate: { he: 'תאריך השמחה', en: 'Date of the simcha' },
  simchaDateHint: { he: 'למשל 5784-03-15 (ט״ו סיון תשפ״ד)', en: 'e.g. 5784-03-15 (15 Sivan 5784)' },
  teshuraRights: { he: 'תשורות מוצגות עם קרדיט למשפחות, ומשפחה יכולה לבקש להסירן.', en: 'Teshuros are shown with credit to the families, and a family can ask for one to be taken down.' },
  guessedBecause: { he: 'ניחוש לפי', en: 'Guessed from' },
  reason_shares_pages: { he: 'עמודים משותפים עם סריקה שלה', en: 'pages shared with a scan of it' },
  reason_same_year: { he: 'השנה שבשם הקובץ', en: 'the year in the name' },
  reason_title: { he: 'השם', en: 'the name' },
  addTeshura: { he: 'הוספת תשורה', en: 'Add a teshura' },
  // Map a teshura
  mapPages: { he: 'מיפוי עמודים', en: 'Map pages' },
  mapHow: { he: 'מה נמצא בעמודים האלה? קשרו ליחידה שכבר בקטלוג (מכתב, שיחה, סיפור), צרו חדשה, או תארו במילים.', en: 'What is on these pages? Link a unit already in the catalog (a letter, a sicha, a story), make a new one, or say it in words.' },
  fromPage: { he: 'מעמוד', en: 'From page' },
  toPage: { he: 'עד עמוד', en: 'To page' },
  scheme: { he: 'מספור', en: 'Numbering' },
  scheme_printed: { he: 'כפי שנדפס', en: 'As printed' },
  scheme_pdf: { he: 'של קובץ ה-PDF', en: "The PDF's" },
  mapExisting: { he: 'יחידה שכבר בקטלוג', en: 'A unit already in the catalog' },
  mapNew: { he: 'יחידה חדשה (נדפסה כאן לראשונה)', en: 'A new unit (first printed here)' },
  mapWords: { he: 'רק תיאור במילים', en: 'Only a description' },
  searchUnit: { he: 'חיפוש: שם, תאריך', en: 'Search: name, date' },
  inSefer: { he: 'באיזה ספר?', en: 'In which sefer?' },
  searchSefer: { he: 'חיפוש ספר', en: 'Search for a sefer' },
  unitName: { he: 'שם (למשל: מכתב מה׳ תשרי תשי״ח)', en: 'Its name (e.g. a letter of 5 Tishrei 5718)' },
  unitDate: { he: 'תאריך (לא חובה)', en: 'Date (optional)' },
  description: { he: 'תיאור', en: 'Description' },
  mapSent: { he: 'המיפוי נשלח לבדיקה.', en: 'The map was sent for review.' },
  choose: { he: 'בחירה', en: 'Choose' },
  // A family's request
  familyRequest: { he: 'בקשת משפחה להסרת התשורה', en: "A family's request to take this teshura down" },
  familyHow: { he: 'אתם מבני המשפחה (או בשמם) ומבקשים שהתשורה לא תוצג? הסריקה תפסיק להיות מוצגת מיד, והמנהלים יבדקו את הבקשה. היא לא נמחקת.', en: 'Are you of the family (or asking for them), and would rather this teshura not be shown? Its scan stops being shown at once, and the stewards look at the request. Nothing is deleted.' },
  familyRelation: { he: 'הקשר שלכם למשפחה', en: 'How you are related' },
  familyContact: { he: 'איך לחזור אליכם (לא חובה, נשמר רק אצל המנהלים)', en: 'How to reach you (optional, seen by stewards only)' },
  familySend: { he: 'שליחת הבקשה', en: 'Send the request' },
  familyThanks: { he: 'הבקשה התקבלה. הסריקה כבר אינה מוצגת, והמנהלים יחזרו אליכם אם השארתם פרטים.', en: 'The request arrived. The scan is no longer shown, and the stewards will be in touch if you left a way to reach you.' },
  // Review
  machineLooksLike: { he: 'בדיקת מחשב: נראה כמו', en: 'Machine check: looks like' },
} as const satisfies Record<string, { he: string; en: string }>;

export type ScanStringKey = keyof typeof SCAN_STRINGS;

export function st(lang: Lang, key: ScanStringKey): string {
  return SCAN_STRINGS[key][lang];
}
