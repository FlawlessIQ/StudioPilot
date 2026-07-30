export type PhotographerRelativeDateMilestone = {
  key: "schedule_confirmation_30_days" | "event_preparation_1_day";
  daysBeforeEvent: 30 | 1;
};

const milestones: readonly PhotographerRelativeDateMilestone[] = [
  {
    key: "schedule_confirmation_30_days",
    daysBeforeEvent: 30,
  },
  {
    key: "event_preparation_1_day",
    daysBeforeEvent: 1,
  },
];

function dateParts(value: string): [number, number, number] | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return null;
  }
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return [year, month, day];
}

export function calendarDateInTimeZone(
  instant: Date,
  timeZone: string,
): string {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }
  const parts = Object.fromEntries(
    formatter
      .formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function daysUntilEvent(
  today: string,
  eventDate: string,
): number | null {
  const todayParts = dateParts(today);
  const eventParts = dateParts(eventDate);
  if (!todayParts || !eventParts) return null;
  const todayUtc = Date.UTC(
    todayParts[0],
    todayParts[1] - 1,
    todayParts[2],
  );
  const eventUtc = Date.UTC(
    eventParts[0],
    eventParts[1] - 1,
    eventParts[2],
  );
  return Math.round((eventUtc - todayUtc) / 86400000);
}

export function photographerRelativeDateMilestone(input: {
  eventDate: string;
  now: Date;
  timeZone: string;
}): PhotographerRelativeDateMilestone | null {
  const today = calendarDateInTimeZone(input.now, input.timeZone);
  const days = daysUntilEvent(today, input.eventDate);
  return (
    milestones.find((milestone) => milestone.daysBeforeEvent === days) ?? null
  );
}
