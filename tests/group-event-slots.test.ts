import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  eventSignupInputSchema,
  eventSignupSettingsProblem,
  eventSignupSettingsSchema,
  eventSlots,
  normaliseEventSignup,
  normaliseSlotPlan,
  slotLabel,
  slotSpan,
  slotsWithRoom,
} from "../features/group-events/signup.ts";
import { rosterBySlot, rosterOffered, rosterProminent, type Participant } from "../features/group-events/participants.ts";
import { groupEventWords } from "../features/group-events/words.ts";
import { groupEventDay } from "../features/group-events/today-summary.ts";
import { renderEmailTemplate } from "../functions/src/communications/email-templates.ts";

/**
 * Mini-session days: one date, many families, each booking a time
 * (docs/job-types-plan-2026-10-02.md). Built on the group-event roster and
 * sign-up (docs/group-event-signup-plan-2026-10-10.md).
 */

const read = (path: string) => readFileSync(path, "utf8");
const brand = { studioName: "GR Productions", productName: "StudioCue", accentColor: null, logoUrl: null, replyTo: null } as never;

// ── The times ──

test("the studio's stretches become times, in order, each once", () => {
  const plan = normaliseSlotPlan({
    windows: [
      { start: "09:00", end: "10:00" },
      { start: "13:00", end: "13:50" },
      { start: "09:20", end: "09:40" },
    ],
    lengthMinutes: 20,
    perSlot: 1,
  });
  assert.ok(plan);
  assert.deepEqual(
    eventSlots(plan).map((slot) => slot.id),
    ["09:00", "09:20", "09:40", "13:00", "13:20"],
    "a time two stretches share is offered once; a session that wouldn't finish in its stretch isn't offered",
  );
  assert.equal(eventSlots(plan)[0]!.end, "09:20");
  assert.equal(slotSpan(plan), "9:00 AM – 1:20 PM");
  assert.equal(slotLabel("00:05"), "12:05 AM");
  assert.equal(slotLabel("12:00"), "12:00 PM");
  assert.equal(slotLabel("13:40"), "1:40 PM");
});

test("times that make no session are refused, each with its reason", () => {
  assert.equal(normaliseSlotPlan({ windows: [{ start: "12:00", end: "09:00" }], lengthMinutes: 20, perSlot: 1 }), null);
  assert.equal(normaliseSlotPlan({ windows: [{ start: "9:00", end: "12:00" }], lengthMinutes: 20, perSlot: 1 }), null, "the clock is HH:MM");
  assert.equal(normaliseSlotPlan({ windows: [{ start: "09:00", end: "12:00" }], lengthMinutes: 2, perSlot: 1 }), null);
  assert.equal(normaliseSlotPlan({ windows: [{ start: "09:00", end: "12:00" }], lengthMinutes: 20, perSlot: 0 }), null);
  const settings = (slots: unknown) =>
    eventSignupSettingsSchema.parse({ options: [{ id: "a", name: "Mini", priceCents: 15000 }], methods: ["cash"], open: true, slots });
  assert.equal(eventSignupSettingsProblem(settings(null)), null);
  assert.equal(eventSignupSettingsProblem(settings({ windows: [{ start: "09:00", end: "09:30" }], lengthMinutes: 45, perSlot: 1 })), "EVENT_SLOTS_INVALID");
  assert.equal(eventSignupSettingsProblem(settings({ windows: [{ start: "09:00", end: "12:00" }], lengthMinutes: 30, perSlot: 2 })), null);
  assert.match(read("lib/ai/friendly-error.ts"), /EVENT_SLOTS_INVALID:/);
});

test("each time says how much room it has, never who took it", () => {
  const plan = normaliseSlotPlan({ windows: [{ start: "09:00", end: "10:00" }], lengthMinutes: 30, perSlot: 2 });
  assert.deepEqual(
    slotsWithRoom(plan, { "09:00": 2, "09:30": 1 }).map(({ id, left }) => [id, left]),
    [["09:00", 0], ["09:30", 1]],
  );
  const config = normaliseEventSignup({ signup: { slots: { windows: [{ start: "09:00", end: "10:00" }], lengthMinutes: 30, perSlot: 2 } } });
  assert.equal(config.slots?.perSlot, 2);
  assert.equal(eventSignupInputSchema.shape.slot.safeParse("9:00").success, false);
  assert.equal(eventSignupInputSchema.shape.slot.parse(undefined), null);
});

// ── Booking a time ──

