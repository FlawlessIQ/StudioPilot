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
export function proposalTermsFor(terms: unknown): string {
  const written = typeof terms === "string" ? terms.trim() : "";
  return written.length >= 10 ? written : DEFAULT_PROPOSAL_TERMS;
}
