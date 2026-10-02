import { useEffect, useState } from 'react';
import { data, Form, redirect, useNavigation } from 'react-router';
import type { Route } from './+types/showcase';
import type { Entity } from '../lib/api.js';
import { siteOf } from '../lib/context.server.js';
import { dateLabel } from '../lib/dates.js';
import { langFrom, type Lang } from '../lib/i18n.js';
import { num } from '../lib/i18nUi.js';
import { labelOf } from '../lib/labels.js';
import { readingOf, readingOfJson } from '../lib/reading.js';
import { isFontFile, mediaSourceOf, newToken, NO_EXTRAS, PRINT_FONTS, TOKEN, type MediaSource, type PrintFont, type Showcase, type ShowcaseExtras } from '../lib/showcase.js';
import { Icon } from '../ui/Icon.js';
import { EmptyState } from '../ui/primitives.js';
import '../styles/pages/show.css';

/**
 * Making a showcase (lib/showcase.ts): Shmuly picks the farbrengens and
 * sichos a guest will see, and what else of RebbeHub the page shows, and
 * gets its secret address to send. The farbrengens whose transcripts
 * people checked most are offered first. Only he makes them: while
 * RebbeHub is private, whoever opened its lock.
 *
 * Saving fixes which recordings and scans the page may pass on to a guest
 * (`media`); picking again and saving makes that list anew. Removing a
 * showcase closes its address at once.
 *
 * He can also add pages our reader read (the reader's text file, which
 * names its scan: lib/reading.ts), and set beside a farbrengen its
 * original, the written transcript, by its Drive link.
 */

const MAX_ITEMS = 12;
const MAX_READINGS = 6;
const MAX_READING_BYTES = 1024 * 1024;
const MAX_FONT_BYTES = 2 * 1024 * 1024;
const ID = /^rh-[0-9a-z]+$/;

