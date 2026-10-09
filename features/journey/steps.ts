import { journeyFor, vocab, type JourneyProfile } from "@/features/job-kinds/job-kinds";
import { tradeProfile, tradeVocab } from "@/features/trades/trades";
import type { ProjectState } from "@/features/projects/schema";
import type { FileRef } from "@/features/documents/file-ref";
import { projectStateLabel } from "@/features/projects/state-label";
import { awaitingEventReconciliation } from "@/features/projects/job-moment";

/**
 * The Journey — Gabriel's easy flow as a deterministic engine.
 *
 * A photographer thinks in one thread per couple: inquiry → reply → consult →
 * proposal → contract → retainer → schedule form → run of show → crew → COI →
 * final balance → day-before → event → delivery → album & review. This module
 * turns the project's actual records into that thread: every step gets a
 * status, and exactly ONE step is "current" — the single next thing the
 * studio should do. Pure function, no I/O; the UI feeds it plain values.
 */

export type JourneyStepKey =
  | "inquiry"
  | "first_reply"
  | "consultation"
  | "proposal"
  | "contract"
  | "retainer"
  | "trial"
  | "schedule_form"
  | "run_of_show"
  | "final_call"
  | "crew"
  | "extensions"
  | "coi"
  | "final_balance"
  | "day_before"
  | "event_day"
  | "delivery"
  | "album_review";

/**
 * What each step needs finished before it may be the studio's next move.
 *
 * The next move is `steps.find((step) => step.status === "current")`, so a step
 * that claims `current` too early *becomes* the instruction on the job page. A
 * step waiting on the client is `waiting_client`, not `current`, which means
 * the finder walks straight past it — and the step behind it inherits the card
 * without being asked whether its own input had arrived.
 *
 * That is how a job whose proposal had been sent ninety seconds earlier, and
 * never opened, came to lead with "Send contract — built from the accepted
 * proposal", linking to a contracts page that answered "The client's accepted
 * proposal is required first." The card sent the studio somewhere that refused
 * them, and the only thing that noticed was a person walking the product by
 * hand.
 *
 * Declared here rather than left implicit in each step's ternaries, because
 * `tests/journey-preconditions.test.ts` enforces three things against it over
 * every combination of records it can construct:
 *
 *   1. a `current` step's requirements are all complete;
 *   2. an `upcoming` step offers no action, so nobody is sent to a page that
 *      will refuse them;
 *   3. a `current` step offers *something* — an action or a manual advance —
 *      because a next move you cannot take is not a next move.
 *
 * An empty list is a real answer and several steps have one. It means the step
 * can genuinely be started whenever the studio likes, and the reason is worth
 * writing down:
 *
 * - `consultation`, `proposal` — a studio may book a call or price a job
 *   before replying in StudioCue; plenty reply from their phone.
 * - `schedule_form`, `coi`, `crew` — preparation work with no ordering between
 *   them. Chaining these is exactly the defect B9 fixed in the readiness
 *   template, and it is not being reintroduced here.
 * - `run_of_show` — deliberately open, though it reads the form. The generator
 *   asks for coverage and ceremony times directly and says so ("Fill in what
 *   you know. Anything you leave blank is guessed"), and "Build it myself"
 *   needs nothing at all. Drafting early is legitimate; only the claim that it
 *   came from the form was wrong.
 * - `final_balance`, `day_before`, `event_day` — gated by the calendar, not by
 *   another step. `unlock` carries that ("Unlocks about 45 days before the
 *   event").
 */
export const journeyStepRequires: Record<
  JourneyStepKey,
  readonly JourneyStepKey[]
> = {
  inquiry: [],
  first_reply: ["inquiry"],
  consultation: [],
  // The composer refuses a job still at LEAD — `canCreateProposalForProject`
  // takes CONSULTATION and PROPOSAL only. This used to be declared as needing
  // nothing, and the journey duly offered "Prepare proposal" on an enquiry
  // nobody had spoken to yet.
  proposal: ["consultation"],
  // Both destinations refuse without the step before: /studio/contracts wants
  // an accepted proposal, and the retainer is created after signature.
  contract: ["proposal"],
  retainer: ["contract"],
  // A makeup or hair trial: booked from the studio's link before or after the
  // agreement, so it waits on nothing.
  trial: [],
  schedule_form: [],
  run_of_show: [],
  // Booked by the couple from the link the details lock sends: nothing the
  // studio does first, and nothing it offers before then.
  final_call: [],
  crew: [],
  // Hair extensions to order, logged at the trial (features/trades/extensions.ts).
  extensions: [],
  coi: [],
  final_balance: [],
  day_before: [],
  event_day: [],
  // There is no gallery to deliver before the event, and nothing to select
  // from or review before a gallery.
  delivery: ["event_day"],
  album_review: ["delivery"],
};

/**
 * The requirements for this studio's trade. A DJ's vibe call is offered,
 * never required, so a DJ's quote needs nothing first; the composer takes a
 * DJ's job at LEAD (proposals/eligibility.ts) for the same reason.
 */
export function journeyStepRequiresFor(trade: unknown): Record<JourneyStepKey, readonly JourneyStepKey[]> {
  return tradeProfile(trade).journey.callRequired ? journeyStepRequires : { ...journeyStepRequires, proposal: [] };
}

export type JourneyStepStatus =
  | "complete"
  | "current"
  | "waiting_client"
  | "waiting_other"
  /**
   * The moment for this step has gone.
   *
   * A preparation step that never got done does not stop mattering when the
   * event passes — the rail should still show it was missed — but it stops
   * being *work*. A wedding shot sixty days ago was showing "YOUR NEXT MOVE —
   * Send the form · Prep locations, times, and family names", pointing the
   * studio at the couple's planning questionnaire two months after the day it
   * was for, while the gallery sat undelivered.
   *
   * Never becomes `current`, carries no action, and is drawn as neither done
   * nor outstanding.
   */
  | "passed"
  | "upcoming";

export type JourneyAction =
  | { kind: "link"; label: string; href: string }
  | {
      kind: "draft";
      label: string;
      trigger: "inquiry_reply" | "day_before_checklist" | "review_request";
    };

/** Who the journey is waiting on for this step. */
export type JourneyOwner = "studio" | "client" | "provider";

export type JourneyStep = {
  key: JourneyStepKey;
  title: string;
  detail: string;
  status: JourneyStepStatus;
  action: JourneyAction | null;
  /**
   * Every step is a door: the place where this step's record lives, whatever
   * its status. Complete steps open their evidence, waiting steps open the
   * thing being waited on, upcoming steps open the surface where the work
   * will happen.
   */
  record: { label: string; href: string } | null;
  /** Owner chip: null for complete/upcoming, set while a step is in play. */
  owner: JourneyOwner | null;
  /** For upcoming steps: one plain sentence on what unlocks it. */
  unlock: string | null;
  /**
   * Manual advance for steps whose completion is a plain state transition
   * (never for evidence-controlled ones): "this already happened outside
   * StudioCue — mark it done."
   */
  advance: { targetState: string; label: string } | null;
  /**
   * True when this step's `detail` is the answer to "why does that say
   * that?", and the rail must show it rather than the title alone.
   *
   * The rail rendered a tick and a title and nothing else, so "Crew confirmed"
   * carried a check mark on a job with no crew, no booking, and a crew page
   * the studio had never opened. The reason was correct and already written —
   * `detail` read "Shooting this one solo" — and thrown away at the markup. A
   * tick with no explanation on work nobody did reads as a bug in the product.
   *
   * Set, not derived from copy, and set only where completion is vacuous or
   * happened outside StudioCue. Fourteen second lines in a narrow rail would
   * be its own defect; these are the ones that need a sentence.
   */
  explain: boolean;
  /**
   * The files this step produced or holds — the signed contract, the proposal
   * PDF, the couple's answers — opened in place from the rail
   * (docs/document-access-plan-2026-09-28.md). Empty when there are none.
   */
  files: FileRef[];
};

