/**
 * When a command last changed this tenant's records.
 *
 * `useTenantDocuments` caches each collection for 15 seconds so a page reading
 * a dozen collections issues a dozen requests rather than a hundred. Surfaces
 * that write and stay put call `refreshTenantRecords` themselves, which clears
 * the cache and re-runs every mounted reader — that path is well covered.
 *
 * The gap is a write made on a *different route*. /studio/tasks/new creates a
 * task and then shows its own confirmation; nothing on it invalidates anything.
 * Navigating back to /studio/tasks is a client-side transition, so the module
 * cache is still warm, and the list renders from an answer read before the task
 * existed. The studio sees a list without the thing they just made, and the only
 * fix available to them is a hard reload — which is exactly the shape of the
 * "pages don't refresh after an action" complaint.
 *
 * Rather than ask every one of the twelve command clients' callers to remember,
 * the clients themselves mark the moment a command persisted. A cache entry
 * taken before that moment is not served, however much TTL it has left.
 *
 * Deliberately passive: this does not force mounted readers to re-read. It only
 * stops a *newly mounted* reader being handed pre-write records. Components that
 * need the update in place still call `refreshTenantRecords`, and should — this
 * is the floor, not a replacement.
 *
 * Module state, no Firebase import, so `lib/` command clients can reach it
 * without depending on a React component.
 */

let lastWriteAt = 0;

/** Called by every command client the moment a command is known to have persisted. */
export function markTenantRecordsWritten(at: number = Date.now()): void {
  lastWriteAt = at;
}

/**
 * Whether a cache entry taken at `cachedAt` may still be served.
 *
 * Strictly after: an entry cached in the same millisecond as a write may have
 * been read before it, and serving stale records is the failure this exists to
 * prevent. Re-reading one collection once is the cost of being wrong the other
 * way.
 */
export function cacheEntryPredatesWrite(cachedAt: number): boolean {
  return cachedAt <= lastWriteAt;
}

/** Test seam. Never called by the app. */
export function resetTenantRecordWrites(): void {
  lastWriteAt = 0;
}
