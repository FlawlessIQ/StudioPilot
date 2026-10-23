import {
  FieldValue,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Precondition,
} from "firebase-admin/firestore";

/**
 * A job's booking plan is never overwritten without a copy.
 *
 * Found in the audit of 2026-10-22: every path that starts a booking plan —
 * acceptance with send-on-acceptance, a job that books without an agreement,
 * sending a StudioCue agreement, the combined booking link, approving a
 * signing-app sequence, recording a signature — wrote the plan wholesale
 * whenever the one there was not `active` (or not `completed`). A paused,
 * failed, cancelled or needs_attention plan was replaced, and with it went
 * what only the plan recorded: `invoiceUnlinkedAt/By` (an invoice deleted
 * under it, billing/invoice-purge.ts), `restoredAt/By/Reason` (a support
 * restore), `lastError`, and who approved what when.
 *
 * So a replacement copies the plan it replaces into
 * `bookingOrchestrationHistory/{projectId}_{replacedAt}` in the same write —
 * the same transaction, or the same batch — and the replacement itself only
 * lands if the plan is still the one that was read (`lastUpdateTime`). A
 * `completed` plan is never replaced: it is the record that the job booked.
 *
 * History rows are server-only (firestore.rules) and immutable: each is
 * created once, never updated.
 */

export const PLAN_HISTORY_COLLECTION = "bookingOrchestrationHistory";

type PlanFields = Record<string, unknown>;

/**
 * Pure. What a write that starts the plan afresh may do with the one there:
 * create it (none yet), replace it (copying it first), or keep it (booked).
 */
export function planReplacement(existing: PlanFields | null | undefined): "create" | "replace" | "keep" {
  if (!existing) return "create";
  return existing.status === "completed" ? "keep" : "replace";
}

/** Pure. One row per replacement, keyed by the job and the moment. */
export function planHistoryId(projectId: string, replacedAt: string): string {
  return `${projectId}_${replacedAt}`;
}

export type PlanHistoryReason =
  | "proposal_accepted"
  | "booked_without_agreement"
  | "agreement_sent"
  | "combined_agreement_sent"
  | "booking_sequence_approved"
  | "signature_recorded"
  | "reopened_on_uncancel"
  | "reopened_for_retainer";

/** Pure. The history row: the whole plan as it stood, and why it changed. */
export function planHistoryRecord(input: {
  tenantId: string;
  projectId: string;
  previous: PlanFields;
  replacedAt: string;
  replacedBy: string;
  reason: PlanHistoryReason;
}) {
  return {
    id: planHistoryId(input.projectId, input.replacedAt),
    tenantId: input.tenantId,
    projectId: input.projectId,
    previousPlan: input.previous,
    previousStatus: typeof input.previous.status === "string" ? input.previous.status : null,
    previousStep: typeof input.previous.currentStep === "string" ? input.previous.currentStep : null,
    replacedAt: input.replacedAt,
    replacedBy: input.replacedBy,
    reason: input.reason,
  };
}

/**
 * Pure. The fields the old plan had that the new one does not, to delete in
 * the replacing update — so the result is the new plan exactly, as the
 * `{ merge: false }` set it replaces made it, and the old fields live on only
 * in history.
 */
export function staleFields(previous: PlanFields, next: PlanFields): string[] {
  return Object.keys(previous).filter((key) => !(key in next) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key));
}

/** A transaction or a batch: both create and update the same way. */
export type PlanWriter = {
  create(reference: DocumentReference, data: PlanFields): unknown;
  update(reference: DocumentReference, data: PlanFields, precondition?: Precondition): unknown;
};

/**
 * Start the job's plan afresh, keeping the one it replaces.
 *
 * `existing` is the plan as the caller read it — inside its transaction where
 * it has one. No plan: created, which fails if one appeared since. A plan:
 * copied to history, then replaced only if unchanged since the read. A
 * completed plan: left alone, and "kept" returned.
 */