/**
 * What the records behind a step are, when the caller has them: the specific
 * record to open instead of a list page, and the files it carries. Plain data,
 * so the engine stays pure.
 */
export type JourneyEvidence = Partial<
  Record<JourneyStepKey, { href?: string | null; files?: readonly FileRef[] }>
>;

export type JourneyInput = {
  projectId: string;
  state: ProjectState | string;
  eventDate: string | null; // YYYY-MM-DD
  today: string; // YYYY-MM-DD
  /**
   * The inquiry this job came from. `replied` is read from the thread
   * (features/inquiries/next-move.ts); without it, only a lead's status can
   * say, and "converted" no longer means anyone replied — every dated
   * inquiry is converted on arrival.
   */
  lead: { id: string; status: string; replied?: boolean } | null;
  hasConsultation: boolean;
  proposalStatus: string | null;
  /**
   * The proposal went out inside a booking agreement (H2) that is waiting for
   * the couple: signing it is the acceptance, so the step says so.
   */
  bookingAgreementOut?: boolean;
  contractStatus: string | null;
  retainerInvoiceStatus: string | null;
  /**
   * No invoice follows the signature: nothing was connected to raise one
   * (bookingOrchestrations `policy.createRetainerAfterSignature: false`,
   * waiting for payment). The client pays the studio directly and the studio
   * records it — never "Create retainer invoice" through an app that isn't
   * connected (Riley Park, Spin Theory DJs, 2026-10-09).
   */
  depositByStudio?: boolean;
  finalInvoiceStatus: string | null;
  /**
   * True when the final balance is past its due date. Status alone cannot
   * say this, and it changes whose job the step is: an invoice merely sent
   * is with the client, but one that has gone past its date is the studio's
   * to chase.
   */
  finalInvoiceOverdue?: boolean;
  questionnaireStatus: string | null;
  /**
   * Whether the studio has an active questionnaire this job could be sent.
   *
   * A job with event type `other` was told "Send the form" when no form for
   * that type existed — the three starter templates cover wedding, corporate
   * and sports. Optional so callers that do not know keep today's behaviour.
   */
  hasSendableQuestionnaire?: boolean;
  /**
   * Whether the submitted questionnaire actually carries answers. Required, not
   * optional: `status: "submitted"` with `answers: {}` was ticking this step in
   * production, so a caller must not be able to omit the substance check by
   * forgetting a field. Compute with `questionnaireIsAnswered`.
   */
  questionnaireHasAnswers: boolean;
  /**
   * Where the standing questionnaire was filled in: "inquiry_page" when the
   * couple sent the studio's event form from their inquiry link, before the
   * consultation (functions/src/intake/inquiry-form.ts). It counts the same;
   * only the wording changes. Optional so existing callers are unchanged.
   */
  questionnaireSource?: string | null;
  scheduleStatus: string | null;
  /**
   * The final details call a month out (features/consultations/final-call.ts).
   * Absent or null: the job has none, and no step is shown.
   */
  finalCall?: {
    state: "not_yet" | "invited" | "booked" | "held";
    lockOn: string | null;
    startsAt: string | null;
  } | null;
  /** A makeup or hair trial (features/consultations/trial.ts); only read for a trade with one. */
  trial?: { state: "not_booked" | "booked" | "held"; startsAt: string | null } | null;
  /**
   * Hair extensions to buy or rent, from the trial notes, and whether the
   * order task is done (features/trades/extensions.ts). Null or absent: none
   * to order, and no step.
   */
  extensions?: { plan: "buy" | "rent"; colorMatch: string | null; ordered: boolean; orderBy: string | null } | null;
  /**
   * The couple's answer to the current version: "client_pending",
   * "client_approved" or "changes_requested".
   *
   * A published version keeps `status: "published"` whatever the couple says;
   * their answer is here. Reading status alone, the step said "Shared with
   * your crew and the couple" after the couple had approved it, and after they
   * had asked for changes — so a request for changes looked like nothing had
   * happened (GR Productions, 2026-10-01). Optional so callers that do not
   * know about it are unchanged.
   */
  scheduleApprovalState?: string | null;
  /**
   * Whether the settled schedule holds at least one item a person could read.
   * Same reasoning: "approved" with unreadable items ticked Run of show while
   * the couple's brief showed "Invalid Date" six times. Compute with
   * `scheduleIsUsable`.
   */
  scheduleHasUsableItems: boolean;
  crewAccepted: number;
  /**
   * How many crew roles this job asked for at all: every assignment offered on
   * it. Zero means nobody was asked, which is a solo wedding, not an unmet
   * step — the same reading the readiness engine takes (see
   * features/readiness/checkpoint-evidence.ts). Without it "Crew confirmed"
   * could never tick for a photographer shooting alone, and the job page
   * showed "100% ready — nothing blocking" directly above "Crew confirmed ✗".
   */
  crewRequired?: number;
  /**
   * The booked package includes more than one photographer (a second shooter),
   * so "no crew offered" is NOT a solo shoot — the client paid for coverage
   * that still needs arranging. Without this, a 2-photographer package with no
   * crew offered ticked "Crew confirmed · shooting this one solo".
   */
  packageNeedsSecondShooter?: boolean;
  /**
   * Whether a package has been chosen at all.
   *
   * Absent means the caller has no opinion, which keeps every existing caller
   * unchanged. `false` means no package is locked yet — and without that, a
   * brand-new enquiry read "Crew confirmed · Shooting this one solo" and
   * counted the step done: no package means no coverage means nobody to book,
   * which is arithmetic rather than a decision the studio has made.
   */
  packageChosen?: boolean;
  crewCascadeActive: boolean;
  coiStatus: string | null;
  /** "unknown" | "required" | "not_required" — see projects/schema.ts. */
  insuranceRequired: string | null;
  /**
   * Readiness checkpoints the studio has already settled by hand, by template
   * key — `complete` and `waived` both count.
   *
   * A waiver is a recorded decision with a reason in the audit log, and
   * readiness treats it as satisfied. The journey did not read it at all, so a
   * job at 12/12 with a waived certificate still showed "Insurance to venue"
   * outstanding and pointed the photographer at a request they had already
   * decided not to make.
   */
  settledCheckpointKeys?: readonly string[];
  dayBeforeDraftStatus: string | null;
  hasDelivery: boolean;
  albumOrReviewDone: boolean;
  /** Record-specific links and files, by step. Optional; see JourneyEvidence. */
  evidence?: JourneyEvidence;
  /**
   * The job's kind of work, as its journey profile (job-kinds.ts). Absent,
   * every step applies — the wedding journey, as it always was.
   */
  profile?: Pick<
    JourneyProfile,
    "kind" | "consultation" | "agreement" | "payment" | "runOfShow" | "crew" | "coi"
  > & { album?: boolean };
  /**
   * What the studio does (features/trades/trades.ts): its words for the crew,
   * the plan of the day and the day itself, and whether anything is delivered
   * afterwards. Absent is a photographer, the journey as it always was.
   */
  trade?: unknown;
};

const STATE_RANK: Record<string, number> = {
  LEAD: 0,
  CONSULTATION: 1,
  PROPOSAL: 2,
  CONTRACT_PENDING: 3,
  RETAINER_PENDING: 4,
  BOOKED: 5,
  PLANNING: 6,
  READY: 7,
  EVENT_COMPLETE: 8,
  POST_PRODUCTION: 9,
  DELIVERED: 10,
  REVIEW_REQUESTED: 11,
  CLOSED: 12,
};

const rank = (state: string): number => STATE_RANK[state] ?? 0;

