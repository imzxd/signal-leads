/**
 * Serialises workflow runs per lead within this process so two inbound messages for the same
 * lead are handled in order. For multi-instance deployments, move workflow execution onto a
 * queue keyed by lead id (e.g. n8n or a Postgres job table) — the workflows are already
 * idempotent at the message and follow-up level.
 */
const g = globalThis as typeof globalThis & { __signalLeadLocks?: Map<string, Promise<unknown>> };
const locks = (g.__signalLeadLocks ??= new Map());

export async function withLeadLock<T>(leadId: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(leadId) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(fn);
  const tail = run.catch(() => undefined);
  locks.set(leadId, tail);
  try {
    return await run;
  } finally {
    if (locks.get(leadId) === tail) locks.delete(leadId);
  }
}
