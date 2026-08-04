import { z } from "zod";
import { auditFieldsSchema } from "@/features/tenants/schema";

export const weekdaySchema = z.enum(["sun", "mon", "tue", "wed", "thu", "fri", "sat"]);
export type Weekday = z.infer<typeof weekdaySchema>;

// Minutes since local midnight, in the tenant's own timezone (tenants.timezone) —
// not UTC. A studio open 9am-12pm and 1pm-5pm on Tuesdays (lunch break) is two
// windows with the same day, not one window with a gap encoded some other way.
export const availabilityWindowSchema = z
  .object({
    day: weekdaySchema,
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
  })
  .refine((window) => window.endMinute > window.startMinute, {
    message: "endMinute must be after startMinute",
  });
export type AvailabilityWindow = z.infer<typeof availabilityWindowSchema>;

export const consultationSettingsSchema = auditFieldsSchema.extend({
  tenantId: z.string().min(1),
  durationMinutes: z.number().int().min(15).max(120),
  bufferMinutes: z.number().int().min(0).max(60),
  windows: z.array(availabilityWindowSchema).max(21),
  // ISO calendar dates (studio-local) with no bookable slots at all —
  // holidays, days off — regardless of what windows say for that weekday.
  blockedDates: z.array(z.string().date()).max(200),
});
export type ConsultationSettings = z.infer<typeof consultationSettingsSchema>;
