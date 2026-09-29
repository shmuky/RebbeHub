import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { Route } from './+types/issue-new';
import { Composer } from '../components/threads/Composer.js';
import { siteOf } from '../lib/context.server.js';
import { langFrom, type Lang } from '../lib/i18n.js';
import { labelOf } from '../lib/labels.js';
import { href, itemPath } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { questionsOf } from '../lib/issueTokens.js';
import { LABELS } from '../lib/suggestions.js';
import { threads, type Issue, type IssueTemplate } from '../lib/threads.js';
import { tt } from '../lib/threadStrings.js';
import { useAccount } from '../lib/useAccount.js';
import { useLang } from '../lib/useLang.js';
import { Icon } from '../ui/Icon.js';
import { Breadcrumbs, ChoiceList, Label, RelativeTime, StateIcon } from '../ui/primitives.js';

/**
 * Opening a Report, as GitHub's templates do it: what kind of problem it
 * is (each kind starts the words with the questions a keeper will ask),
 * then a title and the details, with @ and # as anywhere. `?type=` picks
 * the kind and `?item=` says which item it is about, so an item page can
 * link straight here; beside the form, the reports already open on that
 * item, so nobody writes the same one twice. Reports about rights or
 * offensive content are private; every other one is public.
 *
 * The kinds and the item are read on the server, so the page is whole
 * before script; sending it needs a signed-in reader.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const lang = langFrom(request);
  const itemId = /rh-[0-9a-z]{6,16}/.exec(new URL(request.url).searchParams.get('item')?.toLowerCase() ?? '')?.[0] ?? null;
  const [templates, entity, open] = await Promise.all([
    api.issueTemplates().catch(() => [] as IssueTemplate[]),
    itemId ? api.entity(itemId).catch(() => null) : null,
    itemId ? api.issues({ entity: itemId, state: 'open', limit: 5 }).catch(() => null) : null,
  ]);
  const item = entity ? { id: entity.id, path: itemPath(entity), name: labelOf(entity, lang) || entity.id } : null;
  return { lang, siteUrl, templates, item, open: open?.items ?? [] };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  return pageMeta({ title: loaderData.lang === 'he' ? 'דיווח חדש' : 'New report', path: '/issues/new', lang: loaderData.lang, siteUrl: loaderData.siteUrl, noindex: true });
}

const W = {
  reports: { he: 'דיווחים', en: 'Reports' },
  title: { he: 'דיווח חדש', en: 'New report' },
  lead: { he: 'מצאתם טעות, עמוד חסר או הקלטה שנקטעת? ספרו מה ראיתם ואיפה, ואחראי האוסף יבדקו.', en: 'Found a wrong word, a missing page or a recording cut short? Say what you saw and where, and the set’s keepers will look.' },
  kind: { he: 'מה הבעיה?', en: 'What is it about?' },
  about: { he: 'על', en: 'About' },
  noItem: { he: 'על פריט מסוים? הדביקו את המזהה או הקישור שלו', en: 'About one item? Paste its id or link' },
  clear: { he: 'לא על פריט מסוים', en: 'Not about one item' },
  titleHint: { he: 'במשפט אחד: מה לא בסדר', en: 'In one line: what is wrong' },
  details: { he: 'פרטים', en: 'Details' },
  send: { he: 'פתיחת הדיווח', en: 'Open the report' },
  pickKind: { he: 'בחרו קודם מה הבעיה', en: 'Pick what it is about first' },
  signIn: { he: 'כדי לפתוח דיווח צריך להתחבר', en: 'Sign in to open a report' },
  already: { he: 'דיווחים פתוחים על הפריט', en: 'Open reports on this item' },
  noneOpen: { he: 'אין דיווחים פתוחים על הפריט.', en: 'No open reports on this item.' },
  before: { he: 'לפני שפותחים', en: 'Before you open one' },
  tip1: { he: 'טעות קטנה בטקסט אפשר להציע לתקן ישירות, בלי דיווח: לחצו על המילה בעמוד.', en: 'A small mistake in the words can be suggested straight away, without a report: select the word on the page.' },
  tip2: { he: 'דיווח גלוי לכולם. דיווח על זכויות או על תוכן פוגע פרטי: רואים אותו רק המנהלים ואחראי האוסף.', en: 'A report is public. One about rights or offensive content is private: only stewards and the set’s keepers see it.' },
  search: { he: 'חיפוש בדיווחים', en: 'Search the reports' },
  private: { he: 'פרטי', en: 'Private' },
} as const;
const w = (lang: Lang, key: keyof typeof W) => W[key][lang];

export default function NewIssue({ loaderData }: Route.ComponentProps) {
  const { templates, open } = loaderData;
  const lang = useLang();
  const account = useAccount();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [item, setItem] = useState(loaderData.item);
  const [itemText, setItemText] = useState(params.get('item') && !loaderData.item ? params.get('item')! : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const type = params.get('type');
  const template = templates.find((t) => t.type === type) ?? null;
  useEffect(() => setItem(loaderData.item), [loaderData.item]);

  // A kind's questions fill the box, unless something of one's own is written there already.
  useEffect(() => {
    if (template) setBody((now) => (now.trim() && !templates.some((t) => t.template[lang] === now) ? now : template.template[lang]));
  }, [template, templates, lang]);

  const choose = (to: string) => {
    const next = new URLSearchParams(params);
    next.set('type', to);
    setParams(next, { replace: true, preventScrollReset: true });
  };

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const entityId = item?.id ?? /rh-[0-9a-z]{6,16}/.exec(itemText.trim().toLowerCase())?.[0];
      const issue = await threads<Issue>('issues', { body: { title: title.trim(), body: body.trim(), type, entityId } });
      navigate(href(`/issues/${issue.number}`, lang));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const back = `/issues/new${params.size ? `?${params}` : ''}`;
  return (
    <>
      <div className="phead flat">
        <div className="wrap">
          <Breadcrumbs items={[{ label: w(lang, 'reports'), to: href('/issues', lang) }, { label: w(lang, 'title') }]} lang={lang} />
          <h1 className="page-title">{w(lang, 'title')}</h1>
          <p className="lede">{w(lang, 'lead')}</p>
        </div>
      </div>
      <div className="wrap cols new-report">
        <form
          className="imain stack"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <section className="box">
            <div className="box-h">
              <h2>{w(lang, 'kind')}</h2>
            </div>
            <ChoiceList
              name="type"
              legend={w(lang, 'kind')}
              value={type ?? ''}
              onChange={choose}
              required
              options={templates.map((t) => ({
                value: t.type,
                label: (
                  <>
                    {t.label[lang]}
                    {t.private ? (
                      <span className="badge-private">
                        <Icon name="lock" size={11} /> {w(lang, 'private')}
                      </span>
                    ) : null}
                  </>
                ),
                hint: questionsOf(t.template[lang]) || undefined,
              }))}
            />
          </section>
          <section className="box pad-box stack">
            <div className="field about-field">
              <span className="field-label">{w(lang, 'about')}</span>
              {item ? (
                <div className="row-line">
                  <Label to={href(item.path, lang)} className="where-label">
                    {item.name}
                  </Label>
                  <button
                    type="button"
                    className="icon-btn"
                    title={w(lang, 'clear')}
                    aria-label={w(lang, 'clear')}
                    onClick={() => {
                      setItem(null);
                      const next = new URLSearchParams(params);
                      next.delete('item');
                      setParams(next, { replace: true, preventScrollReset: true });
                    }}
                  >
                    <Icon name="x" size={13} />
                  </button>
                </div>
              ) : (
                <input type="text" value={itemText} onChange={(e) => setItemText(e.target.value)} placeholder={w(lang, 'noItem')} aria-label={tt(lang, 'aboutItem')} dir="auto" />
              )}
            </div>
            <label className="field">
              <span className="field-label">{tt(lang, 'title')}</span>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required placeholder={w(lang, 'titleHint')} dir="auto" />
            </label>
            <div className="field">
              <span className="field-label">{w(lang, 'details')}</span>
              <Composer lang={lang} value={body} onChange={setBody} placeholder={tt(lang, 'body')} error={error} />
            </div>
            {template?.private ? (
              <p className="note">
                <Icon name="lock" size={14} /> {tt(lang, 'privateType')}
              </p>
            ) : null}
            <div className="form-actions">
              {account === null ? (
                <Link className="btn primary" to={href('/signin', lang, { return: back })}>
                  <Icon name="lock" /> {w(lang, 'signIn')}
                </Link>
              ) : (
                <button type="submit" className="btn primary" disabled={busy || !title.trim() || !template || !account}>
                  {w(lang, 'send')}
                </button>
              )}
              {!template ? <span className="hint">{w(lang, 'pickKind')}</span> : null}
            </div>
          </section>
        </form>
        <aside className="side" aria-label={w(lang, 'before')}>
          {loaderData.item ? (
            <section>
              <h4>{w(lang, 'already')}</h4>
              {open.length ? (
                <ul className="thread-lines">
                  {open.map((i) => (
                    <li key={i.number} className="thread-line">
                      <StateIcon kind="report" state="open" />
                      <span>
                        <Link to={href(`/issues/${i.number}`, lang)} dir="auto">
                          {i.title ?? i.typeTitle[lang]}
                        </Link>
                        <span className="subtle small block">
                          #{i.number} · <RelativeTime at={i.createdAt} lang={lang} />
                          {i.labels.map((l) => (
                            <Label key={l.name} color={`#${l.color.replace('#', '')}`} size="sm">
                              {LABELS[l.name]?.[lang] ?? l.name}
                            </Label>
                          ))}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="subtle small">{w(lang, 'noneOpen')}</p>
              )}
            </section>
          ) : null}
          <section>
            <h4>{w(lang, 'before')}</h4>
            <p className="muted small">{w(lang, 'tip1')}</p>
            <p className="muted small">{w(lang, 'tip2')}</p>
            <Link className="see-all" to={href('/issues', lang)}>
              <Icon name="search" size={14} /> {w(lang, 'search')}
            </Link>
          </section>
        </aside>
      </div>
    </>
  );
}
