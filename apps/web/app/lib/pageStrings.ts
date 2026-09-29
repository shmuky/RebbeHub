import type { Lang } from './i18n.js';

/**
 * The words of what every item's page shares: all that belongs to an item
 * (counted, a page at a time), its sources, a file's own page, a sefer's
 * cover from its title page, and adding what the catalog lacks. Kept beside
 * i18n.ts, in the same form, Hebrew first.
 */
const PAGE_STRINGS = {
  // All that belongs to an item
  belongsHere: { he: 'כל מה ששייך לכאן', en: 'Everything that belongs here' },
  seeAll: { he: 'כל ה־', en: 'All ' },
  showing: { he: 'מוצגים', en: 'Showing' },
  of: { he: 'מתוך', en: 'of' },
  nextPage: { he: 'הבאים', en: 'Next' },
  firstPage: { he: 'לתחילת הרשימה', en: 'Back to the start' },
  nothingHere: { he: 'אין כאן כלום עדיין.', en: 'Nothing here yet.' },
  via: { he: 'דרך השדה', en: 'through' },
  listedHere: { he: 'רשימה מלאה', en: 'Full list' },
  // Sources and facts
  sources: { he: 'מקורות', en: 'Sources' },
  externalIds: { he: 'מזהים במקומות אחרים', en: 'Elsewhere' },
  facts: { he: 'פרטים', en: 'Details' },
  fetched: { he: 'נקרא', en: 'read' },
  part: { he: 'חלק', en: 'Part' },
  duration: { he: 'אורך', en: 'Length' },
  languageLabel: { he: 'שפה', en: 'Language' },
  otherParts: { he: 'חלקים נוספים של ההתוועדות', en: 'Other parts of the farbrengen' },
  transcripts: { he: 'תמלולים וטקסטים', en: 'Transcripts and texts' },
  videos: { he: 'וידאו', en: 'Video' },
  listenElsewhere: { he: 'בקישור המקורי', en: 'At its source' },
  theFile: { he: 'הקובץ', en: 'The file' },
  machineNote: { he: 'נוצר על ידי מחשב, לא נבדק', en: 'Made by a machine, not yet checked' },
  // A file's own page
  filePage: { he: 'קובץ', en: 'File' },
  size: { he: 'גודל', en: 'Size' },
  type: { he: 'סוג', en: 'Type' },
  rights: { he: 'זכויות', en: 'Rights' },
  storage: { he: 'אחסון', en: 'Kept' },
  open: { he: 'לקריאה ולהורדה', en: 'Open it' },
  notServed: { he: 'הקובץ שמור אצלנו ואינו מוצג (זכויות).', en: 'Kept, not shown (rights).' },
  cameFrom: { he: 'מאיפה הגיע', en: 'Where it came from' },
  uploadedBySomeone: { he: 'הועלה על ידי משתמש', en: 'uploaded by a person' },
  madeFrom: { he: 'מה נעשה ממנו', en: 'Made from it' },
  madeOf: { he: 'נעשה מתוך', en: 'Made from' },
  measured: { he: 'מדידות', en: 'Measured' },
  pages: { he: 'עמודים', en: 'pages' },
  pageImagesMade: { he: 'תמונות עמודים', en: 'page images' },
  usedBy: { he: 'בשימוש אצל', en: 'Used by' },
  coverOf: { he: 'כריכה של', en: 'The cover of' },
  // Covers
  coverFrom: { he: 'השער: עמוד', en: 'Title page: page' },
  coverMachine: { he: 'נבחר על ידי מחשב', en: 'chosen by a machine' },
  coverPerson: { he: 'נבחר על ידי אדם', en: 'chosen by a person' },
  chooseCover: { he: 'בחירת עמוד אחר לשער', en: 'Choose another page as the title page' },
  chooseCoverHow: {
    he: 'העמוד נלקח מקובץ PDF של הספר, שמוצג באתר או שהאתר מקשר אליו. בחרו את הקובץ ואת מספר העמוד (כמו בקובץ, לא כמו המודפס). ההצעה נשלחת לשומרי האוסף.',
    en: "The page is taken from one of the sefer's PDFs, one the site serves or one it links to. Choose the file and the page number (the PDF's own, not the printed one). The suggestion goes to the set's keepers.",
  },
  pageNumber: { he: 'עמוד', en: 'Page' },
  send: { he: 'שליחה לבדיקה', en: 'Send for review' },
  sent: { he: 'נשלח לבדיקה.', en: 'Sent for review.' },
  // Adding what the catalog lacks
  addNew: { he: 'הוספת חומר חדש', en: 'Add something new' },
  addNewHow: {
    he: 'הנחה, הקלטה או ספר, מכתב ומסמך שאין עדיין באתר. המחשב מציע מה זה ולאן זה שייך; אתם מאשרים, וההצעה נשלחת לשומרי האוסף.',
    en: "A hanacha, a recording, or a sefer, letter or document the site does not have yet. The machine proposes what it is and where it belongs; you confirm, and the suggestion goes to the set's keepers.",
  },
  whatIsIt: { he: 'מה מוסיפים?', en: 'What are you adding?' },
  aHanacha: { he: 'הנחה של התוועדות או שיחה', en: 'A hanacha of a farbrengen or sicha' },
  aRecording: { he: 'הקלטה של התוועדות', en: 'A recording of a farbrengen' },
  aDocument: { he: 'ספר, מכתב או מסמך אחר', en: 'A sefer, a letter, or another document' },
  asFile: { he: 'קובץ PDF', en: 'A PDF' },
  asText: { he: 'טקסט (הדבקה או קובץ טקסט)', en: 'Text (pasted, or a text file)' },
  nameIt: { he: 'השם, כמו שמופיע (אפשר עם התאריך: י׳ שבט תשמ״ב)', en: 'Its name, as it appears (a date helps: 10 Shvat 5742)' },
  propose: { he: 'הצעת מקום', en: 'Propose where it goes' },
  proposing: { he: 'מחפשים…', en: 'Looking…' },
  machineProposes: { he: 'הצעת מחשב', en: "The machine's proposal" },
  dateRead: { he: 'תאריך שזוהה', en: 'Date read' },
  itBelongs: { he: 'לאן זה שייך?', en: 'Where does it belong?' },
  newFarbrengen: { he: 'התוועדות שאין עדיין באתר', en: 'A farbrengen the site does not have yet' },
  newFarbrengenTitle: { he: 'שם ההתוועדות', en: "The farbrengen's name" },
  newFarbrengenDate: { he: 'התאריך (למשל 5742-05-10)', en: 'Its date (such as 5742-05-10)' },
  documentAs: { he: 'מה זה?', en: 'What is it?' },
  asSefer: { he: 'ספר חדש', en: 'A new sefer' },
  asLetter: { he: 'מכתב', en: 'A letter' },
  asOther: { he: 'מסמך אחר', en: 'Another document' },
  alreadyKnown: { he: 'אם זה הדפסה של ספר שכבר באתר, הוסיפו אותה בעמוד של הספר:', en: 'If it is a printing of a sefer the site has, add it on that sefer’s page:' },
  hanachaKind: { he: 'סוג ההנחה', en: 'Kind of hanacha' },
  credit: { he: 'למי לתת קרדיט (לא חובה)', en: 'Credit to (optional)' },
  theWords: { he: 'הטקסט (פסקה בכל שורה ריקה)', en: 'The words (a blank line between paragraphs)' },
  orTextFile: { he: 'או קובץ טקסט', en: 'or a text file' },
  rightsQuestion: { he: 'של מי הזכויות?', en: 'Whose are the rights?' },
  rightsMine: { he: 'שלי, ואני נותן אותו לכולם', en: 'Mine, and I give it to everyone' },
  rightsPublicDomain: { he: 'נחלת הכלל', en: 'Public domain' },
  rightsFree: { he: 'יצא לחלוקה חינם', en: 'Printed for free distribution' },
  rightsUnsure: { he: 'לא בטוח (נשמר ולא מוצג עד שמנהל יחליט)', en: 'Not sure (kept, not shown, until a steward decides)' },
  addIt: { he: 'שליחה לבדיקה', en: 'Send for review' },
  added: { he: 'נשלח לבדיקה. אפשר לראות את ההצעה:', en: 'Sent for review. The suggestion:' },
  haveIt: { he: 'הקובץ הזה כבר אצלנו:', en: 'We already have this file:' },
  signInToAdd: { he: 'כדי להוסיף צריך להתחבר.', en: 'Sign in to add.' },
  addHanacha: { he: 'הוספת הנחה', en: 'Add a hanacha' },
  addRecording: { he: 'הוספת הקלטה', en: 'Add a recording' },
  failed: { he: 'השליחה לא הצליחה:', en: 'It did not go through:' },
} as const satisfies Record<string, { he: string; en: string }>;

