import { createHash } from "node:crypto";
import type { DocumentSnapshot, Firestore, Transaction } from "firebase-admin/firestore";
import { agreedRetainerCents } from "../booking/agreed-retainer.js";
import { isStandingInvoice } from "../booking/invoice-standing.js";
import { projectProfile } from "../job-kinds/job-kinds.js";
import { combinedSnapshot, readJobSnapshots } from "../packages/combined-snapshot.js";
import { reserveInvoiceNumber } from "./invoice-number.js";
import { queueStudioInvoicePdf, type InvoiceWriter } from "./studio-invoice-pdf.js";
import { normaliseStudioInvoiceSettings, studioInvoiceTaxCents } from "./studio-invoice-settings.js";

/**
 * Drafting an invoice the studio issues itself (own invoicing, Phase 2;
 * docs/own-invoicing-plan-2026-10-09.md).
 *
 * A draft is numbered and rendered at once, so the studio can look at the
 * exact PDF before it goes; nothing reaches the client until the studio
 * sends it (bookingCommand sendStudioInvoice). Drafting is never billing:
 * the deposit on signing and the deposit for a job with no agreement draft
 * one automatically, the way a QuickBooks job raises its retainer.
 *
 * Tax: the studio's own rate (Settings → Invoices and payments) goes on the
 * bill that completes the price — a paid-in-full payment, the final balance
 * — never on a deposit, which is a part of the agreed price. That is how a
 * QuickBooks job is taxed too (on its final invoice). A job exempted from
 * sales tax (`projects.salesTaxExempt`) is never taxed.
 */

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

export function stableInvoiceId(...parts: string[]): string {
  return `invoice_studio_${createHash("sha256").update(parts.join(":")).digest("hex").slice(0, 32)}`;
}

