/**
 * Today — the studio's inbox of moments, as a deterministic engine.
 *
 * Phase 1 of the "Today & Jobs" design. The home screen stops being a
 * dashboard of collections and becomes a queue of things that need the
 * photographer, in three lanes that answer one question each:
 *
 *   act     — only you can do this (an inquiry, an exception, a job whose
 *             next step is yours)
 *   approve — StudioCue prepared it; one tap releases it
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

export type TodayLane = "act" | "approve" | "fyi";

export type TodayAction =
  /** Navigate to the surface that completes the moment. */
  | { kind: "link"; label: string; href: string }
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
};

export type TodayUpcomingEvent = {
  projectId: string;
  name: string;
  eventDate: string;
  inDays: number;
};

export type TodayInbox = {
  act: TodayItem[];
  approve: TodayItem[];
  fyi: TodayItem[];
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
};

export type TodayInput = {
  now: string;
  leads?: TodayRecord[] | null;
  tasks?: TodayRecord[] | null;
  aiActions?: TodayRecord[] | null;
  automationApprovals?: TodayRecord[] | null;
  communicationDrafts?: TodayRecord[] | null;
  deliveryDrafts?: TodayRecord[] | null;
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
   * Studio setup that isn't done. Only the gaps that block real work reach
   * Today — an empty studio is new, not broken.
   */
  setupGaps?: SetupGap[] | null;
};

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";
const rows = (records?: TodayRecord[] | null) => records ?? [];

const BRANDS: Record<string, string> = {
  quickbooks: "QuickBooks",
  docusign: "DocuSign",
  dropbox_sign: "Dropbox Sign",
  google_calendar: "Google Calendar",
  sendgrid: "SendGrid",
  zoom: "Zoom",
  dropbox: "Dropbox",
  stripe: "Stripe",
};

/** Brand names keep their own capitalisation; everything else title-cases. */
const readable = (value: unknown) =>
  BRANDS[text(value).toLowerCase()] ??
  text(value)
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

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
 * Within Act, an exception (something already went wrong) outranks a job
 * step (something is merely waiting on you), which outranks a fresh
 * inquiry only when the event is closer — proximity does that work.
 */
const severityBonus = { exception: 200, inquiry: 100, step: 0 } as const;

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

const dayDiff = (iso: string | null | undefined, now: Date): number | null => {
  if (!iso) return null;
  const parsed = Date.parse(iso.length <= 10 ? `${iso}T12:00:00Z` : iso);
  if (!Number.isFinite(parsed)) return null;
  return Math.round((parsed - now.valueOf()) / 86_400_000);
};

/** "Oct 9, 2027 · in 14 months" — the date, and what it means. */
function eventFact(eventDate: string | null | undefined, now: Date): string | null {
  const days = dayDiff(eventDate, now);
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
  if (days <= 60) return `${label} · in ${days}d`;
  return `${label} · in ${Math.round(days / 30)} months`;
}

/** "waiting 3 days" — silence is the thing that costs money. */
function waitingFact(updatedAt: string | null | undefined, now: Date): string | null {
  const days = dayDiff(updatedAt, now);
  if (days === null || days > 0) return null;
  const waited = Math.abs(days);
  if (waited < 1) return null;
  return `waiting ${waited} ${waited === 1 ? "day" : "days"}`;
}

const bandFor = (input: {
  eventDate?: string | null;
  dueDate?: string | null;
  overdue?: boolean;
  now: Date;
}): TodayBand => {
  if (input.overdue) return "overdue";
  const due = dayDiff(input.dueDate, input.now);
  if (due !== null && due < 0) return "overdue";
  const days = dayDiff(input.eventDate, input.now);
  if (days !== null && days <= 14) return "soon";
  return "later";
};

const currency = (cents: unknown) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(cents ?? 0) / 100);

