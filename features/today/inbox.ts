/**
 * Today — the studio's inbox of moments, as a deterministic engine.
 *
 * Phase 1 of the "Today & Jobs" design. The home screen stops being a
 * dashboard of collections and becomes a queue of things that need the
 * photographer, in three lanes that answer one question each:
 *
 *   act     — only you can do this (an inquiry, an exception, a job whose
 *             next step is yours)
 *   approve — Cue prepared it; one tap releases it
 *   fyi     — evidence arrived and the engines already acted; nothing to do
 *
 * Ranking reuses the urgency weights the home page already trusted, so an
 * event this week still outranks one next quarter and a large outstanding
 * balance still breaks ties. Pure function, no I/O: the UI feeds it plain
 * records and journey positions.
 */

import {
  amountWeight,
  proximityWeight,
  stalenessWeight,
} from "@/features/dashboard/urgency";
import type { SetupGap } from "@/features/today/setup-gaps";
import { hasFinalBalance, jobKindOf, projectProfile, singleBillWindow, vocab } from "@/features/job-kinds/job-kinds";
import { ignorableSenderOf, notInquiryAllowed } from "@/features/intake/not-inquiry";
import {
  inquiryDraftIsOrphaned,
  preparedWorkIsMoot,
  taskMomentHasGone,
  workStillMatters,
} from "@/features/projects/job-moment";
import { daysUntilEvent } from "@/lib/format/event-date";
import { lifecycleTriggerOf } from "@/features/messaging/trust-dial";
import { kindFromValue, type LibraryKind } from "@/features/library/kinds";
import {
  describeProviderFailure,
  groupProviderFailures,
  providerFailureKind,
} from "@/features/today/provider-failure";
import { countdownPhrase, formatDueDate } from "@/lib/format/event-date";
import { isAmendable } from "@/features/booking/amendable";
import { outstandingFinalBalance } from "@/features/booking/final-balance-due";
import { heldInvoiceView } from "@/features/billing/held-invoice-review";
import { jobValueCents } from "@/features/packages/job-packages";
import { balanceMayBeAttested } from "@/features/booking/agreed-final-balance";
import { providerName as readable } from "@/lib/format/provider-name";
import { taskIsSettled } from "@/features/tasks/schema";
import type { OutsideStepReminder } from "@/features/outside-steps/registry";
import { inquiryNextMove } from "@/features/inquiries/next-move";
import { tradeProfile, tradeVocab } from "@/features/trades/trades";
import { dateHeldByAnother } from "@/features/inquiries/pipeline";
import { preBookingStates } from "@/features/inquiries/stages";
import { bookingBlockerLabel } from "@/features/booking/gate-requirements";
import { BOOKING_BRIEF_CAPABILITIES, blockingIssues } from "@/features/ai/blocking-issues";
import { emailProblemOf } from "@/features/today/email-problems";
import { dispatchesOnApproval } from "@/features/ai/approval-consequence";
import { planningFormOpensOn, resolvePlanningTimeline } from "@/features/planning/planning-timeline";

/** A couple emailed for their billing address: Today offers "Ask again" after this many days. */
const BILLING_ADDRESS_ASK_AGAIN_DAYS = 5;

/** When a final balance becomes Today's business: four weeks out, when the scheduler raises it (B11). */
const FINAL_BALANCE_WINDOW_DAYS = 28;

export type TodayLane = "act" | "approve" | "fyi";

export type TodayAction =
  /** Navigate to the surface that completes the moment. */
  | { kind: "link"; label: string; href: string }
  /**
   * A workflow step waiting for approval, decided in a sheet on Today. It
   * used to link to the AI review page — the only thing that page still did
   * that Today couldn't.
   */
  | { kind: "automation"; label: string; approvalId: string }
  /**
   * A couple asked, in their portal, to add a package. Approving adds it and
   * revises their proposal; "Not now" tells them the studio will be in touch.
   */
  | {
      /**
       * A final balance due and not yet billed: send it now, or record it
       * paid another way (components/booking/final-balance-actions.tsx).
       */
      kind: "final_balance";
      label: string;
      projectId: string;
      packageSnapshotId: string | null;
      balanceCents: number | null;
      /** The job's one bill (paid on the day, or invoiced after), not a balance after a retainer. */
      singleBill?: boolean;
    }
  | {
      /**
       * QuickBooks needs the couple's billing address to tax their final:
       * ask them (a quiet job the scheduler won't email), or ask again
       * (functions/src/billing/billing-address-request.ts).
       */
      kind: "billing_address";
      label: string;
      projectId: string;
    }
  | {
      /** A couple asked to change a locked location or time: accept or decline. */
      kind: "detail_change";
      label: string;
      requestId: string;
      projectId: string;
    }
  | {
      kind: "package_request";
      label: string;
      requestId: string;
      projectId: string;
      /** "package" (add one) or "date_change" (move the wedding). */
      requestKind: "package" | "date_change";
      /** Signed: answered with a booking change the couple signs. */
      amend: boolean;
      requestedDate: string | null;
      packageId: string;
      packageName: string;
      /** The proposal the addition revises — the newest still in play. */
      proposalId: string | null;
      /**
       * That proposal's status. Adding to one the couple has been sent makes
       * a new version and retires theirs, so the card confirms first (wave 3).
       */
      proposalStatus: string | null;
    }
  /**
   * Approve AI-prepared work in place. `preview` is the drafted content
   * itself, so the card can show the work before it is released.
   */
  | {
      kind: "approve";
      label: string;
      actionId: string;
      href: string;
      preview: { subject: string | null; body: string } | null;
    }
  /**
   * A new inquiry, answered from the card. `reply` is the drafted reply
   * waiting for review, when there is one: Send approves it (which sends it),
   * Edit opens it for editing, and the card can also be marked "not an
   * inquiry". `href` is the lead page, for everything else.
   */
  /**
   * An inquiry that went quiet two weeks ago: close it as "went quiet", or
   * keep it open another week (functions/src/intake/follow-ups.ts).
   */
  | { kind: "close_inquiry"; label: string; leadId: string; projectId: string | null; href: string }
  | {
      kind: "inquiry";
      label: string;
      href: string;
      leadId: string;
      projectId?: string | null;
      /**
       * The reply is a follow-up to a couple who went quiet: the card offers
       * "They replied elsewhere" instead of "Not an inquiry".
       */
      followUp?: boolean;
      /** The date is already booked: the card offers "Close — date taken". */
      dateTaken?: boolean;
      /**
       * Whether "Not an inquiry" will be accepted: not for a lead whose job
       * the studio made by hand or has moved on (notInquiryAllowed). Absent
       * is read as allowed, for callers that predate it.
       */
      notInquiryAllowed?: boolean;
      /** The address "not an inquiry" could also ignore, to name first. */
      ignorableSender?: string | null;
      reply: {
        actionId: string;
        recipient: string | null;
        preview: { subject: string | null; body: string } | null;
        /**
         * False when the reply goes without the couple's booking link because
         * the studio hasn't set consultation hours — said on the card, where
         * the studio is about to send it.
         */
        bookingLinkIncluded?: boolean | null;
      } | null;
    }
  /**
   * An email that did not reach someone (features/today/email-problems.ts):
   * Retry a failed send, Fix the address where it lives, or Leave it — on the
   * card, rather than a link to Messages, which never showed failed mail.
   */
  | {
      kind: "email_problem";
      label: string;
      emailJobId: string;
      recipient: string | null;
      subject: string | null;
      reason: string;
      canRetry: boolean;
      fixHref: string | null;
    }
  /** Nothing to do — the engines handled it. */
  | { kind: "none"; label: string };

/**
 * When this needs attention. Ranking decides order; the band tells the
 * reader *why* something is at the top, which a flat list cannot.
 */
export type TodayBand = "overdue" | "soon" | "later";

export type TodayItem = {
  id: string;
  lane: TodayLane;
  title: string;
  detail: string;
  /** Where this came from, in plain words: "From her inquiry form". */
  evidence: string | null;
  projectId: string | null;
  projectName: string | null;
  action: TodayAction;
  /** Always offered when the moment belongs to a job. */
  jobHref: string | null;
  /**
   * The concrete facts a photographer needs to judge this without opening
   * anything: the date, who it's for, the money, how long it has waited.
   */
  facts: string[];
  band: TodayBand;
  eventDate: string | null;
  score: number;
  /**
   * What sort of record this moment is about, for the shared glyph. Null
   * where the moment has no record behind it — studio setup, an engine
   * narrating itself — because a colour there would be a guess.
   */
  kind: LibraryKind | null;
};

export type TodayUpcomingEvent = {
  projectId: string;
  name: string;
  eventDate: string;
  inDays: number;
};

/**
 * A capture the reader wasn't sure was an inquiry. Listed beside the queue,
 * never in it: it is not counted, never headlines, and never outranks a
 * couple — but it is answered from Today instead of a tray nobody visits.
 */
export type TodayMaybeInquiry = {
  leadId: string;
  /** Who sent it: a name, an email, or "Unknown sender". */
  sender: string;
  /** Where it came from, in the same words as an inquiry card. */
  evidence: string;
  /** The opening of the message, trimmed for one line. */
  snippet: string;
  arrivedAt: string | null;
  href: string;
  /**
   * A website form or marketplace submission with a way to reach the person —
   * an inquiry by its content, held only because StudioCue couldn't confirm
   * who forwarded it (a studio domain with no SPF or DKIM does this to every
   * forward). Shown near the top of Today rather than beneath the queue:
   * Gabe forwarded one and had to ask where it went (2026-09-29, backlog H8).
   * Still not counted and never the headline — the sender is unconfirmed.
   */
  fromForm: boolean;
  /** The address "not an inquiry" could ignore, named before it does (features/intake/not-inquiry.ts). */
  ignorableSender: string | null;
};

export type TodayInbox = {
  act: TodayItem[];
  approve: TodayItem[];
  fyi: TodayItem[];
  /** Possible inquiries awaiting a yes or no, newest first. */
  maybeInquiries: TodayMaybeInquiry[];
  /** The next events on the books — context beside the queue. */
  upcoming: TodayUpcomingEvent[];
  /** Jobs in flight with nothing owed by the studio right now. */
  inMotion: number;
  /** One honest sentence about the state of the studio. */
  summary: string;
};

export type TodayRecord = Record<string, unknown> & { id: string };

/**
 * A job's position, precomputed by the caller from the journey engine so
 * this module stays pure. `owner` is who the current step waits on.
 */
export type TodayJourneyPosition = {
  /** Which journey step this is, so Today can avoid repeating an obligation. */
  stepKey?: string | null;
  projectId: string;
  projectName: string;
  eventDate: string | null;
  state: string;
  stepTitle: string;
  stepDetail: string;
  owner: "studio" | "client" | "provider" | null;
  actionLabel: string | null;
  actionHref: string | null;
  /** ISO timestamp of the project's last change, for staleness ranking. */
  updatedAt: string | null;
  /**
   * After the event: the next final deliverable still to go out, and when it
   * is due by the package's turnaround (H4). Replaces a fixed 42 days for
   * everything — a highlight film promised in 60 was "late" at 43.
   */
  deliveryDue?: { label: string; date: string } | null;
};

export type TodayInput = {
  now: string;
  /**
   * Every job, settled ones included.
   *
   * `journeys` carries only live jobs, so it cannot answer "is this job over?"
   * — absence there means closed just as often as it means not-yet-loaded.
   * The raw records are what `jobStillOpen` reads.
   */
  projects?: TodayRecord[] | null;
  leads?: TodayRecord[] | null;
  /**
   * Message threads, so an inquiry's card follows whose move it is
   * (features/inquiries/next-move.ts) instead of assuming nobody replied.
   */
  conversations?: TodayRecord[] | null;
  /** Couples asking to add a package (portal "Add to your booking"). */
  packageRequests?: TodayRecord[] | null;
  /** A couple's change to a locked location or time (functions/src/planning/detail-changes.ts). */
  detailChangeRequests?: TodayRecord[] | null;
  /** Final-details sign-offs (functions/src/planning/final-details.ts). */
  detailSignoffs?: TodayRecord[] | null;
  /** The studio's planning timeline (tenants/{id}.planningTimeline): when the form goes out. */
  planningTimeline?: unknown;
  /** Billing addresses StudioCue asked couples for (functions/src/billing/billing-address-request.ts). */
  billingAddressRequests?: TodayRecord[] | null;
  /**
   * Run-of-show versions, so the couple's answer to the day plan reaches
   * Today: a card when they ask for changes, a line when they approve it.
   */
  schedules?: TodayRecord[] | null;
  tasks?: TodayRecord[] | null;
  aiActions?: TodayRecord[] | null;
  automationApprovals?: TodayRecord[] | null;
  communicationDrafts?: TodayRecord[] | null;
  deliveryDrafts?: TodayRecord[] | null;
  /** Certificates of insurance and the studio's COI settings (H3). */
  insuranceRequests?: TodayRecord[] | null;
  coiSettings?: TodayRecord[] | null;
  proposals?: TodayRecord[] | null;
  automationRuns?: TodayRecord[] | null;
  providerJobs?: TodayRecord[] | null;
  emailJobs?: TodayRecord[] | null;
  integrationConnections?: TodayRecord[] | null;
  bookingOrchestrations?: TodayRecord[] | null;
  crewCascades?: TodayRecord[] | null;
  invoiceReferences?: TodayRecord[] | null;
  actionReceipts?: TodayRecord[] | null;
  journeys?: TodayJourneyPosition[] | null;
  /**
   * The studio's trade (trades.ts): a makeup artist's or hair stylist's
   * inquiry has no call, so once it is answered the quote is theirs to send.
   */
  tenantTrade?: unknown;
  /**
   * Studio setup that isn't done. Only the gaps that block real work reach
   * Today — an empty studio is new, not broken.
   */
  setupGaps?: SetupGap[] | null;
  /**
   * Steps the studio started in another company's app that have run long, or
   * that the other company says went wrong (features/outside-steps).
   */
  outsideStepReminders?: OutsideStepReminder[] | null;
};

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";
const rows = (records?: TodayRecord[] | null) => records ?? [];


