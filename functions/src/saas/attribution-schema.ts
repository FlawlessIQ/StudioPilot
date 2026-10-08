import { z } from "zod";

/**
 * What the create-your-studio step sends about where the studio came from
 * (features/growth/attribution.ts, which this mirrors; functions/ cannot
 * import @/features). Optional throughout: a missing or malformed record
 * must never stop a studio being created, so onboarding parses it on its own
 * and drops it on failure.
 */

export const HEARD_VALUES = ["instagram", "facebook", "tiktok", "google", "youtube", "photographer", "vendor", "event", "other"] as const;

const text = (max: number) => z.string().trim().max(max).nullable();

export const touchSchema = z.object({
  source: text(80),
  medium: text(80),
  campaign: text(80),
  content: text(80),
  referrer: text(120),
  landing: z.string().trim().max(120),
  code: z.string().trim().regex(/^[A-Z0-9_-]{2,64}$/).nullable(),
  at: z.string().max(40),
});

export const attributionSchema = z.object({
  heard: z.enum(HEARD_VALUES).nullable(),
  heardDetail: text(120),
  first: touchSchema.nullable(),
  last: touchSchema.nullable(),
  promotionCode: z.string().trim().regex(/^[A-Z0-9_-]{2,64}$/).nullable(),
});

export type AttributionInput = z.infer<typeof attributionSchema>;

/** The channels a studio can be filed under by hand (Console → studio → Source). */
export const SOURCE_CHANNELS = [
  "referral",
  "vendor",
  "instagram",
  "facebook",
  "tiktok",
  "youtube",
  "search",
  "ads",
  "email",
  "photographer",
  "event",
  "website",
  "direct",
  "other",
] as const;
