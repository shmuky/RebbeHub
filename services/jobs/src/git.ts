import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Runs git in `dir`. */
export async function git(dir: string, args: string[], env: Record<string, string> = {}): Promise<string> {
  const { stdout } = await run('git', args, { cwd: dir, env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

/**
 * Records the working tree as one commit, authored as the RebbeHub account
 * whose suggestion it was, dated when it was merged. Nothing to commit is
 * not an error (a commit that only touched withheld words, say).
 */
export async function commitAll(dir: string, commit: { message: string; author: string; mergedBy: string; at: string; seq: number }): Promise<boolean> {
  await git(dir, ['add', '-A']);
  const status = await git(dir, ['status', '--porcelain']);
  if (status.trim() === '') return false;
  const date = new Date(commit.at).toISOString();
  await git(dir, ['commit', '-q', '-m', `${commit.message}\n\nRebbeHub-Commit: ${commit.seq}\nApproved-By: ${commit.mergedBy}`], {
    GIT_AUTHOR_NAME: commit.author,
    GIT_AUTHOR_EMAIL: `${commit.author.replace(/[^A-Za-z0-9._-]/g, '-')}@users.rebbehub.org`,
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_NAME: 'RebbeHub',
    GIT_COMMITTER_EMAIL: 'mirror@rebbehub.org',
    GIT_COMMITTER_DATE: date,
  });
  return true;
}
