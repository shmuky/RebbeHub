/**
 * People by name, and the conversations around the catalog (the plan,
 * section 7: suggestions reviewed like pull requests, reports kept like
 * issues, everyone told of what concerns them).
 *
 * In `auth`, with the person, since a rebuild of the catalog never touches it:
 *
 *   auth.person.username    a unique handle (`@mendy`), URL-safe, unique whatever its case;
 *                           existing people are given one here, from their name
 *   auth.username_redirect  handles a person used to have: they lead to them still, and
 *                           nobody else may take them
 *   auth.notification       the person's inbox: mentions, review requests, assignments,
 *                           and what happened in what they follow
 *   auth.number_thread()    gives each Suggestion and Report its number (below)
 *
 * In `public`, beside what they are about:
 *
 *   changeset.number, report.number  one sequence of numbers for Suggestions (all but
 *                           imports) and Reports together, as `#12`; existing ones are
 *                           numbered here in the order they were made
 *   report.title, report.private     a Report kept as an issue: a title of its own, and
 *                           whether only stewards and the set's keepers read it (every
 *                           Report made before this was sent as private, and stays so)
 *   label, report_label, report_assignee   a Report's labels and who took it on
 *   thread_event            what happened in a conversation besides its comments and
 *                           reviews: labels, assignments, closing and reopening, review
 *                           requests, renames, and where another one mentioned it
 *   review_request          who is asked to review a Suggestion
 *   thread_link             a Suggestion that says it fixes a Report ("Fixes #12"):
 *                           approving the one closes the other
 *   mention                 who was @mentioned where
 *   comment.anchor          a review comment on one field of one item in a Suggestion's
 *                           change, with the review it belongs to and whether it is resolved
 *
 * The numbers come from a trigger rather than a sequence of `public`, so a
 * catalog rebuilt elsewhere and copied in whole (scripts/import-catalog.sh)
 * can never hand out a number twice: each number is the highest so far and
 * one, taken under a lock. The trigger's function lives in `auth`, which the
 * copy leaves alone.
 */

/** Hebrew letters as Latin ones, for the handles given to people whose names are in Hebrew. */
const HEBREW: ReadonlyArray<[string, string]> = [
  ['שׁ', 'sh'], ['שׂ', 's'], ['ש', 'sh'], ['צ', 'tz'], ['ץ', 'tz'], ['ח', 'ch'], ['ך', 'ch'],
  ['א', 'a'], ['ב', 'b'], ['ג', 'g'], ['ד', 'd'], ['ה', 'h'], ['ו', 'o'], ['ז', 'z'], ['ט', 't'],
  ['י', 'y'], ['כ', 'k'], ['ל', 'l'], ['מ', 'm'], ['ם', 'm'], ['נ', 'n'], ['ן', 'n'], ['ס', 's'],
  ['ע', 'a'], ['פ', 'p'], ['ף', 'f'], ['ק', 'k'], ['ר', 'r'], ['ת', 't'],
];

/** Words that are pages or roles on the site, never a person's handle. */
const RESERVED = [
  'about', 'account', 'admin', 'api', 'auth', 'bot', 'calendar', 'compare', 'edit', 'embed', 'health', 'help', 'history',
  'inbox', 'issues', 'keeper', 'keepers', 'mirrors', 'missing', 'new', 'notifications', 'people', 'projects', 'read',
  'rebbehub', 'review', 'search', 'sets', 'settings', 'signin', 'signout', 'steward', 'stewards', 'suggestions', 'system',
  'takedown', 'talk', 'text', 'u', 'user', 'users',
];

const transliterated = HEBREW.reduce((sql, [from, to]) => `replace(${sql}, '${from}', '${to}')`, 'lower(display_name)');

