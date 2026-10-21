"use client";

import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { refreshTenantRecords, useTenantDocuments } from "@/components/live/tenant-records";
import { ConfirmStep } from "@/components/ui/confirm-step";
import { useWorkspace } from "@/features/auth/workspace-context";
import { isStandingInvoice } from "@/features/booking/invoice-standing";
import { formatCentsExact } from "@/lib/format/money";
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
 * where they are; the choice decides the next one — except unpaid bills
 * StudioCue issued, which move with a switch to QuickBooks: voided, and the
 * deposit raised there at once (booking/job-billing-method.ts). The switch
 * says so first, by number.
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
  const [confirmingMove, setConfirmingMove] = useState(false);
  const { records: invoices } = useTenantDocuments("invoiceReferences");
  // Unpaid bills StudioCue issued on this job: a switch to QuickBooks voids them.
  const movingBills = (invoices ?? []).filter(
    (invoice) =>
      invoice.projectId === projectId &&
      invoice.billedBy === "studio" &&
      !invoice.provider &&
      isStandingInvoice(invoice.status) &&
      invoice.status !== "paid" &&
      Number(invoice.amountCents ?? 0) - Number(invoice.balanceCents ?? 0) <= 0,
  );
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

  async function choose(method: JobBillingMethod, confirmed = false) {
    if (billing?.decided && billing.method === method) return;
    if (method === "quickbooks" && movingBills.length && !confirmed) {
      setConfirmingMove(true);
      return;
    }
    setConfirmingMove(false);
    setBusy(method);
    setError(null);
    try {
      const result = await setJobBillingMethod({ projectId, method });
      const payload = result.mode === "live" ? result.payload : {};
      const voided = Array.isArray(payload.voided) ? (payload.voided as string[]) : [];
      if (voided.length) refreshTenantRecords("invoiceReferences", "projects");
      onChanged(
        result.mode === "preview"
          ? "Preview mode: how this job is billed was not saved."
          : method === "quickbooks"
            ? voided.length
              ? `${voided.join(" and ")} ${voided.length === 1 ? "is" : "are"} void, and this job bills through QuickBooks from now on.${payload.depositRaised ? " The deposit is going to QuickBooks now, and your client gets it with QuickBooks' pay link." : ""}`
              : "This job's bills go through QuickBooks from now on."
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
      {confirmingMove ? (
        <ConfirmStep
          busy={busy !== null}
          cancelLabel="Not now"
          confirmClassName="button button-dark"
          confirmLabel="Move it to QuickBooks"
          label="Move this job's bills to QuickBooks?"
          onCancel={() => setConfirmingMove(false)}
          onConfirm={() => void choose("quickbooks", true)}
        >
          {`${movingBills
            .map((invoice) => `${String(invoice.number ?? "An invoice")} (${formatCentsExact(Number(invoice.balanceCents ?? 0))})`)
            .join(" and ")} from StudioCue will be voided, and your client sees it marked void. ${
            movingBills.some((invoice) => invoice.kind === "retainer")
              ? "The deposit is raised in QuickBooks right away and emailed with its pay link, so your client can pay by card or bank transfer."
              : "Create the next bill from here and it goes through QuickBooks."
          }`}
        </ConfirmStep>
      ) : null}
      {error ? (
        <small className="form-notice" role="alert">
          {error}
        </small>
      ) : null}
    </fieldset>
  );
}
