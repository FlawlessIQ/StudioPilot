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
  | "inquiries"
  | "packages"
  | "agreement"
  | "questionnaire"
  | "availability";

/**
 * Setup's questions in the order they're asked (components/setup), and what
 * each is called when Today says which comes next. One list, so Today's "Next:"
 * and setup's order can't disagree.
 */
export const SETUP_ORDER: ReadonlyArray<SetupGapKey> = [
  "inquiries",
  "availability",
  "packages",
  "agreement",
  "questionnaire",
];

export const SETUP_STEP_NAME: Record<SetupGapKey, string> = {
  inquiries: "how inquiries reach you",
  availability: "when clients can book a call",
  packages: "what you charge",
  agreement: "how clients sign",
  questionnaire: "your details form",
};

/** The first unanswered question, in setup's order. */
export function nextSetupStep(gaps: ReadonlyArray<{ key: SetupGapKey }>): SetupGapKey | null {
  const open = new Set(gaps.map((gap) => gap.key));
  return SETUP_ORDER.find((key) => open.has(key)) ?? null;
}

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
  /**
   * StudioCue writes and signs contracts for this studio
   * (features/contracts/rollout.ts). Optional so every existing caller keeps
   * the answer it had: absent means no.
   */
  nativeSigning?: boolean;
  hasQuestionnaireTemplate: boolean;
  hasConsultationAvailability: boolean;
  /**
   * Inquiries have reached StudioCue by capture (website form, inbox
   * forwarding, a forward by hand), a successful capture test, or StudioCue's
   * own inquiry form. Optional so callers that don't read it keep their
   * answer: only an explicit `false` makes it a gap.
   */
  hasInquiryCapture?: boolean;
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

  // First, because it's what a new studio feels on day one: until inquiries
  // arrive here, StudioCue has nothing to do. Never blocking — no job waits
  // on it — so it lives in setup, not Today's act lane.
  if (state.hasInquiryCapture === false) {
    gaps.push({
      key: "inquiries",
      title: "Choose how inquiries reach you",
      detail: "Your website form, your inbox, or a forward by hand.",
      actionLabel: "Set it up",
      href: "/studio/settings/inquiry-capture",
      blocking: false,
      blockedProjectName: null,
    });
  }

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
  /**
   * Once StudioCue writes contracts for a studio, the one missing piece is
   * the agreement it writes them from — and that is now a real promise, so
   * the card can make it. Everyone else keeps the two honest paths below.
   */
  if (!state.hasAgreementTemplate && state.nativeSigning) {
    const blocked = signals.projectsNeedingAgreement[0] ?? null;
    gaps.push({
      key: "agreement",
      title: "Set up your agreement",
      detail: blocked
        ? `${blocked} accepted their proposal. Set up your agreement and StudioCue writes their contract from it — they sign in their portal.`
        : "Bring in the agreement you already use. StudioCue writes each client's contract from it, and they sign in their portal.",
      actionLabel: "Set up your agreement",
      href: "/studio/contracts/agreement",
      blocking: Boolean(blocked),
      blockedProjectName: blocked,
    });
  } else if (!state.hasAgreementTemplate) {
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
      href: "/studio/settings/consultation-availability",
      blocking: blocked,
      blockedProjectName: null,
    });
  }

  return gaps;
}

/** Setup is finished when nothing is missing. */
export function setupComplete(state: SetupState): boolean {
  return (
    state.hasInquiryCapture !== false &&
    state.hasActivePackage &&
    state.hasAgreementTemplate &&
    state.hasQuestionnaireTemplate &&
    state.hasConsultationAvailability
  );
}
