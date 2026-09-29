/**
 * What a gate blocker means, in the studio's words.
 *
 * The booking page and Cue's confirm card printed the requirement's key —
 * "Still waiting on: eventDateAvailable" — found walking Cue on production,
 * 2026-09-29.
 */
export function bookingBlockerLabel(key: string): string {
  const labels: Record<string, string> = {
    contractCompleted: "the signed contract",
    retainerInvoiceCreated: "the retainer invoice",
    retainerSatisfied: "the retainer payment",
    eventDateAvailable: "the date — another booked job is on the same day",
    requiredContactsComplete: "the couple's name and email",
  };
  return labels[key] ?? key.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ").toLowerCase();
}
