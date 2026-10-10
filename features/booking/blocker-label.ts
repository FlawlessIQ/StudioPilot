import { tradeVocab } from "@/features/trades/trades";

/**
 * What a gate blocker means, in the studio's words.
 *
 * The booking page and Cue's confirm card printed the requirement's key —
 * "Still waiting on: eventDateAvailable" — found walking Cue on production,
 * 2026-09-29.
 */
export function bookingBlockerLabel(key: string, trade?: unknown): string {
  // A vendor's client pays a deposit, not a retainer (trades.ts `deposit`).
  const deposit = tradeVocab(trade).deposit;
  const labels: Record<string, string> = {
    contractCompleted: "the signed contract",
    retainerInvoiceCreated: `the ${deposit} invoice`,
    retainerSatisfied: `the ${deposit} payment`,
    eventDateAvailable: "the date — another booked job is on the same day",
    requiredContactsComplete: "the couple's name and email",
  };
  return labels[key] ?? key.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ").toLowerCase();
}
