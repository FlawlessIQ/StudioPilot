import type { ProjectState } from "@/features/projects/schema";
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
  | "schedule_form"
  | "run_of_show"
  | "crew"
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
  proposal: [],
  // Both destinations refuse without the step before: /studio/contracts wants
  // an accepted proposal, and the retainer is created after signature.
  contract: ["proposal"],
  retainer: ["contract"],
  schedule_form: [],
  run_of_show: [],
  crew: [],
  coi: [],
  final_balance: [],
  day_before: [],
  event_day: [],
  // There is no gallery to deliver before the event, and nothing to select
  // from or review before a gallery.
  delivery: ["event_day"],
  album_review: ["delivery"],
};

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
};

export type JourneyInput = {
  projectId: string;
  state: ProjectState | string;
  eventDate: string | null; // YYYY-MM-DD
  today: string; // YYYY-MM-DD
  lead: { id: string; status: string } | null;
  hasConsultation: boolean;
  proposalStatus: string | null;
  contractStatus: string | null;
  retainerInvoiceStatus: string | null;
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
  scheduleStatus: string | null;
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

export function projectJourney(input: JourneyInput): {
  steps: JourneyStep[];
  current: JourneyStep | null;
} {
  const stateRank = rank(String(input.state));
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
      "record" | "owner" | "unlock" | "advance" | "explain"
    > &
      Partial<
        Pick<
          JourneyStep,
          "record" | "owner" | "unlock" | "advance" | "explain"
        >
      >,
  ) =>
    steps.push({
      record: null,
      owner: null,
      unlock: null,
      advance: null,
      explain: false,
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
    const replied = input.lead.status !== "new" || stateRank >= 1;
    push({
      key: "first_reply",
      title: "First reply",
      detail: replied
        ? "The client heard back from you"
        : "A personalized reply is one approval away",
      status: replied ? "complete" : "current",
      action: replied
        ? null
        : { kind: "link", label: "Review reply", href: `/studio/leads/${input.lead.id}` },
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
  const consulted = input.hasConsultation || stateRank >= 1;
  push({
    key: "consultation",
    title: "Consultation",
    // Honesty: a stage advanced by hand is not a booked meeting. Say what
    // actually happened instead of claiming a record that doesn't exist.
    detail: input.hasConsultation
      ? "Meeting booked"
      : consulted
        ? "Marked done — no meeting was recorded"
        : "Find a time that works",
    status: consulted ? "complete" : "current",
    action: consulted
      ? null
      : {
          kind: "link",
          label: "Schedule consultation",
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
  push({
    key: "proposal",
    title: "Proposal",
    explain: proposalInferred,
    detail: proposalDone
      ? proposalInferred
        ? "Accepted outside StudioCue — no proposal on file here"
        : "Accepted"
      : proposalWaiting
        ? "With the client to decide"
        : "Packages and pricing, ready to send",
    status: proposalDone
      ? "complete"
      : proposalWaiting
        ? "waiting_client"
        : "current",
    action: proposalDone
      ? null
      : {
          kind: "link",
          label: proposalWaiting ? "View proposal" : "Prepare proposal",
          // No proposal yet → straight into the guided composer (which also
          // locks a package when one is missing). An existing proposal →
          // the project's proposal list.
          href: proposalWaiting
            ? project("/studio/proposals")
            : project("/studio/proposals/new"),
        },
  });

  const contractDone = input.contractStatus === "completed" || stateRank >= 4;
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
          ? "Built from the accepted proposal — no retyping"
          : "Starts once the client accepts the proposal",
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
              : "Create retainer invoice",
            href: project("/studio/contracts"),
          },
  });

  const formSubmitted = ["submitted", "locked"].includes(
    input.questionnaireStatus ?? "",
  );
  // Submitted and empty is neither done nor not-started: the client thinks they
  // sent it and the studio has nothing. It stays the studio's to chase.
  const formEmptyButSubmitted = formSubmitted && !input.questionnaireHasAnswers;
  const formDone = formSubmitted && input.questionnaireHasAnswers;
  const formWaiting = ["assigned", "not_started", "in_progress"].includes(
    input.questionnaireStatus ?? "",
  );
  push({
    key: "schedule_form",
    title: "Wedding details form",
    detail: formDone
      ? "Client completed it"
      : formEmptyButSubmitted
        ? "Marked submitted, but no answers came through"
        : formWaiting
          ? "With the client to fill out"
          : input.hasSendableQuestionnaire === false
            ? "No form exists for this job type yet — build one first"
            : "Prep locations, times, and family names",
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
  const scheduleDone = scheduleSettled && input.scheduleHasUsableItems;
  const scheduleWaiting = ["client_review", "changes_requested"].includes(
    input.scheduleStatus ?? "",
  );
  push({
    key: "run_of_show",
    title: "Run of show",
    detail: scheduleDone
      ? "Approved and shared"
      : scheduleEmptyButSettled
        ? "Approved, but it has no times in it yet"
        : scheduleWaiting
          ? "With the client to approve"
          : formDone
            ? "Drafted from the form using your timing rules"
            : "Starts once the couple return their details form",
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
            : scheduleWaiting
              ? "Open schedule"
              : "Draft the schedule",
          href: scheduleWaiting
            ? project("/studio/schedules")
            : `/studio/schedules/new?project=${input.projectId}`,
        }),
  });

  // Both optional: a caller that does not know about checkpoints or crew
  // demand must not have its journey change shape. Absent `crewRequired`
  // means "no opinion", which is not the same as "solo".
  const settled = (key: string) =>
    (input.settledCheckpointKeys ?? []).includes(key);
  const shootingSolo = input.crewRequired === 0 && input.crewAccepted === 0;
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
    title: "Crew confirmed",
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
          ? "Shooting this one solo"
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

  // A venue that never asked for a certificate is not a job with an
  // outstanding certificate. This step used to sit "current" for ever on
  // those jobs, with the only escape a checkpoint waiver — which records
  // accepting a risk rather than the fact that nobody asked.
  const coiNotRequired = input.insuranceRequired === "not_required";
  const coiDone =
    coiNotRequired ||
    ["approved", "sent_to_venue", "venue_acknowledged"].includes(
      input.coiStatus ?? "",
    ) ||
    settled("coi-approved");
  const coiWaiting = ["requested", "awaiting_response", "received", "under_review", "correction_required"].includes(
    input.coiStatus ?? "",
  );
  push({
    key: "coi",
    title: "Insurance to venue",
    // "This venue does not require one" and "Settled by you" are decisions the
    // studio made; a bare tick claims StudioCue saw a certificate.
    explain: coiDone && (coiNotRequired || !input.coiStatus),
    detail: coiDone
      ? coiNotRequired
        ? "This venue does not require one"
        : input.coiStatus
          ? "Certificate handled"
          : "Settled by you"
      : coiWaiting
        ? "Requested — chasing automatically"
        : "Request the certificate for the venue",
    status: coiDone
      ? "complete"
      : prepStatus(coiWaiting ? "waiting_other" : "current"),
    action: coiDone
      ? null
      : prepAction({
          kind: "link" as const,
          label: coiWaiting ? "Check COI status" : "Request COI",
          href: project("/studio/insurance"),
        }),
  });

  // A settled `final-balance` checkpoint counts, for the same reason the crew
  // and certificate steps honour theirs: the studio recorded the decision.
  const finalDone =
    input.finalInvoiceStatus === "paid" || settled("final-balance");
  const finalWaiting = ["sent", "viewed", "partially_paid", "overdue"].includes(
    input.finalInvoiceStatus ?? "",
  );
  const finalDue = days !== null && days <= 45 && days >= 0;
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
              ? "Chase payment"
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
      ? "Sent — saves 20 minutes on site"
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
          ? { kind: "link", label: "Approve the checklist", href: "/studio/ai-queue" }
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
      ? `The date passed ${Math.abs(days ?? 0)} days ago and this job is still marked ${projectStateLabel(String(input.state)).toLowerCase()}.`
      : eventBehindThem
        ? "Covered"
        : input.eventDate ?? "Date pending",
    status: needsReconciling
      ? "current"
      : eventBehindThem
        ? "complete"
        : "upcoming",
    action: null,
    advance: needsReconciling
      ? { targetState: "EVENT_COMPLETE", label: "Yes, we shot it" }
      : null,
  });

  const deliveryDone = input.hasDelivery || stateRank >= 10;
  push({
    key: "delivery",
    title: "Gallery delivered",
    detail: deliveryDone
      ? "Delivered with follow-ups running"
      : "Record the gallery — the email drafts itself",
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
      : "Selection reminders, then a Google review ask",
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
      ? { label: "Open inquiry", href: `/studio/leads/${input.lead.id}` }
      : null,
    first_reply: input.lead
      ? { label: "Open inquiry", href: `/studio/leads/${input.lead.id}` }
      : null,
    consultation: { label: "Open calendar", href: project("/studio/calendar") },
    proposal: { label: "Open proposal", href: project("/studio/proposals") },
    contract: { label: "Open contract", href: project("/studio/booking") },
    retainer: { label: "Open retainer", href: project("/studio/booking") },
    schedule_form: {
      label: "Open form",
      href: project("/studio/questionnaires"),
    },
    run_of_show: { label: "Open schedule", href: project("/studio/schedules") },
    crew: { label: "Open crew", href: project("/studio/crew") },
    coi: { label: "Open insurance", href: project("/studio/insurance") },
    final_balance: { label: "Open invoices", href: project("/studio/invoices") },
    day_before: { label: "Open review queue", href: "/studio/ai-queue" },
    event_day: { label: "Open event day", href: project("/studio/event-day") },
    delivery: { label: "Open delivery", href: project("/studio/delivery") },
    album_review: { label: "Open reviews", href: project("/studio/reviews") },
  };
  const unlockCopy: Partial<Record<JourneyStepKey, string>> = {
    final_balance: "Unlocks about 45 days before the event.",
    day_before: "Unlocks two days before the event.",
    event_day: input.eventDate
      ? `The live plan opens on ${input.eventDate}.`
      : "Set an event date to plan the day.",
    delivery: "Unlocks after the event is covered.",
    album_review: "Unlocks after the gallery is delivered.",
  };
  for (const step of steps) {
    step.record = step.record ?? recordHrefs[step.key];
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
