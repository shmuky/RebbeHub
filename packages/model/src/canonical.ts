/**
 * Deterministic JSON: object keys sorted, no whitespace, arrays in their
 * given order, `undefined` members dropped. Two records that mean the same
 * thing serialise to the same bytes, so their hashes and signatures agree.
 * The same contract as Sichos-Kodesh's pack-format `canonicalJson`, so a
 * dump signed here verifies with its tools.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (value === undefined) throw new TypeError('undefined is not representable in canonical JSON');
    if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('non-finite numbers are not representable in canonical JSON');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += HEX[byte];
  return out;
}

/** SHA-256 of a string or bytes, as lower-case hex. WebCrypto, so it runs in Node, Workers and browsers alike. */
export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return toHex(new Uint8Array(digest));
}

/** The hash a revision is stored under: SHA-256 of the canonical JSON of its data. */
export function contentHash(value: unknown): Promise<string> {
  return sha256Hex(canonicalJson(value));
}