/** The project's local calendar day, plus `days`. */
export function dueInDays(days: number, nowIso: string, timeZone: string): string {
  let today = nowIso.slice(0, 10);
  if (timeZone) {
    try {
      today = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
        new Date(nowIso),
      );
    } catch {
      // An unknown zone still gets a due date.
    }
  }
  const value = new Date(`${today}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + Math.max(0, Math.round(days)));
  return value.toISOString().slice(0, 10);
}

export type StudioInvoiceDraft = {
  kind: "retainer" | "final";
  paidInFull: boolean;
  /** Pre-tax. */
  subtotalCents: number;
  /** Tax goes on the bill that completes the price. */
  completesPrice: boolean;
  lines: Array<{ description: string; quantity: number; unitAmountCents: number; amountCents: number }>;
  currency: string;
  dueDate: string;
};

/** A deposit (or the whole price, for a job paid in full), as a draft. */
export function depositDraft(input: {
  amountCents: number;
  paidInFull: boolean;
  packageName: string;
  currency: string;
  dueDate: string;
}): StudioInvoiceDraft {
  const description = input.paidInFull ? input.packageName : `Deposit · ${input.packageName}`;
  return {
    kind: "retainer",
    paidInFull: input.paidInFull,
    subtotalCents: input.amountCents,
    completesPrice: input.paidInFull,
    lines: [{ description, quantity: 1, unitAmountCents: input.amountCents, amountCents: input.amountCents }],
    currency: input.currency,
    dueDate: input.dueDate,
  };
}

/**
 * Re-render the PDF of an invoice the studio issued, after something on it
 * changed (a payment, a void). A no-op for any other invoice. The caller
 * already holds the invoice; pass the writer the change is going out with.
 */
export function requeueStudioInvoicePdf(
  db: Firestore,
  writer: InvoiceWriter,
  invoice: DocumentSnapshot,
  now: string,
): void {
  if (invoice.get("billedBy") !== "studio" || invoice.get("provider")) return;
  const revision = queueStudioInvoicePdf(db, writer, {
    tenantId: text(invoice.get("tenantId")),
    projectId: text(invoice.get("projectId")),
    invoiceId: invoice.id,
    currentRevision: invoice.get("pdfRevision"),
    now,
  });
  writer.set(invoice.ref, { pdfRevision: revision }, { merge: true });
}

/**
 * Write the draft, numbered, with its first PDF queued. Reads first (the
 * invoice, the counter, the settings, the job), then writes, in one
 * transaction. Idempotent on `invoiceId`.
 */
export async function writeStudioInvoiceDraft(
  db: Firestore,
  transaction: Transaction,
  input: { tenantId: string; projectId: string; invoiceId: string; draft: StudioInvoiceDraft; actor: string; now: string },
): Promise<{ created: boolean; invoiceId: string; number: string | null }> {
  const invoiceReference = db.doc(`invoiceReferences/${input.invoiceId}`);
  const [existing, settingsDoc, project] = await Promise.all([
    transaction.get(invoiceReference),
    transaction.get(db.doc(`billingSettings/${input.tenantId}`)),
    transaction.get(db.doc(`projects/${input.projectId}`)),
  ]);
  if (existing.exists) return { created: false, invoiceId: input.invoiceId, number: text(existing.get("number")) || null };
  if (!project.exists || project.get("tenantId") !== input.tenantId) throw new Error("PROJECT_NOT_FOUND");
  const reserved = await reserveInvoiceNumber(db, transaction, input.tenantId, input.now);
  const settings = normaliseStudioInvoiceSettings(
    settingsDoc.exists && settingsDoc.get("tenantId") === input.tenantId ? settingsDoc.data() : null,
  );
  const draft = input.draft;
  const taxCents =
    draft.completesPrice && project.get("salesTaxExempt") !== true
      ? studioInvoiceTaxCents(draft.subtotalCents, settings)
      : 0;
  const amountCents = draft.subtotalCents + taxCents;
  reserved.commit();
  transaction.set(invoiceReference, {
    id: input.invoiceId,
    tenantId: input.tenantId,
    projectId: input.projectId,
    kind: draft.kind,
    paidInFull: draft.paidInFull,
    provider: null,
    providerState: "not_applicable",
    billedBy: "studio",
    number: reserved.number,
    status: "draft",
    currency: draft.currency,
    amountCents,
    balanceCents: amountCents,
    taxCents,
    lines: draft.lines,
    dueDate: draft.dueDate,
    issuedAt: input.now,
    sentAt: null,
    sentBy: null,
    hostedUrl: null,
    lastSyncedAt: null,
    lastProviderEventId: null,
    createdAt: input.now,
    updatedAt: input.now,
    createdBy: input.actor,
    updatedBy: input.actor,
    archivedAt: null,
    pdfRevision: queueStudioInvoicePdf(db, transaction, {
      tenantId: input.tenantId,
      projectId: input.projectId,
      invoiceId: input.invoiceId,
      currentRevision: 0,
      now: input.now,
    }),
  });
  return { created: true, invoiceId: input.invoiceId, number: reserved.number };
}

/**
 * Draft the deposit for a job the studio bills itself, if it has no
 * standing retainer yet: the agreed deposit, or the whole agreed price for a
 * job paid in full, due on the studio's terms.
 */
export async function draftStudioDeposit(
  db: Firestore,
  input: { tenantId: string; projectId: string; trigger: string; actor: string; now?: string },
): Promise<{ created: boolean; invoiceId: string | null; reason?: string }> {
  const now = input.now ?? new Date().toISOString();
  const [project, retainers, settingsDoc] = await Promise.all([
    db.doc(`projects/${input.projectId}`).get(),
    db
      .collection("invoiceReferences")
      .where("tenantId", "==", input.tenantId)
      .where("projectId", "==", input.projectId)
      .where("kind", "==", "retainer")
      .limit(10)
      .get(),
    db.doc(`billingSettings/${input.tenantId}`).get(),
  ]);
  if (!project.exists || project.get("tenantId") !== input.tenantId) return { created: false, invoiceId: null, reason: "no_project" };
  const standing = retainers.docs.find((invoice) => isStandingInvoice(invoice.get("status")));
  if (standing) return { created: false, invoiceId: standing.id, reason: "retainer_exists" };
  const packageSnapshotId = text(project.get("packageSnapshotId"));
  const snapshots = packageSnapshotId ? await readJobSnapshots(db, project.data() ?? {}, input.tenantId) : [];
  if (!snapshots.length || snapshots[0]!.id !== packageSnapshotId) return { created: false, invoiceId: null, reason: "no_package" };
  const snapshot = combinedSnapshot(snapshots);
  const amountCents = await agreedRetainerCents(db, input.tenantId, input.projectId, snapshot);
  if (!Number.isInteger(amountCents) || amountCents <= 0) return { created: false, invoiceId: null, reason: "nothing_owed" };
  const settings = normaliseStudioInvoiceSettings(
    settingsDoc.exists && settingsDoc.get("tenantId") === input.tenantId ? settingsDoc.data() : null,
  );
  const invoiceId = stableInvoiceId(input.tenantId, input.projectId, "deposit", input.trigger);
  const draft = depositDraft({
    amountCents,
    paidInFull: projectProfile(project.data()).payment === "paid_in_full",
    packageName: text(snapshot.get("packageName")) || "Your booking",
    currency: text(snapshot.get("currency")) || "USD",
    dueDate: dueInDays(settings.dueDays, now, text(project.get("timezone"))),
  });
  const written = await db.runTransaction((transaction) =>
    writeStudioInvoiceDraft(db, transaction, {
      tenantId: input.tenantId,
      projectId: input.projectId,
      invoiceId,
      draft,
      actor: input.actor,
      now,
    }),
  );
  return { created: written.created, invoiceId };
}
