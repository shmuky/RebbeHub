#!/usr/bin/env node
import { parseArgs } from 'node:util';
import {
  accountCommand,
  dumpCommand,
  editionCommand,
  importCommand,
  keygenCommand,
  migrateCommand,
  mirrorCommand,
  readingCopiesMakeCommand,
  readingCopiesPublishCommand,
  readingCopiesRegisterCommand,
  rebuildableCommand,
  schemaCheckCommand,
  type Context,
} from '../commands.js';

const HELP = `rebbehub - RebbeHub's command line

  rebbehub migrate                              create or update the database
  rebbehub schema-check                         check the built-in schemas
  rebbehub rebuildable [--guard]                prints rebuildable when importers made everything;
                                                --guard prints SQL that fails otherwise
  rebbehub account --id <id> --name <name> [--steward] [--bot]
  rebbehub import sichos-kodesh-works|sichos-kodesh-occasions --from <Sichos-Kodesh checkout>
                  [--approve-as <steward>] [--dry-run] [--chunk <n>]
  rebbehub mirror --dir <folder> [--git] [--full] [--limit <n>]
  rebbehub edition --by <steward> [--tag 2026.40] [--notes <text>]
  rebbehub dump --tag <tag> --out <folder> [--key <key.json>]
  rebbehub keygen --out <key.json>
  rebbehub reading-copies make --from <Sichos-Kodesh checkout> --work <folder> [--shard 0/4] [--limit <n>]
                  [--archive <objects.json>] [--source-bucket sichos-kodesh-archive] [--bucket rebbehub-public]
  rebbehub reading-copies publish --from <Sichos-Kodesh checkout> --work <folder> [--bucket rebbehub-public]
                                                the Sichos Kodesh scans' reading copies, into R2
                                                (CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN)
  rebbehub reading-copies register [--manifest <url or file>]
                                                records the published ones in the catalog

  --database <url or folder>   Postgres URL, or a PGlite folder
                               (default: $DATABASE_URL, else .data/pglite)
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    database: { type: 'string' },
    id: { type: 'string' },
    name: { type: 'string' },
    steward: { type: 'boolean' },
    bot: { type: 'boolean' },
    from: { type: 'string' },
    'approve-as': { type: 'string' },
    'dry-run': { type: 'boolean' },
    chunk: { type: 'string' },
    dir: { type: 'string' },
    git: { type: 'boolean' },
    full: { type: 'boolean' },
    limit: { type: 'string' },
    by: { type: 'string' },
    tag: { type: 'string' },
    notes: { type: 'string' },
    out: { type: 'string' },
    key: { type: 'string' },
    guard: { type: 'boolean' },
    work: { type: 'string' },
    shard: { type: 'string' },
    archive: { type: 'string' },
    'source-bucket': { type: 'string' },
    bucket: { type: 'string' },
    manifest: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});

const need = (value: string | undefined, flag: string): string => {
  if (!value) throw new Error(`--${flag} is needed`);
  return value;
};
const number = (value: string | undefined): number | undefined => (value === undefined ? undefined : Number(value));

const ctx: Context = { log: (line) => console.log(line), database: values.database };
const [command, ...rest] = positionals;

try {
  switch (values.help ? 'help' : command) {
    case 'migrate':
      await migrateCommand(ctx);
      break;
    case 'rebuildable':
      await rebuildableCommand(ctx, { guard: values.guard });
      break;
    case 'schema-check':
      await schemaCheckCommand(ctx);
      break;
    case 'account':
      await accountCommand(ctx, { id: need(values.id, 'id'), name: need(values.name, 'name'), steward: values.steward, bot: values.bot });
      break;
    case 'import':
      await importCommand(ctx, { source: need(rest[0], 'source'), from: need(values.from, 'from'), approveAs: values['approve-as'], dryRun: values['dry-run'], chunkSize: number(values.chunk) });
      break;
    case 'mirror':
      await mirrorCommand(ctx, { dir: need(values.dir, 'dir'), git: values.git, full: values.full, limit: number(values.limit) });
      break;
    case 'edition':
      await editionCommand(ctx, { by: need(values.by, 'by'), tag: values.tag, notes: values.notes });
      break;
    case 'dump':
      await dumpCommand(ctx, { tag: need(values.tag, 'tag'), out: need(values.out, 'out'), keyFile: values.key });
      break;
    case 'keygen':
      await keygenCommand(ctx, { out: need(values.out, 'out') });
      break;
    case 'reading-copies':
      if (rest[0] === 'make') {
        await readingCopiesMakeCommand(ctx, {
          from: need(values.from, 'from'),
          work: need(values.work, 'work'),
          shard: values.shard,
          limit: number(values.limit),
          archive: values.archive,
          sourceBucket: values['source-bucket'],
          bucket: values.bucket,
        });
      } else if (rest[0] === 'publish') {
        await readingCopiesPublishCommand(ctx, { from: need(values.from, 'from'), work: need(values.work, 'work'), bucket: values.bucket });
      } else if (rest[0] === 'register') {
        await readingCopiesRegisterCommand(ctx, { manifest: values.manifest });
      } else {
        throw new Error('reading-copies make|publish|register');
      }
      break;
    default:
      console.log(HELP);
      if (command && command !== 'help') process.exitCode = 1;
  }
} catch (error) {
  console.error(`rebbehub: ${(error as Error).message}`);
  process.exitCode = 1;
}