/**
 * When an inquiry actually landed.
 *
 * `changedAt` prefers `updatedAt`, which is right for work in flight and
 * wrong for a lead: any background touch of the record resets it, and the
 * inquiry silently looks fresh again when it has in fact gone unanswered for
 * a week. Arrival is the only honest clock for "how long have they waited".
 */
const arrivedAt = (record: TodayRecord) =>
  text(record.receivedAt ?? record.submittedAt ?? record.createdAt) || null;

const changedAt = (record: TodayRecord) =>
  text(
    record.updatedAt ??
      record.requestedAt ??
      record.receivedAt ??
      record.completedAt ??
      record.createdAt,
  ) || null;

/** Lane base weights, mirroring the old kind weights' intent. */
const laneWeight: Record<TodayLane, number> = {
  act: 1000,
  approve: 600,
  fyi: 0,
};

/**
 * Within Act, an unanswered inquiry leads.
 *
 * It used to sit below exceptions on the reasoning that a failure is worse
 * than a lead. Walking a real studio's queue showed why that is wrong: an
 * overdue balance is money already earned and it will still be there
 * tomorrow, whereas a couple who does not hear back today books one of the
 * three other photographers they emailed. The inquiry is the only item in
 * the lane whose value evaporates while it waits.
 *
 * Exceptions still outrank ordinary job steps, and proximity still lifts an
 * imminent event above all of it.
 */
const severityBonus = { inquiry: 250, exception: 200, step: 0 } as const;

function score(input: {
  lane: TodayLane;
  severity?: keyof typeof severityBonus;
  eventDate?: string | null;
  updatedAt?: string | null;
  amountCents?: number | null;
  now: Date;
}): number {
  return (
    laneWeight[input.lane] +
    (input.severity ? severityBonus[input.severity] : 0) +
    proximityWeight(input.eventDate, input.now) +
    stalenessWeight(input.updatedAt, input.now) +
    amountWeight(input.amountCents)
  );
}

const byScore = (left: TodayItem, right: TodayItem) => right.score - left.score;

/**
 * The kind a free-text record type names, or null.
 *
 * Server records carry their own vocabulary — asset types, receipt types,
 * step keys — and `toneForValue` already knows the aliases. This narrows
 * that to the kind itself so the card can pick an icon as well as a hue.
 */
function toneKindFor(value: string): LibraryKind | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  return kindFromValue(normalized);
}

/** The subject of a job's current journey step. */
function journeyStepKind(position: TodayJourneyPosition): LibraryKind | null {
  // The action href names the surface the step lives on, which is the most
  // reliable signal available here — the position carries no step key.
  const surface = (position.actionHref ?? "").split("?")[0].split("/")[2] ?? "";
  return kindFromValue(surface) ?? kindFromValue(position.state.toLowerCase());
}

/**
 * What the page opens with.
 *
 * The hero is not just the top of the queue rendered larger — it is the
 * first sentence a photographer reads about their own business each
 * morning, in the biggest type on the screen. A studio with two weddings on
 * the books was being greeted by "Reconnect QuickBooks", because a paused
 * integration outranks a proposal that is not due for weeks. The ranking is
 * right for the *queue* — the connector really is the next thing to fix —
 * and wrong for the headline: nobody opens their studio to be told about an
 * accounting connector.
 *
 * So the headline prefers the most urgent moment that concerns a client or
 * a job, and falls back to studio plumbing only when there is no client
 * work waiting at all. Nothing is hidden either way: whatever is not
 * headlined stays in the queue, in its proper rank.
 */
export function todayHeadline(
  act: TodayItem[],
  approve: TodayItem[],
): TodayItem | null {
  const ranked = [...act, ...approve].sort(byScore);
  // Client work headlines, studio plumbing does not: a lapsed accounting
  // connector correctly outranks a proposal in the queue and must not become the
  // greeting every morning (see "the headline is client work, not studio
  // plumbing").
  //
  // But the test for that was `projectId !== null`, and a setup gap blocking a
  // named job carries `projectId: null` with the blocked couple in
  // `projectName` — so on a new studio whose only item was "Add your packages,
  // blocking Amara & Ben Ito" the hero skipped it and promoted a consultation
  // twelve months out. Naming a client is what makes an item client work,
  // whether or not a project record exists yet.
  return (
    ranked.find(
      (item) => item.projectId !== null || item.projectName !== null,
    ) ??
    ranked[0] ??
    null
  );
}

/**
 * The drafted content, when the output has something readable in it. Shown
 * on the card so "approve" is never a blind tap.
 */
function previewOf(
  output: unknown,
): { subject: string | null; body: string } | null {
  if (typeof output !== "object" || output === null) return null;
  const value = output as Record<string, unknown>;
  const body = [value.body, value.summary, value.message, value.notes]
    .map((candidate) => text(candidate).trim())
    .find(Boolean);
  if (!body) return null;
  return {
    subject: text(value.subject).trim() || null,
    body: body.length > 600 ? `${body.slice(0, 600)}…` : body,
  };
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/**
 * Who the client is on a card: "Beth & Tom", from "Beth & Tom wedding"; with
 * no name, the kind's own word — "the family", never "the couple" for a
 * family session (job-kinds.ts).
 */
const clientOf = (job: unknown, name?: string | null, capital = false): string => {
  const named = text(name ?? asRecord(job).name).replace(/\s+wedding$/i, "").trim();
  if (named) return named;
  const fallback = vocab(jobKindOf(job)).clientFallback;
  return capital ? `${fallback.charAt(0).toUpperCase()}${fallback.slice(1)}` : fallback;
};

/** Each job's newest run-of-show version. */
function newestScheduleByProject(schedules: TodayRecord[]): Map<string, TodayRecord> {
  const newest = new Map<string, TodayRecord>();
  for (const schedule of schedules) {
    const projectId = text(schedule.projectId);
    if (!projectId || schedule.archivedAt) continue;
    const current = newest.get(projectId);
    if (!current || Number(schedule.version ?? 0) > Number(current.version ?? 0)) {
      newest.set(projectId, schedule);
    }
  }
  return newest;
}

/**
 * The couple's answer to a run-of-show version, or null while they have not
 * given one.
 *
 * A published version keeps `status: "published"`; the answer is in
 * `approvalState` (functions/src/planning/commands.ts, approveSchedule). The
 * older review flow wrote it to `status`, and both are read. `byStudio` is an
 * answer the studio wrote down for them (given on the phone, say) — they
 * already know about it.
 */
export function scheduleAnswer(schedule: Record<string, unknown>): {
  decision: "approved" | "changes_requested";
  note: string;
  at: string | null;
  byStudio: boolean;
} | null {
  const status = text(schedule.status);
  const approval = text(schedule.approvalState);
  const decision =
    approval === "changes_requested" || status === "changes_requested"
      ? "changes_requested"
      : approval === "client_approved" || status === "approved"
        ? "approved"
        : null;
  if (!decision) return null;
  const recorded = asRecord(schedule.approvalRecordedByStudio);
  const byStudio = Boolean(text(recorded.recordedBy));
  const at =
    text(recorded.recordedAt) ||
    (decision === "approved" ? text(schedule.approvedAt) : "") ||
    text(schedule.updatedAt) ||
    null;
  return { decision, note: text(schedule.approvalNotes).trim(), at, byStudio };
}

/** The lead an inquiry reply draft answers, from its source references. */
function draftLeadId(sourceReferences: unknown): string | null {
  const references = Array.isArray(sourceReferences) ? sourceReferences : [];
  for (const reference of references) {
    const entry = asRecord(reference);
    if (text(entry.entityType) === "lead" && text(entry.entityId)) return text(entry.entityId);
  }
  return null;
}

/**
 * Each lead's reply draft still waiting for review, newest first when a lead
 * somehow has two (a regenerated draft). Snoozed drafts are left in the
 * queue's own handling, not pulled onto the inquiry card.
 */
function pendingInquiryReplies(actions: TodayRecord[], now: string): Map<string, TodayRecord> {
  const byLead = new Map<string, TodayRecord>();
  for (const action of actions) {
    if (text(action.status) !== "review_required") continue;
    if (text(action.capability) !== "inquiry_reply_draft") continue;
    const snoozed = text(action.snoozedUntil);
    if (snoozed && snoozed > now) continue;
    const leadId = draftLeadId(action.sourceReferences);
    if (!leadId) continue;
    const current = byLead.get(leadId);
    if (!current || text(action.createdAt) > text(current.createdAt)) byLead.set(leadId, action);
  }
  return byLead;
}

/**
 * Whether a draft answers an inquiry the studio has closed — archived, lost,
 * or marked "not an inquiry". Unknown leads are not closed: a draft whose
 * lead simply isn't loaded keeps its card.
 */
function inquiryDraftLeadClosed(
  sourceReferences: unknown,
  leadById: Map<string, TodayRecord>,
): boolean {
  const leadId = draftLeadId(sourceReferences);
  const lead = leadId ? leadById.get(leadId) : undefined;
  if (!lead || text(lead.projectId)) return false;
  return (
    lead.notInquiry === true ||
    ["lost", "archived"].includes(text(lead.status).toLowerCase())
  );
}

/**
 * Whole calendar days from today to a date, in the reader's own timezone.
 *
 * This used to be one helper for both calendar dates and timestamps, anchoring
 * the date at noon UTC and measuring from the current instant. Timestamps want
 * exactly that; calendar dates do not, and the mixture cost a day every
 * evening. On 27 August at 22:44 local, Today read "in 36 days" for an event
 * the job page read "in 37 days", and printed "THURSDAY, AUGUST 27" above
 * "September 4 · 7 DAYS TO". Both ends now sit on local midnight.
 */
export const calendarDayDiff = (
  iso: string | null | undefined,
  now: Date,
): number | null => (iso ? daysUntilEvent(iso.slice(0, 10), now) : null);

/** Days elapsed since a timestamp. Negative, because it is in the past. */
const elapsedDayDiff = (
  iso: string | null | undefined,
  now: Date,
): number | null => {
  if (!iso) return null;
  const parsed = Date.parse(iso.length <= 10 ? `${iso}T12:00:00Z` : iso);
  if (!Number.isFinite(parsed)) return null;
  return Math.round((parsed - now.valueOf()) / 86_400_000);
};

/** "Oct 9, 2027 · in 14 months" — the date, and what it means. */
function eventFact(eventDate: string | null | undefined, now: Date): string | null {
  const days = calendarDayDiff(eventDate, now);
  if (!eventDate || days === null) return null;
  const when = new Date(`${eventDate.slice(0, 10)}T12:00:00Z`);
  const label = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(when);
  if (days < 0) return `${label} · ${Math.abs(days)}d ago`;
  if (days === 0) return `${label} · today`;
  if (days === 1) return `${label} · tomorrow`;
  return `${label} · in ${countdownPhrase(days)}`;
}

/**
 * "arrived today", "waiting 3 days" — an inquiry's own clock.
 *
 * `waitingFact` says nothing below a day, which left a brand-new inquiry
 * carrying one fact — the wedding date — under a heading reading "THIS
 * FORTNIGHT" while the chip said "in 36 days". The card was banded by how long
 * the couple had waited and labelled by a date thirty-six days out, and nothing
 * on it reconciled the two.
 */
const arrivalFact = (receivedAt: string | null, now: Date): string => {
  const days = elapsedDayDiff(receivedAt, now);
  const waited = days === null ? 0 : Math.abs(Math.min(0, days));
  if (waited < 1) return "arrived today";
  if (waited === 1) return "waiting 1 day";
  return `waiting ${waited} days`;
};

/** "waiting 3 days" — silence is the thing that costs money. */
function waitingFact(updatedAt: string | null | undefined, now: Date): string | null {
  const days = elapsedDayDiff(updatedAt, now);
  if (days === null || days > 0) return null;
  const waited = Math.abs(days);
  if (waited < 1) return null;
  return `waiting ${waited} ${waited === 1 ? "day" : "days"}`;
}

const bandFor = (input: {
  eventDate?: string | null;
  dueDate?: string | null;
  overdue?: boolean;
  /** Days after the event this step may legitimately still take. */
  graceDays?: number;
  now: Date;
}): TodayBand => {
  if (input.overdue) return "overdue";
  const due = calendarDayDiff(input.dueDate, input.now);
  if (due !== null && due < 0) return "overdue";
  const days = calendarDayDiff(input.eventDate, input.now);
  if (days === null) return "later";
  // A wedding that already happened and still needs work is late, not
  // upcoming: "this fortnight" must never contain a date two months gone.
  // But post-event work has its own clock — a gallery is not late three
  // weeks after the wedding, it is in progress — so the caller can say how
  // long that step is legitimately allowed to take.
  if (days < 0) return Math.abs(days) > (input.graceDays ?? 0) ? "overdue" : "soon";
  if (days <= 14) return "soon";
  return "later";
};

/**
 * How long a step is allowed to take after the event before it is genuinely
 * late, in days. These are the turnarounds photographers actually promise:
 * a few days to cull, roughly six weeks to a gallery, a season to an album.
 */
function graceAfterEvent(state: string): number {
  if (["EVENT_COMPLETE", "POST_PRODUCTION"].includes(state)) return 42;
  if (["DELIVERED", "REVIEW_REQUESTED"].includes(state)) return 90;
  return 0;
}

/**
 * How late a reply to an inquiry is. Couples shop several studios in the
 * first day or two; a lead untouched for two days is already cold, whatever
 * its event date says.
 */
const leadBand = (receivedAt: string | null, now: Date): TodayBand => {
  const days = elapsedDayDiff(receivedAt, now);
  if (days === null) return "soon";
  const waited = Math.abs(Math.min(0, days));
  if (waited >= 2) return "overdue";
  return "soon";
};

const currency = (cents: unknown) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(cents ?? 0) / 100);


