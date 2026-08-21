/**
 * The job thread — a wedding as one conversation.
 *
 * Phase 2 of the "Today & Jobs" design. A job stops being a record with four
 * tabs and becomes a single chronological thread: the inquiry at the top,
 * then every message, consult, proposal, contract, payment, schedule, crew
 * decision and delivery as an entry, with the next step composing at the
 * bottom.
 *
 * Entries carry who acted (the client, you, StudioCue, or a provider) so the
 * thread reads like a story rather than a log. Artifact entries carry the
 * live facts of the thing itself — a proposal's price and status — so the
 * card can be operated without opening another page.
 *
 * Pure function, no I/O: the UI feeds it plain records.
 */

import { formatDueDate } from "@/lib/format/event-date";

export type ThreadActor = "client" | "studio" | "studiocue" | "provider";

export type ThreadEntryKind =
  /** Something a person wrote or said. */
  | "message"
  /** A record with its own life: proposal, contract, invoice, schedule… */
  | "artifact"
  /** The engines narrating what they did. */
  | "system";

export type ThreadArtifact = {
  type:
    | "proposal"
    | "contract"
    | "invoice"
    | "schedule"
    | "questionnaire"
    | "delivery"
    | "consultation";
  status: string;
  /** Short human facts shown as chips on the card. */
  facts: string[];
  href: string | null;
};

export type ThreadEntry = {
  id: string;
  at: string;
  actor: ThreadActor;
  kind: ThreadEntryKind;
  title: string;
  detail: string | null;
  artifact: ThreadArtifact | null;
};

export type ThreadRecord = Record<string, unknown> & { id: string };

export type ThreadInput = {
  projectId: string;
  projectName: string;
  projectCreatedAt: string | null;
  clientName: string | null;
  lead?: ThreadRecord | null;
  consultations?: ThreadRecord[] | null;
  proposals?: ThreadRecord[] | null;
  contracts?: ThreadRecord[] | null;
  invoices?: ThreadRecord[] | null;
  questionnaires?: ThreadRecord[] | null;
  schedules?: ThreadRecord[] | null;
  crewAssignments?: ThreadRecord[] | null;
  insuranceRequests?: ThreadRecord[] | null;
  deliveries?: ThreadRecord[] | null;
  messages?: ThreadRecord[] | null;
  actionReceipts?: ThreadRecord[] | null;
};

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";
const rows = (records?: ThreadRecord[] | null) => records ?? [];
const readable = (value: unknown) =>
  text(value).replaceAll("_", " ").replace(/^\w/, (l) => l.toUpperCase());

const money = (cents: unknown, currency: unknown = "USD") =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: text(currency) || "USD",
    maximumFractionDigits: 0,
  }).format(Number(cents ?? 0) / 100);

/** The first timestamp a record can honestly claim. */
const firstAt = (record: ThreadRecord, ...keys: string[]): string | null => {
  for (const key of keys) {
    const value = text(record[key]);
    if (value) return value;
  }
  return null;
};

