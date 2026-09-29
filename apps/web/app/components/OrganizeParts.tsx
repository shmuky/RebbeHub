import { useEffect, useRef, useState } from 'react';
import { nameOf, typeName, type Lang } from '../lib/i18n.js';
import { num } from '../lib/i18nUi.js';
import { call, ow, slugFrom, type Preview, type TreeNode } from '../lib/organize.js';
import { Icon, type IconName } from '../ui/Icon.js';
import { Box, Label } from '../ui/primitives.js';

/**
 * The organizing flows' shared pieces, used by the organizing page
 * (routes/organize.tsx) and by the sheet on every set's and sefer's page
 * (components/EditSheet.tsx): the place-or-duplicate picker (rows to pick,
 * and a search by name, never a drop-down), a new name, a new set, and the
 * preview of what a change does before it is sent.
 */

export const ORGANIZE_ICONS: Record<string, IconName> = { set: 'layers', work: 'book', unit: 'file', event: 'cal', recording: 'audio', publication: 'book', person: 'user' };

const short = (value: unknown): string => {
  if (value === undefined || value === null) return '—';
  if (typeof value === 'string') return value.length > 60 ? `${value.slice(0, 60)}…` : value;
  const text = JSON.stringify(value);
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
};

/** Where to move the rows, or which item a duplicate merges into: rows to pick, and a search by name for any other. */
export function Picker({
  lang,
  what,
  type,
  quick,
  allowTop,
  canKeep,
  exclude = [],
  onPick,
  onClose,
}: {
  lang: Lang;
  what: 'move' | 'merge';
  type: string;
  quick: Array<{ id: string; label: string; sub: string }>;
  allowTop: boolean;
  canKeep: boolean;
  /** Items that cannot be picked (the item itself). */
  exclude?: string[];
  onPick: (id: string | null, label: string, keep: boolean) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Array<{ id: string; label: string; sub: string }> | null>(null);
  const [keep, setKeep] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) {
      setFound(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      call<{ results: Array<{ id: string; type: string; path: string | null; data: { name?: { he: string; en?: string }; title?: { he: string; en?: string }; label?: { he: string; en?: string } } }> }>(`/_/organize/search?q=${encodeURIComponent(text)}&type=${encodeURIComponent(type)}&limit=12`, 'GET')
        .then((r) => live && setFound(r.results.map((item) => ({ id: item.id, label: nameOf(item.data.name ?? item.data.title ?? item.data.label, lang) || item.id, sub: item.path ?? item.id }))))
        .catch(() => live && setFound([]));
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q, type, lang]);
  const rows = (found ?? quick).filter((row) => !exclude.includes(row.id));
  const label = type === 'set' ? ow(lang, 'searchSets') : type === 'work' ? ow(lang, 'searchWorks') : ow(lang, 'searchSame');
  return (
    <Box
      as="section"
      className="org-picker"
      aria-label={what === 'merge' ? ow(lang, 'pickDuplicate') : ow(lang, 'pickPlace')}
      header={
        <>
          <span className="org-group-title">{what === 'merge' ? ow(lang, 'pickDuplicate') : ow(lang, 'pickPlace')}</span>
          <button type="button" className="btn sm ghost icon" aria-label={ow(lang, 'cancel')} onClick={onClose}>
            <Icon name="x" />
          </button>
        </>
      }
    >
      <div className="org-pad">
        <label className="field">
          <span className="field-label">{label}</span>
          <input ref={input} type="search" value={q} onChange={(e) => setQ(e.target.value)} dir="auto" role="combobox" aria-expanded aria-controls="org-pick-list" onKeyDown={(e) => e.key === 'Escape' && onClose()} />
        </label>
        {canKeep ? (
          <label className="org-keep">
            <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> {ow(lang, 'keepHere')}
          </label>
        ) : null}
      </div>
      <ul className="rows" id="org-pick-list" role="listbox">
        {allowTop ? (
          <li className="row hover" role="option" aria-selected={false}>
            <button type="button" className="org-pick" onClick={() => onPick(null, ow(lang, 'top'), keep)}>
              <Icon name="home" className="subtle" />
              <span className="grow">{ow(lang, 'top')}</span>
            </button>
          </li>
        ) : null}
        {rows.map((row) => (
          <li key={row.id} className="row hover" role="option" aria-selected={false}>
            <button type="button" className="org-pick" onClick={() => onPick(row.id, row.label, keep)}>
              <Icon name={ORGANIZE_ICONS[type] ?? 'dot'} className="subtle" />
              <span className="grow">
                <span className="org-name">{row.label}</span>
                <span className="org-sub subtle" dir="ltr">
                  {row.sub}
                </span>
              </span>
            </button>
          </li>
        ))}
        {found && found.length === 0 ? <li className="row subtle">{ow(lang, 'nothingFound')}</li> : null}
      </ul>
    </Box>
  );
}

