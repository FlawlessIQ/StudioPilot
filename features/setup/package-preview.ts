/**
 * The words on a package card in setup's plain price review: the price, what
 * holds the date, and what's included, as the studio would say them.
 *
 * The review a new studio met after pasting its price list was the general
 * import workspace — "Template name", "Variables", "82% AI confidence",
 * "Human-gated activation" — on the step setup most needs finished
 * (onboarding audit, 2026-10-24). These read the package activation would
 * write (functions/src/studio-import/review.ts packagePreviews).
 *
 * Pure, no I/O.
 */

import { COVERAGE_ROLES, describeCoverage, type CoverageRole } from "@/features/packages/coverage";
import { tradeVocab } from "@/features/trades/trades";

/** 320000, "USD" → "$3,200"; cents only when there are any. */
export function priceLabel(cents: number, currency = "USD"): string {
  const whole = cents % 100 === 0;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: /^[A-Z]{3}$/.test(currency) ? currency : "USD",
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  }
}

export type PreviewRetainerRule =
  | { type: "percentage"; basisPoints: number }
  | { type: "fixed"; amountCents: number };

/**
 * What books the date, in the trade's word: "Retainer: 30% ($960)", "Deposit:
 * $500". Null when the price list didn't say — the package form asks then.
 */
export function depositLabel(
  rule: PreviewRetainerRule | null | undefined,
  basePriceCents: number,
  currency: string,
  trade?: unknown,
): string | null {
  if (!rule) return null;
  const word = tradeVocab(trade).deposit;
  const Word = word.charAt(0).toUpperCase() + word.slice(1);
  if (rule.type === "percentage") {
    if (rule.basisPoints <= 0) return null;
    const percent = rule.basisPoints / 100;
    const amount = Math.round((basePriceCents * rule.basisPoints) / 10_000);
    return `${Word}: ${Number.isInteger(percent) ? percent : percent.toFixed(1)}%${amount > 0 ? ` (${priceLabel(amount, currency)})` : ""}`;
  }
  if (rule.amountCents <= 0) return null;
  return `${Word}: ${priceLabel(rule.amountCents, currency)}`;
}

/** "8 hours · 2 photographers"; the hours left out when the list gave none. */
export function coverageLabel(
  minutes: number,
  coverage: ReadonlyArray<{ role: string; count: number }>,
): string | null {
  const people = describeCoverage(
    coverage.filter((item): item is { role: CoverageRole; count: number } =>
      (COVERAGE_ROLES as readonly string[]).includes(item.role),
    ),
  );
  const hours = minutes > 0 ? minutes / 60 : 0;
  const time = hours
    ? `${Number.isInteger(hours) ? hours : hours.toFixed(1)} ${hours === 1 ? "hour" : "hours"}`
    : "";
  return [time, people].filter(Boolean).join(" · ") || null;
}
