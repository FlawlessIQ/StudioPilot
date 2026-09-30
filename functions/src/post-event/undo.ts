// The functions copy of features/post-event/undo.ts, which is the source of
// truth. tests/wave2-delivery.test.ts compares the two from the marker below.

// ── shared below ──

/**
 * Taking back one post-production or album step (Wave 2).
 *
 * Both ladders only went forward. A step ticked by mistake — "Editing
 * finished" on the wrong wedding, "Record fulfillment" pressed on an album
 * still at the printer — stayed ticked, and the album refused to move back
 * with ALBUM_STATUS_REGRESSION. The couple's portal and the job's brief then
 * reported progress that had not happened, with no way to correct it.
 *
 * One step at a time, by staff, and audited: an undo is a correction, not a
 * way to rewrite a job's history. Pure.
 */

/** The steps a studio ticks, and so may untick. The rest have other writers. */
export const UNDOABLE_POST_PRODUCTION_STEPS: readonly string[] = [
  "backup_complete",
  "cull_complete",
  "editing_started",
  "editing_complete",
  "gallery_ready",
  "album_proof_ready",
];

/**
 * Why a step may not be unticked, or null when it may.
 *
 * "Cards backed up" is the delivery gate, so once anything has been released
 * against it the tick is evidence, not progress: unticking it would claim the
 * couple were sent files that were never backed up.
 */
export function postProductionUndoRefusal(
  steps: Readonly<Record<string, { complete?: boolean } | undefined>>,
  step: string,
): string | null {
  if (!UNDOABLE_POST_PRODUCTION_STEPS.includes(step)) return "POST_PRODUCTION_STEP_NOT_UNDOABLE";
  if (steps[step]?.complete !== true) return "POST_PRODUCTION_STEP_NOT_COMPLETE";
  if (step === "backup_complete" && steps.delivery_sent?.complete === true) return "POST_PRODUCTION_BACKUP_RELEASED";
  return null;
}

/**
 * The status an album goes back to: the one it was at before its current
 * one, read from its own history rather than from the ladder's order — an
 * album can go from "design sent" straight to "approved", and stepping back
 * from approved must not land on "revision requested", which never happened.
 *
 * An undo entry (`undoneFrom`) pops the stack, so undoing twice walks back
 * two steps instead of bouncing between the last two. Null when there is
 * nothing to go back to.
 */
export function previousAlbumStatus(current: string, history: unknown): string | null {
  const stack: string[] = [];
  for (const entry of Array.isArray(history) ? history : []) {
    const row = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : {};
    const status = typeof row.status === "string" ? row.status : "";
    if (!status) continue;
    if (typeof row.undoneFrom === "string" && row.undoneFrom) {
      stack.pop();
      if (stack[stack.length - 1] !== status) stack.push(status);
      continue;
    }
    if (stack[stack.length - 1] !== status) stack.push(status);
  }
  if (stack[stack.length - 1] !== current) stack.push(current);
  return stack.length > 1 ? stack[stack.length - 2]! : null;
}
