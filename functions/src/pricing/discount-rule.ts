import type { PackageDiscount } from "./package-price.js";

/**
 * The discount a package on a job carries, as a rule rather than an amount.
 *
 * A package snapshot used to keep only `discountCents`, the amount the rule
 * came to on the day. Anything that priced the package again — new extras, a
 * swap — could only carry that amount, so "10% off" froze into "$420 off" the
 * moment an extra was added, and a swap dropped it altogether. Snapshots now
 * keep `discountRule` too. Pure.
 */
export function snapshotDiscountRule(snapshot: Record<string, unknown> | undefined | null): PackageDiscount {
  const rule = snapshot?.discountRule as Record<string, unknown> | undefined;
  if (rule?.type === "percentage" && typeof rule.basisPoints === "number" && rule.basisPoints > 0)
    return { type: "percentage", basisPoints: Math.min(10000, Math.round(rule.basisPoints)) };
  if (rule?.type === "fixed" && typeof rule.amountCents === "number" && rule.amountCents > 0)
    return { type: "fixed", amountCents: Math.round(rule.amountCents) };
  if (rule?.type === "none") return { type: "none" };
  // Written before the rule was kept: the amount is all there is.
  const cents = Number(snapshot?.discountCents ?? 0);
  return Number.isFinite(cents) && cents > 0 ? { type: "fixed", amountCents: Math.round(cents) } : { type: "none" };
}

/**
 * The discount a new package selection is priced with.
 *
 * `keep` is what the Packages panel, Cue and Today send: on a swap it carries
 * the replaced package's discount over (a percentage stays a percentage, on
 * the new price); on an add, or a job with no package yet, it is none — the
 * new package was never discounted. Anything else is the caller's own rule.
 */
export function selectionDiscount(
  requested: PackageDiscount | { type: "keep" },
  context: { replacing: boolean; replacedSnapshot: Record<string, unknown> | null },
): PackageDiscount {
  if (requested.type !== "keep") return requested;
  return context.replacing && context.replacedSnapshot ? snapshotDiscountRule(context.replacedSnapshot) : { type: "none" };
}
