import type { RebbeHubApi } from './api.js';

/**
 * Passes a request from the site's own pages through to the API with the
 * session cookie (/_/suggestions, /_/follows, /_/admin, /_/reports), so
 * the browser talks only to the site. Answers are personal: never cached.
 */
export async function passThrough(api: Pick<RebbeHubApi, 'forward'>, request: Request, apiPath: string): Promise<Response> {
  const response = await api.forward(apiPath, request);
  return new Response(await response.text(), {
    status: response.status,
    headers: { 'Content-Type': response.headers.get('Content-Type') ?? 'application/json', 'Cache-Control': 'no-store' },
  });
}
