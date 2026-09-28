import type { Route } from './+types/uploads-check';
import { siteOf } from '../lib/context.server.js';
import { passThrough } from '../lib/pass.server.js';

/** Before an upload: /_/uploads/check asks the API's /v1/uploads/check whether we have the file and what it is, with the session cookie. */
export async function action({ request, context }: Route.ActionArgs) {
  return passThrough(siteOf(context).api, request, '/v1/uploads/check');
}
