/**
 * The hours a studio offers calls in, in words: "Mon–Fri, 9 AM–5 PM".
 *
 * Setup said "Clients can book a time that suits you both." once hours were
 * saved, which is true of any hours at all; a studio that tapped "Use
 * Mon–Fri, 9–5" had no way to see from setup what it had just agreed to
 * (onboarding audit, 2026-10-24). The answer is shown back instead.
 *
 * Pure, no I/O. Minutes are local to the studio's own timezone, as stored
 * (features/consultations/availability-schema.ts).
 */

import type { Weekday } from "@/features/consultations/availability-schema";

/** A studio's week, as a photographer reads it: Monday first. */
const WEEK: readonly Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const SHORT: Record<Weekday, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

type Window = { day: Weekday; startMinute: number; endMinute: number };

function isWindow(value: unknown): value is Window {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    WEEK.includes(entry.day as Weekday) &&
    typeof entry.startMinute === "number" &&
    typeof entry.endMinute === "number" &&
    entry.endMinute > entry.startMinute
  );
}

/** 540 → "9 AM", 1050 → "5:30 PM", 720 → "12 PM", 1440 → "midnight". */
export function clockTime(minute: number): string {
  if (minute >= 1440 || minute <= 0) return minute <= 0 ? "12 AM" : "midnight";
  const hours = Math.floor(minute / 60);
  const minutes = minute % 60;
  const suffix = hours < 12 ? "AM" : "PM";
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  return minutes ? `${twelve}:${String(minutes).padStart(2, "0")} ${suffix}` : `${twelve} ${suffix}`;
}

/** ["mon","tue","wed","fri"] → "Mon–Wed, Fri"; runs of three or more take a dash. */
function dayRuns(days: readonly Weekday[]): string {
  const indexes = days.map((day) => WEEK.indexOf(day)).sort((left, right) => left - right);
  const runs: number[][] = [];
  for (const index of indexes) {
    const run = runs.at(-1);
    if (run && run.at(-1) === index - 1) run.push(index);
    else runs.push([index]);
  }
  return runs
    .map((run) =>
      run.length >= 3
        ? `${SHORT[WEEK[run[0]!]!]}–${SHORT[WEEK[run.at(-1)!]!]}`
        : run.map((index) => SHORT[WEEK[index]!]).join(", "),
    )
    .join(", ");
}

/**
 * "Mon–Fri, 9 AM–5 PM" when every open day keeps the same hours; "Mon, Wed
 * and Sat, hours vary by day" when they differ; null when nothing is open.
 */
export function hoursSummary(windows: unknown): string | null {
  if (!Array.isArray(windows)) return null;
  const valid = windows.filter(isWindow);
  if (!valid.length) return null;
  const byDay = new Map<Weekday, string>();
  for (const day of WEEK) {
    const spans = valid
      .filter((window) => window.day === day)
      .sort((left, right) => left.startMinute - right.startMinute)
      .map((window) => `${clockTime(window.startMinute)}–${clockTime(window.endMinute)}`);
    if (spans.length) byDay.set(day, spans.join(" and "));
  }
  const days = [...byDay.keys()];
  const hours = new Set(byDay.values());
  const daysText = dayRuns(days);
  return hours.size === 1 ? `${daysText}, ${[...hours][0]}` : `${daysText}, hours vary by day`;
}
