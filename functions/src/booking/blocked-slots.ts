export type BlockedSlot = { startsAt: string; endsAt: string };

/**
 * Single blocked times on the studio calendar (Conor, 2026-10-13: "block
 * select slots on individual days"). A block is a busy interval, so slot
 * generation drops anything it overlaps (slots.ts, and the server's copy in
 * functions/src/booking/availability.ts): the studio's calendar, every call
 * type, and every couple's booking link. Pure; mirror of
 * features/consultations/blocked-slots.ts (tests/slot-blocking.test.ts).
 */

export const MAX_BLOCKED_SLOTS = 500;

type Interval = { startsAt: string; endsAt: string };

const overlaps = (a: Interval, b: Interval) =>
  Date.parse(a.startsAt) < Date.parse(b.endsAt) && Date.parse(b.startsAt) < Date.parse(a.endsAt);

/** Whether a slot falls inside one of the studio's blocks. */
export function slotIsBlocked(slot: Interval, blocked: readonly BlockedSlot[]): boolean {
  return blocked.some((block) => overlaps(slot, block));
}

/** The list after blocking or unblocking `slot`, without anything already over. */
export function nextBlockedSlots(blocked: readonly BlockedSlot[], slot: Interval, block: boolean, nowIso: string): BlockedSlot[] {
  const current = blocked.filter((item) => Date.parse(item.endsAt) > Date.parse(nowIso));
  const without = current.filter((item) => !overlaps(item, slot));
  const next = block ? [...without, { startsAt: slot.startsAt, endsAt: slot.endsAt }] : without;
  return next.sort((a, b) => a.startsAt.localeCompare(b.startsAt)).slice(-MAX_BLOCKED_SLOTS);
}
