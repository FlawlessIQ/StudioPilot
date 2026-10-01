/**
 * One studio's history as a single stream (docs/console.md, "Timeline").
 *
 * Audit events, product events, feedback, Stripe invoices and the team's own
 * notes and tasks each live in their own collection. The record page reads
 * each, and this merges them newest first with a plain label per entry. Pure;
 * tests/console-timeline.test.ts pins the labels and the order.
 */
import type { Tone } from "./model";

export type TimelineKind = "billing" | "email" | "feedback" | "note" | "task" | "system" | "product" | "team" | "lifecycle";

export const TIMELINE_KIND_LABELS: Record<TimelineKind, string> = {
  billing: "Billing",
  email: "Email",
  feedback: "Feedback",
  note: "Note",
  task: "Task",
  system: "System",
  product: "Activity",
  team: "Team",
  lifecycle: "Lifecycle",
};

export const TIMELINE_KIND_TONES: Record<TimelineKind, Tone> = {
  billing: "info",
  email: "neutral",
  feedback: "accent",
  note: "warn",
  task: "neutral",
  system: "neutral",
  product: "ok",
  team: "accent",
  lifecycle: "ok",
};

export type TimelineEntry = {
  key: string;
  at: string;
  kind: TimelineKind;
  title: string;
  detail?: string | null;
  tone?: Tone;
  href?: string | null;
  pinned?: boolean;
};

type Raw = Record<string, unknown>;
const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);

function humanize(value: string): string {
  const spaced = value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_.-]+/g, " ").trim().toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** What the team did, in the past tense, from `platform.<command>`. */
const CONSOLE_ACTIONS: Record<string, string> = {
  extendTrial: "Trial extended",
  setComp: "Comp changed",
  changePlan: "Plan changed",
  setCancelAtPeriodEnd: "Cancellation changed",
  applyDiscount: "Discount applied",
  removeDiscount: "Discount removed",
  sendCardUpdateLink: "Card-update link sent",
  syncSubscription: "Subscription synced from Stripe",
  emailStudio: "Team emailed the owner",
  suspendTenant: "Studio suspended",
  unsuspendTenant: "Studio unsuspended",
  grantSupportAccess: "Support session started",
  revokeSupportAccess: "Support session revoked",
  setStudioFeature: "Feature access changed",
  setStudioTags: "Tags changed",
  createTask: "Task added",
  updateTask: "Task updated",
  addNote: "Note added",
  rerunJob: "Failed job rerun",
  dismissJob: "Failed job dismissed",
  approveDeletion: "Deletion approved",
  refreshStudio: "Row refreshed",
};

/** Studio-side actions worth a line. Anything else falls back to its name. */
const STUDIO_ACTIONS: Record<string, string> = {
  "tenant.created": "Studio created",
  "subscription.changed": "Subscription changed in Stripe",
  "subscription.confirmed_on_return": "Checkout completed",
  "feedback.submitted": "Feedback sent",
  "feedback.status_changed": "Feedback status changed",
  "membership.invited": "Team member invited",
  "membership.accepted": "Team member joined",
};

function auditEntry(event: Raw): TimelineEntry | null {
  const at = text(event.timestamp);
  const action = text(event.action);
  if (!at || !action) return null;
  const after = (event.after ?? {}) as Raw;
  const reason = text(event.reason);
  if (action.startsWith("platform.")) {
    const command = action.slice("platform.".length);
    if (command === "addNote" || command === "createTask" || command === "updateTask" || command === "refreshStudio") return null;
    const subject = text(after.subject);
    const kind: TimelineKind =
      command === "emailStudio" || command === "sendCardUpdateLink"
        ? "email"
        : ["extendTrial", "setComp", "changePlan", "setCancelAtPeriodEnd", "applyDiscount", "removeDiscount", "syncSubscription"].includes(command)
          ? "billing"
          : "team";
    const who = text(event.actorEmail);
    return {
      key: `audit:${String(event.id ?? at + action)}`,
      at,
      kind,
      title: subject ? `${CONSOLE_ACTIONS[command] ?? humanize(command)}: ${subject}` : (CONSOLE_ACTIONS[command] ?? humanize(command)),
      detail: [reason ? `“${reason}”` : null, who ? `by ${who}` : null].filter(Boolean).join(" · ") || null,
    };
  }
  if (action === "subscription.changed" || action === "subscription.confirmed_on_return") {
    const status = text(after.status);
    return { key: `audit:${String(event.id ?? at)}`, at, kind: "billing", title: STUDIO_ACTIONS[action]!, detail: status ? `Now ${status.replace(/_/g, " ")}` : null };
  }
  if (action === "tenant.created") return { key: `audit:${String(event.id ?? at)}`, at, kind: "lifecycle", title: "Studio created" };
  if (action.startsWith("feedback.")) return null; // shown from the feedback itself
  if (event.actorType !== "user") return null;
  return { key: `audit:${String(event.id ?? at + action)}`, at, kind: "product", title: STUDIO_ACTIONS[action] ?? humanize(action) };
}

