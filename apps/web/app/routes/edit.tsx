import { useState } from 'react';
import { data, Link } from 'react-router';
import { isPageText } from '@rebbehub/model';
import type { Route } from './+types/edit';
import { PageTabs } from '../components/PageTabs.js';
import { PageWords } from '../components/PageWords.js';
import { SegmentEditor, SentNote, type SentSuggestion } from '../components/SegmentEditor.js';
import { SuggestFix, canSuggestFix } from '../components/SuggestFix.js';
import { siteOf } from '../lib/context.server.js';
import { langFrom, t } from '../lib/i18n.js';
import { labelOf } from '../lib/labels.js';
import { href } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { useAccount } from '../lib/useAccount.js';

const WORDS = {
  help: {
    he: 'לחצו על קטע כדי לתקן אותו במקומו. כל תיקון נשלח לבדיקה בפני עצמו, ואחראי האוסף מאשרים אותו.',
    en: "Click a segment to fix it in place. Each fix goes for review on its own, and the set's keepers approve it.",
  },
  empty: { he: 'לדף הזה אין עדיין טקסט. כתבו את הפסקה הראשונה שלו:', en: 'This page has no words yet. Write its first paragraph:' },
} as const;

/**
 * Editing a page (the wiki model): its words as they are read, where a
 * click on any segment opens it in place; the fix is sent for review as a
 * Suggestion of its own, with a line on what changed. A page with no words
 * yet starts with its first paragraph. Its name and date are in the
 * fields below. Nothing goes live before the set's keepers approve, and
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
    <>
      <PageTabs entity={entity} lang={lang} current="edit" />
      <h1>
        {t(lang, 'tabEdit')}: {labelOf(entity, lang)}
      </h1>
      {account === null ? (
        <p className="note">
          {t(lang, 'editSignIn')} <Link to={href('/signin', lang, { return: `/edit/${entity.id}` })}>{t(lang, 'signIn')}</Link>
        </p>
      ) : withheld ? (
        <p className="note">{t(lang, 'withheldChange')}</p>
      ) : page ? (
        <section className="page-body">
          <p className="row-sub">{WORDS.help[lang]}</p>
          {/* Until the browser knows who is signed in, the words are shown as they are read. */}
          <PageWords page={page} lang={lang} edit={account ? { entityId: entity.id } : undefined} />
        </section>
      ) : started ? (
        <p className="note">
          <SentNote sent={started} lang={lang} />
        </p>
      ) : account === undefined ? null : (
        <section className="page-body">
          <p className="row-sub">{WORDS.empty[lang]}</p>
          <SegmentEditor entityId={entity.id} mode="start" language={lang} lang={lang} onClose={() => history.back()} onSent={setStarted} />
        </section>
      )}
      {account && canSuggestFix(entity) ? <SuggestFix entity={entity} lang={lang} /> : null}
    </>
  );
}
