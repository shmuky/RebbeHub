import { useCallback, useEffect, useMemo, useState } from "react";
import type { LocalName } from "@rebbehub/model";
import { Link } from "react-router";
import { dateLabel } from "../lib/dates.js";
import { nameOf, type Lang } from "../lib/i18n.js";
import { clockOf } from "../lib/i18nNetwork.js";
import { num } from "../lib/i18nUi.js";
import { href } from "../lib/links.js";
import { get } from "../lib/transcript.js";
import { wordDiff } from "../lib/wordDiff.js";
import { usePlayer, type Track } from "../player/PlayerProvider.js";
import { InlineDiff } from "../ui/Diff.js";
import { Icon } from "../ui/Icon.js";
import { EmptyState, Skeleton } from "../ui/primitives.js";

/**
 * Every transcript fix waiting for approval on one page (GET
 * /v1/transcripts/fixes), a farbrengen's together in the order they are
 * heard: each paragraph's words on the site beside the words sent, a tap
 * to hear it, and Keep or Remove. Nothing happens until Apply, which
 * decides them all in one call: kept ones are approved, removed ones are
 * withdrawn when they are yours, else sent back. Timing changes made with
 * the editor's old timing tool (removed: it moved the sync where people
 * meant to confirm it) start marked Remove.
 */

type Kind = "words" | "check" | "timing" | "new";
interface Change {
  segment: string;
  kind: Kind;
  before: string | null;
  after: string | null;
  startMs: number | null;
  endMs: number | null;
  newStartMs?: number;
}
interface Fix {
  id: number;
  number: number | null;
  author: string;
  authorName: string | null;
  bot: boolean;
  at: string;
  recording: string;
  recordingTitle: LocalName | null;
  event: string | null;
  eventPath: string | null;
  eventTitle: LocalName | null;
  date: string | null;
  language: string | null;
  mayApprove: boolean;
  mine: boolean;
  changes: Change[];
}
type Choice = "keep" | "remove";
type Result = {
  id: number;
  done: "kept" | "withdrawn" | "sent_back" | null;
  error?: string;
};

const W = {
  intro: {
    he: "כל תיקוני התמלול שממתינים לאישור, לפי ההתוועדות ובסדר שבו הם נשמעים. בוחרים לכל תיקון לשמור או להסיר, ובסוף לוחצים ״לבצע״.",
    en: "Every transcript fix waiting for approval, by farbrengen, in the order heard. Choose Keep or Remove for each, then Apply.",
  },
  keep: { he: "לשמור", en: "Keep" },
  remove: { he: "להסיר", en: "Remove" },
  keepAll: { he: "לשמור הכל", en: "Keep all" },
  removeAll: { he: "להסיר הכל", en: "Remove all" },
  clear: { he: "לנקות בחירה", en: "Clear" },
  apply: { he: "לבצע", en: "Apply" },
  applying: { he: "מבצע…", en: "Applying…" },
  summary: {
    he: "{keep} לשמירה · {remove} להסרה",
    en: "{keep} to keep · {remove} to remove",
  },
  none: {
    he: "אין תיקוני תמלול שממתינים.",
    en: "No transcript fix is waiting.",
  },
  checked: { he: "סומנה כמדויקת, בלי שינוי", en: "Marked right as it is" },
  added: { he: "פסקה חדשה", en: "A new paragraph" },
  timing: {
    he: "שינוי תזמון: מ־{from} ל־{to}. מהכלי שהוסר; מסומן להסרה.",
    en: "Timing change: {from} to {to}. From the removed tool; marked Remove.",
  },
  by: { he: "מאת", en: "by" },
  open: { he: "לפתוח בעורך", en: "Open in the editor" },
  more: {
    he: "ועוד {n} פסקאות באותה הצעה",
    en: "and {n} more paragraphs in the same suggestion",
  },
  cantKeep: { he: "רק אחראי האוסף מאשרים", en: "Only the keepers approve" },
  cantRemove: {
    he: "רק הכותב או אחראי האוסף",
    en: "Only its author or a keeper",
  },
  kept: { he: "נשמר", en: "Kept" },
  withdrawn: { he: "הוסר", en: "Removed" },
  sent_back: { he: "הוחזר לכותב", en: "Sent back" },
  failed: { he: "לא בוצע", en: "Not done" },
  play: { he: "להשמיע מכאן", en: "Play from here" },
} as const;
const w = (lang: Lang, key: keyof typeof W) => W[key][lang] as string;

