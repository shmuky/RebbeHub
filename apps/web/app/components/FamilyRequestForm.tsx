import { Form, useActionData, useNavigation } from 'react-router';
import { st } from '../lib/scanStrings.js';
import { t } from '../lib/i18n.js';
import { useLang } from '../lib/useLang.js';

export type FamilyRequestResult = { familyRequested: true } | { familyRequested: false; error: string } | undefined;

/**
 * A family's request that a teshura not be shown (the plan, section 8: a
 * fast family-request path). No account needed, and it works without
 * JavaScript: it posts to the page itself. The scan stops being shown at
 * once; the stewards look at the request and nothing is deleted.
 */
export function FamilyRequestForm({ teshura }: { teshura: string }) {
  const lang = useLang();
  const result = useActionData() as FamilyRequestResult | { reported: boolean };
  const navigation = useNavigation();
  const mine = result && 'familyRequested' in result ? result : undefined;
  return (
    <details className="report" id="family-request" open={mine !== undefined}>
      <summary>{st(lang, 'familyRequest')}</summary>
      {mine?.familyRequested ? (
        <p role="status">{st(lang, 'familyThanks')}</p>
      ) : (
        <Form method="post">
          {mine && !mine.familyRequested ? (
            <p role="alert">
              {t(lang, 'reportFailed')} {mine.error}
            </p>
          ) : null}
          <p className="row-sub">{st(lang, 'familyHow')}</p>
          <input type="hidden" name="intent" value="family-request" />
          <input type="hidden" name="teshura" value={teshura} />
          <label>
            {st(lang, 'familyRelation')}
            <input name="relation" maxLength={300} dir="auto" required />
          </label>
          <label>
            {t(lang, 'reportNote')}
            <textarea name="note" rows={3} maxLength={1500} dir="auto" />
          </label>
          <label>
            {st(lang, 'familyContact')}
            <input name="contact" maxLength={300} dir="auto" />
          </label>
          <div>
            <button type="submit" disabled={navigation.state === 'submitting'}>
              {st(lang, 'familySend')}
            </button>
          </div>
        </Form>
      )}
    </details>
  );
}
