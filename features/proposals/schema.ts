import { z } from "zod";
import { auditFieldsSchema } from "@/features/tenants/schema";

const cents = z.number().int().nonnegative().safe();

export const proposalStatusSchema = z.enum([
  "draft",
  "sent",
  "viewed",
  "accepted",
  "declined",
  "expired",
  "superseded",
]);

export const proposalSchema = auditFieldsSchema.extend({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  packageSnapshotId: z.string().min(1),
  version: z.number().int().positive(),
  status: proposalStatusSchema,
  clientSnapshot: z.object({
    displayName: z.string().min(1),
    email: z.string().email(),
  }),
  eventSnapshot: z.object({
    name: z.string().min(1),
    eventType: z.string().min(1),
    eventDate: z.string().date(),
    timezone: z.string().min(1),
    venue: z.string().nullable(),
  }),
  pricingSnapshot: z.object({
    currency: z.string().length(3),
    packageName: z.string().min(1),
    subtotalCents: cents,
    discountCents: cents,
    taxCents: cents,
    retainerCents: cents,
    totalCents: cents,
    lineItems: z.array(z.object({
      description: z.string().min(1),
      quantity: z.number().int().positive(),
      unitPriceCents: cents,
      totalCents: cents,
    })).min(1),
  }),
  paymentSchedule: z.array(z.object({
    label: z.string().min(1),
    amountCents: cents,
    dueDate: z.string().date().nullable(),
  })).min(1),
  expiresAt: z.string().datetime(),
  notes: z.string().max(4000).nullable(),
  termsSummary: z.string().min(10).max(6000),
  pdfDocumentId: z.string().nullable(),
  sentAt: z.string().datetime().nullable(),
  viewedAt: z.string().datetime().nullable(),
  acceptedAt: z.string().datetime().nullable(),
  declinedAt: z.string().datetime().nullable().default(null),
  declineReason: z.string().max(1000).nullable().default(null),
  decisionBy: z.string().nullable().default(null),
  supersedesId: z.string().nullable(),
  archivedAt: z.string().datetime().nullable(),
});

export type Proposal = z.infer<typeof proposalSchema>;
