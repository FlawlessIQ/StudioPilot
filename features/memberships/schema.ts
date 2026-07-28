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

export const tenantInvitationSchema = auditFieldsSchema.extend({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  email: z.string().email(),
  normalizedEmail: z.string().email(),
  displayName: z.string().min(2).max(120),
  role: roleSchema.exclude(["platform_super_admin", "studio_owner", "guest"]),
  projectIds: z.array(z.string()).default([]),
  status: z.enum(["pending", "accepted", "revoked", "expired"]),
  tokenHash: z.string().length(64),
  expiresAt: z.string().datetime(),
  acceptedAt: z.string().datetime().nullable(),
  acceptedBy: z.string().nullable(),
  revokedAt: z.string().datetime().nullable(),
  archivedAt: z.string().datetime().nullable(),
});

export type Membership = z.infer<typeof membershipSchema>;
export type TenantInvitation = z.infer<typeof tenantInvitationSchema>;
