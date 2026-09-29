/**
 * What one package costs, with its add-ons, discount, tax and retainer.
 *
 * This was written out three times — the studio's selection
 * (functions/src/crm/commands.ts), the couple's selection in the portal
 * (app/api/client/portal/route.ts) and the snapshot factory
 * (features/packages/create-snapshot.ts) — and the copies had drifted: none
 * honoured an add-on's `taxable` flag (H2, M5/M6 in
 * docs/proposal-agreement-and-addons-plan-2026-09-28.md). Every caller now
 * prices through here.
 *
 * Mirrored byte-for-byte below this header in functions/src/pricing/package-price.ts
 * (functions/ cannot import from features/); tests/package-price.test.ts
 * compares them.
 *
 * Money is integer cents. A package with no add-ons, or only taxable ones,
 * prices exactly as it always did.
 */
// ── mirrored below ──

export type RetainerRule =
  | { type: "fixed"; amountCents: number }
  | { type: "percentage"; basisPoints: number }
  | { type: "per_crew_member"; amountPerCrewCents: number };

export type PackageDiscount =
  | { type: "none" }
  | { type: "fixed"; amountCents: number }
  | { type: "percentage"; basisPoints: number };

export type PricedAddOn = {
  unitPriceCents: number;
  quantity: number;
  taxable: boolean;
};

export type PackagePrice = {
  addOnTotalCents: number;
  /** Base plus add-ons, before the discount. */
  preDiscountCents: number;
  discountCents: number;
  /** After the discount, before tax. */
  subtotalCents: number;
  /** The part of the subtotal tax is charged on. */
  taxableCents: number;
  taxCents: number;
  totalCents: number;
  retainerCents: number;
};

function percentageOf(amountCents: number, basisPoints: number): number {
  return Math.round((amountCents * basisPoints) / 10000);
}

function cents(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
}

export function pricePackage(input: {
  basePriceCents: number;
  addOns: readonly PricedAddOn[];
  discount: PackageDiscount;
  taxRateBasisPoints: number;
  retainerRule: RetainerRule;
  /** Crew a per-crew-member retainer bills for (billedCrewCount). */
  billedCrew: number;
}): PackagePrice {
  const basePriceCents = cents(input.basePriceCents);
  const lines = input.addOns.map((addOn) => ({
    total: cents(addOn.unitPriceCents) * Math.max(0, Math.trunc(addOn.quantity)),
    taxable: addOn.taxable,
  }));
  const addOnTotalCents = lines.reduce((sum, line) => sum + line.total, 0);
  const preDiscountCents = basePriceCents + addOnTotalCents;
  const requestedDiscountCents =
    input.discount.type === "none"
      ? 0
      : input.discount.type === "fixed"
        ? cents(input.discount.amountCents)
        : percentageOf(preDiscountCents, cents(input.discount.basisPoints));
  // A discount larger than the work is a typo, not a refund.
  const discountCents = Math.min(requestedDiscountCents, preDiscountCents);
  const subtotalCents = preDiscountCents - discountCents;
  // The package itself is always taxable; an add-on only when it says so. The
  // discount comes off taxable and untaxed work in proportion, so it never
  // moves tax from one to the other.
  const taxablePreDiscountCents =
    basePriceCents + lines.filter((line) => line.taxable).reduce((sum, line) => sum + line.total, 0);
  const taxableCents =
    preDiscountCents === 0
      ? 0
      : taxablePreDiscountCents === preDiscountCents
        ? subtotalCents
        : Math.round((taxablePreDiscountCents * subtotalCents) / preDiscountCents);
  const taxCents = percentageOf(taxableCents, cents(input.taxRateBasisPoints));
  const totalCents = subtotalCents + taxCents;
  const rule = input.retainerRule;
  const retainerCents =
    rule.type === "fixed"
      ? Math.min(cents(rule.amountCents), totalCents)
      : rule.type === "per_crew_member"
        ? Math.min(cents(rule.amountPerCrewCents) * Math.max(1, Math.trunc(input.billedCrew)), totalCents)
        : percentageOf(totalCents, cents(rule.basisPoints));
  return {
    addOnTotalCents,
    preDiscountCents,
    discountCents,
    subtotalCents,
    taxableCents,
    taxCents,
    totalCents,
    retainerCents,
  };
}
