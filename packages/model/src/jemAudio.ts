/**
 * Where JEM's recordings are heard: JEM's own CDN, the files ashreinu.app
 * plays and lets people download (`https://dtgj2yu3gmlic.cloudfront.net/JEMSK0001.mp3`).
 * A recording's `url` is that address, so what is stored says where the
 * file really is. Imports before this stored the address of Sichos-Kodesh's
 * media proxy in its place (`https://sichos-kodesh-media-proxy.shmuky.workers.dev/jem-audio/JEMSK0001.mp3`);
 * `rebbehub relink-jem` (services/jobs) suggests Ashreinu's address instead,
 * and until those are approved both are read as the same JEM file.
 */

/** JEM's CDN, behind ashreinu.app. */
export const JEM_AUDIO_CDN = 'https://dtgj2yu3gmlic.cloudfront.net';

/** The address older imports stored: Sichos-Kodesh's media proxy, `/jem-audio/<file>`. */
const PROXY_JEM_AUDIO = /^https:\/\/sichos-kodesh-media-proxy\.shmuky\.workers\.dev\/jem-audio\/([^/?#]+)$/;
const CDN_JEM_AUDIO = /^https:\/\/dtgj2yu3gmlic\.cloudfront\.net\/([^/?#]+)$/;

/** A JEM recording's address on Ashreinu's CDN, from its file name (`JEMSK0001.mp3`). */
export const jemAudioUrl = (file: string): string => `${JEM_AUDIO_CDN}/${encodeURIComponent(file)}`;

/** The JEM file (`JEMSK0001.mp3`) an address plays, on Ashreinu's CDN or the old media proxy; null for any other address. */
export function jemAudioFile(url: string | null | undefined): string | null {
  const m = url ? (CDN_JEM_AUDIO.exec(url) ?? PROXY_JEM_AUDIO.exec(url)) : null;
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]!);
  } catch {
    return null;
  }
}

/** Ashreinu's address for an old media proxy address of a JEM file; null for any other address. */
export function relinkedJemAudio(url: string): string | null {
  const m = PROXY_JEM_AUDIO.exec(url);
  const file = m ? jemAudioFile(url) : null;
  return file ? jemAudioUrl(file) : null;
}
