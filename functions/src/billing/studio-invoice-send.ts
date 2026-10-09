import { createHash } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { z } from "zod";
import { jobBillingFor } from "./job-billing-reader.js";
import { draftStudioDeposit } from "./studio-invoice-issue.js";
import { invoicePdfDocumentId } from "./studio-invoice-pdf.js";
import { invoiceDate, invoiceKindLabel, invoiceMoney } from "./studio-invoice-document.js";
import { normaliseStudioInvoiceSettings } from "./studio-invoice-settings.js";

/**
 * Sending an invoice the studio issued itself (own invoicing, Phase 2), and
 * drafting a deposit by hand where none was drafted for it.
 *
 * Two ways out, the studio's choice on each send:
 * - **email**: StudioCue emails the client the invoice with its PDF attached
 *   and a Pay button (the studio's own link) or the portal;
 * - **self**: the studio sends it its own way (downloaded PDF, a text) and
 *   records that it went.
 * Either way the invoice becomes the client's to see in their portal.
 * Owner/admin, audited, through bookingCommand only.
 */

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

type CommandContext = {
  tenantId: string;
  membership: Record<string, unknown>;
  actorId: string;
  timestamp: string;
  idempotencyKey: string;
  ipAddress: string | null;
  userAgent: string | null;
};

function requireOwnerOrAdmin(membership: Record<string, unknown>) {
  if (!["studio_owner", "studio_admin"].includes(String(membership.role))) throw new Error("BILLING_PERMISSION_REQUIRED");
}

const auditId = (prefix: string, context: CommandContext) =>
  `audit_${prefix}_${createHash("sha256").update(`${context.tenantId}:${context.idempotencyKey}`).digest("hex").slice(0, 32)}`;

export const sendStudioInvoiceInput = z.object({
  invoiceId: z.string().min(1).max(200),
  via: z.enum(["email", "self"]),
});

