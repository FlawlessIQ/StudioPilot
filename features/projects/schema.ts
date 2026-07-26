import { z } from "zod";
import { auditFieldsSchema } from "@/features/tenants/schema";

export const projectStateSchema = z.enum([
  "LEAD",
  "CONSULTATION",
  "PROPOSAL",
  "CONTRACT_PENDING",
  "RETAINER_PENDING",
  "BOOKED",
  "PLANNING",
  "READY",
  "EVENT_COMPLETE",
  "POST_PRODUCTION",
  "DELIVERED",
  "REVIEW_REQUESTED",
  "CLOSED",
  "CANCELLED",
  "POSTPONED",
  "ARCHIVED",
]);

export type ProjectState = z.infer<typeof projectStateSchema>;

export const projectSchema = auditFieldsSchema.extend({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  name: z.string().min(2).max(160),
  eventType: z.string().min(2).max(80),
  eventTypeId: z.string().min(1).default("wedding"),
  eventDate: z.string().date(),
  timezone: z.string().min(1),
  state: projectStateSchema,
  stateVersion: z.number().int().nonnegative().default(0),
  clientContactIds: z.array(z.string()).min(1),
  leadPhotographerId: z.string().nullable(),
  leadId: z.string().nullable().default(null),
  packageSnapshotId: z.string().nullable().default(null),
  venueName: z.string().max(160).nullable().default(null),
  city: z.string().max(120).nullable().default(null),
  readinessScore: z.number().int().min(0).max(100).default(0),
  nextAction: z.string().max(500).nullable().default(null),
  archivedAt: z.string().datetime().nullable(),
});

export type Project = z.infer<typeof projectSchema>;
