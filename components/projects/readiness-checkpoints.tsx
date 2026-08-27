"use client";

import { useState } from "react";
import { CheckCircle2, CircleAlert, Clock, LoaderCircle } from "lucide-react";
import {
  refreshTenantRecords,
  useTenantDocuments,
} from "@/components/live/tenant-records";
import { friendlyError } from "@/lib/ai/friendly-error";
import { runWorkflowCommand } from "@/lib/workflows/command-client";
import {
  checkpointIsResolvable,
  checkpointIsSettled,
  checkpointReasonIsUsable,
  checkpointWaitingReason,
  MINIMUM_CHECKPOINT_REASON,
  type CheckpointResolution,
} from "@/features/readiness/checkpoint-resolution";
import { checkpointSatisfiedByEvidence } from "@/features/readiness/checkpoint-evidence";
import { useReadinessEvidence } from "@/components/projects/use-readiness-evidence";
import { formatDueDate } from "@/lib/format/event-date";

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

/**
 * The readiness list, with somewhere to act.
 *
 * `/studio/readiness` promised "what is complete, what is at risk, who owns
 * each item, and what to do next" and had not one button on it, because
 * `resolveCheckpoint` had no caller anywhere in the product. Readiness climbed
 * on its own to 38% and stopped on judgements — venue confirmed, locations
 * confirmed, travel, primary contacts — that nothing could record.
 *
 * A judgement gets **Mark done** and **Waive**, each needing a reason that goes
 * into the audit log. Anything a record decides gets no button and a sentence
 * saying what it is waiting for, so the row is never silent about why it cannot
 * be actioned. See features/readiness/checkpoint-resolution.ts.
 */
