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

  if (!state.hasAgreementTemplate) {
    const blocked = signals.projectsNeedingAgreement[0] ?? null;
    gaps.push({
      key: "agreement",
      title: "Import your agreement",
      detail: blocked
        ? `${blocked} accepted their proposal and is waiting on a contract.`
        : "Import it once and StudioCue reuses it for every client.",
      actionLabel: "Import the agreement",
      href: "/studio/import",
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
