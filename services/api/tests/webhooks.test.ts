import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { createWebhook, deliverWebhooks, listWebhooks } from '@rebbehub/core';
import { add, freshCatalog, yudShvat } from '../../../packages/core/tests/helpers.js';

describe('webhooks', () => {
  it('posts every merge after it was made, signed, in order, once taken', async () => {
    const { catalog, set } = await freshCatalog();
    await expect(createWebhook(catalog, 'chaim', 'http://example.org/hook')).rejects.toThrow(/https/);
    await expect(createWebhook(catalog, 'chaim', 'https://127.0.0.1/hook')).rejects.toThrow(/public/);
    const hook = await createWebhook(catalog, 'chaim', 'https://example.org/hook');
    expect(hook.secret).toMatch(/^[0-9a-f]{48}$/);

    const posts: Array<{ body: string; signature: string }> = [];
    let answer = 500;
    const fetchStub = (async (_url: string, init: RequestInit) => {
      posts.push({ body: String(init.body), signature: new Headers(init.headers).get('X-RebbeHub-Signature')! });
      return new Response('', { status: answer });
    }) as typeof fetch;

    expect(await deliverWebhooks(catalog, { fetch: fetchStub })).toEqual([]); // nothing merged since it was made
    await add(catalog, 'mendy', 'keeper', 'event', yudShvat(set));

    // Refused: kept, and tried again next time.
    expect((await deliverWebhooks(catalog, { fetch: fetchStub }))[0]).toMatchObject({ delivered: 0, error: 'answered 500' });
    answer = 200;
    expect((await deliverWebhooks(catalog, { fetch: fetchStub }))[0]).toMatchObject({ delivered: 1 });
    const last = posts.at(-1)!;
    expect(JSON.parse(last.body).commits[0]).toMatchObject({ message: 'Add event', changes: [expect.objectContaining({ type: 'event' })] });
    expect(last.signature).toBe(`sha256=${createHmac('sha256', hook.secret).update(last.body).digest('hex')}`);
    expect(await deliverWebhooks(catalog, { fetch: fetchStub })).toEqual([]);
    expect((await listWebhooks(catalog, 'chaim'))[0]).toMatchObject({ failures: 0, active: true });
  });
});
