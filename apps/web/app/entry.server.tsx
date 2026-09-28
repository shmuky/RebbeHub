import { isbot } from 'isbot';
import { renderToReadableStream } from 'react-dom/server';
import { ServerRouter, type EntryContext } from 'react-router';

/**
 * Pages are rendered as web streams, which Cloudflare Workers and Node
 * both speak, so the site runs unchanged on either. Search engines and
 * other bots get the whole page at once; people get it as it renders.
 */
export default async function handleRequest(request: Request, status: number, headers: Headers, context: EntryContext) {
  let failed = false;
  const body = await renderToReadableStream(<ServerRouter context={context} url={request.url} />, {
    signal: request.signal,
    onError(error: unknown) {
      failed = true;
      console.error(error);
    },
  });
  if (isbot(request.headers.get('user-agent') ?? '')) await body.allReady;
  headers.set('Content-Type', 'text/html; charset=utf-8');
  return new Response(body, { headers, status: failed ? 500 : status });
}