/** The farbrengen's parts, fetched once each, for playing a paragraph where it is heard. */
const trackCache = new Map<string, Promise<Track[]>>();
function tracksOfEvent(event: string, lang: Lang): Promise<Track[]> {
  let found = trackCache.get(event);
  if (!found) {
    found = fetch(href(`/_/tracks/${event}`, lang))
      .then((r) => r.json() as Promise<{ tracks: Track[] }>)
      .then((r) => r.tracks)
      .catch(() => []);
    trackCache.set(event, found);
  }
  return found;
}

export function TranscriptFixes({
  lang,
  onDone,
}: {
  lang: Lang;
  onDone?: () => void;
}) {
  const player = usePlayer();
  const [fixes, setFixes] = useState<Fix[] | null>(null);
  const [choice, setChoice] = useState<Record<number, Choice>>({});
  const [results, setResults] = useState<Record<number, Result>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { fixes } = await get<{ fixes: Fix[] }>("transcripts/fixes");
      setFixes(fixes);
      // What the old timing tool sent starts marked Remove, where it may be.
      setChoice(
        Object.fromEntries(
          fixes
            .filter(
              (f) =>
                f.changes.every((c) => c.kind === "timing") &&
                (f.mine || f.mayApprove),
            )
            .map((f) => [f.id, "remove" as Choice]),
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => void load(), [load]);

  const mayKeep = (f: Fix) => f.mayApprove;
  const mayRemove = (f: Fix) => f.mine || f.mayApprove;
  // A second tap on the same choice takes it back.
  const pick = (f: Fix, c: Choice) =>
    setChoice((all) => {
      const { [f.id]: was, ...rest } = all;
      return was === c ? rest : { ...rest, [f.id]: c };
    });
  const pickAll = (list: Fix[], c: Choice | null) =>
    setChoice((all) => {
      const next = { ...all };
      for (const f of list) {
        if (results[f.id]?.done) continue;
        if (c === null) delete next[f.id];
        else if (c === "keep" ? mayKeep(f) : mayRemove(f)) next[f.id] = c;
      }
      return next;
    });

  const groups = useMemo(() => {
    const out: Array<{ key: string; fixes: Fix[] }> = [];
    for (const f of fixes ?? []) {
      const last = out[out.length - 1];
      if (last && last.key === f.recording) last.fixes.push(f);
      else out.push({ key: f.recording, fixes: [f] });
    }
    return out;
  }, [fixes]);

  const keep = Object.entries(choice)
    .filter(([id, c]) => c === "keep" && !results[Number(id)]?.done)
    .map(([id]) => Number(id));
  const remove = Object.entries(choice)
    .filter(([id, c]) => c === "remove" && !results[Number(id)]?.done)
    .map(([id]) => Number(id));

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/_/steward/transcripts/fixes/decide", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ keep, remove }),
      });
      const json = (await response.json().catch(() => ({}))) as {
        results?: Result[];
        message?: string;
      };
      if (!response.ok) throw new Error(json.message ?? response.statusText);
      setResults((all) => ({
        ...all,
        ...Object.fromEntries((json.results ?? []).map((r) => [r.id, r])),
      }));
      onDone?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function hear(f: Fix, ms: number | null) {
    if (!f.event || ms === null) return;
    const tracks = await tracksOfEvent(f.event, lang);
    const index = tracks.findIndex((t) => t.id === f.recording);
    if (index >= 0) player.play(tracks, index, ms / 1000);
  }

  if (error && !fixes)
    return (
      <p className="alert negative" role="alert">
        <Icon name="warn" />
        <span>{error}</span>
      </p>
    );
  if (!fixes)
    return (
      <div className="box">
        <Skeleton rows={4} lang={lang} />
      </div>
    );
  if (!fixes.length) return <EmptyState icon="check" title={w(lang, "none")} />;

  return (
    <div className="txf">
      <p className="rq-intro muted">{w(lang, "intro")}</p>
      <div className="txf-bulk">
        <button
          type="button"
          className="btn sm"
          onClick={() => pickAll(fixes, "keep")}
        >
          <Icon name="check" size={14} />
          {w(lang, "keepAll")}
        </button>
        <button
          type="button"
          className="btn sm"
          onClick={() => pickAll(fixes, "remove")}
        >
          <Icon name="x" size={14} />
          {w(lang, "removeAll")}
        </button>
        <button
          type="button"
          className="btn sm ghost"
          onClick={() => pickAll(fixes, null)}
        >
          {w(lang, "clear")}
        </button>
      </div>

      {groups.map((g) => {
        const first = g.fixes[0]!;
        const title =
          nameOf(first.eventTitle , lang) ||
          (first.date
            ? dateLabel(first.date, lang, { civil: false })
            : first.recording);
        const part = nameOf(first.recordingTitle , lang);
        return (
          <section key={g.key} className="txf-group box">
            <header className="txf-gh">
              <div>
                <b>{title}</b>
                {part ? <span className="subtle"> · {part}</span> : null}
                {first.date && first.eventTitle ? (
                  <span className="subtle">
                    {" "}
                    · {dateLabel(first.date, lang, { civil: false })}
                  </span>
                ) : null}
              </div>
              <Link
                className="txf-open"
                to={`${href(`/${first.recording}`, lang, { review: "1" })}#transcript`}
              >
                {w(lang, "open")}
              </Link>
            </header>
            <ul className="txf-list">
              {g.fixes.map((f) => {
                const c = choice[f.id];
                const done = results[f.id];
                const shown = f.changes.slice(0, 3);
                return (
                  <li
                    key={f.id}
                    className={`txf-row${c ? ` ${c}` : ""}${done?.done ? " done" : ""}`}
                  >
                    <div className="txf-main">
                      {shown.map((ch) => (
                        <div
                          key={`${ch.segment}:${ch.kind}`}
                          className="txf-change"
                        >
                          <button
                            type="button"
                            className="txf-at num"
                            onClick={() => void hear(f, ch.startMs)}
                            disabled={ch.startMs === null || !f.event}
                            aria-label={w(lang, "play")}
                            title={w(lang, "play")}
                          >
                            <Icon name="play" size={12} />
                            {ch.startMs !== null ? clockOf(ch.startMs) : "–"}
                          </button>
                          <p
                            className="tx-diff"
                            lang={f.language ?? undefined}
                            dir="rtl"
                          >
                            {ch.kind === "words" ? (
                              <InlineDiff
                                parts={wordDiff(
                                  ch.before ?? "",
                                  ch.after ?? "",
                                )}
                              />
                            ) : ch.kind === "new" ? (
                              <ins>{ch.after}</ins>
                            ) : (
                              <span>{ch.before}</span>
                            )}
                          </p>
                          {ch.kind === "check" ? (
                            <span className="txf-note subtle">
                              {w(lang, "checked")}
                            </span>
                          ) : null}
                          {ch.kind === "new" ? (
                            <span className="txf-note subtle">
                              {w(lang, "added")}
                            </span>
                          ) : null}
                          {ch.kind === "timing" ? (
                            <span className="txf-note attention">
                              {w(lang, "timing")
                                .replace(
                                  "{from}",
                                  ch.startMs !== null
                                    ? clockOf(ch.startMs)
                                    : "–",
                                )
                                .replace("{to}", clockOf(ch.newStartMs ?? 0))}
                            </span>
                          ) : null}
                        </div>
                      ))}
                      {f.changes.length > shown.length ? (
                        <p className="txf-note subtle">
                          {w(lang, "more").replace(
                            "{n}",
                            num(f.changes.length - shown.length, lang),
                          )}
                        </p>
                      ) : null}
                      <p className="txf-meta subtle">
                        {w(lang, "by")} {f.authorName ?? f.author}
                        {f.number !== null ? (
                          <>
                            {" · "}
                            <Link to={href(`/suggestions/${f.number}`, lang)}>
                              #{f.number}
                            </Link>
                          </>
                        ) : null}
                      </p>
                    </div>
                    <div className="txf-side">
                      {done ? (
                        <span
                          className={`txf-done ${done.done ? "ok" : "fail"}`}
                          title={done.error}
                        >
                          <Icon name={done.done ? "check" : "warn"} size={14} />
                          {done.done
                            ? w(lang, done.done)
                            : `${w(lang, "failed")}: ${done.error ?? ""}`}
                        </span>
                      ) : null}
                      {!done?.done ? (
                        <div className="segmented txf-choice" role="group">
                          <button
                            type="button"
                            aria-pressed={c === "keep"}
                            disabled={!mayKeep(f)}
                            title={mayKeep(f) ? undefined : w(lang, "cantKeep")}
                            onClick={() => pick(f, "keep")}
                          >
                            {w(lang, "keep")}
                          </button>
                          <button
                            type="button"
                            aria-pressed={c === "remove"}
                            disabled={!mayRemove(f)}
                            title={
                              mayRemove(f) ? undefined : w(lang, "cantRemove")
                            }
                            onClick={() => pick(f, "remove")}
                          >
                            {w(lang, "remove")}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <div className="txf-bar" aria-live="polite">
        <span>
          {w(lang, "summary")
            .replace("{keep}", num(keep.length, lang))
            .replace("{remove}", num(remove.length, lang))}
        </span>
        {error ? <span className="negative">{error}</span> : null}
        <button
          type="button"
          className="btn primary"
          disabled={busy || (!keep.length && !remove.length)}
          onClick={() => void apply()}
        >
          {busy ? w(lang, "applying") : w(lang, "apply")}
        </button>
      </div>
    </div>
  );
}
