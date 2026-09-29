import { useEffect, useId, useMemo, useRef, useState, type DragEvent } from 'react';
import { Link, useLocation } from 'react-router';
import type { Lang } from '../lib/i18n.js';
import { href } from '../lib/links.js';
import {
  actionsFor,
  call,
  dropBefore,
  groupsOf,
  moveBy,
  moveTargetType,
  operationsFor,
  organizeCalls,
  ow,
  planOf,
  suggestionPath,
  type EditAction,
  type EditTarget,
  type Operation,
  type Preview,
  type Sent,
  type TreeNode,
} from '../lib/organize.js';
import { num } from '../lib/i18nUi.js';
import { useAccount } from '../lib/useAccount.js';
import { Icon, type IconName } from '../ui/Icon.js';
import { cx } from '../ui/primitives.js';
import { NewSetFields, ORGANIZE_ICONS, Picker, PreviewView, RenameForm } from './OrganizeParts.js';
import '../styles/pages/organize.css';

/**
 * Organizing where people are: on a set's or a sefer's own page, and on
 * each row of its lists. "Edit" (and the page's "…") opens a small sheet
 * of what can be done to the item: a new name, another set, up to the set
 * above, a new order for what is in it, a new set inside it, a merge into
 * its duplicate, or removing it when it is an empty set. Each shows its
 * preview (POST /v1/organize/preview: what moves, which addresses will
 * redirect) and is sent as ONE Suggestion, reviewed like anyone's; a
 * keeper or steward who may approve their own can apply it at once. The
 * organizing page (routes/organize.tsx) does the same for many rows.
 */

const calls = organizeCalls();

const ACTION: Record<EditAction, { icon: IconName; label: (lang: Lang, target: EditTarget) => string }> = {
  rename: { icon: 'pencil', label: (lang) => ow(lang, 'rename') },
  move: { icon: 'arrow', label: (lang, target) => ow(lang, target.type === 'unit' ? 'moveToWork' : 'moveToSet') },
  'move-up': { icon: 'chevu', label: (lang) => ow(lang, 'moveUpOut') },
  reorder: { icon: 'sort', label: (lang) => ow(lang, 'reorderChildren') },
  'create-set': { icon: 'plus', label: (lang) => ow(lang, 'createHere') },
  merge: { icon: 'compare', label: (lang) => ow(lang, 'mergeOther') },
  'delete-set': { icon: 'trash', label: (lang) => ow(lang, 'deleteSet') },
};

const fallbackOf = (target: EditTarget, lang: Lang, editHref: string) => (target.type === 'set' || target.type === 'work' ? href('/organize', lang, { root: target.id }) : editHref);