const daysUntil = (eventDate: string | null, today: string): number | null => {
  if (!eventDate) return null;
  const event = Date.parse(`${eventDate}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(event) || !Number.isFinite(now)) return null;
  return Math.round((event - now) / 86_400_000);
};

/**
 * An unpaid invoice past its due date. Shared so every caller of
 * projectJourney decides this the same way — the surfaces disagreeing about
 * one job was the whole reason the step gained this input.
 */
export function invoiceIsOverdue(
  invoice: Record<string, unknown> | null | undefined,
  today: string,
): boolean {
  if (!invoice) return false;
  const status = typeof invoice.status === "string" ? invoice.status : "";
  if (["paid", "voided", "refunded"].includes(status)) return false;
  if (Number(invoice.balanceCents ?? 0) <= 0 && status !== "sent") return false;
  const due = typeof invoice.dueDate === "string" ? invoice.dueDate.slice(0, 10) : "";
  return Boolean(due) && due < today;
}

/**
 * The steps this kind of job has (features/job-kinds/job-kinds.ts).
 *
 * A family session has no agreement and is paid in full to book; a sports day
 * has neither an agreement nor anything to pay before the day; a corporate
 * job may be invoiced after. The journey was fifteen fixed steps, so a sports
 * job showed a retainer, a final balance and a contract its workflow had
 * already dropped (job-types plan, B7). A step the job doesn't have is left
 * out — not shown as owed — and a step whose meaning changes says so. A step
 * that already has a record behind it stays, whatever the profile says: the
 * history of the job is still its history.
 */
function shapeForProfile(steps: JourneyStep[], input: JourneyInput): void {
  const drop = (key: JourneyStepKey) => {
    const index = steps.findIndex((step) => step.key === key);
    if (index >= 0) steps.splice(index, 1);
  };
  const retitle = (key: JourneyStepKey, title: string) => {
    const step = steps.find((candidate) => candidate.key === key);
    if (step) step.title = title;
  };
  // The studio's trade (trades.ts): a DJ or a makeup artist delivers nothing
  // afterwards, so the day leads straight to the review. A delivery already
  // recorded stays, as every step with a record does.
  const trade = tradeProfile(input.trade);
  if (!trade.delivery && !input.hasDelivery) drop("delivery");
  if (!trade.album) retitle("album_review", "Review");
  if (!trade.clientDayBefore && !input.dayBeforeDraftStatus) drop("day_before");
  // A makeup or hair inquiry goes straight to the quote: the trial does the
  // sales call's job (trades.ts `consultation`). A call already booked stays.
  if (!trade.consultation && !input.hasConsultation) drop("consultation");
  // One profile: the kind, lightened by the trade (job-kinds.ts `journeyFor`).
  const profile = input.profile
    ? journeyFor(input.profile, trade, { insuranceRequired: input.insuranceRequired })
    : null;
  if (!profile) return;
  if (!profile.agreement && !input.contractStatus) drop("contract");
  if (!profile.consultation && !input.hasConsultation) drop("consultation");
  // Insurance only when the venue asked, for a trade that does not need it
  // on every job — or when a certificate is already under way.
  if (!profile.coi && !input.coiStatus) drop("coi");
  if (!profile.runOfShow && !input.scheduleStatus) drop("run_of_show");
  if (!profile.crew && !(input.crewRequired ?? 0)) drop("crew");
  // No album for this kind (sports, corporate): the last step is the review.
  if (profile.album === false) retitle("album_review", "Review");
  switch (profile.payment) {
    case "paid_in_full": {
      retitle("retainer", "Paid in full");
      if (!input.finalInvoiceStatus) drop("final_balance");
      // The whole price, paid to book: no "retainer rule", no signature.
      const payment = steps.find((candidate) => candidate.key === "retainer");
      if (payment) {
        if (payment.detail === "Computed from your retainer rule") payment.detail = "The whole price, paid to book";
        if (payment.detail === "Starts once the agreement is signed")
          payment.detail = `Starts once they accept the ${tradeVocab(input.trade).proposal.toLowerCase()}`;
        if (payment.action?.kind === "link" && payment.action.label === "Create retainer invoice")
          payment.action = { ...payment.action, label: "Send the invoice" };
      }
      break;
    }
    case "on_the_day":
      if (!input.retainerInvoiceStatus) drop("retainer");
      retitle("final_balance", "Paid on the day");
      break;
    case "invoice_after":
      if (!input.retainerInvoiceStatus) drop("retainer");
      retitle("final_balance", "Invoice after the event");
      break;
    default:
      break;
  }
}

/**
 * A vendor's journey, lightened (simpler vendor journeys, 2026-10-09).
 *
 * The DJ, makeup and hair journeys were built from the photographer's and
 * came out at fourteen steps to its fifteen. Conor: "the vendor journey is
 * less complicated … and should be easier and less burdensome." What a
 * vendor thinks of as one thing is one step: booking is signing and paying,
 * the party list is the morning's schedule, the planner is the run of show.
 * Routine moves fold into the step beside them. Nothing is lost: each step
 * that folds in still speaks through the step it joined while it is the
 * thing left to do.
 */
function shapeForLightJourney(steps: JourneyStep[], input: JourneyInput): void {
  const light = tradeProfile(input.trade).journey;
  const find = (key: JourneyStepKey) => steps.find((step) => step.key === key);
  const remove = (key: JourneyStepKey) => {
    const index = steps.findIndex((step) => step.key === key);
    if (index >= 0) steps.splice(index, 1);
  };
  // Done or gone by: either way, not the thing left to do.
  const settled = (step: JourneyStep) => step.status === "complete" || step.status === "passed";
  /**
   * Two steps as one. The one that stays keeps its place and key (Today, the
   * plan areas and the portal read keys); it speaks for whichever half comes
   * first and is not yet done, and once both are, for the later.
   */
  const fold = (
    keepKey: JourneyStepKey,
    foldKey: JourneyStepKey,
    title?: string,
    // Once both halves are done, whose line closes it: the step that stays
    // ("Party list · filled in"), or the one folded in ("Booked · booking
    // locked in").
    closing: "keep" | "folded" = "keep",
  ) => {
    const keep = find(keepKey);
    const folded = find(foldKey);
    if (keep && title) keep.title = title;
    if (!keep || !folded) return;
    const [first, second] = steps.indexOf(keep) < steps.indexOf(folded) ? [keep, folded] : [folded, keep];
    const bothDone = settled(first) && settled(second);
    const speaker = bothDone ? (closing === "keep" ? keep : folded) : !settled(first) ? first : second;
    if (speaker !== keep) {
      keep.status = speaker.status;
      keep.detail = speaker.detail;
      keep.action = speaker.action;
      keep.advance = speaker.advance;
      keep.explain = speaker.explain || keep.explain;
    }
    // The merged step still waits on what the kept step waits on: "Booked"
    // is not the next move while the quote itself is unanswered.
    const waitingOn = journeyStepRequiresFor(input.trade)[keepKey].some((key) => {
      const required = find(key);
      return required !== undefined && required.status !== "complete";
    });
    if (waitingOn && keep.status === "current") {
      keep.status = "upcoming";
      keep.action = null;
      keep.advance = null;
    }
    remove(foldKey);
  };
  const words = tradeVocab(input.trade);

  if (light.foldRoutine) {
    // Cue sends the first reply; it is part of the inquiry arriving.
    fold("inquiry", "first_reply", "Inquiry", "folded");
  }

  // An optional call (a DJ's vibe call): offered, never the next move, and
  // gone once the quote is out without one.
  const call = find("consultation");
  if (call && !light.callRequired && !input.hasConsultation) {
    if (rank(String(input.state)) >= 2 || input.proposalStatus) remove("consultation");
    else {
      call.title = `${words.consultation} (optional)`;
      call.status = "upcoming";
      call.detail = `Offer one if they'd like to talk first — the ${words.proposal.toLowerCase()} doesn't wait for it`;
    }
  }

  if (light.oneLinkBooking) {
    // Sign and pay the deposit in one link.
    fold("contract", "retainer", "Booked", "folded");
  }

  if (light.oneForm) {
    // The party list builds the morning's schedule; the planner drafts the
    // run of show. One step, named for the form the client fills in.
    fold("schedule_form", "run_of_show");
    // Once the form is in, the plan is drafted from it when the studio opens
    // the schedule (planning: drafted from the returned form), so the move is
    // to check it and publish — nothing for the client to approve.
    const plan = find("schedule_form");
    if (plan && plan.status === "current" && plan.detail.startsWith("Ready to lay out from")) {
      plan.detail = `Drafted from their ${(words.detailsForm ?? "form").toLowerCase()} — check it and publish`;
      if (plan.action?.kind === "link") plan.action = { ...plan.action, label: "Check and publish" };
    }
  }

  if (light.foldRoutine) {
    // The day-before note belongs to the day itself.
    fold("event_day", "day_before");
  }

  // A makeup artist's or hair stylist's kit (trades.ts `kitChecklist`): the
  // day before, the day says what to pack. It was a step of its own; the
  // crew's reminder email carries the full list.
  const kit = words.kitChecklist;
  const kitDays = daysUntil(input.eventDate, input.today);
  const morning = find("event_day");
  if (kit && morning && morning.status === "upcoming" && kitDays !== null && kitDays >= 0 && kitDays <= 1) {
    morning.detail = `Pack ${kit.items.slice(2, 5).join(", ")} — and check ${kit.items[0]}`;
  }

  // The balance: collected on the morning (makeup, hair), or invoiced by
  // itself before the night (a DJ). Either way it is only a step of its own
  // when it has gone overdue.
  const balance = find("final_balance");
  if (balance && light.oneForm && !input.finalInvoiceOverdue) {
    const paid = input.finalInvoiceStatus === "paid";
    remove("final_balance");
    const day = find("event_day");
    if (day && light.balanceOnTheDay && !paid && day.status === "upcoming") {
      day.detail = `${day.detail} · collect the balance on the day`;
    }
  }

  // Makeup and hair confirm the headcount in one tap when the details lock;
  // there is no call to book (Phase 2: the one-tap confirmation).
  const finalCall = find("final_call");
  if (finalCall && tradeProfile(input.trade).perPersonPricing) {
    finalCall.title = "Final headcount";
    const state = input.finalCall?.state;
    finalCall.detail =
      state === "held" || state === "booked"
        ? "Confirmed"
        : state === "invited"
          ? "Waiting for them to confirm who's getting ready"
          : "They confirm who's getting ready when the details lock";
  }

  const day = find("event_day");
  if (day && day.title === "Event day") day.title = words.dayName;
}

export function projectJourney(input: JourneyInput): {
  steps: JourneyStep[];
  current: JourneyStep | null;
} {
  const stateRank = rank(String(input.state));
  // The kind's words: "the family", "Session details" (job-kinds.ts). No
  // profile is the wedding journey, as it always was.
  const words = vocab(input.profile?.kind ?? "wedding");
  const tradeWords = tradeVocab(input.trade);
  const delivers = tradeProfile(input.trade).delivery;
  const who = words.clientFallback;
  const Who = `${who.charAt(0).toUpperCase()}${who.slice(1)}`;
  const days = daysUntil(input.eventDate, input.today);
  const afterEvent = days !== null && days < 0;
  /**
   * Whether the event is behind this job, by the date or by the state.
   *
   * The date alone is not enough: a job moved to EVENT_COMPLETE early, or one
   * whose date is missing, is still past its preparation. Preparation steps use
   * this to stop being work — see the `passed` status.
   */
  const eventBehindThem = afterEvent || stateRank >= 8;
  /** A preparation step that never got done and no longer can be. */
  const prepStatus = (
    live: JourneyStepStatus,
  ): JourneyStepStatus => (eventBehindThem ? "passed" : live);
  /** Its action, dropped once the moment has gone. */
  const prepAction = <T,>(action: T): T | null =>
    eventBehindThem ? null : action;
  /**
   * A step that cannot start yet is upcoming, not current.
   *
   * The next move is `steps.find((step) => step.status === "current")`, and a
   * step waiting on the client is `waiting_client` — so the finder walked
   * straight past it and landed on the *following* step, which claimed
   * `current` with no reference to whether its own input had arrived. A job
   * whose proposal had been sent ninety seconds earlier and never opened led
   * with "Send contract — built from the accepted proposal"; the contracts page
   * it linked to then refused, saying "The client's accepted proposal is
   * required first." One stage later the same thing happened with "Draft the
   * schedule — drafted from the form" against a form at 0%.
   *
   * It is not a copy problem. Gating each step on its own precondition lets the
   * card fall through to the waiting state it already has — "Nothing for you
   * right now. This job is waiting on someone else." — which is both true and
   * already built.
   */
  const gate = (
    ready: boolean,
    live: JourneyStepStatus,
  ): JourneyStepStatus => (ready ? live : "upcoming");
  const project = (suffix: string) => `${suffix}?project=${input.projectId}`;

  const steps: JourneyStep[] = [];
  const push = (
    step: Omit<
      JourneyStep,
      "record" | "owner" | "unlock" | "advance" | "explain" | "files"
    > &
      Partial<
        Pick<
          JourneyStep,
          "record" | "owner" | "unlock" | "advance" | "explain" | "files"
        >
      >,
  ) =>
    steps.push({
      record: null,
      owner: null,
      unlock: null,
      advance: null,
      explain: false,
      files: [],
      ...step,
    });

  push({
    key: "inquiry",
    title: "Inquiry received",
    detail: input.lead ? "From your inquiry form" : "Project created",
    status: "complete",
    action: null,
  });

  // First reply only exists when the project came from a lead.
  if (input.lead) {
    const replied = input.lead.replied ?? (input.lead.status !== "new" || stateRank >= 1);
    push({
      key: "first_reply",
      title: "First reply",
      detail: replied
        ? "The client heard back from you"
        : "A personalized reply is one approval away",
      status: replied ? "complete" : "current",
      action: replied
        ? null
        : // The drafted reply waits in the job's prepared tray. The inquiry's
          // own page now hands straight back to the job, so linking there went
          // in a circle.
          { kind: "link", label: "Review reply", href: `/studio/projects/${input.projectId}#prepared` },
    });
  }

  // Reaching CONSULTATION *is* the record that the consultation happened: the
  // only ways in are a booked meeting (which sets hasConsultation) or the
  // operator saying it happened outside StudioCue. This required rank >= 2
  // (PROPOSAL), so the "It already happened — mark done" button moved the
  // project to CONSULTATION, left the step current, and then removed itself
  // because it is only offered from LEAD — a dead end on the second step of the
  // lifecycle, with the only remaining action being "Schedule consultation" for
  // a consultation that had already happened.
  // A kind with no consultation (a family session, a sports day) prices
  // straight from the inquiry: the proposal is the studio's move from the
  // start (job-kinds.ts; walk, 2026-10-03).
  const consulted =
    input.hasConsultation ||
    stateRank >= 1 ||
    input.profile?.consultation === false ||
    !tradeProfile(input.trade).consultation ||
    // A DJ's vibe call is offered, never required: the quote can go first
    // (trades.ts `journey.callRequired`; simpler vendor journeys).
    !tradeProfile(input.trade).journey.callRequired;
  /**
   * An enquiry whose date has already gone by.
   *
   * Reconciliation deliberately ignores these — an old date on an unbooked
   * enquiry is a stale enquiry, not an unrecorded wedding (see
   * features/projects/job-moment.ts). But the journey then went on offering
   * "Schedule consultation · Find a time that works" as the next move on a
   * wedding twenty days past, which reads as though nobody had looked at the
   * date. Later states handle this well ("Did this go ahead? The date passed
   * 20 days ago"); this is the same courtesy, earlier, without pretending the
   * enquiry is a job.
   */
  const enquiryDatePassed = !consulted && afterEvent;
  push({
    key: "consultation",
    title: tradeWords.consultation,
    // Honesty: a stage advanced by hand is not a booked meeting. Say what
    // actually happened instead of claiming a record that doesn't exist.
    detail: input.hasConsultation
      ? "Meeting booked"
      : consulted
        ? "Marked done — no meeting was recorded"
        : enquiryDatePassed
          ? `Their date passed ${Math.abs(days ?? 0)} days ago — worth closing this off unless it moved`
          : "Find a time that works",
    status: consulted ? "complete" : "current",
    action: consulted
      ? null
      : {
          kind: "link",
          label: `Schedule ${tradeWords.consultation === "Consultation" ? "consultation" : `the ${tradeWords.consultation.toLowerCase()}`}`,
          href: project("/studio/calendar"),
        },
    // Consultations often happen over the phone; completing this step is a
    // plain state transition, so offer marking it done in place. Evidence-
    // controlled steps (proposal, contract, retainer) never get this.
    advance:
      !consulted && String(input.state) === "LEAD"
        ? {
            targetState: "CONSULTATION",
            label: "It already happened — mark done",
          }
        : null,
  });

  /**
   * A step the stage says is done and no record here can show.
   *
   * The booking gate guarantees a booked job passed through a signature and a
   * payment, so inferring these from the stage is right — but saying "Fully
   * signed" when there is no contract document put the journey in flat
   * contradiction with the Booking tab, which reads the records and said
   * "Contract · Not created" for the same job. The gate is still the authority
   * for the transition; the wording now admits where the evidence lives.
   */
  const inferred = (recordExists: boolean, byStage: boolean) =>
    byStage && !recordExists;

  const proposalDone =
    input.proposalStatus === "accepted" || stateRank >= 3;
  const proposalInferred = inferred(
    Boolean(input.proposalStatus),
    proposalDone,
  );
  const proposalWaiting = ["sent", "viewed"].includes(
    input.proposalStatus ?? "",
  );
  const agreementOut = proposalWaiting && input.bookingAgreementOut === true;
  push({
    key: "proposal",
    title: agreementOut ? "Booking agreement" : tradeWords.proposal,
    explain: proposalInferred,
    detail: proposalDone
      ? proposalInferred
        ? `Accepted outside StudioCue — no ${tradeWords.proposal.toLowerCase()} on file here`
        : "Accepted"
      : agreementOut
        ? `With ${who} to sign — signing both parts accepts the ${tradeWords.proposal.toLowerCase()}`
        : proposalWaiting
        ? "With the client to decide"
        : consulted
          ? "Packages and pricing, ready to send"
          : `Starts once the ${tradeWords.consultation.toLowerCase()} is done`,
    status: proposalDone
      ? "complete"
      : proposalWaiting
        ? "waiting_client"
        // A proposal cannot be created before CONSULTATION — the command
        // refuses it (canCreateProposalForProject). Until this gate was here
        // the journey led a job still at LEAD to "Prepare proposal", and the
        // composer had no way to say no. Same shape as contract and retainer
        // below, which have gated on their own precondition all along.
        : gate(consulted, "current"),
    action:
      proposalDone || !(consulted || proposalWaiting)
        ? null
        : {
            kind: "link",
            label: agreementOut
              ? "View booking agreement"
              : `${proposalWaiting ? "View" : "Prepare"} ${tradeWords.proposal.toLowerCase()}`,
            // No proposal yet → straight into the guided composer (which also
            // locks a package when one is missing). An existing proposal →
            // the project's proposal list.
            href: proposalWaiting
              ? project("/studio/proposals")
              : project("/studio/proposals/new"),
          },
  });

  // No agreement for this kind: accepting the proposal is as far as the
  // paperwork goes, and payment is next.
  const contractDone =
    input.contractStatus === "completed" ||
    stateRank >= 4 ||
    (input.profile?.agreement === false && proposalDone);
  const contractInferred = inferred(
    Boolean(input.contractStatus),
    contractDone,
  );
  const contractWaiting = [
    "sent",
    "delivered",
    "viewed",
    "partially_signed",
  ].includes(input.contractStatus ?? "");
  push({
    key: "contract",
    title: "Contract signed",
    explain: contractInferred,
    detail: contractDone
      ? contractInferred
        ? "Signed outside StudioCue — no contract on file here"
        : "Fully signed"
      : contractWaiting
        ? "Out for signature"
        : proposalDone
          ? `Built from the accepted ${tradeWords.proposal.toLowerCase()} — no retyping`
          : `Starts once the client accepts the ${tradeWords.proposal.toLowerCase()}`,
    status: contractDone
      ? "complete"
      : contractWaiting
        ? "waiting_client"
        : gate(proposalDone, "current"),
    action:
      contractDone || !(proposalDone || contractWaiting)
        ? null
        : {
            kind: "link",
            label: contractWaiting ? "Check signature status" : "Send contract",
            href: project("/studio/contracts"),
          },
  });

  const retainerDone =
    input.retainerInvoiceStatus === "paid" || stateRank >= 5;
  const retainerInferred = inferred(
    Boolean(input.retainerInvoiceStatus),
    retainerDone,
  );
  const retainerWaiting = [
    "sent",
    "viewed",
    "partially_paid",
    "overdue",
  ].includes(input.retainerInvoiceStatus ?? "");
  // Signed, with nothing to raise the invoice: the studio records it.
  const recordByHand = Boolean(input.depositByStudio) && contractDone && !retainerDone && !retainerWaiting;
  const retainerWord = tradeProfile(input.trade).journey.oneLinkBooking ? "deposit" : "retainer";
  push({
    key: "retainer",
    title: "Retainer paid",
    explain: retainerInferred,
    detail: retainerDone
      ? retainerInferred
        ? "Paid outside StudioCue — no invoice on file here"
        : "Booking locked in"
      : retainerWaiting
        ? "Invoice with the client"
        : recordByHand
          ? `Signed — they pay you directly. Record the ${retainerWord} when it arrives`
          : contractDone
            ? "Computed from your retainer rule"
            : "Starts once the agreement is signed",
    status: retainerDone
      ? "complete"
      : retainerWaiting
        ? "waiting_client"
        : gate(contractDone, "current"),
    action:
      retainerDone || !(contractDone || retainerWaiting)
        ? null
        : {
            kind: "link",
            label: retainerWaiting
              ? "Check payment status"
              : recordByHand
                ? `Record the ${retainerWord}`
                : "Create retainer invoice",
            href: recordByHand ? project("/studio/booking") : project("/studio/contracts"),
          },
  });

  const formSubmitted = ["submitted", "locked"].includes(
    input.questionnaireStatus ?? "",
  );
  // Submitted and empty is neither done nor not-started: the client thinks they
  // sent it and the studio has nothing. It stays the studio's to chase.
  const formEmptyButSubmitted = formSubmitted && !input.questionnaireHasAnswers;
  const formDone = formSubmitted && input.questionnaireHasAnswers;
  // Reopened: the couple is changing a form they sent, so it is theirs again.
  const formWaiting = ["assigned", "not_started", "in_progress", "reopened"].includes(
    input.questionnaireStatus ?? "",
  );
  // A makeup or hair trial (trades.ts `trial`): offered, never demanded —
  // a bride who didn't want one holds nothing up, so it is never the next
  // move.
  const trialWord = tradeWords.trial;
  if (trialWord) {
    const trial = input.trial ?? { state: "not_booked", startsAt: null };
    const trialWhen = trial.startsAt ? formatCallTime(trial.startsAt) : null;
    push({
      key: "trial",
      title: trialWord,
      detail:
        trial.state === "held"
          ? `Done${trialWhen ? ` ${trialWhen}` : ""} — the look goes on their day sheet`
          : trial.state === "booked"
            ? `Booked${trialWhen ? ` for ${trialWhen}` : ""}`
            : `Optional — invite them from the ${trialWord} card on this job${tradeWords.trialHint ? `, ${tradeWords.trialHint}` : " whenever suits"}`,
      // Never "current": an optional step must not take the next-move card.
      // The button lives on the job's own trial card.
      status: trial.state === "held" ? "complete" : prepStatus("upcoming"),
      action: null,
    });
  }

  push({
    key: "schedule_form",
    title: tradeWords.detailsForm ?? `${words.detailsForm} form`,
    detail: formDone
      ? input.questionnaireSource === "inquiry_page"
        ? tradeProfile(input.trade).consultation
          ? `${Who} filled it in before the ${tradeWords.consultation.toLowerCase()}`
          // A makeup artist or hair stylist has no call: the form came with the inquiry.
          : `${Who} filled it in with their inquiry`
        : "Client completed it"
      : formEmptyButSubmitted
        ? "Marked submitted, but no answers came through"
        : formWaiting
          ? "With the client to fill out"
          : input.hasSendableQuestionnaire === false
            ? "No form exists for this job type yet — build one first"
            : tradeProfile(input.trade).perPersonPricing
              ? "Who's getting ready, and by when"
              : tradeProfile(input.trade).musicPlanner
                ? "Their songs, the moments and the night's timeline"
                : words.event === "wedding"
                  ? "Prep locations, times, and family names"
                  : "Locations, times, and anything to know",
    status: formDone
      ? "complete"
      : prepStatus(
          formWaiting && !formEmptyButSubmitted ? "waiting_client" : "current",
        ),
    action: formDone
      ? null
      : prepAction({
          kind: "link",
          label: formEmptyButSubmitted
            ? "Check the form"
            : formWaiting
              ? "Nudge or review"
              : input.hasSendableQuestionnaire === false
                ? "Build a form"
                : "Send the form",
          href:
            input.hasSendableQuestionnaire === false
              ? "/studio/questionnaires"
              : project("/studio/questionnaires"),
        }),
  });

  const scheduleSettled = ["approved", "published"].includes(
    input.scheduleStatus ?? "",
  );
  // Approved with nothing readable in it. Must not report complete — this is the
  // state that let a wedding reach 100% readiness with no run of show.
  const scheduleEmptyButSettled = scheduleSettled && !input.scheduleHasUsableItems;
  /**
   * The couple asked for changes to the published version: the studio's move.
   *
   * It was read as complete ("Shared with your crew and the couple"), so the
   * request sat in a task nobody saw until the next day. The crew still work
   * from the published version meanwhile; the step reopens until a revision
   * goes out (publishing starts the couple's answer over).
   */
  const scheduleChangesAsked =
    input.scheduleStatus === "changes_requested" ||
    (input.scheduleStatus === "published" &&
      input.scheduleApprovalState === "changes_requested");
  const scheduleApprovedByCouple =
    input.scheduleStatus === "approved" ||
    (input.scheduleStatus === "published" &&
      input.scheduleApprovalState === "client_approved");
  const scheduleDone =
    scheduleSettled && input.scheduleHasUsableItems && !scheduleChangesAsked;
  const scheduleWaiting = input.scheduleStatus === "client_review";
  push({
    key: "run_of_show",
    title: tradeWords.planOfDay ?? "Run of show",
    // "Published" is shared, not approved: publishing asks the couple to
    // approve (approvalState client_pending), and this said "Approved and
    // shared" from the moment it went out.
    detail: scheduleChangesAsked && !scheduleEmptyButSettled
      ? `${Who} asked for changes`
      : scheduleDone
        ? scheduleApprovedByCouple
          ? `Approved by ${who}`
          : `Shared with your crew and ${who}`
        : scheduleEmptyButSettled
          ? "Approved, but it has no times in it yet"
          : scheduleWaiting
            ? "With the client to approve"
            : formDone
              ? `Ready to lay out from ${who}'s form`
              : `Starts once ${who} return their details form`,
    // Deliberately *not* gated on the form, unlike the contract and the
    // retainer. Their destinations refuse without their input; this one does
    // not — the generator asks for coverage and ceremony times directly and
    // says so ("Fill in what you know. Anything you leave blank is guessed"),
    // and "Build it myself" needs nothing at all. Drafting early is a
    // legitimate thing to do, so only the claim that it came from the form was
    // wrong, and that is in `detail` above.
    status: scheduleDone
      ? "complete"
      : prepStatus(
          scheduleWaiting && !scheduleEmptyButSettled
            ? "waiting_client"
            : "current",
        ),
    action: scheduleDone
      ? null
      : prepAction({
          kind: "link" as const,
          label: scheduleEmptyButSettled
            ? "Add the times"
            : scheduleChangesAsked
              ? "See what they asked"
              : scheduleWaiting
                ? "Open schedule"
                : "Draft the schedule",
          href: scheduleWaiting
            ? project("/studio/schedules")
            : `/studio/schedules/new?project=${input.projectId}`,
        }),
  });

  /**
   * The final details call, a month out (GR, 2026-10-08: "after the schedule
   * is set… a zoom/phone call should be part of the journey to close out the
   * job readiness"). The couple books it from the link the details lock
   * sends; booked is as done as the studio can make it.
   */
  if (input.finalCall) {
    const call = input.finalCall;
    const when = call.startsAt ? formatCallTime(call.startsAt) : null;
    push({
      key: "final_call",
      title: tradeWords.finalCall,
      detail:
        call.state === "held"
          ? `Held${when ? ` ${when}` : ""}`
          : call.state === "booked"
            ? `Booked${when ? ` for ${when}` : ""}`
            : call.state === "invited"
              ? `Invited — waiting for ${who} to pick a time`
              : `${Who} are invited to book it when the details lock`,
      status:
        call.state === "held" || call.state === "booked"
          ? "complete"
          : call.state === "invited"
            ? prepStatus("waiting_client")
            : prepStatus("upcoming"),
      action: null,
      record: null,
      owner: null,
      unlock: null,
      advance: null,
      explain: call.state === "invited" || call.state === "booked",
      files: [],
    });
  }

  // Both optional: a caller that does not know about checkpoints or crew
  // demand must not have its journey change shape. Absent `crewRequired`
  // means "no opinion", which is not the same as "solo".
  const settled = (key: string) =>
    (input.settledCheckpointKeys ?? []).includes(key);
  // A job with no package cannot be solo, because nothing has said who is
  // coming. `undefined` keeps callers that do not know about packages exactly
  // as they were.
  const shootingSolo =
    input.packageChosen !== false &&
    input.crewRequired === 0 &&
    input.crewAccepted === 0 &&
    !input.packageNeedsSecondShooter;
  /**
   * Every role that was offered, not the first person to say yes.
   *
   * `crewAccepted > 0` ticked the whole step, so a wedding with a lead
   * photographer accepted and a lighting assistant who had never answered read
   * "Crew confirmed · 1 accepted" — while the reference panel on the same job
   * listed that unanswered offer as outstanding, and the Plan hub marked Crew
   * DONE. Three surfaces, one question, two answers.
   *
   * `crewRequired` stays optional: absent means the caller has no opinion
   * about how many roles exist, which is not the same as "solo", so that case
   * keeps the old any-acceptance reading rather than inventing a denominator.
   */
  const crewOutstanding =
    typeof input.crewRequired === "number"
      ? Math.max(0, input.crewRequired - input.crewAccepted)
      : null;
  const crewDone =
    (crewOutstanding === null
      ? input.crewAccepted > 0
      : crewOutstanding === 0 && input.crewAccepted > 0) ||
    shootingSolo ||
    settled("crew-accepted") ||
    settled("crew-acknowledged");
  push({
    key: "crew",
    title: tradeWords.crewStep,
    // A tick on a job with no crew. Either it is solo or the studio settled
    // the checkpoint by hand; both need the sentence.
    explain:
      crewDone &&
      (shootingSolo ||
        settled("crew-accepted") ||
        settled("crew-acknowledged")),
    detail: crewDone
      ? input.crewAccepted > 0
        ? `All ${input.crewAccepted} offered ${input.crewAccepted === 1 ? "role" : "roles"} accepted`
        : shootingSolo
          // "Shooting", "Playing", "Working" (trades.ts `verb`).
          ? `${tradeWords.verb.charAt(0).toUpperCase()}${tradeWords.verb.slice(1)}ing this one solo`
          : "Settled by you"
      : crewOutstanding
        ? `${input.crewAccepted} of ${input.crewRequired} accepted · ${crewOutstanding} still to answer`
        : input.crewCascadeActive
          ? "Offer cascading through your ranked list"
          : "Offer each role to one person at a time",
    // An offer that is out is waiting on a person, not on the studio.
    status: crewDone
      ? "complete"
      : prepStatus(
          input.crewCascadeActive || crewOutstanding
            ? "waiting_other"
            : "current",
        ),
    action: crewDone
      ? null
      : prepAction({
          kind: "link" as const,
          label:
            input.crewCascadeActive || crewOutstanding
              ? "See who has been asked"
              : "Fill crew roles",
          href: project("/studio/crew"),
        }),
  });

  // Hair extensions bought or rented for the day (features/trades/extensions.ts):
  // the order is due eight weeks out, and its task is the button.
  const extensions = input.extensions;
  if (extensions) {
    const orderDue = extensions.orderBy !== null && input.today >= extensions.orderBy;
    push({
      key: "extensions",
      title: "Extensions ordered",
      detail: extensions.ordered
        ? `Ordered${extensions.colorMatch ? ` — ${extensions.colorMatch}` : ""}`
        : `${extensions.plan === "rent" ? "Rental" : "To buy"}${extensions.colorMatch ? `, ${extensions.colorMatch}` : ""} — order by ${extensions.orderBy ?? "eight weeks out"}`,
      status: extensions.ordered ? "complete" : eventBehindThem ? "passed" : orderDue ? "current" : "upcoming",
      action:
        !extensions.ordered && !eventBehindThem && orderDue
          ? { kind: "link", label: "Open the task", href: project("/studio/tasks") }
          : null,
    });
  }

  // A venue that never asked for a certificate is not a job with an
  // outstanding certificate. This step used to sit "current" for ever on
  // those jobs, with the only escape a checkpoint waiver — which records
  // accepting a risk rather than the fact that nobody asked.
  const coiNotRequired = input.insuranceRequired === "not_required";
  // Done means the venue has it. "approved" counted too, while readiness
  // waited for `sent_to_venue` — one wedding, two answers (C3 of
  // docs/coi-automation-plan-2026-09-28.md). An approved certificate that
  // never left is the studio's move, not a tick.
  const coiDone =
    coiNotRequired ||
    ["sent_to_venue", "venue_acknowledged"].includes(input.coiStatus ?? "") ||
    settled("coi-approved");
  // With the agent: asked, being chased, or asked to correct it.
  const coiWaiting = ["requested", "awaiting_response", "received", "correction_required"].includes(
    input.coiStatus ?? "",
  );
  // The studio's move (C4): a certificate to check, one approved and not sent,
  // a prepared request to approve, details to confirm, a portal to visit.
  const coiStudioMove: Record<string, string> = {
    under_review: "A certificate arrived — check it and send it to the venue",
    approved: "Approved — send it to the venue",
    prepared: "Your request to your agent is ready to approve",
    needs_details: "Confirm the venue's address so the request can go",
    self_serve: "Generate the certificate in your insurer's portal",
    failed: "The certificate didn't pass the safety check — ask for it again",
  };
  const coiMove = coiStudioMove[input.coiStatus ?? ""];
  push({
    key: "coi",
    title: "Insurance to venue",
    // "This venue does not require one" and "Settled by you" are decisions the
    // studio made; a bare tick claims StudioCue saw a certificate.
    explain: coiDone && (coiNotRequired || !input.coiStatus),
    detail: coiDone
      ? coiNotRequired
        ? "This venue does not require one"
        : input.coiStatus === "venue_acknowledged"
          ? "The venue confirmed they have it"
          : input.coiStatus
            ? "Sent to the venue"
            : "Settled by you"
      : coiMove
        ? coiMove
        : input.coiStatus === "correction_required"
          ? "With your agent for a correction — following up automatically"
          : coiWaiting
            ? "Requested — following up automatically"
            : "Request the certificate for the venue",
    status: coiDone
      ? "complete"
      : prepStatus(coiWaiting && !coiMove ? "waiting_other" : "current"),
    action: coiDone
      ? null
      : prepAction({
          kind: "link" as const,
          label: coiMove
            ? input.coiStatus === "under_review" || input.coiStatus === "approved"
              ? "Review and send"
              : "Open"
            : coiWaiting
              ? "Check COI status"
              : "Request COI",
          href: project("/studio/insurance"),
        }),
  });

  // A settled `final-balance` checkpoint counts, for the same reason the crew
  // and certificate steps honour theirs: the studio recorded the decision.
  const finalDone =
    input.finalInvoiceStatus === "paid" || settled("final-balance");
  // Raised and on its way (drafted, or created and waiting for the email)
  // is not "send final invoice" any more: sending it again would be refused.
  const finalWaiting = ["draft", "awaiting_delivery", "sent", "viewed", "partially_paid", "overdue"].includes(
    input.finalInvoiceStatus ?? "",
  );
  // Four weeks out, when the daily scheduler raises it
  // (functions/src/operations/invoice-scheduler.ts). This said 45 days while
  // the scheduler raised at 28, so the step opened on a bill that did not
  // exist yet (job-types plan, B11).
  const finalDue = days !== null && days <= 28 && days >= 0;
  // An invoice that has gone past its date stops being the client's move and
  // becomes the studio's: somebody has to chase it. Without this the job
  // page said "nothing for you right now" on a wedding four days out with
  // $6,265 outstanding, while Today ranked that same balance as the single
  // most urgent thing in the studio.
  const finalOverdue = Boolean(input.finalInvoiceOverdue) && !finalDone;
  push({
    key: "final_balance",
    title: "Final balance",
    detail: finalDone
      ? "Paid in full"
      : finalOverdue
        ? "Past its due date — worth a nudge"
        : finalWaiting
          ? "Invoice with the client"
          : "Total − retainer, computed exactly · one month out",
    status: finalDone
      ? "complete"
      : finalOverdue
        ? "current"
        : finalWaiting
          ? "waiting_client"
          : finalDue
            ? "current"
            : "upcoming",
    action:
      finalDone || (!finalWaiting && !finalDue && !finalOverdue)
        ? null
        : {
            kind: "link",
            label: finalOverdue
              ? "Follow up on payment"
              : finalWaiting
                ? "Check payment status"
                : "Send final invoice",
            href: project("/studio/invoices"),
          },
  });

  const dayBeforeDone = ["approved", "executed"].includes(
    input.dayBeforeDraftStatus ?? "",
  );
  const dayBeforeDue = days !== null && days <= 2 && days >= 0;
  push({
    key: "day_before",
    title: "Day-before checklist",
    detail: dayBeforeDone
      ? tradeWords.dayBefore
        ? "Sent — last song changes and load-in"
        : "Sent — saves 20 minutes on site"
      : tradeWords.dayBefore
        ? "Last song changes, venue contact, load-in"
        : // A family session or a team day has no dress or rings (job-kinds.ts).
          input.profile && input.profile.kind !== "wedding"
          ? `${words.dayBeforeChecklist[0]!.charAt(0).toUpperCase()}${words.dayBeforeChecklist[0]!.slice(1)}`
          : "Dress, shoes, flowers, rings, invitations ready",
    status: dayBeforeDone
      ? "complete"
      : eventBehindThem
        ? "passed"
        : dayBeforeDue
          ? "current"
          : "upcoming",
    action:
      dayBeforeDone || !dayBeforeDue || eventBehindThem
        ? null
        : input.dayBeforeDraftStatus === "review_required"
          ? { kind: "link", label: "Approve the checklist", href: `/studio/projects/${input.projectId}` }
          : {
              kind: "draft",
              label: "Draft the checklist",
              trigger: "day_before_checklist",
            },
  });

  /**
   * The date has gone by and the job never moved past preparation.
   *
   * Three of eleven demo jobs were sitting like this — Planning or Ready with
   * the wedding six to twenty days behind them — and nothing anywhere said so.
   * Once preparation stopped being the next move the journey fell through to
   * "Record delivery", which skips the only question worth asking: did this
   * happen? Recording a gallery for a shoot StudioCue has no idea took place is
   * the wrong end of the problem.
   *
   * It is a question rather than an instruction because the studio holds the
   * answer and all three answers are ordinary: it happened, it moved, it was
   * called off. See features/projects/job-moment.ts.
   */
  const needsReconciling = awaitingEventReconciliation({
    state: String(input.state),
    eventDate: input.eventDate,
    today: input.today,
  });
  push({
    key: "event_day",
    title: needsReconciling ? "Did this go ahead?" : "Event day",
    detail: needsReconciling
      ? `The date passed ${Math.abs(days ?? 0)} days ago and this job is still marked ${projectStateLabel(String(input.state), input.trade).toLowerCase()}.`
      : eventBehindThem
        ? tradeWords.dayDone
        : input.eventDate ?? "Date pending",
    status: needsReconciling
      ? "current"
      : eventBehindThem
        ? "complete"
        : "upcoming",
    action: null,
    advance: needsReconciling
      ? { targetState: "EVENT_COMPLETE", label: tradeWords.didIt }
      : null,
  });

  // Nothing to deliver (a DJ, a makeup artist): the review follows the day.
  const deliveryDone = input.hasDelivery || stateRank >= 10 || (!delivers && eventBehindThem);
  push({
    key: "delivery",
    title: "Gallery delivered",
    // The email is sent when the gallery is released; nothing is drafted.
    // A shot job also has to be moved to editing before the gallery can be
    // recorded, and the step used to send the studio straight to a page that
    // could not take it yet.
    detail: deliveryDone
      ? "Delivered with follow-ups running"
      : String(input.state) === "EVENT_COMPLETE"
        ? "Confirm editing has started, then record the gallery"
        : `Record the gallery — ${who} is emailed when you release it`,
    status: deliveryDone
      ? "complete"
      : afterEvent || stateRank >= 8
        ? "current"
        : "upcoming",
    action:
      deliveryDone || !(afterEvent || stateRank >= 8)
        ? null
        : {
            kind: "link",
            label: "Record delivery",
            // Scoped, like every other step's action. Unscoped, the page
            // dropped the context bar *and* the post-production checklist —
            // both rendered only when a project is present — so clicking
            // this from a job landed somewhere that hid the gate stopping
            // the delivery, and asked you to pick the job again.
            href: project("/studio/delivery"),
          },
  });

  push({
    key: "album_review",
    title: "Album & review",
    detail: input.albumOrReviewDone
      ? "Selections and review requested"
      : tradeProfile(input.trade).album
        ? "Selection reminders, then a Google review ask"
        : "A thank-you, then a Google review ask",
    status: input.albumOrReviewDone
      ? "complete"
      : deliveryDone
        ? "current"
        : "upcoming",
    action:
      input.albumOrReviewDone || !deliveryDone
        ? null
        : {
            kind: "draft",
            label: "Draft the review request",
            trigger: "review_request",
          },
  });

  /**
   * Exactly one current step, so the page always has one primary action.
   *
   * Normally the first outstanding step wins. The one exception is a job whose
   * date has passed while its state never moved: "did this go ahead?" outranks
   * everything, because the answer changes what every other step means —
   * chasing a final balance is premature if the wedding was called off, and
   * recording a gallery is nonsense if it never happened. Without this the
   * overdue balance claimed the slot and the question was demoted to
   * "upcoming", which is where I first put the precedence check and why it did
   * nothing.
   */
  shapeForProfile(steps, input);
  shapeForLightJourney(steps, input);

  const priorityKey: JourneyStepKey | null = needsReconciling
    ? "event_day"
    : null;
  let currentFound = false;
  if (priorityKey) {
    const priority = steps.find((step) => step.key === priorityKey);
    if (priority?.status === "current") currentFound = true;
  }
  for (const step of steps) {
    if (step.status === "current") {
      if (currentFound && step.key !== priorityKey) {
        step.status = "upcoming";
        step.action = null;
      } else {
        currentFound = true;
      }
    }
  }

  // Every step is a door: fill in where its record lives, who owns it right
  // now, and — for upcoming steps — what unlocks it.
  const recordHrefs: Record<
    JourneyStepKey,
    { label: string; href: string } | null
  > = {
    inquiry: input.lead
      ? { label: "Open the thread", href: `/studio/projects/${input.projectId}#prepared` }
      : null,
    first_reply: input.lead
      ? { label: "Review reply", href: `/studio/projects/${input.projectId}#prepared` }
      : null,
    consultation: { label: "Open calendar", href: project("/studio/calendar") },
    proposal: { label: `Open ${tradeVocab(input.trade).proposal.toLowerCase()}`, href: project("/studio/proposals") },
    contract: { label: "Open contract", href: project("/studio/booking") },
    retainer: { label: "Open retainer", href: project("/studio/booking") },
    trial: { label: "Open calendar", href: project("/studio/calendar") },
    schedule_form: {
      label: "Open form",
      href: project("/studio/questionnaires"),
    },
    run_of_show: { label: "Open schedule", href: project("/studio/schedules") },
    final_call: { label: "Open calendar", href: project("/studio/calendar") },
    crew: { label: "Open crew", href: project("/studio/crew") },
    extensions: { label: "Open tasks", href: project("/studio/tasks") },
    coi: { label: "Open insurance", href: project("/studio/insurance") },
    final_balance: { label: "Open invoices", href: project("/studio/invoices") },
    day_before: { label: "Open the job", href: `/studio/projects/${input.projectId}` },
    event_day: { label: "Open event day", href: project("/studio/event-day") },
    delivery: { label: "Open delivery", href: project("/studio/delivery") },
    album_review: { label: "Open reviews", href: project("/studio/reviews") },
  };
  const unlockCopy: Partial<Record<JourneyStepKey, string>> = {
    final_call: input.finalCall?.lockOn
      ? `The invitation goes out on ${formatCallTime(`${input.finalCall.lockOn}T12:00:00Z`, true)}, when the details lock.`
      : "The invitation goes out when the details lock.",
    final_balance: "Unlocks four weeks before the event.",
    day_before: "Unlocks two days before the event.",
    event_day: input.eventDate
      ? `The live plan opens on ${input.eventDate}.`
      : "Set an event date to plan the day.",
    delivery: "Unlocks after the event is covered.",
    // Nothing is delivered by a DJ, makeup artist or hair stylist: the review follows the day.
    album_review: tradeProfile(input.trade).delivery
      ? "Unlocks after the gallery is delivered."
      : "Unlocks after the event.",
  };
  for (const step of steps) {
    step.record = step.record ?? recordHrefs[step.key];
    // The specific record, when the caller knows it: "Open proposal" went to
    // the proposals list filtered by job, one more click from the proposal.
    const evidence = input.evidence?.[step.key];
    if (evidence?.href && step.record) step.record = { label: step.record.label, href: evidence.href };
    step.files = [...(evidence?.files ?? [])];
    if (step.status === "waiting_client") step.owner = "client";
    else if (step.status === "waiting_other") step.owner = "provider";
    else if (step.status === "current") step.owner = "studio";
    else step.owner = null;
    step.unlock =
      step.status === "upcoming"
        ? (unlockCopy[step.key] ?? "Unlocks when the steps above are done.")
        : null;
    if (step.status !== "current") step.advance = null;
  }

  /**
   * A job on hold or called off has no next move.
   *
   * Without this, a cancelled sports shoot went on showing "YOUR NEXT MOVE —
   * Schedule consultation · Find a time that works" and "3 blockers", because
   * the journey read the records and the records had not changed. Nobody is
   * going to schedule that consultation.
   *
   * The steps are kept exactly as they are — the history of the job is still
   * the history of the job — and only the *current* step is dropped, so nothing
   * asks the studio for work on a job that is not live.
   */
  if (["POSTPONED", "CANCELLED", "ARCHIVED"].includes(String(input.state))) {
    return { steps, current: null };
  }
  return { steps, current: steps.find((step) => step.status === "current") ?? null };
}


/** "Tue, Oct 20, 3:00 PM", or the date alone. */
function formatCallTime(iso: string, dateOnly = false): string {
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return "";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(dateOnly ? { timeZone: "UTC" } : { hour: "numeric", minute: "2-digit" }),
  }).format(date);
}
