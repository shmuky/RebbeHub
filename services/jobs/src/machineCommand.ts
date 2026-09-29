import { machineRequests, machineSummary, requestMachineWork, type MachineKind, type MachineRequestStatus } from '@rebbehub/core';
import type { EntityId } from '@rebbehub/model';
import { withCatalog, type Context } from './commands.js';

/**
 * `rebbehub machine`: the machines' queue from the command line, the same
 * one the site, the API and the MCP tools fill (core/machineWork.ts).
 *
 *   rebbehub machine                 what waits, what is left, what was done this week
 *   rebbehub machine list [--kind ocr|transcript] [--status waiting|running|done|failed]
 *   rebbehub machine ask --kind ocr|transcript --item <id> --as <account>
 *
 * The work itself is done by `rebbehub ocr` and `rebbehub transcribe`,
 * which take the waiting requests first.
 */
export async function machineCommand(ctx: Context, input: { action?: string; kind?: string; item?: string; as?: string; status?: string; limit?: number }): Promise<void> {
  const kind = input.kind as MachineKind | undefined;
  if (kind !== undefined && kind !== 'ocr' && kind !== 'transcript') throw new Error('--kind is ocr or transcript');
  await withCatalog(ctx, async (catalog) => {
    if (!input.action) {
      const summary = await machineSummary(catalog);
      for (const [k, s] of Object.entries(summary)) {
        ctx.log(`${k}: ${s.waiting} waiting, ${s.running} running; this week ${s.doneLastWeek} done, ${s.failedLastWeek} failed; ${s.backlog} ${k === 'ocr' ? 'scans' : 'recordings'} not done yet`);
      }
      return;
    }
    if (input.action === 'list') {
      const list = await machineRequests(catalog, { kind, status: input.status as MachineRequestStatus | undefined, limit: input.limit });
      for (const r of list) ctx.log(`#${r.id} ${r.kind} ${r.item} ${r.status}${r.position ? ` (${r.position} in line)` : ''} by ${r.requestedBy} ${r.createdAt}${r.note ? ` - ${r.note}` : ''}`);
      if (!list.length) ctx.log('no requests');
      return;
    }
    if (input.action === 'ask') {
      if (!kind || !input.item || !input.as) throw new Error('give --kind, --item and --as');
      const { request, created } = await requestMachineWork(catalog, input.as, { kind, item: input.item as EntityId });
      ctx.log(`${created ? 'asked' : 'already asked'}: #${request.id} ${request.kind} ${request.item}, ${request.status}${request.position ? `, ${request.position} in line` : ''}`);
      return;
    }
    throw new Error('rebbehub machine [list | ask]');
  });
}
