import { useState } from 'react';
import { data, Link } from 'react-router';
import { isPageText } from '@rebbehub/model';
import type { Route } from './+types/edit';
import { PageWords } from '../components/PageWords.js';
import { SegmentEditor, SentNote, type SentSuggestion } from '../components/SegmentEditor.js';
import { SuggestFix, canSuggestFix } from '../components/SuggestFix.js';
import { siteOf } from '../lib/context.server.js';
import { langFrom, t } from '../lib/i18n.js';
import { labelOf } from '../lib/labels.js';
import { href } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { useAccount } from '../lib/useAccount.js';
import { Icon } from '../ui/Icon.js';
import { ItemSubpage } from '../views/ItemSubpage.js';
import '../styles/pages/contribute.css';
import '../styles/pages/words.css';

const WORDS = {
  help: {
    he: 'לחצו על קטע כדי לתקן אותו במקומו. כל תיקון נשלח לבדיקה בפני עצמו, ואחראי האוסף מאשרים אותו.',
    en: "Click a segment to fix it in place. Each fix goes for review on its own, and the set's keepers approve it.",
  },
  empty: { he: 'לדף הזה אין עדיין טקסט. כתבו את הפסקה הראשונה שלו:', en: 'This page has no words yet. Write its first paragraph:' },
  how: { he: 'איך עורכים', en: 'How editing works' },
  steps: {
    he: ['לוחצים על קטע, והוא נפתח לעריכה במקומו.', 'מתקנים את המילים, וכותבים בשורה אחת מה תוקן.', 'שולחים: כל תיקון הוא הצעה בפני עצמה.', 'אחראי האוסף מאשרים, והתיקון עולה. כל גרסה נשמרת בהיסטוריה.'],
    en: ['Click a segment and it opens for editing where it is.', 'Fix the words, and say in a line what you fixed.', 'Send it: each fix is a Suggestion of its own.', 'The keepers approve it and it goes live. Every version stays in the history.'],
  },
  keys: { he: 'Ctrl+Enter שולח, Esc סוגר.', en: 'Ctrl+Enter sends, Esc closes.' },
  history: { he: 'ההיסטוריה של הדף', en: 'The page’s history' },
  talk: { he: 'לשאול בדף השיחה', en: 'Ask on the talk page' },
  fields: { he: 'השם והתאריך', en: 'Its name and date' },
} as const;

/**
 * Editing a page (the wiki model): its words as they are read, where a
 * click on any segment opens it in place; the fix is sent for review as a
 * Suggestion of its own, with a line on what changed. A page with no words
 * yet starts with its first paragraph. Its name and date are in the
 * panel below. Nothing goes live before the set's keepers approve, and
 * every version stays in the history.
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const entity = await api.entity(params.id);
  if (!entity) throw data('not found', { status: 404 });
  return { lang: langFrom(request), siteUrl, entity };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  const { lang, siteUrl, entity } = loaderData;
  return pageMeta({ title: `${t(lang, 'tabEdit')}: ${labelOf(entity, lang)}`, path: `/edit/${entity.id}`, lang, siteUrl, noindex: true });
}

export default function Edit({ loaderData }: Route.ComponentProps) {
  const { lang, entity } = loaderData;
  const account = useAccount();
  const [started, setStarted] = useState<SentSuggestion | null>(null);
  const body = (entity.data as { body?: unknown }).body;
  const page = isPageText(body) && body.versions.some((v) => v.segments.length) ? body : null;
  const withheld = Boolean((entity as { withheld?: string }).withheld);

  return (
    <ItemSubpage
      entity={entity}
      lang={lang}
      current="edit"
      here={t(lang, 'tabEdit')}
      side={
        <>
          <section>
            <h4>{WORDS.how[lang]}</h4>
            <ol className="edit-steps">
              {WORDS.steps[lang].map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
            <p className="muted small">
              <Icon name="keyboard" size={14} /> {WORDS.keys[lang]}
            </p>
          </section>
          <section>
            <Link to={href(`/history/${entity.id}`, lang)} className="side-link">
              <Icon name="history" />
              {WORDS.history[lang]}
            </Link>
            <Link to={href(`/talk/${entity.id}`, lang)} className="side-link">
              <Icon name="discuss" />
              {WORDS.talk[lang]}
            </Link>
          </section>
        </>
      }
    >
      {account === null ? (
        <p className="alert info">
          <Icon name="lock" />
          <span>
            {t(lang, 'editSignIn')} <Link to={href('/signin', lang, { return: `/edit/${entity.id}` })}>{t(lang, 'signIn')}</Link>
          </span>
        </p>
      ) : withheld ? (
        <p className="alert">
          <Icon name="lock" />
          <span>{t(lang, 'withheldChange')}</span>
        </p>
      ) : page ? (
        <section className="page-body edit-words">
          <p className="alert info">
            <Icon name="pencil" />
            <span>{WORDS.help[lang]}</span>
          </p>
          {/* Until the browser knows who is signed in, the words are shown as they are read. */}
          <PageWords page={page} lang={lang} edit={account ? { entityId: entity.id } : undefined} />
        </section>
      ) : started ? (
        <p className="alert positive">
          <Icon name="check" />
          <SentNote sent={started} lang={lang} />
        </p>
      ) : account === undefined ? null : (
        <section className="page-body edit-words">
          <p className="alert info">
            <Icon name="pencil" />
            <span>{WORDS.empty[lang]}</span>
          </p>
          <SegmentEditor entityId={entity.id} mode="start" language={lang} lang={lang} onClose={() => history.back()} onSent={setStarted} />
        </section>
      )}
      {account && canSuggestFix(entity) ? (
        <div className="below">
          <SuggestFix entity={entity} lang={lang} />
        </div>
      ) : null}
    </ItemSubpage>
  );
}