export const up = /* sql */ `
-- Usernames -----------------------------------------------------------------

ALTER TABLE auth.person ADD COLUMN username TEXT;
-- when the person last chose it themselves (null: never; the handle they were given)
ALTER TABLE auth.person ADD COLUMN username_changed_at TIMESTAMPTZ;

-- Each person's name as a handle: Hebrew letters in Latin ones, anything else a hyphen.
-- A name that gives nothing usable, or a reserved word, becomes reader-<their number>;
-- a handle someone else already has is followed by the person's number, which is unique.
WITH base AS (
  SELECT id, created_at,
         trim(both '-' from left(trim(both '-' from regexp_replace(${transliterated}, '[^a-z0-9]+', '-', 'g')), 28)) AS slug
  FROM auth.person
), fixed AS (
  SELECT id, created_at,
         CASE WHEN length(slug) < 2 OR slug = ANY (ARRAY[${RESERVED.map((r) => `'${r}'`).join(', ')}]) OR slug LIKE 'reader-%'
              THEN 'reader-' || substr(id, 3) ELSE slug END AS handle
  FROM base
), numbered AS (
  SELECT id, handle, row_number() OVER (PARTITION BY handle ORDER BY created_at, id) AS n FROM fixed
)
UPDATE auth.person p SET username = CASE WHEN x.n = 1 THEN x.handle ELSE x.handle || '-' || substr(p.id, 3) END
FROM numbered x WHERE x.id = p.id;

-- Anyone made without one (by code that does not know of handles yet) is given reader-<number>.
CREATE FUNCTION auth.default_username() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.username IS NULL THEN
    NEW.username := 'reader-' || regexp_replace(lower(substr(NEW.id, 3)), '[^a-z0-9]', '', 'g');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER person_default_username BEFORE INSERT ON auth.person FOR EACH ROW EXECUTE FUNCTION auth.default_username();

ALTER TABLE auth.person ALTER COLUMN username SET NOT NULL;
ALTER TABLE auth.person ADD CONSTRAINT person_username_shape
  CHECK (username ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,37}[A-Za-z0-9]$' AND position('--' IN username) = 0);
CREATE UNIQUE INDEX person_username ON auth.person (lower(username));

CREATE TABLE auth.username_redirect (
  -- lower-case
  old_username TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES auth.person (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX username_redirect_person ON auth.username_redirect (person_id);

-- Numbers: #12 is a Suggestion or a Report -----------------------------------

ALTER TABLE changeset ADD COLUMN number BIGINT UNIQUE;
ALTER TABLE report ADD COLUMN number BIGINT UNIQUE;

CREATE TEMP TABLE thread_numbers ON COMMIT DROP AS
  SELECT kind, id, row_number() OVER (ORDER BY created_at, kind, id) AS n FROM (
    SELECT 'changeset' AS kind, id, created_at FROM changeset WHERE kind <> 'import'
    UNION ALL
    SELECT 'report', id, created_at FROM report
  ) t;
UPDATE changeset c SET number = x.n FROM thread_numbers x WHERE x.kind = 'changeset' AND x.id = c.id;
UPDATE report r SET number = x.n FROM thread_numbers x WHERE x.kind = 'report' AND x.id = r.id;

CREATE FUNCTION auth.number_thread() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Imports are the importers' own and are merged at once: they take no number.
  IF NEW.number IS NULL AND (TG_TABLE_NAME = 'report' OR to_jsonb(NEW)->>'kind' <> 'import') THEN
    PERFORM pg_advisory_xact_lock(7240016);
    NEW.number := greatest(
      (SELECT coalesce(max(number), 0) FROM public.changeset),
      (SELECT coalesce(max(number), 0) FROM public.report)
    ) + 1;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER changeset_number BEFORE INSERT ON changeset FOR EACH ROW EXECUTE FUNCTION auth.number_thread();
CREATE TRIGGER report_number BEFORE INSERT ON report FOR EACH ROW EXECUTE FUNCTION auth.number_thread();

-- Reports as issues -----------------------------------------------------------

ALTER TABLE report ADD COLUMN title TEXT CHECK (length(title) BETWEEN 1 AND 200);
ALTER TABLE report ADD COLUMN private BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE report ADD COLUMN updated_at TIMESTAMPTZ;
-- Every report made so far was sent under the promise that only stewards and keepers read it.
UPDATE report SET private = TRUE;
CREATE INDEX report_list ON report (status, private, created_at DESC);

CREATE TABLE label (
  name TEXT PRIMARY KEY CHECK (name ~ '^[a-z0-9][a-z0-9 -]{0,38}[a-z0-9]$'),
  description TEXT,
  -- a hex colour, drawn as a thin rule beside the label
  color TEXT NOT NULL DEFAULT '6b6557' CHECK (color ~ '^[0-9a-f]{6}$'),
  -- null: one RebbeHub starts with
  created_by TEXT REFERENCES account (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO label (name, description, color) VALUES
  ('good first issue', 'A good place to start helping', '2f6f4f'),
  ('help wanted', 'Anyone who knows is welcome to take this', '1f5f8b'),
  ('needs source', 'Waiting for a source that settles it', '8b6b1f'),
  ('question', 'Asks rather than reports', '5f4b8b'),
  ('duplicate', 'Already reported elsewhere', '6b6557'),
  ('machine', 'About what a machine made: OCR, transcription, sync', '8b3f3f');

CREATE TABLE report_label (
  report_id BIGINT NOT NULL REFERENCES report (id),
  label TEXT NOT NULL REFERENCES label (name) ON UPDATE CASCADE ON DELETE CASCADE,
  added_by TEXT NOT NULL REFERENCES account (id),
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (report_id, label)
);
CREATE INDEX report_label_label ON report_label (label);

CREATE TABLE report_assignee (
  report_id BIGINT NOT NULL REFERENCES report (id),
  account_id TEXT NOT NULL REFERENCES account (id),
  assigned_by TEXT NOT NULL REFERENCES account (id),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (report_id, account_id)
);
CREATE INDEX report_assignee_account ON report_assignee (account_id);

-- Conversations ---------------------------------------------------------------

CREATE TABLE thread_event (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  thread_kind TEXT NOT NULL CHECK (thread_kind IN ('changeset', 'report')),
  thread_id BIGINT NOT NULL,
  actor TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'submitted', 'sent_back', 'merged', 'withdrawn', 'reverted', 'closed', 'reopened', 'renamed', 'edited',
    'labeled', 'unlabeled', 'assigned', 'unassigned', 'review_requested', 'review_request_removed',
    'referenced', 'linked', 'made_private', 'made_public'
  )),
  detail JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX thread_event_thread ON thread_event (thread_kind, thread_id, created_at);
CREATE INDEX thread_event_actor ON thread_event (actor, created_at DESC);

CREATE TABLE review_request (
  changeset_id BIGINT NOT NULL REFERENCES changeset (id),
  reviewer TEXT NOT NULL REFERENCES account (id),
  requested_by TEXT NOT NULL REFERENCES account (id),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (changeset_id, reviewer)
);
CREATE INDEX review_request_reviewer ON review_request (reviewer);

CREATE TABLE thread_link (
  changeset_id BIGINT NOT NULL REFERENCES changeset (id),
  report_id BIGINT NOT NULL REFERENCES report (id),
  -- written in the suggestion's description: approving it closes the report
  closes BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (changeset_id, report_id)
);
CREATE INDEX thread_link_report ON thread_link (report_id);

CREATE TABLE mention (
  source_kind TEXT NOT NULL CHECK (source_kind IN ('changeset', 'report', 'comment', 'review')),
  source_id BIGINT NOT NULL,
  account_id TEXT NOT NULL REFERENCES account (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source_kind, source_id, account_id)
);
CREATE INDEX mention_account ON mention (account_id, created_at DESC);

ALTER TABLE comment ADD COLUMN anchor JSONB;
ALTER TABLE comment ADD COLUMN review_id BIGINT REFERENCES review (id);
ALTER TABLE comment ADD COLUMN resolved_at TIMESTAMPTZ;
ALTER TABLE comment ADD COLUMN resolved_by TEXT REFERENCES account (id);
ALTER TABLE comment ADD COLUMN edited_at TIMESTAMPTZ;
CREATE INDEX comment_author ON comment (author, created_at DESC);
CREATE INDEX review_reviewer ON review (reviewer, created_at DESC);

-- People follow the conversations they take part in, reports as well as suggestions.
ALTER TABLE follow DROP CONSTRAINT follow_target_kind_check;
ALTER TABLE follow ADD CONSTRAINT follow_target_kind_check CHECK (target_kind IN ('entity', 'set', 'project', 'changeset', 'report'));

-- The inbox -------------------------------------------------------------------

CREATE TABLE auth.notification (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES auth.person (id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (reason IN ('mention', 'review_requested', 'assigned', 'author', 'comment', 'review', 'state', 'followed')),
  -- what it is about: a suggestion or report (a thread), or a page's talk page
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('changeset', 'report', 'entity', 'project')),
  subject_id TEXT NOT NULL,
  actor TEXT,
  -- how many times this happened while it was unread
  count INTEGER NOT NULL DEFAULT 1,
  detail JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ,
  -- told by email (when the person has email updates on)
  emailed_at TIMESTAMPTZ
);
CREATE INDEX notification_inbox ON auth.notification (person_id, updated_at DESC);
CREATE INDEX notification_unread ON auth.notification (person_id, subject_kind, subject_id, reason) WHERE read_at IS NULL;
CREATE INDEX notification_unmailed ON auth.notification (person_id) WHERE emailed_at IS NULL AND read_at IS NULL;
`;
