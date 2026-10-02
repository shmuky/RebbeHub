import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { QueueRow } from '../app/components/QueueRow.js';
import { SuggestionCard, UNDECIDED, decidedAs, type Decision, type ReviewDetail, type ReviewRow } from '../app/components/ReviewCard.js';
import { reviewChoices } from '../app/ui/ReviewBox.js';
import type { Lang } from '../app/lib/i18n.js';

/**
 * A bot's Suggestion of 500 items in the review queue: drawn from its
 * list row before its changes are read, then with the summary of all
 * 500, the first page of them, "Show more" for the rest, and Approve for
 * the whole of it; the bot's work marked as a machine's.
 */

// As GET /v1/suggestions sends it: no checks (a Suggestion read on its own has them).
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
  changeset: { ...row, checks: [{ check: 'date', status: 'warn', message: 'no date' }] },
  entries: Array.from({ length: 10 }, (_, i) => entry(i)),
  total: 500,
  next: 10,
  summary: [{ type: 'event', kind: 'changed', count: 500, fields: [{ path: '/links', before: 'link:sichos-kodesh-media-proxy.shmuky.workers.dev', after: 'link:drive.google.com' }], examples: ['rh-e0', 'rh-e1', 'rh-e2'] }],
  reviews: [],
  names: { 'bot:relink-drive': 'Drive links (relink bot)' },
  files: {},
  mayApprove: true,
  mine: false,
  advice: null,
};

const render = (d: ReviewDetail | null, lang: Lang = 'en', decision?: Decision) =>
  renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(SuggestionCard, { row, person: { name: 'Drive links (relink bot)', bot: true }, detail: d, lang, open: true, onDone: () => {}, onMore: () => {}, decision })),
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

  it('is drawn from a list row that carries no checks (the list leaves them out), and shows the checks once read', () => {
    expect('checks' in row).toBe(false);
    expect(() => render(null)).not.toThrow();
    expect(render(null)).not.toContain('no date');
    expect(render(detail)).toContain('no date');
  });

  it('then sums the 500 up, shows the first 10, offers the rest, and approves all of it', () => {
    const html = render(detail);
    expect(html).toContain('What changes');
    expect(html).toContain('links to sichos-kodesh-media-proxy.shmuky.workers.dev');
    expect(html).toContain('links to drive.google.com');
    expect(html).toContain('href="/rh-e0?lang=en"');
    // Each example shows the address it had and the one it gets, not just "(changed)".
    expect(html).toContain('links › 0 › url');
    expect(html).toContain('<ins>drive</ins>');
    expect(html).not.toContain('(changed)');
    expect((html.match(/class="diff"/g) ?? []).length).toBe(10);
    expect(html).toContain('Showing 10 of 500');
    expect(html).toContain('Show more');
    expect(html).toContain('490 left');
    expect(html).toMatch(/Approve<span class="num"> · 500<\/span>/);
    expect(html).toContain('Don’t approve, send back');
  });

  it('reads in Hebrew too', () => {
    const html = render(detail, 'he');
    expect(html).toContain('מה משתנה');
    expect(html).toContain('להציג עוד');
    expect(html).toContain('בוט');
  });

  it('says before Approve how many items clash with the site, and approves them keeping the site or taking the suggestion', () => {
    const plain = render(detail);
    expect(plain).not.toContain('Items changed on the site since');
    const html = render({ ...detail, clashes: 12, unchanged: 480 });
    expect(html).toContain('Items changed on the site since: <span class="num">12</span>');
    expect(html).toContain('480</span> already on the site as suggested');
    expect(html).toMatch(/Approve, keep what’s on the site|Approve, keep what&#x27;s on the site/);
    expect(html).toContain('Approve, take the suggestion');
    expect(html).not.toMatch(/>Approve<span/);
  });

  it('sums up a page’s words in one line, by names and not paths, and never more than a few lines', () => {
    const segments = Array.from({ length: 40 }, (_, i) => [
      { path: `/body/versions/he/segments/t${i}/text`, before: 'list', after: 'list' },
      { path: `/body/versions/he/segments/t${i}/printed`, before: 'list', after: 'none' },
      { path: `/body/versions/he/segments/t${i}/words/*/startMs`, before: 'number', after: 'number' },
    ]).flat();
    const groups = Array.from({ length: 12 }, (_, i) => ({ type: 'unit', kind: 'changed' as const, count: 2, fields: [...segments, { path: `/label/he`, before: 'text', after: 'text' }, { path: `/x${i}`, before: 'text', after: 'text' }, { path: `/y${i}`, before: 'text', after: 'text' }], examples: [`rh-u${i}`] }));
    const html = render({ ...detail, summary: groups });
    expect(html).not.toContain('body/versions');
    expect(html).not.toContain('segments');
    expect(html).not.toContain('startMs');
    expect(html).not.toContain('rh-u0<');
    expect(html).toContain('>The words<');
    expect(html).toContain('+1 more<');
    expect(html).toContain('<span class="rq-summary-n num">14</span><span class="rq-summary-what subtle">more kinds of change');
    expect((html.match(/rq-summary-field/g) ?? []).length).toBe(15);
    expect(html).toContain('Example 1');
  });

  it('draws groups that read the same as one', () => {
    const groups = Array.from({ length: 30 }, (_, i) => ({ type: 'unit', kind: 'changed' as const, count: 2, fields: [{ path: `/body/versions/he/segments/t${i}/text`, before: 'list', after: 'list' }], examples: [`rh-u${i}`] }));
    const html = render({ ...detail, summary: groups });
    expect((html.match(/rq-summary-field/g) ?? []).length).toBe(1);
    expect(html).toContain('<span class="rq-summary-n num">60</span>');
  });

  it('once every item is shown, offers no more', () => {
    const html = render({ ...detail, entries: detail.entries.slice(0, 3), total: 3, next: null, summary: [{ ...detail.summary![0]!, count: 3 }] });
    expect(html).not.toContain('Show more');
    expect(html).toContain('3 items');
  });
});