/**
 * Where an inquiry came from, in the studio's words. A capture names the form
 * the studio recognises ("From your Wix form"), a marketplace names itself, and
 * the public intake form stays "From your inquiry form".
 */
function leadEvidence(lead: TodayRecord): string {
  const builder = text(lead.formBuilderLabel);
  const source = text(lead.source);
  if (source.startsWith("marketplace_") && builder) return `From ${builder}`;
  // The builder's label already names the thing: "Wix form", "Jotform".
  if (source === "website_form" && builder) return `From your ${builder}`;
  if (source === "website_form") return "From your website form";
  if (source === "forwarded_email") return "Forwarded from your inbox";
  return "From your inquiry form";
}

export function todayInbox(input: TodayInput): TodayInbox {
  const planningTimeline = resolvePlanningTimeline(input.planningTimeline);
  const now = new Date(input.now);
  const today = input.now.slice(0, 10);
  const act: TodayItem[] = [];
  const approve: TodayItem[] = [];
  const fyi: TodayItem[] = [];

  // ── Act · inquiries ────────────────────────────────────────────────
  // The reply drafted for each open inquiry rides on the inquiry's own card,
  // rather than as a second card in "Prepared for you" about the same couple.
  const replyForLead = pendingInquiryReplies(rows(input.aiActions), input.now);
  // Follow-ups drafted for couples who went quiet, newest per lead.
  const followUpForLead = new Map<string, TodayRecord>();
  for (const action of rows(input.aiActions)) {
    if (text(action.status) !== "review_required" || text(action.capability) !== "inquiry_follow_up") continue;
    const snoozed = text(action.snoozedUntil);
    if (snoozed && snoozed > input.now) continue;
    const leadId = text(asRecord(action.structuredOutput).leadId);
    if (!leadId) continue;
    const current = followUpForLead.get(leadId);
    if (!current || text(action.createdAt) > text(current.createdAt)) followUpForLead.set(leadId, action);
  }
  // The same, by job: a couple who wrote twice has two leads and one job, and
  // the draft may hang off either lead.
  const byJob = (drafts: Map<string, TodayRecord>) => {
    const map = new Map<string, TodayRecord>();
    for (const draft of drafts.values()) {
      const projectId = text(draft.projectId);
      if (!projectId) continue;
      const current = map.get(projectId);
      if (!current || text(draft.createdAt) > text(current.createdAt)) map.set(projectId, draft);
    }
    return map;
  };
  const followUpForJob = byJob(followUpForLead);
  const replyForJob = byJob(replyForLead);
  // Inquiry drafts whose moment has passed: the couple owes the next word, or
  // the inquiry moved past its first conversation. Never offered on Today.
  const staleInquiryDrafts = new Set<string>();
  const mergedReplies = new Set<string>();
  const maybeInquiries: TodayMaybeInquiry[] = [];
  const inquiryJobById = new Map(rows(input.projects).map((project) => [project.id, project]));
  // Jobs that are still at the inquiry stage and came from an inquiry: their
  // inquiry card below is their one Today item, so the journey doesn't add a
  // second card about the same couple.
  const inquiryCardProjectIds = new Set<string>();
  for (const lead of rows(input.leads)) {
    const status = text(lead.status).toLowerCase();
    if (["lost", "archived"].includes(status)) continue;
    // Every dated inquiry becomes a job on arrival. While that job is still
    // at the inquiry stage the couple is still an inquiry, answered here;
    // once it moves on (a consultation booked), the journey takes over.
    const job = text(lead.projectId) ? inquiryJobById.get(text(lead.projectId)) : undefined;
    // As of now, not as of arrival: another couple may have taken the date
    // since (features/inquiries/pipeline.ts).
    const dateTaken =
      lead.availabilityStatus === "conflict" ||
      dateHeldByAnother(
        rows(input.projects),
        typeof lead.eventDate === "string" ? lead.eventDate : null,
        text(lead.projectId) || null,
      );
    if (status === "converted" || job) {
      if (!job || text(job.state) !== "LEAD" || job.archivedAt) {
        const stale = replyForLead.get(lead.id);
        if (stale) staleInquiryDrafts.add(stale.id);
        continue;
      }
      // One card per couple: a couple who wrote twice has two leads and one
      // job, and the job is what the studio answers.
      if (inquiryCardProjectIds.has(job.id)) {
        // Its reply draft is a second answer to the same couple.
        const duplicate = replyForLead.get(lead.id);
        if (duplicate) staleInquiryDrafts.add(duplicate.id);
        continue;
      }
      inquiryCardProjectIds.add(job.id);
    }
    const nextMove = inquiryNextMove({
      conversations: rows(input.conversations),
      projectId: job?.id ?? null,
      leadId: lead.id,
      receivedAt: arrivedAt(lead),
      repliedOutsideAt: text(lead.repliedOutsideAt) || null,
    });
    /**
     * Answered, on a job with no call — a makeup or hair inquiry (trades.ts),
     * a family session or a team day (job-kinds.ts) — and nothing priced yet:
     * the reply told them the price is coming, so the studio owes it. Without
     * this Today read "Nothing needs you" while the job page said "Prepare
     * quote" (UAT on prod, 2026-10-09).
     */
    if (
      job &&
      nextMove.owner === "couple" &&
      lead.needsConfirmation !== true &&
      !(projectProfile(job).consultation && tradeProfile(input.tenantTrade).consultation) &&
      !rows(input.proposals).some((proposal) => text(proposal.projectId) === job.id && !proposal.archivedAt)
    ) {
      const staleReply = replyForLead.get(lead.id) ?? replyForJob.get(job.id);
      if (staleReply) staleInquiryDrafts.add(staleReply.id);
      const offer = tradeVocab(input.tenantTrade).proposal.toLowerCase();
      const quoteName =
        text(lead.displayName) || `${text(lead.firstName)} ${text(lead.lastName)}`.trim() || text(job.name) || "This inquiry";
      act.push({
        id: `quote-owed-${job.id}`,
        lane: "act",
        kind: "proposal",
        title: `Send ${quoteName} your ${offer}`,
        detail: `Your reply said the price is on its way. Lock a package and send the ${offer}.`,
        evidence: null,
        projectId: job.id,
        projectName: text(job.name) || null,
        action: { kind: "link", label: `Prepare ${offer}`, href: `/studio/proposals/new?project=${job.id}` },
        jobHref: `/studio/projects/${job.id}`,
        facts: [waitingFact(nextMove.waitingSince, now), eventFact(text(lead.eventDate) || null, now)].filter(
          (fact): fact is string => Boolean(fact),
        ),
        band: leadBand(nextMove.waitingSince ?? arrivedAt(lead), now),
        eventDate: text(lead.eventDate) || null,
        score: score({ lane: "act", severity: "step", updatedAt: nextMove.waitingSince, now }),
      });
      continue;
    }
    // Answered, and waiting on the couple: nothing for the studio to do —
    // unless a follow-up is drafted, or it has been quiet long enough to close.
    let followUp: TodayRecord | null = null;
    if (nextMove.owner === "couple" && lead.needsConfirmation !== true) {
      const staleReply = replyForLead.get(lead.id) ?? (job ? replyForJob.get(job.id) : undefined);
      if (staleReply) staleInquiryDrafts.add(staleReply.id);
      followUp = followUpForLead.get(lead.id) ?? (job ? followUpForJob.get(job.id) : undefined) ?? null;
      const closeOffer = !followUp && Boolean(text(lead.closeSuggestedAt));
      if (!followUp && !closeOffer) continue;
      if (closeOffer) {
        const quietName =
          text(lead.displayName) || `${text(lead.firstName)} ${text(lead.lastName)}`.trim() || "This inquiry";
        act.push({
          id: `lead-${lead.id}`,
          lane: "act",
          kind: "message",
          title: `${quietName} went quiet`,
          detail: "Two weeks since your last message and two follow-ups. Close it, or keep it open another week.",
          evidence: "Closing records why; if they write again it reopens by itself",
          projectId: job?.id ?? null,
          projectName: job ? text(job.name) || null : null,
          action: {
            kind: "close_inquiry",
            label: "Close — went quiet",
            leadId: lead.id,
            projectId: job?.id ?? null,
            href: job ? `/studio/projects/${job.id}` : `/studio/leads/${lead.id}`,
          },
          jobHref: job ? `/studio/projects/${job.id}` : null,
          facts: [waitingFact(nextMove.waitingSince, now), eventFact(text(lead.eventDate) || null, now)].filter(
            (fact): fact is string => Boolean(fact),
          ),
          band: "later",
          eventDate: text(lead.eventDate) || null,
          score: score({ lane: "act", severity: "step", updatedAt: nextMove.waitingSince, now }),
        });
        continue;
      }
    }
    // A capture the reader wasn't sure was an inquiry is asked about beside
    // the queue, not in it: a newsletter must never outrank a couple.
    if (lead.needsConfirmation === true) {
      const name =
        text(lead.displayName) ||
        `${text(lead.firstName)} ${text(lead.lastName)}`.trim();
      const message = text(lead.message).replace(/\s+/g, " ").trim();
      const source = text(lead.source);
      maybeInquiries.push({
        leadId: lead.id,
        sender: name || text(lead.email) || "Unknown sender",
        evidence: leadEvidence(lead),
        snippet: message.length > 140 ? `${message.slice(0, 139).trimEnd()}…` : message,
        arrivedAt: arrivedAt(lead),
        href: `/studio/leads/${lead.id}`,
        fromForm:
          (source === "website_form" || source.startsWith("marketplace_")) &&
          Boolean(text(lead.email) || text(lead.phone)),
        ignorableSender: ignorableSenderOf(lead),
      });
      continue;
    }
    const name =
      text(lead.displayName) ||
      `${text(lead.firstName)} ${text(lead.lastName)}`.trim();
    // The detail line carries only what the fact chips below it do not. It used
    // to repeat both: the card read "Wedding · Jul 1, 2027 · The Rockleigh" above
    // chips saying "Jul 1, 2027 · in 10 months" and "Wedding" — the date and the
    // event type each stated twice in four lines. The chips own the date and the
    // type; the venue is the one thing only this line says.
    const facts = [text(lead.venue) || text(lead.city)].filter(Boolean);
    const leadEvent = text(lead.eventDate) || null;
    const reply = followUp ?? replyForLead.get(lead.id) ?? (job ? replyForJob.get(job.id) : undefined) ?? null;
    if (reply) mergedReplies.add(reply.id);
    const inquiryHref = job ? `/studio/projects/${job.id}` : `/studio/leads/${lead.id}`;
    act.push({
      id: `lead-${lead.id}`,
      lane: "act",
      // An inquiry is a message that has not been answered yet.
      kind: "message",
      // A nameless inquiry is titled once, not "New inquiry — New inquiry".
      // Once the studio has written, a card here means the couple answered.
      title: followUp
        ? `Follow up with ${name || "this inquiry"}`
        : nextMove.replied
          ? `${name || "Your inquiry"} wrote back`
          : name
            ? `New inquiry — ${name}`
            : "New inquiry",
      detail: followUp
        ? "They haven't replied yet. A short follow-up is ready — or tell StudioCue they answered elsewhere."
        : facts.join(" · ") ||
          (nextMove.replied ? "Waiting on your reply" : "Waiting on your first reply"),
      evidence: leadEvidence(lead),
      projectId: job?.id ?? null,
      projectName: job ? text(job.name) || null : null,
      action: {
        kind: "inquiry",
        label: followUp ? "Send follow-up" : reply ? "Send reply" : "Review & reply",
        href: inquiryHref,
        leadId: lead.id,
        projectId: job?.id ?? null,
        followUp: Boolean(followUp),
        dateTaken: Boolean(text(lead.eventDate)) && dateTaken,
        notInquiryAllowed: notInquiryAllowed(job),
        ignorableSender: ignorableSenderOf(lead),
        reply: reply
          ? {
              actionId: reply.id,
              recipient: text(asRecord(reply.structuredOutput).recipientEmail) || null,
              preview: previewOf(reply.structuredOutput),
              bookingLinkIncluded:
                typeof asRecord(reply.structuredOutput).bookingLinkIncluded === "boolean"
                  ? (asRecord(reply.structuredOutput).bookingLinkIncluded as boolean)
                  : null,
            }
          : null,
      },
      jobHref: job ? `/studio/projects/${job.id}` : null,
      facts: [
        // How long they have waited comes first: that is what bands this card.
        arrivalFact(nextMove.waitingSince ?? arrivedAt(lead), now),
        eventFact(leadEvent, now),
        // Whether the date is free is the first thing a studio asks of an
        // inquiry; it's already known, so say it.
        leadEvent && dateTaken
          ? "Date already booked"
          : leadEvent && lead.availabilityStatus === "available"
            ? "Date free"
            : null,
        readable(lead.eventType) || null,
      ].filter((fact): fact is string => Boolean(fact)),
      // An inquiry is urgent because it is unanswered, never because the
      // wedding is close: couples book 12–18 months out, so banding a fresh
      // lead by its event date buries the most time-critical thing a studio
      // owns under jobs it has already won.
      band: leadBand(nextMove.waitingSince ?? arrivedAt(lead), now),
      eventDate: leadEvent,
      score: score({
        lane: "act",
        severity: "inquiry",
        eventDate: text(lead.eventDate) || null,
        updatedAt: nextMove.waitingSince ?? arrivedAt(lead) ?? changedAt(lead),
        now,
      }),
    });
  }

  // ── Act · a couple asked to add a package ──────────────────────────
  for (const request of rows(input.packageRequests)) {
    if (text(request.status) !== "pending") continue;
    const projectId = text(request.projectId);
    const job = inquiryJobById.get(projectId);
    if (!job || job.archivedAt) continue;
    const requestKind = text(request.kind) === "date_change" ? "date_change" : "package";
    const requestedDate = text(request.requestedDate) || null;
    // Already moved: nothing left to decide.
    if (requestKind === "date_change" && requestedDate === text(job.eventDate)) continue;
    const amend = isAmendable(job.state);
    const proposal = rows(input.proposals)
      .filter(
        (candidate) =>
          text(candidate.projectId) === projectId &&
          ["draft", "internal_review", "approved", "sent", "viewed", "accepted"].includes(text(candidate.status)),
      )
      .sort((left, right) => Number(right.version ?? 0) - Number(left.version ?? 0))[0];
    const price =
      typeof request.basePriceCents === "number"
        ? new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: text(request.currency) || "USD",
            maximumFractionDigits: 0,
          }).format(request.basePriceCents / 100)
        : null;
    const note = text(request.note).trim();
    // "Alex & Sam Rivera want to…", not "Alex & Sam Rivera wedding want to…".
    const couple = clientOf(job, null, true);
    // A change already written up for this job: the next step is it, not a new one.
    const changeOut = amend && Boolean(text(job.pendingAmendmentId));
    act.push({
      id: `package-request-${request.id}`,
      lane: "act",
      kind: "package",
      title:
        requestKind === "date_change"
          ? `${couple} want to move their date to ${requestedDate ? formatDueDate(requestedDate) : "a new date"}`
          : `${couple} want to add ${text(request.packageName) || "a package"}`,
      detail: [
        requestKind === "package" ? price : null,
        note ? `“${note.length > 120 ? `${note.slice(0, 119)}…` : note}”` : null,
        changeOut
          ? "A change is written up for them. Open it to send it, or see that it's waiting for their signature."
          : amend
          ? "They've signed, so it's a booking change for them to sign — check it, then send it."
          : requestKind === "date_change"
            ? "Check you're free, then change the date on the job."
            : text(proposal?.status) === "accepted"
              ? "Adding it makes a revised proposal for them to accept."
              : proposal
                ? "Adding it prices their proposal again."
                : null,
      ]
        .filter(Boolean)
        .join(" · "),
      evidence: "Asked in their portal",
      projectId,
      projectName: text(job.name) || null,
      action: {
        kind: "package_request",
        label: changeOut ? "Open the change" : amend ? "Write up the change" : requestKind === "date_change" ? "Open the job" : "Add and revise",
        requestId: request.id,
        projectId,
        requestKind,
        amend,
        requestedDate,
        packageId: text(request.packageId),
        packageName: text(request.packageName) || "the package",
        proposalId: proposal?.id ?? null,
        proposalStatus: text(proposal?.status) || null,
      },
      jobHref: `/studio/projects/${projectId}`,
      facts: [waitingFact(changedAt(request), now)].filter((fact): fact is string => Boolean(fact)),
      band: "soon",
      eventDate: text(job.eventDate) || null,
      score: score({ lane: "act", severity: "inquiry", updatedAt: changedAt(request), now }),
    });
  }

  // ── Act · a couple asked to change a locked location or time ───────
  for (const request of rows(input.detailChangeRequests)) {
    if (text(request.status) !== "pending") continue;
    const projectId = text(request.projectId);
    const job = inquiryJobById.get(projectId);
    if (!job || job.archivedAt) continue;
    const eventDate = text(job.eventDate) || null;
    if (eventDate && eventDate < input.now.slice(0, 10)) continue;
    const couple = clientOf(job, null, true);
    const note = text(request.note);
    act.push({
      id: `detail-change-${request.id}`,
      lane: "act",
      kind: "schedule",
      title: `${couple} want to change ${text(request.label) || "a detail"}`,
      detail: [
        `${text(request.fromText) || "(blank)"} → ${text(request.toText) || "(blank)"}`,
        note ? `“${note.length > 120 ? `${note.slice(0, 119)}…` : note}”` : null,
        "Their final details are locked, so it's yours to agree. No charge.",
      ]
        .filter(Boolean)
        .join(" · "),
      evidence: "Asked in their portal",
      projectId,
      projectName: text(job.name) || null,
      action: { kind: "detail_change", label: "Accept", requestId: request.id, projectId },
      jobHref: `/studio/projects/${projectId}`,
      facts: [eventDate ? formatDueDate(eventDate) : null, waitingFact(changedAt(request), now)].filter((fact): fact is string => Boolean(fact)),
      band: "soon",
      eventDate,
      score: score({ lane: "act", severity: "inquiry", eventDate, updatedAt: changedAt(request), now }),
    });
  }

  // ── Act · final details still not confirmed, five days after the lock ──
  for (const signoff of rows(input.detailSignoffs)) {
    if (text(signoff.status) !== "awaiting_couple") continue;
    const lockOn = text(signoff.lockOn);
    if (!lockOn) continue;
    const nudgeOn = new Date(Date.parse(`${lockOn}T00:00:00Z`) + 5 * 86_400_000).toISOString().slice(0, 10);
    if (input.now.slice(0, 10) < nudgeOn) continue;
    const projectId = text(signoff.projectId);
    const job = inquiryJobById.get(projectId);
    if (!job || job.archivedAt) continue;
    const eventDate = text(job.eventDate) || null;
    if (eventDate && eventDate < input.now.slice(0, 10)) continue;
    const couple = clientOf(job, null, true);
    act.push({
      id: `final-details-${signoff.id}`,
      lane: "act",
      kind: "schedule",
      title: `${couple} haven't confirmed their final details`,
      detail: "They were asked when the details locked. A quick message usually does it.",
      evidence: "Final details sign-off",
      projectId,
      projectName: text(job.name) || null,
      action: { kind: "link", label: "Message them", href: `/studio/messages?project=${projectId}` },
      jobHref: `/studio/projects/${projectId}`,
      facts: [eventDate ? formatDueDate(eventDate) : null].filter((fact): fact is string => Boolean(fact)),
      band: "soon",
      eventDate,
      score: score({ lane: "act", severity: "step", eventDate, updatedAt: lockOn, now }),
    });
  }

  // ── Act · a billing address QuickBooks needs to tax the final ───────
  // A quiet job the scheduler wouldn't email: the studio decides. One the
  // couple was emailed about: nothing to do until it's been a few days.
  for (const request of rows(input.billingAddressRequests)) {
    const status = text(request.status);
    if (status !== "needs_studio" && status !== "requested") continue;
    const projectId = text(request.projectId);
    const job = inquiryJobById.get(projectId);
    if (!job || job.archivedAt || ["ARCHIVED", "CANCELLED", "LOST"].includes(text(job.state))) continue;
    const eventDate = text(job.eventDate) || null;
    if (eventDate && eventDate < input.now.slice(0, 10)) continue;
    const lastAsked = text(request.lastRequestedAt) || null;
    const askedDays = lastAsked ? Math.max(0, -(elapsedDayDiff(lastAsked, now) ?? 0)) : null;
    if (status === "requested" && (askedDays === null || askedDays < BILLING_ADDRESS_ASK_AGAIN_DAYS)) continue;
    const couple = clientOf(job, null, true);
    const asked = Number(request.requestCount ?? 0);
    act.push({
      id: `billing-address-${projectId}`,
      lane: "act",
      kind: "invoice",
      title:
        status === "requested"
          ? `Still waiting on ${clientOf(job)}'s billing address`
          : `${couple}'s billing address is missing`,
      detail: [
        "QuickBooks works out the sales tax on their final invoice from it.",
        status === "requested"
          ? `Asked ${asked === 1 ? "once" : `${asked} times`}${askedDays !== null ? `, last ${askedDays} ${askedDays === 1 ? "day" : "days"} ago` : ""}.`
          : text(request.reason) === "no_client_email"
            ? "There's no email on their client record — add one, or type the address in yourself."
            : "This booking is quiet (imported or paused), so StudioCue hasn't emailed them.",
      ].join(" "),
      evidence: "Needed before the final invoice",
      projectId,
      projectName: text(job.name) || null,
      action: {
        kind: "billing_address",
        label: status === "requested" ? "Ask again" : "Ask them",
        projectId,
      },
      jobHref: `/studio/projects/${projectId}`,
      facts: [eventDate ? formatDueDate(eventDate) : null].filter((fact): fact is string => Boolean(fact)),
      band: "soon",
      eventDate,
      score: score({ lane: "act", severity: "step", eventDate, updatedAt: text(request.updatedAt) || null, now }),
    });
  }

  // ── Act · exceptions ───────────────────────────────────────────────
  const exception = (item: {
    id: string;
    title: string;
    detail: string;
    href: string;
    projectId?: string | null;
    projectName?: string | null;
    eventDate?: string | null;
    updatedAt?: string | null;
    amountCents?: number | null;
    label?: string;
    dueDate?: string | null;
    extraFacts?: Array<string | null>;
    kind?: LibraryKind | null;
    /** Acts on the card itself instead of linking away. */
    action?: TodayAction;
  }) => {
    act.push({
      id: item.id,
      lane: "act",
      kind: item.kind ?? null,
      title: item.title,
      detail: item.detail,
      evidence: "Cue stopped safely — this one needs you",
      projectId: item.projectId ?? null,
      projectName: item.projectName ?? null,
      action: item.action ?? {
        kind: "link",
        label: item.label ?? "Resolve",
        href: item.href,
      },
      jobHref: item.projectId ? `/studio/projects/${item.projectId}` : null,
      facts: [
        ...(item.extraFacts ?? []),
        eventFact(item.eventDate, now),
        waitingFact(item.updatedAt, now),
      ].filter((fact): fact is string => Boolean(fact)),
      band: bandFor({
        eventDate: item.eventDate,
        dueDate: item.dueDate,
        overdue: true,
        now,
      }),
      eventDate: item.eventDate ?? null,
      score: score({
        lane: "act",
        severity: "exception",
        eventDate: item.eventDate,
        updatedAt: item.updatedAt,
        amountCents: item.amountCents,
        now,
      }),
    });
  };

  const journeyById = new Map(
    (input.journeys ?? []).map((position) => [position.projectId, position]),
  );
  // Falls back to the job record itself: a card whose job has no journey
  // position (a crew cascade on a job off the live list) printed no job name
  // at all — "Still no second videographer", for whom? (UI audit, 2026-10-02).
  const nameFor = (projectId: unknown) =>
    journeyById.get(text(projectId))?.projectName ??
    (text(projectById.get(text(projectId))?.name) || null);
  const eventFor = (projectId: unknown) =>
    journeyById.get(text(projectId))?.eventDate ??
    (text(projectById.get(text(projectId))?.eventDate) || null);
  const projectById = new Map(
    rows(input.projects).map((project) => [project.id, project]),
  );
  const stateFor = (projectId: unknown) => {
    const id = text(projectId);
    if (!id) return null;
    const state = text(projectById.get(id)?.state);
    if (state) return state;
    return journeyById.get(id)?.state ?? null;
  };
  /**
   * Whether work about this job still belongs in front of a studio.
   *
   * A closed, cancelled or archived job has nothing left to do on it, and both
   * the task list and the AI-approval queue used to go on demanding attention
   * for one: a delivery note awaiting approval on a job already closed out, and
   * an overdue "book the second shooter" on a wedding that had been cancelled —
   * which the Jobs list had correctly stopped showing, so there was nowhere to
   * go and stop it. See features/projects/job-moment.ts.
   *
   * A job whose date has merely passed is deliberately still live here. Hiding
   * its work would be a guess: if the wedding was postponed rather than shot,
   * that certificate wording still matters. The journey asks the question that
   * settles it instead.
   */
  const jobStillOpen = (projectId: unknown) => {
    // Filed away keeps its last state (a BOOKED job archived stays BOOKED), so
    // the state alone said "still open". Walked on production 2026-09-30: an
    // archived test job still asked for "Release the gallery" on Today.
    if (projectById.get(text(projectId))?.archivedAt) return false;
    const state = stateFor(projectId);
    return state === null || workStillMatters(state);
  };
  const leadById = new Map(rows(input.leads).map((lead) => [lead.id, lead]));
  /** The event date of any job, live or settled — see `stateFor`. */
  const eventDateFor = (projectId: unknown) => {
    const id = text(projectId);
    if (!id) return null;
    return text(projectById.get(id)?.eventDate) || eventFor(id);
  };

  // ── Act · the couple answered the day plan ─────────────────────────
  // GR Productions (2026-10-01): a couple's review of the run of show did
  // nothing anyone could see. Approving changed nothing on Today; asking for
  // changes made a task due today, and tasks reach Today only once overdue —
  // so the studio heard about it the next day, if at all.
  const scheduleChangeProjectIds = new Set<string>();
  for (const schedule of newestScheduleByProject(rows(input.schedules)).values()) {
    const projectId = text(schedule.projectId);
    if (!jobStillOpen(projectId)) continue;
    const status = text(schedule.status);
    if (["superseded", "draft", "internal_review"].includes(status)) continue;
    const answer = scheduleAnswer(schedule);
    if (!answer) continue;
    const job = projectById.get(projectId);
    const couple = clientOf(job, text(job?.name) || nameFor(projectId), true);
    const version = Number(schedule.version ?? 0) || null;
    const eventDate = text(job?.eventDate) || eventFor(projectId);
    if (answer.decision === "changes_requested") {
      // A day that has happened has no plan left to change.
      if (eventDate && eventDate < today) continue;
      scheduleChangeProjectIds.add(projectId);
      const note = answer.note.length > 160 ? `${answer.note.slice(0, 159)}…` : answer.note;
      act.push({
        id: `schedule-changes-${schedule.id}`,
        lane: "act",
        kind: "schedule",
        title: `${couple} asked for changes to the day plan`,
        detail: [
          note ? `“${note}”` : null,
          version
            ? `Your crew still have version ${version} until you publish the change.`
            : "Your crew still have the current version until you publish the change.",
        ]
          .filter(Boolean)
          .join(" · "),
        evidence: answer.byStudio ? "You recorded their answer" : "Asked in their portal",
        projectId,
        projectName: text(job?.name) || nameFor(projectId),
        action: {
          kind: "link",
          label: "Open the day plan",
          href: `/studio/schedules/new?project=${encodeURIComponent(projectId)}`,
        },
        jobHref: `/studio/projects/${projectId}`,
        facts: [eventFact(eventDate, now), waitingFact(answer.at, now)].filter(
          (fact): fact is string => Boolean(fact),
        ),
        band: "soon",
        eventDate: eventDate || null,
        // A couple is waiting on the studio, ahead of ordinary job steps.
        score: score({ lane: "act", severity: "exception", eventDate, updatedAt: answer.at, now }),
      });
    } else if (!answer.byStudio && answer.at) {
      // A receipt for a week: the studio wrote it down themselves otherwise.
      const age = now.valueOf() - Date.parse(answer.at);
      if (!Number.isFinite(age) || age > 7 * 86_400_000) continue;
      fyi.push({
        id: `schedule-approved-${schedule.id}`,
        lane: "fyi",
        kind: "schedule",
        title: `${couple} approved the day plan`,
        detail: version
          ? `Version ${version} — you, your crew and ${clientOf(job, null)} are working from the same times.`
          : `You, your crew and ${clientOf(job, null)} are working from the same times.`,
        evidence: "Approved in their portal",
        projectId,
        projectName: text(job?.name) || nameFor(projectId),
        action: { kind: "none", label: "Nothing to do" },
        jobHref: `/studio/projects/${projectId}`,
        facts: [],
        band: "later",
        eventDate: eventDate || null,
        score: score({ lane: "fyi", updatedAt: answer.at, now }),
      });
    }
  }

  for (const task of rows(input.tasks)) {
    const due = text(task.dueAt ?? task.dueDate).slice(0, 10);
    const done = taskIsSettled(task.status);
    if (!due || due >= today || done) continue;
    if (!jobStillOpen(task.projectId)) continue;
    // The change request already has its card above, with the couple's words.
    if (
      text(task.source) === "client_schedule_review" &&
      scheduleChangeProjectIds.has(text(task.projectId))
    ) {
      continue;
    }
    /**
     * A task for an event that has since been recorded as shot.
     *
     * "Confirm Foundry COI wording", due the day before the wedding, was the
     * studio's single most prominent item after the wedding was recorded as
     * having happened. A certificate of insurance is insurance for the event.
     * See features/projects/job-moment.ts.
     */
    if (
      taskMomentHasGone({
        state: stateFor(task.projectId) ?? "",
        dueDate: due,
        eventDate: eventDateFor(task.projectId),
      })
    ) {
      continue;
    }
    exception({
      id: `task-${task.id}`,
      kind: "task",
      title: text(task.title) || "Overdue task",
      detail: nameFor(task.projectId) ?? "Studio task",
      dueDate: due,
      extraFacts: [`was due ${formatDueDate(due)}`],
      // The task list, filtered to the job: that is where Mark done, Edit and
      // Cancel are. The card used to open the job page, which has none of
      // them, so an overdue task could be looked at from Today but not done.
      href: task.projectId
        ? `/studio/tasks?project=${encodeURIComponent(text(task.projectId))}`
        : "/studio/tasks",
      projectId: text(task.projectId) || null,
      projectName: nameFor(task.projectId),
      eventDate: eventFor(task.projectId),
      updatedAt: changedAt(task),
      label: "Open the task",
    });
  }

  // Jobs whose certificate has its own card below (H3), so the journey's
  // "Insurance to venue" step is not repeated.
  const COI_CARD_STATUSES = ["prepared", "needs_details", "self_serve", "under_review", "approved", "failed"];
  const coiCards = rows(input.insuranceRequests).filter(
    (request) =>
      !request.archivedAt &&
      jobStillOpen(request.projectId) &&
      (COI_CARD_STATUSES.includes(text(request.status)) ||
        (Boolean(request.escalatedAt) && ["requested", "correction_required"].includes(text(request.status)))),
  );
  const coiCardProjectIds = new Set(coiCards.map((request) => text(request.projectId)));

  /**
   * Payment reminders, by invoice (functions/src/billing/payment-reminders.ts).
   * One Cue drafted and is waiting rides on that bill's overdue card as
   * "Send reminder", rather than as a second card for the same money; ones
   * already sent say when on it.
   */
  const reminderDrafts = new Map<string, TodayRecord>();
  const remindersSent = new Map<string, string[]>();
  for (const action of rows(input.aiActions)) {
    const invoiceId = text(asRecord(asRecord(action.structuredOutput).paymentReminder).invoiceId);
    if (!invoiceId) continue;
    if (text(action.status) === "review_required") {
      const snoozed = text(action.snoozedUntil);
      if (!(snoozed && snoozed > input.now)) reminderDrafts.set(invoiceId, action);
    } else if (text(asRecord(action.decision).action) === "approved") {
      remindersSent.set(invoiceId, [...(remindersSent.get(invoiceId) ?? []), text(asRecord(action.decision).decidedAt)]);
    }
  }

  // Projects whose overdue balance already has its own card, so the journey's
  // balance step is not repeated below.
  const overdueInvoiceProjectIds = new Set<string>();
  for (const invoice of rows(input.invoiceReferences)) {
    // A missing due date is not an overdue date.
    const due = text(invoice.dueDate).slice(0, 10);
    const balance = Number(invoice.balanceCents ?? 0);
    const provider = text(invoice.provider) === "stripe" ? "Stripe" : "QuickBooks";
    /**
     * Where chasing this bill can actually happen: the job's booking page for
     * a retainer (record it paid, open the invoice), the job's invoices for
     * anything else (send, record or void the final bill). "Chase payment"
     * linked to every invoice in the studio, unfiltered, where none of that
     * was on offer (wave 3).
     */
    const chaseHref = text(invoice.projectId)
      ? text(invoice.kind) === "retainer"
        ? `/studio/booking?project=${text(invoice.projectId)}`
        : `/studio/invoices?project=${text(invoice.projectId)}`
      : "/studio/invoices";
    /**
     * The card was declined. Stripe's `invoice.payment_failed` used to fall
     * through to `sent`, so a failed charge looked like a bill still waiting
     * and nobody was told (functions/src/booking/webhooks.ts, wave 3). It is
     * its own card, ahead of any overdue one for the same bill.
     */
    if (
      text(invoice.paymentFailedAt) &&
      balance > 0 &&
      !["voided", "void", "refunded", "paid", "superseded", "failed", "cancelled"].includes(text(invoice.status))
    ) {
      exception({
        id: `invoice-payment-failed-${invoice.id}`,
        kind: "invoice",
        title: `${currency(balance)} payment failed`,
        detail: nameFor(invoice.projectId) ?? "Client balance",
        dueDate: due || null,
        extraFacts: [`${provider} couldn't take the payment`],
        href: chaseHref,
        projectId: text(invoice.projectId) || null,
        projectName: nameFor(invoice.projectId),
        eventDate: eventFor(invoice.projectId),
        updatedAt: text(invoice.paymentFailedAt),
        amountCents: balance,
        label: "Open the invoice",
      });
      if (text(invoice.projectId)) overdueInvoiceProjectIds.add(text(invoice.projectId));
      continue;
    }
    if (
      balance <= 0 ||
      !due ||
      due >= today ||
      // A superseded or failed bill is not owed: a booking change replaced
      // it, or it never reached the provider.
      ["voided", "void", "refunded", "paid", "superseded", "failed", "cancelled"].includes(text(invoice.status))
    )
      continue;
    const reminder = reminderDrafts.get(invoice.id);
    const sent = (remindersSent.get(invoice.id) ?? []).filter(Boolean).sort();
    const lastSent = sent[sent.length - 1];
    exception({
      id: `invoice-${invoice.id}`,
      kind: "invoice",
      // The amount leads. Four cards titled "Balance overdue" above four
      // identical buttons made the only thing that differed — how much, and
      // whose — the smallest text on the card.
      title: `${currency(balance)} overdue`,
      detail: nameFor(invoice.projectId) ?? "Client balance",
      dueDate: due,
      // A reminder Cue drafted is sent from here. Without one (not yet
      // drafted, or the studio declined the last), the provider's own
      // reminder is the way, so the card says where.
      extraFacts: [
        `due ${formatDueDate(due)}`,
        reminder
          ? "Cue drafted a reminder"
          : lastSent
            ? `${sent.length === 1 ? "reminded" : `reminded ${sent.length} times, last`} ${formatDueDate(lastSent.slice(0, 10))}`
            : `resend it from ${provider}`,
      ],
      action: reminder
        ? {
            kind: "approve",
            label: "Send reminder",
            actionId: reminder.id,
            href: chaseHref,
            preview: previewOf(reminder.structuredOutput),
          }
        : undefined,
      href: chaseHref,
      projectId: text(invoice.projectId) || null,
      projectName: nameFor(invoice.projectId),
      eventDate: eventFor(invoice.projectId),
      updatedAt: changedAt(invoice),
      amountCents: balance,
      label: "Follow up on payment",
    });
    if (text(invoice.projectId)) {
      overdueInvoiceProjectIds.add(text(invoice.projectId));
    }
  }

  for (const cascade of rows(input.crewCascades)) {
    /**
     * The last name on the list, reminded and still quiet.
     *
     * Their offer is held open to the details lock instead of expiring
     * (functions/src/crew/offer.ts), so the studio hears about the wait here
     * rather than finding a dead offer later (GR and Albert, 2026-10-06).
     */
    const waitingOn = (cascade.waitingOn ?? null) as { name?: unknown; offeredAt?: unknown } | null;
    if (text(cascade.status) === "active" && text(cascade.currentRemindedAt) && waitingOn) {
      const who = text(waitingOn.name) || "Your crew member";
      const role = text(cascade.role).toLowerCase() || "this role";
      exception({
        id: `cascade-waiting-${cascade.id}`,
        kind: "crew",
        title: `${who} hasn't answered`,
        detail: `Offered the ${role} and reminded. They're the last name on your list; the offer stays open until the details lock.`,
        href: `/studio/crew?project=${text(cascade.projectId)}`,
        projectId: text(cascade.projectId) || null,
        projectName: nameFor(cascade.projectId),
        eventDate: eventFor(cascade.projectId),
        updatedAt: changedAt(cascade),
        label: "Offer to someone else",
      });
      continue;
    }
    if (text(cascade.status) !== "exhausted") continue;
    exception({
      id: `cascade-${cascade.id}`,
      kind: "crew",
      // Was "No one accepted Second photographer" — a role name used mid
      // sentence with no article, in the largest type on the page.
      title: text(cascade.role)
        ? `Still no ${text(cascade.role).toLowerCase()}`
        : "Still no crew for this role",
      // The project name is already the card's subtitle.
      detail: "Every candidate has declined or let the offer expire",
      href: "/studio/crew",
      projectId: text(cascade.projectId) || null,
      projectName: nameFor(cascade.projectId),
      eventDate: eventFor(cascade.projectId),
      updatedAt: changedAt(cascade),
      label: "Find crew",
    });
  }

  for (const plan of rows(input.bookingOrchestrations)) {
    if (text(plan.status) !== "needs_attention") continue;
    const blockers = Array.isArray(plan.blockers)
      ? [...new Set(plan.blockers.map((value) => bookingBlockerLabel(value)))].join(", ")
      : "";
    exception({
      id: `booking-${plan.id}`,
      kind: "calendar",
      title: "Booking stopped for a reason",
      // The job's name is already the card's subtitle; it was printed twice
      // ("Native signing test wedding · the date clashes…", UAT T37).
      detail: blockers ? `Stopped because ${blockers}` : "Open the booking to see what it's waiting on",
      href: `/studio/booking?project=${text(plan.projectId)}`,
      projectId: text(plan.projectId) || null,
      projectName: nameFor(plan.projectId),
      eventDate: eventFor(plan.projectId),
      updatedAt: changedAt(plan),
      label: "Review booking",
    });
  }

  const failed = (record: TodayRecord) =>
    ["failed", "dead_letter"].includes(text(record.status));
  for (const run of rows(input.automationRuns).filter(failed))
    exception({
      id: `automation-${run.id}`,
      kind: "automation",
      title: "An automation could not finish",
      detail: `${nameFor(run.projectId) ?? "Studio"} · ${readable(run.status)}`,
      href: "/studio/automations",
      projectId: text(run.projectId) || null,
      projectName: nameFor(run.projectId),
      updatedAt: changedAt(run),
    });
  // Retries of the same step are one problem, not several. Each attempt writes
  // its own job row, so a step that had failed twice produced two cards with
  // identical titles — and the title said "A provider step could not finish",
  // which is true of all of them and useful for none.
  for (const { job, attempts } of groupProviderFailures(
    rows(input.providerJobs).filter(failed),
  )) {
    const failure = describeProviderFailure(job.type);
    exception({
      id: `provider-${job.id}`,
      // Every card carries a glyph, so every title starts on the same line;
      // these were the only plain ones, 42px left of their neighbours.
      kind: providerFailureKind(job.type),
      title: failure.title,
      // The project name is already the card's subtitle, so repeating it here
      // printed it twice on one card. This says who could not do it, and how
      // many times it has been tried.
      detail: [
        // Phrased with the provider last so it reads correctly whether the
        // name is "QuickBooks" or "your email provider".
        failure.provider ? `Couldn't be completed by ${failure.provider}` : null,
        attempts > 1 ? `tried ${attempts} times` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      href: "/studio/integrations",
      projectId: text(job.projectId) || null,
      projectName: nameFor(job.projectId),
      updatedAt: changedAt(job),
    });
  }
  // Failed sends and bounces alike: who it was for, what it was, and why —
  // with Retry / Fix the address / Leave it on the card.
  for (const job of rows(input.emailJobs)) {
    const problem = emailProblemOf(job);
    if (!problem) continue;
    exception({
      id: `email-${job.id}`,
      kind: "email",
      title: problem.title,
      detail: [
        problem.subject ?? readable(job.type),
        `to ${problem.recipient ?? "the client"}`,
      ].join(" · "),
      href: problem.fixHref ?? "/studio/messages",
      projectId: text(job.projectId) || null,
      projectName: nameFor(job.projectId),
      updatedAt: changedAt(job),
      extraFacts: [problem.reason],
      action: {
        kind: "email_problem",
        label: problem.canRetry ? "Retry" : "Fix the address",
        emailJobId: job.id,
        recipient: problem.recipient,
        subject: problem.subject,
        reason: problem.reason,
        canRetry: problem.canRetry,
        fixHref: problem.fixHref,
      },
    });
  }
  for (const connection of rows(input.integrationConnections)) {
    if (text(connection.status) !== "error" && !connection.lastError) continue;
    exception({
      id: `connection-${connection.id}`,
      kind: null,
      title: `Reconnect ${readable(connection.provider) || "an integration"}`,
      detail: "Automation is paused until this is reconnected",
      href: "/studio/integrations",
      updatedAt: changedAt(connection),
      label: "Reconnect",
    });
  }

  // ── Act · jobs whose next step is yours ────────────────────────────
  //
  // A job whose next step is blocked by missing studio setup must not also
  // be told to take that step: "add your packages, Smith can't be priced"
  // beside "Smith — prepare proposal" is a contradiction, not two moments.
  const blockedProjectNames = new Set(
    (input.setupGaps ?? [])
      .filter((gap) => gap.blocking && gap.blockedProjectName)
      .map((gap) => gap.blockedProjectName as string),
  );
  // ── Act · a final balance nothing has billed ───────────────────────
  // Its own card, not the journey's: a job shows one journey step at a time,
  // and three weeks out with money unbilled, "send the form" was the only
  // thing Today said about Rivera. The scheduler bills on one day and only
  // with an invoicing customer, so this is where the rest get billed.
  const finalBalanceProjectIds = new Set<string>();
  for (const job of rows(input.projects)) {
    if (job.archivedAt || !balanceMayBeAttested(text(job.state))) continue;
    // A deposit leaves a balance, billed from four weeks out. Paid in full
    // owes nothing more. Paid on the day or invoiced after is one bill for
    // the whole price, offered when it falls due (job-kinds.ts).
    const profile = projectProfile(job);
    const singleBill = hasFinalBalance(profile) ? null : singleBillWindow(job, input.now.slice(0, 10));
    if (hasFinalBalance(profile)) {
      const days = calendarDayDiff(text(job.eventDate) || null, now);
      if (days === null || days > FINAL_BALANCE_WINDOW_DAYS) continue;
    } else if (!singleBill) continue;
    const due = outstandingFinalBalance({
      projectId: job.id,
      proposals: rows(input.proposals) as Array<Record<string, unknown> & { id: string }>,
      invoices: rows(input.invoiceReferences) as Array<Record<string, unknown> & { id: string }>,
    });
    // A final bill held for review is standing, so the "send" card below
    // stays away — but it was never sent, and nothing else said so.
    // In QuickBooks already, waiting on the tax check: QuickBooks' figure, and
    // why it waits (features/billing/held-invoice-review.ts).
    const heldInQuickBooks = due.heldForReviewId
      ? heldInvoiceView(
          (rows(input.invoiceReferences).find((invoice) => invoice.id === due.heldForReviewId) ?? { id: "" }) as Record<
            string,
            unknown
          > & { id: string },
        )
      : null;
    if (due.heldForReviewId && (due.cents || heldInQuickBooks)) {
      finalBalanceProjectIds.add(job.id);
      const heldCents = heldInQuickBooks ? heldInQuickBooks.totalCents : (due.cents ?? 0);
      const held = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: heldCents % 100 ? 2 : 0,
      }).format(heldCents / 100);
      act.push({
        id: `final-balance-review-${job.id}`,
        lane: "act",
        kind: "invoice",
        title: `Check and send ${clientOf(job)}'s final bill · ${held}`,
        detail: heldInQuickBooks
          ? heldInQuickBooks.billingAddressMissing
            ? `Add ${clientOf(job)}'s billing address so QuickBooks can work out the tax. Nothing has gone to them yet.`
            : "It's in QuickBooks with the sales tax worked out. Check it, then send it with or without tax. Nothing has gone to them yet."
          : "It's held for you to check: the payments on record don't match what was agreed. Nothing has gone to them yet.",
        evidence: null,
        projectId: job.id,
        projectName: text(job.name) || null,
        action: { kind: "link", label: "Check it", href: `/studio/invoices?project=${job.id}` },
        jobHref: `/studio/projects/${job.id}`,
        facts: [eventFact(text(job.eventDate) || null, now)].filter((fact): fact is string => Boolean(fact)),
        band: bandFor({ eventDate: text(job.eventDate) || null, dueDate: due.dueDate, now }),
        eventDate: text(job.eventDate) || null,
        score: score({ lane: "act", severity: "step", eventDate: text(job.eventDate) || null, updatedAt: changedAt(job), now }),
      });
      continue;
    }
    if (!due.cents || due.finalStanding) continue;
    finalBalanceProjectIds.add(job.id);
    // To the cent: this is the figure the bill will carry.
    const amount = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: due.cents % 100 ? 2 : 0,
    }).format(due.cents / 100);
    act.push({
      id: `final-balance-${job.id}`,
      lane: "act",
      kind: "invoice",
      title: singleBill
        ? `Bill ${text(job.name).trim() || "the client"} · ${amount}`
        : `Bill ${clientOf(job)}'s final balance · ${amount}`,
      detail: [
        (singleBill?.dueDate ?? due.dueDate) ? `Due ${formatDueDate((singleBill?.dueDate ?? due.dueDate)!)}.` : null,
        singleBill && profile.payment === "on_the_day" ? "Paid on the day: send the link now, or take payment on the day." : null,
        due.lastFailure
          ? `The last try didn't go through. ${due.lastFailure}`
          : "Nothing has billed it yet. Send it from here, or record it if they paid another way.",
      ]
        .filter(Boolean)
        .join(" "),
      evidence: null,
      projectId: job.id,
      projectName: text(job.name) || null,
      action: {
        kind: "final_balance",
        label: due.lastFailure ? "Send it again" : singleBill ? "Send the bill" : "Send the final bill",
        projectId: job.id,
        packageSnapshotId: text(job.packageSnapshotId) || null,
        balanceCents: due.cents,
        ...(singleBill ? { singleBill: true } : {}),
      },
      jobHref: `/studio/projects/${job.id}`,
      facts: [eventFact(text(job.eventDate) || null, now)].filter((fact): fact is string => Boolean(fact)),
      band: bandFor({ eventDate: text(job.eventDate) || null, dueDate: due.dueDate, now }),
      eventDate: text(job.eventDate) || null,
      score: score({ lane: "act", severity: "step", eventDate: text(job.eventDate) || null, updatedAt: changedAt(job), now }),
    });
  }
  // ── Act · a retainer held in QuickBooks for the studio ──────────────
  // The studio asked to check retainers before they go
  // (billingSettings.holdRetainerForReview): made in QuickBooks, unsent.
  for (const invoice of rows(input.invoiceReferences)) {
    if (text(invoice.kind) !== "retainer") continue;
    const heldRetainer = heldInvoiceView(invoice);
    if (!heldRetainer) continue;
    const projectId = text(invoice.projectId);
    if (!projectId || !jobStillOpen(projectId)) continue;
    const job = rows(input.projects).find((candidate) => candidate.id === projectId);
    const amount = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: heldRetainer.totalCents % 100 ? 2 : 0,
    }).format(heldRetainer.totalCents / 100);
    act.push({
      id: `retainer-review-${invoice.id}`,
      lane: "act",
      kind: "invoice",
      title: `Check and send ${clientOf(job)}'s retainer · ${amount}`,
      detail: "It's in QuickBooks, held for you to check. Nothing has gone to them yet.",
      evidence: null,
      projectId,
      projectName: text(job?.name) || null,
      action: { kind: "link", label: "Check it", href: `/studio/booking?project=${projectId}` },
      jobHref: `/studio/projects/${projectId}`,
      facts: [eventFact(text(job?.eventDate) || null, now)].filter((fact): fact is string => Boolean(fact)),
      band: bandFor({ eventDate: text(job?.eventDate) || null, dueDate: text(invoice.dueDate) || null, now }),
      eventDate: text(job?.eventDate) || null,
      score: score({ lane: "act", severity: "step", eventDate: text(job?.eventDate) || null, updatedAt: changedAt(invoice), now }),
    });
  }
  let inMotion = 0;
  for (const position of input.journeys ?? []) {
    if (!jobStillOpen(position.projectId)) continue;
    // The inquiry card is this couple's Today item while they are one.
    if (inquiryCardProjectIds.has(position.projectId)) continue;
    if (position.owner !== "studio") {
      if (position.owner) inMotion += 1;
      continue;
    }
    if (blockedProjectNames.has(position.projectName)) continue;
    // One card per obligation. An overdue balance already produced an exception
    // card that names the amount ("$6,265 overdue"); the journey's balance step
    // is the same debt again, and because journey cards are banded by the *event*
    // date it landed in "This fortnight" while its own copy read "Past its due
    // date — worth a nudge". The exception card says it better and bands it by
    // the date that is actually late.
    if (
      position.stepKey === "final_balance" &&
      position.projectId &&
      overdueInvoiceProjectIds.has(position.projectId)
    ) {
      continue;
    }
    if (
      position.stepKey === "coi" &&
      position.projectId &&
      coiCardProjectIds.has(position.projectId)
    ) {
      continue;
    }
    // The balance has its own card below (finalBalanceProjectIds): the same
    // debt once, with the buttons that settle it.
    if (position.stepKey === "final_balance" && finalBalanceProjectIds.has(position.projectId)) continue;
    // The couple's change request has its own card, with their words.
    if (position.stepKey === "run_of_show" && scheduleChangeProjectIds.has(position.projectId)) continue;
    // The planning form goes out when the studio's timeline says (six months
    // before, by default): a wedding a year away isn't asked yet.
    if (position.stepKey === "schedule_form") {
      const opensOn = planningFormOpensOn(eventFor(position.projectId), planningTimeline);
      if (opensOn && input.now.slice(0, 10) < opensOn) continue;
    }
    act.push({
      id: `journey-${position.projectId}`,
      lane: "act",
      // The step's own subject — a proposal step is violet, a run-of-show
      // step is blue — resolved through the alias table.
      kind: journeyStepKind(position),
      // Step titles are milestone names written in the past ("Gallery
      // delivered", "Crew confirmed") — correct on the journey rail beside a
      // tick, but read as an announcement that the thing is already done
      // when they head a to-do. The action is what is actually outstanding.
      title: `${position.projectName} — ${(position.actionLabel ?? position.stepTitle).toLowerCase()}`,
      detail: position.stepDetail,
      evidence: null,
      projectId: position.projectId,
      projectName: position.projectName,
      action:
        position.actionHref && position.actionLabel
          ? {
              kind: "link",
              label: position.actionLabel,
              href: position.actionHref,
            }
          : {
              kind: "link",
              label: "Open the job",
              href: `/studio/projects/${position.projectId}`,
            },
      jobHref: `/studio/projects/${position.projectId}`,
      facts: [
        eventFact(position.eventDate, now),
        position.deliveryDue ? `${position.deliveryDue.label} due ${formatDueDate(position.deliveryDue.date)}` : null,
        waitingFact(position.updatedAt, now),
      ].filter((fact): fact is string => Boolean(fact)),
      // By its own due date: late once it passes, "soon" in its last fortnight.
      band: position.deliveryDue
        ? bandFor({ eventDate: position.deliveryDue.date, dueDate: position.deliveryDue.date, now })
        : bandFor({
            eventDate: position.eventDate,
            graceDays: graceAfterEvent(position.state),
            now,
          }),
      eventDate: position.eventDate,
      score: score({
        lane: "act",
        severity: "step",
        eventDate: position.eventDate,
        updatedAt: position.updatedAt,
        now,
      }),
    });
  }

  // ── Act · setup that is blocking real work ─────────────────────────
  for (const gap of input.setupGaps ?? []) {
    if (!gap.blocking) continue;
    act.push({
      id: `setup-${gap.key}`,
      lane: "act",
      // Studio setup is about the studio, not about a record.
      kind: null,
      title: gap.title,
      detail: gap.detail,
      evidence: "One-time studio setup",
      projectId: null,
      projectName: gap.blockedProjectName,
      action: { kind: "link", label: gap.actionLabel, href: gap.href },
      jobHref: null,
      facts: gap.blockedProjectName ? [`blocking ${gap.blockedProjectName}`] : [],
      band: "overdue",
      eventDate: null,
      // Setup that blocks a job ranks with exceptions: work has stopped.
      score: score({ lane: "act", severity: "exception", now }),
    });
  }

  // ── Act · a step outside StudioCue that has run long ────────────────
  // Only steps the studio started: an application to Intuit that has had its
  // usual few days, a capture set up with nothing through yet, or a problem
  // the other company reported. A wait with no end in sight otherwise sat
  // silently on a settings card.
  for (const reminder of input.outsideStepReminders ?? []) {
    act.push({
      id: `outside-${reminder.stepId}`,
      lane: "act",
      kind: null,
      title: reminder.title,
      detail: reminder.detail,
      evidence: `Outside StudioCue · in ${reminder.where}`,
      projectId: null,
      projectName: null,
      action: { kind: "link", label: "Update the step", href: reminder.href },
      jobHref: null,
      facts: [],
      band: reminder.urgent ? "overdue" : "soon",
      eventDate: null,
      score: score({
        lane: "act",
        severity: reminder.urgent ? "exception" : "step",
        updatedAt: reminder.since,
        now,
      }),
    });
  }

  /**
   * Who a piece of prepared work is for.
   *
   * A draft prepared from an inquiry has no `projectId` yet — there is no job
   * until the lead is converted — so the project lookup returns nothing and
   * the card fell back to "Studio workflow". Every other card on Today names
   * the couple, so the one card about a brand-new potential client was the
   * only one that would not say who it was for. The action's own source
   * references carry the answer ("Inquiry from Hana Park"), and the AI review
   * screen was already using it.
   */
  const preparedFor = (action: TodayRecord): string => {
    const named = nameFor(text(action.projectId));
    if (named) return named;
    const references = Array.isArray(action.sourceReferences)
      ? action.sourceReferences
      : [];
    for (const reference of references) {
      if (!reference || typeof reference !== "object") continue;
      const entry = reference as Record<string, unknown>;
      const label = text(entry.label);
      if (label && text(entry.entityType) !== "tenant") return label;
    }
    return "Studio workflow";
  };

  // ── Approve · AI-prepared work ─────────────────────────────────────
  const briefCards = new Set<string>();
  for (const action of rows(input.aiActions)) {
    if (text(action.status) !== "review_required") continue;
    // Already on its inquiry's card, above.
    if (mergedReplies.has(action.id)) continue;
    // A payment reminder is sent from its bill's overdue card. With no such
    // card the bill is paid, voided or no longer late: nothing to send.
    if (text(asRecord(asRecord(action.structuredOutput).paymentReminder).invoiceId)) continue;
    // A proposal follow-up only while the proposal is still waiting on the
    // client: answered, withdrawn, replaced or expired since, it has nothing
    // to ask (functions/src/booking/proposal-follow-ups.ts withdraws it too).
    const followUpProposalId = text(asRecord(asRecord(action.structuredOutput).proposalFollowUp).proposalId);
    if (followUpProposalId) {
      const proposal = rows(input.proposals).find((row) => row.id === followUpProposalId);
      const open =
        proposal &&
        ["sent", "viewed"].includes(text(proposal.status)) &&
        text(proposal.expiresAt) > input.now;
      if (!open) continue;
    }
    // A follow-up only belongs on its couple's card, while they're still
    // quiet; anywhere else it is a nudge to someone who may have answered.
    if (text(action.capability) === "inquiry_follow_up") continue;
    if (staleInquiryDrafts.has(action.id)) continue;
    // A reply to an inquiry the studio closed — archived, lost, or marked
    // "not an inquiry" — must not wait to be approved and sent.
    if (inquiryDraftLeadClosed(action.sourceReferences, leadById)) continue;
    const snoozed = text(action.snoozedUntil);
    if (snoozed && snoozed > input.now) continue;
    if (!jobStillOpen(action.projectId)) continue;
    // "Ahead of our call" once the call has started: there is nothing ahead.
    if (
      text(action.capability) === "consultation_prep_draft" &&
      text(asRecord(action.structuredOutput).callStartsAt) &&
      text(asRecord(action.structuredOutput).callStartsAt) <= input.now
    )
      continue;
    // "The day before" once the day itself has gone. Judged by the date, not
    // the job's state: a studio that never marks the event done still left
    // Dana Reyes' checklist offering to send the morning after (2026-10-05).
    if (
      lifecycleTriggerOf({
        lifecycleTrigger: action.lifecycleTrigger,
        instructionVersion: action.instructionVersion,
        title: action.title,
      }) === "day_before_checklist" &&
      (calendarDayDiff(eventFor(action.projectId), now) ?? 0) < 0
    )
      continue;
    // A draft whose whole purpose was the run-up, on a job already shot.
    if (
      preparedWorkIsMoot({
        state: stateFor(action.projectId) ?? "",
        capability:
          text(action.capability) || text(action.assetType) || text(action.type),
      })
    ) {
      continue;
    }
    /**
     * A reply to an enquiry that has already become a client.
     *
     * Inquiry drafts carry no `projectId` — they belong to a lead — so nothing
     * about the job could ever retire them. One sat in "Prepared for you"
     * offering to reply to the original enquiry of a couple whose wedding had
     * since been booked, shot, delivered and closed.
     */
    if (
      inquiryDraftIsOrphaned({
        projectId: text(action.projectId),
        sourceReferences: action.sourceReferences,
        leadBecameAJob: (leadId) =>
          Boolean(text(leadById.get(leadId)?.projectId)),
      })
    ) {
      continue;
    }
    /**
     * Work the server won't approve as it stands — the AI picked no package,
     * or the package had no terms. "Approve" here was refused on every press
     * (GR, 2026-09-30). Send the studio to where the decision is made; the
     * booking pair is one card, "pick the packages", not two dead ends.
     */
    const issues = blockingIssues(action);
    if (issues.length) {
      const capability = text(action.capability);
      const projectId = text(action.projectId);
      const onBrief = BOOKING_BRIEF_CAPABILITIES.has(capability) && Boolean(projectId);
      // Once a proposal exists the question is answered; nothing to pick.
      if (onBrief && !["LEAD", "CONSULTATION"].includes(stateFor(action.projectId) ?? "")) continue;
      if (onBrief && briefCards.has(projectId)) continue;
      if (onBrief) briefCards.add(projectId);
      const who = (nameFor(action.projectId) ?? text(projectById.get(projectId)?.name)).replace(/\s+wedding$/i, "").trim();
      act.push({
        id: onBrief ? `ai-brief-${projectId}` : `ai-${action.id}`,
        lane: "act",
        kind: toneKindFor(capability || text(action.assetType) || text(action.type)),
        title: onBrief
          ? `Pick ${who ? `${who}'s` : "the"} packages for the proposal`
          : text(action.title) || "Prepared work needs you",
        detail: onBrief
          ? "StudioCue couldn't choose a package from the consultation. Pick one or more on the booking brief and it drafts the proposal."
          : issues.map((issue) => issue.message).filter(Boolean).join(" ") || "StudioCue needs a decision before this can go ahead.",
        evidence: "Cue prepared this — you decide",
        projectId: projectId || null,
        projectName: nameFor(action.projectId),
        action: {
          kind: "link",
          label: onBrief ? "Pick packages" : "Open",
          href: onBrief
            ? `/studio/booking?project=${projectId}`
            : projectId
              ? `/studio/projects/${projectId}`
              : "/studio/ai-queue",
        },
        jobHref: projectId ? `/studio/projects/${projectId}` : null,
        facts: [eventFact(eventFor(action.projectId), now), waitingFact(changedAt(action), now)].filter(
          (fact): fact is string => Boolean(fact),
        ),
        band: bandFor({ eventDate: eventFor(action.projectId), now }),
        eventDate: eventFor(action.projectId),
        score: score({ lane: "act", severity: "step", eventDate: eventFor(action.projectId), updatedAt: changedAt(action), now }),
      });
      continue;
    }
    approve.push({
      id: `ai-${action.id}`,
      lane: "approve",
      // What the draft is a draft *of* — the capability names it, except a
      // proposal follow-up, which is a delivery_message_draft about a
      // proposal and showed the gallery icon (prod walk, 2026-10-06).
      kind: followUpProposalId
        ? "proposal"
        : toneKindFor(text(action.capability) || text(action.assetType) || text(action.type)),
      title: text(action.title) || "Review prepared work",
      detail: preparedFor(action),
      evidence: "Cue prepared this — you decide",
      projectId: text(action.projectId) || null,
      projectName: nameFor(action.projectId),
      action: {
        kind: "approve",
        // Named by what the tap does: approving a client message sends it.
        label: dispatchesOnApproval({
          capability: text(action.capability) || null,
          downstreamCommandType: text(asRecord(action.downstreamCommand).commandType) || null,
          recipient: text(asRecord(action.structuredOutput).recipientEmail) || null,
          subject: text(asRecord(action.structuredOutput).subject) || null,
          body: text(asRecord(action.structuredOutput).body) || null,
        })
          ? "Approve & send"
          : "Approve",
        actionId: action.id,
        href: action.projectId ? `/studio/projects/${text(action.projectId)}` : "/studio",
        preview: previewOf(action.structuredOutput),
      },
      jobHref: action.projectId
        ? `/studio/projects/${text(action.projectId)}`
        : null,
      facts: [
        // "Ahead of our call": the call is what's close, not the wedding.
        text(action.capability) === "consultation_prep_draft" && text(asRecord(action.structuredOutput).subject).includes(" — ")
          ? `Call ${text(asRecord(action.structuredOutput).subject).split(" — ")[1]}`
          : null,
        eventFact(eventFor(action.projectId), now),
        waitingFact(changedAt(action), now),
      ].filter((fact): fact is string => Boolean(fact)),
      band: bandFor({ eventDate: eventFor(action.projectId), now }),
      eventDate: eventFor(action.projectId),
      score: score({
        lane: "approve",
        eventDate: eventFor(action.projectId),
        updatedAt: changedAt(action),
        now,
      }),
    });
  }

  const prepared = (item: {
    id: string;
    title: string;
    detail: string;
    kind?: LibraryKind | null;
    href: string;
    label: string;
    projectId?: unknown;
    updatedAt?: string | null;
    action?: TodayAction;
  }) => {
    if (item.projectId && !jobStillOpen(item.projectId)) return;
    approve.push({
      id: item.id,
      lane: "approve",
      kind: item.kind ?? null,
      title: item.title,
      detail: item.detail,
      evidence: "Cue prepared this — you decide",
      projectId: text(item.projectId) || null,
      projectName: nameFor(item.projectId),
      action: item.action ?? { kind: "link", label: item.label, href: item.href },
      jobHref: item.projectId
        ? `/studio/projects/${text(item.projectId)}`
        : null,
      facts: [
        eventFact(eventFor(item.projectId), now),
        waitingFact(item.updatedAt ?? null, now),
      ].filter((fact): fact is string => Boolean(fact)),
      band: bandFor({ eventDate: eventFor(item.projectId), now }),
      eventDate: eventFor(item.projectId),
      score: score({
        lane: "approve",
        eventDate: eventFor(item.projectId),
        updatedAt: item.updatedAt ?? null,
        now,
      }),
    });
  };

  for (const approval of rows(input.automationApprovals)) {
    if (text(approval.status) !== "pending") continue;
    prepared({
      id: `automation-approval-${approval.id}`,
      kind: "automation",
      title: `Approve ${readable(approval.actionType) || "a workflow step"}`,
      detail: nameFor(approval.projectId) ?? "Studio workflow",
      href: "/studio",
      label: "Review",
      projectId: approval.projectId,
      updatedAt: changedAt(approval),
      action: { kind: "automation", label: "Review", approvalId: approval.id },
    });
  }
  for (const draft of rows(input.communicationDrafts)) {
    const status = text(draft.status);
    if (!["needs_approval", "approved_unsent"].includes(status)) continue;
    prepared({
      id: `message-${draft.id}`,
      kind: "message",
      title:
        status === "approved_unsent"
          ? `Send: ${text(draft.subject) || "approved email"}`
          : `Approve: ${text(draft.subject) || "prepared email"}`,
      detail: nameFor(draft.projectId) ?? "Client email",
      href: "/studio/messages",
      label: status === "approved_unsent" ? "Send" : "Review",
      projectId: draft.projectId,
      updatedAt: changedAt(draft),
    });
  }
  for (const draft of rows(input.deliveryDrafts)) {
    if (text(draft.status) !== "review_required") continue;
    prepared({
      id: `delivery-${draft.id}`,
      kind: "delivery",
      // What arrived, by name: a film's notice read "Approve the gallery
      // delivery" (H4).
      title: `Release the ${(text(draft.label) || "gallery").toLowerCase()}`,
      detail: nameFor(draft.projectId) ?? "Delivery",
      href: `/studio/delivery?project=${text(draft.projectId)}`,
      label: "Review",
      projectId: draft.projectId,
      updatedAt: changedAt(draft),
    });
  }
  // ── Certificates of insurance (H3, docs/coi-automation-plan-2026-09-28.md) ─
  const coiSettings = rows(input.coiSettings)[0];
  const agentPhone = text(coiSettings?.agentPhone);
  for (const request of coiCards) {
    const status = text(request.status);
    const projectId = text(request.projectId);
    const href = `/studio/insurance?project=${encodeURIComponent(projectId)}`;
    const venue = text(request.venueName);
    const due = text(request.dueDate).slice(0, 10);
    if (request.escalatedAt && ["requested", "correction_required"].includes(status)) {
      // Chasing stopped: the studio picks up the phone.
      exception({
        id: `coi-escalated-${request.id}`,
        kind: "insurance",
        title: "Your agent hasn't sent the COI",
        detail: nameFor(projectId) ?? "Certificate of insurance",
        dueDate: due || null,
        extraFacts: [due ? `due ${formatDueDate(due)}` : null, agentPhone ? `Call ${agentPhone}` : null],
        href,
        projectId,
        projectName: nameFor(projectId),
        eventDate: eventFor(projectId),
        updatedAt: changedAt(request),
        label: "Open",
      });
    } else if (status === "needs_details") {
      exception({
        id: `coi-details-${request.id}`,
        kind: "insurance",
        title: "Confirm the venue's address for the COI",
        detail: nameFor(projectId) ?? "Certificate of insurance",
        dueDate: due || null,
        href,
        projectId,
        projectName: nameFor(projectId),
        eventDate: eventFor(projectId),
        updatedAt: changedAt(request),
        label: "Confirm",
      });
    } else if (status === "failed") {
      exception({
        id: `coi-failed-${request.id}`,
        kind: "insurance",
        title: "The COI didn't pass the safety check",
        detail: nameFor(projectId) ?? "Certificate of insurance",
        href,
        projectId,
        projectName: nameFor(projectId),
        eventDate: eventFor(projectId),
        updatedAt: changedAt(request),
        label: "Open",
      });
    } else {
      prepared({
        id: `coi-${status}-${request.id}`,
        kind: "insurance",
        title:
          status === "prepared"
            ? "Send the COI request to your agent"
            : status === "self_serve"
              ? "Generate the COI in your insurer's portal"
              : status === "approved"
                ? "Send the approved COI to the venue"
                : `COI ready${venue ? ` for ${venue}` : ""} — check it and send`,
        detail: nameFor(projectId) ?? "Certificate of insurance",
        href,
        label: status === "prepared" ? "Review and send" : status === "self_serve" ? "Open" : "Review",
        projectId,
        updatedAt: changedAt(request),
      });
    }
  }
  // A job that needs a certificate and a studio that hasn't said who sends
  // them: once, not per job.
  if (!coiSettings) {
    const needing = rows(input.projects).find(
      (project) =>
        project.insuranceRequired === "required" &&
        ["BOOKED", "PLANNING", "READY"].includes(text(project.state)) &&
        jobStillOpen(project.id),
    );
    if (needing) {
      prepared({
        id: "coi-setup",
        kind: "insurance",
        title: "Save who sends your certificates of insurance",
        detail: `${nameFor(needing.id) ?? "A booked job"} needs one — StudioCue can ask for it and follow up`,
        href: "/studio/settings/insurance",
        label: "Set up",
        projectId: needing.id,
        updatedAt: changedAt(needing),
      });
    }
  }

  for (const proposal of rows(input.proposals)) {
    if (text(proposal.status) !== "internal_review") continue;
    prepared({
      id: `proposal-${proposal.id}`,
      kind: "proposal",
      title: "Approve the prepared proposal",
      detail: nameFor(proposal.projectId) ?? "Client offer",
      href: `/studio/proposals/${proposal.id}`,
      label: "Review",
      projectId: proposal.projectId,
      updatedAt: changedAt(proposal),
    });
  }

  // ── FYI · the engines already acted ────────────────────────────────
  for (const receipt of rows(input.actionReceipts)) {
    if (text(receipt.status) !== "completed") continue;
    fyi.push({
      id: `receipt-${receipt.id}`,
      lane: "fyi",
      kind: toneKindFor(text(receipt.type) || text(receipt.kind)),
      title: text(receipt.title) || "Handled for you",
      detail: text(receipt.summary) || nameFor(receipt.projectId) || "",
      evidence: "Verified by provider evidence",
      projectId: text(receipt.projectId) || null,
      projectName: nameFor(receipt.projectId),
      action: { kind: "none", label: "Done for you" },
      jobHref: receipt.projectId
        ? `/studio/projects/${text(receipt.projectId)}`
        : null,
      facts: [],
      band: "later",
      eventDate: null,
      score: score({ lane: "fyi", updatedAt: changedAt(receipt), now }),
    });
  }

  act.sort(byScore);
  approve.sort(byScore);
  fyi.sort(byScore);

  // What's coming up is what the studio has won: an inquiry's date is a
  // question the couple asked, not an event on the books.
  const upcoming = (input.journeys ?? [])
    .filter((position) => !preBookingStates.has(position.state))
    .map((position) => ({
      projectId: position.projectId,
      name: position.projectName,
      eventDate: position.eventDate ?? "",
      inDays:
        calendarDayDiff(position.eventDate, now) ?? Number.MAX_SAFE_INTEGER,
    }))
    .filter((event) => event.eventDate && event.inDays >= 0)
    .sort((left, right) => left.inDays - right.inDays)
    .slice(0, 4);

  maybeInquiries.sort((left, right) =>
    (right.arrivedAt ?? "").localeCompare(left.arrivedAt ?? ""),
  );

  return {
    act,
    approve,
    fyi,
    maybeInquiries,
    upcoming,
    inMotion,
    summary: todaySummary({
      act: act.length,
      approve: approve.length,
      inMotion,
    }),
  };
}

