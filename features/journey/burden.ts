import { journeyFor, journeyProfile, type JobKind } from "@/features/job-kinds/job-kinds";
import { tradeProfile, tradeVocab } from "@/features/trades/trades";

/**
 * What a job asks of the client, by default, from booking to the day.
 *
 * Conor, 2026-10-09: "the vendor journey is less complicated than the
 * photographer journey and should be easier and less burdensome. i would be
 * disappointed if we made it more complex because we built it off the
 * photographer journey." A makeup client was being asked about ten things —
 * two forms, a schedule to approve, a two-part agreement, a retainer, a
 * final headcount, a balance. This list is read from the same profile the
 * journey, the portal and the server read (job-kinds.ts `journeyFor`), and
 * tests/vendor-burden.test.ts holds every vendor trade to five.
 *
 * An optional ask (a DJ's vibe call, a trial the bride may skip) still
 * counts when the studio offers it to everyone: offering is asking.
 */
export type ClientAsk = { key: string; label: string };

export function clientAsks(kind: JobKind, trade: unknown): ClientAsk[] {
  const shape = tradeProfile(trade);
  const words = tradeVocab(trade);
  const job = journeyFor(journeyProfile(kind), shape);
  const offer = words.proposal.toLowerCase();
  const asks: ClientAsk[] = [];
  if (job.callRequired) asks.push({ key: "call", label: `Book a ${words.consultation.toLowerCase()}` });
  if (job.oneLinkBooking) asks.push({ key: "accept_sign", label: `Accept and sign the ${offer}` });
  else {
    asks.push({ key: "accept", label: `Accept the ${offer}` });
    if (job.agreement) asks.push({ key: "sign", label: "Sign the agreement" });
  }
  if (job.payment === "deposit_and_balance") asks.push({ key: "deposit", label: "Pay the deposit" });
  if (job.payment === "paid_in_full") asks.push({ key: "pay", label: "Pay to book" });
  if (shape.trial) asks.push({ key: "trial", label: `Book the ${words.trial?.toLowerCase() ?? "trial"}` });
  if (job.detailsFormDaysBefore !== null || job.oneForm)
    asks.push({ key: "form", label: `Fill in the ${(words.detailsForm ?? "details form").toLowerCase()}` });
  if (job.scheduleApproval) asks.push({ key: "schedule", label: "Approve the day's schedule" });
  if (job.finalDetailsLock || shape.planning) {
    asks.push(
      shape.perPersonPricing
        ? { key: "headcount", label: "Confirm the final headcount" }
        : shape.planning
          ? { key: "final_call", label: `Book the ${words.finalCall.toLowerCase()}` }
          : { key: "final_details", label: "Confirm the final details" },
    );
  }
  if (job.payment === "deposit_and_balance" && !job.balanceOnTheDay) asks.push({ key: "balance", label: "Pay the balance" });
  // The address is asked while signing in one link; otherwise it is its own
  // ask weeks later, when the final bill needs it.
  if (job.billingAddressRequest && !job.oneLinkBooking && !job.balanceOnTheDay)
    asks.push({ key: "billing_address", label: "Give a billing address" });
  return asks;
}
