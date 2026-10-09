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

import { tradeProfile, tradeVocab } from "@/features/trades/trades";

export type SetupGapKey =
  | "work"
  | "inquiries"
  | "packages"
  | "agreement"
  | "questionnaire"
  | "availability"
  | "insurance";

/**
 * Setup's questions in the order they're asked (components/setup), and what
 * each is called when Today says which comes next. One list, so Today's "Next:"
 * and setup's order can't disagree.
 */
export const SETUP_ORDER: ReadonlyArray<SetupGapKey> = [
  // First: it decides the types on the inquiry form and the words clients
  // read (docs/job-types-plan-2026-10-02.md). Never blocking.
  "work",
  "inquiries",
  "availability",
  "packages",
  "agreement",
  "questionnaire",
  // Last and skippable (H3): plenty of studios never need a certificate.
  "insurance",
];

/**
 * A vendor's setup: four questions (simpler vendor journeys, 2026-10-09).
 *
 * A makeup artist answered the same seven a photographer does. Her planning
 * forms come preloaded (the party list), so there is nothing to ask; her
 * insurance is set when a venue asks, from the job or Settings; and what she
 * does is known from signup — the kinds of job default from her trade and
 * stay changeable in Settings. What is left is what she charges, when
 * clients can book her trial or call, how inquiries reach her, and her
 * agreement.
 */
const LIGHT_SETUP_ORDER: ReadonlyArray<SetupGapKey> = ["packages", "availability", "inquiries", "agreement"];

/** Setup's questions for this studio's trade, in the order they're asked. */
export function setupOrderFor(trade: unknown): ReadonlyArray<SetupGapKey> {
  return tradeProfile(trade).journey.readiness === "essentials" ? LIGHT_SETUP_ORDER : SETUP_ORDER;
}

/**
 * How many questions setup asks, in words, for copy that says so: "Seven
 * questions, most answered right here." The count was stated three ways at
 * once (setup 7, Today "of 5", the journey page "six"), so the screens read it
 * from here, and tests/setup-count-copy.test.ts holds the rest to it.
 */
const COUNT_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
export function setupQuestionCount(trade?: unknown): string {
  const order = setupOrderFor(trade);
  return COUNT_WORDS[order.length] ?? String(order.length);
}

export const SETUP_STEP_NAME: Record<SetupGapKey, string> = {
  work: "what you shoot",
  inquiries: "how inquiries reach you",
  availability: "when clients can book a call",
  packages: "what you charge",
  agreement: "how clients sign",
  questionnaire: "your details form",
  insurance: "who sends your insurance certificates",
};

/**
 * A step's name in the studio's trade's words (features/trades/trades.ts): a
 * DJ or a makeup artist doesn't shoot, and a makeup artist or hair stylist has
 * no sales call — their clients book a trial. A photographer reads
 * SETUP_STEP_NAME as it always was.
 */