/**
 * The one-line state of the studio.
 *
 * Exported and recomputed by the UI from what is actually on screen: when a
 * card is approved in place it disappears, and this line must move with it
 * rather than describing a queue the user can no longer see.
 */
export function todaySummary(counts: {
  act: number;
  approve: number;
  inMotion: number;
}): string {
  const waiting = counts.act + counts.approve;
  if (!waiting)
    return counts.inMotion
      ? `Nothing needs you. ${counts.inMotion} ${counts.inMotion === 1 ? "job is" : "jobs are"} in motion — everything is with a client, a provider, or not due yet.`
      : "Nothing needs you right now.";
  // The heading already states the total; this adds the breakdown.
  return `${[
    counts.act ? `${counts.act} only you can do` : null,
    counts.approve ? `${counts.approve} ready to approve` : null,
    counts.inMotion ? `${counts.inMotion} in motion` : null,
  ]
    .filter(Boolean)
    .join(" · ")}.`;
}

/**
 * What StudioCue did for the studio in the last seven days.
 *
 * The product's promise is that work happens without the photographer
 * touching it. That promise is invisible unless it is counted, so this is
 * the one number on Today that exists to be felt rather than acted on.
 * Only genuinely completed work counts — never queued or attempted.
 */
export function handledThisWeek(
  input: {
    actionReceipts?: TodayRecord[] | null;
    automationRuns?: TodayRecord[] | null;
    emailJobs?: TodayRecord[] | null;
  },
  now: Date,
): number {
  const since = new Date(now.valueOf() - 7 * 86_400_000).toISOString();
  const done = (record: TodayRecord, states: string[]) => {
    if (!states.includes(text(record.status))) return false;
    const at = changedAt(record);
    return Boolean(at && at >= since);
  };
  return (
    rows(input.actionReceipts).filter((row) => done(row, ["completed"])).length +
    rows(input.automationRuns).filter((row) => done(row, ["succeeded"])).length +
    rows(input.emailJobs).filter((row) => done(row, ["sent", "delivered"]))
      .length
  );
}

