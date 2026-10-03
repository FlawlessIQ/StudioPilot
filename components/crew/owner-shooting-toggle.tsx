"use client";

import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { refreshTenantRecords } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
import { friendlyError } from "@/lib/ai/friendly-error";
import { sendCrewCommand } from "@/lib/crew/command-client";

/** The one call both surfaces make; see functions/src/crew/commands.ts. */
export async function setOwnerShooting(projectId: string, ownerShooting: boolean) {
  await sendCrewCommand("setOwnerShooting", { projectId, ownerShooting });
  refreshTenantRecords("projects");
}

/**
 * Whether you're shooting this wedding, on the job's crew card.
 *
 * StudioCue counted the owner as one of the crew on every job, so a photo +
 * video wedding asked for one videographer. Gabe "usually does every shoot but
 * there may be some where he is not there and he sends crew" — so it is asked
 * per job, and "Not me this time" makes every role one to book. Owners and
 * admins change it; everyone sees it.
 */
export function OwnerShootingToggle({
  projectId,
  ownerShooting,
  crewByDefault = true,
}: {
  projectId: string;
  ownerShooting: boolean;
  /** Whether this kind of job is crewed (job-kinds.ts): a family session is usually just you. */
  crewByDefault?: boolean;
}) {
  const workspace = useWorkspace();
  const canChange = ["studio_owner", "studio_admin"].includes(String(workspace.role ?? ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The job page reads the project once; show the answer just given.
  const [given, setGiven] = useState<boolean | null>(null);
  const shooting = given ?? ownerShooting;
  const change = async () => {
    setBusy(true);
    setError(null);
    try {
      await setOwnerShooting(projectId, !shooting);
      setGiven(!shooting);
    } catch (caught: unknown) {
      setError(friendlyError(caught, "That couldn't be changed. Try again."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="owner-shooting">
      <p>
        {shooting
          ? crewByDefault
            ? "You're shooting this one — StudioCue books the rest of the crew."
            : "You're shooting this one."
          : "Not you this time — every role is booked from your crew."}
      </p>
      {canChange ? (
        <button className="button button-light button-sm" disabled={busy} onClick={() => void change()} type="button">
          {busy ? <LoaderCircle className="spin" size={14} /> : null}
          {shooting ? "Not me this time" : "I'm shooting it"}
        </button>
      ) : null}
      {error ? <small role="alert">{error}</small> : null}
    </div>
  );
}
