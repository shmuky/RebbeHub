import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { SuggestionCard, type ReviewDetail, type ReviewRow } from '../app/components/ReviewCard.js';
import type { Lang } from '../app/lib/i18n.js';

/**
 * A bot's Suggestion of 500 items in the review queue: drawn from its
 * list row before its changes are read, then with the summary of all
 * 500, the first page of them, "Show more" for the rest, and Approve for
 * the whole of it; the bot's work marked as a machine's.
 */

const row: ReviewRow = {
  id: 7,
  number: null,
  title: 'Drive links in place of the media proxy (1-500)',
  description: "Links older imports stored on Sichos-Kodesh's media proxy become the file's own Google Drive link.",
  author: 'bot:relink-drive',
  status: 'open',
  kind: 'import',
  post_review: null,
  submitted_at: '2026-09-28T12:00:00Z',
  created_at: '2026-09-28T12:00:00Z',
  // As the list gives it: no checks, which only a Suggestion read on its own carries.
  items: 500,
};

const entry = (i: number) => ({
  entityId: `rh-e${i}`,
  type: 'event',
  before: { kind: 'farbrengen', title: { he: `התוועדות ${i}` }, links: [{ url: `https://sichos-kodesh-media-proxy.shmuky.workers.dev/drive/f${i}` }] },
  after: { kind: 'farbrengen', title: { he: `התוועדות ${i}` }, links: [{ url: `https://drive.google.com/file/d/f${i}/view` }] },
  changes: [{ path: '/links', before: [{ url: `https://sichos-kodesh-media-proxy.shmuky.workers.dev/drive/f${i}` }], after: [{ url: `https://drive.google.com/file/d/f${i}/view` }] }],
  conflicts: [],
});

const detail: ReviewDetail = {
  changeset: row,
  entries: Array.from({ length: 25 }, (_, i) => entry(i)),
  total: 500,
  next: 25,
  summary: [{ type: 'event', kind: 'changed', count: 500, fields: [{ path: '/links', before: 'link:sichos-kodesh-media-proxy.shmuky.workers.dev', after: 'link:drive.google.com' }], examples: ['rh-e0', 'rh-e1', 'rh-e2'] }],
  reviews: [],
  names: { 'bot:relink-drive': 'Drive links (relink bot)' },
  files: {},
  mayApprove: true,
  mine: false,
  advice: null,
};

const render = (d: ReviewDetail | null, lang: Lang = 'en') =>
  renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(SuggestionCard, { row, person: { name: 'Drive links (relink bot)', bot: true }, detail: d, lang, open: true, onDone: () => {}, onMore: () => {} })),
  );

describe("a bot's Suggestion of 500 items in the review queue", () => {
  it('is drawn from its list row before its changes are read: the bot, a machine label, and how many items', () => {
    const html = render(null);
    expect(html).toContain('id="s7"');
    expect(html).toContain('Drive links in place of the media proxy (1-500)');
    expect(html).toContain('Drive links (relink bot)');
    expect(html).toContain('(bot)');
    expect(html).toContain('Not yet checked');
    expect(html).toContain('500 items');
    expect(html).not.toContain('Approve');
    expect(html).toContain('aria-busy="true"'); // its changes are on their way
  });

  it('then sums the 500 up, shows the first 25, offers the rest, and approves all of it', () => {
    const html = render(detail);
    expect(html).toContain('What changes');
    expect(html).toContain('links to sichos-kodesh-media-proxy.shmuky.workers.dev');
    expect(html).toContain('links to drive.google.com');
    expect(html).toContain('href="/rh-e0?lang=en"');
    // Each example shows the address it had and the one it gets, not just "(changed)".
    expect(html).toContain('links › 0 › url');
    expect(html).toContain('<ins>drive</ins>');
    expect(html).not.toContain('(changed)');
    expect((html.match(/class="diff"/g) ?? []).length).toBe(25);
    expect(html).toContain('Showing 25 of 500');
    expect(html).toContain('Show more');
    expect(html).toContain('475 left');
    expect(html).toMatch(/Approve<span class="num"> · 500<\/span>/);
    expect(html).toContain('Send back');
  });

  it('reads in Hebrew too', () => {
    const html = render(detail, 'he');
    expect(html).toContain('מה משתנה');
    expect(html).toContain('להציג עוד');
    expect(html).toContain('בוט');
  });

  it('once every item is shown, offers no more', () => {
    const html = render({ ...detail, entries: detail.entries.slice(0, 3), total: 3, next: null, summary: [{ ...detail.summary![0]!, count: 3 }] });
    expect(html).not.toContain('Show more');
    expect(html).toContain('3 items');
  });
});
