import type { DocumentSnapshot, Firestore } from "firebase-admin/firestore";
import { normaliseStudioInvoiceSettings } from "./studio-invoice-settings.js";
import { invoiceClosedToProviderWork } from "../booking/invoice-standing.js";
import { clientOutreachStop } from "../post-event/client-outreach.js";
import { productEvent } from "../operations/product-events.js";

/**
 * Payment chasing: Cue drafts a reminder for a balance that is past due, and
 * the studio sends it with one tap (decided 2026-10-06,
 * docs/positioning-office-manager-plan-2026-10-06.md).
 *
 * Before this, an overdue bill put a "$X overdue" card on Today that said
 * "resend it from QuickBooks", and the `final_payment_reminder` template sat
 * unused. Now the daily invoice run (operations/invoice-scheduler.ts) drafts
 * the reminder as a review_required aiAction, the overdue card offers it as
 * "Send reminder", and approving it is the send (ai/actions.ts →
 * ai/approved-communication.ts).
 *
 * Tap to send, always. A reminder is about money, so it is not a lifecycle
 * trigger and the trust dial never offers to send it on its own.
 *
 * The cadence, per invoice:
 * - the first reminder is drafted once the bill is a day past due;
 * - the next only after the previous one was *sent*, and a week had passed;
 * - three at most — after that it is a phone call, not a fourth email;
 * - one waiting at a time: an unsent draft is never stacked on;
 * - a draft the studio declines or dismisses ends the chase for that invoice
 *   (they are handling it some other way).
 *
 * The invoice is read again when the studio approves (ai/actions.ts) and
 * again as the email goes (operations/jobs.ts `paymentReminderInvoiceId`): a
 * couple who paid while the draft waited is never asked for money.
 */

export const PAYMENT_REMINDER = {
  /** Days past the due date before the first reminder is drafted. */
  firstAfterDaysOverdue: 1,
  /** Days after a reminder was sent before the next is drafted. */
  everyDays: 7,
  /** No more than this many reminders for one invoice. */
  max: 3,
} as const;

const DAY_MS = 86_400_000;
const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** Not billed yet, or not owed: never chased (mirrors invoice-scheduler.ts NEVER_OVERDUE). */
const NOT_CHASED = new Set([
  "voided",
  "void",
  "refunded",
  "paid",
  "superseded",
  "failed",
  "cancelled",
  "draft",
  "review_required",
  "queued",
]);

export function paymentReminderActionId(invoiceId: string, sequence: number): string {
  return `ai_payment_reminder_${invoiceId}_${sequence}`;
}

/** One earlier reminder for this invoice, as its aiAction records it. */
export type PriorReminder = {
  sequence: number;
  status: string;
  /** decision.action: approved | rejected | dismissed. */
  decision: string | null;
  decidedAt: string | null;
};

/** Pure: whether this invoice is past due and still something to chase. */
export function invoiceIsChaseable(
  invoice: { status?: unknown; balanceCents?: unknown; dueDate?: unknown; providerState?: unknown; paymentFailedAt?: unknown },
  project: unknown,
  today: string,
): boolean {
  if (NOT_CHASED.has(text(invoice.status)) || invoiceClosedToProviderWork(invoice.status)) return false;
  if (!(Number(invoice.balanceCents) > 0)) return false;
  // A declined card has its own card on Today and needs a different note.
  if (text(invoice.paymentFailedAt)) return false;
  const due = text(invoice.dueDate).slice(0, 10);
  if (!due) return false;
  const daysLate = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / DAY_MS);
  if (!(daysLate >= PAYMENT_REMINDER.firstAfterDaysOverdue)) return false;
  // Not yet raised at the provider: the couple has no bill to be late on.
  if (
    invoice.providerState !== undefined &&
    invoice.providerState !== null &&
    !["completed", "not_applicable"].includes(text(invoice.providerState))
  )
    return false;
  // Archived, called off, on hold — and quiet: an imported booking is
  // usually billed elsewhere, and quiet means nothing is sent because of it.
  return Boolean(project) && clientOutreachStop(project) === null;
}

/**
 * Pure: the sequence number of the reminder to draft now, or null.
 */
