import { z } from "zod";
import { auditFieldsSchema } from "@/features/tenants/schema";

/**
 * An `invoiceReferences` document: one bill on one job.
 *
 * Written only by the server (firestore.rules), from three directions:
 *
 * - **QuickBooks / Stripe.** StudioCue raises it and the provider owns the
 *   bill: `provider` set, `providerState` tracks the provider job, webhooks
 *   move `status`.
 * - **The studio, by hand.** A payment recorded on the booking page with no
 *   bill behind it: `provider: null`, `providerState: "not_applicable"`,
 *   `completionAuthority: "manual_attested"`.
 * - **The studio, through StudioCue.** A job the studio bills itself
 *   (features/billing/job-billing.ts): `provider: null`,
 *   `billedBy: "studio"`, numbered (`number`), with its own lines and PDF
 *   (docs/own-invoicing-plan-2026-10-09.md).
 *
 * The schema describes what is actually stored — it fell behind once, when
 * the manual paths started writing `provider: null` and statuses this list
 * didn't have. Fields beyond these are allowed through (`passthrough`):
 * provider lines, totals and payment history are read by their own modules.
 */
export const invoiceStatusSchema = z.enum([
  "draft",
  "sent",
  /** Raised at QuickBooks; its email to the client hasn't landed yet. */
  "awaiting_delivery",
  "viewed",
  "partially_paid",
  "paid",
  "overdue",
  "voided",
  "refunded",
  "error",
  /** The provider refused it, after retries. Not standing (invoice-standing.ts). */
  "failed",
  /** Replaced by a later bill after a booking change. Not standing. */
  "superseded",
  /** Held for the studio to check the amount before it goes. */
  "review_required",
]);

export const invoiceKindSchema = z.enum(["retainer", "final", "adjustment"]);

export const invoiceProviderStateSchema = z.enum([
  "queued",
  "completed",
  "failed",
  "not_applicable",
  "review_required",
]);

export const invoiceLineSchema = z.object({
  description: z.string().min(1).max(300),
  quantity: z.number().int().positive().safe(),
  unitAmountCents: z.number().int().safe(),
  amountCents: z.number().int().safe(),
});

export const invoiceReferenceSchema = auditFieldsSchema
  .extend({
    id: z.string().min(1),
    tenantId: z.string().min(1),
    projectId: z.string().min(1),
    kind: invoiceKindSchema,
    /** Null: no provider — recorded by hand, imported, or billed by the studio itself. */
    provider: z.enum(["quickbooks", "stripe"]).nullable(),
    providerInvoiceId: z.string().min(1).nullable().optional(),
    providerCustomerId: z.string().min(1).nullable().optional(),
    providerState: invoiceProviderStateSchema.optional(),
    status: invoiceStatusSchema,
    currency: z.string().length(3),
    amountCents: z.number().int().nonnegative().safe(),
    balanceCents: z.number().int().nonnegative().safe(),
    dueDate: z.string().date().nullable(),
    hostedUrl: z.string().url().nullable().optional(),
    paidInFull: z.boolean().optional(),
    paidAt: z.string().nullable().optional(),
    completionAuthority: z.enum(["manual_attested", "imported"]).nullable().optional(),
    lastSyncedAt: z.string().datetime().nullable().optional(),
    lastProviderEventId: z.string().nullable().optional(),
    archivedAt: z.string().datetime().nullable(),
    // --- billed by the studio, through StudioCue ---
    billedBy: z.enum(["studio"]).optional(),
    /** INV-0042 (features/billing/invoice-number.ts). Never reused. */
    number: z.string().min(1).max(40).optional(),
    issuedAt: z.string().datetime().nullable().optional(),
    sentAt: z.string().datetime().nullable().optional(),
    sentBy: z.string().nullable().optional(),
    lines: z.array(invoiceLineSchema).optional(),
    taxCents: z.number().int().nonnegative().safe().optional(),
    /** The studio's own pay link for this bill (Square, PayPal …). */
    payLinkUrl: z.string().url().nullable().optional(),
  })
  .passthrough();

export type InvoiceReference = z.infer<typeof invoiceReferenceSchema>;
export type InvoiceLine = z.infer<typeof invoiceLineSchema>;
