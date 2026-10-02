import { inquiryNextMove, type InquiryConversation } from "./next-move";
import { inquiryStage, isInquiryStage, type InquiryStage } from "./stages";

/**
 * The Inquiries list: everyone who hasn't booked yet, and where each stands.
 *
 * A couple is an inquiry from their first message until they book. Most are a
 * job from the moment they arrive (functions/src/intake/convert.ts); a few are
 * still only a lead — no date yet, or waiting for the studio to confirm it is
 * an inquiry at all. Both belong on one list, because to the studio they are
 * the same thing: someone who asked, and hasn't said yes.
 *
 * Pure. The page supplies the records.
 */

type Row = Record<string, unknown> & { id: string };

export type InquiryRow = {
  id: string;
  /** A job at the inquiry stage, or a lead that isn't a job yet. */
  kind: "job" | "lead";
  href: string;
  name: string;
  email: string | null;
  eventDate: string | null;
  stage: InquiryStage | "closed";
  /** Whose move: the studio's, or the couple's. Null once closed. */
  owner: "studio" | "couple" | null;
  waitingSince: string | null;
  source: string;
  availability: "available" | "conflict" | "unknown";
  /** Why it closed, in the studio's words, when it did. */
  closedReason: string | null;
  closedAt: string | null;
  /**
   * The job's state (a lead: LEAD, or LOST once closed) — what decides
   * whether the row can be closed or reopened from the list.
   */
  state: string;
};

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** Why an inquiry ended, as the studio said it. */
export const lostReasonLabel: Record<string, string> = {
  went_quiet: "Went quiet",
  booked_elsewhere: "Booked someone else",
  budget: "Budget",
  date_taken: "Date taken",
  not_a_fit: "Not a fit",
  other: "Other",
};

function sourceOf(lead: Row | undefined): string {
  if (!lead) return "Added by you";
  const builder = text(lead.formBuilderLabel);
  const source = text(lead.source);
  if (source.startsWith("marketplace_") && builder) return builder;
  if (builder) return builder;
  if (source === "forwarded_email") return "Forwarded email";
  if (source === "website_form") return "Website form";
  return "Inquiry form";
}

function nameOf(record: Row | undefined): string {
  if (!record) return "";
  return (
    text(record.displayName) ||
    [text(record.firstName), text(record.lastName)].filter(Boolean).join(" ") ||
    text(record.email)
  );
}

/**
 * The states in which a job holds its date — the same list intake checks
 * (functions/src/crm/public-lead.ts) when it first says "free" or "booked".
 */
export const DATE_HOLDING_STATES: readonly string[] = [
  "CONSULTATION",
  "PROPOSAL",
  "CONTRACT_PENDING",
  "RETAINER_PENDING",
  "BOOKED",
  "PLANNING",
  "READY",
];

/**
 * Whether the date is free, as of now rather than as of arrival.
 *
 * Intake stamps availability once. An inquiry that arrived while the date was
 * free kept saying "Date free" after another couple took it — production,
 * 2026-09-29: two inquiries for 12 Jun 2027, one "free" and one "booked",
 * with a job awaiting signature on that day. A job holding the date now wins
 * over the stamp; without one, the stamp stands (the list may not hold every
 * job, so absence is not proof).
 */
export function dateHeldByAnother(
  projects: readonly { id: string; [key: string]: unknown }[],
  eventDate: string | null | undefined,
  selfId: string | null,
): boolean {
  const day = (eventDate ?? "").slice(0, 10);
  if (!day) return false;
  return projects.some(
    (project) =>
      project.id !== selfId &&
      // An archived job holds no date.
      !project.archivedAt &&
      text(project.eventDate).slice(0, 10) === day &&
      DATE_HOLDING_STATES.includes(text(project.state)),
  );
}

function availabilityNow(
  stamped: unknown,
  eventDate: string | null,
  selfId: string | null,
  holdersByDate: Map<string, string[]>,
): InquiryRow["availability"] {
  const holders = eventDate ? (holdersByDate.get(eventDate.slice(0, 10)) ?? []) : [];
  if (holders.some((id) => id !== selfId)) return "conflict";
  return (text(stamped) as InquiryRow["availability"]) || "unknown";
}