export function ReadinessCheckpoints({ projectId }: { projectId: string }) {
  const { records: checkpoints } = useTenantDocuments("checkpoints");
  /**
   * The same evidence the score is computed from.
   *
   * Without this the list read checkpoint *status* while the meter above it read
   * the records, so a job at 67% showed every record-backed row as still
   * waiting and a count of 0/12. Evidence satisfies readiness without writing
   * the checkpoint row — that is deliberate, the row stays a record of what
   * automation actually did — so anything displaying these has to consult the
   * evidence too, or it contradicts the number beside it.
   */
  const evidence = useReadinessEvidence(projectId);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<{
    id: string;
    resolution: CheckpointResolution;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const rows = (checkpoints ?? [])
    .filter((item) => item.projectId === projectId && item.archivedAt === null)
    .map((item) => ({
      id: item.id,
      name: text(item.name) || "Unnamed checkpoint",
      status: text(item.status),
      blocking: item.blocking === true,
      completionMethod: text(item.completionMethod),
      templateKey: text(item.templateKey),
      ownerType: text(item.ownerType),
      dueDate: text(item.resolvedDueDate) || null,
    }))
    .map((row) => ({
      ...row,
      // Settled by a person, or already proven by the records.
      settled:
        checkpointIsSettled(row) ||
        checkpointSatisfiedByEvidence(
          { completionMethod: row.completionMethod, templateKey: row.templateKey },
          evidence,
        ),
    }))
    .sort((left, right) => {
      // Outstanding first, then by when it is due — the order a photographer
      // works in, not the order the template happened to define.
      const settled = Number(left.settled) - Number(right.settled);
      if (settled !== 0) return settled;
      return (left.dueDate ?? "9999").localeCompare(right.dueDate ?? "9999");
    });

  if (!rows.length) return null;

  async function resolve(
    checkpointId: string,
    resolution: CheckpointResolution,
    reason: string,
  ) {
    setBusy(checkpointId);
    setNotice(null);
    try {
      await runWorkflowCommand("resolveCheckpoint", {
        checkpointId,
        resolution,
        reason,
        // A waiver with no expiry is a decision, not a deferral. The server
        // accepts null and readiness treats an unexpiring waiver as satisfied.
        waiverExpiresAt: null,
        /**
         * The reason is the evidence, and the command insists on one: the
         * starter templates give every manual checkpoint
         * `requiredEvidence: ["studio approval"]`, and `resolveCheckpoint`
         * throws EVIDENCE_REQUIRED when a completion arrives with an empty
         * array. `manual_note` is the evidence type that exists for exactly
         * this — a person vouching, recorded as such.
         */
        evidence: [
          {
            type: "manual_note",
            referenceId: checkpointId,
            label: reason.slice(0, 160),
          },
        ],
        notes: reason,
      });
      setOpen(null);
      refreshTenantRecords("checkpoints", "readinessAssessments", "projects");
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "That checkpoint could not be updated."));
    } finally {
      setBusy(null);
    }
  }

  const settledCount = rows.filter((row) => row.settled).length;

  return (
    <section className="readiness-checkpoints">
      <header>
        <div>
          <p className="eyebrow">Before the day</p>
          <h2>Readiness checkpoints</h2>
          <p>
            What has to be true before this wedding is ready. Most complete
            themselves when the record arrives; the judgements are yours.
          </p>
        </div>
        <span className="readiness-checkpoints-count">
          {settledCount}/{rows.length}
        </span>
      </header>
      <ul>
        {rows.map((row) => {
          const settled = row.settled;
          const resolvable = !settled && checkpointIsResolvable(row);
          const waiting = settled ? null : checkpointWaitingReason(row);
          return (
            <li
              className={
                settled ? "is-settled" : resolvable ? "is-yours" : "is-waiting"
              }
              key={row.id}
            >
              <span className="readiness-checkpoint-mark">
                {settled ? (
                  <CheckCircle2 aria-hidden="true" size={17} />
                ) : resolvable ? (
                  <CircleAlert aria-hidden="true" size={17} />
                ) : (
                  <Clock aria-hidden="true" size={15} />
                )}
              </span>
              <span className="readiness-checkpoint-copy">
                <strong>{row.name}</strong>
                <small>
                  {row.status === "waived" ? "Waived" : null}
                  {row.status === "waived" && row.dueDate ? " · " : null}
                  {row.dueDate ? `Due ${formatDueDate(row.dueDate)}` : null}
                  {!row.dueDate && row.status !== "waived" ? "No due date" : null}
                </small>
                {waiting ? <em>{waiting}</em> : null}
              </span>
              {resolvable ? (
                <span className="readiness-checkpoint-actions">
                  <button
                    className="button"
                    disabled={busy !== null}
                    onClick={() => setOpen({ id: row.id, resolution: "complete" })}
                    type="button"
                  >
                    {busy === row.id ? (
                      <LoaderCircle className="spin" size={14} />
                    ) : null}
                    Mark done
                  </button>
                  <button
                    className="button button-quiet"
                    disabled={busy !== null}
                    onClick={() => setOpen({ id: row.id, resolution: "waived" })}
                    type="button"
                  >
                    Waive
                  </button>
                </span>
              ) : null}
              {open?.id === row.id ? (
                <form
                  className="readiness-checkpoint-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const reason = String(
                      new FormData(event.currentTarget).get("reason") ?? "",
                    );
                    if (!checkpointReasonIsUsable(reason)) return;
                    void resolve(row.id, open.resolution, reason);
                  }}
                >
                  <label>
                    {open.resolution === "complete"
                      ? "How do you know?"
                      : "Why is this being waived?"}
                    <input
                      maxLength={2000}
                      minLength={MINIMUM_CHECKPOINT_REASON}
                      name="reason"
                      placeholder={
                        open.resolution === "complete"
                          ? "Confirmed the ceremony location with the venue by phone"
                          : "The venue does not require a certificate"
                      }
                      required
                    />
                  </label>
                  <small>
                    Recorded against your name in the audit log. Readiness will
                    show this as your judgement, not as something StudioCue saw.
                  </small>
                  <div>
                    <button className="button" type="submit">
                      {open.resolution === "complete" ? "Mark done" : "Waive it"}
                    </button>
                    <button
                      className="button button-quiet"
                      onClick={() => setOpen(null)}
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : null}
            </li>
          );
        })}
      </ul>
      {notice ? (
        <p className="form-notice" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
