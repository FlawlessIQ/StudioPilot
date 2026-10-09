"use client";

import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useWorkspace } from "@/features/auth/workspace-context";
import type { JobBilling, JobBillingMethod } from "@/features/billing/job-billing";
import { setJobBillingMethod } from "@/lib/booking/command-client";
import { friendlyError } from "@/lib/ai/friendly-error";

const OPTIONS: ReadonlyArray<{ method: JobBillingMethod; label: string; detail: string }> = [
  {
    method: "quickbooks",
    label: "Bill through QuickBooks",
    detail: "QuickBooks raises and emails each bill, and payments sync back.",
  },
  {
    method: "studio",
    label: "Bill it myself",
    detail: "Nothing goes to QuickBooks. You record each payment when it comes in.",
  },
];

/**
 * "Bill through QuickBooks / Bill it myself" for one job
 * (projects.billing, bookingCommand setJobBillingMethod, owner/admin).
 *
 * Shown only to a studio with QuickBooks: without it there's nothing to
 * choose, and every job is the studio's to bill. Bills already raised stay
 * where they are; the choice decides the next one.
 */
export function JobBillingChoice({
  projectId,
  billing,
  onChanged,
}: {
  projectId: string;
  billing: JobBilling | null;
  onChanged: (message: string) => void;
}) {
  const workspace = useWorkspace();
  const [busy, setBusy] = useState<JobBillingMethod | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!billing || !["studio_owner", "studio_admin"].includes(String(workspace.role))) return null;
  if (!billing.canChoose) {
    return billing.reason === "quickbooks_disconnected" ? (
      <div className="job-billing-choice">
        <strong>How this job is billed</strong>
        <small>
          This job was set to bill through QuickBooks, which isn&rsquo;t connected now. Record its payments here, or
          reconnect QuickBooks in Integrations.
        </small>
      </div>
    ) : null;
  }

  async function choose(method: JobBillingMethod) {
    if (billing?.decided && billing.method === method) return;
    setBusy(method);
    setError(null);
    try {
      const result = await setJobBillingMethod({ projectId, method });
      onChanged(
        result.mode === "preview"
          ? "Preview mode: how this job is billed was not saved."
          : method === "quickbooks"
            ? "This job's bills go through QuickBooks from now on."
            : "You're billing this job yourself. Nothing new goes to QuickBooks.",
      );
    } catch (caught: unknown) {
      setError(friendlyError(caught, "How this job is billed couldn't be changed."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <fieldset className="job-billing-choice">
      <legend>How this job is billed</legend>
      {!billing.decided ? (
        <small>Not chosen yet. Choose before the first bill goes out.</small>
      ) : billing.reason === "existing_bills" ? (
        <small>This job already has bills in QuickBooks. New bills follow what you choose here.</small>
      ) : null}
      <div className="job-billing-options">
        {OPTIONS.map((option) => {
          const selected = billing.decided && billing.method === option.method;
          return (
            <label className={selected ? "job-billing-option is-selected" : "job-billing-option"} key={option.method}>
              <input
                checked={selected}
                disabled={busy !== null}
                name={`job-billing-${projectId}`}
                onChange={() => void choose(option.method)}
                type="radio"
              />
              <span>
                <strong>
                  {option.label}
                  {busy === option.method ? <LoaderCircle className="spin" size={14} /> : null}
                </strong>
                <small>{option.detail}</small>
              </span>
            </label>
          );
        })}
      </div>
      {error ? (
        <small className="form-notice" role="alert">
          {error}
        </small>
      ) : null}
    </fieldset>
  );
}
