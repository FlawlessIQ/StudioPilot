import { z } from "zod";

export const auditEventSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  actorId: z.string().min(1),
  actorType: z.enum(["user", "client", "subcontractor", "guest", "system", "provider"]),
  action: z.string().min(2),
  entityType: z.string().min(2),
  entityId: z.string().min(1),
  timestamp: z.string().datetime(),
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  correlationId: z.string().min(1),
  automationRunId: z.string().nullable(),
  providerEventId: z.string().nullable(),
});

export type AuditEvent = z.infer<typeof auditEventSchema>;
