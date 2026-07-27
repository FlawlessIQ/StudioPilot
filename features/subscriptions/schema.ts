import { z } from "zod";
import { entitlementSchema } from "./entitlements";
import { auditFieldsSchema } from "@/features/tenants/schema";

export const subscriptionSchema = auditFieldsSchema.extend({
  id:z.string().min(1),tenantId:z.string().min(1),
  plan:z.enum(["solo","studio","multi_brand"]),cadence:z.enum(["monthly","yearly"]),
  status:z.enum(["trialing","active","past_due","paused","cancelled","incomplete"]),
  stripeCustomerId:z.string().nullable(),stripeSubscriptionId:z.string().nullable(),
  stripePriceId:z.string().nullable(),currentPeriodStart:z.string().datetime().nullable(),
  currentPeriodEnd:z.string().datetime().nullable(),cancelAtPeriodEnd:z.boolean(),
  entitlements:entitlementSchema,internalUserCount:z.number().int().nonnegative(),
  brandCount:z.number().int().nonnegative(),activeSubcontractorCount:z.number().int().nonnegative(),
  archivedAt:z.string().datetime().nullable(),
});
export const usageCounterSchema=auditFieldsSchema.extend({
  id:z.string().min(1),tenantId:z.string().min(1),period:z.string().regex(/^\d{4}-\d{2}$/),
  aiActions:z.number().int().nonnegative(),smsSegments:z.number().int().nonnegative(),
  apiRequests:z.number().int().nonnegative(),lastAiActionAt:z.string().datetime().nullable(),
});
export const featureFlagSchema=auditFieldsSchema.extend({
  id:z.string().min(1),key:z.string().min(1),enabled:z.boolean(),
  tenantIds:z.array(z.string()),description:z.string().max(1000),
  archivedAt:z.string().datetime().nullable(),
});
export const supportAccessSchema=auditFieldsSchema.extend({
  id:z.string().min(1),tenantId:z.string().min(1),platformUserId:z.string().min(1),
  reason:z.string().min(10).max(2000),status:z.enum(["active","revoked","expired"]),
  expiresAt:z.string().datetime(),revokedAt:z.string().datetime().nullable(),
});
export const systemHealthSchema=auditFieldsSchema.extend({
  id:z.string().min(1),tenantId:z.string().nullable(),
  category:z.enum(["integration","background_job","webhook","ai","email","system"]),
  component:z.string().min(1),status:z.enum(["healthy","degraded","failed","unknown"]),
  checkedAt:z.string().datetime(),latencyMs:z.number().int().nonnegative().nullable(),
  message:z.string().max(2000).nullable(),failureCount:z.number().int().nonnegative(),
});
export type Subscription=z.infer<typeof subscriptionSchema>;
export type UsageCounter=z.infer<typeof usageCounterSchema>;
export type FeatureFlag=z.infer<typeof featureFlagSchema>;
export type SupportAccess=z.infer<typeof supportAccessSchema>;
