"use client";

import { useState } from "react";
import { FileText, LoaderCircle, Mail } from "lucide-react";
import {
  refreshTenantRecords,
  useTenantDocuments,
} from "@/components/live/tenant-records";
import { ConfirmStep } from "@/components/ui/confirm-step";
import { useWorkspace } from "@/features/auth/workspace-context";
import { invoiceKindLabel } from "@/features/billing/studio-invoice-document";
import { normaliseStudioInvoiceSettings, studioInvoicePaymentReady } from "@/features/billing/studio-invoice-settings";
import {
  jobClientRecipient,
  recipientLabel,
} from "@/features/projects/client-recipient";
import { isStandingInvoice } from "@/features/booking/invoice-standing";
import {
  createStudioDeposit,
  sendStudioInvoice,
} from "@/lib/booking/command-client";
import { resolveFile } from "@/lib/documents/resolve-file";
import { friendlyError } from "@/lib/ai/friendly-error";
import { formatCentsExact } from "@/lib/format/money";
import { formatDueDate } from "@/lib/format/event-date";

type Row = Record<string, unknown>;

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

/** A standing invoice the studio issued itself, on this job, of this kind. */
export function studioInvoiceOn(
  invoices: ReadonlyArray<Row> | null | undefined,
  projectId: string,
  kind: "retainer" | "final",
): Row | null {
  return (
    (invoices ?? [])
      .filter(
        (invoice) =>
          invoice.projectId === projectId &&
          invoice.kind === kind &&
          invoice.billedBy === "studio" &&
          !invoice.provider &&
          isStandingInvoice(invoice.status),
      )
      .sort((left, right) =>
        text(right.createdAt).localeCompare(text(left.createdAt)),
      )[0] ?? null
  );
}

/**
 * What a studio does with an invoice StudioCue issued for it (own
 * invoicing): email it to the client with its PDF, download the PDF to send
 * its own way and record that it went, or open it to check. Recording the
 * payment stays where it always was (the booking page, Today's "Paid").
 *
 * Shared by the booking page and Today's card, so both say the same thing.
 */
