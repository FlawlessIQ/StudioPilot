"use client";

import { useState } from "react";
import { FileText, LoaderCircle, Trash2 } from "lucide-react";
import {
  refreshTenantRecords,
  useTenantDocuments,
} from "@/components/live/tenant-records";
import { ConfirmStep } from "@/components/ui/confirm-step";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { useWorkspace } from "@/features/auth/workspace-context";
import { invoiceDeletePlan } from "@/features/billing/invoice-purge-policy";
import type { LedgerRow } from "@/features/billing/invoice-ledger";
import {
  hasFinalBalance,
  projectProfile,
} from "@/features/job-kinds/job-kinds";
import { deleteInvoiceRecords } from "@/lib/booking/command-client";
import { resolveFile } from "@/lib/documents/resolve-file";
import { friendlyError } from "@/lib/ai/friendly-error";

type Row = Record<string, unknown>;

/**
 * What deleting this bill does, in the studio's words, before it does it
 * (features/billing/invoice-purge-policy.ts decides; the server checks again).
 */
function consequence(
  invoice: Row,
  invoices: readonly Row[],
  project: Row | undefined,
): { ok: boolean; words: string } {
  const plan = invoiceDeletePlan({
    invoice,
    others: invoices.filter(
      (other) =>
        other.id !== invoice.id && other.projectId === invoice.projectId,
    ),
    project,
    jobHasFinalBalance: hasFinalBalance(projectProfile(project ?? {})),
    inFlight: false,
  });
  if (!plan.allowed) {
    return {
      ok: false,
      words:
        plan.reason === "INVOICE_PARTLY_PAID"
          ? "It's part paid. Record the rest, or void it, first."
          : plan.reason === "INVOICE_STILL_NEEDED"
            ? "The final balance is worked out from this deposit. Delete it once the final is paid."
            : "It's being worked on right now. Try again shortly.",
    };
  }
  const source =
    invoice.provider === "quickbooks"
      ? " It stays in QuickBooks; only StudioCue's copy goes."
      : "";
  return {
    ok: true,
    words: plan.settles
      ? `It's paid, so the job keeps a note that it was settled — no amounts — and stays booked.${source} Its PDF, emails and reminders go; the audit trail keeps that it happened, without the money. This can't be undone.`
      : `It isn't paid, so whatever it covered is owed again.${source} Its PDF, emails and reminders go. This can't be undone.`,
  };
}

