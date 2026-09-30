import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every stylesheet closes each block it opens. One missing `}` (a merge
 * that dropped it) nests every rule after it inside the open block, so the
 * browser applies none of them: the synced player lost all its styling
 * that way. Comments are left out, since braces in them do not count.
 */
describe('stylesheets', () => {
  const dir = join(import.meta.dirname, '../app/styles');
  const files = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.css'));

  it.each(files)('%s closes every block it opens', (file) => {
    const css = readFileSync(join(dir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    let depth = 0;
    for (const [i, ch] of [...css].entries()) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      expect(depth, `a } with no { before it, at character ${i}`).toBeGreaterThanOrEqual(0);
    }
    expect(depth, 'blocks left open at the end').toBe(0);
  });
});