export function nextPaymentReminder(input: {
  invoice: Parameters<typeof invoiceIsChaseable>[0];
  project: unknown;
  prior: readonly PriorReminder[];
  today: string;
}): number | null {
  if (!invoiceIsChaseable(input.invoice, input.project, input.today)) return null;
  const prior = [...input.prior].sort((a, b) => a.sequence - b.sequence);
  // One waiting at a time.
  if (prior.some((reminder) => reminder.status === "review_required")) return null;
  // Declined or dismissed: the studio is handling this one.
  if (prior.some((reminder) => reminder.decision === "rejected" || reminder.decision === "dismissed")) return null;
  if (prior.length >= PAYMENT_REMINDER.max) return null;
  const last = prior[prior.length - 1];
  if (!last) return 1;
  // Only a reminder that was actually sent starts the clock.
  if (last.decision !== "approved" || !last.decidedAt) return null;
  const since = Math.floor((Date.parse(`${input.today}T00:00:00Z`) - Date.parse(last.decidedAt.slice(0, 10) + "T00:00:00Z")) / DAY_MS);
  return since >= PAYMENT_REMINDER.everyDays ? last.sequence + 1 : null;
}

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

const longDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

export type PaymentReminderFacts = {
  sequence: number;
  studioName: string;
  clientFirstName: string | null;
  projectName: string;
  /** "retainer" or "final"; anything else reads as the balance. */
  invoiceKind: string;
  balanceCents: number;
  dueDate: string;
  today: string;
  /** An invoice the studio issued itself (own invoicing): its number… */
  invoiceNumber?: string | null;
  /** …and how its clients pay it (Settings → Invoices and payments). */
  paymentInstructions?: string | null;
};

/**
 * Pure: the reminder itself. Written as the studio, never as Cue — couples
 * don't deal with Cue. Polite on the first, plainer on the second, and the
 * third says it is the last note before the studio gets in touch.
 */
export function paymentReminderDraft(facts: PaymentReminderFacts): { subject: string; body: string; title: string } {
  const what = facts.invoiceKind === "retainer" ? "retainer" : "balance";
  const amount = money(facts.balanceCents);
  const due = longDate(facts.dueDate);
  const daysLate = Math.max(
    1,
    Math.floor((Date.parse(`${facts.today}T00:00:00Z`) - Date.parse(`${facts.dueDate.slice(0, 10)}T00:00:00Z`)) / DAY_MS),
  );
  const greeting = facts.clientFirstName ? `Hi ${facts.clientFirstName},` : "Hello,";
  const howToPay = facts.paymentInstructions
    ? [`How to pay: ${facts.paymentInstructions.split(/\n+/).map((line) => line.trim()).filter(Boolean).join(" \u00b7 ")}`]
    : [];
  const which = facts.invoiceNumber ? ` (invoice ${facts.invoiceNumber})` : "";
  const lines =
    facts.sequence <= 1
      ? [
          `A quick reminder that the ${what} for ${facts.projectName}${which}, ${amount}, was due on ${due}. If it's already on its way, thank you, and please ignore this note.`,
          "You can pay securely using the button below. If anything has changed or you have a question, just reply to this email.",
        ]
      : facts.sequence === 2
        ? [
            `We're following up on the ${what} for ${facts.projectName}${which}. ${amount} is now ${daysLate} days past its due date of ${due}.`,
            "You can pay securely using the button below. If there's a problem with the payment or the timing, reply and let us know so we can sort it out together.",
          ]
        : [
            `We haven't yet received the ${what} for ${facts.projectName}${which}: ${amount}, due on ${due}.`,
            "This is our last email reminder. Please pay using the button below, or reply to let us know what's happening, and we'll be in touch to settle it.",
          ];
  return {
    subject:
      facts.sequence <= 1
        ? `A reminder about your ${what} for ${facts.projectName}`
        : facts.sequence === 2
          ? `Following up: your ${what} for ${facts.projectName}`
          : `Your ${what} for ${facts.projectName} is still due`,
    body: [greeting, "", ...[...lines, ...howToPay].flatMap((line) => [line, ""]), `— ${facts.studioName}`].join("\n"),
    title: `Remind ${facts.clientFirstName ?? "the client"} about the ${amount} ${what}`,
  };
}

