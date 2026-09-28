/**
 * Sends a signed-in person's action to the API through the site's own
 * address (`/_/steward/…`, routes/admin-pass.ts), so the session cookie is
 * the site's. Throws the API's own message when it says no.
 */
export async function postJson<T = { id?: number; status?: string }>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/_/steward/${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const json = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) throw new Error(json.message ?? response.statusText);
  return json;
}
