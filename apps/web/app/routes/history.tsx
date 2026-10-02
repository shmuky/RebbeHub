import { useState } from 'react';
import { data, Link } from 'react-router';
import type { Route } from './+types/history';
import { ChangeRows, wordsStat } from '../components/ChangeDiff.js';
import { siteOf } from '../lib/context.server.js';
import { langFrom, t, type Lang } from '../lib/i18n.js';
import { num } from '../lib/i18nUi.js';
import { labelOf } from '../lib/labels.js';
import { href } from '../lib/links.js';
import { personName } from '../lib/people.js';
import { pageMeta } from '../lib/seo.js';
import { useAccount } from '../lib/useAccount.js';
import { between } from '../lib/versions.js';
import { Icon } from '../ui/Icon.js';
import { AgentBy, Avatar, EmptyState, RelativeTime } from '../ui/primitives.js';
import { ItemSubpage } from '../views/ItemSubpage.js';
import '../styles/pages/contribute.css';

/**
 * History: every version of an item, newest first, down one line as a
 * pull request's commits are: who changed it and in what words, who
 * approved it and when, and the change itself (the words that changed
 * marked, any other field by its name). "Restore this version" sends the
 * older version for review like any Suggestion. Nothing is ever lost.
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const lang = langFrom(request);
  const entity = await api.entity(params.id);
  if (!entity) throw data('not found', { status: 404 });
  return { lang, siteUrl, entity, history: await api.history(entity.id) };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  const { lang, siteUrl, entity } = loaderData;
  return pageMeta({ title: `${t(lang, 'history')}: ${labelOf(entity, lang)}`, path: `/history/${entity.id}`, lang, siteUrl, noindex: true });
}

const W = {
  version: { he: 'גרסה', en: 'Version' },
  versions: { he: 'גרסאות', en: 'versions' },
  who: { he: 'מי שינה כאן', en: 'Who changed it' },
  about: { he: 'על ההיסטוריה', en: 'About the history' },
  aboutText: {
    he: 'כל שינוי שאושר נשמר כגרסה. החזרה של גרסה ישנה היא הצעה כמו כל הצעה: אחראי האוסף רואים אותה ומאשרים.',
    en: 'Every approved change is kept as a version. Restoring an older one is a Suggestion like any other: the keepers see it and approve.',
  },
  talk: { he: 'לדבר על הדף', en: 'Talk about the page' },
  empty: { he: 'לפריט הזה עוד אין גרסאות.', en: 'This item has no versions yet.' },
  restoring: { he: 'שולח…', en: 'Sending…' },
  wrote: { he: 'שינה', en: 'changed it' },
  bot: { he: 'ייבוא', en: 'import' },
  latest: { he: 'השינוי האחרון', en: 'The latest change' },
  approver: { he: 'אישר:', en: 'Approved by' },
  by: { he: 'הצעה של', en: 'suggested by' },
  shown: { he: 'הגרסה שמוצגת עכשיו', en: 'The version shown now' },
  what: { he: 'מה השתנה', en: 'What changed' },
  view: { he: 'איך להראות שינוי', en: 'How to show a change' },
  side: { he: 'זה לצד זה', en: 'Side by side' },
  inText: { he: 'בתוך הטקסט', en: 'In the text' },
  before: { he: 'לפני', en: 'Before' },
  after: { he: 'אחרי', en: 'After' },
  pickTwo: { he: 'בחרו שתי גרסאות כדי להשוות. א׳ ישנה, ב׳ חדשה.', en: 'Pick two versions to compare. A is the older, B the newer.' },
  compare: { he: 'להשוואה', en: 'Compare' },
  older: { he: 'א׳', en: 'A' },
  newer: { he: 'ב׳', en: 'B' },
  changes: { he: 'שינויים', en: 'changes' },
  none: { he: 'אין הבדל בין שתי הגרסאות.', en: 'The two versions are the same.' },
  cannot: { he: 'את שתי הגרסאות האלה אי אפשר להשוות כאן; השינויים של כל גרסה פתוחים ברשימה.', en: "These two versions can't be compared here; each version's changes are in the list." },
  clearPick: { he: 'סגירת ההשוואה', en: 'Close the comparison' },
} as const;

function RestoreButton({ entityId, rev, lang }: { entityId: string; rev: number; lang: Lang }) {
  const [state, setState] = useState<{ busy?: boolean; sent?: number; error?: string }>({});
  if (state.sent)
    return (
      <span className="hist-sent" role="status">
        <Icon name="check" />
        {t(lang, 'restoreSent')} <Link to={href('/review', lang, { s: String(state.sent) })}>{t(lang, 'suggestSee')}</Link>
      </span>
    );
  return (
    <>
      <button
        type="button"
        className="btn sm"
        disabled={state.busy}
        aria-busy={state.busy || undefined}
        onClick={async () => {
          setState({ busy: true });
          const response = await fetch(`/_/steward/entities/${entityId}/restore`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ rev }),
          });
          const body = (await response.json().catch(() => ({}))) as { suggestion?: number; message?: string };
          setState(response.ok ? { sent: body.suggestion } : { error: body.message ?? response.statusText });
        }}
      >
        <Icon name="history" />
        {state.busy ? W.restoring[lang] : t(lang, 'restoreVersion')}
      </button>
      {state.error ? (
        <span className="hist-error" role="alert">
          <Icon name="warn" /> {state.error}
        </span>
      ) : null}
    </>
  );
}

export default function History({ loaderData }: Route.ComponentProps) {
  const { lang, entity, history } = loaderData;
  const account = useAccount();
  // As design/ draws versions (4f): a change read side by side, before and after, or one above the other.
  const [side, setSide] = useState(true);
  // Any two versions picked to compare (4f), read from the history already here: no request.
  const [pick, setPick] = useState<number[]>([]);
  const toggle = (rev: number) => setPick((was) => (was.includes(rev) ? was.filter((r) => r !== rev) : [...was.slice(-1), rev]));
  const order = (rev: number) => history.findIndex((h) => h.rev === rev);
  const [older, newer] = pick.length === 2 ? [...pick].sort((a, b) => order(b) - order(a)) : [];
  const compared = older !== undefined && newer !== undefined ? between(history, older, newer) : undefined;
  const whenOf = (rev: number) => history.find((h) => h.rev === rev);
  // Everyone who changed it, most changes first.
  const people = new Map<string, { name: string; bot: boolean; n: number }>();
  for (const h of history) {
    const was = people.get(h.author);
    people.set(h.author, { name: personName(h.author, h.authorName, lang), bot: h.authorIsBot, n: (was?.n ?? 0) + 1 });
  }
  const who = [...people.entries()].sort((a, b) => b[1].n - a[1].n);
  // The last change, open at the top as design/ draws it (4c); the older ones open on asking.
  const latest = history[0] && !history[0].created && !history[0].deleted ? history[0] : null;
  return (
    <ItemSubpage
      entity={entity}
      lang={lang}
      current="history"
      here={t(lang, 'history')}
      sub={`${num(history.length, lang)} ${W.versions[lang]}`}
      side={
        <>
          <section>
            <h4>{W.about[lang]}</h4>
            <p className="muted">{W.aboutText[lang]}</p>
            <p className="side-count">
              <b>{num(history.length, lang)}</b> {W.versions[lang]}
            </p>
          </section>
          {who.length ? (
            <section>
              <h4>{W.who[lang]}</h4>
              <ul className="side-list">
                {who.map(([id, p]) => (
                  <li key={id}>
                    <Avatar name={p.name} id={id} size="xs" bot={p.bot} />
                    <span className="grow">{p.name}</span>
                    <span className="num subtle">{num(p.n, lang)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <section>
            <Link to={href(`/talk/${entity.id}`, lang)} className="side-link">
              <Icon name="discuss" />
              {W.talk[lang]}
            </Link>
          </section>
        </>
      }
    >
      {history.length === 0 ? (
        <EmptyState icon="history" title={W.empty[lang]} />
      ) : (
        <>
          {history.some((h) => !h.created && !h.deleted) ? (
            <div className="hist-view segmented" role="radiogroup" aria-label={W.view[lang]}>
              <button type="button" role="radio" aria-checked={side} aria-pressed={side} onClick={() => setSide(true)}>
                {W.side[lang]}
              </button>
              <button type="button" role="radio" aria-checked={!side} aria-pressed={!side} onClick={() => setSide(false)}>
                {W.inText[lang]}
              </button>
            </div>
          ) : null}
          {history.length > 1 ? <p className="hist-hint subtle">{W.pickTwo[lang]}</p> : null}
          {older !== undefined && newer !== undefined ? (
            <section className={side ? 'hist-latest hist-compare side' : 'hist-latest hist-compare'} style={{ ['--was' as string]: `"${W.older[lang]}"`, ['--now' as string]: `"${W.newer[lang]}"` }} aria-live="polite">
              <div className="hist-compare-h">
                <h2>
                  {W.older[lang]} <RelativeTime at={whenOf(older)!.at} lang={lang} /> · {W.newer[lang]} <RelativeTime at={whenOf(newer)!.at} lang={lang} />
                </h2>
                {compared?.length ? <span className="subtle">{wordsStat(compared, lang) ?? `${num(compared.length, lang)} ${W.changes[lang]}`}</span> : null}
                <span className="grow" />
                {account && order(older) > 0 ? <RestoreButton entityId={entity.id} rev={older} lang={lang} /> : null}
                <button type="button" className="ib" aria-label={W.clearPick[lang]} title={W.clearPick[lang]} onClick={() => setPick([])}>
                  <Icon name="x" />
                </button>
              </div>
              {compared === null ? <p className="subtle">{W.cannot[lang]}</p> : compared?.length ? <ChangeRows changes={compared} lang={lang} /> : <p className="subtle">{W.none[lang]}</p>}
            </section>
          ) : latest ? (
            <section className={side ? 'hist-latest side' : 'hist-latest'} style={{ ['--was' as string]: `"${W.before[lang]}"`, ['--now' as string]: `"${W.after[lang]}"` }}>
              <h2>{W.latest[lang]}</h2>
              <ChangeRows changes={latest.changes} lang={lang} />
            </section>
          ) : null}
          <ol className={side ? 'hist2 side' : 'hist2'} aria-label={t(lang, 'history')} style={{ ['--was' as string]: `"${W.before[lang]}"`, ['--now' as string]: `"${W.after[lang]}"` }}>
            {history.map((h, i) => {
              const author = personName(h.author, h.authorName, lang);
              const approver = personName(h.mergedBy, h.mergedByName, lang);
              const stat = h.created || h.deleted ? null : wordsStat(h.changes, lang);
              const mark = h.rev === older ? W.older[lang] : h.rev === newer ? W.newer[lang] : null;
              return (
                <li key={h.commit} id={`v${h.rev}`} className={[i === 0 ? 'now' : '', pick.includes(h.rev) ? 'picked' : ''].filter(Boolean).join(' ') || undefined}>
                  <span className="hist-dot" aria-hidden="true">
                    {mark}
                  </span>
                  {history.length > 1 ? (
                    <button type="button" className="hist-pick" aria-pressed={pick.includes(h.rev)} onClick={() => toggle(h.rev)}>
                      {mark ?? W.compare[lang]}
                    </button>
                  ) : null}
                  <h3 className="hist-title">
                    <bdi>{h.message || `${W.version[lang]} ${num(history.length - i, lang)}`}</bdi>
                  </h3>
                  <p className="hist-by">
                    {h.mergedBy !== h.author ? (
                      <>
                        {W.approver[lang]} {approver} ·{' '}
                      </>
                    ) : null}
                    <RelativeTime at={h.at} lang={lang} /> ·{' '}
                    <AgentBy via={h.via} lang={lang} who={author}>
                      {h.mergedBy !== h.author ? `${W.by[lang]} ${author}` : author}
                    </AgentBy>
                    {stat ? <> · {stat}</> : null}
                  </p>
                  {i === 0 ? <p className="hist-current">{W.shown[lang]}</p> : null}
                  {h.created ? (
                    <p className="hist-note">
                      <Icon name="plus" /> {t(lang, 'versionCreated')}
                    </p>
                  ) : h.deleted ? (
                    <p className="hist-note">
                      <Icon name="trash" /> {t(lang, 'versionDeleted')}
                    </p>
                  ) : i > 0 || !latest ? (
                    <details className="hist-what">
                      <summary>{W.what[lang]}</summary>
                      <div className="hist-changes">
                        <ChangeRows changes={h.changes} lang={lang} />
                      </div>
                    </details>
                  ) : null}
                  {i > 0 && account && !h.deleted ? (
                    <div className="hist-acts">
                      <RestoreButton entityId={entity.id} rev={h.rev} lang={lang} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </>
      )}
    </ItemSubpage>
  );
}
