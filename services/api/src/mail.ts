import type { Advisor, Mailer } from '@rebbehub/core';

/**
 * The API's two outside helpers, each off until its secret is set
 * (docs/accounts.md, docs/deploy.md):
 *
 *   Resend      sends email: sign-in links, notifications, takedown receipts
 *               (RESEND_API_KEY; from EMAIL_FROM, an address on a domain
 *               verified with Resend)
 *   Workers AI  writes the reviewer's advice on a suggestion
 *               (CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_TOKEN)
 */

export const DEFAULT_EMAIL_FROM = 'RebbeHub <no-reply@rebbehub.org>';

/** Email through Resend's HTTP API. */
export function resendMailer(input: { apiKey: string; from?: string; fetch?: typeof fetch }): Mailer {
  return {
    async send(message) {
      const response = await (input.fetch ?? fetch)('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${input.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: input.from ?? DEFAULT_EMAIL_FROM, to: [message.to], subject: message.subject, text: message.text, html: message.html, headers: message.headers }),
      });
      if (!response.ok) throw new Error(`Resend: ${response.status} ${(await response.text().catch(() => '')).slice(0, 300)}`);
    },
  };
}

export const DEFAULT_ADVICE_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

/** A chat model on Cloudflare Workers AI, through its REST API. */
export function workersAiAdvisor(input: { accountId: string; token: string; model?: string; fetch?: typeof fetch }): Advisor {
  const model = input.model ?? DEFAULT_ADVICE_MODEL;
  return {
    model: model.replace(/^@cf\//, ''),
    async complete(system, user) {
      const response = await (input.fetch ?? fetch)(`https://api.cloudflare.com/client/v4/accounts/${input.accountId}/ai/run/${model}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${input.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: 400, temperature: 0.2 }),
      });
      const body = (await response.json().catch(() => ({}))) as { success?: boolean; errors?: unknown; result?: { response?: string } };
      if (!response.ok || !body.success) throw new Error(`Workers AI: ${response.status} ${JSON.stringify(body.errors ?? body).slice(0, 300)}`);
      return body.result?.response ?? '';
    },
  };
}
