/**
 * The texts Sichos-Kodesh publishes for its seforim: each chapter's or
 * letter's text is an HTML file in its published archive (the R2 bucket
 * `sichos-kodesh-archive`, `objects/<sha256>`), and its works catalog says
 * which file each unit's edition is. Only texts its rights gate lets ship
 * are published. RebbeHub reads them at import time, one by one, through
 * its own API (`/v1/sichos-kodesh/texts/<sha256>`, services/api), which
 * binds that bucket; it keeps no copy in the repository.
 *
 * (Sichos-Kodesh's pack API can also hand a work's texts over as one pack,
 * but building a big pack, the Igros' 11,060 letters, runs past a Worker's
 * limits and fails more often than not.)
 */

export const REBBEHUB_API = 'https://api.rebbehub.org';

/**
 * The texts with these hashes, as HTML, fetched a few at a time. A text
 * the API is too busy for is tried again; one still missing stops the
 * import, since a page whose text was left out would lose its words.
 */
export async function fetchTexts(
  hashes: Iterable<string>,
  options: { base?: string; fetch?: typeof fetch; log?: (line: string) => void; concurrency?: number; pauseMs?: number } = {},
): Promise<Map<string, string>> {
  const base = (options.base ?? REBBEHUB_API).replace(/\/$/, '');
  const get = options.fetch ?? fetch;
  const queue = [...new Set(hashes)].filter((h) => /^[0-9a-f]{64}$/.test(h));
  const texts = new Map<string, string>();
  let done = 0;

  const one = async (sha: string) => {
    for (let attempt = 1; ; attempt++) {
      try {
        const response = await get(`${base}/v1/sichos-kodesh/texts/${sha}`);
        if (!response.ok) throw new Error(`answered ${response.status}`);
        texts.set(sha, await response.text());
        return;
      } catch (error) {
        const why = error instanceof Error ? error.message : String(error);
        if (attempt >= 6) throw new Error(`the text ${sha}: ${why}`);
        await new Promise((r) => setTimeout(r, (options.pauseMs ?? 2000) * attempt));
      }
    }
  };

  const workers = Array.from({ length: Math.min(options.concurrency ?? 8, queue.length) }, async () => {
    for (let sha = queue.shift(); sha; sha = queue.shift()) {
      await one(sha);
      if (++done % 1000 === 0) options.log?.(`${done} texts read`);
    }
  });
  await Promise.all(workers);
  options.log?.(`${texts.size} texts read`);
  return texts;
}
