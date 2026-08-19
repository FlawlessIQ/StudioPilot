import { z } from "zod";
import { auditFieldsSchema } from "@/features/tenants/schema";

export const consultationModeSchema = z.enum(["zoom", "in_person", "phone", "custom"]);
export const consultationStatusSchema = z.enum([
  "scheduled",
  "completed",
  "cancelled",
  "rescheduled",
  "no_show",
]);

export const consultationSchema = auditFieldsSchema.extend({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  contactId: z.string().min(1),
  mode: consultationModeSchema,
  status: consultationStatusSchema,
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  timezone: z.string().min(1),
  location: z.string().max(500).nullable(),
  calendarEventId: z.string().nullable(),
  calendarHtmlLink: z.string().url().nullable(),
  meetingId: z.string().nullable(),
  joinUrl: z.string().url().nullable(),
  internalNotes: z.string().max(4000).nullable(),
  reminderJobIds: z.array(z.string()),
  supersedesId: z.string().nullable(),
  // Written by cancelConsultation / rescheduleConsultation. Optional because
  // every consultation created before those commands existed lacks them.
  cancelledAt: z.string().datetime().nullable().optional(),
  cancellationReason: z.string().max(500).nullable().optional(),
  rescheduledAt: z.string().datetime().nullable().optional(),
  archivedAt: z.string().datetime().nullable(),
});

export type Consultation = z.infer<typeof consultationSchema>;
