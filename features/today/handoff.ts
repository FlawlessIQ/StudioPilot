import { clientRef, jobKindOf } from "@/features/job-kinds/job-kinds";

/**
 * The morning handoff on Today: "Since yesterday, Cue handled 7 things. 4 need
 * you." (docs/positioning-office-manager-plan-2026-10-06.md, "In the product").
 *
 * "Handled" means an email went out in the last day that nobody at the studio
 * set off: a scheduler, or a client's own action (signing, booking a call,
 * paying), queued it and the worker sent it. Anything a person sent, approved,
 * retried or chose to raise is the studio's act, not Cue's, and is left out.
 *
 * The allowlist below is deliberately explicit. Every entry names a type that
 * was checked against the code that queues it (functions/src/...), and where
 * the same type is also sent by hand, the rule that tells the two apart. A
 * type missing here is not counted, which undercounts rather than claims work
 * Cue did not do.
 *
 * Pure: the caller passes `now` and the records Today has already read.
 */

export type HandoffRecord = Record<string, unknown> & { id: string };

export type HandoffItem = {
  /** The email job's id (the primary one, for a partner's copy). */
  id: string;
  /** One line, past tense, Cue as the unspoken subject. */
  line: string;
  /** When it went out (ISO). */
  at: string;
  projectId: string | null;
  href: string | null;
};

export type HandoffInput = {
  now: Date | string;
  /** Recent email jobs (the caller reads the last two days by `createdAt`). */
  emailJobs?: HandoffRecord[] | null;
  projects?: HandoffRecord[] | null;
  leads?: HandoffRecord[] | null;
  invoiceReferences?: HandoffRecord[] | null;
  insuranceRequests?: HandoffRecord[] | null;
  questionnaireResponses?: HandoffRecord[] | null;
  consultations?: HandoffRecord[] | null;
  bookingOrchestrations?: HandoffRecord[] | null;
  crewAssignments?: HandoffRecord[] | null;
  aiActions?: HandoffRecord[] | null;
};

/** How far back "since yesterday" reaches: the last 24 hours. */
export const HANDOFF_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * How far back to *read*. Jobs are read by `createdAt` (the indexed field);
 * one queued before the window can still have gone out inside it, so the read
 * reaches a day further and `completedAt` decides.
 */
export const HANDOFF_READ_MS = 2 * HANDOFF_WINDOW_MS;

