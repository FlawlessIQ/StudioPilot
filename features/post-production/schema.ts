import { z } from "zod";
import { auditFieldsSchema } from "@/features/tenants/schema";

export const postProductionStepSchema = z.enum([
  "backup_complete",
  "cull_complete",
  "editing_started",
  "editing_complete",
  "gallery_ready",
  "album_proof_ready",
  "delivery_sent",
  "client_downloaded",
  "project_archived",
]);

export const postProductionRecordSchema = auditFieldsSchema.extend({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  steps: z.record(postProductionStepSchema, z.object({
    complete: z.boolean(),
    completedAt: z.string().datetime().nullable(),
    completedBy: z.string().nullable(),
    evidenceId: z.string().nullable(),
    notes: z.string().max(2000).nullable(),
  })),
  currentStep: postProductionStepSchema,
  targetDeliveryDate: z.string().date().nullable(),
  archivedAt: z.string().datetime().nullable(),
});

export const deliveryRecordSchema = auditFieldsSchema.extend({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  provider: z.enum(["manual", "pixieset", "pic_time", "shootproof"]),
  galleryUrl: z.string().url(),
  accessCode: z.string().max(120).nullable(),
  expirationDate: z.string().date().nullable(),
  deliveryDate: z.string().date(),
  notes: z.string().max(3000).nullable(),
  status: z.enum(["draft", "ready", "sent", "viewed", "downloaded", "expired", "revoked"]),
  sentAt: z.string().datetime().nullable(),
  viewedAt: z.string().datetime().nullable(),
  downloadedAt: z.string().datetime().nullable(),
  providerDeliveryId: z.string().nullable(),
  archivedAt: z.string().datetime().nullable(),
});

export const reviewRequestStatusSchema = z.enum([
  "scheduled",
  "sent",
  "delivered",
  "opened",
  "clicked",
  "client_confirmed",
  "manually_confirmed",
  "skipped",
]);

export const reviewRequestSchema = auditFieldsSchema.extend({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  deliveryRecordId: z.string().min(1),
  channel: z.enum(["email", "sms"]),
  destinationLabel: z.enum(["google", "weddingwire", "the_knot", "facebook", "custom"]),
  destinationUrl: z.string().url(),
  status: reviewRequestStatusSchema,
  sequence: z.number().int().positive(),
  scheduledAt: z.string().datetime(),
  sentAt: z.string().datetime().nullable(),
  deliveredAt: z.string().datetime().nullable(),
  openedAt: z.string().datetime().nullable(),
  clickedAt: z.string().datetime().nullable(),
  confirmedAt: z.string().datetime().nullable(),
  confirmedBy: z.string().nullable(),
  messageId: z.string().nullable(),
  archivedAt: z.string().datetime().nullable(),
});

export const projectCloseoutSchema = auditFieldsSchema.extend({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  status: z.enum(["blocked", "ready", "completed"]),
  requirements: z.array(z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    complete: z.boolean(),
    evidenceId: z.string().nullable(),
  })),
  completedAt: z.string().datetime().nullable(),
  completedBy: z.string().nullable(),
  summaryDocumentId: z.string().nullable(),
  archivedAt: z.string().datetime().nullable(),
});

export type PostProductionRecord = z.infer<typeof postProductionRecordSchema>;
export type PostProductionStep = z.infer<typeof postProductionStepSchema>;
export type DeliveryRecord = z.infer<typeof deliveryRecordSchema>;
export type ReviewRequest = z.infer<typeof reviewRequestSchema>;
export type ProjectCloseout = z.infer<typeof projectCloseoutSchema>;
