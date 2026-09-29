"use client";

import { useMemo, useState } from "react";

export type Slot = { startsAt: string; endsAt: string };

/**
 * Pick a time: days as big tiles, then that day's times as big buttons.
 *
 * Replaces a list that scrolled inside its own 560 px box, day after day of
 * radio buttons, on the couple's inquiry link and the consultation invite
 * (M2 of docs/mobile-first-client-crew-plan-2026-09-28.md). Everything stays in
 * the page's own scroll, and every target is at least 52 px.
 */
export function SlotPicker({
  slots,
  timezone,
  selected,
  onSelect,
  maxDays = 8,
}: {
  slots: readonly Slot[];
  timezone: string;
  selected: string;
  onSelect: (startsAt: string) => void;
  maxDays?: number;
}) {
  const zone = timezone || undefined;
  const days = useMemo(() => {
    const byDay = new Map<string, Slot[]>();
    for (const slot of slots) {
      const key = new Intl.DateTimeFormat("en-CA", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        timeZone: zone,
      }).format(new Date(slot.startsAt));
      byDay.set(key, [...(byDay.get(key) ?? []), slot]);
    }
    return [...byDay.entries()].slice(0, maxDays).map(([key, daySlots]) => {
      const first = new Date(daySlots[0]!.startsAt);
      const part = (options: Intl.DateTimeFormatOptions) =>
        new Intl.DateTimeFormat("en-US", { ...options, timeZone: zone }).format(first);
      return {
        key,
        weekday: part({ weekday: "short" }),
        day: part({ day: "numeric" }),
        month: part({ month: "short" }),
        long: part({ weekday: "long", month: "long", day: "numeric" }),
        slots: daySlots,
      };
    });
  }, [slots, zone, maxDays]);

  const [dayKey, setDayKey] = useState<string | null>(null);
  const selectedDay =
    days.find((day) => day.slots.some((slot) => slot.startsAt === selected))?.key ?? null;
  const activeKey = dayKey ?? selectedDay ?? days[0]?.key ?? null;
  const active = days.find((day) => day.key === activeKey) ?? null;

  if (!days.length) return null;

  const time = (startsAt: string) =>
    new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: zone }).format(
      new Date(startsAt),
    );

  return (
    <div className="kit-stack">
      <div aria-label="Day" className="kit-day-grid" role="group">
        {days.map((day) => (
          <button
            aria-label={day.long}
            aria-pressed={day.key === activeKey}
            className="kit-day"
            key={day.key}
            onClick={() => setDayKey(day.key)}
            type="button"
          >
            <span className="kit-day-weekday">{day.weekday}</span>
            <span className="kit-day-number">{day.day}</span>
            <span className="kit-day-month">{day.month}</span>
          </button>
        ))}
      </div>
      {active ? (
        <div aria-label={`Times on ${active.long}`} className="kit-time-grid" role="group">
          {active.slots.map((slot) => (
            <button
              aria-pressed={slot.startsAt === selected}
              className="kit-time"
              key={slot.startsAt}
              onClick={() => onSelect(slot.startsAt)}
              type="button"
            >
              {time(slot.startsAt)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** "Tue, Oct 6 · 11:30 AM" for a button that books it. */
export function slotLabel(startsAt: string, timezone: string): string {
  const zone = timezone || undefined;
  const date = new Date(startsAt);
  const day = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: zone,
  }).format(date);
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: zone,
  }).format(date);
  return `${day} · ${time}`;
}
