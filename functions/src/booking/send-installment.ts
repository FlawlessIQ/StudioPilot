import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import { resolveProviderForTenant } from "../integrations/capability-resolution.js";
import { jobBillingFor } from "../billing/job-billing-reader.js";
import { balanceMayBeAttested } from "./agreed-final-balance.js";
import { raiseInstallmentInvoice } from "./installment-invoice.js";
import { installmentName, installmentsBilledCents, nextInstallmentToBill } from "../billing/payment-plan.js";
import { invoiceRecordsDeleted } from "../billing/invoice-purge-policy.js";
import { retainerFromSchedule } from "./agreed-retainer.js";
import { isStandingInvoice } from "./invoice-standing.js";

/**
 * A payment plan's next installment, asked for by a person
 * (billing/payment-plan.ts).
 *
 * The daily run bills an installment two weeks before it falls due, but only
 * when the deposit carries an invoicing customer — the same rule as the final
 * balance, so nothing new is billed without someone choosing to. A deposit
 * recorded by hand leaves the installment on Today, and these are its two
 * buttons: Send (raise it now, finding or making the couple at QuickBooks)
 * and Paid another way (record it paid, with no bill behind it — the
 * `recordFinalPayment` of an installment).
 */

export const sendInstallmentInput = z.object({
  projectId: z.string().min(1),
});

export const recordInstallmentPaymentInput = z.object({
  projectId: z.string().min(1),
  paidAt: z.string().date(),
  /** How the money arrived, in the studio's words. */
  method: z.string().min(1).max(200),
  reference: z.string().max(200).nullable().default(null),
  // The amount is never the client's: it is the agreed line.
  attestation: z.literal(true),
});

const REASON_TO_ERROR: Record<string, string> = {
  exists: "INSTALLMENT_ALREADY_OUT",
  not_due: "NO_INSTALLMENT_DUE",
  no_plan: "NO_INSTALLMENT_DUE",
  nothing_owed: "NOTHING_OWED",
  no_retainer: "FINAL_NEEDS_RETAINER_RECORD",
  no_provider_customer: "INVOICING_NOT_CONNECTED",
  records_deleted: "INVOICE_RECORDS_DELETED",
};

const OWNER_ROLES = ["studio_owner", "studio_admin"];

export async function sendInstallment(
  db: Firestore,
  input: { tenantId: string; projectId: string; role: string; actorId: string; mockMode: boolean },
) {
  if (!OWNER_ROLES.includes(input.role)) throw new Error("BALANCE_ATTESTATION_PERMISSION_REQUIRED");
  const project = await db.doc(`projects/${input.projectId}`).get();
  if (!project.exists || project.get("tenantId") !== input.tenantId) throw new Error("PROJECT_NOT_FOUND");
  if (project.get("archivedAt")) throw new Error("PROJECT_ARCHIVED");
  if (!balanceMayBeAttested(String(project.get("state")))) throw new Error("BALANCE_NOT_READY");

  // As sendFinalBalance: a job the studio bills itself gets a numbered draft
  // to check and send; any other goes to the studio's invoicing provider.
  const billing = await jobBillingFor(db, input.tenantId, input.projectId, project.data() ?? null);
  const studioBilled = billing.method === "studio";
  const provider = studioBilled
    ? "studio"
    : ((await resolveProviderForTenant(db, input.tenantId, "invoicing", "quickbooks")) as string);
  if (!studioBilled && provider !== "quickbooks" && provider !== "stripe") throw new Error("INVOICING_NOT_CONNECTED");
  if (!studioBilled && !input.mockMode) {
    const connections = await db
      .collection("integrationConnections")
      .where("tenantId", "==", input.tenantId)
      .where("provider", "==", provider)
      .limit(5)
      .get();
    if (!connections.docs.some((connection) => connection.get("status") === "connected"))
      throw new Error("INVOICING_NOT_CONNECTED");
  }
  const outcome = await db.runTransaction((transaction) =>
    raiseInstallmentInvoice(db, transaction, project, {
      actor: input.actorId,
      now: new Date().toISOString(),
      billing,
      ...(studioBilled ? {} : { provider: provider as "quickbooks" | "stripe" }),
      resolveCustomer: true,
      // Pressed now: the next one, whatever its date.
      ignoreDate: true,
    }),
  );
  if (!outcome.raised) throw new Error(REASON_TO_ERROR[outcome.reason] ?? "INSTALLMENT_NOT_RAISED");
  return { ...outcome, provider, ...(studioBilled ? { studioInvoice: true } : {}) };
}

function stableId(scope: string, tenantId: string, key: string): string {
  return `${scope}_${createHash("sha256").update(`${scope}:${tenantId}:${key}`).digest("hex").slice(0, 32)}`;
}

/**
 * The next installment, paid another way: recorded as a paid installment
 * with no bill behind it (`provider: null`, `completionAuthority:
 * "manual_attested"`), for the agreed amount. One already billed is paid
 * against its own bill instead (recordInvoicePayment).
 */
