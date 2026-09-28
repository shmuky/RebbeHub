import { Form, useActionData, useNavigation } from 'react-router';
import type { Route } from './+types/takedown';
import { ApiError } from '../lib/api.js';
import { siteOf } from '../lib/context.server.js';
import { langFrom, t } from '../lib/i18n.js';
import { pageMeta } from '../lib/seo.js';

/**
 * The public takedown form (the plan, sections 8 and 11): a rights holder
 * or a family asks for a file to stop being served, with no account. It
 * posts to the page itself, so it works without JavaScript. The request
 * lands with the stewards, who answer within the days the page states and
 * take a file down in one click; nothing is deleted, a private copy is
 * kept (docs/rights.md).
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
      <h1>{t(lang, 'takedownTitle')}</h1>
      <p className="subtitle">{t(lang, 'takedownIntro')}</p>
      <p>{t(lang, 'takedownPromise')}</p>
      {result?.sent ? (
        <p className="note" role="status">
          {t(lang, 'takedownThanks')} {result.id}
        </p>
      ) : (
        <Form method="post" className="takedown-form">
          {result && !result.sent ? (
            <p className="note" role="alert">
              {t(lang, 'takedownFailed')} {result.error}
            </p>
          ) : null}
          <label>
            {t(lang, 'takedownWhat')}
            <input name="target" defaultValue={target} required maxLength={1000} dir="ltr" placeholder="https://rebbehub.org/…" />
          </label>
          <label>
            {t(lang, 'takedownName')}
            <input name="name" required maxLength={200} autoComplete="name" dir="auto" />
          </label>
          <label>
            {t(lang, 'takedownEmail')}
            <input name="email" type="email" required maxLength={254} autoComplete="email" dir="ltr" />
          </label>
          <label>
            {t(lang, 'takedownRelation')}
            <select name="relation" required defaultValue="">
              <option value="" disabled>
                …
              </option>
              {RELATIONS.map((r) => (
                <option key={r} value={r}>
                  {t(lang, `relation_${r}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t(lang, 'takedownWhy')}
            <textarea name="statement" rows={4} required minLength={10} maxLength={4000} dir="auto" />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? t(lang, 'waiting') : t(lang, 'takedownSend')}
          </button>
        </Form>
      )}
    </>
  );
}
