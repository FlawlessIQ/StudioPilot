import { extraIdeasFor } from "@/features/packages/extra-ideas";
import { isCataloguePackage } from "@/features/packages/one-off";
import { normalizeUnitLabel } from "@/features/packages/unit-label";
import { tradeProfile } from "@/features/trades/trades";

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
 * (`allowQuantity`) whose unit is a person. No unit is not enough on its own:
 * an extra saved from a job's own line with a quantity above one arrives that
 * way (saveToLibrary keeps no unit), so "Extra hour" ×2 or "Travel" ×2 would
 * pass for one. It counts only under one of her trade's per-person names —
 * "Bridesmaid hair" ×4 saved from a job is still her bridesmaids. A unit that
 * names something else — an hour, an artist — never counts.
 */

type Row = Record<string, unknown>;

const PERSON_UNITS: ReadonlySet<string> = new Set(["person", "people", "guest", "guests"]);

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nameKey(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, " ") : "";
}

/** "bridesmaid hair", "flower girl hair": the trade's own per-person extras. */
function perPersonNames(trade: unknown): ReadonlySet<string> {
  return new Set(
    extraIdeasFor(trade)
      .filter((idea) => idea.perUnit === "person")
      .map((idea) => nameKey(idea.name)),
  );
}

/** One add-on, from the library or copied onto a package, priced per person. */
export function isPerPersonAddOn(addOn: unknown, trade: unknown): boolean {
  if (!isRow(addOn)) return false;
  // Archived in the library, or switched off on a package: not offered.
  if (addOn.archivedAt || addOn.active === false) return false;
  if (addOn.allowQuantity !== true) return false;
  const unit = normalizeUnitLabel(addOn.unitLabel);
  if (unit !== null) return PERSON_UNITS.has(unit);
  return perPersonNames(trade).has(nameKey(addOn.name));
}

/**
 * Any per-person price the studio offers: in its add-on library, or on one of
 * its active catalogue packages (a one-off is one couple's, not a price list).
 */
export function hasPerPersonPrice(input: {
  addOns: readonly unknown[];
  packages: readonly unknown[];
  trade: unknown;
}): boolean {
  const perPerson = (addOn: unknown) => isPerPersonAddOn(addOn, input.trade);
  if (input.addOns.some(perPerson)) return true;
  return input.packages.some(
    (item) =>
      isRow(item) &&
      item.active === true &&
      isCataloguePackage(item) &&
      Array.isArray(item.addOns) &&
      item.addOns.some(perPerson),
  );
}

/** A tenant read as the page has it: null until it lands. */
type Read = { records: readonly unknown[] | null; error: string | null };

/**
 * What setup's answered "What do you charge?" row offers for per-person
 * prices: "ask" (a button) until one exists, "quiet" (a link) after, and
 * nothing for a trade that doesn't price per person or while the lists load.
 *
 * A failed read is not "none priced": the row keeps a quiet link rather than
 * asking on a guess. It stays reachable either way.
 */
export function perPersonPricesLink(input: {
  trade: unknown;
  addOns: Read;
  packages: Read;
}): "ask" | "quiet" | null {
  if (!tradeProfile(input.trade).perPersonPricing) return null;
  if (input.addOns.error || input.packages.error) return "quiet";
  if (input.addOns.records === null || input.packages.records === null) return null;
  return hasPerPersonPrice({ addOns: input.addOns.records, packages: input.packages.records, trade: input.trade })
    ? "quiet"
    : "ask";
}