/** A row's new name (and address), in place. */
export function RenameForm({ lang, node, onRename, onClose, submitLabel }: { lang: Lang; node: Pick<TreeNode, 'name' | 'path'>; submitLabel?: string; onRename: (name: { he?: string; en?: string } | null, slug: string | null) => void; onClose: () => void }) {
  const [he, setHe] = useState(node.name?.he ?? '');
  const [en, setEn] = useState(node.name?.en ?? '');
  const lastSegment = node.path ? node.path.slice(node.path.lastIndexOf('/') + 1) : '';
  const [slug, setSlug] = useState(lastSegment);
  const nameChanged = he.trim() !== (node.name?.he ?? '') || en.trim() !== (node.name?.en ?? '');
  const slugChanged = Boolean(node.path) && slug !== lastSegment;
  const slugOk = !slugChanged || (slug.length > 0 && slugFrom(slug) === slug);
  return (
    <form
      className="org-rename form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!he.trim() || !slugOk || (!nameChanged && !slugChanged)) return;
        onRename(nameChanged ? { he: he.trim(), en: en.trim() } : null, slugChanged ? slug : null);
      }}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div className="form-row">
        <label className="field">
          <span className="field-label">{ow(lang, 'nameHe')}</span>
          <input value={he} onChange={(e) => setHe(e.target.value)} required maxLength={300} dir="rtl" autoFocus />
        </label>
        <label className="field">
          <span className="field-label">{ow(lang, 'nameEn')}</span>
          <input value={en} onChange={(e) => setEn(e.target.value)} maxLength={300} dir="ltr" />
        </label>
        {node.path ? (
          <label className="field">
            <span className="field-label">{ow(lang, 'slug')}</span>
            <input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} maxLength={80} dir="ltr" aria-invalid={!slugOk} />
            <span className="hint">{ow(lang, 'slugHint')}</span>
          </label>
        ) : null}
      </div>
      <div className="btn-row">
        <button type="submit" className="btn sm primary" disabled={!he.trim() || !slugOk || (!nameChanged && !slugChanged)}>
          {submitLabel ?? ow(lang, 'add')}
        </button>
        <button type="button" className="btn sm" onClick={onClose}>
          {ow(lang, 'cancel')}
        </button>
      </div>
    </form>
  );
}