/** The page's own buttons: a visible "Edit" for signed-in people, and "…" for everyone; both open the sheet. */
export function EditActions({ target, lang, editHref }: { target: EditTarget; lang: Lang; editHref: string }) {
  const account = useAccount();
  const [open, setOpen] = useState(false);
  return (
    <>
      {account ? (
        <button type="button" className="btn edit-open" onClick={() => setOpen(true)} aria-haspopup="dialog">
          <Icon name="pencil" />
          {ow(lang, 'edit')}
        </button>
      ) : null}
      {/* Without script, "…" still leads somewhere to organize: the full organizer, or the edit page. */}
      <a className="btn icon edit-more" href={fallbackOf(target, lang, editHref)} onClick={(e) => (e.preventDefault(), setOpen(true))} aria-haspopup="dialog" aria-label={ow(lang, 'moreActions')} title={ow(lang, 'moreActions')}>
        <Icon name="more" />
      </a>
      {open ? <EditSheet target={target} lang={lang} editHref={editHref} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** A row's own "…": the same sheet, for the item on that row. */
export function RowEdit({ target, lang, className }: { target: EditTarget; lang: Lang; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <a className={cx('btn ghost icon sm row-edit', className)} href={fallbackOf(target, lang, href(`/edit/${target.id}`, lang))} onClick={(e) => (e.preventDefault(), setOpen(true))} aria-haspopup="dialog" aria-label={`${ow(lang, 'actionsFor')} ${target.label}`} title={ow(lang, 'moreActions')}>
        <Icon name="more" />
      </a>
      {open ? <EditSheet target={target} lang={lang} editHref={href(`/edit/${target.id}`, lang)} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

type Step = { at: 'choose' } | { at: 'action'; action: EditAction } | { at: 'review'; action: EditAction; operations: Operation[] };

/** The sheet: what to do, then the change's own small form, then its preview and sending. */
export function EditSheet({ target, lang, editHref, onClose, start }: { target: EditTarget; lang: Lang; editHref: string; onClose: () => void; start?: EditAction }) {
  const account = useAccount();
  const location = useLocation();
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState<Step>(start ? { at: 'action', action: start } : { at: 'choose' });
  const [node, setNode] = useState<TreeNode | null>(null);
  const [topSets, setTopSets] = useState<TreeNode[] | null>(null);

  // Its full names, address and what it holds, read when the sheet opens.
  useEffect(() => {
    let live = true;
    call<{ root: TreeNode }>(`/_/organize/tree?root=${encodeURIComponent(target.id)}&depth=0`, 'GET')
      .then((tree) => live && setNode(tree.root))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [target.id]);

  // Escape closes; the page under it does not scroll; focus comes back to where it was.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      before?.focus?.();
    };
  }, [onClose]);

  const wantsTop = step.at === 'action' && step.action === 'move' && target.type !== 'unit';
  useEffect(() => {
    if (!wantsTop || topSets) return;
    call<{ children: TreeNode[] }>('/_/organize/tree?depth=0&limit=100', 'GET')
      .then((tree) => setTopSets(tree.children))
      .catch(() => setTopSets([]));
  }, [wantsTop, topSets]);

  const actions = actionsFor(target);
  const merging = step.at === 'action' && step.action === 'merge';
  const review = (action: EditAction, operations: Operation[]) => setStep({ at: 'review', action, operations });
  const heading = step.at === 'choose' ? target.label : `${ACTION[step.action].label(lang, target)}: ${target.label}`;
  const signIn = href('/signin', lang, { return: `${location.pathname}${location.search}` });

  return (
    <div className="esheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="esheet" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={panel} tabIndex={-1}>
        <div className="esheet-head">
          {step.at !== 'choose' && !start ? (
            <button type="button" className="btn ghost icon sm" aria-label={ow(lang, 'back')} onClick={() => setStep(step.at === 'review' && step.action !== 'move-up' && step.action !== 'delete-set' ? { at: 'action', action: step.action } : { at: 'choose' })}>
              <Icon name="chevr" className="flip-ltr" />
            </button>
          ) : null}
          <h2 id={titleId} className="esheet-title">
            {heading}
          </h2>
          <button type="button" className="btn ghost icon sm" aria-label={ow(lang, 'close')} onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>

        <div className="esheet-body">
          {step.at === 'choose' ? (
            <>
              <ul className="esheet-actions" aria-label={`${ow(lang, 'actionsFor')} ${target.label}`}>
                {actions.map((action) => (
                  <li key={action}>
                    <button type="button" className={cx('esheet-action', action === 'delete-set' && 'danger')} onClick={() => setStep({ at: 'action', action })} data-action={action}>
                      <Icon name={ACTION[action].icon} className="subtle" />
                      <span className="grow">{ACTION[action].label(lang, target)}</span>
                      <Icon name="chev" className="subtle flip-ltr" />
                    </button>
                  </li>
                ))}
              </ul>
              <div className="esheet-links">
                <Link className="btn sm" to={editHref}>
                  <Icon name="file" />
                  {ow(lang, 'editFields')}
                </Link>
                {target.type === 'set' || target.type === 'work' ? (
                  <Link className="btn sm" to={href('/organize', lang, { root: target.id })}>
                    <Icon name="layers" />
                    {ow(lang, 'openOrganizer')}
                  </Link>
                ) : null}
              </div>
            </>
          ) : account === null ? (
            <p className="esheet-signin">
              <Icon name="lock" className="subtle" />
              <span>
                {ow(lang, 'signInToEdit')}{' '}
                <Link className="btn sm primary" to={signIn}>
                  {ow(lang, 'signInLink')}
                </Link>
              </span>
            </p>
          ) : step.at === 'review' ? (
            <Review lang={lang} operations={step.operations} />
          ) : step.action === 'rename' ? (
            node ? (
              <RenameForm lang={lang} node={node} submitLabel={ow(lang, 'previewChange')} onClose={onClose} onRename={(name, slug) => review('rename', operationsFor(target, { kind: 'rename', name, slug }))} />
            ) : (
              <p className="org-pad subtle">{ow(lang, 'loading')}</p>
            )
          ) : step.action === 'move' || step.action === 'merge' ? (
            <Picker
              key={step.action}
              lang={lang}
              what={step.action}
              type={step.action === 'merge' ? target.type : moveTargetType(target.type)}
              quick={step.action === 'move' && target.type !== 'unit' ? (topSets ?? []).map((s) => ({ id: s.id, label: s.name?.he ? (lang === 'en' && s.name.en ? s.name.en : s.name.he) : s.id, sub: s.path ?? '' })) : []}
              allowTop={step.action === 'move' && target.type === 'set'}
              canKeep={step.action === 'move' && target.type === 'work' && Boolean(target.parent)}
              exclude={[target.id, ...(step.action === 'move' && target.parent ? [target.parent] : [])]}
              onClose={() => setStep({ at: 'choose' })}
              onPick={(id, _label, keep) => {
                if (merging) {
                  if (id) review('merge', operationsFor(target, { kind: 'merge', into: id }));
                } else review('move', operationsFor(target, { kind: 'move', to: id, keep }));
              }}
            />
          ) : step.action === 'move-up' ? (
            <Confirm lang={lang} text={ow(lang, 'moveUpAsk')} onGo={() => review('move-up', operationsFor(target, { kind: 'move-up' }))} />
          ) : step.action === 'delete-set' ? (
            node ? (
              node.counts.sets || node.counts.items ? (
                <p className="org-pad">{ow(lang, 'notEmpty')}</p>
              ) : (
                <Confirm lang={lang} text={ow(lang, 'deleteAsk')} onGo={() => review('delete-set', operationsFor(target, { kind: 'delete-set' }))} />
              )
            ) : (
              <p className="org-pad subtle">{ow(lang, 'loading')}</p>
            )
          ) : step.action === 'create-set' ? (
            <NewSetFields lang={lang} submitLabel={ow(lang, 'previewChange')} onMake={(name, slug) => review('create-set', operationsFor(target, { kind: 'create-set', name, slug }))} />
          ) : step.action === 'reorder' ? (
            <Reorder lang={lang} target={target} onReady={(operations) => review('reorder', operations)} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Confirm({ lang, text, onGo }: { lang: Lang; text: string; onGo: () => void }) {
  return (
    <div className="org-pad stack">
      <p>{text}</p>
      <div className="btn-row">
        <button type="button" className="btn primary" onClick={onGo}>
          <Icon name="eye" />
          {ow(lang, 'previewChange')}
        </button>
      </div>
    </div>
  );
}

/** What is in the set or sefer, to put in a new order: a handle to drag, and arrows for a finger or the keyboard. */
function Reorder({ lang, target, onReady }: { lang: Lang; target: EditTarget; onReady: (operations: Operation[]) => void }) {
  const [tree, setTree] = useState<{ root: TreeNode; children: TreeNode[]; more: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    call<{ root: TreeNode; children: TreeNode[]; more: number }>(`/_/organize/tree?root=${encodeURIComponent(target.id)}&limit=500`, 'GET')
      .then(setTree)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [target.id]);
  const groups = useMemo(() => (tree ? groupsOf(tree.root, tree.children).filter((g) => g.orderable && g.nodes.length > 1) : []), [tree]);
  const [orders, setOrders] = useState<Record<string, string[]>>({});
  useEffect(() => setOrders(Object.fromEntries(groups.map((g) => [g.key, g.nodes.map((n) => n.id)]))), [groups]);
  const [dragging, setDragging] = useState<{ group: string; id: string } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const byId = useMemo(() => new Map((tree?.children ?? []).map((c) => [c.id, c])), [tree]);
  const plan = planOf([], groups, orders);

  if (error) return <p className="alert negative org-pad" role="alert">{error}</p>;
  if (!tree) return <p className="org-pad subtle">{ow(lang, 'loading')}</p>;
  if (!groups.length) return <p className="org-pad subtle">{ow(lang, 'nothingToOrder')}</p>;
  const nameOf = (n: TreeNode) => (lang === 'en' && n.name?.en ? n.name.en : n.name?.he) || n.path || n.id;
  const drop = (group: string, before: string | null, e: DragEvent) => {
    e.preventDefault();
    if (dragging && dragging.group === group) setOrders({ ...orders, [group]: dropBefore(orders[group] ?? [], [dragging.id], before) });
    setDragging(null);
    setOver(null);
  };
  return (
    <div className="stack">
      <p className="org-pad subtle esheet-hint">{ow(lang, 'reorderHint')}</p>
      {groups.map((group) => {
        const list = orders[group.key] ?? [];
        return (
          <section key={group.key} aria-label={ow(lang, group.key)}>
            {groups.length > 1 ? <h3 className="esheet-sub">{ow(lang, group.key)}</h3> : null}
            <ol className="rows org-rows esheet-order" onDragOver={(e) => dragging && e.preventDefault()} onDrop={(e) => drop(group.key, null, e)}>
              {list.map((id, i) => {
                const n = byId.get(id);
                if (!n) return null;
                return (
                  <li
                    key={id}
                    className={cx('row org-row', over === id && 'drop-before', dragging?.id === id && 'is-dragging')}
                    draggable
                    onDragStart={(e) => {
                      setDragging({ group: group.key, id });
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', id);
                    }}
                    onDragOver={(e) => {
                      if (!dragging) return;
                      e.preventDefault();
                      setOver(id);
                    }}
                    onDragEnd={() => (setDragging(null), setOver(null))}
                    onDrop={(e) => (e.stopPropagation(), drop(group.key, id, e))}
                  >
                    <div className="org-line">
                      <span className="org-handle" aria-hidden="true" title={ow(lang, 'drag')}>
                        <Icon name="menu" />
                      </span>
                      <Icon name={ORGANIZE_ICONS[n.type] ?? 'dot'} className="subtle" />
                      <span className="grow org-main org-name">{nameOf(n)}</span>
                      <span className="org-arrows">
                        <button type="button" className="btn sm ghost icon" aria-label={`${ow(lang, 'up')}: ${nameOf(n)}`} disabled={i === 0} onClick={() => setOrders({ ...orders, [group.key]: moveBy(list, [id], -1) })}>
                          <Icon name="chevu" />
                        </button>
                        <button type="button" className="btn sm ghost icon" aria-label={`${ow(lang, 'down')}: ${nameOf(n)}`} disabled={i === list.length - 1} onClick={() => setOrders({ ...orders, [group.key]: moveBy(list, [id], 1) })}>
                          <Icon name="chevd" />
                        </button>
                      </span>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
      {tree.more ? (
        <p className="org-pad subtle">
          {ow(lang, 'more')} {num(tree.more, lang)}
        </p>
      ) : null}
      <div className="org-pad btn-row esheet-foot">
        <button type="button" className="btn primary" disabled={plan.length === 0} onClick={() => onReady(plan)}>
          <Icon name="eye" />
          {plan.length ? ow(lang, 'previewChange') : ow(lang, 'unchanged')}
        </button>
      </div>
    </div>
  );
}

/** The change's preview, a word for the reviewers, and sending it; then where the suggestion is. */
function Review({ lang, operations }: { lang: Lang; operations: Operation[] }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  useEffect(() => {
    let live = true;
    setPreview(null);
    setError(null);
    calls
      .preview(operations)
      .then((p) => live && setPreview(p))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [operations]);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      setSent(await calls.send(operations, undefined, note));
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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    const at = suggestionPath(sent);
    return (
      <div className="org-pad stack">
        <p className="alert positive" role="status">
          <Icon name="check" />
          <span>
            {sent.merged ? ow(lang, 'goesLive') : ow(lang, 'sent')}{' '}
            <Link to={href(at.path, lang, at.query)}>
              {ow(lang, 'seeSuggestion')}
              {sent.suggestion.number != null ? ` #${sent.suggestion.number}` : ''}
            </Link>
          </span>
        </p>
        {sent.mayApprove && !sent.merged ? (
          <div className="btn-row">
            <button type="button" className="btn approve" onClick={applyNow} disabled={busy}>
              {ow(lang, 'applyNow')}
            </button>
          </div>
        ) : null}
        {error ? (
          <p className="alert negative" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <div className="stack">
      {preview ? <PreviewView lang={lang} preview={preview} /> : error ? null : <p className="org-pad subtle">{ow(lang, 'loading')}</p>}
      {error ? (
        <p className="alert negative org-pad" role="alert">
          <Icon name="warn" />
          {error}
        </p>
      ) : null}
      <div className="org-pad stack esheet-foot">
        <label className="field">
          <span className="field-label">{ow(lang, 'why')}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} dir="auto" />
        </label>
        <p className="subtle org-note">{ow(lang, 'reviewNote')}</p>
        <div className="btn-row">
          <button type="button" className="btn primary" onClick={send} disabled={busy || !preview}>
            {busy ? ow(lang, 'loading') : ow(lang, 'send')}
          </button>
        </div>
      </div>
    </div>
  );
}
