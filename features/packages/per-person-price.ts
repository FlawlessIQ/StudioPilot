import { isCataloguePackage } from "@/features/packages/one-off";
import { normalizeUnitLabel } from "@/features/packages/unit-label";

/**
 * Has the studio priced anyone per person yet?
 *
 * A makeup artist or hair stylist prices her client's own look as the
 * package and everyone else getting ready per person (trades.ts
 * `perPersonPricing`). Setup's "What do you charge?" is answered by any
 * package, and its "Set per-person prices" link went with the question: a
 * hair stylist who imported one package was never asked about her
 * bridesmaids again (Priya Shah, Jess Styles Bridal, 2026-10-10). This is
 * what keeps that link asking until one is priced.
 *
 * A per-person price is an extra the client can take more than one of
 * (`allowQuantity`) priced per person. No unit counts too: the quote reads
 * "4 × $120", and that is how an extra saved from a job's own line arrives
 * (saveToLibrary keeps no unit). A unit that names something else — an hour,
 * an artist — is not a per-person price.
 */

type Row = Record<string, unknown>;

const PERSON_UNITS: ReadonlySet<string> = new Set(["person", "people", "guest", "guests"]);

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One add-on, from the library or copied onto a package, priced per person. */
export function isPerPersonAddOn(addOn: unknown): boolean {
  if (!isRow(addOn)) return false;
  // Archived in the library, or switched off on a package: not offered.
  if (addOn.archivedAt || addOn.active === false) return false;
  if (addOn.allowQuantity !== true) return false;
  const unit = normalizeUnitLabel(addOn.unitLabel);
  return unit === null || PERSON_UNITS.has(unit);
}

/**
 * Any per-person price the studio offers: in its add-on library, or on one of
 * its active catalogue packages (a one-off is one couple's, not a price list).
 */
export function hasPerPersonPrice(input: {
  addOns: readonly unknown[];
  packages: readonly unknown[];
}): boolean {
  if (input.addOns.some(isPerPersonAddOn)) return true;
  return input.packages.some(
    (item) =>
      isRow(item) &&
      item.active === true &&
      isCataloguePackage(item) &&
      Array.isArray(item.addOns) &&
      item.addOns.some(isPerPersonAddOn),
  );
}
