import { LABELS } from './suggestions.js';
import type { IssueLabel, IssueTemplate } from './threads.js';
import { parseTokens, tokenText, withToken, type ParsedTokens, type TokenKey } from './tokens.js';

/**
 * The filters of the reports list, written into its search line:
 * `מצב:פתוח תווית:סריקה אחראי:@me אוסף:"אגרות קודש"`. The labels, kinds
 * and sets are the catalog's own, each with how many open reports it has;
 * people are handles (`@me` is whoever reads). The older addresses
 * (`?label=scan&state=closed`) still work: they are read into the line.
 */

export interface IssueQuery {
  state: 'open' | 'closed';
  label: string[];
  type: string | null;
  set: string | null;
  assignee: string | null;
  author: string | null;
  sort: 'new' | 'old' | 'comments';
  text: string;
}

export function issueKeys(labels: Array<IssueLabel & { open?: number }>, templates: IssueTemplate[], sets: Array<{ id: string; he: string; en: string }>): TokenKey[] {
  return [
    {
      key: 'state',
      he: 'מצב',
      en: 'state',
      values: [
        { value: 'open', he: 'פתוח', en: 'open' },
        { value: 'closed', he: 'טופל', en: 'closed' },
      ],
    },
    { key: 'label', he: 'תווית', en: 'label', values: labels.map((l) => ({ value: l.name, he: LABELS[l.name]?.he ?? l.name, en: l.name, color: `#${l.color.replace('#', '')}`, count: l.open })) },
    { key: 'type', he: 'סוג', en: 'type', values: templates.map((t) => ({ value: t.type, he: t.label.he, en: t.label.en })) },
    { key: 'set', he: 'אוסף', en: 'set', values: sets.map((s) => ({ value: s.id, he: s.he, en: s.en })) },
    { key: 'assignee', he: 'אחראי', en: 'assignee', hint: { he: 'שם משתמש, @me, או none', en: 'a username, @me, or none' } },
    { key: 'author', he: 'מחבר', en: 'author', hint: { he: 'שם משתמש או @me', en: 'a username or @me' } },
    {
      key: 'sort',
      he: 'מיון',
      en: 'sort',
      values: [
        { value: 'new', he: 'החדשים', en: 'newest' },
        { value: 'old', he: 'הישנים', en: 'oldest' },
        { value: 'comments', he: 'הכי מדוברים', en: 'most-commented' },
      ],
    },
  ];
}

const PARAMS = ['state', 'label', 'type', 'set', 'assignee', 'author', 'sort'] as const;

/** The line a page opens with: `q` as written, and any older `?label=` filters put into it. */
export function lineOf(params: URLSearchParams, keys: TokenKey[], lang: 'he' | 'en'): string {
  let line = params.get('q') ?? '';
  for (const name of PARAMS) {
    const value = params.get(name);
    if (value && !parseTokens(line, keys).filters[name]) line = withToken(line, keys, name, value, lang);
  }
  if (!parseTokens(line, keys).filters.state) line = `${tokenText(keys[0]!, 'open', lang)} ${line}`.trim();
  return line;
}

export function queryOf(line: string, keys: TokenKey[]): IssueQuery & { parsed: ParsedTokens } {
  const parsed = parseTokens(line, keys);
  const one = (k: string) => parsed.filters[k]?.[parsed.filters[k]!.length - 1] ?? null;
  const sort = one('sort');
  return {
    state: one('state') === 'closed' ? 'closed' : 'open',
    label: parsed.filters.label ?? [],
    type: one('type'),
    set: one('set'),
    assignee: one('assignee')?.replace(/^@(?!me$)/, '') ?? null,
    author: one('author')?.replace(/^@(?!me$)/, '') ?? null,
    sort: sort === 'old' || sort === 'comments' ? sort : 'new',
    text: parsed.text,
    parsed,
  };
}

/** The API's own words for a query, `@me` as the reader's handle (or left out for a reader with none). */
export function apiParams(q: IssueQuery, me: string | null): Record<string, string> {
  const out: Record<string, string> = { state: q.state };
  if (q.label.length) out.label = q.label.join(',');
  if (q.type) out.type = q.type;
  if (q.set) out.set = q.set;
  const person = (v: string | null) => (v === '@me' ? me : v);
  if (person(q.assignee)) out.assignee = person(q.assignee)!;
  if (person(q.author)) out.author = person(q.author)!;
  if (q.text) out.q = q.text;
  return out;
}

/** A kind's questions in one line, as its choice's hint: "מה כתוב · איפה (עמוד, שורה או פסקה)". */
export function questionsOf(template: string): string {
  return template
    .split('\n')
    .map((l) => l.replace(/^[#>*\-\s]+/, '').replace(/[:：]\s*$/, '').trim())
    .filter(Boolean)
    .join(' · ');
}