/**
 * Pressing Approve: the button says "Merging…" and nothing can be pressed
 * again while the API merges; once it answers, the card is merged at once
 * (no reload, no second press), and a refusal says why and gives the
 * buttons back.
 */
describe('approving from the review queue', () => {
  const buttons = (html: string) => html.match(/<button[^>]*>/g) ?? [];

  it('says Merging… while the API merges, and no button can be pressed', () => {
    const html = render(detail, 'en', { ...UNDECIDED, doing: 'approve' });
    expect(html).toContain('Merging…');
    expect(html).not.toMatch(/>Approve<span/);
    expect(html).toMatch(/<button[^>]*aria-busy="true"[^>]*>/);
    // Every decision is off while one is on its way ("Show more" only reads more of it).
    for (const b of buttons(html).filter((b) => !b.includes('btn sm'))) expect(b).toContain('disabled');
  });

  it('in Hebrew too', () => {
    expect(render(detail, 'he', { ...UNDECIDED, doing: 'approve' })).toContain('ממזג…');
    expect(render(detail, 'he', { ...UNDECIDED, done: 'approve' })).toContain('מוזג');
  });

  it('once merged, shows it merged and offers Approve no more', () => {
    const html = render(detail, 'en', { ...UNDECIDED, done: 'approve' });
    expect(html).toContain('Merged');
    expect(html).not.toContain('Merging…');
    expect(html).not.toMatch(/>Approve<span/);
    expect(html).not.toContain('Don’t approve, send back');
    expect(html).toContain('class="state approved sm"');
  });

  it('refused, says why and gives the buttons back', () => {
    const html = render(detail, 'en', { ...UNDECIDED, error: 'failed checks: no date' });
    expect(html).toContain('failed checks: no date');
    expect(html).toMatch(/>Approve<span/);
    expect(html).not.toContain('Merging…');
    const approve = buttons(html).find((b) => b.includes('btn approve'));
    expect(approve).toBeDefined();
    expect(approve).not.toContain('disabled');
  });

  it('knows what each decision makes of the Suggestion', () => {
    expect(decidedAs('approve')).toEqual({ status: 'merged' });
    expect(decidedAs('approve-theirs')).toEqual({ status: 'merged' });
    expect(decidedAs('send-back')).toEqual({ status: 'sent_back' });
    expect(decidedAs('withdraw')).toEqual({ status: 'withdrawn' });
    expect(decidedAs('keep-live')).toEqual({ post_review: 'done' });
  });

  it('on a suggestion’s own page, the approve choice says Merging… while it is sent', () => {
    expect(reviewChoices('en').find((c) => c.value === 'approve')?.working).toBe('Merging…');
    expect(reviewChoices('he').find((c) => c.value === 'approve')?.working).toBe('ממזג…');
  });
});

describe('the review queue, as GitHub lists pull requests', () => {
  const line = (r: ReviewRow, lang: Lang = 'en') =>
    renderToStaticMarkup(createElement(MemoryRouter, null, createElement('ul', null, createElement(QueueRow, { row: r, person: { name: 'Drive links (relink bot)', bot: true }, lang }))));

  it('lists a Suggestion by its title, with its #number, who sent it and how many items, and none of its changes', () => {
    const html = line({ ...row, number: 12, kind: 'suggestion' });
    expect(html).toContain('Drive links in place of the media proxy (1-500)');
    expect(html).toContain('href="/suggestions/12?lang=en"');
    expect(html).toContain('#12');
    expect(html).toContain('Drive links (relink bot)');
    expect(html).toContain('500 items');
    expect(html).toContain('Not yet checked');
    // The changes, their summary and Approve are on its own page.
    expect(html).not.toContain(row.description!);
    expect(html).not.toContain('What changes');
    expect(html).not.toContain('Approve');
    expect(html).not.toContain('class="diff"');
  });

  it('opens a Suggestion with no #number (an import) as its card in the queue', () => {
    expect(line(row)).toContain('href="/review?s=7&amp;lang=en"');
  });

  it('reads in Hebrew too', () => {
    const html = line({ ...row, number: 12 }, 'he');
    expect(html).toContain('href="/suggestions/12"');
    expect(html).toContain('500 פריטים');
    expect(html).toContain('בוט');
  });
});
