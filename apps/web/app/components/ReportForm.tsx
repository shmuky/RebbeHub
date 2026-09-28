import { Form, useActionData, useNavigation } from 'react-router';
import { REPORT_REASONS, t } from '../lib/i18n.js';
import { useLang } from '../lib/useLang.js';

export type ReportResult = { reported: true } | { reported: false; error: string } | undefined;

/**
 * "Report a problem": one choice, a few optional words, no account. It
 * posts to the page itself, so it works without JavaScript.
 */
export function ReportForm({ entityId }: { entityId: string }) {
  const lang = useLang();
  // Only a report's own answer (the page's other forms post here too).
  const data = useActionData() as ReportResult | Record<string, unknown> | undefined;
  const result = data && 'reported' in data ? (data as ReportResult) : undefined;
  const navigation = useNavigation();
  const busy = navigation.state === 'submitting';
  return (
    <details className="report" id="report" open={result !== undefined}>
      <summary>{t(lang, 'report')}</summary>
      {result?.reported ? (
        <p role="status">{t(lang, 'reportThanks')}</p>
      ) : (
        <Form method="post">
          {result && !result.reported ? (
            <p role="alert">
              {t(lang, 'reportFailed')} {result.error}
            </p>
          ) : null}
          <input type="hidden" name="intent" value="report" />
          <input type="hidden" name="entityId" value={entityId} />
          <label>
            {t(lang, 'reportWhat')}
            <select name="reason" required defaultValue="">
              <option value="" disabled>
                …
              </option>
              {REPORT_REASONS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r[lang]}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t(lang, 'reportNote')}
            <textarea name="note" rows={3} maxLength={2000} />
          </label>
          <div>
            <button type="submit" disabled={busy}>
              {t(lang, 'reportSend')}
            </button>
          </div>
        </Form>
      )}
    </details>
  );
}
