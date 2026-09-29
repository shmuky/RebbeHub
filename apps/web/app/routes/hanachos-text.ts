import type { Route } from './+types/hanachos-text';
import { siteOf } from '../lib/context.server.js';
import { passThrough } from '../lib/pass.server.js';

/** A hanacha's words: /_/hanachos/text sends them to the API's /v1/hanachos/text with the session cookie, as a suggestion for review. */
export async function action({ request, context }: Route.ActionArgs) {
  return passThrough(siteOf(context).api, request, '/v1/hanachos/text');
}
