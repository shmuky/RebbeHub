import { CatalogError, checkMachineWork, finishMachineWork, takeMachineRequests, type Catalog, type MachineKind } from '@rebbehub/core';
import type { EntityId } from '@rebbehub/model';

/**
 * What a machine job works on in one run: first what people asked for
 * (core/machineWork.ts), oldest request first, then, while the run has
 * room and `sweep` is on, what is new and not done yet. Every item it
 * finishes, or fails on, settles the requests for it. One item failing
 * does not stop the others; the run reports them all at the end.
 */
export async function machineRun<T extends { id: EntityId }>(
  catalog: Catalog,
  kind: MachineKind,
  input: {
    /** One item by name, instead of the queue and the sweep. */
    item?: EntityId;
    limit: number;
    /** Also go on to items nobody asked for (the nightly run); off, only requests. */
    sweep: boolean;
    /** The items ready for this work: one by id, or the newest ones not done yet. */
    find: (options: { item?: EntityId; limit: number }) => Promise<T[]>;
    /** Does the work; `{ skipped }` when there was nothing to make (silence, a blank scan), which settles its requests without failing the run. */
    work: (target: T) => Promise<void | { skipped: string }>;
    log: (line: string) => void;
  },
): Promise<{ done: EntityId[]; failed: Array<{ item: EntityId; error: string }> }> {
  const targets: T[] = [];
  if (input.item) {
    targets.push(...(await input.find({ item: input.item, limit: 1 })));
  } else {
    for (const request of await takeMachineRequests(catalog, kind, input.limit)) {
      const [target] = await input.find({ item: request.item, limit: 1 });
      if (target) {
        input.log(`${request.item}: asked for by ${request.requestedBy}`);
        targets.push(target);
        continue;
      }
      // Nothing to do: it was done meanwhile, or can no longer be done (and why).
      const why = await checkMachineWork(catalog, kind, request.item).then(
        () => ({ status: 'failed' as const, note: 'the machine cannot take this item' }),
        (error: unknown) => (error instanceof CatalogError && error.code === 'state' ? { status: 'done' as const, note: error.message } : { status: 'failed' as const, note: error instanceof Error ? error.message : String(error) }),
      );
      await finishMachineWork(catalog, kind, request.item, why);
      input.log(`${request.item}: ${why.note}`);
    }
    const room = input.limit - targets.length;
    if (input.sweep && room > 0) {
      const taken = new Set(targets.map((t) => t.id));
      targets.push(...(await input.find({ limit: room + taken.size })).filter((t) => !taken.has(t.id)).slice(0, room));
    }
  }

  const done: EntityId[] = [];
  const failed: Array<{ item: EntityId; error: string }> = [];
  for (const target of targets) {
    try {
      const outcome = await input.work(target);
      if (outcome) {
        await finishMachineWork(catalog, kind, target.id, { status: 'failed', note: outcome.skipped });
        input.log(`${target.id}: ${outcome.skipped}`);
        continue;
      }
      await finishMachineWork(catalog, kind, target.id, { status: 'done' });
      done.push(target.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await finishMachineWork(catalog, kind, target.id, { status: 'failed', note: message });
      input.log(`${target.id}: failed: ${message}`);
      failed.push({ item: target.id, error: message });
    }
  }
  return { done, failed };
}

/** Ends a run that had failures with an error naming them, after the rest were done. */
export function failIfAny(failed: Array<{ item: EntityId; error: string }>): void {
  if (failed.length) throw new Error(`${failed.length} failed: ${failed.map((f) => `${f.item} (${f.error})`).join('; ')}`);
}