/** "Delete" on one row of the Invoices ledger (owner/admin). */
export function DeleteInvoiceButton({
  row,
  onDone,
}: {
  row: LedgerRow;
  onDone?: (message: string) => void;
}) {
  const workspace = useWorkspace();
  const { records: invoices } = useTenantDocuments("invoiceReferences");
  const { records: projects } = useTenantDocuments("projects");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!["studio_owner", "studio_admin"].includes(String(workspace.role)))
    return null;
  const invoice = invoices?.find((candidate) => candidate.id === row.id);
  if (!invoice) return null;
  const project = projects?.find((candidate) => candidate.id === row.projectId);
  const outcome = consequence(invoice, invoices ?? [], project);

  if (!confirming) {
    return (
      <button
        aria-label={`Delete ${row.number || "this invoice"}`}
        className="invoice-ledger-pdf"
        onClick={() => setConfirming(true)}
        title="Delete this invoice record"
        type="button"
      >
        <Trash2 size={14} />
      </button>
    );
  }
  return (
    <div className="invoice-ledger-delete">
      {outcome.ok ? (
        <ConfirmStep
          busy={busy}
          cancelLabel="Keep it"
          confirmLabel={`Delete ${row.number || "it"}`}
          danger
          label={`Delete ${row.number || "this invoice"}?`}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setBusy(true);
            setError(null);
            void deleteInvoiceRecords({
              projectId: row.projectId,
              invoiceId: row.id,
            })
              .then((result) => {
                refreshTenantRecords(
                  "invoiceReferences",
                  "projects",
                  "documents",
                );
                onDone?.(
                  result.mode === "preview"
                    ? "Preview mode: nothing was deleted."
                    : `${row.number || "The invoice"} is deleted.`,
                );
                setConfirming(false);
              })
              .catch((caught: unknown) =>
                setError(
                  friendlyError(caught, "The invoice couldn't be deleted."),
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          {outcome.words}
        </ConfirmStep>
      ) : (
        <p className="form-notice" role="status">
          {outcome.words}{" "}
          <button
            className="button button-quiet button-sm"
            onClick={() => setConfirming(false)}
            type="button"
          >
            OK
          </button>
        </p>
      )}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * "Delete this job's invoice records" (owner/admin): every bill on the job,
 * all or nothing, with its PDFs offered first and the job's name typed.
 */
export function DeleteJobInvoices({
  projectId,
  rows,
}: {
  projectId: string;
  rows: readonly LedgerRow[];
}) {
  const workspace = useWorkspace();
  const { records: invoices } = useTenantDocuments("invoiceReferences");
  const { records: projects } = useTenantDocuments("projects");
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (
    !["studio_owner", "studio_admin"].includes(String(workspace.role)) ||
    !rows.length
  )
    return null;
  const project = projects?.find((candidate) => candidate.id === projectId);
  const jobName = String(project?.name ?? "");
  const mine = (invoices ?? []).filter(
    (invoice) => invoice.projectId === projectId,
  );
  const blocked = mine
    .map((invoice) => ({
      invoice,
      outcome: consequence(
        invoice,
        mine.filter((other) => other.id !== invoice.id),
        project,
      ),
    }))
    .filter((entry) => !entry.outcome.ok);
  const matches =
    typed.trim().toLowerCase().replace(/\s+/g, " ") ===
    jobName.trim().toLowerCase().replace(/\s+/g, " ");

  async function openPdf(row: LedgerRow) {
    if (!row.pdfPath) return;
    const tab = window.open("", "_blank");
    const result = await resolveFile(
      { kind: "storage", path: row.pdfPath, label: row.number },
      workspace.tenantId ?? null,
    );
    if (result.status !== "ready" || !tab) {
      tab?.close();
      setError(
        result.status !== "ready"
          ? result.message
          : "Allow pop-ups to open the PDF.",
      );
      return;
    }
    tab.opener = null;
    tab.location.href = result.url;
  }

  return (
    <div className="invoice-ledger-job-delete">
      {message ? (
        <p className="form-notice" role="status">
          {message}
        </p>
      ) : null}
      <button
        className="button button-light button-sm"
        onClick={() => setOpen(true)}
        type="button"
      >
        <Trash2 size={14} /> Delete this job&rsquo;s invoice records
      </button>
      <SheetDialog
        label={`Delete ${jobName || "this job"}'s invoice records?`}
        onClose={() => setOpen(false)}
        open={open}
      >
        <section className="panel invoice-delete-sheet">
          <h2>{`Delete ${jobName || "this job"}'s invoice records?`}</h2>
          <p>
            Every bill on this job goes, with its PDFs, emails and reminders.
            Paid ones leave a note on the job that they were settled — no
            amounts — so it stays booked and closes out. Bills in QuickBooks
            stay there; only StudioCue&rsquo;s copy goes. The audit trail keeps
            that this happened, without the money. This can&rsquo;t be undone.
          </p>
          {rows.some((row) => row.pdfPath) ? (
            <div className="invoice-delete-pdfs">
              <strong>Download the PDFs first</strong>
              {rows
                .filter((row) => row.pdfPath)
                .map((row) => (
                  <button
                    className="invoice-ledger-pdf"
                    key={row.id}
                    onClick={() => void openPdf(row)}
                    type="button"
                  >
                    <FileText size={14} /> {row.number || "Invoice"}
                  </button>
                ))}
            </div>
          ) : null}
          {blocked.length ? (
            <p className="form-notice" role="status">
              {`Not yet: ${blocked.map((entry) => `${String(entry.invoice.number ?? "a bill")} — ${entry.outcome.words}`).join(" ")}`}
            </p>
          ) : (
            <label className="invoice-delete-confirm">
              {`Type the job's name to confirm: ${jobName}`}
              <input
                autoComplete="off"
                onChange={(event) => setTyped(event.target.value)}
                value={typed}
              />
            </label>
          )}
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="invoice-delete-actions">
            {blocked.length ? null : (
              <button
                className="button button-danger"
                disabled={busy || !matches || blocked.length > 0}
                onClick={() => {
                  setBusy(true);
                  setError(null);
                  void deleteInvoiceRecords({
                    projectId,
                    invoiceId: null,
                    confirmation: typed,
                  })
                    .then((result) => {
                      refreshTenantRecords(
                        "invoiceReferences",
                        "projects",
                        "documents",
                      );
                      setMessage(
                        result.mode === "preview"
                          ? "Preview mode: nothing was deleted."
                          : "This job's invoice records are deleted.",
                      );
                      setOpen(false);
                      setTyped("");
                    })
                    .catch((caught: unknown) =>
                      setError(
                        friendlyError(
                          caught,
                          "The invoice records couldn't be deleted.",
                        ),
                      ),
                    )
                    .finally(() => setBusy(false));
                }}
                type="button"
              >
                {busy ? (
                  <LoaderCircle className="spin" size={14} />
                ) : (
                  <Trash2 size={14} />
                )}
                Delete them
              </button>
            )}
            <button
              className="button button-light"
              disabled={busy}
              onClick={() => setOpen(false)}
              type="button"
            >
              {blocked.length ? "Close" : "Keep them"}
            </button>
          </div>
        </section>
      </SheetDialog>
    </div>
  );
}