test("a time is required on a mini-session day, must be one of its times, and is capped in the same write", () => {
  const route = read("app/api/public/event-signup/route.ts");
  assert.match(route, /if \(config\.slots && !input\.slot\) return Response\.json\(\{ error: "EVENT_SLOT_REQUIRED" \}/);
  assert.match(route, /if \(config\.slots && !slotIds\.includes\(input\.slot \?\? ""\)\) return Response\.json\(\{ error: "EVENT_SLOT_UNAVAILABLE" \}/);
  const transaction = route.slice(route.indexOf("adminFirestore.runTransaction(async (transaction) => {\n    const roster"));
  assert.match(transaction, /\(placesOf\(live\)\.booked\[slot\] \?\? 0\) >= config\.slots\.perSlot/);
  assert.match(transaction, /chosenMethod: input\.method,\s*slot,/);
  // The page is told each time's room, not who booked it.
  assert.match(route, /slotsWithRoom\(config\.slots, taken\.booked\)\.map\(\(\{ id, label, left \}\) => \(\{ id, label, left \}\)\)/);
});

test("the studio sets the times, can move anyone, and an edit that doesn't mention a time never clears it", () => {
  const crm = read("functions/src/crm/commands.ts");
  assert.match(crm, /slots: normaliseSlotPlan\(settings\.slots\),/);
  assert.match(crm, /slot: z\.string\(\)\.trim\(\)\.regex\(\/\^\\d\{2\}:\\d\{2\}\$\/\)\.nullable\(\)\.optional\(\),/);
  assert.match(crm, /\.\.\.\(fields\.slot !== undefined \? \{ slot: fields\.slot \} : \{\}\)/);
  const roster = read("components/group-events/participant-roster.tsx");
  assert.match(roster, /\.\.\.\(slots\.length \? \{ slot: optional\(data\.get\("slot"\)\) \} : \{\}\)/);
});

// ── The day itself ──

test("a mini-session day runs by the clock: in time order, the unbooked after, cancelled last", () => {
  const person = (athleteName: string, slot: string | null, status: Participant["status"] = "unpaid") =>
    ({ athleteName, slot, status }) as Pick<Participant, "athleteName" | "status"> & { slot: string | null };
  assert.deepEqual(
    rosterBySlot([person("Cole", "10:20"), person("Ash", null), person("Bea", "09:40"), person("Dee", "09:00", "cancelled"), person("Eli", "09:40", "paid")]).map(
      (entry) => entry.athleteName,
    ),
    ["Bea", "Eli", "Cole", "Ash", "Dee"],
  );
});

test("Today says how many times are booked and, on the day, who's next", () => {
  const groupEvent = { signup: { token: "tok_abcdefghijklmnop", options: [{ id: "a", name: "Mini", priceCents: 15000 }], methods: ["cash"], open: true, slots: { windows: [{ start: "09:00", end: "10:00" }], lengthMinutes: 20, perSlot: 1 } } };
  const roster = [
    { id: "1", athleteName: "The Garcia family", slot: "09:00", status: "paid", amountCents: 15000, payment: { amountCents: 15000, method: "cash", paidAt: "2026-10-10T13:00:00Z", recordedBy: "u" } },
    { id: "2", athleteName: "The Lee family", slot: "09:40", status: "pay_on_day", amountCents: 15000, payment: null },
  ] as unknown as Participant[];
  const day = groupEventDay(roster, groupEvent, { now: "2026-10-10T13:30:00Z", isToday: () => true, clock: "09:25" });
  assert.deepEqual(day.places, { booked: 2, total: 3, perTime: 1 });
  assert.deepEqual(day.next, { time: "9:40 AM", name: "The Lee family" });
  const component = read("components/today/today-group-events.tsx");
  assert.match(component, /`\$\{day\.places\.booked\} of \$\{day\.places\.total\} \$\{day\.places\.perTime === 1 \? "times" : "places"\} booked`/);
  assert.match(component, /`Next: \$\{day\.next\.time\}, \$\{day\.next\.name\}`/);
});

// ── In its own words ──

test("a mini-session day speaks of families and booking; a team day of athletes and signing up", () => {
  assert.equal(groupEventWords({ eventKind: "sports" }).person, "athlete");
  assert.equal(groupEventWords({ eventKind: "portraits" }).person, "family");
  assert.equal(groupEventWords({ eventKind: "portraits" }).act, "Book");
  assert.equal(groupEventWords({ eventKind: "portraits" }).teamLabel, null);
  assert.equal(groupEventWords({ eventKind: "corporate" }).person, "person");
  assert.doesNotMatch(JSON.stringify(groupEventWords({ eventKind: "portraits" })), /athlete/i);
  const page = read("components/group-events/event-signup-page.tsx");
  assert.match(page, /\$\{words\.consentLead\}, and \$\{view\.studio\.name\} may use these details/);
  assert.doesNotMatch(page, /athlete’s parent or guardian/);
});

test("the roster is offered on family and portrait jobs, quietly unless it's a mini-session day", () => {
  assert.equal(rosterOffered({ eventKind: "portraits" }), true);
  assert.equal(rosterOffered({ eventKind: "wedding" }), false);
  assert.equal(rosterProminent({ eventKind: "sports" }), true);
  assert.equal(rosterProminent({ eventKind: "portraits", name: "The Okafor family" }), false);
  assert.equal(rosterProminent({ eventKind: "portraits", eventTypeLabel: "Mini sessions" }), true);
  assert.equal(rosterProminent({ eventKind: "portraits", name: "Fall mini-session day" }), true);
});

// ── The emails ──

test("the confirmation leads with the time; the invite says there's one to pick", () => {
  const confirmation = renderEmailTemplate({
    key: "group_signup_confirmation",
    brand,
    recipientName: "Ana Garcia",
    projectName: "Fall Mini Sessions",
    values: { athleteName: "The Garcia family", packageName: "Mini", amountText: "$150", confirmationCode: "K7QX2M", howToPay: "Pay in cash at the event.", slotLabel: "9:20 AM", eventKind: "portraits", actionUrl: "https://studio-cue.com/e/order/abc" },
  });
  assert.match(confirmation.subject, /You're booked for 9:20 AM for Fall Mini Sessions/);
  assert.match(confirmation.text, /at 9:20 AM\. Please arrive a few minutes early/);
  assert.match(confirmation.text, /Time: 9:20 AM/);
  assert.match(confirmation.text, /Session: The Garcia family/);
  const invite = renderEmailTemplate({
    key: "group_event_invite",
    brand,
    recipientName: null,
    projectName: "Fall Mini Sessions",
    values: { actionUrl: "https://studio-cue.com/e/tok", priceFrom: "$150", optionCount: 1, slotSpan: "9:00 AM – 11:40 AM", eventKind: "portraits" },
  });
  assert.match(invite.subject, /Book your session at Fall Mini Sessions with GR Productions/);
  assert.match(invite.text, /a time between 9:00 AM and 11:40 AM/);
  assert.match(invite.text, /Booking for two families\? Book once for each\./);
  assert.match(read("functions/src/crm/commands.ts"), /slotSpan: slotSpan\(signup\.slots\),/);
});

// ── A family moves their own time ──

test("a family can move their own time from their order page, until the day before, into a time with room", () => {
  const route = read("app/api/public/event-signup/route.ts");
  const patch = route.slice(route.indexOf("export async function PATCH"));
  assert.match(patch, /adminAppCheck\.verifyToken\(appCheckToken\)/);
  assert.match(patch, /withinRateLimit\(request,/);
  assert.match(patch, /if \(!config\.slots \|\| !eventSlots\(config\.slots\)\.some\(\(choice\) => choice\.id === slot\)\)/);
  // Counted in the same write, without their own place.
  assert.match(patch, /const others = placesOf\(docs\.filter\(\(candidate\) => candidate\.id !== participant\.id\)\);/);
  assert.match(patch, /\(others\.booked\[slot\] \?\? 0\) >= config\.slots!\.perSlot/);
  assert.match(patch, /!slotChangeOpen\(config, participant, eventDate\)\) return \{ error: "SLOT_CHANGE_CLOSED"/);
  assert.match(patch, /transaction\.update\(participant\.ref, \{ slot, updatedAt: now, updatedBy: "event_order" \}\)/);
  assert.match(patch, /action: "participant\.slot_changed"/);
  // Not a cancelled place, and not on the day itself.
  assert.match(route, /if \(!config\.slots \|\| participant\.get\("status"\) === "cancelled"\) return false;/);
  assert.match(route, /new Date\(\)\.toISOString\(\)\.slice\(0, 10\) < day/);
  const page = read("components/group-events/event-signup-page.tsx");
  assert.match(page, /method: "PATCH",/);
  assert.match(page, /orderToken && order\.canChangeSlot && view\.slots\?\.length/);
  assert.match(page, /SLOT_CHANGE_CLOSED:/);
});
