import { Form, useActionData, useNavigation } from 'react-router';
import { st } from '../lib/scanStrings.js';
import { t } from '../lib/i18n.js';
import { useLang } from '../lib/useLang.js';
import { Icon } from '../ui/Icon.js';
import { Panel } from '../ui/primitives.js';

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
    <Panel id="family-request" icon="shield" title={st(lang, 'familyRequest')} open={mine !== undefined}>
      {mine?.familyRequested ? (
        <p className="alert positive" role="status">
          <Icon name="check" />
          {st(lang, 'familyThanks')}
        </p>
      ) : (
        <Form method="post" className="form stack">
          {mine && !mine.familyRequested ? (
            <p className="alert negative" role="alert">
              <Icon name="warn" />
              {t(lang, 'reportFailed')} {mine.error}
            </p>
          ) : null}
          <p className="hint">{st(lang, 'familyHow')}</p>
          <input type="hidden" name="intent" value="family-request" />
          <input type="hidden" name="teshura" value={teshura} />
          <label className="field">
            <span className="field-label">{st(lang, 'familyRelation')}</span>
            <input name="relation" maxLength={300} dir="auto" required />
          </label>
          <label className="field">
            <span className="field-label">{t(lang, 'reportNote')}</span>
            <textarea name="note" rows={3} maxLength={1500} dir="auto" />
          </label>
          <label className="field">
            <span className="field-label">{st(lang, 'familyContact')}</span>
            <input name="contact" maxLength={300} dir="auto" />
          </label>
          <div className="form-actions">
            <button type="submit" className="btn primary" disabled={navigation.state === 'submitting'}>
              {st(lang, 'familySend')}
            </button>
          </div>
        </Form>
      )}
    </Panel>
  );
}
