import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { Participant } from "../features/group-events/participants.ts";
import {
  GROUP_EVENT_TODAY_LIMIT,
  failedInvoiceLine,
  groupEventDay,
  groupEventShown,
  groupEventWhen,
  groupEventsForToday,
} from "../features/group-events/today-summary.ts";

/**
 * Group events on Today (features/group-events/today-summary.ts): a roster
 * event today, coming up, or recently over with money still owed, as one row.
 */

const read = (path: string) => readFileSync(path, "utf8");
const TODAY = "2026-10-10";
const event = (id: string, eventDate: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `Event ${id}`,
  eventDate,
  state: "BOOKED",
  groupEvent: { enabled: true },
  ...extra,
});
const person = (fields: Partial<Participant>): Participant => ({
  id: fields.id ?? "p",
  tenantId: "t",
  projectId: "j",
  parentName: "Dana",
  email: "dana@example.com",
  phone: null,
  athleteName: "Mia",
  team: null,
  packageName: "Digital",
  amountCents: fields.amountCents ?? 4500,
  status: fields.status ?? "unpaid",
  payment: fields.payment ?? null,
  receiptQueuedAt: null,
  createdAt: "2026-10-01T00:00:00Z",
  ...fields,
});

test("events near today, today first, then the soonest ahead, then the latest behind", () => {
  const found = groupEventsForToday(
    [
      event("past", "2026-10-04"),
      event("soon", "2026-10-12"),
      event("today", "2026-10-10"),
      event("later", "2026-10-20"),
      event("far", "2026-11-30"),
      event("old", "2026-09-01"),
      event("off", "2026-10-11", { groupEvent: { enabled: false } }),
      event("archived", "2026-10-11", { archivedAt: "2026-10-09T00:00:00Z" }),
      event("cancelled", "2026-10-11", { state: "CANCELLED" }),
      event("nodate", "", {}),
    ],
    TODAY,
  );
  assert.deepEqual(
    found.map((candidate) => candidate.id),
    ["today", "soon", "later", "past"],
  );
  assert.equal(found[0]!.dayOffset, 0);
  assert.equal(found[3]!.dayOffset, -6);
  const many = Array.from({ length: 10 }, (_, index) => event(`e${index}`, `2026-10-${String(11 + index).padStart(2, "0")}`));
  assert.equal(groupEventsForToday(many, TODAY).length, GROUP_EVENT_TODAY_LIMIT, "each roster is a live read, so they're capped");
});

test("one event's day: signed up, taken today, still to take, and failed QuickBooks invoices", () => {
  const isToday = (iso: string) => iso.startsWith(TODAY);
  const day = groupEventDay(
    [
      person({ id: "a", status: "paid", payment: { amountCents: 4500, method: "cash", paidAt: "2026-10-10T15:00:00Z", recordedBy: "u" } }),
      person({ id: "b", status: "paid", payment: { amountCents: 6500, method: "online", paidAt: "2026-10-08T15:00:00Z", recordedBy: "quickbooks" } }),
      person({ id: "c", status: "pay_on_day" }),
      person({ id: "d", status: "unpaid", qbInvoice: { state: "failed" } }),
      person({ id: "e", status: "cancelled", qbInvoice: { state: "failed" } }),
    ],
    { signup: { token: "tok_abcdefghijklmnop", options: [{ id: "a", name: "D", priceCents: 4500 }], methods: ["cash"], open: true } },
    { now: "2026-10-10T16:00:00Z", isToday },
  );
  assert.equal(day.signedUp, 4, "a cancelled place isn't signed up");
  assert.equal(day.paid, 2);
  assert.equal(day.owing, 2);
  assert.equal(day.takenTodayCents, 4500);
  assert.equal(day.collectedCents, 11000);
  assert.equal(day.outstandingCents, 9000);
  assert.equal(day.failedInvoices, 1, "a cancelled parent's failed invoice is nothing to do");
  assert.equal(day.signup, "open");
  assert.equal(failedInvoiceLine(day), "QuickBooks invoice failed");
  assert.equal(failedInvoiceLine({ ...day, failedInvoices: 3 }), "3 QuickBooks invoices failed");
});

test("a past event stays only while there's money to take or an invoice to resend", () => {
  const empty = groupEventDay([], { enabled: true }, { now: "2026-10-10T00:00:00Z", isToday: () => false });
  assert.equal(groupEventShown({ id: "x", name: "x", eventDate: "2026-10-12", dayOffset: 2, groupEvent: null }, empty), true);
  assert.equal(groupEventShown({ id: "x", name: "x", eventDate: "2026-10-04", dayOffset: -6, groupEvent: null }, empty), false);
  assert.equal(
    groupEventShown({ id: "x", name: "x", eventDate: "2026-10-04", dayOffset: -6, groupEvent: null }, { ...empty, outstandingCents: 4500 }),
    true,
  );
  assert.equal(empty.signup, "not_set_up");
});

test("when it is, in words", () => {
  assert.equal(groupEventWhen({ eventDate: TODAY, dayOffset: 0 }), "Today");
  assert.equal(groupEventWhen({ eventDate: "2026-10-11", dayOffset: 1 }), "Tomorrow");
  assert.equal(groupEventWhen({ eventDate: "2026-10-17", dayOffset: 7 }), "Sat, Oct 17");
  assert.equal(groupEventWhen({ eventDate: "2026-10-09", dayOffset: -1 }), "Fri, Oct 9 · yesterday");
  assert.equal(groupEventWhen({ eventDate: "2026-10-04", dayOffset: -6 }), "Sun, Oct 4 · 6 days ago");
});

test("Today shows it above the work, reads each roster on its own, and offers Field mode on the day", () => {
  const inbox = read("components/today/today-inbox.tsx");
  assert.match(inbox, /\{!loading \? <TodayGroupEvents \/> : null\}\s*\n\s*\{laneApprove\.length \? \(/);
  const component = read("components/today/today-group-events.tsx");
  // Not the shared tenant read: it stops at 100 records, and one cheer day can pass that.
  assert.match(component, /where\("tenantId", "==", tenantId\), where\("projectId", "==", projectId\)/);
  assert.match(component, /onTheDay \? \(\s*<Link className="button button-sm button-dark" href=\{`\/studio\/projects\/\$\{candidate\.id\}\/field`\}>/);
  assert.match(read("app/today.css"), /\.today-group-text \{[^}]*flex: 1 1 16rem;/, "the text wraps, never squeezes");
});
