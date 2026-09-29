import type { FileStore } from './app.js';
import { STATUS_KEY, type StatusReport, type StatusStore } from './status.js';

/**
 * The little of an R2 bucket the API uses (declared here rather than
 * taking all of @cloudflare/workers-types, whose globals would clash
 * with the site's DOM types), and the stores the app reads through it:
 * files that may be served, the texts of seforim, and the status checks'
 * last report. Both Workers use these: the API's own (worker.ts) and the
 * site's, which answers its own reads (reads.ts).
 */
export interface R2Bucket {
  get(key: string, options?: { range?: { offset: number; length?: number } }): Promise<({ body: ReadableStream; size: number } & { text(): Promise<string> }) | null>;
  put(key: string, value: ArrayBuffer | string, options?: { httpMetadata?: { contentType?: string; cacheControl?: string } }): Promise<unknown>;
}

export function r2Writer(bucket: R2Bucket): { put(key: string, bytes: ArrayBuffer, mime: string): Promise<void> } {
  return { put: async (key: string, bytes: ArrayBuffer, mime: string) => void (await bucket.put(key, bytes, { httpMetadata: { contentType: mime } })) };
}

export function r2Store(bucket: R2Bucket): FileStore {
  return {
    async get(key, range) {
      const object = await bucket.get(key, range ? { range } : undefined);
      return object ? { body: object.body, size: object.size } : null;
    },
  };
}

/** The report kept in the public bucket, for GET /v1/status. */
export function statusStore(bucket: R2Bucket): StatusStore {
  return {
    async read() {
      const object = await bucket.get(STATUS_KEY);
      return object ? (JSON.parse(await object.text()) as StatusReport) : null;
    },
  };
}
