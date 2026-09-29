import { Check } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { Lang } from '../../lib/i18n.js';
import { tt } from '../../lib/threadStrings.js';

/**
 * A menu to pick from, as GitHub's side column has for labels, assignees
 * and reviewers: type to narrow it, arrows and Enter (or a click) to tick,
 * and what was ticked is applied once when the menu closes, so one change
 * of mind is one event in the timeline, not five. With `single`, a pick
 * applies at once and closes it (for filters).
 */

export interface PickerOption {
  value: string;
  label: string;
  hint?: string;
  swatch?: string;
}

export function Picker({
  lang,
  button,
  buttonClass = 'th-gear',
  title,
  selected,
  load,
  onApply,
  single,
}: {
  lang: Lang;
  button: ReactNode;
  buttonClass?: string;
  title: string;
  selected: readonly string[];
  /** The options for what is typed (asked again as it changes). */
  load: (q: string) => Promise<PickerOption[]>;
  onApply: (values: string[]) => void;
  single?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [options, setOptions] = useState<PickerOption[]>([]);
  const [ticked, setTicked] = useState<string[]>([...selected]);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    let live = true;
    const timer = window.setTimeout(() => {
      load(q)
        .then((found) => live && (setOptions(found), setActive(0)))
        .catch(() => live && setOptions([]));
    }, 100);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
    // `load` is a new function each render; the question is what is typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, q]);

  function close(apply: boolean) {
    setOpen(false);
    setQ('');
    if (apply && !single) {
      const same = ticked.length === selected.length && ticked.every((v) => selected.includes(v));
      if (!same) onApply(ticked);
    }
  }

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) close(true);
    };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  });

  function toggle(value: string) {
    if (single) {
      setOpen(false);
      setQ('');
      onApply(selected.includes(value) ? [] : [value]);
      return;
    }
    setTicked((now) => (now.includes(value) ? now.filter((v) => v !== value) : [...now, value]));
  }

  // What is ticked but not among the options found still shows, so it can be unticked.
  const shown: PickerOption[] = [...options, ...ticked.filter((v) => !options.some((o) => o.value === v) && !q).map((v) => ({ value: v, label: v }))];

  return (
    <div className="th-picker" ref={box}>
      <button
        type="button"
        className={buttonClass}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={title}
        onClick={() => {
          if (open) close(true);
          else {
            setTicked([...selected]);
            setOpen(true);
          }
        }}
      >
        {button}
      </button>
      {open ? (
        <div className="th-popup" role="dialog" aria-label={title}>
          <input
            type="search"
            autoFocus
            value={q}
            placeholder={title}
            aria-controls={listId}
            aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const step = e.key === 'ArrowDown' ? 1 : -1;
                setActive((a) => (shown.length ? (a + step + shown.length) % shown.length : 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                if (shown[active]) toggle(shown[active]!.value);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                close(true);
              }
            }}
          />
          <ul id={listId} role="listbox" aria-multiselectable={!single}>
            {shown.length === 0 ? <li className="th-dim">{tt(lang, 'noOneFound')}</li> : null}
            {shown.map((option, i) => {
              const on = (single ? selected : ticked).includes(option.value);
              return (
                <li
                  key={option.value}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  aria-checked={on}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => (e.preventDefault(), toggle(option.value))}
                >
                  <span className="th-check">{on ? <Check size={14} aria-hidden="true" /> : null}</span>
                  {option.swatch ? <span className="th-label" style={{ background: option.swatch, inlineSize: '0.9rem', padding: 0 }} aria-hidden="true" /> : null}
                  <span>
                    <strong>{option.label}</strong>
                    {option.hint ? <span className="th-dim"> {option.hint}</span> : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
