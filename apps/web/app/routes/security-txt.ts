import type { Route } from './+types/security-txt';
import { siteOf } from '../lib/context.server.js';

/**
 * Where to report a security problem (RFC 9116), for those who look here
 * first: the same private reporting SECURITY.md names. It says it expires
 * half a year after it was made, and is made again each day.
 */
export function securityTxt(siteUrl: string, now = new Date()): string {
  const base = siteUrl.replace(/\/$/, '');
  const expires = new Date(now.getTime() + 182 * 86_400_000);
  expires.setUTCHours(0, 0, 0, 0);
  return [
    'Contact: https://github.com/shmuky/RebbeHub/security/advisories/new',
    `Expires: ${expires.toISOString()}`,
    'Policy: https://github.com/shmuky/RebbeHub/blob/main/SECURITY.md',
    'Preferred-Languages: en, he',
    `Canonical: ${base}/.well-known/security.txt`,
    '',
  ].join('\n');
}

export function loader({ context }: Route.LoaderArgs) {
  return new Response(securityTxt(siteOf(context).siteUrl), {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=86400' },
  });
}