/** A new set's names and address. */
export function NewSetFields({ lang, onMake, submitLabel }: { lang: Lang; onMake: (name: { he: string; en?: string }, slug: string) => void; submitLabel?: string }) {
  const [he, setHe] = useState('');
  const [en, setEn] = useState('');
  const [slug, setSlug] = useState('');
  const [touched, setTouched] = useState(false);
  const shown = touched ? slug : slugFrom(en);
  const ok = he.trim().length > 0 && shown.length > 0 && slugFrom(shown) === shown;
  return (
    <form
      className="form org-pad stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onMake({ he: he.trim(), ...(en.trim() ? { en: en.trim() } : {}) }, shown);
      }}
    >
      <div className="form-row">
        <label className="field">
          <span className="field-label">{ow(lang, 'nameHe')}</span>
          <input value={he} onChange={(e) => setHe(e.target.value)} required maxLength={300} dir="rtl" autoFocus />
        </label>
        <label className="field">
          <span className="field-label">{ow(lang, 'nameEn')}</span>
          <input value={en} onChange={(e) => setEn(e.target.value)} maxLength={300} dir="ltr" />
        </label>
        <label className="field">
          <span className="field-label">{ow(lang, 'slug')}</span>
          <input value={shown} onChange={(e) => (setTouched(true), setSlug(e.target.value.toLowerCase()))} maxLength={80} dir="ltr" required />
          <span className="hint" dir="ltr">
            /sets/{shown || '…'}
          </span>
        </label>
      </div>
      <div className="btn-row">
        <button type="submit" className="btn sm primary" disabled={!ok}>
          {submitLabel ?? ow(lang, 'add')}
        </button>
      </div>
    </form>
  );
}

/** A new set on the organizing page, with the picked rows moved into it. */
export function NewSetForm({ lang, count, onMake, onClose }: { lang: Lang; count: number; onMake: (name: { he: string; en?: string }, slug: string) => void; onClose: () => void }) {
  return (
    <Box
      as="section"
      className="org-picker"
      aria-label={ow(lang, 'newSet')}
      header={
        <>
          <span className="org-group-title">
            {ow(lang, 'newSet')}
            {count ? ` (${num(count, lang)} ${ow(lang, 'selected')})` : ''}
          </span>
          <button type="button" className="btn sm ghost icon" aria-label={ow(lang, 'cancel')} onClick={onClose}>
            <Icon name="x" />
          </button>
        </>
      }
    >
      <NewSetFields lang={lang} onMake={onMake} />
    </Box>
  );
}

/** The change before it is sent: each item before and after, field by field, and the addresses that will redirect. */
export function PreviewView({ lang, preview }: { lang: Lang; preview: Preview }) {
  return (
    <div className="org-preview org-pad stack">
      <p>
        <b>{preview.title}</b>
      </p>
      <p className="subtle">
        {num(preview.items.length, lang)} {ow(lang, 'willChange')}
        {preview.redirects.length ? ` · ${num(preview.redirects.length, lang)} ${ow(lang, 'redirects')}` : ''}
      </p>
      <ul className="rows org-diff">
        {preview.items.slice(0, 200).map((item) => (
          <li key={item.id} className="row">
            <div className="grow">
              <div className="org-title-line">
                {item.isNew ? <Label tone="sync" size="sm">{ow(lang, 'newItem')}</Label> : null}
                {item.deleted ? <Label tone="scan" size="sm">{ow(lang, 'deleted')}</Label> : null}
                <span className="org-name">{item.name}</span>
                <span className="subtle">{typeName(item.type, lang)}</span>
              </div>
              {item.pathBefore !== item.path ? (
                <div className="org-sub" dir="ltr">
                  <del>{item.pathBefore ?? '—'}</del> → <ins>{item.path ?? '—'}</ins>
                </div>
              ) : null}
              {item.changes.slice(0, 6).map((c) => (
                <div key={c.path} className="org-sub" dir="ltr">
                  <code>{c.path}</code> <del>{short(c.before)}</del> → <ins>{short(c.after)}</ins>
                </div>
              ))}
            </div>
          </li>
        ))}
      </ul>
      {preview.redirects.length ? (
        <div className="org-redirects">
          <b>{ow(lang, 'redirects')}</b>
          <ul className="org-sub" dir="ltr">
            {preview.redirects.slice(0, 20).map((r) => (
              <li key={`${r.id}${r.from}`}>
                <del>{r.from}</del> → <ins>{r.to ?? '—'}</ins>
              </li>
            ))}
            {preview.redirects.length > 20 ? <li>… {num(preview.redirects.length - 20, lang)}</li> : null}
          </ul>
        </div>
      ) : null}
      {preview.warnings.length ? (
        <div>
          <b>{ow(lang, 'notes')}</b>
          <ul>
            {preview.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
