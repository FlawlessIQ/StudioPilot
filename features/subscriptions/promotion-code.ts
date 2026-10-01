/**
 * A beta / promotion code carried from a signup link to Checkout.
 *
 * `/auth/register?code=BETA` is remembered here and sent with the studio's
 * createCheckout; billingCommand looks it up in Stripe and applies it. Browser
 * storage is enough: the code is only a hint for one Checkout — Stripe decides
 * whether it is valid and what it is worth, and Checkout still shows its own
 * "Add promotion code" field when nothing (or nothing valid) was carried.
 * The shape check mirrors `normalizePromotionCode` in
 * functions/src/saas/stripe-checkout.ts (functions/ cannot import @/features).
 */
const KEY = "studiocue.promotionCode";

export function normalizePromotionCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z0-9_-]{2,64}$/.test(code) ? code : null;
}

export function rememberPromotionCode(value: string | null | undefined): void {
  const code = normalizePromotionCode(value);
  if (!code) return;
  try {
    window.localStorage.setItem(KEY, code);
  } catch {
    // Private mode or blocked storage: Checkout's own code field still works.
  }
}

export function rememberedPromotionCode(): string | null {
  try {
    return normalizePromotionCode(window.localStorage.getItem(KEY));
  } catch {
    return null;
  }
}
