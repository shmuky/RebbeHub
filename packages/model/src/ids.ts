import { sha256Hex } from './canonical.js';

/**
 * Permanent ids. Every entity gets an opaque id that never changes and is
 * never reused - `rh-7k2m9q4d` - plus a readable path that may change with
 * a redirect (paths.ts). Citations and links store the id.
 *
 * The letters are Crockford base32 in lower case: digits and letters
 * without i, l, o and u, so an id read aloud or copied by hand survives.
 * Reading is forgiving the Crockford way (upper case, I/L as 1, O as 0,
 * hyphens ignored after the prefix).
 */

export type EntityId = `rh-${string}`;

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const ID_LENGTH = 8; // 40 bits: about a trillion ids, room for every segment of every text.
const ID_PATTERN = /^rh-[0-9a-hjkmnp-tv-z]{6,16}$/;

function encode(bytes: Uint8Array, length: number): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < length) {
      out += ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
    buffer &= (1 << bits) - 1;
    if (out.length === length) break;
  }
  return out;
}

/** A fresh random id. */
export function newId(): EntityId {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  return `rh-${encode(bytes, ID_LENGTH)}`;
}

/**
 * The same id every time for the same thing from the same source, so an
 * importer run twice proposes changes to the entities it made the first
 * time instead of duplicating them: `idFromSeed('mafteiach-occasion', '1234')`.
 */
export async function idFromSeed(namespace: string, key: string): Promise<EntityId> {
  const hex = await sha256Hex(`rebbehub-id\u0000${namespace}\u0000${key}`);
  const bytes = new Uint8Array(5);
  for (let i = 0; i < 5; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return `rh-${encode(bytes, ID_LENGTH)}`;
}

export function isEntityId(value: unknown): value is EntityId {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

/** An id as someone typed it, made canonical: `RH-7K2M-9Q4D` → `rh-7k2m9q4d`, `rh-OI...` → `rh-01...`. Null when it cannot be one. */
export function readId(text: string): EntityId | null {
  const match = /^\s*rh-?(.+?)\s*$/i.exec(text);
  if (!match) return null;
  const body = match[1]!
    .toLowerCase()
    .replace(/-/g, '')
    .replace(/[il]/g, '1')
    .replace(/o/g, '0');
  const id = `rh-${body}`;
  return isEntityId(id) ? id : null;
}