export function replacePlan(
  db: Firestore,
  writer: PlanWriter,
  input: {
    existing: DocumentSnapshot;
    next: PlanFields;
    tenantId: string;
    projectId: string;
    now: string;
    actor: string;
    reason: PlanHistoryReason;
  },
): "created" | "replaced" | "kept" {
  const previous = input.existing.exists ? (input.existing.data() ?? {}) : null;
  const decision = planReplacement(previous);
  if (decision === "keep") return "kept";
  if (decision === "create" || !previous) {
    writer.create(input.existing.ref, input.next);
    return "created";
  }
  writeHistory(db, writer, { ...input, previous });
  const update: PlanFields = { ...input.next };
  for (const key of staleFields(previous, input.next)) update[key] = FieldValue.delete();
  writer.update(input.existing.ref, update, unchangedSince(input.existing));
  return "replaced";
}

const REOPENABLE_STATES = ["CONTRACT_PENDING", "RETAINER_PENDING"];
/** Closed because the job was called off — not because acceptance was undone. */
const CALLED_OFF_REASONS = ["project_cancelled", "project_called_off"];

/**
 * Pure. The step a cancelled plan waits on again when its job comes back to
 * `projectState`, or null when it does not reopen.
 *
 * Only a plan the cancel closed, and only for a job back before booking:
 * - CONTRACT_PENDING: the agreement is out again (or about to be), so the
 *   plan waits for its signature. Sending a new one points the active plan at
 *   it (contracts/commands.ts).
 * - RETAINER_PENDING: signed, so the plan waits for the deposit — or, for a
 *   job with nothing to pay, for the gate — as it did when it was cancelled
 *   (`cancelledFromStep`, recorded since 2026-10-23). The cancel superseded
 *   the deposit invoice, so a new one is raised, and a paid one books the job
 *   (orchestration.ts, bookingRetainerPaid).
 */
export function reopenedPlanStep(input: {
  projectState: unknown;
  plan: PlanFields | null | undefined;
}): "wait_for_signature" | "wait_for_payment" | "wait_for_gate" | null {
  const { plan } = input;
  const state = String(input.projectState ?? "");
  if (!plan || plan.status !== "cancelled" || !REOPENABLE_STATES.includes(state)) return null;
  if (!CALLED_OFF_REASONS.includes(String(plan.cancelledReason ?? ""))) return null;
  if (state === "CONTRACT_PENDING") return "wait_for_signature";
  return plan.cancelledFromStep === "wait_for_gate" ? "wait_for_gate" : "wait_for_payment";
}

/**
 * Reopen a plan the cancel closed, keeping the closed one in history. Returns
 * the step it reopened on, or null when it did not reopen.
 */
export function reopenPlan(
  db: Firestore,
  writer: PlanWriter,
  input: {
    existing: DocumentSnapshot;
    projectState: unknown;
    tenantId: string;
    projectId: string;
    now: string;
    actor: string;
    reason: Extract<PlanHistoryReason, "reopened_on_uncancel" | "reopened_for_retainer">;
    extra?: PlanFields;
  },
): ReturnType<typeof reopenedPlanStep> {
  const previous = input.existing.exists ? (input.existing.data() ?? null) : null;
  if (previous && previous.tenantId !== input.tenantId) return null;
  const step = reopenedPlanStep({ projectState: input.projectState, plan: previous });
  if (!step || !previous) return null;
  writeHistory(db, writer, { ...input, previous });
  writer.update(
    input.existing.ref,
    {
      status: "active",
      currentStep: step,
      cancelledAt: null,
      cancelledReason: null,
      cancelledFromStep: null,
      reopenedAt: input.now,
      reopenedBy: input.actor,
      reopenedReason: input.reason,
      ...(input.extra ?? {}),
      updatedAt: input.now,
    },
    unchangedSince(input.existing),
  );
  return step;
}

function writeHistory(
  db: Firestore,
  writer: PlanWriter,
  input: {
    previous: PlanFields;
    tenantId: string;
    projectId: string;
    now: string;
    actor: string;
    reason: PlanHistoryReason;
  },
) {
  const record = planHistoryRecord({
    tenantId: input.tenantId,
    projectId: input.projectId,
    previous: input.previous,
    replacedAt: input.now,
    replacedBy: input.actor,
    reason: input.reason,
  });
  writer.create(db.doc(`${PLAN_HISTORY_COLLECTION}/${record.id}`), record);
}

/** The write lands only on the plan that was read, not one changed since. */
function unchangedSince(snapshot: DocumentSnapshot): Precondition | undefined {
  return snapshot.updateTime ? { lastUpdateTime: snapshot.updateTime } : undefined;
}
