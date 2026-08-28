/**
 * The four figures the studio home page leads with.
 *
 * Every one of these is derived from data the dashboard already subscribes to.
 * `invoiceReferences` in particular was being fetched and used only to detect a
 * single overdue exception, so the page held every balance in the studio and
 * displayed no money at all.
 */

import { activeProjectStates } from "@/features/dashboard/active-states";
import { daysUntilEvent, eventDateHasPassed } from "@/lib/format/event-date";

export type MetricRecord = Record<string, unknown> & { id: string };

export type HomeMetrics = {
  /** Events with a date inside the current calendar month. */
  eventsThisMonth: number;
  /** How many of them are still ahead of today. */
  eventsThisMonthRemaining: number;
  /** The soonest upcoming event, for the "next up" note. */
  nextEvent: { name: string; eventDate: string; daysAway: number } | null;
  bookedValueCents: number;
  outstandingCents: number;
  collectedCents: number;
  /** Invoices past due with a balance still owed. */
  overdueInvoiceCount: number;
  /** Active projects below full readiness. */
  needsAttentionCount: number;
  /**
   * Active projects whose event date has passed. A project here has slipped and
   * cannot be recovered by working faster — it needs a decision.
   */
  eventPassedCount: number;
};

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

const cents = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

function isActive(project: MetricRecord): boolean {
  return activeProjectStates.has(text(project.state));
}

export function homeMetrics(input: {
  now: Date;
  projects?: readonly MetricRecord[] | null;
  invoiceReferences?: readonly MetricRecord[] | null;
}): HomeMetrics {
  const now = input.now;
  const today = now.toISOString().slice(0, 10);
  const projects = (input.projects ?? []).filter(isActive);
  const invoices = input.invoiceReferences ?? [];

  const thisMonth = projects.filter((project) => {
    const date = text(project.eventDate).slice(0, 10);
    return (
      date.slice(0, 4) === String(now.getFullYear()) &&
      date.slice(5, 7) === String(now.getMonth() + 1).padStart(2, "0")
    );
  });
  const eventsThisMonth = thisMonth.length;
  /**
   * How many of this month's events are still ahead.
   *
   * On 27 August the tile read "3 events this month · on the books" when all
   * three had already been shot. "On the books" reads as work coming, so the
   * count described the calendar rather than the studio's position in it.
   */
  const eventsThisMonthRemaining = thisMonth.filter(
    (project) => text(project.eventDate).slice(0, 10) >= today,
  ).length;

  const upcoming = projects
    .map((project) => ({
      name: text(project.name),
      eventDate: text(project.eventDate).slice(0, 10),
      daysAway: daysUntilEvent(project.eventDate, now),
    }))
    .filter(
      (entry): entry is { name: string; eventDate: string; daysAway: number } =>
        Boolean(entry.eventDate) &&
        entry.daysAway !== null &&
        entry.daysAway >= 0,
    )
    .sort((left, right) => left.daysAway - right.daysAway);

  const bookedValueCents = invoices.reduce(
    (sum, invoice) => sum + cents(invoice.amountCents),
    0,
  );
  const outstandingCents = invoices.reduce(
    (sum, invoice) => sum + cents(invoice.balanceCents),
    0,
  );

  const overdueInvoiceCount = invoices.filter(
    (invoice) =>
      cents(invoice.balanceCents) > 0 &&
      text(invoice.dueDate) !== "" &&
      text(invoice.dueDate) < today &&
      !["voided", "refunded", "paid"].includes(text(invoice.status)),
  ).length;

  return {
    eventsThisMonth,
    eventsThisMonthRemaining,
    nextEvent: upcoming[0] ?? null,
    bookedValueCents,
    outstandingCents,
    collectedCents: Math.max(0, bookedValueCents - outstandingCents),
    overdueInvoiceCount,
    needsAttentionCount: projects.filter(
      (project) => Number(project.readinessScore ?? 0) < 100,
    ).length,
    eventPassedCount: projects.filter((project) =>
      eventDateHasPassed(project.eventDate, now),
    ).length,
  };
}

/**
 * The hero's counted subhead. Replaces a hardcoded sentence that claimed
 * StudioCue had prepared work whether or not it had, which is what made the
 * home page feel like it was asserting intelligence rather than showing it.
 *
 * Returns null when there is genuinely nothing to report, so the caller can
 * say something true instead of padding.
 */
export function describeStudioState(input: {
  metrics: HomeMetrics;
  approvalCount: number;
  workingCount: number;
}): string | null {
  const { metrics, approvalCount, workingCount } = input;
  const parts: string[] = [];

  if (metrics.eventsThisMonth > 0) {
    parts.push(
      `${metrics.eventsThisMonth} event${metrics.eventsThisMonth === 1 ? "" : "s"} this month`,
    );
  }
  if (approvalCount > 0) {
    parts.push(
      `${approvalCount} draft${approvalCount === 1 ? "" : "s"} ready for your approval`,
    );
  }
  if (workingCount > 0) {
    parts.push(
      `${workingCount} ${workingCount === 1 ? "job" : "jobs"} running`,
    );
  }
  if (metrics.overdueInvoiceCount > 0) {
    parts.push(
      `${metrics.overdueInvoiceCount} overdue balance${metrics.overdueInvoiceCount === 1 ? "" : "s"}`,
    );
  }
  if (!parts.length) return null;

  const sentence =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

/** Time-of-day greeting. The old hero said "Good morning" at any hour. */
export function greetingFor(now: Date): string {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
