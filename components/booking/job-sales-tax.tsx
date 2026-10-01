"use client";

import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useWorkspace } from "@/features/auth/workspace-context";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { normaliseBillingSettings } from "@/features/billing/sales-tax-settings";
import { setJobSalesTaxExempt } from "@/lib/booking/command-client";
import { friendlyError } from "@/lib/ai/friendly-error";

/**
 * "Don't charge sales tax on this job" — the job's exemption from the
 * studio's QuickBooks sales tax (projects.salesTaxExempt, set by
 * bookingCommand setJobSalesTaxExempt, owner/admin).
 *
 * Shown only where it means something: when the studio adds sales tax
 * through QuickBooks, or when this job is already exempt (so it can be
 * undone after the studio turns sales tax off).
 */
export function JobSalesTax({
  projectId,
  exempt,
  onChanged,
}: {
  projectId: string;
  exempt: boolean;
  onChanged: (message: string) => void;
}) {
  const workspace = useWorkspace();
  const { records } = useTenantDocuments("billingSettings");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!workspace.tenantId || !["studio_owner", "studio_admin"].includes(String(workspace.role))) return null;
  const settings = normaliseBillingSettings(
    records?.find((record) => record.tenantId === workspace.tenantId) ?? null,
    workspace.tenantId,
  );
  if (settings.salesTax.mode !== "quickbooks" && !exempt) return null;

  async function toggle(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      const result = await setJobSalesTaxExempt({ projectId, exempt: next });
      onChanged(
        result.mode === "preview"
          ? "Preview mode: the sales tax setting was not saved."
          : next
            ? "No sales tax will be added to this job's invoices."
            : "Sales tax will be added to this job's invoices again.",
      );
    } catch (caught: unknown) {
      setError(friendlyError(caught, "The sales tax setting couldn't be changed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="job-sales-tax">
      <label className="autopay-toggle">
        <input checked={exempt} disabled={busy} onChange={(event) => void toggle(event.target.checked)} type="checkbox" />
        <span>Don&rsquo;t charge sales tax on this job</span>
        {busy ? <LoaderCircle className="spin" size={14} /> : null}
      </label>
      <small>
        {exempt
          ? "This job's invoices go out with no sales tax — for a tax-exempt client or a job outside your tax area."
          : "QuickBooks adds sales tax for the couple's address on this job's final invoice."}
      </small>
      {error ? (
        <small className="form-notice" role="alert">
          {error}
        </small>
      ) : null}
    </div>
  );
}
