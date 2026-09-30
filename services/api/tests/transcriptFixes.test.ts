import { beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import {
  anchorSync,
  fixParagraph,
  type Catalog,
  type Json,
} from "@rebbehub/core";
import type { EntityId } from "@rebbehub/model";
import { createApp } from "../src/app.js";
import {
  add,
  freshCatalog,
  yudShvat,
} from "../../../packages/core/tests/helpers.js";

/** Going through every transcript fix waiting for approval at once (core/transcriptFixes.ts): Keep some, Remove others. */

let app: Hono;
let catalog: Catalog;
let recording: EntityId;
let segments: EntityId[];

beforeEach(async () => {
  const fresh = await freshCatalog();
  catalog = fresh.catalog;
  const event = await add(
    catalog,
    "mendy",
    "keeper",
    "event",
    yudShvat(fresh.set),
    "/events/5742-05-10",
  );
  recording = await add(catalog, "mendy", "keeper", "recording", {
    event,
    title: { he: "שיחה א׳" },
    url: "https://example.test/a.mp3",
    sets: [fresh.set],
  });
  await catalog.createAccount({
    id: "bot:transcribe",
    displayName: "Machine transcription",
    isBot: true,
  });
  const cs = await catalog.createChangeset("bot:transcribe", {
    title: "Transcript",
  });
  const origin = { by: "transcribe:fake@1" };
  const text = await catalog.putRevision(cs.id, "bot:transcribe", {
    type: "text",
    data: { kind: "transcript", recording, language: "yi" } as Json,
  });
  const alignment = await catalog.putRevision(cs.id, "bot:transcribe", {
    type: "alignment",
    data: { recording, text, granularity: "word" } as Json,
  });
  segments = [];
  for (const [i, content] of [
    "לחיים לחיים",
    "עס שטייט אין פסוק",
    "אין פסוק",
  ].entries()) {
    const segment = await catalog.putRevision(cs.id, "bot:transcribe", {
      type: "segment",
      data: {
        text,
        order: `a${i}`,
        kind: "paragraph",
        content,
        proofread: 0,
        origin,
      } as Json,
    });
    segments.push(segment);
    await catalog.putRevision(cs.id, "bot:transcribe", {
      type: "alignment-span",
      data: {
        alignment,
        segment,
        startMs: i * 4000,
        endMs: i * 4000 + 4000,
        origin,
      } as Json,
    });
  }
  await catalog.submit(cs.id, "bot:transcribe");
  await catalog.merge(cs.id, "shmuly");
  app = createApp({
    catalog,
    authenticate: (c) => c.req.header("X-Test-Account") ?? null,
    siteUrl: "https://rebbehub.test",
  });
});

const call = async (
  method: string,
  path: string,
  options: { as?: string; body?: unknown } = {},
) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (options.as) headers["X-Test-Account"] = options.as;
  const response = await app.request(path, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return { status: response.status, body: (await response.json()) as any };
};

describe("transcript fixes, all together", () => {
  it("lists every fix waiting, and keeps some and removes others in one go", async () => {
    const words = await fixParagraph(catalog, "chaim", {
      segment: segments[1]!,
      content: "עס שטייט אין [פסוק?]",
    });
    // Another listener: one person's fixes of a transcript join one suggestion.
    const checked = await fixParagraph(catalog, "mendy", {
      segment: segments[0]!,
      content: "לחיים לחיים",
    });
    const timing = await anchorSync(catalog, "chaim", {
      recording,
      segment: segments[2]!,
      atMs: 9500,
    });

    const list = await call("GET", "/v1/transcripts/fixes", { as: "keeper" });
    expect(list.status).toBe(200);
    // In the order they are heard, with the words on the site beside the words sent.
    expect(
      list.body.fixes.map((f: any) => [
        f.id,
        f.changes.map((c: any) => [c.kind, c.before, c.after, c.startMs]),
      ]),
    ).toEqual([
      [checked.id, [["check", "לחיים לחיים", "לחיים לחיים", 0]]],
      [
        words.id,
        [["words", "עס שטייט אין פסוק", "עס שטייט אין [פסוק?]", 4000]],
      ],
      [timing.id, [["timing", "אין פסוק", "אין פסוק", 8000]]],
    ]);
    expect(list.body.fixes[2].changes[0].newStartMs).toBe(9500);
    expect(list.body.fixes[0]).toMatchObject({
      recording,
      author: "mendy",
      mayApprove: true,
      mine: false,
      eventPath: "/events/5742-05-10",
    });
    // Signed out, nobody may approve.
    expect(
      (await call("GET", "/v1/transcripts/fixes")).body.fixes.every(
        (f: any) => !f.mayApprove,
      ),
    ).toBe(true);

    // The author takes out their own: withdrawn.
    const own = await call("POST", "/v1/transcripts/fixes/decide", {
      as: "chaim",
      body: { remove: [timing.id] },
    });
    expect(own.body.results).toEqual([{ id: timing.id, done: "withdrawn" }]);
    // A keeper keeps one and sends the other back; one already decided says why.
    const decided = await call("POST", "/v1/transcripts/fixes/decide", {
      as: "keeper",
      body: { keep: [words.id], remove: [checked.id, timing.id] },
    });
    expect(decided.body.results.slice(0, 2)).toEqual([
      { id: words.id, done: "kept" },
      { id: checked.id, done: "sent_back" },
    ]);
    expect(decided.body.results[2]).toMatchObject({
      id: timing.id,
      done: null,
    });
    expect(
      ((await catalog.get(segments[1]!))!.data as { content: string }).content,
    ).toBe("עס שטייט אין [פסוק?]");
    expect(
      (await call("GET", "/v1/transcripts/fixes", { as: "keeper" })).body.fixes,
    ).toEqual([]);
    expect(
      (
        await call("POST", "/v1/transcripts/fixes/decide", {
          body: { keep: [words.id] },
        })
      ).status,
    ).toBe(401);
  });

  it("combines one person's fixes into one suggestion, keeping every word each changed", async () => {
    // As the old editor sent them: each word its own suggestion, from the same paragraph.
    const send = async (content: string) => {
      const cs = await catalog.createChangeset("chaim", { title: "תיקון תמלול" });
      const data = (await catalog.get(segments[1]!))!.data as Record<string, Json>;
      await catalog.putRevision(cs.id, "chaim", { id: segments[1]!, type: "segment", data: { ...data, content } });
      return (await catalog.submit(cs.id, "chaim")).id;
    };
    const first = await send("עס שטייט אין פסוקים");
    const second = await send("דאס שטייט אין פסוק");

    expect((await call("POST", "/v1/suggestions/combine", { as: "mendy", body: { suggestions: [first, second] } })).status).toBe(403);
    const made = await call("POST", "/v1/suggestions/combine", { as: "chaim", body: { suggestions: [first, second] } });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ status: "open", title: "תיקון תמלול" });
    expect((await catalog.changeset(first)).status).toBe("withdrawn");
    expect((await catalog.changeset(second)).status).toBe("withdrawn");

    const fixes = (await call("GET", "/v1/transcripts/fixes", { as: "keeper" })).body.fixes;
    expect(fixes.map((f: any) => [f.id, f.changes.map((c: any) => c.after)])).toEqual([[made.body.id, ["דאס שטייט אין פסוקים"]]]);
    // Approved at once, with nothing to settle.
    await catalog.merge(made.body.id, "keeper");
    expect(((await catalog.get(segments[1]!))!.data as { content: string }).content).toBe("דאס שטייט אין פסוקים");
  });
});