/**
 * Where the button in the reminder goes: the provider's own pay page, the
 * studio's own pay link (an invoice it issued itself), or the client's
 * payments page.
 */
export function paymentReminderLink(
  invoice: { hostedUrl?: unknown; payLinkUrl?: unknown },
  projectId: string,
  appUrl: string,
  studioPayLink: string | null = null,
): string {
  const hosted = text(invoice.hostedUrl);
  if (/^https:\/\//.test(hosted)) return hosted;
  const own = text(invoice.payLinkUrl) || text(studioPayLink);
  if (/^https:\/\//.test(own)) return own;
  return `${appUrl.replace(/\/$/, "")}/client/payments?project=${encodeURIComponent(projectId)}`;
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://studio-cue.com";
}

function priorFrom(snapshot: DocumentSnapshot, sequence: number): PriorReminder | null {
  if (!snapshot.exists) return null;
  const decision = (snapshot.get("decision") ?? null) as { action?: unknown; decidedAt?: unknown } | null;
  return {
    sequence,
    status: text(snapshot.get("status")),
    decision: text(decision?.action) || null,
    decidedAt: text(decision?.decidedAt) || null,
  };
}

/**
 * Draft the reminders due today for these overdue invoices.
 *
 * `projects` holds each invoice's job, already read and tenant-checked by the
 * caller. Draft ids are fixed per (invoice, sequence), so a re-run never
 * drafts the same reminder twice. One failure never stops the rest.
 */
export async function draftPaymentReminders(
  db: Firestore,
  invoices: readonly DocumentSnapshot[],
  projects: ReadonlyMap<string, Record<string, unknown>>,
  now: Date,
): Promise<number> {
  const today = now.toISOString().slice(0, 10);
  const studios = new Map<string, string>();
  const studioPayments = new Map<string, { instructions: string | null; payLinkUrl: string | null }>();
  let drafted = 0;
  for (const invoice of invoices) {
    try {
      const tenantId = text(invoice.get("tenantId"));
      const projectId = text(invoice.get("projectId"));
      const project = projects.get(projectId);
      if (!tenantId || !projectId || !project || project.tenantId !== tenantId) continue;
      if (!invoiceIsChaseable(invoice.data() ?? {}, project, today)) continue;

      const references = Array.from({ length: PAYMENT_REMINDER.max }, (_, index) =>
        db.doc(`aiActions/${paymentReminderActionId(invoice.id, index + 1)}`),
      );
      const snapshots = await db.getAll(...references);
      const prior = snapshots
        .map((snapshot, index) => priorFrom(snapshot, index + 1))
        .filter((reminder): reminder is PriorReminder => reminder !== null);
      const sequence = nextPaymentReminder({ invoice: invoice.data() ?? {}, project, prior, today });
      if (!sequence) continue;

      const contactIds = Array.isArray(project.clientContactIds) ? project.clientContactIds.map(String) : [];
      let recipientEmail: string | null = null;
      let recipientName: string | null = null;
      if (contactIds[0]) {
        const contact = await db.doc(`contacts/${contactIds[0]}`).get();
        if (contact.exists && contact.get("tenantId") === tenantId) {
          recipientEmail = text(contact.get("email")) || null;
          recipientName = text(contact.get("displayName")) || null;
        }
      }
      let studioName = studios.get(tenantId);
      if (studioName === undefined) {
        const tenant = await db.doc(`tenants/${tenantId}`).get();
        studioName = text(tenant.get("brandName")) || text(tenant.get("businessName")) || "Your studio";
        studios.set(tenantId, studioName);
      }
      const projectName = text(project.name) || "your booking";
      const balanceCents = Number(invoice.get("balanceCents"));
      // An invoice the studio issued itself: its number, its payment
      // instructions and its own pay link go in the reminder.
      const studioIssued = invoice.get("billedBy") === "studio" && !invoice.get("provider");
      let studioPayment: { instructions: string | null; payLinkUrl: string | null } | null = null;
      if (studioIssued) {
        if (!studioPayments.has(tenantId)) {
          const settings = await db.doc(`billingSettings/${tenantId}`).get();
          const parsed = normaliseStudioInvoiceSettings(
            settings.exists && settings.get("tenantId") === tenantId ? settings.data() : null,
          );
          studioPayments.set(tenantId, { instructions: parsed.paymentInstructions, payLinkUrl: parsed.payLinkUrl });
        }
        studioPayment = studioPayments.get(tenantId) ?? null;
      }
      const dueDate = text(invoice.get("dueDate")).slice(0, 10);
      const draft = paymentReminderDraft({
        sequence,
        studioName,
        clientFirstName: recipientName?.split(" ")[0] ?? null,
        projectName,
        invoiceKind: text(invoice.get("kind")),
        balanceCents,
        dueDate,
        today,
        invoiceNumber: studioIssued ? text(invoice.get("number")) || null : null,
        paymentInstructions: studioPayment?.instructions ?? null,
      });
      const missing = recipientEmail ? [] : ["The client has no email address on this job"];
      const actionId = paymentReminderActionId(invoice.id, sequence);
      const stamp = now.toISOString();
      const batch = db.batch();
      batch.create(db.doc(`aiActions/${actionId}`), {
        id: actionId,
        tenantId,
        projectId,
        actorId: "payment-reminder-scheduler",
        title: draft.title,
        capability: "delivery_message_draft",
        authorityBoundary: "draft_requires_review",
        status: "review_required",
        modelProvider: "studiocue",
        modelVersion: "deterministic_template",
        instructionVersion: "payment_reminder_v1",
        outputSchemaVersion: "message_draft_output_v1",
        sourceReferences: [
          { entityType: "project", entityId: projectId, versionId: null, label: projectName, locator: null },
          { entityType: "invoiceReference", entityId: invoice.id, versionId: null, label: `Invoice ${invoice.id}`, locator: null },
        ],
        structuredOutput: {
          trigger: "payment_reminder",
          subject: draft.subject,
          body: draft.body,
          recipientEmail,
          recipientName,
          contactId: contactIds[0] ?? null,
          projectName,
          highlights: [`Reminder ${sequence} of ${PAYMENT_REMINDER.max}`, "Balance read from the invoice"],
          // Read again at approval and at send: a paid bill is never chased.
          paymentReminder: {
            invoiceId: invoice.id,
            sequence,
            balanceCents,
            dueDate,
            actionLabel: "Pay securely",
            actionUrl: paymentReminderLink(invoice.data() ?? {}, projectId, appUrl(), studioPayment?.payLinkUrl ?? null),
          },
        },
        confidence: { overall: missing.length ? 0.7 : 0.95, label: missing.length ? "medium" : "high", uncertainFields: missing },
        validation: {
          status: missing.length ? "pending" : "passed",
          issues: missing.map((message) => ({ code: "MISSING_INFORMATION", severity: "warning", message, field: null })),
        },
        decision: null,
        downstreamCommand: null,
        usage: { inputTokens: 0, outputTokens: 0, estimatedCostMicros: 0, latencyMs: 0, estimatedMinutesSaved: 5 },
        failure: null,
        snoozedUntil: null,
        archivedAt: null,
        createdAt: stamp,
        updatedAt: stamp,
        createdBy: "payment-reminder-scheduler",
        updatedBy: "payment-reminder-scheduler",
      });
      const event = productEvent({
        tenantId,
        projectId,
        actorId: "payment-reminder-scheduler",
        actorType: "system",
        name: "ai_action.completed",
        occurredAt: stamp,
        correlationId: actionId,
        sourceEntityType: "aiAction",
        sourceEntityId: actionId,
        properties: { capability: "delivery_message_draft", trigger: "payment_reminder", sequence, deterministic: true, humanReviewRequired: true },
      });
      batch.set(db.doc(`productEvents/${event.id}`), event);
      await batch.commit();
      drafted += 1;
    } catch (caught: unknown) {
      // A draft that already exists (a re-run racing itself) is not an error.
      if ((caught as { code?: unknown })?.code === 6) continue;
      console.error("payment reminder not drafted", invoice.id, caught);
    }
  }
  return drafted;
}
