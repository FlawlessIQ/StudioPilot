// The functions copy of features/packages/unit-label.ts, kept identical below; tests/beauty-core.test.ts compares them.
/**
 * What an extra is priced per: "person", "hour", "print"
 * (docs/vendor-journeys-plan.md, 3.1).
 *
 * A makeup artist sells bridesmaid makeup per person, a DJ an extra hour per
 * hour. The quantity was always there (`allowQuantity`, H2); this names its
 * unit, so the quote reads "6 people × $150" rather than "6 × $150". Pure; the
 * functions copy is functions/src/packages/unit-label.ts.
 */

export const UNIT_LABEL_MAX = 24;

/** A unit as typed, tidied: "Person " → "person". Empty is none. */
export function normalizeUnitLabel(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, " ").slice(0, UNIT_LABEL_MAX) : "";
  return text || null;
}

const IRREGULAR: Record<string, string> = { person: "people", child: "children" };

/** "1 person", "6 people", "3 hours"; just the number with no unit. */
export function quantityText(quantity: number, unitLabel: unknown): string {
  const unit = normalizeUnitLabel(unitLabel);
  const count = Math.max(0, Math.trunc(quantity));
  if (!unit) return String(count);
  if (count === 1) return `1 ${unit}`;
  return `${count} ${IRREGULAR[unit] ?? (unit.endsWith("s") ? unit : `${unit}s`)}`;
}
