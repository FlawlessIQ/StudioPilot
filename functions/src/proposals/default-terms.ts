import { tradeProfile, tradeVocab } from "../trades/trades.js";

/**
 * The terms line a proposal carries when its package has none written.
 *
 * The functions copy of features/booking/autopilot.ts's DEFAULT_PROPOSAL_TERMS
 * (functions/ can't import the app's modules); tests/blocked-ai-actions.test.ts
 * fails if the two drift. GR Productions' packages had no terms, so the AI's
 * proposal draft failed validation and Cue skipped the proposal card
 * (2026-09-30). Studio wording, not AI output; the studio edits it on the draft.
 */
export const DEFAULT_PROPOSAL_TERMS =
  "Coverage, deliverables and payment dates are as set out in this proposal. The signed photography agreement holds the full terms.";

/** The package's own terms, or the default when it has none written. */
export function proposalTermsFor(terms: unknown, trade?: unknown): string {
  const written = typeof terms === "string" ? terms.trim() : "";
  return written.length >= 10 ? written : defaultTermsInTradeWords(DEFAULT_PROPOSAL_TERMS, trade);
}

/**
 * The default wording in the studio's own trade (features/booking/autopilot.ts
 * has the same): a makeup studio's quotes said "the signed photography
 * agreement" (2026-10-09). Terms a studio wrote are left alone.
 */
export function defaultTermsInTradeWords(terms: string, trade: unknown): string {
  if (trade === undefined || tradeProfile(trade).family === "photo") return terms;
  return terms === DEFAULT_PROPOSAL_TERMS
    ? `What's included and payment dates are as set out in this ${tradeVocab(trade).proposal.toLowerCase()}. The signed agreement holds the full terms.`
    : terms;
}

/**
 * The terms for every package on a job, each under its own name.
 *
 * A studio selling photo and video together (GR Productions) holds two
 * packages, each with its own terms, and the composer, Cue's proposal card
 * and the booking brief all seeded the proposal with the first package's
 * alone — the couple read nothing about the video they were buying. One
 * package keeps its terms exactly as written, as before; several are joined,
 * one block per package that has terms, headed by its name, so nobody reads
 * the photo terms as covering the video. None written: the default wording.
 * Capped at the proposal schema's 6000 characters.
 */
export function proposalTermsForPackages(
  // Any snapshot or catalogue record: only packageName/name and terms are read.
  packages: readonly Record<string, unknown>[],
  trade?: unknown,
): string {
  const written = packages.flatMap((entry) => {
    const terms = typeof entry.terms === "string" ? entry.terms.trim() : "";
    if (terms.length < 10) return [];
    const name =
      [entry.packageName, entry.name]
        .find((value): value is string => typeof value === "string" && value.trim().length > 0)
        ?.trim() ?? "Package";
    return [{ name, terms }];
  });
  if (!written.length) return defaultTermsInTradeWords(DEFAULT_PROPOSAL_TERMS, trade);
  if (packages.length === 1) return written[0]!.terms.slice(0, 6000);
  return written
    .map((entry) => `${entry.name}: ${entry.terms}`)
    .join("\n\n")
    .slice(0, 6000);
}
