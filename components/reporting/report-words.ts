import { tradeProfile, tradeVocab } from "@/features/trades/trades";

/**
 * The reports page in the studio's own words (features/trades/trades.ts).
 *
 * The funnel and the offer metric were written for a photographer: a hair
 * stylist read "Consultations" for a call she never has and "Proposals sent"
 * for what she calls a quote (walk, 2026-10-09). The numbers don't change,
 * only what they're called, and a step the trade doesn't have is left out
 * rather than shown as a stage everyone skips.
 */
export function funnelStagesFor<T extends { label: string }>(stages: readonly T[], trade: unknown): T[] {
  const vocab = tradeVocab(trade);
  const profile = tradeProfile(trade);
  return stages.flatMap((stage) => {
    if (stage.label === "Consultations") return profile.consultation ? [{ ...stage, label: `${vocab.consultation}s` }] : [];
    if (stage.label === "Proposals sent") return [{ ...stage, label: `${vocab.proposal}s sent` }];
    return [stage];
  });
}

/** "Proposal acceptance" and its sample line, for the offer the trade sends. */
export function offerAcceptanceWords(trade: unknown, sent: number): { label: string; sample: string } {
  const vocab = tradeVocab(trade);
  const offers = `${vocab.proposal.toLowerCase()}s`;
  return {
    label: `${vocab.proposal} acceptance`,
    // "Delivered" meant sent; a trade with nothing to deliver reads it as the
    // wrong thing, so it says sent.
    sample: tradeProfile(trade).delivery ? `${sent} delivered ${offers} measured` : `${sent} ${offers} sent and measured`,
  };
}

/** How a finished job is described in the effort metric: delivered, or simply done. */
export function finishedWord(trade: unknown): string {
  return tradeProfile(trade).delivery ? "delivered" : "finished";
}