export function setupStepName(key: SetupGapKey, trade?: unknown): string {
  if (tradeProfile(trade).family === "photo") return SETUP_STEP_NAME[key];
  if (key === "work") return "what you take on";
  if (key === "availability" && !tradeProfile(trade).consultation) return "when clients can book a trial";
  return SETUP_STEP_NAME[key];
}

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
  /**
   * The studio has said who sends its certificates of insurance (H3,
   * docs/coi-automation-plan-2026-09-28.md). Optional, and never part of
   * "setup complete": only an explicit `false` asks the question.
   */
  hasCoiSettings?: boolean;
  /**
   * The studio has said what it shoots — weddings, family sessions,
   * corporate, sports (job kinds). Optional and never part of "setup
   * complete": only an explicit `false` asks.
   */
  hasChosenWork?: boolean;
  /**
   * The studio has said which form, if any, couples fill in on the page its
   * first reply links to (leadCaptureSettings.inquiryEventForm — "none" is an
   * answer). Optional and never part of "setup complete": only an explicit
   * `false` asks, and the setup hook says `false` only when there is a
   * wedding form to choose.
   */
  hasDecidedInquiryForm?: boolean;
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
  /** What the studio does (trades.ts); absent is a photographer. */
  trade?: unknown,
): SetupGap[] {
  const gaps: SetupGap[] = [];
  const photo = tradeProfile(trade).family === "photo";
  // A makeup artist or hair stylist has no sales call: the inquiry page takes
  // the details and the quote follows; clients book a trial instead.
  const calls = tradeProfile(trade).consultation;
  const offer = tradeVocab(trade).proposal.toLowerCase();

  if (state.hasChosenWork === false) {
    gaps.push({
      key: "work",
      title: photo ? "Say what you shoot" : "Say what you take on",
      detail: photo
        ? "Weddings, family sessions, corporate, sports — your inquiry form and every client's words follow it."
        : "Weddings, corporate events, parties — your inquiry form and every client's words follow it.",
      actionLabel: "Choose",
      href: "/studio/settings/job-types",
      blocking: false,
      blockedProjectName: null,
    });
  }

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
        ? `${blocked} can't get a ${offer} until a package exists to price it.`
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
        ? `${blocked} accepted their ${offer}. Set up your agreement and StudioCue writes their contract from it — they sign in their portal.`
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
        ? `${blocked} accepted their ${offer} and needs a contract. Send yours the way you do today and record the signature on the job — or connect a signing app to have StudioCue send and track it.`
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

  /**
   * GR Productions asked for it twice: "the link in that email needs to be the
   * event info form. Need that info before I call them." The page could do it
   * since 2026-10-01 — behind a setting on the Questionnaires page that nobody
   * at the studio ever saw, so every couple got "Ceremony time, anything else?"
   * (2026-10-05). The choice is asked here, and on Today once couples are
   * actually getting the link.
   */
  if (
    state.hasQuestionnaireTemplate &&
    state.hasConsultationAvailability &&
    state.hasDecidedInquiryForm === false
  ) {
    const waiting = signals.openInquiries;
    gaps.push({
      key: "questionnaire",
      title: calls ? "Choose the form couples fill in before your call" : "Choose the form couples fill in with their inquiry",
      detail: !calls
        ? waiting
          ? `${waiting === 1 ? "A couple is" : `${waiting} couples are`} getting your inquiry link. It asks a couple of details — not your event form. Choose it, and they fill it in before you send their ${offer}.`
          : `Your first reply links couples to a page. Choose your event form, and they fill it in before you send their ${offer}.`
        : waiting
        ? `${waiting === 1 ? "A couple is" : `${waiting} couples are`} getting your inquiry link. It asks a couple of details and a time to talk — not your event form. Choose it, and they fill it in before they book.`
        : "Your first reply links couples to a page. Choose your event form, and they fill it in before they pick a time to talk.",
      actionLabel: "Choose the form",
      href: INQUIRY_FORM_SETTING_HREF,
      blocking: waiting > 0,
      blockedProjectName: null,
    });
  }

  if (state.hasCoiSettings === false) {
    gaps.push({
      key: "insurance",
      title: "Say who sends your insurance certificates",
      detail: "Venues often want one. StudioCue can ask your agent, follow up and bring it back for one approval.",
      actionLabel: "Set it up",
      href: "/studio/settings/insurance",
      blocking: false,
      blockedProjectName: null,
    });
  }

  if (!state.hasConsultationAvailability) {
    const blocked = signals.openInquiries > 0;
    // The hours a client books from: a DJ's vibe call, a makeup artist's
    // trial. Either way the inquiry link waits on them
    // (functions/src/intake/inquiry-link.ts studioTakesBookings).
    const hoursFor = calls ? tradeVocab(trade).consultation.toLowerCase() : "trial";
    const waiting = `${signals.openInquiries} ${signals.openInquiries === 1 ? "inquiry is" : "inquiries are"} waiting`;
    gaps.push({
      key: "availability",
      title: `Set your ${hoursFor} hours`,
      detail: !calls
        ? blocked
          ? `${waiting} — set hours and your replies link couples to a page for their details, and their ${offer} follows.`
          : "Clients can then book their trial without the back-and-forth."
        : blocked
        ? `${waiting} — set hours and clients can pick a time themselves.`
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
/** Where a studio chooses the form its inquiry link asks for. */
export const INQUIRY_FORM_SETTING_HREF = "/studio/questionnaires#inquiry-form";

export function setupComplete(state: SetupState): boolean {
  return (
    state.hasInquiryCapture !== false &&
    state.hasActivePackage &&
    state.hasAgreementTemplate &&
    state.hasQuestionnaireTemplate &&
    state.hasConsultationAvailability
  );
}