export function projectThread(input: ThreadInput): ThreadEntry[] {
  const entries: ThreadEntry[] = [];
  const client = input.clientName ?? "The client";
  const push = (entry: ThreadEntry | null) => {
    if (entry && entry.at) entries.push(entry);
  };

  // ── The beginning ──────────────────────────────────────────────────
  if (input.lead) {
    const lead = input.lead;
    const at = firstAt(lead, "createdAt", "receivedAt", "updatedAt");
    push(
      at
        ? {
            id: `lead-${lead.id}`,
            at,
            actor: "client",
            kind: "message",
            title: `${client} got in touch`,
            detail: text(lead.message) || null,
            artifact: null,
          }
        : null,
    );
  }

  // ── Messages ───────────────────────────────────────────────────────
  for (const message of rows(input.messages)) {
    const at = firstAt(message, "sentAt", "createdAt", "updatedAt");
    const inbound = text(message.direction) === "inbound";
    push(
      at
        ? {
            id: `message-${message.id}`,
            at,
            actor: inbound ? "client" : "studio",
            kind: "message",
            title: inbound
              ? `${client} replied`
              : text(message.subject) || "You sent an email",
            detail: text(message.preview) || text(message.subject) || null,
            artifact: null,
          }
        : null,
    );
  }

  // ── Consultations ──────────────────────────────────────────────────
  for (const consultation of rows(input.consultations)) {
    const booked = firstAt(consultation, "createdAt");
    const status = text(consultation.status);
    push(
      booked
        ? {
            id: `consult-booked-${consultation.id}`,
            at: booked,
            actor: "studio",
            kind: "artifact",
            title: "Consultation booked",
            detail: text(consultation.startsAt)
              ? `${readable(consultation.mode)} · ${formatDueDate(text(consultation.startsAt))}`
              : readable(consultation.mode),
            artifact: {
              type: "consultation",
              status,
              facts: [readable(status)],
              href: text(consultation.joinUrl) || null,
            },
          }
        : null,
    );
    if (status === "completed") {
      // `updatedAt` is when the record was last touched, not when the
      // consultation happened — a background write would drag a November
      // meeting onto today's date in the thread. Prefer the meeting's own
      // end, then its review, and fall back only if neither exists.
      const done = firstAt(
        consultation,
        "completedAt",
        "endsAt",
        "aiReviewedAt",
        "updatedAt",
      );
      push(
        done
          ? {
              id: `consult-done-${consultation.id}`,
              at: done,
              actor: "studio",
              kind: "message",
              title: "You logged the consultation",
              detail: text(consultation.internalNotes) || null,
              artifact: null,
            }
          : null,
      );
    }
  }

  // ── Proposals ──────────────────────────────────────────────────────
  for (const proposal of rows(input.proposals)) {
    const pricing =
      typeof proposal.pricingSnapshot === "object" && proposal.pricingSnapshot
        ? (proposal.pricingSnapshot as Record<string, unknown>)
        : {};
    const status = text(proposal.status);
    const total = money(pricing.totalCents, pricing.currency);
    const version = Number(proposal.version ?? 1);
    const created = firstAt(proposal, "createdAt");
    push(
      created
        ? {
            id: `proposal-${proposal.id}`,
            at: created,
            actor: "studio",
            kind: "artifact",
            title: `Proposal v${version} — ${text(pricing.packageName) || "coverage"}`,
            detail: null,
            artifact: {
              type: "proposal",
              status,
              facts: [
                total,
                readable(status),
                text(proposal.expiresAt)
                  ? `expires ${formatDueDate(text(proposal.expiresAt))}`
                  : "",
              ].filter(Boolean),
              href: `/studio/proposals/${proposal.id}`,
            },
          }
        : null,
    );
    const sent = firstAt(proposal, "sentAt");
    push(
      sent
        ? {
            id: `proposal-sent-${proposal.id}`,
            at: sent,
            actor: "studio",
            kind: "system",
            title: "Proposal sent to the client",
            detail: text(proposal.viewedAt)
              ? `Viewed ${formatDueDate(text(proposal.viewedAt))}`
              : "Not opened yet",
            artifact: null,
          }
        : null,
    );
    const accepted = firstAt(proposal, "acceptedAt");
    push(
      accepted
        ? {
            id: `proposal-accepted-${proposal.id}`,
            at: accepted,
            actor: "client",
            kind: "system",
            title: `${client} accepted the proposal`,
            detail: total,
            artifact: null,
          }
        : null,
    );
  }

  // ── Contracts ──────────────────────────────────────────────────────
  for (const contract of rows(input.contracts)) {
    const sent = firstAt(contract, "sentAt", "createdAt");
    const status = text(contract.status);
    push(
      sent
        ? {
            id: `contract-${contract.id}`,
            at: sent,
            actor: "studio",
            kind: "artifact",
            title: "Agreement sent for signature",
            detail: null,
            artifact: {
              type: "contract",
              status,
              facts: [readable(status), readable(contract.provider)].filter(
                Boolean,
              ),
              href: `/studio/booking?project=${input.projectId}`,
            },
          }
        : null,
    );
    const completed = firstAt(contract, "completedAt");
    push(
      completed
        ? {
            id: `contract-signed-${contract.id}`,
            at: completed,
            actor: "provider",
            kind: "system",
            title: "Agreement fully signed",
            detail: "Verified by the signing provider",
            artifact: null,
          }
        : null,
    );
  }

  // ── Invoices ───────────────────────────────────────────────────────
  for (const invoice of rows(input.invoices)) {
    const kind = text(invoice.kind) === "final" ? "Final balance" : "Retainer";
    const created = firstAt(invoice, "createdAt", "issuedAt");
    const status = text(invoice.status);
    push(
      created
        ? {
            id: `invoice-${invoice.id}`,
            at: created,
            actor: "studio",
            kind: "artifact",
            title: `${kind} invoice`,
            detail: null,
            artifact: {
              type: "invoice",
              status,
              facts: [
                money(invoice.amountCents, invoice.currency),
                readable(status),
                text(invoice.dueDate)
                  ? `due ${formatDueDate(text(invoice.dueDate))}`
                  : "",
              ].filter(Boolean),
              href: "/studio/invoices",
            },
          }
        : null,
    );
    const paid = firstAt(invoice, "paidAt");
    push(
      paid
        ? {
            id: `invoice-paid-${invoice.id}`,
            at: paid,
            actor: "client",
            kind: "system",
            title: `${kind} paid`,
            detail: money(invoice.amountCents, invoice.currency),
            artifact: null,
          }
        : null,
    );
  }

  // ── Questionnaire ──────────────────────────────────────────────────
  for (const response of rows(input.questionnaires)) {
    const assigned = firstAt(response, "assignedAt", "createdAt");
    const status = text(response.status);
    push(
      assigned
        ? {
            id: `form-${response.id}`,
            at: assigned,
            actor: "studio",
            kind: "artifact",
            title: "Wedding details form sent",
            detail: null,
            artifact: {
              type: "questionnaire",
              status,
              facts: [readable(status)],
              href: `/studio/questionnaires?project=${input.projectId}`,
            },
          }
        : null,
    );
    const submitted = firstAt(response, "submittedAt");
    push(
      submitted
        ? {
            id: `form-done-${response.id}`,
            at: submitted,
            actor: "client",
            kind: "system",
            title: `${client} completed the details form`,
            detail: null,
            artifact: null,
          }
        : null,
    );
  }

  // ── Schedule ───────────────────────────────────────────────────────
  for (const schedule of rows(input.schedules)) {
    const at = firstAt(schedule, "publishedAt", "updatedAt", "createdAt");
    const status = text(schedule.status);
    push(
      at
        ? {
            id: `schedule-${schedule.id}`,
            at,
            actor: "studio",
            kind: "artifact",
            title: `Run of show v${Number(schedule.version ?? 1)}`,
            detail: null,
            artifact: {
              type: "schedule",
              status,
              facts: [readable(status)],
              href: `/studio/schedules?project=${input.projectId}`,
            },
          }
        : null,
    );
  }

  // ── Crew ───────────────────────────────────────────────────────────
  for (const assignment of rows(input.crewAssignments)) {
    const status = text(assignment.status);
    if (status !== "accepted") continue;
    const at = firstAt(assignment, "respondedAt", "updatedAt", "createdAt");
    push(
      at
        ? {
            id: `crew-${assignment.id}`,
            at,
            actor: "provider",
            kind: "system",
            title: `${text(assignment.role) || "Crew"} confirmed`,
            detail: text(assignment.crewName) || null,
            artifact: null,
          }
        : null,
    );
  }

  // ── Insurance ──────────────────────────────────────────────────────
  for (const request of rows(input.insuranceRequests)) {
    const at = firstAt(request, "updatedAt", "createdAt");
    push(
      at
        ? {
            id: `coi-${request.id}`,
            at,
            actor: "studio",
            kind: "system",
            title: "Certificate of insurance",
            detail: readable(request.status),
            artifact: null,
          }
        : null,
    );
  }

  // ── Delivery ───────────────────────────────────────────────────────
  for (const delivery of rows(input.deliveries)) {
    const at = firstAt(delivery, "sentAt", "deliveryDate", "createdAt");
    const status = text(delivery.status);
    push(
      at
        ? {
            id: `delivery-${delivery.id}`,
            at,
            actor: "studio",
            kind: "artifact",
            title: "Gallery delivered",
            detail: text(delivery.notes) || null,
            artifact: {
              type: "delivery",
              status,
              facts: [
                readable(status),
                text(delivery.viewedAt) ? "viewed" : "",
              ].filter(Boolean),
              href: `/studio/delivery?project=${input.projectId}`,
            },
          }
        : null,
    );
  }

  // ── What StudioCue handled ─────────────────────────────────────────
  for (const receipt of rows(input.actionReceipts)) {
    if (text(receipt.status) !== "completed") continue;
    const at = firstAt(receipt, "completedAt", "updatedAt", "createdAt");
    push(
      at
        ? {
            id: `receipt-${receipt.id}`,
            at,
            actor: "studiocue",
            kind: "system",
            title: text(receipt.title) || "Handled for you",
            detail: text(receipt.summary) || null,
            artifact: null,
          }
        : null,
    );
  }

  // A job with no inquiry opens with "you started this" — but only when
  // that is genuinely the first thing that happened. Imported jobs carry
  // records older than their own createdAt, and a synthetic opener landing
  // mid-thread reads like a bug.
  if (!input.lead && input.projectCreatedAt) {
    const earliest = entries
      .map((entry) => entry.at)
      .sort()[0];
    if (!earliest || input.projectCreatedAt <= earliest) {
      push({
        id: `project-${input.projectId}`,
        at: input.projectCreatedAt,
        actor: "studio",
        kind: "system",
        title: "You started this job",
        detail: input.projectName,
        artifact: null,
      });
    }
  }

  // Oldest first: the thread reads like a conversation, newest at the
  // bottom where the composer sits.
  entries.sort((left, right) => {
    if (left.at !== right.at) return left.at.localeCompare(right.at);
    return left.id.localeCompare(right.id);
  });
  return entries;
}

/** Entries grouped into day buckets for the thread's date dividers. */
export function groupThreadByDay(
  entries: readonly ThreadEntry[],
): Array<{ day: string; entries: ThreadEntry[] }> {
  const days: Array<{ day: string; entries: ThreadEntry[] }> = [];
  for (const entry of entries) {
    const day = entry.at.slice(0, 10);
    const last = days[days.length - 1];
    if (last && last.day === day) last.entries.push(entry);
    else days.push({ day, entries: [entry] });
  }
  return days;
}
