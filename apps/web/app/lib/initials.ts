/**
 * A person as their initials, never a photo: "ש. טראקסלער" is ש״ט, "Mendy
 * Goldberg" MG. The tint is fixed by the person's id, so the same person
 * looks the same on every page.
 */
export function initials(name: string): string {
  const words = name
    .replace(/[״"'׳.,()]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !/^(ר|רב|הרב|r|rabbi|mr|mrs|dr)$/i.test(w));
  if (words.length === 0) return '?';
  const letters = (words.length === 1 ? [words[0]!.slice(0, 2)] : [words[0]!, words[words.length - 1]!]).map((w) => [...w][0]!).join('');
  const hebrew = /[֐-׿]/.test(letters);
  if (hebrew) {
    const chars = [...(words.length === 1 ? words[0]!.slice(0, 2) : letters)];
    return chars.length > 1 ? `${chars[0]}״${chars[1]}` : chars[0]!;
  }
  return letters.toUpperCase();
}

export function tintOf(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return Math.abs(h) % 6;
}
