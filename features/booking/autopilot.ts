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
  if (!written.length) return DEFAULT_PROPOSAL_TERMS;
  if (packages.length === 1) return written[0]!.terms.slice(0, 6000);
  return written
    .map((entry) => `${entry.name}: ${entry.terms}`)
    .join("\n\n")
    .slice(0, 6000);
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

/**
 * The default terms for a job that books without an agreement (job-kinds.ts):
 * "the signed photography agreement holds the full terms" promised a family
 * a document that never comes (walk, 2026-10-03).
 */
export function noAgreementProposalTerms(paysToBook: boolean): string {
  return paysToBook
    ? "Coverage, deliverables and payment dates are as set out in this proposal. Accepting it and paying books the date."
    : "Coverage, deliverables and payment dates are as set out in this proposal. Accepting it books the date.";
}

/** proposalTermsForPackages, with the no-agreement wording when the job has no agreement. */
export function proposalTermsForJob(
  packages: readonly Record<string, unknown>[],
  needs: { agreement: boolean; payment: boolean },
): string {
  const terms = proposalTermsForPackages(packages);
  return terms === DEFAULT_PROPOSAL_TERMS && !needs.agreement ? noAgreementProposalTerms(needs.payment) : terms;
}
