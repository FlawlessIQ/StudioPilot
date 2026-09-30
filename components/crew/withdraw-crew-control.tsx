"use client";

import { useState } from "react";
import Link from "next/link";
import { LoaderCircle } from "lucide-react";
import { refreshTenantRecords } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
import {
  withdrawConsequence,
  withdrawDoneMessage,
  withdrawOutcome,
  type WithdrawOutcome,
} from "@/features/crew/withdraw-copy";
import { friendlyError } from "@/lib/ai/friendly-error";
import { sendCrewCommand } from "@/lib/crew/command-client";

/** The one call both surfaces make; see functions/src/crew/commands.ts. */
export async function withdrawCrew(input: {
  projectId: string;
  assignmentId: string;
  replace: boolean;
  reason: string;
}): Promise<WithdrawOutcome> {
  const { result } = await sendCrewCommand("withdrawAssignment", {
    projectId: input.projectId,
    assignmentId: input.assignmentId,
    reason: input.reason.trim() || null,
    replace: input.replace,
  });
  return withdrawOutcome(result);
}

/**
 * Withdraw or replace one person, on the job page's crew card.
 *
 * There was no way to take anyone off a job short of cancelling the wedding,
 * and archiving them was refused while they held the assignment. Owners and
 * admins only, as the command is: it ends somebody's booked work. A
 * coordinator sees the row without the buttons.
 */
export function WithdrawCrewControl({
  projectId,
  assignmentId,
  name,
  role,
  accepted,
}: {
  projectId: string;
  assignmentId: string;
  name: string;
  role: string;
  accepted: boolean;
}) {
  const workspace = useWorkspace();
  const [mode, setMode] = useState<"withdraw" | "replace" | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [staffLink, setStaffLink] = useState(false);
  if (!["studio_owner", "studio_admin"].includes(String(workspace.role ?? "")))
    return null;

  async function confirm() {
    if (!mode) return;
    const replace = mode === "replace";
    setBusy(true);
    setNotice(null);
    try {
      const outcome = await withdrawCrew({
        projectId,
        assignmentId,
        replace,
        reason,
      });
      setNotice(withdrawDoneMessage(outcome, { name, role, replace }));
      // Replace with nobody left on the list: the studio chooses who next.
      setStaffLink(replace && !outcome.replaced);
      setMode(null);
    } catch (caught: unknown) {
      setNotice(
        friendlyError(caught, "That crew member could not be withdrawn."),
      );
    } finally {
      setBusy(false);
      refreshTenantRecords(
        "crewAssignments",
        "crewCascades",
        "readinessAssessments",
      );
    }
  }

  if (!mode)
    return notice ? (
      <span className="crew-withdraw-actions">
        <small role="status">{notice}</small>
        {staffLink ? (
          <Link
            className="button button-light button-sm"
            href={`/studio/crew?project=${encodeURIComponent(projectId)}`}
          >
            Offer the role
          </Link>
        ) : null}
      </span>
    ) : (
      <span className="crew-withdraw-actions">
        <button
          className="button button-quiet button-sm"
          onClick={() => setMode("replace")}
          type="button"
        >
          Replace
        </button>
        <button
          className="button button-quiet button-sm"
          onClick={() => setMode("withdraw")}
          type="button"
        >
          Withdraw
        </button>
      </span>
    );

  return (
    <div
      aria-label={`${mode === "replace" ? "Replace" : "Withdraw"} ${name}`}
      className="crew-withdraw-confirm"
      role="group"
    >
      <p>
        {withdrawConsequence({
          name,
          role,
          accepted,
          replace: mode === "replace",
        })}
      </p>
      {accepted ? (
        <label>
          Reason (optional — it goes in their email)
          <input
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
            value={reason}
          />
        </label>
      ) : null}
      <span className="crew-withdraw-actions">
        <button
          className="button button-sm"
          disabled={busy}
          onClick={() => void confirm()}
          type="button"
        >
          {busy ? <LoaderCircle className="spin" size={14} /> : null}
          {mode === "replace" ? "Withdraw and re-offer" : `Withdraw ${name}`}
        </button>
        <button
          className="button button-quiet button-sm"
          disabled={busy}
          onClick={() => {
            setMode(null);
            setNotice(null);
          }}
          type="button"
        >
          Keep them
        </button>
      </span>
      {notice ? (
        <small className="form-notice" role="status">
          {notice}
        </small>
      ) : null}
    </div>
  );
}
