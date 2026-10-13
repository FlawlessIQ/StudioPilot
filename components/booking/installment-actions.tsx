"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, LoaderCircle, Send } from "lucide-react";
import { refreshTenantRecords, useTenantDocuments } from "@/components/live/tenant-records";
import { ConfirmStep } from "@/components/ui/confirm-step";
import { useJobBilling } from "@/components/booking/use-job-billing";
import { useWorkspace } from "@/features/auth/workspace-context";
import { jobClientRecipient, recipientLabel } from "@/features/projects/client-recipient";
import { recordInstallmentPayment, sendInstallment } from "@/lib/booking/command-client";
import { friendlyError } from "@/lib/ai/friendly-error";
import { formatCentsAsNeeded } from "@/lib/format/money";
import { todayLocalIso } from "@/lib/format/event-date";

/**
 * A payment plan's next installment, due to be billed and not yet
 * (features/billing/payment-plan.ts): the two ways it gets settled, as the
 * final balance has (final-balance-actions.tsx). Send raises it through the
 * studio's invoicing provider — or drafts the studio's own invoice to check
 * and send; Paid another way records it paid for the agreed amount.
 */
export function InstallmentCardActions({
  projectId,
  sequence,
  amountCents,
  onCleared,
  primaryClassName = "today-card-primary",
  secondaryClassName = "today-card-secondary",
}: {
  projectId: string;
  sequence: number;
  amountCents: number;
  onCleared?: () => void;
  primaryClassName?: string;
  secondaryClassName?: string;
}) {
  const workspace = useWorkspace();
  const { records: projects } = useTenantDocuments("projects");
  const { records: contacts } = useTenantDocuments("contacts");
  const studioBilled = useJobBilling(projectId)?.method === "studio";
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"idle" | "confirm" | "record">("idle");
  const [paidAt, setPaidAt] = useState(todayLocalIso());
  const [method, setMethod] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const amount = formatCentsAsNeeded(amountCents);
  const recipient = recipientLabel(
    jobClientRecipient(
      projects?.find((project) => project.id === projectId),
      contacts,
    ),
  );
  const name = `installment ${sequence}`;

  if (!["studio_owner", "studio_admin"].includes(String(workspace.role ?? ""))) {
    return (
      <>
        <Link className={primaryClassName} href={`/studio/projects/${projectId}`}>
          Open the job <ArrowRight size={14} />
        </Link>
        <span className="today-card-notice">An owner or admin sends installments.</span>
      </>
    );
  }

  async function send() {
    setBusy(true);
    setNotice(null);
    try {
      await sendInstallment(projectId);
      refreshTenantRecords("invoiceReferences", "providerJobs", "pdfJobs", "projects");
      onCleared?.();
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, `The ${name} couldn't be sent. Open the job to check.`));
      setMode("idle");
      setBusy(false);
    }
  }

  async function record() {
    if (!method.trim()) {
      setNotice("Say how they paid — a transfer, cash, a check.");
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      await recordInstallmentPayment({ projectId, paidAt, method: method.trim(), reference: null });
      refreshTenantRecords("invoiceReferences", "projects");
      onCleared?.();
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, `The ${name} couldn't be recorded. Open the job to check.`));
      setBusy(false);
    }
  }

  if (mode === "confirm") {
    return (
      <ConfirmStep
        busy={busy}
        cancelClassName={secondaryClassName}
        cancelLabel="Not now"
        className="today-confirm-step"
        confirmClassName={primaryClassName}
        confirmLabel={`Send the ${amount} bill`}
        label={`Send ${name}?`}
        onCancel={() => setMode("idle")}
        onConfirm={() => void send()}
      >
        {`A ${amount} bill for ${name} goes to ${recipient ?? "the client"} by email from your invoicing app. Once it's out it can be voided, not unsent.`}
      </ConfirmStep>
    );
  }

  if (mode === "record") {
    return (
      <form
        className="installment-record"
        onSubmit={(event) => {
          event.preventDefault();
          void record();
        }}
      >
        <label>
          <span>Paid on</span>
          <input max={todayLocalIso()} onChange={(event) => setPaidAt(event.target.value)} required type="date" value={paidAt} />
        </label>
        <label>
          <span>How they paid</span>
          <input
            maxLength={200}
            onChange={(event) => setMethod(event.target.value)}
            placeholder="Bank transfer, cash, check…"
            value={method}
          />
        </label>
        <span className="installment-record-actions">
          <button className={primaryClassName} disabled={busy} type="submit">
            {busy ? <LoaderCircle className="spin" size={14} /> : null}
            {busy ? "Recording…" : `Record ${amount} paid`}
          </button>
          <button className={secondaryClassName} disabled={busy} onClick={() => setMode("idle")} type="button">
            Cancel
          </button>
        </span>
        {notice ? <span className="today-card-notice">{notice}</span> : null}
      </form>
    );
  }

  return (
    <>
      <button
        className={primaryClassName}
        disabled={busy}
        onClick={() => (studioBilled ? void send() : setMode("confirm"))}
        type="button"
      >
        {busy ? <LoaderCircle className="spin" size={14} /> : <Send size={14} />}
        {busy ? "Making it…" : studioBilled ? `Create the ${name} invoice` : `Send ${name}`}
      </button>
      <button className={secondaryClassName} disabled={busy} onClick={() => setMode("record")} type="button">
        Paid another way
      </button>
      <Link className={secondaryClassName} href={`/studio/projects/${projectId}`}>
        Open the job
      </Link>
      {notice ? <span className="today-card-notice">{notice}</span> : null}
    </>
  );
}
