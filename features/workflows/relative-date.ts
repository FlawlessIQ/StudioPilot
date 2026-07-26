import type { DueDateRule } from "./schema";

export type DueDateAnchors = {
  eventDate: string;
  projectCreatedDate: string;
  bookingDate: string | null;
  workflowStartedDate: string;
};

function addUtcDays(date: string, days: number): string {
  const parsed = new Date(`${date}T12:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf())) throw new Error(`Invalid date anchor: ${date}`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function resolveDueDate(
  rule: DueDateRule,
  anchors: DueDateAnchors,
): string | null {
  if (rule.type === "none") return null;
  if (rule.type === "absolute") return rule.date;

  const anchor = {
    event_date: anchors.eventDate,
    project_created: anchors.projectCreatedDate,
    booking_date: anchors.bookingDate,
    workflow_started: anchors.workflowStartedDate,
  }[rule.anchor];

  if (!anchor) {
    throw new Error(`Due-date anchor ${rule.anchor} is unavailable.`);
  }
  return addUtcDays(anchor, rule.offsetDays);
}
