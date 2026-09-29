import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Form } from 'react-router';
import type { Lang } from '../lib/i18n.js';
import { tu } from '../lib/i18nUi.js';
import { keyOf, words, type TokenKey, type TokenValue } from '../lib/tokens.js';
import { Icon } from './Icon.js';
import { Label, cx } from './primitives.js';

/**
 * The search line that is also the filter: `מצב:פתוח אוסף:"אגרות קודש"`,
 * with the filters drawn as tokens and a list of what may come next as
 * one types (filter names, then their values), never a drop-down menu.
 * A plain GET form underneath: without script it is a text box whose
 * words the loader reads with parseTokens.
 */

interface Option {
  id: string;
  kind: 'key' | 'value';
  key: TokenKey;
  value?: TokenValue;
}

function quoteIfNeeded(s: string): string {
  return /\s/.test(s) ? `"${s}"` : s;
}

export function TokenSearch({
  lang,
  keys,
  defaultValue = '',
  name = 'q',
  action,
  hidden,
  placeholder,
  label,
  hint,
  autoFocus,
  size,
  after,
}: {
  lang: Lang;
  keys: TokenKey[];
  defaultValue?: string;
  name?: string;
  action?: string;
  hidden?: Record<string, string | undefined>;
  placeholder?: string;
  label: string;
  hint?: ReactNode;
  autoFocus?: boolean;
  size?: 'lg';
  /** Beside the field, inside the same row (a "save search" button). */
  after?: ReactNode;
}) {
  const [value, setValue] = useState(defaultValue);
  const [caret, setCaret] = useState(defaultValue.length);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [js, setJs] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => setJs(true), []);
  // A new address (a saved search picked, back and forward) brings its own line.
  useEffect(() => setValue(defaultValue), [defaultValue]);

  const all = useMemo(() => words(value), [value]);
  const current = all.find((w) => caret >= w.start && caret <= w.end) ?? { text: '', start: caret, end: caret };

  const options: Option[] = useMemo(() => {
    const hit = keyOf(current.text, keys);
    if (hit) {
      const typed = hit.value.toLowerCase();
      return (hit.key.values ?? [])
        .filter((v) => !typed || v.he.startsWith(hit.value) || v.en.toLowerCase().startsWith(typed) || v.value.startsWith(typed))
        .slice(0, 12)
        .map((v) => ({ id: `${hit.key.key}:${v.value}`, kind: 'value' as const, key: hit.key, value: v }));
    }
    if (current.text.includes(':')) return [];
    const typed = current.text.toLowerCase();
    return keys
      .filter((k) => !typed || k.he.startsWith(current.text) || k.en.toLowerCase().startsWith(typed))
      .map((k) => ({ id: k.key, kind: 'key' as const, key: k }));
  }, [current.text, keys]);

  const heading = (() => {
    const hit = keyOf(current.text, keys);
    if (hit) return hit.key.values ? `${tu(lang, 'valuesOf')} ${lang === 'he' ? hit.key.he : hit.key.en}` : hit.key.hint?.[lang] ?? null;
    return tu(lang, 'filterKeys');
  })();

  const showPop = js && open && (options.length > 0 || (heading !== null && keyOf(current.text, keys) !== null));

  useEffect(() => setActive(0), [current.text]);

  const replaceCurrent = (text: string, trailingSpace: boolean) => {
    const before = value.slice(0, current.start);
    let after = value.slice(current.end);
    if (trailingSpace && !after.startsWith(' ')) after = ` ${after}`;
    const next = `${before}${text}${after}`;
    const pos = before.length + text.length + (trailingSpace ? 1 : 0);
    setValue(next);
    setCaret(pos);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(pos, pos);
    });
  };

  const pick = (o: Option) => {
    const name = lang === 'he' ? o.key.he : o.key.en;
    if (o.kind === 'key') replaceCurrent(`${name}:`, false);
    else replaceCurrent(`${name}:${quoteIfNeeded(o.value![lang])}`, true);
  };

  const sync = () => {
    const el = input.current;
    if (!el) return;
    setCaret(el.selectionStart ?? el.value.length);
    if (mirror.current) mirror.current.scrollLeft = el.scrollLeft;
  };

  const hiddenFields = { ...hidden, lang: lang === 'en' ? 'en' : undefined };

  return (
    <Form method="get" action={action} role="search" className={cx('tsearch', js && 'js', size)} onSubmit={() => setOpen(false)}>
      {Object.entries(hiddenFields).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <div className="tsearch-row">
        <div className="tsearch-field" onClick={() => input.current?.focus()}>
          <Icon name="search" />
          <div className="tsearch-stack">
            <div className="tsearch-mirror" ref={mirror} aria-hidden="true">
              {renderMirror(value, keys)}
            </div>
            <input
              ref={input}
              className="tsearch-input"
              type="search"
              name={name}
              value={value}
              aria-label={label}
              placeholder={placeholder}
              autoComplete="off"
              spellCheck={false}
              autoFocus={autoFocus}
              role="combobox"
              aria-expanded={showPop}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={showPop && options[active] ? `${listId}-${active}` : undefined}
              onChange={(e) => {
                setValue(e.target.value);
                setCaret(e.target.selectionStart ?? e.target.value.length);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 120)}
              onSelect={sync}
              onScroll={sync}
              onKeyUp={sync}
              onKeyDown={(e) => {
                if (!showPop || options.length === 0) {
                  if (e.key === 'Escape') setOpen(false);
                  return;
                }
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActive((a) => (a + 1) % options.length);
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActive((a) => (a - 1 + options.length) % options.length);
                } else if ((e.key === 'Enter' || e.key === 'Tab') && current.text) {
                  e.preventDefault();
                  pick(options[active]!);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setOpen(false);
                }
              }}
            />
          </div>
          {hint && !value ? <span className="tsearch-hint">{hint}</span> : null}
          {value ? (
            <button
              type="button"
              className="tsearch-clear"
              aria-label={tu(lang, 'clearSearch')}
              onClick={(e) => {
                e.stopPropagation();
                setValue('');
                setCaret(0);
                input.current?.focus();
              }}
            >
              <Icon name="x" size={14} />
            </button>
          ) : null}
        </div>
        {after}
      </div>
      {showPop ? (
        <div className="pop" id={listId} role="listbox" aria-label={heading ?? label}>
          {heading ? <div className="pop-h">{heading}</div> : null}
          {options.map((o, i) => (
            <div
              key={o.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className="pop-o"
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o);
              }}
              onMouseEnter={() => setActive(i)}
            >
              {o.kind === 'key' ? (
                <>
                  <span className="k">{lang === 'he' ? o.key.he : o.key.en}:</span>
                  {o.key.values ? (
                    <span className="hint">
                      {o.key.values
                        .slice(0, 3)
                        .map((v) => v[lang])
                        .join(' · ')}
                      {o.key.values.length > 3 ? ' …' : ''}
                    </span>
                  ) : o.key.hint ? (
                    <span className="hint">{o.key.hint[lang]}</span>
                  ) : null}
                </>
              ) : o.value!.tone ? (
                <Label tone={o.value!.tone as never}>{o.value![lang]}</Label>
              ) : (
                <span>{o.value![lang]}</span>
              )}
              {o.value?.count !== undefined ? <span className="c">{o.value.count}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
    </Form>
  );
}

/** The line again, with each filter's name and value marked, laid exactly under the typed words. */
function renderMirror(value: string, keys: TokenKey[]): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  for (const w of words(value)) {
    if (w.start > at) out.push(value.slice(at, w.start));
    const hit = keyOf(w.text, keys);
    if (hit) {
      const colon = w.text.indexOf(':') + 1;
      out.push(
        <span key={w.start} className="tok">
          <span className="tok-k">{w.text.slice(0, colon)}</span>
          {w.text.length > colon ? <span className="tok-v">{w.text.slice(colon)}</span> : null}
        </span>,
      );
    } else out.push(w.text);
    at = w.end;
  }
  if (at < value.length) out.push(value.slice(at));
  return out;
}
