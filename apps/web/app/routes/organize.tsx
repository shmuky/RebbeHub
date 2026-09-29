import { useEffect, useMemo, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { data, Link, useRevalidator } from 'react-router';
import type { Route } from './+types/organize';
import { siteOf } from '../lib/context.server.js';
import { langFrom, nameOf, t, typeName, type Lang } from '../lib/i18n.js';
import { num } from '../lib/i18nUi.js';
import { href } from '../lib/links.js';
import { describeOperation, dropBefore, groupsOf, moveBy, organizeCalls, ow, planOf, suggestionPath, toggleSelect, type Group, type Operation, type Preview, type Sent, type TreeNode } from '../lib/organize.js';
import { NewSetForm, ORGANIZE_ICONS as ICONS, Picker, PreviewView, RenameForm } from '../components/OrganizeParts.js';
import { pageMeta } from '../lib/seo.js';
import { useAccount } from '../lib/useAccount.js';
import { Icon } from '../ui/Icon.js';
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

type Picking = { what: 'move' | 'merge' } | null;

const calls = organizeCalls();

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
      if (what === 'preview') setPreview(await calls.preview(plan));
      else {
        const made = await calls.send(plan, title, note);
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
      await calls.approve(sent.suggestion.id);
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
  const suggestionHref = sent ? href(suggestionPath(sent).path, lang, suggestionPath(sent).query) : '';

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

