import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { data, Link, useRevalidator } from 'react-router';
import type { Route } from './+types/organize';
import { siteOf } from '../lib/context.server.js';
import { langFrom, nameOf, t, typeName, type Lang } from '../lib/i18n.js';
import { num } from '../lib/i18nUi.js';
import { href } from '../lib/links.js';
import { describeOperation, dropBefore, groupsOf, moveBy, ow, planOf, slugFrom, toggleSelect, type Group, type Operation, type TreeNode } from '../lib/organize.js';
import { pageMeta } from '../lib/seo.js';
import { useAccount } from '../lib/useAccount.js';
import { Icon, type IconName } from '../ui/Icon.js';
import { Box, Breadcrumbs, EmptyState, Label, cx } from '../ui/primitives.js';
import '../styles/pages/organize.css';

/**
 * Organizing the catalog by hand (core/organize.ts): the library's top
 * sets, or one set's sets and sefarim, or one sefer's sichos, as rows to
 * pick. Picked rows are moved (to a set found by name), moved up a level,
 * renamed in place, put in order by dragging or with the keyboard, made
 * into a new set, merged into their duplicate, or taken out of the set.
 * Every change waits in a list; the preview shows each item before and
 * after; sending makes ONE suggestion of it all, reviewed like anyone's.
 * A steward, who may approve their own, may apply it at once.
 */

interface Crumb {
  id: string;
  label: string;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const lang = langFrom(request);
  const raw = new URL(request.url).searchParams.get('root') ?? '';
  const root = /^rh-[0-9a-z]+$/i.test(raw) ? raw.toLowerCase() : undefined;
  if (raw && !root) throw data(null, { status: 404 });
  const tree = await api.tree(root, 1, 500).catch((error: { status?: number }) => {
    if (error.status === 404 || error.status === 400) throw data(null, { status: 404 });
    throw error;
  });
  // Where the root sits: its parent sets up to the top (a sefer: its first set's).
  const crumbs: Crumb[] = [];
  if (tree.root) {
    let up: string | undefined;
    if (tree.root.type === 'set') up = ((await api.entity(tree.root.id))?.data as { parent?: string } | undefined)?.parent;
    else up = ((await api.entity(tree.root.id))?.data as { sets?: string[] } | undefined)?.sets?.[0];
    for (let hop = 0; up && hop < 8; hop++) {
      const parent = await api.entity(up);
      if (!parent) break;
      const d = parent.data as { name?: { he: string; en?: string }; parent?: string };
      crumbs.unshift({ id: parent.id, label: nameOf(d.name, lang) || parent.id });
      up = d.parent;
    }
  }
  return { lang, siteUrl, root: tree.root, children: tree.children, more: tree.more, crumbs };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  const { lang, root, siteUrl } = loaderData;
  const title = root ? `${ow(lang, 'titleOf')} ${nameOf(root.name, lang) || root.id}` : ow(lang, 'title');
  return pageMeta({ title, path: `/organize${root ? `?root=${root.id}` : ''}`, lang, siteUrl, noindex: true });
}

const ICONS: Record<string, IconName> = { set: 'layers', work: 'book', unit: 'file', event: 'cal', recording: 'audio', publication: 'book', person: 'user' };

async function call<T>(path: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: { accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) throw new Error(json.message ?? response.statusText);
  return json;
}

interface Preview {
  title: string;
  summary: string[];
  items: Array<{ id: string; type: string; name: string; isNew: boolean; deleted: boolean; pathBefore: string | null; path: string | null; changes: Array<{ path: string; before?: unknown; after?: unknown }> }>;
  redirects: Array<{ id: string; from: string; to: string | null }>;
  warnings: string[];
}

interface Sent {
  suggestion: { id: number; number: number | null; status: string; title: string };
  merged: boolean;
  mayApprove: boolean;
}

type Picking = { what: 'move' | 'merge' } | null;

