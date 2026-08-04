import type { Firestore } from "firebase-admin/firestore";
import { z } from "zod";

// Mirrors features/consultations/availability-schema.ts and
// features/consultations/slots.ts. functions/ is a separate package (own
// tsconfig, no path alias to the root), so these are intentionally
// re-declared here rather than imported — the same pattern used by
// oauth.ts's provider list and integrations/capability-resolution.ts. Keep
// this file's generateConsultationSlots in sync with the features/ copy —
// the features/ version is the one with unit test coverage (npm test), so
// changes to the algorithm should land there first and be ported here.

export const weekdaySchema = z.enum(["sun", "mon", "tue", "wed", "thu", "fri", "sat"]);
export type Weekday = z.infer<typeof weekdaySchema>;

export const availabilityWindowSchema = z
  .object({
    day: weekdaySchema,
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
  })
  .refine((window) => window.endMinute > window.startMinute, {
    message: "endMinute must be after startMinute",
  });
export type AvailabilityWindow = z.infer<typeof availabilityWindowSchema>;

export const consultationSettingsInputSchema = z.object({
  durationMinutes: z.number().int().min(15).max(120),
  bufferMinutes: z.number().int().min(0).max(60),
  windows: z.array(availabilityWindowSchema).max(21),
  blockedDates: z.array(z.string().date()).max(200),
});
export type ConsultationSettingsInput = z.infer<typeof consultationSettingsInputSchema>;

const weekdayOrder: readonly Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function offsetMinutesAt(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  }).formatToParts(instant);
  const raw = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT+00:00";
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(raw);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  minuteOfDay: number,
  timeZone: string,
): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, 0, minuteOfDay));
  const offset = offsetMinutesAt(guess, timeZone);
  const resolved = new Date(guess.getTime() - offset * 60_000);
  const offset2 = offsetMinutesAt(resolved, timeZone);
  return offset2 === offset ? resolved : new Date(guess.getTime() - offset2 * 60_000);
}

function zonedCalendarDate(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const weekdayLabel = get("weekday").toLowerCase().slice(0, 3) as Weekday;
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    weekday: weekdayOrder.includes(weekdayLabel) ? weekdayLabel : "sun",
  };
}

function addCalendarDays(year: number, month: number, day: number, days: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function isoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export type ConsultationSlot = { startsAt: string; endsAt: string };

export function generateConsultationSlots(input: {
  settings: ConsultationSettingsInput;
  timezone: string;
  now: Date;
  startInDays: number;
  daysAhead: number;
  busy: readonly { start: string; end: string }[];
  maxSlots: number;
}): ConsultationSlot[] {
  const { settings, timezone, now, startInDays, daysAhead, busy, maxSlots } = input;
  const busyMs = busy.map((interval) => ({
    start: Date.parse(interval.start),
    end: Date.parse(interval.end),
  }));
  const blocked = new Set(settings.blockedDates);
  const windowsByDay = new Map<Weekday, Array<{ startMinute: number; endMinute: number }>>();
  for (const window of settings.windows) {
    const list = windowsByDay.get(window.day) ?? [];
    list.push({ startMinute: window.startMinute, endMinute: window.endMinute });
    windowsByDay.set(window.day, list);
  }

  const today = zonedCalendarDate(now, timezone);
  const rangeStart = addCalendarDays(today.year, today.month, today.day, startInDays);
  const slots: ConsultationSlot[] = [];

  for (let offset = 0; offset < daysAhead && slots.length < maxSlots; offset += 1) {
    const { year, month, day } = addCalendarDays(rangeStart.year, rangeStart.month, rangeStart.day, offset);
    if (blocked.has(isoDate(year, month, day))) continue;
    const weekday = zonedCalendarDate(zonedTimeToUtc(year, month, day, 12 * 60, timezone), timezone).weekday;
    const windows = windowsByDay.get(weekday) ?? [];
    for (const window of windows) {
      for (
        let minute = window.startMinute;
        minute + settings.durationMinutes <= window.endMinute && slots.length < maxSlots;
        minute += settings.durationMinutes + settings.bufferMinutes
      ) {
        const start = zonedTimeToUtc(year, month, day, minute, timezone);
        const end = new Date(start.getTime() + settings.durationMinutes * 60_000);
        const bufferMs = settings.bufferMinutes * 60_000;
        const overlaps = busyMs.some(
          (interval) => start.getTime() < interval.end + bufferMs && end.getTime() + bufferMs > interval.start,
        );
        if (!overlaps) {
          slots.push({ startsAt: start.toISOString(), endsAt: end.toISOString() });
        }
      }
    }
  }

  return slots.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

const defaultSettings: ConsultationSettingsInput = {
  durationMinutes: 45,
  bufferMinutes: 15,
  windows: (["mon", "tue", "wed", "thu", "fri"] as const).map((day) => ({
    day,
    startMinute: 9 * 60,
    endMinute: 17 * 60,
  })),
  blockedDates: [],
};

/**
 * The tenant's configured consultationSettings/{tenantId} doc, or a
 * Mon-Fri 9-5 default (matching the previous hardcoded startHour/endHour=
 * 9/17 behavior) when the studio hasn't configured one yet.
 */
export async function getConsultationSettings(
  db: Firestore,
  tenantId: string,
): Promise<ConsultationSettingsInput> {
  const doc = await db.doc(`consultationSettings/${tenantId}`).get();
  if (!doc.exists) return defaultSettings;
  const parsed = consultationSettingsInputSchema.safeParse(doc.data());
  return parsed.success ? parsed.data : defaultSettings;
}
