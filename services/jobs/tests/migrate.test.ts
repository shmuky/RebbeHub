import { describe, expect, it } from 'vitest';
import { migrationSkipReason } from '../src/commands.js';

describe('migrations in Cloudflare builds', () => {
  it('run for builds of main, and locally', () => {
    expect(migrationSkipReason({ WORKERS_CI: '1', WORKERS_CI_BRANCH: 'main' })).toBeNull();
    expect(migrationSkipReason({})).toBeNull();
  });

  it('never run for preview builds of other branches', () => {
    expect(migrationSkipReason({ WORKERS_CI: '1', WORKERS_CI_BRANCH: 'feat/new-schema' })).toMatch(/preview build of branch feat\/new-schema/);
  });
});