export function todayInbox(input: TodayInput): TodayInbox {
  const now = new Date(input.now);
  const today = input.now.slice(0, 10);
  const act: TodayItem[] = [];
  const approve: TodayItem[] = [];
  const fyi: TodayItem[] = [];

  // ── Act · inquiries ────────────────────────────────────────────────
  for (const lead of rows(input.leads)) {
    const status = text(lead.status).toLowerCase();
    if (["converted", "lost", "archived"].includes(status)) continue;
    const name =
      text(lead.displayName) ||
      `${text(lead.firstName)} ${text(lead.lastName)}`.trim();
    const facts = [
      readable(lead.eventType),
      text(lead.eventDate),
      text(lead.venue) || text(lead.city),
    ].filter(Boolean);
    const leadEvent = text(lead.eventDate) || null;
    act.push({
      id: `lead-${lead.id}`,
      lane: "act",
      // A nameless inquiry is titled once, not "New inquiry — New inquiry".
      title: name ? `New inquiry — ${name}` : "New inquiry",
      detail: facts.join(" · ") || "Waiting on your first reply",
      evidence: "From your inquiry form",
      projectId: null,
      projectName: null,
      action: {
        kind: "link",
        label: "Review & reply",
        href: `/studio/leads/${lead.id}`,
      },
      jobHref: null,
      facts: [
        eventFact(leadEvent, now),
        readable(lead.eventType) || null,
        waitingFact(changedAt(lead), now),
      ].filter((fact): fact is string => Boolean(fact)),
      band: bandFor({ eventDate: leadEvent, now }),
      eventDate: leadEvent,
      score: score({
        lane: "act",
        severity: "inquiry",
        eventDate: text(lead.eventDate) || null,
        updatedAt: changedAt(lead),
        now,
      }),
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
  }) => {
    act.push({
      id: item.id,
      lane: "act",
      title: item.title,
      detail: item.detail,
      evidence: "StudioCue stopped safely — this one needs you",
      projectId: item.projectId ?? null,
      projectName: item.projectName ?? null,
      action: {
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
  const nameFor = (projectId: unknown) =>
    journeyById.get(text(projectId))?.projectName ?? null;
  const eventFor = (projectId: unknown) =>
    journeyById.get(text(projectId))?.eventDate ?? null;

  for (const task of rows(input.tasks)) {
    const due = text(task.dueAt ?? task.dueDate).slice(0, 10);
    const done = ["complete", "completed", "cancelled"].includes(
      text(task.status),
    );
    if (!due || due >= today || done) continue;
    exception({
      id: `task-${task.id}`,
      title: text(task.title) || "Overdue task",
      detail: nameFor(task.projectId) ?? "Studio task",
      dueDate: due,
      extraFacts: [`was due ${due}`],
      href: task.projectId
        ? `/studio/projects/${text(task.projectId)}`
        : "/studio/tasks",
      projectId: text(task.projectId) || null,
      projectName: nameFor(task.projectId),
      eventDate: eventFor(task.projectId),
      updatedAt: changedAt(task),
      label: "Open",
    });
  }

  for (const invoice of rows(input.invoiceReferences)) {
    // A missing due date is not an overdue date.
    const due = text(invoice.dueDate).slice(0, 10);
    const balance = Number(invoice.balanceCents ?? 0);
    if (
      balance <= 0 ||
      !due ||
      due >= today ||
      ["voided", "refunded", "paid"].includes(text(invoice.status))
    )
      continue;
    exception({
      id: `invoice-${invoice.id}`,
      title: "Balance overdue",
      detail: nameFor(invoice.projectId) ?? "Client balance",
      dueDate: due,
      extraFacts: [currency(balance), `due ${due}`],
      href: "/studio/invoices",
      projectId: text(invoice.projectId) || null,
      projectName: nameFor(invoice.projectId),
      eventDate: eventFor(invoice.projectId),
      updatedAt: changedAt(invoice),
      amountCents: balance,
      label: "Chase payment",
    });
  }

  for (const cascade of rows(input.crewCascades)) {
    if (text(cascade.status) !== "exhausted") continue;
    exception({
      id: `cascade-${cascade.id}`,
      title: `No one accepted ${text(cascade.role) || "the crew role"}`,
      detail: `${nameFor(cascade.projectId) ?? "Event"} · every candidate declined or expired`,
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
      ? plan.blockers.map((value) => readable(value)).join(", ")
      : "";
    exception({
      id: `booking-${plan.id}`,
      title: "Booking stopped for a reason",
      detail: `${nameFor(plan.projectId) ?? "Project"}${blockers ? ` · ${blockers}` : ""}`,
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
      title: "An automation could not finish",
      detail: `${nameFor(run.projectId) ?? "Studio"} · ${readable(run.status)}`,
      href: "/studio/automations",
      projectId: text(run.projectId) || null,
      projectName: nameFor(run.projectId),
      updatedAt: changedAt(run),
    });
  for (const job of rows(input.providerJobs).filter(failed))
    exception({
      id: `provider-${job.id}`,
      title: "A provider step could not finish",
      detail: `${nameFor(job.projectId) ?? "Studio"} · ${readable(job.type) || readable(job.status)}`,
      href: "/studio/integrations",
      projectId: text(job.projectId) || null,
      projectName: nameFor(job.projectId),
      updatedAt: changedAt(job),
    });
  for (const job of rows(input.emailJobs).filter(failed))
    exception({
      id: `email-${job.id}`,
      title: "An email did not send",
      detail: `${nameFor(job.projectId) ?? "Studio"} · ${readable(job.type)}`,
      href: "/studio/messages",
      projectId: text(job.projectId) || null,
      projectName: nameFor(job.projectId),
      updatedAt: changedAt(job),
    });
  for (const connection of rows(input.integrationConnections)) {
    if (text(connection.status) !== "error" && !connection.lastError) continue;
    exception({
      id: `connection-${connection.id}`,
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
  let inMotion = 0;
  for (const position of input.journeys ?? []) {
    if (position.owner !== "studio") {
      if (position.owner) inMotion += 1;
      continue;
    }
    if (blockedProjectNames.has(position.projectName)) continue;
    act.push({
      id: `journey-${position.projectId}`,
      lane: "act",
      title: `${position.projectName} — ${position.stepTitle.toLowerCase()}`,
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
        waitingFact(position.updatedAt, now),
      ].filter((fact): fact is string => Boolean(fact)),
      band: bandFor({ eventDate: position.eventDate, now }),
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

  // ── Approve · AI-prepared work ─────────────────────────────────────
  for (const action of rows(input.aiActions)) {
    if (text(action.status) !== "review_required") continue;
    const snoozed = text(action.snoozedUntil);
    if (snoozed && snoozed > input.now) continue;
    approve.push({
      id: `ai-${action.id}`,
      lane: "approve",
      title: text(action.title) || "Review prepared work",
      detail: nameFor(action.projectId) ?? "Studio workflow",
      evidence: "StudioCue prepared this — you decide",
      projectId: text(action.projectId) || null,
      projectName: nameFor(action.projectId),
      action: {
        kind: "approve",
        label: "Approve",
        actionId: action.id,
        href: "/studio/ai-queue",
        preview: previewOf(action.structuredOutput),
      },
      jobHref: action.projectId
        ? `/studio/projects/${text(action.projectId)}`
        : null,
      facts: [
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
    href: string;
    label: string;
    projectId?: unknown;
    updatedAt?: string | null;
  }) => {
    approve.push({
      id: item.id,
      lane: "approve",
      title: item.title,
      detail: item.detail,
      evidence: "StudioCue prepared this — you decide",
      projectId: text(item.projectId) || null,
      projectName: nameFor(item.projectId),
      action: { kind: "link", label: item.label, href: item.href },
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
      title: `Approve ${readable(approval.actionType) || "a workflow step"}`,
      detail: nameFor(approval.projectId) ?? "Studio workflow",
      href: "/studio/ai-queue",
      label: "Review",
      projectId: approval.projectId,
      updatedAt: changedAt(approval),
    });
  }
  for (const draft of rows(input.communicationDrafts)) {
    const status = text(draft.status);
    if (!["needs_approval", "approved_unsent"].includes(status)) continue;
    prepared({
      id: `message-${draft.id}`,
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
      title: "Approve the gallery delivery",
      detail: nameFor(draft.projectId) ?? "Delivery",
      href: `/studio/delivery?project=${text(draft.projectId)}`,
      label: "Review",
      projectId: draft.projectId,
      updatedAt: changedAt(draft),
    });
  }
  for (const proposal of rows(input.proposals)) {
    if (text(proposal.status) !== "internal_review") continue;
    prepared({
      id: `proposal-${proposal.id}`,
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

  const upcoming = (input.journeys ?? [])
    .map((position) => ({
      projectId: position.projectId,
      name: position.projectName,
      eventDate: position.eventDate ?? "",
      inDays: dayDiff(position.eventDate, now) ?? Number.MAX_SAFE_INTEGER,
    }))
    .filter((event) => event.eventDate && event.inDays >= 0)
    .sort((left, right) => left.inDays - right.inDays)
    .slice(0, 4);

  return {
    act,
    approve,
    fyi,
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
