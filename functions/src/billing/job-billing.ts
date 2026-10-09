/**
 * The functions copy of features/billing/job-billing.ts.
 *
 * functions/ is a separate package with no "@/features" path, so the rules
 * are duplicated here. Everything below the marker must match the features
 * copy exactly; tests/job-billing.test.ts fails on a drift.
 */

// --- shared with functions/src/billing/job-billing.ts ---
export type JobBillingMethod = "quickbooks" | "studio";

export type JobBillingReason =
  /** No QuickBooks connected: the studio bills it, and is never asked. */
  | "only_option"
  /** The studio chose, on this job. */
  | "chosen"
  /** Not chosen, but this job already has bills at QuickBooks. */
  | "existing_bills"
  /** Not chosen yet: the studio's last choice, or QuickBooks. */
  | "suggested"
  /** Chosen for QuickBooks, which is no longer connected. */
  | "quickbooks_disconnected";

export type JobBilling = {
  /** How a bill raised on this job now would go. */
  method: JobBillingMethod;
  /** A person decided, or there was nothing to decide. False: ask on the first bill. */
  decided: boolean;
  /** Both ways are open, so the job can be switched. */
  canChoose: boolean;
  reason: JobBillingReason;
};

export function isJobBillingMethod(value: unknown): value is JobBillingMethod {
  return value === "quickbooks" || value === "studio";
}

/** `projects.billing.method`, or null when the job has none. */
export function chosenJobBillingMethod(project: unknown): JobBillingMethod | null {
  if (typeof project !== "object" || project === null) return null;
  const billing = (project as { billing?: unknown }).billing;
  if (typeof billing !== "object" || billing === null) return null;
  const method = (billing as { method?: unknown }).method;
  return isJobBillingMethod(method) ? method : null;
}

/**
 * How this job is billed.
 *
 * `quickbooksReady`: QuickBooks resolves as the studio's invoicing provider
 * now (connected, not archived; see resolveActiveProvider).
 * `hasQuickBooksBills`: the job has a standing bill whose provider is
 * QuickBooks. `lastChoice`: `billingSettings.lastJobBillingMethod`.
 */
export function jobBilling(input: {
  project: unknown;
  quickbooksReady: boolean;
  hasQuickBooksBills?: boolean;
  lastChoice?: unknown;
}): JobBilling {
  const chosen = chosenJobBillingMethod(input.project);
  if (!input.quickbooksReady) {
    return {
      method: "studio",
      decided: true,
      canChoose: false,
      reason: chosen === "quickbooks" ? "quickbooks_disconnected" : "only_option",
    };
  }
  if (chosen) return { method: chosen, decided: true, canChoose: true, reason: "chosen" };
  if (input.hasQuickBooksBills === true) {
    return { method: "quickbooks", decided: true, canChoose: true, reason: "existing_bills" };
  }
  return {
    method: isJobBillingMethod(input.lastChoice) ? input.lastChoice : "quickbooks",
    decided: false,
    canChoose: true,
    reason: "suggested",
  };
}

/** A standing bill (not failed, superseded or voided) raised through QuickBooks. */
export function isQuickBooksBill(invoice: { provider?: unknown; status?: unknown }): boolean {
  return (
    invoice.provider === "quickbooks" &&
    invoice.status !== "failed" &&
    invoice.status !== "superseded" &&
    invoice.status !== "voided"
  );
}
