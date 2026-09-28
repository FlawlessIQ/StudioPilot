import { bookedStates } from "@/features/inquiries/stages";
import { lostReasonLabel } from "@/features/inquiries/pipeline";

/**
 * How inquiries turn into weddings: where they come from, how many book,
 * how fast the studio answers, and why the rest didn't.
 *
 * "Lead sources" used to group by the free-text referral field, which a
 * captured inquiry almost never fills, so nearly everything read "Unknown".
 * The source here is where StudioCue actually received it — the form
 * builder, the marketplace, a forward — and a couple who wrote twice counts
 * once, by their job.
 *
 * Pure. The page supplies the records.
 */

type Row = Record<string, unknown> & { id: string };

const text = (value: unknown): string => (typeof value === "string" ? value : "");

export type SourceLine = { source: string; inquiries: number; booked: number };

export type InquiryInsights = {
  inquiries: number;
  booked: number;
  /** Booked ÷ inquiries, 0–100; null with no inquiries. */
  winRate: number | null;
  sources: SourceLine[];
  /** Median hours from arrival to the studio's first message; null if none yet. */
  medianFirstReplyHours: number | null;
  repliedWithinHour: number;
  replied: number;
  closedReasons: Array<{ reason: string; count: number }>;
};

export function inquirySourceLabel(lead: Row): string {
  const builder = text(lead.formBuilderLabel);
  const source = text(lead.source);
  if (builder) return builder;
  if (source === "forwarded_email") return "Forwarded email";
  if (source === "website_form") return "Website form";
  if (source.startsWith("marketplace_")) return source.slice("marketplace_".length).replace(/_/g, " ");
  return "StudioCue inquiry form";
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function inquiryInsights(input: {
  leads: readonly Row[];
  projects: readonly Row[];
  conversations: readonly Row[];
  /** Only inquiries that arrived in [from, to], ISO dates, when given. */
  from?: string | null;
  to?: string | null;
}): InquiryInsights {
  const projectById = new Map(input.projects.map((project) => [project.id, project]));
  // One per couple: the earliest lead of each job, and every lead with no job.
  const couples = new Map<string, Row>();
  for (const lead of input.leads) {
    if (lead.notInquiry === true || lead.needsConfirmation === true) continue;
    const arrived = text(lead.createdAt).slice(0, 10);
    if (input.from && arrived < input.from) continue;
    if (input.to && arrived > input.to) continue;
    const key = text(lead.projectId) || `lead:${lead.id}`;
    const current = couples.get(key);
    if (!current || text(lead.createdAt) < text(current.createdAt)) couples.set(key, lead);
  }

  const sources = new Map<string, SourceLine>();
  const replyHours: number[] = [];
  const reasons = new Map<string, number>();
  let booked = 0;
  let repliedWithinHour = 0;

  for (const [key, lead] of couples) {
    const project = key.startsWith("lead:") ? undefined : projectById.get(key);
    const won = Boolean(project && bookedStates.has(text(project.state)));
    if (won) booked += 1;
    const label = inquirySourceLabel(lead);
    const line = sources.get(label) ?? { source: label, inquiries: 0, booked: 0 };
    line.inquiries += 1;
    if (won) line.booked += 1;
    sources.set(label, line);

    const lostReason = project?.state === "LOST" ? text(project.lostReason) : lead.status === "lost" ? text(lead.lostReason) : "";
    if (lostReason) reasons.set(lostReason, (reasons.get(lostReason) ?? 0) + 1);

    // The studio's first message on this couple's live thread. A thread left
    // behind as a pointer (`movedTo`) holds the automatic acknowledgement,
    // which is not a reply.
    let firstReply: string | null = null;
    for (const thread of input.conversations) {
      if (text(thread.movedTo)) continue;
      const mine = project ? text(thread.projectId) === project.id : text(thread.leadId) === lead.id;
      if (!mine) continue;
      const first = text(thread.firstOutboundAt);
      if (first && (!firstReply || first < firstReply)) firstReply = first;
    }
    const arrived = Date.parse(text(lead.createdAt));
    if (firstReply && Number.isFinite(arrived)) {
      const hours = Math.max(0, (Date.parse(firstReply) - arrived) / 3_600_000);
      replyHours.push(hours);
      if (hours <= 1) repliedWithinHour += 1;
    }
  }

  const inquiries = couples.size;
  return {
    inquiries,
    booked,
    winRate: inquiries ? Math.round((booked / inquiries) * 100) : null,
    sources: [...sources.values()].sort((a, b) => b.inquiries - a.inquiries),
    medianFirstReplyHours: median(replyHours),
    repliedWithinHour,
    replied: replyHours.length,
    closedReasons: [...reasons.entries()]
      .map(([reason, count]) => ({ reason: lostReasonLabel[reason] ?? reason, count }))
      .sort((a, b) => b.count - a.count),
  };
}

/** "40 min", "3 hours", "2 days" — how long a studio took to answer. */
export function replyTimeLabel(hours: number | null): string {
  if (hours === null) return "—";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${Math.round(hours)} ${Math.round(hours) === 1 ? "hour" : "hours"}`;
  return `${Math.round(hours / 24)} days`;
}