function productEntry(event: Raw): TimelineEntry | null {
  const at = text(event.occurredAt);
  const name = text(event.eventName) ?? text(event.name) ?? text(event.type);
  if (!at || !name) return null;
  return { key: `product:${String(event.id ?? at + name)}`, at, kind: "product", title: humanize(name) };
}

const KIND_LABEL: Record<string, string> = { idea: "Idea", broken: "Something's broken", confusing: "Confusing", praise: "Love this" };

function feedbackEntry(item: Raw): TimelineEntry | null {
  const at = text(item.createdAt);
  if (!at) return null;
  const message = text(item.message) ?? "";
  return {
    key: `feedback:${String(item.id)}`,
    at,
    kind: "feedback",
    title: `${KIND_LABEL[String(item.kind)] ?? "Feedback"}: “${message.length > 90 ? `${message.slice(0, 87)}…` : message}”`,
    detail: [text(item.userName) ?? text(item.userEmail), text(item.status)].filter(Boolean).join(" · ") || null,
    href: `/platform-admin/inbox?id=${encodeURIComponent(String(item.id))}`,
  };
}

function invoiceEntry(invoice: Raw): TimelineEntry | null {
  const failed = invoice.lastEvent === "invoice.payment_failed";
  const at = failed ? text(invoice.updatedAt) : (text(invoice.paidAt) ?? text(invoice.createdAt));
  if (!at) return null;
  const amount = Number(failed ? invoice.amountDueCents : invoice.amountPaidCents) || 0;
  if (!failed && amount === 0) return null;
  const dollars = `$${(amount / 100).toFixed(2)}`;
  return {
    key: `invoice:${String(invoice.id)}`,
    at,
    kind: "billing",
    title: failed ? `Payment failed: ${dollars}` : `Paid ${dollars}`,
    detail: failed
      ? [Number(invoice.attemptCount) ? `Attempt ${String(invoice.attemptCount)}` : null, text(invoice.nextPaymentAttemptAt) ? "Stripe will retry" : null].filter(Boolean).join(" · ") || null
      : text(invoice.number),
    tone: failed ? "bad" : "ok",
    href: text(invoice.hostedInvoiceUrl),
  };
}

function noteEntry(note: Raw): TimelineEntry | null {
  const at = text(note.createdAt);
  if (!at || note.archivedAt) return null;
  return {
    key: `note:${String(note.id)}`,
    at,
    kind: "note",
    title: text(note.body) ?? "",
    detail: text(note.authorName) ?? text(note.authorEmail),
    pinned: note.pinned === true,
  };
}

function taskEntry(task: Raw): TimelineEntry | null {
  const at = text(task.createdAt);
  if (!at) return null;
  return {
    key: `task:${String(task.id)}`,
    at: task.status === "done" ? (text(task.completedAt) ?? at) : at,
    kind: "task",
    title: `${task.status === "done" ? "Done" : "Task"}: ${text(task.title) ?? ""}`,
    detail: text(task.dueAt) && task.status !== "done" ? `Due ${String(task.dueAt).slice(0, 10)}` : (text(task.assigneeEmail) ?? null),
  };
}

export function buildTimeline(sources: {
  audit?: Raw[] | null;
  product?: Raw[] | null;
  feedback?: Raw[] | null;
  invoices?: Raw[] | null;
  notes?: Raw[] | null;
  tasks?: Raw[] | null;
}): TimelineEntry[] {
  const entries = [
    ...(sources.audit ?? []).map(auditEntry),
    ...(sources.product ?? []).map(productEntry),
    ...(sources.feedback ?? []).map(feedbackEntry),
    ...(sources.invoices ?? []).map(invoiceEntry),
    ...(sources.notes ?? []).map(noteEntry),
    ...(sources.tasks ?? []).map(taskEntry),
  ].filter((entry): entry is TimelineEntry => Boolean(entry && entry.title));
  const seen = new Set<string>();
  return entries
    .filter((entry) => (seen.has(entry.key) ? false : (seen.add(entry.key), true)))
    .sort((a, b) => b.at.localeCompare(a.at));
}