export type PageStringKey = keyof typeof PAGE_STRINGS;

export function ps(lang: Lang, key: PageStringKey): string {
  return PAGE_STRINGS[key][lang];
}

/** What a group of items pointing here is called: "Units", "Recordings". */
const GROUP_NAMES: Record<string, { he: string; en: string }> = {
  set: { he: 'אוספים', en: 'Sets' },
  work: { he: 'ספרים', en: 'Sefarim' },
  unit: { he: 'יחידות', en: 'Units' },
  event: { he: 'אירועים', en: 'Events' },
  publication: { he: 'הוצאות', en: 'Printings' },
  scan: { he: 'סריקות', en: 'Scans' },
  text: { he: 'טקסטים', en: 'Texts' },
  segment: { he: 'פסקאות', en: 'Paragraphs' },
  recording: { he: 'הקלטות', en: 'Recordings' },
  alignment: { he: 'סנכרונים', en: 'Syncs' },
  'alignment-span': { he: 'קטעי סנכרון', en: 'Sync spans' },
  'contents-map': { he: 'מפות תוכן', en: 'Contents maps' },
  'text-layer': { he: 'שכבות טקסט', en: 'Text layers' },
  'text-page': { he: 'עמודי טקסט', en: 'Text pages' },
  person: { he: 'אנשים', en: 'People' },
  author: { he: 'מחברים', en: 'Authors' },
  place: { he: 'מקומות', en: 'Places' },
  topic: { he: 'נושאים', en: 'Topics' },
  source: { he: 'מקורות', en: 'Sources' },
};

