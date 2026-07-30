export type BookingPackageFact = {
  id: string;
  name: string;
  active: boolean;
  basePriceCents: number;
  currency: string;
  terms: string;
};

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
  if (selected && !selected.terms.trim())
    blockers.push("APPROVED_TERMS_REQUIRED");
  return {
    selectedPackage: selected ?? null,
    aiRecommendationAccepted:
      Boolean(selected) && selected?.id === input.recommendedPackageId,
    blockers,
    ready: blockers.length === 0,
    proposal: selected
      ? {
          packageId: selected.id,
          packageName: selected.name,
          basePriceCents: selected.basePriceCents,
          currency: selected.currency,
          notes: input.proposalIntroduction.trim(),
          termsSummary: selected.terms,
          sendAutomatically: false as const,
        }
      : null,
  };
}