/**
 * The value of work the studio has actually won.
 *
 * homeMetrics' bookedValueCents sums invoices, which answers "what have I
 * billed", not "what have I booked" — a studio with nine weddings and one
 * deposit invoice would see a number smaller than a single job. This sums
 * what each project from the signed agreement onward is worth (jobValueCents:
 * the accepted proposal's total, else every package on the job), which is the
 * number a photographer means.
 */
const BOOKED_STATES = new Set([
  "BOOKED",
  "PLANNING",
  "READY",
  "EVENT_COMPLETE",
  "POST_PRODUCTION",
  "DELIVERED",
  "REVIEW_REQUESTED",
  "CLOSED",
]);

export function bookedValueCents(input: {
  projects?: TodayRecord[] | null;
  packageSnapshots?: TodayRecord[] | null;
  /**
   * The accepted proposal's combined total is what was won; without it the
   * figure is every package on the job, never the primary alone (a photo +
   * video wedding counted as its photo package).
   */
  proposals?: TodayRecord[] | null;
}): number {
  return rows(input.projects)
    .filter((project) => BOOKED_STATES.has(text(project.state)))
    .reduce(
      (sum, project) =>
        sum +
        (jobValueCents({
          project,
          snapshots: input.packageSnapshots,
          proposals: input.proposals,
        }) ?? 0),
      0,
    );
}