export async function recordInstallmentPayment(
  db: Firestore,
  context: {
    tenantId: string;
    role: string;
    actorId: string;
    idempotencyKey: string;
    ipAddress: string | null;
    userAgent: string | null;
    input: z.infer<typeof recordInstallmentPaymentInput>;
  },
) {
  if (!OWNER_ROLES.includes(context.role)) throw new Error("BALANCE_ATTESTATION_PERMISSION_REQUIRED");
  const { tenantId, input } = context;
  const invoiceId = stableId("invoice_installment_attested", tenantId, context.idempotencyKey);
  const now = new Date().toISOString();
  return db.runTransaction(async (transaction) => {
    const invoiceReference = db.doc(`invoiceReferences/${invoiceId}`);
    const [project, existing, invoices, accepted] = await Promise.all([
      transaction.get(db.doc(`projects/${input.projectId}`)),
      transaction.get(invoiceReference),
      transaction.get(
        db.collection("invoiceReferences").where("tenantId", "==", tenantId).where("projectId", "==", input.projectId).limit(60),
      ),
      transaction.get(
        db
          .collection("proposals")
          .where("tenantId", "==", tenantId)
          .where("projectId", "==", input.projectId)
          .where("status", "==", "accepted")
          .limit(5),
      ),
    ]);
    // The same request again: what it recorded the first time.
    if (existing.exists)
      return {
        invoiceId,
        sequence: Number(existing.get("installmentSequence") ?? 0),
        amountCents: Number(existing.get("amountCents") ?? 0),
        completionAuthority: "manual_attested",
        settled: "already_recorded",
      };
    if (!project.exists || project.get("tenantId") !== tenantId || !balanceMayBeAttested(String(project.get("state"))))
      throw new Error("BALANCE_NOT_READY");
    if (invoiceRecordsDeleted(project.data())) throw new Error("INVOICE_RECORDS_DELETED");
    const proposal = accepted.docs.sort((a, b) => Number(b.get("version") ?? 0) - Number(a.get("version") ?? 0))[0];
    if (!proposal) throw new Error("NO_INSTALLMENT_DUE");
    const schedule = proposal.get("paymentSchedule");
    const plain = invoices.docs.map((invoice) => invoice.data() as Record<string, unknown>);
    const due = nextInstallmentToBill({ schedule, invoices: plain, today: now.slice(0, 10), ignoreDate: true });
    if (!due) throw new Error("NO_INSTALLMENT_DUE");
    // Never more than is left of the agreed total (installment-invoice.ts).
    const pricing = (proposal.get("pricingSnapshot") ?? {}) as Record<string, unknown>;
    const retainer = invoices.docs.find(
      (invoice) => invoice.get("kind") === "retainer" && isStandingInvoice(invoice.get("status")),
    );
    const retainerCents = retainer ? retainerFromSchedule(schedule, Number(retainer.get("amountCents") ?? 0)) : 0;
    const room = Number(pricing.totalCents ?? 0) - retainerCents - installmentsBilledCents(plain);
    const amountCents = Math.min(due.amountCents, room);
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new Error("NOTHING_OWED");
    const paidAt = `${input.paidAt}T00:00:00.000Z`;
    transaction.create(invoiceReference, {
      id: invoiceId,
      tenantId,
      projectId: input.projectId,
      kind: "installment",
      installmentSequence: due.sequence,
      installmentCount: due.count,
      // Never a provider name: a payment a person vouched for.
      provider: null,
      completionAuthority: "manual_attested",
      providerInvoiceId: null,
      providerCustomerId: null,
      status: "paid",
      currency: String(pricing.currency ?? "USD"),
      amountCents,
      balanceCents: 0,
      dueDate: due.dueDate,
      hostedUrl: null,
      paidAt,
      completionEvidence: {
        kind: "manual_attestation",
        method: input.method,
        reference: input.reference,
        paidAt: input.paidAt,
        amountCents,
        attestedBy: context.actorId,
        attestedAt: now,
      },
      lastSyncedAt: null,
      lastProviderEventId: null,
      providerState: "not_applicable",
      createdAt: now,
      updatedAt: now,
      createdBy: context.actorId,
      updatedBy: context.actorId,
      archivedAt: null,
    });
    const auditId = stableId("audit_installment_attested", tenantId, context.idempotencyKey);
    transaction.create(db.doc(`auditEvents/${auditId}`), {
      id: auditId,
      tenantId,
      projectId: input.projectId,
      actorId: context.actorId,
      actorType: "user",
      action: "installment.payment_attested",
      entityType: "invoiceReference",
      entityId: invoiceId,
      timestamp: now,
      before: null,
      after: {
        status: "paid",
        installment: installmentName(due.sequence, due.count),
        amountCents,
        paidAt: input.paidAt,
        method: input.method,
        reference: input.reference,
      },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      correlationId: context.idempotencyKey,
      automationRunId: null,
      providerEventId: null,
    });
    return {
      invoiceId,
      sequence: due.sequence,
      amountCents,
      completionAuthority: "manual_attested",
      settled: "attested_invoice",
    };
  });
}
