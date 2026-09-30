/**
 * The discount on one package on a job, as the Packages panel shows and edits
 * it. Pure. The server keeps the rule on the snapshot (`discountRule`,
 * functions/src/pricing/discount-rule.ts); a snapshot written before that has
 * only the amount, which reads as a fixed discount.
 */

export type PackageDiscountRule =
  | { type: "none" }
  | { type: "fixed"; amountCents: number }
  | { type: "percentage"; basisPoints: number };

export function discountRuleOf(snapshot: Record<string, unknown> | undefined | null): PackageDiscountRule {
  const rule = snapshot?.discountRule as Record<string, unknown> | undefined;
  if (rule?.type === "percentage" && typeof rule.basisPoints === "number" && rule.basisPoints > 0)
    return { type: "percentage", basisPoints: rule.basisPoints };
  if (rule?.type === "fixed" && typeof rule.amountCents === "number" && rule.amountCents > 0)
    return { type: "fixed", amountCents: rule.amountCents };
  if (rule?.type === "none") return { type: "none" };
  const cents = Number(snapshot?.discountCents ?? 0);
  return Number.isFinite(cents) && cents > 0 ? { type: "fixed", amountCents: cents } : { type: "none" };
}

/** "10% off", "$250 off", or null for none. */
export function discountLabel(rule: PackageDiscountRule, currency = "USD"): string | null {
  if (rule.type === "percentage") return `${Number((rule.basisPoints / 100).toFixed(2))}% off`;
  if (rule.type === "fixed")
    return `${new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      minimumFractionDigits: rule.amountCents % 100 ? 2 : 0,
    }).format(rule.amountCents / 100)} off`;
  return null;
}

/**
 * What the studio typed, as a rule — or why it can't be one. A blank or zero
 * amount is no discount; a percentage over 100 is a typo, not a refund.
 */
export function discountFromForm(
  kind: "none" | "percentage" | "fixed",
  value: string,
): { ok: true; rule: PackageDiscountRule } | { ok: false; message: string } {
  if (kind === "none") return { ok: true, rule: { type: "none" } };
  const number = Number.parseFloat(value.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(number) || number <= 0) return { ok: true, rule: { type: "none" } };
  if (kind === "percentage") {
    if (number > 100) return { ok: false, message: "A percentage can't be more than 100." };
    return { ok: true, rule: { type: "percentage", basisPoints: Math.round(number * 100) } };
  }
  return { ok: true, rule: { type: "fixed", amountCents: Math.round(number * 100) } };
}
