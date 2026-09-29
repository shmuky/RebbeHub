import { CircleDot, GitMerge, GitPullRequest } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { Lang } from '../../lib/i18n.js';
import { threads, type PersonHit, type ThreadHit } from '../../lib/threads.js';
import { tt } from '../../lib/threadStrings.js';
import { RichText } from './RichText.js';

/**
 * The writing box of every conversation (like GitHub's): Write and
 * Preview, and as you type `@` the people to mention (those already in
 * this conversation first), as you type `#` the suggestions and issues to
 * point at, by number or by words. Arrows move, Enter or Tab takes one,
 * Escape closes; Ctrl+Enter sends.
 */

type Popup =
  | { kind: 'person'; start: number; query: string; items: PersonHit[]; active: number }
  | { kind: 'thread'; start: number; query: string; items: ThreadHit[]; active: number };

/** What is being typed just before the caret: `@men` or `#12`/`#words`, and where it starts. */
function triggerAt(text: string, caret: number): { kind: 'person' | 'thread'; start: number; query: string } | null {
  const before = text.slice(0, caret);
  const person = /(^|[^A-Za-z0-9_@./\\-])@([A-Za-z0-9-]{0,39})$/.exec(before);
  if (person) return { kind: 'person', start: caret - person[2]!.length - 1, query: person[2]! };
  const thread = /(^|[^A-Za-z0-9_&#/\\-])#([^\s#]{0,40})$/.exec(before);
  if (thread) return { kind: 'thread', start: caret - thread[2]!.length - 1, query: thread[2]! };
  return null;
}

export function MentionTextarea({
  value,
  onChange,
  lang,
  thread,
  onSubmit,
  placeholder,
  id,
  autoFocus,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  lang: Lang;
  /** The conversation being written in (`changeset:12`, `report:3`), so its people come first. */
  thread?: string;
  onSubmit?: () => void;
  placeholder?: string;
  id?: string;
  autoFocus?: boolean;
  label?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [popup, setPopup] = useState<Popup | null>(null);
  const asked = useRef(0);
  const listId = useId();

  // Ask for what matches the trigger, a moment after typing stops; a later question wins.
  function look(text: string, caret: number) {
    const trigger = triggerAt(text, caret);
    if (!trigger) return setPopup(null);
    const n = ++asked.current;
    const params = new URLSearchParams({ q: trigger.query, limit: '8' });
    if (trigger.kind === 'person' && thread) params.set('thread', thread);
    window.setTimeout(() => {
      if (n !== asked.current) return;
      const answer =
        trigger.kind === 'person'
          ? threads<{ people: PersonHit[] }>(`people?${params}`).then((r) => ({ ...trigger, kind: 'person' as const, items: r.people, active: 0 }))
          : threads<{ threads: ThreadHit[] }>(`threads?${params}`).then((r) => ({ ...trigger, kind: 'thread' as const, items: r.threads, active: 0 }));
      answer.then((next) => n === asked.current && setPopup(next.items.length ? next : null)).catch(() => setPopup(null));
    }, 120);
  }

  function pick(index: number) {
    if (!popup || !ref.current) return;
    const caret = ref.current.selectionStart;
    const insert = popup.kind === 'person' ? `@${popup.items[index]!.username} ` : `#${popup.items[index]!.number} `;
    const next = value.slice(0, popup.start) + insert + value.slice(caret);
    onChange(next);
    setPopup(null);
    asked.current++;
    const at = popup.start + insert.length;
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(at, at);
    });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      setPopup(null);
      onSubmit?.();
      return;
    }
    if (!popup) return;
    const size = popup.items.length;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setPopup({ ...popup, active: (popup.active + step + size) % size } as Popup);
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      pick(popup.active);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setPopup(null);
    }
  }

  const activeId = popup ? `${listId}-${popup.active}` : undefined;
  return (
    <>
      <textarea
        ref={ref}
        id={id}
        value={value}
        dir="auto"
        placeholder={placeholder}
        aria-label={label}
        autoFocus={autoFocus}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={popup !== null}
        aria-controls={popup ? listId : undefined}
        aria-activedescendant={activeId}
        onChange={(e) => {
          onChange(e.target.value);
          look(e.target.value, e.target.selectionStart);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => window.setTimeout(() => setPopup(null), 150)}
      />
      {popup ? (
        <ul className="th-popup" id={listId} role="listbox" style={{ insetBlockStart: 'calc(100% - 0.4rem)' }}>
          {popup.kind === 'person'
            ? popup.items.map((person, i) => (
                <li key={person.id} id={`${listId}-${i}`} role="option" aria-selected={i === popup.active} onMouseDown={(e) => (e.preventDefault(), pick(i))}>
                  <strong>{person.username}</strong>
                  <span className="th-dim">{person.displayName}</span>
                </li>
              ))
            : popup.items.map((hit, i) => {
                const Icon = hit.kind === 'report' ? CircleDot : hit.state === 'merged' ? GitMerge : GitPullRequest;
                return (
                  <li key={hit.number} id={`${listId}-${i}`} role="option" aria-selected={i === popup.active} onMouseDown={(e) => (e.preventDefault(), pick(i))}>
                    <Icon size={14} className={`th-icon ${hit.state === 'merged' ? 'merged' : hit.state}`} aria-hidden="true" />
                    <span className="th-dim">#{hit.number}</span>
                    <span>{hit.title}</span>
                  </li>
                );
              })}
        </ul>
      ) : null}
    </>
  );
}

/** A writing box with its tabs, hint and buttons; `children` are extra buttons beside the main one. */
export function Composer({
  lang,
  value,
  onChange,
  onSubmit,
  submitLabel,
  busy,
  thread,
  placeholder,
  autoFocus,
  error,
  children,
  submitDisabled,
}: {
  lang: Lang;
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  submitLabel?: string;
  busy?: boolean;
  thread?: string;
  placeholder?: string;
  autoFocus?: boolean;
  error?: string | null;
  children?: ReactNode;
  submitDisabled?: boolean;
}) {
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  useEffect(() => {
    if (!value) setTab('write');
  }, [value]);
  const canSend = !busy && !submitDisabled && value.trim().length > 0;
  return (
    <div className="th-composer">
      <div className="th-composer-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'write'} onClick={() => setTab('write')}>
          {tt(lang, 'write')}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'preview'} onClick={() => setTab('preview')}>
          {tt(lang, 'preview')}
        </button>
      </div>
      {tab === 'write' ? (
        <div className="th-composer-field">
          <MentionTextarea
            value={value}
            onChange={onChange}
            lang={lang}
            thread={thread}
            placeholder={placeholder ?? tt(lang, 'leaveComment')}
            label={placeholder ?? tt(lang, 'leaveComment')}
            autoFocus={autoFocus}
            onSubmit={() => canSend && onSubmit?.()}
          />
        </div>
      ) : (
        <div className="th-composer-preview">{value.trim() ? <RichText text={value} lang={lang} /> : <p className="th-empty">{tt(lang, 'nothingToPreview')}</p>}</div>
      )}
      {error ? <p className="th-error" role="alert" style={{ margin: '0 0.5rem 0.5rem' }}>{error}</p> : null}
      <div className="th-composer-foot">
        <span className="th-hint">{tt(lang, 'composerHint')}</span>
        <div className="th-buttons">
          {children}
          {onSubmit && submitLabel ? (
            <button type="button" onClick={onSubmit} disabled={!canSend}>
              {submitLabel}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