const W = {
  title: { he: 'דף תצוגה לפגישות', en: 'Showcase pages' },
  intro: {
    he: 'דף אחד, נקי, בכתובת סודית משלו, להראות לאנשים שנפגשים איתם. רק הוא נפתח בכתובת הזו; שאר האתר נשאר נעול.',
    en: 'One clean page at a secret address of its own, to show the people you meet. Only that page opens at it; the rest of the site stays locked.',
  },
  ownerOnly: { he: 'רק הבעלים יוצר דפי תצוגה.', en: 'Only the owner makes showcases.' },
  none: { he: 'אין כאן דפי תצוגה.', en: 'Showcases are not kept here.' },
  yours: { he: 'הדפים שלך', en: 'Your showcases' },
  newOne: { he: 'דף חדש', en: 'New showcase' },
  editing: { he: 'עריכת הדף', en: 'Editing' },
  name: { he: 'כותרת', en: 'Title' },
  namePh: { he: 'למשל: RebbeHub', en: 'e.g. RebbeHub' },
  note: { he: 'שורה מתחת לכותרת (לא חובה)', en: 'A line under the title (optional)' },
  notePh: { he: 'למשל: הוכן במיוחד עבור…', en: 'e.g. Prepared for…' },
  farbrengens: { he: 'התוועדויות', en: 'Farbrengens' },
  farbrengensSub: { he: 'הדיבור מוצג כמילות שיר בזמן ההשמעה.', en: 'Their words show as lyrics while they play.' },
  sichos: { he: 'שיחות עם סריקה', en: 'Sichos with their scans' },
  sichosSub: { he: 'הסריקה של השיחה, ולצדה הטקסט שנקרא ממנה (כשיש).', en: "The sicha's scan, beside the words read from it (when there are)." },
  best: { he: 'התמלולים הטובים ביותר', en: 'The best transcripts' },
  bestSub: { he: 'התוועדויות שהתמלול שלהן נבדק הכי הרבה, אחר כך הארוכות.', en: 'Farbrengens whose transcripts people checked most, then the longest.' },
  read: { he: 'שיחות שהקורא שלנו קרא לקטלוג', en: 'Sichos our reader read into the catalog' },
  readSub: { he: 'לקוטי שיחות שהטקסט שלהן נקרא מהסריקה ועוד לא נבדק, החדשות קודם.', en: 'Likkutei Sichos whose words were read from the scan and not yet checked, the newest first.' },
  search: { he: 'חיפוש התוועדות או שיחה (שם, תאריך, חלק)', en: 'Find a farbrengen or sicha (name, date, volume)' },
  add: { he: 'הוספה', en: 'Add' },
  remove: { he: 'הסרה', en: 'Remove' },
  up: { he: 'למעלה', en: 'Up' },
  nothing: { he: 'לא נבחר עדיין.', en: 'Nothing picked yet.' },
  also: { he: 'עוד בדף', en: 'Also on the page' },
  daily: { he: 'היום יום של היום, כפי שנדפס', en: "Today's Hayom Yom, as printed" },
  mafteach: { he: 'מפתח הענינים של לקוטי שיחות, עם חיפוש', en: 'The Likkutei Sichos subject index, searchable' },
  models: { he: 'המודלים שלנו וציוניהם', en: 'Our models and their scores' },
  numbers: { he: 'האוסף במספרים', en: 'The catalog in numbers' },
  save: { he: 'שמירה וקבלת קישור', en: 'Save and get the link' },
  saving: { he: 'שומר…', en: 'Saving…' },
  saved: { he: 'נשמר. זה הקישור:', en: 'Saved. Here is the link:' },
  copy: { he: 'העתקה', en: 'Copy' },
  copied: { he: 'הועתק', en: 'Copied' },
  open: { he: 'פתיחה', en: 'Open' },
  edit: { he: 'עריכה', en: 'Edit' },
  del: { he: 'מחיקה (הקישור יפסיק לעבוד)', en: 'Delete (the link stops working)' },
  parts: { he: 'חלקים', en: 'parts' },
  checked: { he: 'נבדקו', en: 'checked' },
  paragraphs: { he: 'פסקאות', en: 'paragraphs' },
  noAudio: { he: 'בלי הקלטה שאפשר להשמיע', en: 'no recording that can play' },
  noScan: { he: 'בלי סריקה', en: 'no scan' },
  readings: { he: 'דפים שהקורא שלנו קרא', en: 'Pages our reader read' },
  readingsSub: {
    he: 'קובץ ה-JSON שהקורא כותב לשיחה (נקבע כמו הדפוס, שורה בשורה), או קובץ הטקסט שלו (עם שורת scan: לסריקה). בדף יוצג לצד הדף המקורי.',
    en: "The JSON file the reader writes for a sicha (set as printed, line for line), or its text file (with a scan: line for its scan). The page shows it beside the original.",
  },
  addReading: { he: 'הוספת קובץ', en: 'Add a file' },
  dropReading: { he: 'להסיר', en: 'Remove' },
  original: { he: 'המקור (קישור Drive לתמליל הכתוב, לא חובה)', en: 'Original (Drive link to the written transcript, optional)' },
  badReading: { he: 'הקובץ לא נקרא:', en: 'Could not read:' },
  fonts: { he: 'גופני הדפוס', en: 'The print fonts' },
  fontsSub: { he: 'הדף שנקבע כמו הדפוס כתוב בהם, בכל התצוגות. נשמרים פעם אחת לכולן, ולא בקוד האתר.', en: 'The page set as printed uses them, in every showcase. Kept once for all of them, not in the site’s code.' },
  fontFrank: { he: 'פרנק (הגוף)', en: 'Frank (the body)' },
  fontMiram: { he: 'מירם (המודגש)', en: 'Miram (the stressed words)' },
  fontKept: { he: 'נשמר; קובץ חדש מחליף', en: 'kept; a new file replaces it' },
} as const;
const w = (lang: Lang, key: keyof typeof W) => W[key][lang];

interface Pick {
  id: string;
  label: string;
  sub: string;
}