/** The field a group points through, when it says more than the type does ("sets" is membership, "translationOf" a translation). */
const FIELD_NAMES: Record<string, { he: string; en: string }> = {
  sets: { he: 'באוסף', en: 'in this set' },
  events: { he: 'נאמרו בו', en: 'said there' },
  topics: { he: 'בנושא', en: 'on this topic' },
  authors: { he: 'שחיבר', en: 'by this author' },
  translationOf: { he: 'תרגומים', en: 'translations' },
  reprintOf: { he: 'הדפסות חוזרות', en: 'reprints' },
  place: { he: 'במקום', en: 'held here' },
};

export function groupName(type: string, field: string, lang: Lang): string {
  const name = GROUP_NAMES[type]?.[lang] ?? type;
  const via = FIELD_NAMES[field]?.[lang];
  return via ? `${name} · ${via}` : name;
}

const EVENT_KINDS: Record<string, { he: string; en: string }> = {
  farbrengen: { he: 'התוועדות', en: 'Farbrengen' },
  sicha: { he: 'שיחה', en: 'Sicha' },
  maamar: { he: 'מאמר', en: 'Maamar' },
  yechidus: { he: 'יחידות', en: 'Yechidus' },
  letter: { he: 'מכתב', en: 'Letter' },
  simcha: { he: 'שמחה', en: 'Simcha' },
  kinus: { he: 'כינוס', en: 'Kinus' },
  other: { he: 'אירוע', en: 'Event' },
};

export const eventKindName = (kind: string, lang: Lang) => EVENT_KINDS[kind]?.[lang] ?? kind;

export const count = (value: number, lang: Lang) => value.toLocaleString(lang === 'he' ? 'he-IL' : 'en-US');
