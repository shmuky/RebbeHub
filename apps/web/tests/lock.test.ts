import { describe, expect, it } from 'vitest';
import { keyOf, lockOf } from '@rebbehub/api';
import { door } from '../server/lock.js';

/** The site's door while RebbeHub is private (server/lock.ts). */

const PASSWORD = 'abcde-fghjk-mnpqr';
const env = async () => ({ SITE_URL: 'https://rebbehub.org', LOCK_KEY_HASH: (await lockOf({ LOCK_PASSWORD: PASSWORD }))! });
const none = () => {};

describe('the door', () => {
  it('answers the lock page to anyone without the key, and keeps nothing', async () => {
    const shut = (await door(new Request('https://rebbehub.org/likkutei-sichos?part=30'), await env(), none))!;
    expect(shut.status).toBe(401);
    expect(shut.headers.get('Cache-Control')).toBe('no-store');
    expect(shut.headers.get('x-rebbehub-locked')).toBe('1');
    expect(await shut.text()).toContain('value="/likkutei-sichos?part=30"');
  });

  it('gives the right password a cookie for the site and the API, and sends it on', async () => {
    const form = new URLSearchParams({ password: PASSWORD, next: '/daily' });
    const opened = (await door(new Request('https://rebbehub.org/_/lock', { method: 'POST', body: form }), await env(), none))!;
    expect(opened.status).toBe(303);
    expect(opened.headers.get('Location')).toBe('/daily');
    const cookie = opened.headers.get('Set-Cookie')!;
    expect(cookie).toContain(`__Secure-rh_lock=${await keyOf(PASSWORD)}`);
    expect(cookie).toContain('Domain=rebbehub.org');
    expect(cookie).not.toContain(PASSWORD);
  });

  it('refuses a wrong password and never sends anyone off the site', async () => {
    const form = new URLSearchParams({ password: 'wrong', next: '//evil.example' });
    const refused = (await door(new Request('https://rebbehub.org/_/lock', { method: 'POST', body: form }), await env(), none))!;
    expect(refused.status).toBe(401);
    const html = await refused.text();
    expect(html).toContain('not right');
    expect(html).toContain('name="next" value="/"');
  });

  it('lets the key in and hands it on for the API', async () => {
    const key = await keyOf(PASSWORD);
    let handed: string | undefined;
    const through = await door(new Request('https://rebbehub.org/daily', { headers: { cookie: `__Secure-rh_lock=${key}` } }), await env(), (k) => (handed = k));
    expect(through).toBeNull();
    expect(handed).toBe(key);
  });

  it("answers an installed app's service worker with one that forgets what it kept", async () => {
    const sw = (await door(new Request('https://rebbehub.org/sw.js'), await env(), none))!;
    expect(sw.status).toBe(200);
    expect(await sw.text()).toContain('caches.delete');
  });

  it('is open when no lock is set', async () => {
    expect(await door(new Request('https://rebbehub.org/'), { SITE_URL: 'https://rebbehub.org' }, none)).toBeNull();
  });
});

describe('recordings through the site', () => {
  it("plays the media proxy's recordings through /_/media, and leaves other addresses alone", async () => {
    const { playable } = await import('../app/lib/media.js');
    expect(playable('https://sichos-kodesh-media-proxy.shmuky.workers.dev/jem-audio/a%20b.mp3')).toBe('/_/media/jem-audio/a%20b.mp3');
    expect(playable('https://api.rebbehub.org/objects/abc')).toBe('https://api.rebbehub.org/objects/abc');
    expect(playable('not a url')).toBe('not a url');
  });
});
