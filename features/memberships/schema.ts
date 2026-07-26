import { z } from "zod";
import { roleSchema, permissionSchema } from "@/features/auth/roles";
import { auditFieldsSchema } from "@/features/tenants/schema";

export const membershipSchema = auditFieldsSchema.extend({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  role: roleSchema,
  explicitPermissions: z.array(permissionSchema).default([]),
  projectIds: z.array(z.string()).default([]),
  status: z.enum(["invited", "active", "suspended", "revoked"]),
  archivedAt: z.string().datetime().nullable(),
});

export type Membership = z.infer<typeof membershipSchema>;
