import { z } from "zod";
import { auditFieldsSchema } from "@/features/tenants/schema";
export const vendorSchema = auditFieldsSchema.extend({
  id: z.string(), tenantId: z.string(), company: z.string().min(1), contactName: z.string(),
  email: z.string().email().nullable(), phone: z.string().nullable(),
  type: z.enum(["venue","planner","florist","dj","band","videographer","hair_makeup","caterer","transportation","insurance_agent","corporate_contact","sports_organizer","other"]),
  website: z.string().url().nullable(), address: z.string().nullable(), notes: z.string().nullable(),
  projectIds: z.array(z.string()), archivedAt: z.string().datetime().nullable(),
});
export type Vendor = z.infer<typeof vendorSchema>;