const short = (value: unknown): string => {
  if (value === undefined || value === null) return '—';
  if (typeof value === 'string') return value.length > 60 ? `${value.slice(0, 60)}…` : value;
  const text = JSON.stringify(value);
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
};

export default function Organize({ loaderData }: Route.ComponentProps) {
  const { lang, crumbs, more } = loaderData;
  const root = loaderData.root as TreeNode | null;
  const children = loaderData.children as TreeNode[];
  const account = useAccount();
  const revalidator = useRevalidator();
  const groups = useMemo(() => groupsOf(root, children), [root, children]);
  const byId = useMemo(() => new Map(children.map((c) => [c.id, c])), [children]);
  const [names, setNames] = useState<Record<string, string>>({});
  const nameFor = (id: string) => names[id] ?? (byId.get(id) ? nameOf(byId.get(id)!.name, lang) || id : root?.id === id ? nameOf(root.name, lang) || id : id);

  const [orders, setOrders] = useState<Record<string, string[]>>(() => Object.fromEntries(groups.map((g) => [g.key, g.nodes.map((n) => n.id)])));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [ops, setOps] = useState<Operation[]>([]);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [picking, setPicking] = useState<Picking>(null);
  const [making, setMaking] = useState(false);
  const [dragging, setDragging] = useState<string[] | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [js, setJs] = useState(false);
  useEffect(() => setJs(true), []);
  // A new tree (after applying, or another root): start again from it.
  useEffect(() => {
    setOrders(Object.fromEntries(groups.map((g) => [g.key, g.nodes.map((n) => n.id)])));
    setSelected(new Set());
    setOps([]);
    setPreview(null);
  }, [groups]);

  const plan = planOf(ops, groups, orders);
  const allIds = groups.flatMap((g) => orders[g.key] ?? []);
  const chosen = allIds.filter((id) => selected.has(id));
  const chosenNodes = chosen.map((id) => byId.get(id)!).filter(Boolean);
  const onlySets = chosenNodes.length > 0 && chosenNodes.every((n) => n.type === 'set');
  const inSet = root?.type === 'set';

  const add = (op: Operation) => {
    setOps((list) => [...list, op]);
    setPreview(null);
    setSent(null);
  };
  const clearSelection = () => setSelected(new Set());

  function toggle(id: string, event: MouseEvent<HTMLInputElement>) {
    const next = toggleSelect(allIds, selected, id, event.shiftKey, anchor);
    setSelected(next.selected);
    setAnchor(next.anchor);
  }

  function reorder(group: Group, id: string, delta: -1 | 1) {
    const list = orders[group.key] ?? [];
    const moving = selected.has(id) ? list.filter((x) => selected.has(x)) : [id];
    setOrders({ ...orders, [group.key]: moveBy(list, moving, delta) });
    setPreview(null);
  }

  function onHandleKey(group: Group, id: string, event: KeyboardEvent<HTMLButtonElement>) {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    reorder(group, id, event.key === 'ArrowUp' ? -1 : 1);
  }

  function onDragStart(group: Group, id: string, event: DragEvent) {
    const list = orders[group.key] ?? [];
    setDragging(selected.has(id) ? list.filter((x) => selected.has(x)) : [id]);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', id);
  }

  function onDrop(group: Group, target: string | null, event: DragEvent) {
    event.preventDefault();
    if (dragging) setOrders({ ...orders, [group.key]: dropBefore(orders[group.key] ?? [], dragging, target) });
    setDragging(null);
    setDropTarget(null);
    setPreview(null);
  }

  async function run(what: 'preview' | 'send') {
    setBusy(true);
    setError(null);
    try {
      if (what === 'preview') setPreview(await call<Preview>('/_/organize/preview', 'POST', { operations: plan }));
      else {
        const made = await call<Sent>('/_/organize', 'POST', { operations: plan, title: title.trim() || undefined, description: note.trim() || undefined });
        setSent(made);
        setOps([]);
        setPreview(null);
        if (made.merged) revalidator.revalidate();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function applyNow() {
    if (!sent) return;
    setBusy(true);
    setError(null);
    try {
      await call(`/_/suggestions/${sent.suggestion.id}/approve`, 'POST', {});
      setSent({ ...sent, merged: true, mayApprove: false });
      revalidator.revalidate();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const heading = root ? `${ow(lang, 'titleOf')} ${nameOf(root.name, lang) || root.id}` : ow(lang, 'title');
  const trail = [{ label: t(lang, 'tabLibrary'), to: href('/sets', lang) }, { label: ow(lang, 'organize'), to: href('/organize', lang) }, ...crumbs.map((c) => ({ label: c.label, to: href('/organize', lang, { root: c.id }) }))];
  const suggestionHref = sent ? (sent.suggestion.number != null ? href(`/suggestions/${sent.suggestion.number}`, lang) : href('/review', lang, { s: String(sent.suggestion.id) })) : '';

  return (
    <div className="org-page">
      <div className="phead">
        <div className="wrap">
          <Breadcrumbs items={trail} lang={lang} />
          <div className="phead-row">
            <div>
              <h1 className="page-title">{heading}</h1>
              <p className="lede">{ow(lang, 'lede')}</p>
            </div>
            {root ? (
              <div className="phead-acts">
                <Link className="btn" to={href(root.path ?? `/${root.id}`, lang)}>
                  <Icon name="external" />
                  {ow(lang, 'open')}
                </Link>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="wrap org-body">
        <noscript>
          <p className="alert">{ow(lang, 'noScript')}</p>
        </noscript>

        <div className="org-toolbar box" role="toolbar" aria-label={ow(lang, 'organize')}>
          <span className="org-count">
            <b>{num(chosen.length, lang)}</b> {ow(lang, 'selected')}
          </span>
          <button type="button" className="btn sm" disabled={!js || chosen.length === 0} onClick={() => setPicking({ what: 'move' })}>
            <Icon name="arrow" />
            {ow(lang, 'moveTo')}
          </button>
          <button type="button" className="btn sm" disabled={!js || chosen.length === 0 || (root === null && !onlySets)} onClick={() => (add({ op: 'move-up', items: chosen, ...(inSet && !onlySets ? { from: root!.id } : {}) }), clearSelection())}>
            <Icon name="chevu" />
            {ow(lang, 'moveUp')}
          </button>
          {inSet && chosenNodes.some((n) => n.type !== 'set') ? (
            <button type="button" className="btn sm" disabled={!js} onClick={() => (add({ op: 'move', items: chosen.filter((id) => byId.get(id)?.type !== 'set'), to: null, from: root!.id }), clearSelection())}>
              <Icon name="minus" />
              {ow(lang, 'takeOut')}
            </button>
          ) : null}
          <button type="button" className="btn sm" disabled={!js || chosen.length !== 1} onClick={() => setRenaming(chosen[0]!)}>
            <Icon name="pencil" />
            {ow(lang, 'rename')}
          </button>
          <button type="button" className="btn sm" disabled={!js || chosen.length !== 1} onClick={() => setPicking({ what: 'merge' })}>
            <Icon name="compare" />
            {ow(lang, 'mergeInto')}
          </button>
          {root?.type !== 'work' ? (
            <button type="button" className="btn sm" disabled={!js} onClick={() => setMaking(true)}>
              <Icon name="plus" />
              {ow(lang, 'newSet')}
            </button>
          ) : null}
          {chosenNodes.length > 0 && chosenNodes.every((n) => n.type === 'set' && !n.counts.sets && !n.counts.items) ? (
            <button type="button" className="btn sm danger" disabled={!js} onClick={() => (chosen.forEach((id) => add({ op: 'delete-set', item: id })), clearSelection())}>
              <Icon name="trash" />
              {ow(lang, 'deleteSet')}
            </button>
          ) : null}
          <span className="grow" />
          <button type="button" className="btn sm ghost" disabled={!js || allIds.length === 0} onClick={() => setSelected(selected.size === allIds.length ? new Set() : new Set(allIds))}>
            {selected.size === allIds.length && allIds.length > 0 ? ow(lang, 'clear') : ow(lang, 'selectAll')}
          </button>
        </div>

        {picking ? (
          <Picker
            lang={lang}
            what={picking.what}
            type={picking.what === 'merge' ? chosenNodes[0]?.type ?? 'set' : chosenNodes.some((n) => n.type === 'unit') ? 'work' : 'set'}
            quick={[...(picking.what === 'move' && crumbs.length ? [{ id: crumbs[crumbs.length - 1]!.id, label: crumbs[crumbs.length - 1]!.label, sub: ow(lang, 'moveUp') }] : []), ...children.filter((c) => !selected.has(c.id) && (picking.what === 'merge' ? c.type === chosenNodes[0]?.type : c.type === (chosenNodes.some((n) => n.type === 'unit') ? 'work' : 'set'))).map((c) => ({ id: c.id, label: nameOf(c.name, lang) || c.id, sub: c.path ?? '' }))]}
            allowTop={picking.what === 'move' && onlySets}
            canKeep={picking.what === 'move' && inSet && !onlySets}
            onClose={() => setPicking(null)}
            onPick={(target, label, keep) => {
              if (target) setNames((n) => ({ ...n, [target]: label }));
              if (picking.what === 'merge') add({ op: 'merge', from: chosen[0]!, into: target! });
              else if (onlySets || !inSet) add({ op: 'move', items: chosen, to: target });
              else add({ op: 'move', items: chosen, to: target, ...(keep ? {} : { from: root!.id }) });
              setPicking(null);
              clearSelection();
            }}
          />
        ) : null}

        {making ? (
          <NewSetForm
            lang={lang}
            count={chosen.length}
            onClose={() => setMaking(false)}
            onMake={(name, slug) => {
              const key = `s${ops.length + 1}`;
              setNames((n) => ({ ...n, [`new:${key}`]: name.he }));
              add({ op: 'create-set', key, name, slug, parent: root?.type === 'set' ? root.id : null, ...(chosen.length ? { items: chosen } : {}) });
              setMaking(false);
              clearSelection();
            }}
          />
        ) : null}

        {groups.length === 0 ? <EmptyState icon="layers" title={ow(lang, 'empty')} /> : null}
        {groups.map((group) => (
          <Box
            key={group.key}
            as="section"
            className="org-group"
            aria-label={ow(lang, group.key)}
            header={
              <>
                <span className="org-group-title">{ow(lang, group.key)}</span>
                <span className="muted">{num(group.nodes.length, lang)}</span>
              </>
            }
          >
            <ul className="rows org-rows" onDragOver={(e) => dragging && e.preventDefault()} onDrop={(e) => group.orderable && onDrop(group, null, e)}>
              {(orders[group.key] ?? []).map((id) => {
                const node = byId.get(id);
                if (!node) return null;
                const pending = ops.find((o): o is Extract<Operation, { op: 'rename' }> => o.op === 'rename' && o.item === id);
                const counts = [node.counts.sets ? `${num(node.counts.sets, lang)} ${ow(lang, 'setsCount')}` : null, node.counts.items ? `${num(node.counts.items, lang)} ${ow(lang, 'itemsCount')}` : null, node.counts.units ? `${num(node.counts.units, lang)} ${ow(lang, 'unitsCount')}` : null].filter(Boolean);
                return (
                  <li
                    key={id}
                    className={cx('row org-row', selected.has(id) && 'is-selected', dropTarget === id && 'drop-before', dragging?.includes(id) && 'is-dragging')}
                    draggable={js && group.orderable}
                    onDragStart={(e) => onDragStart(group, id, e)}
                    onDragOver={(e) => {
                      if (!dragging) return;
                      e.preventDefault();
                      setDropTarget(id);
                    }}
                    onDragEnd={() => (setDragging(null), setDropTarget(null))}
                    onDrop={(e) => (e.stopPropagation(), onDrop(group, id, e))}
                  >
                    <div className="org-line">
                      {group.orderable ? (
                        <button type="button" className="btn ghost icon sm org-handle" aria-label={`${ow(lang, 'drag')}: ${nameFor(id)}`} title={ow(lang, 'drag')} onKeyDown={(e) => onHandleKey(group, id, e)} disabled={!js}>
                          <Icon name="menu" />
                        </button>
                      ) : (
                        <span className="org-handle" />
                      )}
                      <input type="checkbox" className="org-check" checked={selected.has(id)} onClick={(e) => toggle(id, e)} onChange={() => undefined} aria-label={nameFor(id)} disabled={!js} />
                      <Icon name={ICONS[node.type] ?? 'dot'} className="subtle" />
                      <div className="grow org-main">
                        <span className="org-name">{nameFor(id)}</span>
                        {pending ? (
                          <Label tone="date" size="sm">
                            → {[pending.name?.he, pending.name?.en].filter(Boolean).join(' / ') || pending.slug}
                          </Label>
                        ) : null}
                        <div className="org-sub subtle">
                          <span>{typeName(node.type, lang)}</span>
                          {node.path ? <span dir="ltr">{node.path}</span> : null}
                          {counts.length ? <span>{counts.join(' · ')}</span> : null}
                        </div>
                      </div>
                      {node.type === 'set' || node.type === 'work' ? (
                        <Link className="btn sm ghost" to={href('/organize', lang, { root: node.id })} title={ow(lang, 'inside')}>
                          <Icon name="chevd" />
                          <span className="org-hide-sm">{ow(lang, 'inside')}</span>
                        </Link>
                      ) : null}
                      <Link className="btn sm ghost icon" to={href(node.path ?? `/${node.id}`, lang)} aria-label={`${ow(lang, 'open')}: ${nameFor(id)}`}>
                        <Icon name="external" />
                      </Link>
                      {group.orderable ? (
                        <span className="org-arrows">
                          <button type="button" className="btn sm ghost icon" aria-label={`${ow(lang, 'up')}: ${nameFor(id)}`} onClick={() => reorder(group, id, -1)} disabled={!js}>
                            <Icon name="chevu" />
                          </button>
                          <button type="button" className="btn sm ghost icon" aria-label={`${ow(lang, 'down')}: ${nameFor(id)}`} onClick={() => reorder(group, id, 1)} disabled={!js}>
                            <Icon name="chevd" />
                          </button>
                        </span>
                      ) : null}
                    </div>
                    {renaming === id ? (
                      <RenameForm
                        lang={lang}
                        node={node}
                        onClose={() => setRenaming(null)}
                        onRename={(name, slug) => {
                          add({ op: 'rename', item: id, ...(name ? { name } : {}), ...(slug ? { slug } : {}) });
                          setRenaming(null);
                        }}
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Box>
        ))}
        {more > 0 ? (
          <p className="subtle">
            {ow(lang, 'more')} {num(more, lang)}
          </p>
        ) : null}

        <Box
          as="section"
          className="org-plan"
          aria-label={ow(lang, 'changes')}
          header={
            <>
              <span className="org-group-title">{ow(lang, 'changes')}</span>
              <span className="muted">{num(plan.length, lang)}</span>
            </>
          }
        >
          {plan.length === 0 ? (
            <p className="org-pad subtle">{ow(lang, 'noChanges')}</p>
          ) : (
            <ol className="rows">
              {plan.map((op, i) => (
                <li key={i} className="row">
                  <span className="grow">{describeOperation(op, nameFor, lang)}</span>
                  {i < ops.length ? (
                    <button type="button" className="btn sm ghost icon" aria-label={`${ow(lang, 'remove')}: ${describeOperation(op, nameFor, lang)}`} onClick={() => (setOps(ops.filter((_, j) => j !== i)), setPreview(null))}>
                      <Icon name="x" />
                    </button>
                  ) : (
                    <button type="button" className="btn sm ghost icon" aria-label={ow(lang, 'remove')} onClick={() => (setOrders(Object.fromEntries(groups.map((g) => [g.key, g.nodes.map((n) => n.id)]))), setPreview(null))}>
                      <Icon name="x" />
                    </button>
                  )}
                </li>
              ))}
            </ol>
          )}

          {preview ? <PreviewView lang={lang} preview={preview} /> : null}

          {error ? (
            <p className="alert negative org-pad" role="alert">
              <Icon name="warn" />
              {error}
            </p>
          ) : null}

          {sent ? (
            <p className="alert positive org-pad" role="status">
              <Icon name="check" />
              <span>
                {sent.merged ? ow(lang, 'applied') : ow(lang, 'sent')} <Link to={suggestionHref}>{ow(lang, 'seeSuggestion')}{sent.suggestion.number != null ? ` #${sent.suggestion.number}` : ''}</Link>
              </span>
              {sent.mayApprove && !sent.merged ? (
                <button type="button" className="btn sm approve" onClick={applyNow} disabled={busy}>
                  {ow(lang, 'applyNow')}
                </button>
              ) : null}
            </p>
          ) : null}

          {account === null ? (
            <p className="org-pad">
              {ow(lang, 'signIn')} <Link to={href('/signin', lang, { return: `/organize${root ? `?root=${root.id}` : ''}` })}>{ow(lang, 'signInLink')}</Link>
            </p>
          ) : plan.length > 0 ? (
            <div className="org-pad stack">
              <div className="form-row">
                <label className="field">
                  <span className="field-label">{ow(lang, 'whyTitle')}</span>
                  <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} dir="auto" />
                </label>
                <label className="field">
                  <span className="field-label">{ow(lang, 'why')}</span>
                  <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} dir="auto" />
                </label>
              </div>
              <p className="subtle org-note">{ow(lang, 'reviewNote')}</p>
              <div className="btn-row">
                <button type="button" className="btn" onClick={() => run('preview')} disabled={busy}>
                  <Icon name="eye" />
                  {ow(lang, 'preview')}
                </button>
                <button type="button" className="btn primary" onClick={() => run('send')} disabled={busy}>
                  {busy ? t(lang, 'waiting') : ow(lang, 'send')}
                </button>
              </div>
            </div>
          ) : null}
        </Box>
      </div>
    </div>
  );
}

/** Where to move the rows, or which item a duplicate merges into: rows to pick, and a search by name for any other. */
function Picker({
  lang,
  what,
  type,
  quick,
  allowTop,
  canKeep,
  onPick,
  onClose,
}: {
  lang: Lang;
  what: 'move' | 'merge';
  type: string;
  quick: Array<{ id: string; label: string; sub: string }>;
  allowTop: boolean;
  canKeep: boolean;
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
  const rows = found ?? quick;
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
              <Icon name={ICONS[type] ?? 'dot'} className="subtle" />
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
function RenameForm({ lang, node, onRename, onClose }: { lang: Lang; node: TreeNode; onRename: (name: { he?: string; en?: string } | null, slug: string | null) => void; onClose: () => void }) {
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
          {ow(lang, 'add')}
        </button>
        <button type="button" className="btn sm" onClick={onClose}>
          {ow(lang, 'cancel')}
        </button>
      </div>
    </form>
  );
}

/** A new set: its names and address, with the picked rows moved into it. */
function NewSetForm({ lang, count, onMake, onClose }: { lang: Lang; count: number; onMake: (name: { he: string; en?: string }, slug: string) => void; onClose: () => void }) {
  const [he, setHe] = useState('');
  const [en, setEn] = useState('');
  const [slug, setSlug] = useState('');
  const [touched, setTouched] = useState(false);
  const shown = touched ? slug : slugFrom(en);
  const ok = he.trim().length > 0 && shown.length > 0 && slugFrom(shown) === shown;
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
            {ow(lang, 'add')}
          </button>
        </div>
      </form>
    </Box>
  );
}

/** The change before it is sent: each item before and after, field by field, and the addresses that will redirect. */
function PreviewView({ lang, preview }: { lang: Lang; preview: Preview }) {
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
