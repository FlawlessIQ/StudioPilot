import { z } from "zod";

/**
 * Where a client is billed — QuickBooks works out US sales tax from it.
 *
 * Mirrors billingAddressSchema in features/contacts/schema.ts (functions/ has
 * no "@/features" path); tests/quickbooks-invoice-lines.test.ts parses the
 * same inputs through both and fails if they disagree.
 */
export const billingAddressInputSchema = z.object({
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).nullable().default(null),
  city: z.string().trim().min(1).max(120),
  /** State or province: "NJ". */
  region: z.string().trim().max(80).nullable().default(null),
  postalCode: z.string().trim().max(20).nullable().default(null),
  /** ISO 3166-1 alpha-2. */
  country: z.string().trim().length(2).toUpperCase().default("US"),
});

/**
 * Two stored addresses the same, field for field. Mirrors sameBillingAddress
 * in features/contacts/billing-address-signing.ts; updateContact uses it so an
 * unchanged address re-sent by the edit form keeps "confirmed by the couple".
 */
export function sameBillingAddress(a: unknown, b: unknown): boolean {
  const field = (value: unknown, key: string) => {
    const record = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
    const entry = record[key];
    return typeof entry === "string" && entry.trim() ? entry.trim() : null;
  };
  return ["line1", "line2", "city", "region", "postalCode", "country"].every(
    (key) => field(a, key) === field(b, key),
  );
}