export function inquiryPipeline(input: {
  projects: readonly Row[];
  leads: readonly Row[];
  conversations: readonly InquiryConversation[];
}): InquiryRow[] {
  const leadById = new Map(input.leads.map((lead) => [lead.id, lead]));
  const leadForProject = new Map<string, Row>();
  for (const lead of input.leads) {
    if (text(lead.projectId)) leadForProject.set(text(lead.projectId), lead);
  }
  const rows: InquiryRow[] = [];
  const holdersByDate = new Map<string, string[]>();
  for (const project of input.projects) {
    const date = text(project.eventDate).slice(0, 10);
    // An archived job holds no date.
    if (!date || project.archivedAt || !DATE_HOLDING_STATES.includes(text(project.state))) continue;
    holdersByDate.set(date, [...(holdersByDate.get(date) ?? []), project.id]);
  }

  for (const project of input.projects) {
    const state = text(project.state);
    const lead = leadById.get(text(project.leadId)) ?? leadForProject.get(project.id);
    const lost = state === "LOST";
    if (!lost && !isInquiryStage(project)) continue;
    const move = inquiryNextMove({
      conversations: input.conversations,
      projectId: project.id,
      leadId: lead?.id ?? null,
      receivedAt: text(lead?.createdAt) || text(project.createdAt) || null,
      repliedOutsideAt: text(lead?.repliedOutsideAt) || null,
    });
    const reason = text(project.lostReason);
    const stage = lost ? "closed" : inquiryStage(state, move.replied);
    // With no thread at all, nobody has said anything the other side owes an
    // answer to — past "new", the stage itself is the whole story.
    const silent = !move.lastInboundAt && !move.lastOutboundAt && stage !== "new";
    rows.push({
      id: project.id,
      kind: "job",
      href: `/studio/projects/${project.id}`,
      name: nameOf(lead) || text(project.name) || "Inquiry",
      email: text(lead?.email) || null,
      eventDate: text(project.eventDate) || null,
      stage,
      owner: lost || silent ? null : move.owner,
      waitingSince: lost || silent ? null : move.waitingSince,
      source: sourceOf(lead),
      availability: availabilityNow(lead?.availabilityStatus, text(project.eventDate) || null, project.id, holdersByDate),
      closedReason: lost ? (lostReasonLabel[reason] ?? "Closed") : null,
      closedAt: lost ? text(project.lostAt) || text(project.updatedAt) || null : null,
      state,
    });
  }

  for (const lead of input.leads) {
    // A lead that is a job is listed as its job, above.
    if (text(lead.projectId)) continue;
    // "Maybe an inquiry" is asked about in its own tray, not listed here.
    if (lead.needsConfirmation === true) continue;
    const status = text(lead.status);
    const closed = ["lost", "archived"].includes(status) || Boolean(lead.archivedAt);
    // Spam the studio dismissed is not an inquiry that closed.
    if (closed && lead.notInquiry === true) continue;
    const move = inquiryNextMove({
      conversations: input.conversations,
      leadId: lead.id,
      receivedAt: text(lead.createdAt) || null,
      repliedOutsideAt: text(lead.repliedOutsideAt) || null,
    });
    rows.push({
      id: lead.id,
      kind: "lead",
      href: `/studio/leads/${lead.id}`,
      name: nameOf(lead) || "New inquiry",
      email: text(lead.email) || null,
      eventDate: text(lead.eventDate) || null,
      stage: closed ? "closed" : move.replied ? "talking" : "new",
      owner: closed ? null : move.owner,
      waitingSince: closed ? null : move.waitingSince,
      source: sourceOf(lead),
      availability: availabilityNow(lead.availabilityStatus, text(lead.eventDate) || null, null, holdersByDate),
      closedReason: closed ? (lostReasonLabel[text(lead.lostReason)] ?? "Closed") : null,
      closedAt: closed ? text(lead.archivedAt) || text(lead.updatedAt) || null : null,
      state: closed ? "LOST" : "LEAD",
    });
  }

  // The studio's move first, longest-waiting first; then everyone the studio
  // is waiting on, longest-waiting first; closed last, newest first.
  const rank = (row: InquiryRow) => (row.stage === "closed" ? 2 : row.owner === "studio" ? 0 : 1);
  return rows.sort((left, right) => {
    const byRank = rank(left) - rank(right);
    if (byRank) return byRank;
    if (left.stage === "closed") return (right.closedAt ?? "").localeCompare(left.closedAt ?? "");
    return (left.waitingSince ?? "").localeCompare(right.waitingSince ?? "");
  });
}
