import { Form, useActionData, useNavigation } from 'react-router';
import type { Route } from './+types/takedown';
import { ApiError } from '../lib/api.js';
import { siteOf } from '../lib/context.server.js';
import { langFrom, t } from '../lib/i18n.js';
import { pageMeta } from '../lib/seo.js';
import { Icon } from '../ui/Icon.js';
import { Box, ChoiceList } from '../ui/primitives.js';
import '../styles/pages/admin.css';

/**
 * The public takedown form (the plan, sections 8 and 11): a rights holder
 * or a family asks for a file to stop being served, with no account. It
 * posts to the page itself, so it works without JavaScript. The request
 * lands with the stewards, who answer within the days the page states and
 * take a file down in one click; nothing is deleted, a private copy is
 * kept (docs/rights.md). One narrow column: what will happen, then the
 * form in a box; who is asking is a choice of rows, never a drop-down.
 */

const RELATIONS = ['rights-holder', 'family', 'representative', 'other'] as const;

type Result = { sent: true; id: number } | { sent: false; error: string } | undefined;

export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  return { lang: langFrom(request), siteUrl: siteOf(context).siteUrl, target: url.searchParams.get('what') ?? '' };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  return pageMeta({ title: t(loaderData.lang, 'takedownTitle'), path: '/takedown', lang: loaderData.lang, siteUrl: loaderData.siteUrl });
}

export async function action({ request, context }: Route.ActionArgs): Promise<Result> {
  const { api } = siteOf(context);
  const form = await request.formData();
  const field = (name: string) => String(form.get(name) ?? '').trim();
  const forwardedFor = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for') ?? undefined;
  try {
    const { id } = await api.takedown({ target: field('target'), name: field('name'), email: field('email'), relation: field('relation'), statement: field('statement') }, forwardedFor);
    return { sent: true, id };
  } catch (error) {
    return { sent: false, error: error instanceof ApiError ? error.message : 'the server did not answer' };
  }
}

export default function Takedown({ loaderData }: Route.ComponentProps) {
  const { lang, target } = loaderData;
  const result = useActionData() as Result;
  const busy = useNavigation().state === 'submitting';
  return (
    <>
      <div className="phead flat">
        <div className="wrap narrow">
          <h1 className="page-title">{t(lang, 'takedownTitle')}</h1>
          <p className="lede">{t(lang, 'takedownIntro')}</p>
        </div>
      </div>
      <div className="wrap narrow page stack takedown">
        <div className="alert info" role="note">
          <Icon name="clock" />
          <div>{t(lang, 'takedownPromise')}</div>
        </div>
        {result?.sent ? (
          <div className="alert positive" role="status">
            <Icon name="check" />
            <div>
              {t(lang, 'takedownThanks')} <b className="num">{result.id}</b>
            </div>
          </div>
        ) : (
          <Box as="section" className="takedown-form-box">
            <Form method="post" className="form stack takedown-form">
              {result && !result.sent ? (
                <div className="alert negative" role="alert">
                  <Icon name="warn" />
                  <div>
                    {t(lang, 'takedownFailed')} {result.error}
                  </div>
                </div>
              ) : null}
              <label className="field">
                {t(lang, 'takedownWhat')}
                <input name="target" defaultValue={target} required maxLength={1000} dir="ltr" placeholder="https://rebbehub.org/…" />
              </label>
              <div className="form-row">
                <label className="field">
                  {t(lang, 'takedownName')}
                  <input name="name" required maxLength={200} autoComplete="name" dir="auto" />
                </label>
                <label className="field">
                  {t(lang, 'takedownEmail')}
                  <input name="email" type="email" required maxLength={254} autoComplete="email" dir="ltr" />
                </label>
              </div>
              <div className="field">
                <span className="field-label" aria-hidden="true">
                  {t(lang, 'takedownRelation')}
                </span>
                <ChoiceList name="relation" required legend={t(lang, 'takedownRelation')} options={RELATIONS.map((r) => ({ value: r, label: t(lang, `relation_${r}`) }))} />
              </div>
              <label className="field">
                {t(lang, 'takedownWhy')}
                <textarea name="statement" rows={5} required minLength={10} maxLength={4000} dir="auto" />
              </label>
              <div className="form-actions">
                <button type="submit" className="btn primary" disabled={busy}>
                  {busy ? t(lang, 'waiting') : t(lang, 'takedownSend')}
                </button>
              </div>
            </Form>
          </Box>
        )}
      </div>
    </>
  );
}
