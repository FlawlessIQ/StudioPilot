import { z } from "zod";
import { auditFieldsSchema } from "@/features/tenants/schema";

export const incidentRecordSchema = auditFieldsSchema.extend({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  severity: z.enum(["S1", "S2", "S3", "S4"]),
  status: z.enum([
    "investigating",
    "mitigating",
    "monitoring",
    "resolved",
    "closed",
  ]),
  title: z.string().min(1).max(240),
  summary: z.string().min(1).max(2000),
  affectedCapabilities: z.array(z.string().min(1).max(160)).max(50),
  detectedAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
  ownerId: z.string().min(1),
  externalReference: z.string().url().nullable(),
  archivedAt: z.string().datetime().nullable(),
});

export type IncidentRecord = z.infer<typeof incidentRecordSchema>;
