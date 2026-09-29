import { Form, Link, useActionData, useNavigation } from 'react-router';
import { REPORT_REASONS, t } from '../lib/i18n.js';
import { href } from '../lib/links.js';
import { tt } from '../lib/threadStrings.js';
import { useLang } from '../lib/useLang.js';
import { Icon } from '../ui/Icon.js';
import { ChoiceList, Panel } from '../ui/primitives.js';

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
    <Panel id="report" icon="report" title={t(lang, 'report')} hint={lang === 'he' ? 'בלי חשבון' : 'No account needed'} open={result !== undefined}>
      {result?.reported ? (
        <p className="alert positive" role="status">
          <Icon name="check" />
          {t(lang, 'reportThanks')}
        </p>
      ) : (
        <Form method="post" className="form stack">
          {result && !result.reported ? (
            <p className="alert negative" role="alert">
              <Icon name="warn" />
              {t(lang, 'reportFailed')} {result.error}
            </p>
          ) : null}
          <input type="hidden" name="intent" value="report" />
          <input type="hidden" name="entityId" value={entityId} />
          <div className="field">
            <span className="field-label">{t(lang, 'reportWhat')}</span>
            <ChoiceList name="reason" inline required legend={t(lang, 'reportWhat')} options={REPORT_REASONS.map((r) => ({ value: r.id, label: r[lang] }))} />
          </div>
          <label className="field">
            <span className="field-label">{t(lang, 'reportNote')}</span>
            <textarea name="note" rows={3} maxLength={2000} dir="auto" />
          </label>
          <div className="form-actions">
            <button type="submit" className="btn primary" disabled={busy}>
              {t(lang, 'reportSend')}
            </button>
            <span className="hint">
              {tt(lang, 'reportPublic')} <Link to={href('/issues/new', lang, { item: entityId })}>{tt(lang, 'fullIssue')}</Link>
            </span>
          </div>
        </Form>
      )}
    </Panel>
  );
}
