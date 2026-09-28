// Taken from Sichos-Kodesh (apps/web/src/polyfills.ts).
/**
 * `Map.prototype.getOrInsertComputed` (and `.getOrInsert`) are only
 * recently standardized (TC39 "Map/Set upsert") - current Safari and
 * many Android WebViews still don't have them. pdfjs-dist calls
 * `getOrInsertComputed` internally with no fallback, so on a browser
 * without it `page.render()` throws mid-render and the PDF viewer shows
 * a blank canvas instead of the page. The spec's semantics are simple
 * enough to polyfill exactly, so this must run before anything touches
 * pdf.js.
 */
if (!Map.prototype.getOrInsertComputed) {
  Map.prototype.getOrInsertComputed = function <K, V>(this: Map<K, V>, key: K, callbackfn: (key: K) => V): V {
    if (!this.has(key)) this.set(key, callbackfn(key));
    return this.get(key) as V;
  };
}

if (!Map.prototype.getOrInsert) {
  Map.prototype.getOrInsert = function <K, V>(this: Map<K, V>, key: K, value: V): V {
    if (!this.has(key)) this.set(key, value);
    return this.get(key) as V;
  };
}

declare global {
  interface Map<K, V> {
    getOrInsertComputed(key: K, callbackfn: (key: K) => V): V;
    getOrInsert(key: K, value: V): V;
  }
}

export {};
