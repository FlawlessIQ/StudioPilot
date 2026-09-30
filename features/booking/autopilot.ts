export type BookingPackageFact = {
  id: string;
  name: string;
  active: boolean;
  basePriceCents: number;
  currency: string;
  terms: string;
};

/**
 * The terms line a proposal carries when its package has none written.
 *
 * A package's terms are optional in the catalog, but a proposal's aren't
 * (create_draft wants at least ten characters). GR Productions' packages had
 * none, and that one empty field disabled the booking brief, failed the AI's
 * proposal draft and left the composer refusing to send (2026-09-30). This is
 * studio wording, not AI output: it promises nothing the proposal and signed
 * agreement don't already say, and the studio can edit it before sending.
 */
export const DEFAULT_PROPOSAL_TERMS =
  "Coverage, deliverables and payment dates are as set out in this proposal. The signed photography agreement holds the full terms.";

/** The package's own terms, or the default when it has none written. */
export function proposalTermsFor(terms: unknown): string {
  const written = typeof terms === "string" ? terms.trim() : "";
  return written.length >= 10 ? written : DEFAULT_PROPOSAL_TERMS;
}

export function groundedBookingDraft(input: {
  recommendedPackageId: string | null;
  selectedPackageId: string | null;
  packages: readonly BookingPackageFact[];
  consultationSummary: string;
  proposalIntroduction: string;
}) {
  const selected = input.packages.find(
    (studioPackage) =>
      studioPackage.id === input.selectedPackageId && studioPackage.active,
  );
  const blockers: string[] = [];
  if (!selected) blockers.push("ACTIVE_PACKAGE_REQUIRED");
  if (!input.consultationSummary.trim())
    blockers.push("CONSULTATION_SUMMARY_REQUIRED");
  return {
    selectedPackage: selected ?? null,
    aiRecommendationAccepted:
      Boolean(selected) && selected?.id === input.recommendedPackageId,
    blockers,
    ready: blockers.length === 0,
    /** The package had no terms written; the default wording stands in. */
    termsDefaulted: Boolean(selected) && proposalTermsFor(selected?.terms) === DEFAULT_PROPOSAL_TERMS,
    proposal: selected
      ? {
          packageId: selected.id,
          packageName: selected.name,
          basePriceCents: selected.basePriceCents,
          currency: selected.currency,
          notes: input.proposalIntroduction.trim(),
          termsSummary: proposalTermsFor(selected.terms),
          sendAutomatically: false as const,
        }
      : null,
  };
}
