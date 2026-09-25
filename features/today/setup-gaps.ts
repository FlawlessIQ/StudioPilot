/**
 * Setup gaps — the parts of a studio that aren't configured yet.
 *
 * Phase 3 of "Today & Jobs". A new studio's missing pieces are not a
 * checklist to discover; they are answers the setup conversation asks for,
 * and — crucially — they resurface in Today **at the moment they block real
 * work**, not as permanent nagging.
 *
 * The blocking rule is the whole point. A studio with no packages and no
 * clients is not blocked: it is new. A studio with no packages and a
 * project waiting at the proposal step cannot move, and should be told
 * exactly that.
 *
 * Pure function, no I/O.
 */

export type SetupGapKey =
  | "packages"
  | "agreement"
  | "questionnaire"
  | "availability";

export type SetupGap = {
  key: SetupGapKey;
  /** What the studio is missing, in its own words. */
  title: string;
  /** Why it matters right now. */
  detail: string;
  actionLabel: string;
  href: string;
  /** True when something real is waiting on this. */
  blocking: boolean;
  /** The job that is waiting, when there is one. */
  blockedProjectName: string | null;
};

export type SetupState = {
  hasActivePackage: boolean;
  hasAgreementTemplate: boolean;
  hasQuestionnaireTemplate: boolean;
  hasConsultationAvailability: boolean;
};

export type SetupSignals = {
  /** Projects at the stage where a locked package is required. */
  projectsNeedingPackage: string[];
  /** Projects with an accepted proposal and no contract yet. */
  projectsNeedingAgreement: string[];
  /** Booked projects with no questionnaire assigned. */
  projectsNeedingForm: string[];
  /** Open inquiries that would like to self-book a consultation. */
  openInquiries: number;
};

export function setupGaps(
  state: SetupState,
  signals: SetupSignals,
): SetupGap[] {
  const gaps: SetupGap[] = [];

  if (!state.hasActivePackage) {
    const blocked = signals.projectsNeedingPackage[0] ?? null;
    gaps.push({
      key: "packages",
      title: "Add your packages",
      detail: blocked
        ? `${blocked} can't get a proposal until a package exists to price it.`
        : "Paste your price list and StudioCue drafts them for you to confirm.",
      actionLabel: blocked ? "Add a package" : "Import your price list",
      href: blocked ? "/studio/packages/new" : "/studio/import",
      blocking: Boolean(blocked),
      blockedProjectName: blocked,
    });
  }

  /**
   * What this card promised, and what the product actually does.
   *
   * It read "Import your agreement — import it once and StudioCue reuses it
   * for every client", and pointed at the import flow. StudioCue does not
   * draft or render a contract from an imported agreement: the import writes
   * an `agreementTemplates` document that nothing in the codebase reads, and
   * `hasAgreementTemplate` actually resolves to a *signing provider's*
   * template id, or to a provider being connected at all.
   *
   * So the reference studio imported his agreement, waited for a contract, and
   * told us "never got a contract to sign, so couldn't complete the run
   * through" — then asked, reasonably, "is it making the contract for me?".
   * No. It never was.
   *
   * The card now says the two things that are true. Sending your own agreement
   * and recording the signature needs no setup and always works, so this is
   * not a blocker in the way a missing package is — it is a choice between two
   * working paths, and the card names both.
   */
  if (!state.hasAgreementTemplate) {
    const blocked = signals.projectsNeedingAgreement[0] ?? null;
    gaps.push({
      key: "agreement",
      title: "How you send contracts",
      detail: blocked
        ? `${blocked} accepted their proposal and needs a contract. Send yours the way you do today and record the signature on the job — or connect a signing app to have StudioCue send and track it.`
        : "StudioCue doesn't write your contract. Send your own and record the signature, or connect a signing app to have it sent and tracked for you.",
      actionLabel: blocked ? "Record a signature" : "Set up signing",
      /**
       * Straight to the job that is waiting, because that is where the control
       * lives. The old link went to the import flow, which is the one place
       * that could not help.
       */
      href: blocked ? "/studio/projects" : "/studio/integrations",
      blocking: Boolean(blocked),
      blockedProjectName: blocked,
    });
  }

  if (!state.hasQuestionnaireTemplate) {
    const blocked = signals.projectsNeedingForm[0] ?? null;
    gaps.push({
      key: "questionnaire",
      title: "Add your details form",
      detail: blocked
        ? `${blocked} is booked — the details form is the next thing they need.`
        : "Forward the questionnaire you already send and confirm the draft.",
      actionLabel: "Import the form",
      href: "/studio/import",
      blocking: Boolean(blocked),
      blockedProjectName: blocked,
    });
  }

  if (!state.hasConsultationAvailability) {
    const blocked = signals.openInquiries > 0;
    gaps.push({
      key: "availability",
      title: "Set your consultation hours",
      detail: blocked
        ? `${signals.openInquiries} ${signals.openInquiries === 1 ? "inquiry is" : "inquiries are"} waiting — set hours and clients can pick a time themselves.`
        : "Clients can then book a time without the back-and-forth.",
      actionLabel: "Set hours",
      href: "/studio/settings#consultation-availability",
      blocking: blocked,
      blockedProjectName: null,
    });
  }

  return gaps;
}

/** Setup is finished when nothing is missing. */
export function setupComplete(state: SetupState): boolean {
  return (
    state.hasActivePackage &&
    state.hasAgreementTemplate &&
    state.hasQuestionnaireTemplate &&
    state.hasConsultationAvailability
  );
}
