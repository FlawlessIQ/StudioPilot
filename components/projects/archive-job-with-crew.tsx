"use client";

import { useState } from "react";
import { Archive, LoaderCircle } from "lucide-react";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { archiveBlockedBy, isLiveAssignment } from "@/features/crew/job-stopped";
import {
  waitingLine,
  withdrawAllConsequence,
  type WaitingCrewMember,
} from "@/features/crew/withdraw-copy";
import type { LifecycleRecord } from "@/features/projects/lifecycle-projection";
import { friendlyError } from "@/lib/ai/friendly-error";
import { runCrmCommand } from "@/lib/crm/command-client";

/** Who is still waiting on the job, named from the crew directory. */
export function useWaitingCrew(assignments: readonly LifecycleRecord[]): WaitingCrewMember[] {
  const { records: profiles } = useTenantDocuments("crewProfiles");
  return assignments
    .filter((assignment) => isLiveAssignment(assignment.status))
    .map((assignment) => {
      const profile = (profiles ?? []).find(
        (item) => item.id === String(assignment.crewProfileId ?? ""),
      );
      const name = String(profile?.name ?? "").trim();
      return {
        assignmentId: String(assignment.id),
        name: name || null,
        role: String(assignment.role ?? "").trim() || "Crew",
        status: String(assignment.status ?? ""),
      };
    });
}

/**
 * Archiving a job somebody is still waiting on.
 *
 * Archiving such a job is refused, and rightly — it ends nothing, so the offer
 * would stay live for a crew member the studio can no longer see. But the
 * refusal was a dead end that named nobody. This says who is waiting (the
 * same specific wording the rule itself writes, archiveBlockedBy) and offers
 * the one move that clears it: withdraw them and archive, in one command on
 * the server (archiveProject with withdrawLiveCrew).
 *
 * Cancelling stays the right answer when the wedding is genuinely off, and the
 * wording says so.
 */
export function ArchiveJobWithCrew({
  projectId,
  waiting,
  onDone,
}: {
  projectId: string;
  waiting: readonly WaitingCrewMember[];
  onDone: (message: string) => void;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const block = archiveBlockedBy(waiting);

  async function go() {
    setBusy(true);
    setNotice(null);
    try {
      const { result } = await runCrmCommand("archiveProject", {
        projectId,
        restore: false,
        withdrawLiveCrew: true,
      });
      const withdrawn = Number(result.crewWithdrawn ?? waiting.length);
      const notified = Number(result.crewNotified ?? 0);
      setAsking(false);
      onDone(
        `Archived. ${withdrawn === 1 ? "1 person was" : `${withdrawn} people were`} withdrawn${
          notified ? `, and ${notified === 1 ? "1 was" : `${notified} were`} emailed` : ""
        }.`,
      );
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "That could not be archived."));
    } finally {
      setBusy(false);
    }
  }

  if (!asking)
    return (
      <span className="record-archive-confirm">
        <button
          className="button button-quiet"
          onClick={() => setAsking(true)}
          type="button"
        >
          <Archive size={14} /> Archive job
        </button>
      </span>
    );

  return (
    <section className="project-danger-waiting" role="note">
      <h4>{block.message}</h4>
      <ul>
        {waiting.map((member) => (
          <li key={member.assignmentId}>{waitingLine(member)}</li>
        ))}
      </ul>
      <p>{`If you still want it archived, withdraw ${waiting.length === 1 ? "them" : "them all"} first. ${withdrawAllConsequence(waiting)}`}</p>
      <span>
        <button
          className="button button-quiet"
          disabled={busy}
          onClick={() => void go()}
          type="button"
        >
          {busy ? <LoaderCircle className="spin" size={14} /> : null}
          Withdraw these and archive
        </button>
        <button
          className="button button-quiet"
          disabled={busy}
          onClick={() => setAsking(false)}
          type="button"
        >
          Keep it
        </button>
      </span>
      {notice ? (
        <p className="form-notice" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