export async function sendStudioInvoice(context: CommandContext, input: z.infer<typeof sendStudioInvoiceInput>) {
  requireOwnerOrAdmin(context.membership);
  const db = getFirestore();
  const invoiceReference = db.doc(`invoiceReferences/${input.invoiceId}`);
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://studio-cue.com").replace(/\/$/, "");
  return db.runTransaction(async (transaction) => {
    const invoice = await transaction.get(invoiceReference);
    if (!invoice.exists || invoice.get("tenantId") !== context.tenantId) throw new Error("INVOICE_NOT_FOUND");
    if (invoice.get("billedBy") !== "studio" || invoice.get("provider")) throw new Error("NOT_A_STUDIO_INVOICE");
    const status = text(invoice.get("status"));
    // An email can go again (they lost it); recording "I sent it" only once.
    if (!["draft", "sent", "partially_paid", "overdue"].includes(status) || Number(invoice.get("balanceCents")) <= 0)
      throw new Error("INVOICE_NOT_SENDABLE");
    if (input.via === "self" && status !== "draft") return { invoiceId: invoice.id, status, alreadySent: true };
    const projectId = text(invoice.get("projectId"));
    const [project, settingsDoc] = await Promise.all([
      transaction.get(db.doc(`projects/${projectId}`)),
      transaction.get(db.doc(`billingSettings/${context.tenantId}`)),
    ]);
    if (!project.exists || project.get("tenantId") !== context.tenantId) throw new Error("PROJECT_NOT_FOUND");
    const contactIds = Array.isArray(project.get("clientContactIds")) ? (project.get("clientContactIds") as unknown[]) : [];
    const contactId = contactIds.find((value): value is string => typeof value === "string" && value.length > 0);
    const contact = contactId ? await transaction.get(db.doc(`contacts/${contactId}`)) : null;
    const email = contact?.exists && contact.get("tenantId") === context.tenantId ? text(contact.get("email")) : "";
    if (input.via === "email" && !email) throw new Error("CLIENT_EMAIL_REQUIRED");
    const settings = normaliseStudioInvoiceSettings(
      settingsDoc.exists && settingsDoc.get("tenantId") === context.tenantId ? settingsDoc.data() : null,
    );
    const now = context.timestamp;
    const firstSend = status === "draft";
    transaction.update(invoiceReference, {
      ...(firstSend ? { status: "sent", sentAt: now, sentBy: context.actorId } : {}),
      sentVia: input.via,
      ...(input.via === "email" ? { lastEmailedAt: now } : {}),
      updatedAt: now,
      updatedBy: context.actorId,
    });
    let emailJobId: string | null = null;
    if (input.via === "email") {
      emailJobId = `studio_invoice_${invoice.id}_${createHash("sha256").update(context.idempotencyKey).digest("hex").slice(0, 12)}`;
      const payLink = text(invoice.get("payLinkUrl")) || settings.payLinkUrl;
      const kind = text(invoice.get("kind"));
      transaction.set(db.doc(`emailJobs/${emailJobId}`), {
        id: emailJobId,
        tenantId: context.tenantId,
        projectId,
        invoiceId: invoice.id,
        type: kind === "final" ? "final_invoice" : "retainer_invoice",
        recipient: email,
        recipientName: contact ? text(contact.get("displayName")) || null : null,
        // The invoice the studio issued: its PDF travels with the email
        // (operations/jobs.ts), and the words come from it, not QuickBooks.
        billedBy: "studio",
        attachmentDocumentId: invoicePdfDocumentId(invoice.id),
        invoiceNumber: text(invoice.get("number")),
        invoiceKindLabel: invoiceKindLabel(kind, invoice.get("paidInFull") === true),
        amountLabel: invoiceMoney(Number(invoice.get("balanceCents")), text(invoice.get("currency")) || "USD"),
        dueLabel: text(invoice.get("dueDate")) ? invoiceDate(text(invoice.get("dueDate"))) : null,
        paymentInstructions: settings.paymentInstructions,
        payLinkUrl: payLink,
        invoiceUrl: payLink ?? `${appUrl}/client/payments`,
        actionUrl: payLink ?? `${appUrl}/client/payments`,
        status: "queued",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      });
    }
    transaction.create(db.doc(`auditEvents/${auditId("studio_invoice_sent", context)}`), {
      id: auditId("studio_invoice_sent", context),
      tenantId: context.tenantId,
      projectId,
      actorId: context.actorId,
      actorType: "user",
      action: input.via === "email" ? "invoice.studio_emailed" : "invoice.studio_marked_sent",
      entityType: "invoiceReference",
      entityId: invoice.id,
      timestamp: now,
      before: { status },
      after: { status: firstSend ? "sent" : status, via: input.via, number: text(invoice.get("number")) },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      correlationId: context.idempotencyKey,
      automationRunId: null,
      providerEventId: null,
    });
    return { invoiceId: invoice.id, status: firstSend ? "sent" : status, via: input.via, emailJobId };
  });
}

export const createStudioDepositInput = z.object({ projectId: z.string().min(1).max(200) });

/**
 * "Create the deposit invoice" on a job the studio bills itself, where none
 * was drafted (a job booked before own invoicing, or one whose deposit was
 * voided). The same draft the signature makes.
 */
export async function createStudioDeposit(context: CommandContext, input: z.infer<typeof createStudioDepositInput>) {
  requireOwnerOrAdmin(context.membership);
  const db = getFirestore();
  const project = await db.doc(`projects/${input.projectId}`).get();
  if (!project.exists || project.get("tenantId") !== context.tenantId) throw new Error("PROJECT_NOT_FOUND");
  if (project.get("state") !== "RETAINER_PENDING") throw new Error("RETAINER_NOT_READY");
  const billing = await jobBillingFor(db, context.tenantId, input.projectId, project.data() ?? null);
  if (billing.method !== "studio") throw new Error("BILLING_QUICKBOOKS_JOB");
  const drafted = await draftStudioDeposit(db, {
    tenantId: context.tenantId,
    projectId: input.projectId,
    trigger: `manual:${context.idempotencyKey}`,
    actor: context.actorId,
    now: context.timestamp,
  });
  if (!drafted.created) {
    if (drafted.reason === "retainer_exists") throw new Error("RETAINER_INVOICE_ALREADY_EXISTS");
    if (drafted.reason === "no_package") throw new Error("PACKAGE_SNAPSHOT_NOT_FOUND");
    throw new Error("INVOICE_NOT_DRAFTED");
  }
  return { invoiceId: drafted.invoiceId };
}

