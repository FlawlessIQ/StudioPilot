import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { generateConsultationSlots } from "@/features/consultations/slots";
import { nextBlockedSlots, slotIsBlocked } from "@/features/consultations/blocked-slots";
import { generateConsultationSlots as serverSlots } from "../functions/src/booking/availability.ts";

/**
 * Conor, 2026-10-13: "should the user be able to block select slots on
 * individual days" — a Block button beside Book. A block is busy time, so the
 * studio's calendar, every call type and every couple's booking link stop
 * offering it.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const settings = {
  durationMinutes: 45,
  bufferMinutes: 15,
  mode: "closed_default" as const,
  windows: [{ day: "thu" as const, startMinute: 9 * 60, endMinute: 12 * 60 }],
  unavailableWindows: [],
  blockedDates: [],
  meetingFormats: ["zoom" as const],
  inPersonLocation: null,
};
const now = new Date("2026-10-13T12:00:00Z");
const nine = { startsAt: "2026-10-15T13:00:00.000Z", endsAt: "2026-10-15T13:45:00.000Z" };
const run = (blockedSlots: Array<{ startsAt: string; endsAt: string }>, generate: typeof generateConsultationSlots) =>
  generate({ settings: { ...settings, blockedSlots }, timezone: "America/New_York", now, startInDays: 0, daysAhead: 4, busy: [], maxSlots: 50 }).map((slot) => slot.startsAt);

test("a blocked time isn't offered, on the studio's calendar or a couple's link; its neighbors are", () => {
  for (const generate of [generateConsultationSlots, serverSlots as unknown as typeof generateConsultationSlots]) {
    const open = run([], generate);
    assert.deepEqual(open, ["2026-10-15T13:00:00.000Z", "2026-10-15T14:00:00.000Z", "2026-10-15T15:00:00.000Z"]);
    assert.deepEqual(run([nine], generate), ["2026-10-15T14:00:00.000Z", "2026-10-15T15:00:00.000Z"]);
  }
});

test("block, unblock, and past blocks fall away", () => {
  const blocked = nextBlockedSlots([], nine, true, now.toISOString());
  assert.deepEqual(blocked, [nine]);
  assert.ok(slotIsBlocked(nine, blocked));
  assert.ok(slotIsBlocked({ startsAt: "2026-10-15T13:30:00.000Z", endsAt: "2026-10-15T15:30:00.000Z" }, blocked), "a longer trial over it is blocked too");
  assert.ok(!slotIsBlocked({ startsAt: "2026-10-15T14:00:00.000Z", endsAt: "2026-10-15T14:45:00.000Z" }, blocked));
  assert.deepEqual(nextBlockedSlots(blocked, nine, false, now.toISOString()), []);
  const past = { startsAt: "2026-10-01T13:00:00.000Z", endsAt: "2026-10-01T13:45:00.000Z" };
  assert.deepEqual(nextBlockedSlots([past], nine, true, now.toISOString()), [nine], "yesterday's block is pruned on the next write");
  assert.deepEqual(nextBlockedSlots([nine], nine, true, now.toISOString()), [nine], "blocking twice keeps one");
});

test("the mirror matches", () => {
  const body = (path: string) => read(path).slice(read(path).indexOf("export const MAX_BLOCKED_SLOTS"));
  assert.equal(body("functions/src/booking/blocked-slots.ts"), body("features/consultations/blocked-slots.ts"));
});

test("wired: its own command, and a settings save keeps the blocks", () => {
  const commands = read("functions/src/booking/commands.ts");
  assert.match(commands, /type: z\.literal\("setSlotBlocked"\),/);
  assert.match(commands, /blockedSlots: Array\.isArray\(before\?\.blockedSlots\) \? before\.blockedSlots : \[\],/);
  assert.match(commands, /const next = nextBlockedSlots\(current, command\.input, command\.input\.blocked, timestamp\);/);
  const calendar = read("components/booking/studio-calendar.tsx");
  assert.match(calendar, /type: "setSlotBlocked",/);
  assert.match(calendar, /settings: \{ \.\.\.settings, blockedSlots: \[\] \},/, "blocked times stay listed, to unblock");
  assert.match(calendar, /\(slot\) => !selectedBookedKeys\.has\(slot\.startsAt\) && !isSlotBlocked\(slot\),/, "never offered when moving a booking");
});

test("today's times that have already gone are never offered", async () => {
  const { generateConsultationSlots } = await import("../features/consultations/slots");
  const slots = generateConsultationSlots({
    settings: {
      durationMinutes: 45,
      bufferMinutes: 15,
      windows: (["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const).map((day) => ({ day, startMinute: 9 * 60, endMinute: 17 * 60 })),
      blockedDates: [],
    },
    timezone: "America/New_York",
    // Friday 2026-10-23, 4:22 PM in New York.
    now: new Date("2026-10-23T20:22:00Z"),
    startInDays: 0,
    daysAhead: 1,
    busy: [],
    maxSlots: 50,
  });
  assert.deepEqual(slots, []);
});