function pickOf(item: Entity, lang: Lang): Pick {
  const d = item.data as { date?: string };
  return { id: item.id, label: labelOf(item, lang), sub: d.date ? dateLabel(d.date, lang, { civil: false }) : (item.path ?? '') };
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { api, siteUrl, showcases } = siteOf(context);
  const lang = langFrom(request);
  if (!showcases) return { lang, siteUrl, state: 'none' as const };
  if (!showcases.owner) throw data({ lang, siteUrl, state: 'owner' as const }, { status: 403 });
  const url = new URL(request.url);
  const editing = url.searchParams.get('edit');
  const saved = url.searchParams.get('saved');
  const [list, transcribed, toCheck, frank, miram] = await Promise.all([
    showcases.store.list(),
    api.transcribed(200).catch(() => []),
    api.toCheck(200).catch(() => null),
    showcases.store.hasFont('frank'),
    showcases.store.hasFont('miram'),
  ]);
  const current = editing && TOKEN.test(editing) ? (list.find((s) => s.token === editing) ?? null) : null;

  // The farbrengens whose transcripts are best: checked most, then longest, summed over their parts.
  const byEvent = new Map<string, { parts: number; paragraphs: number; checked: number }>();
  for (const r of transcribed) {
    if (!r.event) continue;
    const sum = byEvent.get(r.event) ?? { parts: 0, paragraphs: 0, checked: 0 };
    byEvent.set(r.event, { parts: sum.parts + 1, paragraphs: sum.paragraphs + r.paragraphs, checked: sum.checked + r.checked });
  }
  const top = [...byEvent].sort((a, b) => b[1].checked - a[1].checked || b[1].paragraphs - a[1].paragraphs).slice(0, 24);
  // The sichos our reader read into the catalog, the newest first: their words wait for a person to check them.
  const readSichos = (toCheck?.texts ?? []).filter((t) => t.type === 'unit' && /^\/likkutei-sichos\/\d/.test(t.path ?? '')).slice(0, 24);
  const wanted = [...top.map(([id]) => id), ...readSichos.map((t) => t.entity), ...(current ? [...current.farbrengens, ...current.sichos] : [])];
  const items = await api.entities(wanted).catch(() => new Map<string, Entity>());
  const best = top.flatMap(([id, sum]) => (items.get(id) ? [{ ...pickOf(items.get(id)!, lang), ...sum }] : []));
  const read = readSichos.flatMap((t) => (items.get(t.entity) ? [{ ...pickOf(items.get(t.entity)!, lang), segments: t.segments }] : []));
  const picked = (ids: string[]) => ids.flatMap((id) => (items.get(id) ? [pickOf(items.get(id)!, lang)] : []));
  return {
    lang,
    siteUrl,
    state: 'owner-ok' as const,
    list: list.map((s) => ({ token: s.token, title: s.title, note: s.note, updated: s.updated, farbrengens: s.farbrengens.length, sichos: s.sichos.length })),
    current: current
      ? {
          token: current.token,
          title: current.title,
          note: current.note,
          extras: current.extras,
          farbrengens: picked(current.farbrengens),
          sichos: picked(current.sichos),
          readings: (current.readings ?? []).map((r) => ({ title: r.title, scan: r.scan })),
          originals: Object.fromEntries(Object.entries(current.originals ?? {}).flatMap(([id, i]) => (current.media[i] ? [[id, linkOf(current.media[i]!)]] : []))),
        }
      : null,
    best,
    read,
    fonts: { frank, miram },
    saved: saved && TOKEN.test(saved) ? saved : null,
  };
}

/** A file's address as he would paste it again. */
function linkOf(source: MediaSource): string {
  if (source.kind === 'drive') return `https://drive.google.com/file/d/${source.id}/view${source.resourceKey ? `?resourcekey=${source.resourceKey}` : ''}`;
  if (source.kind === 'object') return `/objects/${source.sha256}`;
  return source.file;
}

/** The ids a form field lists, in its order, each once, a dozen at most. */
const idsFrom = (value: FormDataEntryValue | null) => [...new Set(String(value ?? '').split(',').map((s) => s.trim()).filter((s) => ID.test(s)))].slice(0, MAX_ITEMS);

