import { z } from "zod";
import { auditFieldsSchema } from "@/features/tenants/schema";

/**
 * The kinds of vendor a studio keeps. A wedding's vendor team (team.ts) uses
 * the same list as its categories, so "photographer", "officiant", "bakery"
 * and "rentals" joined it for the team (2026-10-12): a DJ's or a planner's
 * wedding has a photographer on it. None of them is invited to StudioCue
 * (trades.ts VENDOR_TYPE_TRADES leaves them out).
 */
export const VENDOR_TYPES = [
  "venue",
  "planner",
  "florist",
  "dj",
  "band",
  "videographer",
  "hair_makeup",
  "caterer",
  "transportation",
  "insurance_agent",
  "corporate_contact",
  "sports_organizer",
  "photographer",
  "officiant",
  "bakery",
  "rentals",
  // Dancers, game hosts, a photo booth: a mitzvah books them as often as a
  // DJ (docs/mitzvah-journey-plan-2026-10-14.md, decision 5). No trade of
  // its own, so never invited to StudioCue.
  "entertainment",
  // The court's waltz and surprise dance (a quinceañera's; Conor, 2026-10-15).
  // No trade of its own, so never invited to StudioCue.
  "choreographer",
  "other",
] as const;
export type VendorType = (typeof VENDOR_TYPES)[number];

export const vendorSchema = auditFieldsSchema.extend({
  id: z.string(), tenantId: z.string(), company: z.string().min(1), contactName: z.string(),
  email: z.string().email().nullable(), phone: z.string().nullable(),
  type: z.enum(VENDOR_TYPES),
  website: z.string().url().nullable(), address: z.string().nullable(), notes: z.string().nullable(),
  projectIds: z.array(z.string()), archivedAt: z.string().datetime().nullable(),
});
export type Vendor = z.infer<typeof vendorSchema>;
