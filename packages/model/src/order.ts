/**
 * Fractional sort keys: an item's place among its siblings as a string,
 * so a unit or a segment is inserted between two others by giving it a key
 * between theirs, without renumbering anything (and without a revision of
 * every later sibling). Keys are base 62 and compare by plain code-unit
 * order, as Postgres does under `COLLATE "C"`.
 */

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ZERO = DIGITS[0]!;

export function isOrderKey(key: string): boolean {
  return /^[0-9A-Za-z]+$/.test(key) && !key.endsWith(ZERO);
}

function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    let n = 0;
    while ((a[n] ?? ZERO) === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const digitA = a ? DIGITS.indexOf(a[0]!) : 0;
  const digitB = b !== null ? DIGITS.indexOf(b[0]!) : DIGITS.length;
  if (digitB - digitA > 1) return DIGITS[Math.round((digitA + digitB) / 2)]!;
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS[digitA]! + midpoint(a.slice(1), null);
}

/** A key strictly between `before` and `after`; either may be null for the start or end. */
export function orderBetween(before: string | null, after: string | null): string {
  if (before !== null && !isOrderKey(before)) throw new RangeError(`not an order key: ${before}`);
  if (after !== null && !isOrderKey(after)) throw new RangeError(`not an order key: ${after}`);
  if (before !== null && after !== null && before >= after) throw new RangeError(`${before} is not before ${after}`);
  return midpoint(before ?? '', after);
}

/** `count` evenly spaced keys in order, for importing a whole list at once. */
export function orderKeys(count: number): string[] {
  if (count <= 0) return [];
  let width = 1;
  while (DIGITS.length ** width < (count + 1) * 4) width++;
  const space = BigInt(DIGITS.length) ** BigInt(width);
  const keys: string[] = [];
  for (let i = 1; i <= count; i++) {
    let value = (space * BigInt(i)) / BigInt(count + 1);
    let key = '';
    for (let d = 0; d < width; d++) {
      key = DIGITS[Number(value % 62n)]! + key;
      value /= 62n;
    }
    keys.push(key.replace(/0+$/, ''));
  }
  return keys;
}