export async function action({ request, context }: Route.ActionArgs) {
  const { api, showcases } = siteOf(context);
  if (!showcases?.owner) throw data('only the owner makes showcases', { status: 403 });
  const form = await request.formData();
  const given = String(form.get('token') ?? '');
  const existing = TOKEN.test(given) ? await showcases.store.get(given) : null;
  if (form.get('intent') === 'delete') {
    if (existing) await showcases.store.remove(existing.token);
    return redirect('/showcase');
  }

  // The print's faces, kept once for every showcase: only a font file, and not a large one.
  for (const name of PRINT_FONTS) {
    const file = form.get(`font-${name}`);
    if (typeof file === 'string' || !file || !file.size || file.size > MAX_FONT_BYTES) continue;
    const bytes = await file.arrayBuffer();
    if (isFontFile(bytes)) await showcases.store.putFont(name, bytes);
  }

  const farbrengens = idsFrom(form.get('farbrengens'));
  const sichos = idsFrom(form.get('sichos'));
  const extras: ShowcaseExtras = { ...NO_EXTRAS };
  for (const key of Object.keys(NO_EXTRAS) as Array<keyof ShowcaseExtras>) extras[key] = form.get(key) === 'on';

  // What the page may pass on to a guest, fixed now: each farbrengen's recordings, each sicha's scan.
  const [recordingsOf, units, transcribed] = await Promise.all([
    api.linkedOfEach(farbrengens, { field: 'event', type: 'recording', limit: 80 }),
    api.entities(sichos),
    api.transcribed(1000),
  ]);
  const recordings = farbrengens.flatMap((id) => recordingsOf.get(id) ?? []);
  const files = await api.files(recordings.map((r) => String((r.data as { file?: string }).file ?? '')).filter((sha) => /^[0-9a-f]{64}$/.test(sha)));
  const media: MediaSource[] = [];
  const mediaOf: Record<string, number> = {};
  const keep = (id: string, source: MediaSource | null) => {
    if (source) mediaOf[id] = media.push(source) - 1;
  };
  for (const r of recordings) {
    const d = r.data as { file?: string; url?: string };
    keep(r.id, mediaSourceOf((d.file ? files.get(d.file)?.url : null) ?? d.url));
  }
  for (const id of sichos) {
    const editions = ((units.get(id)?.data as { editions?: Array<{ url?: string; kind?: string; role?: string }> } | undefined)?.editions ?? []).filter((e) => e.kind === 'pdf');
    const own = editions.find((e) => e.role === 'sicha') ?? editions.find((e) => !e.role);
    keep(id, mediaSourceOf(own?.url));
  }
  const withWords = new Set(transcribed.map((t) => t.recording));

  // A farbrengen's original: a Drive file (or one RebbeHub keeps) he links.
  const originals: Record<string, number> = {};
  for (const id of farbrengens) {
    const source = mediaSourceOf(String(form.get(`original:${id}`) ?? '').trim());
    if (source && source.kind !== 'jem') originals[id] = media.push(source) - 1;
  }

  // Pages the reader read: those kept, then the files added now.
  const readings: NonNullable<Showcase['readings']> = [];
  const keepReading = (reading: { title: string; scan: string | null; body: unknown }) => {
    if (readings.length >= MAX_READINGS) return;
    const source = mediaSourceOf(reading.scan);
    const r = reading as NonNullable<Showcase['readings']>[number];
    readings.push({ title: r.title, scan: r.scan, body: r.body, media: source ? media.push(source) - 1 : null });
  };
  for (const [i, kept] of (existing?.readings ?? []).entries()) if (form.get(`drop-reading:${i}`) !== 'on') keepReading(kept);
  for (const file of form.getAll('reading')) {
    if (typeof file === 'string' || !file.size || file.size > MAX_READING_BYTES) continue;
    const words = await file.text();
    const name = file.name.replace(/\.\w+$/, '');
    // The reader's own output (JSON) keeps the print's lines; its text file does not.
    const reading = /^\s*[{[]/.test(words) ? readingOfJson(words, name) : readingOf(words, name);
    if (reading) keepReading(reading);
  }

  const now = new Date().toISOString();
  const showcase: Showcase = {
    token: existing?.token ?? newToken(),
    title: String(form.get('title') ?? '').trim().slice(0, 120) || 'RebbeHub',
    note: String(form.get('note') ?? '').trim().slice(0, 240),
    lang: 'en',
    created: existing?.created ?? now,
    updated: now,
    farbrengens,
    sichos,
    extras,
    media,
    mediaOf,
    transcripts: recordings.filter((r) => withWords.has(r.id) && mediaOf[r.id] !== undefined).map((r) => r.id),
    readings,
    originals,
  };
  await showcases.store.put(showcase);
  return redirect(`/showcase?edit=${showcase.token}&saved=${showcase.token}`);
}

export function headers() {
  return { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: `${w(loaderData?.lang ?? 'he', 'title')} · RebbeHub` }, { name: 'robots', content: 'noindex, nofollow' }];
}

export function ErrorBoundary() {
  return (
    <div className="wrap narrow page">
      <EmptyState icon="lock" title={W.ownerOnly.he}>
        {W.ownerOnly.en}
      </EmptyState>
    </div>
  );
}

export default function ShowcasePicker({ loaderData }: Route.ComponentProps) {
  const { lang } = loaderData;
  if (loaderData.state !== 'owner-ok') {
    return (
      <div className="wrap narrow page">
        <EmptyState icon="lock" title={w(lang, loaderData.state === 'none' ? 'none' : 'ownerOnly')} />
      </div>
    );
  }
  const { siteUrl, list, current, best, read, saved, fonts } = loaderData;
  return (
    <div className="wrap page showcase-page">
      <h1 className="page-title">{w(lang, 'title')}</h1>
      <p className="subtle">{w(lang, 'intro')}</p>

      {saved ? <Saved url={`${siteUrl}/show/${saved}`} lang={lang} /> : null}

      {list.length ? (
        <section className="sc-list">
          <h2 className="h-sec">{w(lang, 'yours')}</h2>
          <ul className="stack">
            {list.map((s) => (
              <li key={s.token} className="sc-row">
                <div>
                  <b>{s.title}</b>
                  {s.note ? <span className="subtle"> · {s.note}</span> : null}
                  <div className="subtle small">
                    {num(s.farbrengens, lang)} {w(lang, 'farbrengens')} · {num(s.sichos, lang)} {w(lang, 'sichos')} · {new Date(s.updated).toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-US')}
                  </div>
                </div>
                <div className="btn-row">
                  <CopyLink url={`${siteUrl}/show/${s.token}`} lang={lang} />
                  <a className="btn sm" href={`/show/${s.token}`} target="_blank" rel="noreferrer">
                    {w(lang, 'open')}
                  </a>
                  <a className="btn sm" href={`/showcase?edit=${s.token}`}>
                    {w(lang, 'edit')}
                  </a>
                </div>
              </li>
            ))}
          </ul>
          {current ? (
            <p>
              <a href="/showcase">+ {w(lang, 'newOne')}</a>
            </p>
          ) : null}
        </section>
      ) : null}

      <Editor key={current?.token ?? 'new'} lang={lang} current={current} best={best} read={read} fonts={fonts} />
    </div>
  );
}

type Current = {
  token: string;
  title: string;
  note: string;
  extras: ShowcaseExtras;
  farbrengens: Pick[];
  sichos: Pick[];
  readings: Array<{ title: string; scan: string | null }>;
  originals: Record<string, string>;
} | null;
type Best = Pick & { parts: number; paragraphs: number; checked: number };
type Read = Pick & { segments: number };

function Editor({ lang, current, best, read, fonts }: { lang: Lang; current: Current; best: Best[]; read: Read[]; fonts: Record<PrintFont, boolean> }) {
  const busy = useNavigation().state !== 'idle';
  const [farbrengens, setFarbrengens] = useState<Pick[]>(current?.farbrengens ?? best.slice(0, 3));
  const [sichos, setSichos] = useState<Pick[]>(current?.sichos ?? read.slice(0, 3));
  const extras = current?.extras ?? { daily: true, mafteach: true, models: true, numbers: true };
  const has = (id: string) => farbrengens.some((p) => p.id === id) || sichos.some((p) => p.id === id);
  const addTo = (set: (f: (list: Pick[]) => Pick[]) => void) => (pick: Pick) => set((list) => (list.some((p) => p.id === pick.id) || list.length >= MAX_ITEMS ? list : [...list, pick]));

  return (
    <Form method="post" encType="multipart/form-data" className="sc-editor box">
      <h2 className="h-sec">{current ? `${w(lang, 'editing')}: ${current.title}` : w(lang, 'newOne')}</h2>
      {current ? <input type="hidden" name="token" value={current.token} /> : null}
      <input type="hidden" name="farbrengens" value={farbrengens.map((p) => p.id).join(',')} />
      <input type="hidden" name="sichos" value={sichos.map((p) => p.id).join(',')} />

      <div className="sc-fields">
        <label>
          <span>{w(lang, 'name')}</span>
          <input name="title" defaultValue={current?.title ?? 'RebbeHub'} placeholder={w(lang, 'namePh')} maxLength={120} dir="auto" />
        </label>
        <label>
          <span>{w(lang, 'note')}</span>
          <input name="note" defaultValue={current?.note ?? ''} placeholder={w(lang, 'notePh')} maxLength={240} dir="auto" />
        </label>
      </div>

      <Finder lang={lang} has={has} onEvent={addTo(setFarbrengens)} onUnit={addTo(setSichos)} />

      <h3 className="sc-h">{w(lang, 'farbrengens')}</h3>
      <p className="subtle small">{w(lang, 'farbrengensSub')}</p>
      <Picked list={farbrengens} set={setFarbrengens} lang={lang} originals={current?.originals ?? {}} />

      <h3 className="sc-h">{w(lang, 'sichos')}</h3>
      <p className="subtle small">{w(lang, 'sichosSub')}</p>
      <Picked list={sichos} set={setSichos} lang={lang} />

      <h3 className="sc-h">{w(lang, 'readings')}</h3>
      <p className="subtle small">{w(lang, 'readingsSub')}</p>
      {current?.readings.length ? (
        <ul className="sc-picked">
          {current.readings.map((r, i) => (
            <li key={i}>
              <span>
                <b dir="auto">{r.title}</b> {r.scan ? null : <span className="subtle small">{w(lang, 'noScan')}</span>}
              </span>
              <label className="sc-check">
                <input type="checkbox" name={`drop-reading:${i}`} />
                {w(lang, 'dropReading')}
              </label>
            </li>
          ))}
        </ul>
      ) : null}
      <label className="sc-file">
        <span>{w(lang, 'addReading')}</span>
        <input type="file" name="reading" accept=".txt,.json,text/plain,application/json" multiple />
      </label>

      <h3 className="sc-h">{w(lang, 'fonts')}</h3>
      <p className="subtle small">{w(lang, 'fontsSub')}</p>
      {PRINT_FONTS.map((name) => (
        <label key={name} className="sc-file">
          <span>
            {w(lang, name === 'frank' ? 'fontFrank' : 'fontMiram')} {fonts[name] ? <span className="subtle small">({w(lang, 'fontKept')})</span> : null}
          </span>
          <input type="file" name={`font-${name}`} accept=".ttf,.otf,.woff,.woff2,font/*" />
        </label>
      ))}

      <h3 className="sc-h">{w(lang, 'also')}</h3>
      <div className="sc-extras">
        {(Object.keys(NO_EXTRAS) as Array<keyof ShowcaseExtras>).map((key) => (
          <label key={key} className="sc-check">
            <input type="checkbox" name={key} defaultChecked={extras[key]} />
            {w(lang, key)}
          </label>
        ))}
      </div>

      <div className="btn-row sc-actions">
        <button type="submit" name="intent" value="save" className="btn primary" disabled={busy}>
          {w(lang, busy ? 'saving' : 'save')}
        </button>
        {current ? (
          <button type="submit" name="intent" value="delete" className="btn danger" disabled={busy}>
            {w(lang, 'del')}
          </button>
        ) : null}
      </div>

      {best.length ? (
        <>
          <h3 className="sc-h">{w(lang, 'best')}</h3>
          <p className="subtle small">{w(lang, 'bestSub')}</p>
          <ul className="sc-best">
            {best.map((b) => (
              <li key={b.id}>
                <div>
                  <b>{b.label}</b> <span className="subtle">{b.sub}</span>
                  <div className="subtle small">
                    {num(b.parts, lang)} {w(lang, 'parts')} · {num(b.paragraphs, lang)} {w(lang, 'paragraphs')} · {num(b.checked, lang)} {w(lang, 'checked')}
                  </div>
                </div>
                <button type="button" className="btn sm" disabled={has(b.id)} onClick={() => addTo(setFarbrengens)(b)}>
                  {w(lang, 'add')}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {read.length ? (
        <>
          <h3 className="sc-h">{w(lang, 'read')}</h3>
          <p className="subtle small">{w(lang, 'readSub')}</p>
          <ul className="sc-best">
            {read.map((r) => (
              <li key={r.id}>
                <div>
                  <b>{r.label}</b> <span className="subtle">{r.sub}</span>
                  {r.segments ? (
                    <div className="subtle small">
                      {num(r.segments, lang)} {w(lang, 'paragraphs')}
                    </div>
                  ) : null}
                </div>
                <button type="button" className="btn sm" disabled={has(r.id)} onClick={() => addTo(setSichos)(r)}>
                  {w(lang, 'add')}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Form>
  );
}

function Picked({ list, set, lang, originals }: { list: Pick[]; set: (f: (list: Pick[]) => Pick[]) => void; lang: Lang; originals?: Record<string, string> }) {
  if (!list.length) return <p className="subtle">{w(lang, 'nothing')}</p>;
  return (
    <ol className="sc-picked">
      {list.map((p, i) => (
        <li key={p.id}>
          <span>
            <b>{p.label}</b> <span className="subtle">{p.sub}</span>
            {originals ? (
              <input className="sc-original" name={`original:${p.id}`} defaultValue={originals[p.id] ?? ''} placeholder={w(lang, 'original')} aria-label={w(lang, 'original')} dir="ltr" />
            ) : null}
          </span>
          <span className="btn-row">
            <button type="button" className="btn sm icon" disabled={i === 0} aria-label={w(lang, 'up')} title={w(lang, 'up')} onClick={() => set((l) => [...l.slice(0, i - 1), l[i]!, l[i - 1]!, ...l.slice(i + 1)])}>
              <Icon name="chevu" />
            </button>
            <button type="button" className="btn sm" onClick={() => set((l) => l.filter((x) => x.id !== p.id))}>
              {w(lang, 'remove')}
            </button>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Finding farbrengens and sichos by name or date, as the command palette does (`/_/find`). */
function Finder({ lang, has, onEvent, onUnit }: { lang: Lang; has: (id: string) => boolean; onEvent: (p: Pick) => void; onUnit: (p: Pick) => void }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Array<Pick & { type: string; kind: string }>>([]);
  useEffect(() => {
    if (q.trim().length < 2) return setFound([]);
    let live = true;
    const timer = setTimeout(() => {
      void fetch(`/_/find?${new URLSearchParams({ q, ...(lang === 'en' ? { lang } : {}) })}`, { headers: { accept: 'application/json' } })
        .then((r) => (r.ok ? (r.json() as Promise<{ items: Array<{ id: string; label: string; kind: string; type: string; date: string | null; path: string }> }>) : { items: [] }))
        .then(({ items }) => live && setFound(items.filter((i) => i.type === 'event' || i.type === 'unit').map((i) => ({ id: i.id, label: i.label, sub: i.date ?? i.path, type: i.type, kind: i.kind }))))
        .catch(() => undefined);
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q, lang]);
  return (
    <div className="sc-finder">
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={w(lang, 'search')} aria-label={w(lang, 'search')} dir="auto" />
      {found.length ? (
        <ul className="sc-found">
          {found.map((f) => (
            <li key={f.id}>
              <span>
                <b>{f.label}</b> <span className="subtle small">{[f.kind, f.sub].filter(Boolean).join(' · ')}</span>
              </span>
              <button type="button" className="btn sm" disabled={has(f.id)} onClick={() => (f.type === 'event' ? onEvent(f) : onUnit(f))}>
                {w(lang, 'add')}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function CopyLink({ url, lang }: { url: string; lang: Lang }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn sm"
      onClick={() =>
        void navigator.clipboard?.writeText(url).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        })
      }
    >
      {w(lang, done ? 'copied' : 'copy')}
    </button>
  );
}

function Saved({ url, lang }: { url: string; lang: Lang }) {
  return (
    <div className="alert positive sc-saved" role="status">
      <span>{w(lang, 'saved')}</span>
      <a href={url} target="_blank" rel="noreferrer" dir="ltr">
        {url}
      </a>
      <CopyLink url={url} lang={lang} />
    </div>
  );
}

