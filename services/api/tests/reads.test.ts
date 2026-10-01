import { describe, expect, it } from 'vitest';
import { answeredHere, readerFor } from '../src/reads.js';

const API = 'https://api.rebbehub.org';

describe("the site's own reads (reads.ts)", () => {
  it('answers a read of /v1 as nobody in the site\'s Worker, and sends on what is signed in, changes, and what only the API\'s Worker has', () => {
    expect(answeredHere(`${API}/v1/entities?type=work&limit=500`, undefined, API, true)).toBe(true);
    expect(answeredHere(`${API}/v1/events?within=5742&brief=1`, { method: 'GET', headers: { 'Cache-Control': 'no-cache' } }, API, true)).toBe(true);
    expect(answeredHere(`${API}/v1/search?q=שבת`, { method: 'HEAD' }, API, true)).toBe(true);
    expect(answeredHere(`${API}/v1/search/moments?q=שבת`, undefined, API, true)).toBe(true);
    // A trailing slash on the API's address is the same address.
    expect(answeredHere(`${API}/v1/sets`, undefined, `${API}/`, true)).toBe(true);
    // Signed in: sessions and passkeys live in the API's Worker.
    expect(answeredHere(`${API}/v1/me`, { headers: { cookie: 'rh_session=abc' } }, API, true)).toBe(false);
    expect(answeredHere(`${API}/v1/me`, { headers: { authorization: 'Bearer rh_token' } }, API, true)).toBe(false);
    // A change is never a read.
    expect(answeredHere(`${API}/v1/suggestions`, { method: 'POST', body: '{}' }, API, true)).toBe(false);
    expect(answeredHere(`${API}/v1/suggestions/3`, { method: 'delete' }, API, true)).toBe(false);
    // What only the API's Worker answers: the apps' catalog, Drive files, search by meaning.
    expect(answeredHere(`${API}/v1/app/v1/catalog/manifest.json`, undefined, API, true)).toBe(false);
    expect(answeredHere(`${API}/v1/drive/1abc`, undefined, API, true)).toBe(false);
    expect(answeredHere(`${API}/v1/search/similar?q=שבת`, undefined, API, true)).toBe(false);
    // Sign-in asked as nobody: only the API's Worker knows whether Google sign-in is on (the site's /signin hid it without).
    expect(answeredHere(`${API}/v1/auth/me`, undefined, API, true)).toBe(false);
    expect(answeredHere(`${API}/v1/auth/google/start`, undefined, API, true)).toBe(false);
    // The mirrors' git addresses and keys are the API Worker's settings.
    expect(answeredHere(`${API}/v1/mirrors`, undefined, API, true)).toBe(false);
    // A name that only starts like one of those is still answered here.
    expect(answeredHere(`${API}/v1/authors`, undefined, API, true)).toBe(true);
    // Not the API at all, or not /v1.
    expect(answeredHere('https://rebbehub.org/v1/sets', undefined, API, true)).toBe(false);
    expect(answeredHere(`${API}/openapi.json`, undefined, API, true)).toBe(false);
    expect(answeredHere(`${API}/objects/abc`, undefined, API, true)).toBe(false);
  });

  it('answers the status report and texts only with the public bucket', () => {
    expect(answeredHere(`${API}/v1/status`, undefined, API, true)).toBe(true);
    expect(answeredHere(`${API}/v1/status`, undefined, API, false)).toBe(false);
    expect(answeredHere(`${API}/v1/texts/${'a'.repeat(64)}`, undefined, API, false)).toBe(false);
    expect(answeredHere(`${API}/v1/statuses`, undefined, API, false)).toBe(true);
  });

  it('has no reader without a database: every read goes through the service binding', () => {
    expect(readerFor({ API_URL: API }, () => undefined)).toBeNull();
  });
});
