import assert from "node:assert/strict";
import test from "node:test";
import { generateConsultationSlots } from "@/features/consultations/slots";

// Sunday 2026-01-04 07:00 America/New_York (EST, UTC-5) — "today" for
// startInDays=1 tests below, landing range start on Monday 2026-01-05.
const winterSunday = new Date("2026-01-04T12:00:00.000Z");
// Sunday 2026-07-05 08:00 America/New_York (EDT, UTC-4).
const summerSunday = new Date("2026-07-05T12:00:00.000Z");

const mondayNineToFive = [{ day: "mon" as const, startMinute: 9 * 60, endMinute: 17 * 60 }];

test("generates slots at the correct UTC instant for EST (winter)", () => {
  const slots = generateConsultationSlots({
    settings: { durationMinutes: 60, bufferMinutes: 0, windows: mondayNineToFive, blockedDates: [] },
    timezone: "America/New_York",
    now: winterSunday,
    startInDays: 1,
    daysAhead: 1,
    busy: [],
    maxSlots: 40,
  });
  assert.equal(slots.length, 8);
  assert.equal(slots[0]?.startsAt, "2026-01-05T14:00:00.000Z");
  assert.equal(slots[0]?.endsAt, "2026-01-05T15:00:00.000Z");
  assert.equal(slots.at(-1)?.startsAt, "2026-01-05T21:00:00.000Z");
});

test("generates slots at the correct UTC instant for EDT (summer) — DST offset actually applied", () => {
  const slots = generateConsultationSlots({
    settings: { durationMinutes: 60, bufferMinutes: 0, windows: mondayNineToFive, blockedDates: [] },
    timezone: "America/New_York",
    now: summerSunday,
    startInDays: 1,
    daysAhead: 1,
    busy: [],
    maxSlots: 40,
  });
  assert.equal(slots[0]?.startsAt, "2026-07-06T13:00:00.000Z");
});

test("blocked dates suppress every slot on that local calendar date but not the following week", () => {
  const slots = generateConsultationSlots({
    settings: {
      durationMinutes: 60,
      bufferMinutes: 0,
      windows: mondayNineToFive,
      blockedDates: ["2026-01-05"],
    },
    timezone: "America/New_York",
    now: winterSunday,
    startInDays: 1,
    daysAhead: 8,
    busy: [],
    maxSlots: 40,
  });
  assert.ok(slots.every((slot) => !slot.startsAt.startsWith("2026-01-05")));
  assert.ok(slots.some((slot) => slot.startsAt.startsWith("2026-01-12")));
});

test("busy intervals exclude overlapping slots with buffer padding on both sides", () => {
  const slots = generateConsultationSlots({
    settings: { durationMinutes: 60, bufferMinutes: 15, windows: mondayNineToFive, blockedDates: [] },
    timezone: "America/New_York",
    now: winterSunday,
    startInDays: 1,
    daysAhead: 1,
    // Busy 10:00-11:00 EST (15:00-16:00Z). At 60min duration + 15min buffer,
    // candidate slots start 75min apart: 9:00, 10:15, 11:30, ... EST. The
    // 9:00 and 10:15 slots both fall within 15 minutes of the busy block
    // once buffer padding is applied; 11:30 (16:30Z) is the first clear of it.
    busy: [{ start: "2026-01-05T15:00:00.000Z", end: "2026-01-05T16:00:00.000Z" }],
    maxSlots: 40,
  });
  assert.ok(!slots.some((slot) => slot.startsAt === "2026-01-05T14:00:00.000Z"));
  assert.ok(!slots.some((slot) => slot.startsAt === "2026-01-05T15:15:00.000Z"));
  assert.ok(slots.some((slot) => slot.startsAt === "2026-01-05T16:30:00.000Z"));
});

test("multiple windows on the same weekday produce a gap for the break between them", () => {
  const windows = [
    { day: "mon" as const, startMinute: 9 * 60, endMinute: 12 * 60 },
    { day: "mon" as const, startMinute: 13 * 60, endMinute: 17 * 60 },
  ];
  const slots = generateConsultationSlots({
    settings: { durationMinutes: 60, bufferMinutes: 0, windows, blockedDates: [] },
    timezone: "America/New_York",
    now: winterSunday,
    startInDays: 1,
    daysAhead: 1,
    busy: [],
    maxSlots: 40,
  });
  assert.equal(slots.length, 7);
  assert.ok(!slots.some((slot) => slot.startsAt === "2026-01-05T17:00:00.000Z"));
});

test("maxSlots caps the result even when more windows are available", () => {
  const slots = generateConsultationSlots({
    settings: { durationMinutes: 60, bufferMinutes: 0, windows: mondayNineToFive, blockedDates: [] },
    timezone: "America/New_York",
    now: winterSunday,
    startInDays: 1,
    daysAhead: 1,
    busy: [],
    maxSlots: 3,
  });
  assert.equal(slots.length, 3);
});

test("a weekday with no configured windows produces no slots", () => {
  const slots = generateConsultationSlots({
    settings: { durationMinutes: 60, bufferMinutes: 0, windows: mondayNineToFive, blockedDates: [] },
    timezone: "America/New_York",
    now: winterSunday,
    startInDays: 2,
    daysAhead: 1,
    busy: [],
    maxSlots: 40,
  });
  assert.deepEqual(slots, []);
});
