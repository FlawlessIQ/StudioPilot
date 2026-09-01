import { z } from "zod";

export const entitlementSchema = z.object({
  maxInternalUsers: z.number().int().positive(),
  maxBrands: z.number().int().positive(),
  maxActiveSubcontractors: z.number().int().positive().nullable(),
  aiActionsMonthly: z.number().int().positive(),
  smsEnabled: z.boolean(),
  coiEnabled: z.boolean(),
  customWorkflowsEnabled: z.boolean(),
  advancedReportingEnabled: z.boolean(),
  apiAccessEnabled: z.boolean(),
  prioritySupportEnabled: z.boolean(),
});

export type Entitlements = z.infer<typeof entitlementSchema>;
/**
 * Solo is gone. See config/saas-plans.ts for why — briefly, a one-seat plan
 * charged a studio for growing, and the seat cap refuses rather than
 * prompts.
 */
export type PlanKey = "studio" | "multi_brand";

export const planEntitlements: Readonly<Record<PlanKey, Entitlements>> = {
  studio: {
    maxInternalUsers: 3,
    maxBrands: 1,
    maxActiveSubcontractors: 25,
    aiActionsMonthly: 2500,
    smsEnabled: true,
    coiEnabled: true,
    customWorkflowsEnabled: true,
    advancedReportingEnabled: true,
    apiAccessEnabled: false,
    prioritySupportEnabled: true,
  },
  multi_brand: {
    maxInternalUsers: 15,
    maxBrands: 3,
    maxActiveSubcontractors: 100,
    aiActionsMonthly: 7500,
    smsEnabled: true,
    coiEnabled: true,
    customWorkflowsEnabled: true,
    advancedReportingEnabled: true,
    apiAccessEnabled: true,
    prioritySupportEnabled: true,
  },
};

export function hasEntitlement(
  entitlements: Entitlements,
  key: keyof Pick<
    Entitlements,
    | "smsEnabled"
    | "coiEnabled"
    | "customWorkflowsEnabled"
    | "advancedReportingEnabled"
    | "apiAccessEnabled"
    | "prioritySupportEnabled"
  >,
): boolean {
  return entitlements[key];
}
