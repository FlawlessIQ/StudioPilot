"use client";

import { useWorkspace } from "@/features/auth/workspace-context";
import { tradeProfile, tradeVocab } from "@/features/trades/trades";
import { callWords } from "@/components/studio/trade-words";

/**
 * Page introductions that name the studio's own steps.
 *
 * The pages are server components, which can't know the trade (it's read in
 * the browser with the workspace), so the one sentence that depends on it is
 * rendered here.
 */

/** /studio/calendar: what's on it besides event dates. */
export function CalendarIntro() {
  const calls = callWords(useWorkspace().tenantTrade);
  return <>{`See event dates and ${calls.booked}, then schedule without calendar conflicts or duplicate meetings.`}</>;
}

/** /studio/booking: what has to be in before a job is booked. */
export function BookingChecklistIntro() {
  const trade = useWorkspace().tenantTrade;
  const vocab = tradeVocab(trade);
  // A makeup or hair studio has no call before the quote (trades.ts).
  const steps = [
    tradeProfile(trade).consultation ? vocab.consultation.toLowerCase() : null,
    vocab.proposal.toLowerCase(),
    "contract",
    "retainer",
    "event date",
  ].filter(Boolean);
  return <>{`Confirm the ${steps.join(", ")}, and client details before marking a project booked.`}</>;
}
