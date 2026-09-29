import type { Route } from './+types/uploads-propose';
import { siteOf } from '../lib/context.server.js';
import { passThrough } from '../lib/pass.server.js';

/** Adding something new: /_/uploads/propose asks the API's /v1/uploads/propose what it likely is and where it belongs, with the session cookie. */
export async function action({ request, context }: Route.ActionArgs) {
  return passThrough(siteOf(context).api, request, '/v1/uploads/propose');
}