export function StudioInvoiceActions({
  invoice,
  onDone,
  primaryClassName = "button button-dark",
  secondaryClassName = "button button-light",
  compact = false,
}: {
  invoice: Row;
  onDone?: (message: string) => void;
  primaryClassName?: string;
  secondaryClassName?: string;
  /** Today's card: no summary line, the card already says it. */
  compact?: boolean;
}) {
  const workspace = useWorkspace();
  const { records: projects } = useTenantDocuments("projects");
  const { records: contacts } = useTenantDocuments("contacts");
  const { records: billingSettings } = useTenantDocuments("billingSettings");
  const [busy, setBusy] = useState<"email" | "self" | "pdf" | null>(null);
  const [confirming, setConfirming] = useState<"email" | "self" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pdfLink, setPdfLink] = useState<string | null>(null);
  const projectId = text(invoice.projectId);
  const recipient = recipientLabel(
    jobClientRecipient(
      projects?.find((project) => project.id === projectId),
      contacts,
    ),
  );
  // "Priya & Jordan", without the address, for a button; the confirm step names the address.
  const shortRecipient = recipient?.replace(/\s*\([^)]*\)\s*$/, "") || null;
  const number = text(invoice.number);
  const amount = formatCentsExact(Number(invoice.balanceCents ?? 0));
  const label = invoiceKindLabel(
    text(invoice.kind),
    invoice.paidInFull === true,
  ).toLowerCase();
  const draft = invoice.status === "draft";
  // Paid (or voided): nothing to send, only the PDF to open.
  const settled = Number(invoice.balanceCents ?? 0) <= 0;
  const pdfPath = text((invoice.pdf as Row | undefined)?.path);
  // No instructions and no pay link: the invoice can't say how to pay, so
  // the studio is told before it goes (Riley Park, Spin Theory DJs, prod
  // walk 2026-10-10: it went out saying nothing about paying).
  const paymentDetailsReady = studioInvoicePaymentReady(
    normaliseStudioInvoiceSettings(billingSettings?.find((record) => record.tenantId === workspace.tenantId) ?? null),
  );
  const howToPay = paymentDetailsReady
    ? "with the PDF attached and your payment details"
    : "with the PDF attached. You haven't added how clients pay you yet, so it won't say how to pay — add it first in Settings → Invoices and payments, or tell them yourself";
  const ownerOrAdmin =
    workspace.role === "studio_owner" || workspace.role === "studio_admin";

  async function send(via: "email" | "self") {
    setBusy(via);
    setNotice(null);
    try {
      const result = await sendStudioInvoice({
        invoiceId: text(invoice.id),
        via,
      });
      refreshTenantRecords("invoiceReferences", "emailJobs", "projects");
      const message =
        result.mode === "preview"
          ? "Preview mode: nothing was sent."
          : via === "email"
            ? `${number} is on its way to ${recipient ?? "the client"}, with the PDF attached.`
            : `${number} is marked sent. ${recipient ?? "The client"} can see it in their portal too.`;
      setNotice(message);
      onDone?.(message);
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "The invoice couldn't be sent."));
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  }

  /** The PDF, opened in a tab while the tap still counts; a link if blocked. */
  async function openPdf() {
    if (!pdfPath) {
      setNotice("The PDF is still being made. Try again in a moment.");
      refreshTenantRecords("invoiceReferences");
      return;
    }
    setBusy("pdf");
    setNotice(null);
    const tab = window.open("", "_blank");
    const result = await resolveFile(
      { kind: "storage", path: pdfPath, label: number },
      workspace.tenantId ?? null,
    );
    setBusy(null);
    if (result.status !== "ready") {
      tab?.close();
      setNotice(result.message);
      return;
    }
    if (tab) {
      tab.opener = null;
      tab.location.href = result.url;
    } else {
      setPdfLink(result.url);
    }
  }

  if (!ownerOrAdmin) {
    return (
      <p className="form-notice" role="status">
        {`${number} · ${amount}. An owner or admin sends it.`}
      </p>
    );
  }

  // Today's card: its buttons sit in the card's own action row, as the other
  // cards' do — a block of its own there squeezed the card's text to one word
  // a line (CLAUDE.md, UI layout).
  if (compact) {
    if (confirming) {
      return (
        <ConfirmStep
          busy={busy !== null}
          cancelClassName={secondaryClassName}
          cancelLabel="Not now"
          className="today-confirm-step"
          confirmClassName={primaryClassName}
          confirmLabel={
            confirming === "email" ? `Email ${number}` : "Mark it sent"
          }
          label={
            confirming === "email"
              ? `Email ${recipient ?? "the client"} this invoice?`
              : "Did you send it yourself?"
          }
          onCancel={() => setConfirming(null)}
          onConfirm={() => void send(confirming)}
        >
          {confirming === "email"
            ? `${recipient ?? "The client"} gets ${number} for ${amount} by email, ${howToPay}.`
            : `Records that you sent ${number} your own way. Nothing is emailed.`}
        </ConfirmStep>
      );
    }
    return (
      <>
        <button
          className={primaryClassName}
          disabled={busy !== null}
          onClick={() => setConfirming("email")}
          type="button"
        >
          {busy === "email" ? (
            <LoaderCircle className="spin" size={14} />
          ) : (
            <Mail size={14} />
          )}
          Email it
        </button>
        {pdfLink ? (
          <a
            className={secondaryClassName}
            href={pdfLink}
            rel="noreferrer"
            target="_blank"
          >
            Open the PDF
          </a>
        ) : (
          <button
            className={secondaryClassName}
            disabled={busy !== null}
            onClick={() => void openPdf()}
            type="button"
          >
            Download PDF
          </button>
        )}
        {draft ? (
          <button
            className={secondaryClassName}
            disabled={busy !== null}
            onClick={() => setConfirming("self")}
            type="button"
          >
            I sent it myself
          </button>
        ) : null}
        {notice ? (
          <span className="today-card-notice" role="status">
            {notice}
          </span>
        ) : null}
      </>
    );
  }

  return (
    <div className="studio-invoice-actions">
      {compact ? null : (
        <p className="studio-invoice-summary">
          <strong>{`${number} · ${amount}`}</strong>
          <span>
            {settled
              ? `Paid in full. The PDF shows the payment${Array.isArray(invoice.studioPayments) && invoice.studioPayments.length > 1 ? "s" : ""}.`
              : draft
                ? `Your ${label} invoice is ready${text(invoice.dueDate) ? `, due ${formatDueDate(invoice.dueDate)}` : ""}. Nothing has gone to ${recipient ?? "the client"} yet.`
                : `Sent ${formatDueDate(text(invoice.sentAt).slice(0, 10))}${invoice.sentVia === "self" ? " by you" : " by email"}${text(invoice.dueDate) ? ` · due ${formatDueDate(invoice.dueDate)}` : ""}.`}
          </span>
        </p>
      )}
      {confirming ? (
        <ConfirmStep
          busy={busy !== null}
          cancelClassName={secondaryClassName}
          cancelLabel="Not now"
          confirmClassName={primaryClassName}
          confirmLabel={
            confirming === "email" ? `Email ${number}` : "Mark it sent"
          }
          label={
            confirming === "email"
              ? `Email ${recipient ?? "the client"} this invoice?`
              : "Did you send it yourself?"
          }
          onCancel={() => setConfirming(null)}
          onConfirm={() => void send(confirming)}
        >
          {confirming === "email"
            ? `${recipient ?? "The client"} gets ${number} for ${amount} by email, ${howToPay}. It's also in their portal.`
            : `Records that you sent ${number} your own way. Nothing is emailed; ${recipient ?? "the client"} can see it in their portal.`}
        </ConfirmStep>
      ) : (
        <div className="studio-invoice-buttons">
          {settled ? null : (
            <button
              className={primaryClassName}
              disabled={busy !== null}
              onClick={() => setConfirming("email")}
              type="button"
            >
              {busy === "email" ? (
                <LoaderCircle className="spin" size={14} />
              ) : (
                <Mail size={14} />
              )}
              {draft
                ? `Email it to ${shortRecipient ?? "the client"}`
                : "Email it again"}
            </button>
          )}
          {pdfLink ? (
            <a
              className={secondaryClassName}
              href={pdfLink}
              rel="noreferrer"
              target="_blank"
            >
              <FileText size={14} /> Open the PDF
            </a>
          ) : (
            <button
              className={secondaryClassName}
              disabled={busy !== null}
              onClick={() => void openPdf()}
              type="button"
            >
              {busy === "pdf" ? (
                <LoaderCircle className="spin" size={14} />
              ) : (
                <FileText size={14} />
              )}
              Download PDF
            </button>
          )}
          {draft ? (
            <button
              className={secondaryClassName}
              disabled={busy !== null}
              onClick={() => setConfirming("self")}
              type="button"
            >
              I sent it myself
            </button>
          ) : null}
        </div>
      )}
      {notice ? (
        <p className="form-notice" role="status">
          {notice}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The deposit on a job the studio bills itself, on the booking page: its
 * invoice and what to do with it, or — where none was drafted (a job booked
 * before own invoicing, or a voided one) — the button that drafts it.
 */
export function StudioDepositPanel({
  projectId,
  canCreate,
  onDone,
}: {
  projectId: string;
  /** The job is waiting on its deposit (RETAINER_PENDING). */
  canCreate: boolean;
  onDone?: (message: string) => void;
}) {
  const workspace = useWorkspace();
  const { records: invoices } = useTenantDocuments("invoiceReferences");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const deposit = studioInvoiceOn(invoices, projectId, "retainer");
  if (deposit)
    return <StudioInvoiceActions invoice={deposit} onDone={onDone} />;
  if (
    !canCreate ||
    !(workspace.role === "studio_owner" || workspace.role === "studio_admin")
  )
    return null;
  return (
    <div className="studio-invoice-actions">
      <button
        className="button button-dark"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setNotice(null);
          void createStudioDeposit(projectId)
            .then((result) => {
              refreshTenantRecords("invoiceReferences", "pdfJobs");
              const message =
                result.mode === "preview"
                  ? "Preview mode: no invoice was made."
                  : "The deposit invoice is ready, with its PDF. Check it, then email it or send it yourself.";
              setNotice(message);
              onDone?.(message);
            })
            .catch((caught: unknown) =>
              setNotice(
                friendlyError(caught, "The deposit invoice couldn't be made."),
              ),
            )
            .finally(() => setBusy(false));
        }}
        type="button"
      >
        {busy ? (
          <LoaderCircle className="spin" size={14} />
        ) : (
          <FileText size={14} />
        )}
        Create the deposit invoice
      </button>
      {notice ? (
        <p className="form-notice" role="status">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
