import { describe, expect, it } from 'vitest';
import { jemAudioFile, jemAudioUrl, relinkedJemAudio } from '../src/index.js';

describe("JEM's audio addresses", () => {
  it("are Ashreinu's files, and the old proxy's are read as the same file", () => {
    expect(jemAudioUrl('JEMSK 2957.mp3')).toBe('https://dtgj2yu3gmlic.cloudfront.net/JEMSK%202957.mp3');
    expect(jemAudioFile('https://dtgj2yu3gmlic.cloudfront.net/JEMSK%202957.mp3')).toBe('JEMSK 2957.mp3');
    expect(jemAudioFile('https://sichos-kodesh-media-proxy.shmuky.workers.dev/jem-audio/AR0016657.mp3')).toBe('AR0016657.mp3');
    expect(jemAudioFile('https://example.org/jem-audio/AR0016657.mp3')).toBeNull();
    expect(jemAudioFile(null)).toBeNull();
    expect(relinkedJemAudio('https://sichos-kodesh-media-proxy.shmuky.workers.dev/jem-audio/AR0016657.mp3')).toBe('https://dtgj2yu3gmlic.cloudfront.net/AR0016657.mp3');
    expect(relinkedJemAudio('https://dtgj2yu3gmlic.cloudfront.net/AR0016657.mp3')).toBeNull();
  });
});
