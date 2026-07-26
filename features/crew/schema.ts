import { z } from "zod";
import { auditFieldsSchema } from "@/features/tenants/schema";

export const crewSpecialtySchema = z.enum([
  "weddings",
  "corporate",
  "sports",
  "portraits",
  "events",
  "video",
  "assistant",
]);

export const crewProfileSchema = auditFieldsSchema.extend({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  userId: z.string().min(1).nullable(),
  name: z.string().min(1).max(160),
  email: z.string().email(),
  phone: z.string().min(7).max(30).nullable(),
  specialties: z.array(crewSpecialtySchema),
  serviceAreas: z.array(z.string().min(1)),
  travelRadiusMiles: z.number().int().nonnegative().max(500),
  rateType: z.enum(["hourly", "event"]),
  rateCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  equipment: z.array(z.string().min(1)),
  w9Status: z.enum(["missing", "requested", "received", "verified"]),
  insuranceStatus: z.enum(["missing", "requested", "received", "verified", "expired"]),
  contractStatus: z.enum(["missing", "sent", "completed", "expired"]),
  emergencyContact: z.object({
    name: z.string().min(1),
    phone: z.string().min(7),
    relationship: z.string().min(1),
  }).nullable(),
  notes: z.string().max(4000).nullable(),
  active: z.boolean(),
  archivedAt: z.string().datetime().nullable(),
});

export const crewAvailabilitySchema = auditFieldsSchema.extend({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  crewProfileId: z.string().min(1),
  userId: z.string().min(1),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  status: z.enum(["available", "unavailable", "tentative"]),
  notes: z.string().max(1000).nullable(),
  archivedAt: z.string().datetime().nullable(),
});

export const assignmentStatusSchema = z.enum([
  "draft",
  "invited",
  "viewed",
  "accepted",
  "declined",
  "reassigned",
  "cancelled",
  "completed",
]);

export const crewRequirementSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(["w9", "insurance", "contract", "equipment", "file", "acknowledgement"]),
  required: z.boolean(),
  status: z.enum(["missing", "submitted", "under_review", "complete", "waived", "expired"]),
  dueAt: z.string().datetime().nullable(),
  documentId: z.string().nullable(),
  completedAt: z.string().datetime().nullable(),
  completedBy: z.string().nullable(),
  notes: z.string().max(1000).nullable(),
});

export const crewAssignmentSchema = auditFieldsSchema.extend({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  crewProfileId: z.string().min(1),
  userId: z.string().min(1).nullable(),
  role: z.string().min(1).max(120),
  compensationCents: z.number().int().nonnegative().nullable(),
  compensationType: z.enum(["hourly", "event"]).nullable(),
  currency: z.string().length(3),
  compensationVisibleToCrew: z.boolean(),
  arrivalAt: z.string().datetime(),
  departureAt: z.string().datetime(),
  locations: z.array(z.object({
    name: z.string().min(1),
    address: z.string().min(1).nullable(),
  })),
  responsibilities: z.array(z.string().min(1)),
  scheduleItemIds: z.array(z.string().min(1)),
  notes: z.string().max(4000).nullable(),
  status: assignmentStatusSchema,
  invitationSentAt: z.string().datetime().nullable(),
  viewedAt: z.string().datetime().nullable(),
  respondedAt: z.string().datetime().nullable(),
  calendarStatus: z.enum(["not_added", "added", "declined"]),
  calendarAcknowledgedAt: z.string().datetime().nullable(),
  currentScheduleId: z.string().nullable(),
  currentScheduleVersion: z.number().int().nonnegative(),
  acknowledgedScheduleVersion: z.number().int().nonnegative().nullable(),
  scheduleAcknowledgedAt: z.string().datetime().nullable(),
  requirements: z.array(crewRequirementSchema),
  inviteTokenHash: z.string().min(32).nullable(),
  inviteExpiresAt: z.string().datetime().nullable(),
  archivedAt: z.string().datetime().nullable(),
});

export type CrewProfile = z.infer<typeof crewProfileSchema>;
export type CrewAvailability = z.infer<typeof crewAvailabilitySchema>;
export type CrewAssignment = z.infer<typeof crewAssignmentSchema>;
export type CrewRequirement = z.infer<typeof crewRequirementSchema>;
export type AssignmentStatus = z.infer<typeof assignmentStatusSchema>;