export function handoffReadSince(now: Date | string): string {
  return new Date(new Date(now).valueOf() - HANDOFF_READ_MS).toISOString();
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const rows = (value: HandoffRecord[] | null | undefined): HandoffRecord[] => value ?? [];

/** Delivery statuses that mean it never reached anyone (sendgrid-events.ts). */
const UNDELIVERED = new Set(["bounce", "blocked", "dropped", "spamreport"]);

/** Who set off an invoice email: the automatic paths only. */
const AUTOMATIC_INVOICE_AUTHORS = new Set([
  // The retainer raised after the client signs (booking/orchestration.ts).
  "booking-orchestrator",
  // The final bill 28 days out (operations/invoice-scheduler.ts).
  "final-invoice-scheduler",
]);

/** A consultation the client booked themselves (booking/public-scheduling.ts). */
const CLIENT_BOOKED_CONSULTATION = new Set(["public-consultation-scheduler", "couple"]);

/** The details form sent with nobody pressing Send (planning/planning-form-scheduler.ts). */
const AUTOMATIC_FORM_AUTHORS = new Set(["booking-orchestrator", "planning-form-scheduler"]);

const LIFECYCLE_LINES: Record<string, (client: string) => string> = {
  schedule_confirmation: (client) => `Sent ${client} their schedule to confirm`,
  final_invoice_notice: (client) => `Gave ${client} a heads-up on the final invoice`,
  day_before_checklist: (client) => `Sent ${client} the day-before checklist`,
};

type Lookup = {
  job: HandoffRecord;
  primaryId: string;
  client: string;
  byId: (collection: keyof Omit<HandoffInput, "now" | "emailJobs">, id: string) => HandoffRecord | null;
};

/**
 * The allowlist: email type → the line, or null when this particular send was
 * a person's doing (or can't be shown not to be).
 */
const HANDLED: Record<string, (lookup: Lookup) => string | null> = {
  // Sent the moment a form inquiry arrives (crm/public-lead.ts).
  inquiry_acknowledgement: ({ job, byId, client }) => {
    const lead = byId("leads", text(job.leadId));
    const name = text(lead?.displayName) || (text(job.projectId) ? client : "");
    return name ? `Thanked ${name} for their inquiry` : "Thanked a new inquiry for getting in touch";
  },
  // The client booked a call from their link; the studio booking one by hand
  // (booking/commands.ts) is the studio's act.
  consultation_confirmation: ({ job, byId, client }) => {
    const consultation = byId("consultations", text(job.consultationId));
    return CLIENT_BOOKED_CONSULTATION.has(text(consultation?.createdBy))
      ? `Confirmed the call ${client} booked`
      : null;
  },
  // contracts/reminders.ts.
  contract_reminder: ({ client }) => `Reminded ${client} to sign their agreement`,
  // The signed copy, made after the client signs (contracts/seal.ts).
  contract_signed: ({ client }) => `Sent ${client} their signed agreement`,
  // Only the orchestrator's retainer and the scheduler's final bill; one the
  // studio raised or sent by hand is theirs.
  retainer_invoice: ({ job, byId, client }) =>
    AUTOMATIC_INVOICE_AUTHORS.has(text(byId("invoiceReferences", text(job.invoiceId))?.createdBy))
      ? `Sent ${client} their retainer invoice`
      : null,
  final_invoice: ({ job, byId, client }) =>
    AUTOMATIC_INVOICE_AUTHORS.has(text(byId("invoiceReferences", text(job.invoiceId))?.createdBy))
      ? `Sent ${client} their final invoice`
      : null,
  // Booked by the orchestrator once the agreement and payment landed. A
  // booking the studio confirmed by hand leaves the plan short of completed.
  booking_confirmation: ({ job, byId, client }) =>
    text(byId("bookingOrchestrations", text(job.projectId))?.status) === "completed"
      ? `Confirmed ${client}'s booking`
      : null,
  // The form at booking, or the scheduler's "look it over again".
  questionnaire_request: ({ job, primaryId, byId, client }) => {
    if (text(job.variant) === "review") return `Asked ${client} to look over their form again`;
    const responseId = primaryId.startsWith("questionnaire_request_")
      ? primaryId.slice("questionnaire_request_".length)
      : "";
    return AUTOMATIC_FORM_AUTHORS.has(text(byId("questionnaireResponses", responseId)?.createdBy))
      ? `Sent ${client} their details form`
      : null;
  },
  // planning/questionnaire-reminder-scheduler.ts.
  questionnaire_reminder: ({ client }) => `Reminded ${client} about their form`,
  // planning/final-details.ts.
  final_details_request: ({ client }) => `Asked ${client} to sign off on the final details`,
  // The scheduler's sends carry the outreach guard; "Ask them" does not
  // (billing/billing-address-request.ts).
  billing_address_request: ({ job, client }) =>
    job.clientOutreachGuard === true ? `Asked ${client} for a billing address` : null,
  // billing/autopay.ts, after the scheduler charges a saved card.
  autopay_charged: ({ client }) => `Charged ${client}'s saved card and sent the receipt`,
  autopay_charge_failed: ({ client }) => `Told ${client} their card was declined`,
  // communications/event-reminders.ts.
  event_reminder: ({ client }) => `Sent ${client} their week-before note`,
  crew_reminder: ({ job, client }) => {
    const name = text(job.recipientName);
    return name ? `Reminded ${name} of their call time for ${client}` : `Reminded the crew of their call time for ${client}`;
  },
  // Only the re-offer made when the last offer ran out (crew/commands.ts,
  // crewCascadeExpiryScheduler). The first offer is the studio's.
  crew_invitation: ({ job, byId, client }) => {
    if (!text(job.cascadeId)) return null;
    const assignment = byId("crewAssignments", text(job.assignmentId));
    if (text(assignment?.createdBy) !== "crew-cascade-expiry") return null;
    const name = text(job.recipientName);
    return `Offered ${client} to ${name || "the next crew member"} when the last offer ran out`;
  },
  // A chase (planning/coi-chase-scheduler.ts), or the first request made by
  // the automation rather than approved by the studio (coi/automation.ts).
  coi_request: ({ job, byId, client }) => {
    if (Number(job.chaseNumber ?? 0) > 0) return `Chased your insurance agent for ${client}'s certificate`;
    const request = byId("insuranceRequests", text(job.requestId));
    return request?.autoCreated === true && !text(request.approvedToSendBy)
      ? `Asked your insurance agent for ${client}'s certificate`
      : null;
  },
  // post-event/jobs.ts.
  review_request: ({ client }) => `Asked ${client} for a review`,
  album_selection_reminder: ({ client }) => `Reminded ${client} to pick their album photos`,
  delivery_expiry_reminder: ({ client }) => `Told ${client} their gallery closes soon`,
  // Lifecycle messages under the studio's auto-send setting
  // (communications/lifecycle-scheduler.ts) and "Ahead of our call" sent
  // automatically (booking/consultation-prep.ts). Every other manual_message
  // is a person's.
  manual_message: ({ primaryId, job, byId, client }) => {
    if (primaryId.startsWith("consultation_prep_email_")) return `Sent ${client} "Ahead of our call"`;
    if (!primaryId.startsWith("lifecycle_email_")) return null;
    const trigger = text(record(byId("aiActions", text(job.aiActionId))?.structuredOutput).trigger);
    return LIFECYCLE_LINES[trigger]?.(client) ?? `Sent ${client} a scheduled note`;
  },
};

/** The email types the handoff counts, for the record and the tests. */
export const HANDOFF_EMAIL_TYPES: readonly string[] = Object.keys(HANDLED);

/** Whether a person sent this one, whatever its type. */
function sentByAPerson(job: HandoffRecord): boolean {
  return Boolean(
    text(job.requestedBy) ||
      text(job.approvedBy) ||
      text(job.retriedBy) ||
      // A workflow's send_email step (automation/runtime.ts): its template is
      // whatever the studio configured, so it is not on this list's terms.
      text(job.automationRunId),
  );
}

/** What Cue handled in the last day, newest first. */
export function cueHandoff(input: HandoffInput): HandoffItem[] {
  const now = new Date(input.now).valueOf();
  const since = new Date(now - HANDOFF_WINDOW_MS).toISOString();
  const until = new Date(now).toISOString();
  const indexes = new Map<string, Map<string, HandoffRecord>>();
  const byId: Lookup["byId"] = (collection, id) => {
    if (!id) return null;
    let index = indexes.get(collection);
    if (!index) {
      index = new Map(rows(input[collection]).map((row) => [row.id, row]));
      indexes.set(collection, index);
    }
    return index.get(id) ?? null;
  };

  const seen = new Set<string>();
  const items: HandoffItem[] = [];
  for (const job of rows(input.emailJobs)) {
    // The worker marks a sent job `succeeded` (operations/jobs.ts finish);
    // a send held at the last moment also succeeds, with `result.held`.
    if (text(job.status) !== "succeeded") continue;
    if (record(job.result).held) continue;
    if (UNDELIVERED.has(text(job.deliveryStatus))) continue;
    const at = text(job.completedAt);
    if (!at || at < since || at > until) continue;
    if (sentByAPerson(job)) continue;
    const describe = HANDLED[text(job.type)];
    if (!describe) continue;
    // A partner's copy is the same act as the primary send: count it once.
    const primaryId = text(job.partnerOfEmailJobId) || job.id;
    if (seen.has(primaryId)) continue;
    const projectId = text(job.projectId) || null;
    const project = projectId ? byId("projects", projectId) : null;
    const client = clientRef(project?.name, jobKindOf(project));
    const line = describe({ job, primaryId, client, byId });
    if (!line) continue;
    seen.add(primaryId);
    items.push({
      id: primaryId,
      line,
      at,
      projectId,
      href: projectId ? `/studio/projects/${projectId}` : null,
    });
  }
  return items.sort((left, right) => right.at.localeCompare(left.at));
}

/**
 * The line itself. `needYou` is Today's own count of what waits on the
 * studio (act + approve), never a second opinion of it.
 */
export function handoffHeadline(
  handled: number,
  needYou: number,
  options: { short?: boolean } = {},
): string {
  const things = `${handled} ${handled === 1 ? "thing" : "things"}`;
  // The phone's one line drops "Since yesterday": cut by an ellipsis, it was
  // the "need you" half that went, which is the half that matters.
  const did = options.short ? `Cue handled ${things}.` : `Since yesterday, Cue handled ${things}.`;
  const waits =
    needYou === 0 ? "Nothing needs you." : `${needYou} ${needYou === 1 ? "needs" : "need"} you.`;
  return `${did} ${waits}`;
}

/** "9:14 AM", or "Yesterday 4:02 PM" for anything before today's midnight. */
export function handoffWhen(at: string, now: Date | string, timeZone?: string): string {
  const options = { timeZone } as const;
  const day = new Intl.DateTimeFormat("en-CA", { ...options, year: "numeric", month: "2-digit", day: "2-digit" });
  const time = new Intl.DateTimeFormat("en-US", { ...options, hour: "numeric", minute: "2-digit" }).format(new Date(at));
  return day.format(new Date(at)) === day.format(new Date(now)) ? time : `Yesterday ${time}`;
}
