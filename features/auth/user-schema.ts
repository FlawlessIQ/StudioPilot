import { z } from "zod";
import { auditFieldsSchema } from "@/features/tenants/schema";

export const userSchema = auditFieldsSchema.extend({
  id: z.string().min(1),
  tenantId: z.literal("platform"),
  email: z.string().email(),
  displayName: z.string().min(1).max(120),
  emailVerified: z.boolean(),
  photoUrl: z.string().url().nullable(),
  phone: z.string().max(30).nullable(),
  lastLoginAt: z.string().datetime().nullable(),
  archivedAt: z.string().datetime().nullable(),
});

export type StudioHubUser = z.infer<typeof userSchema>;
