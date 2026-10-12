import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { trialInvite, trialState, trialWanted, trialWhen } from "../features/consultations/trial";
import { generateConsultationSlots } from "../features/consultations/slots";
import { projectJourney, type JourneyInput } from "../features/journey/steps";
import { todayInbox } from "../features/today/inbox";
import { clientExtensionPlan, extensionPlanFromAnswer } from "../features/trades/extensions";
import { tradeProfile } from "../features/trades/trades";
import { activeDayKey } from "../components/kit/slot-picker";
import { noOpeningsThatWeek } from "../components/booking/public-consultation-scheduler";
import { generateConsultationSlots as serverSlots } from "../functions/src/booking/availability";
import { daysBetween, studioDay, trialLinkDays, trialSlotPlan, trialWindow } from "../functions/src/booking/trial-window";
import { tradeProfile as serverTradeProfile } from "../functions/src/trades/trades";

/**
 * The hair trial, walked on production (Priya Shah, Jess Styles Bridal,
 * 2026-10-10): once booked it must show as booked, on the job's card and its
 * journey; it can be booked months ahead, when the veil is chosen; every
 * time offered leaves room for the trial itself; a client who bought one is
 * invited to it from Today; and the trial card starts from what the client
 * said about extensions. A photographer's journey and Today are unchanged.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// ---------- F8 / F9: a booked trial shows as booked ----------

const booked: JourneyInput = {
  projectId: "job1",
  state: "PLANNING",
  eventDate: "2027-05-22",
  today: "2026-10-10",
  lead: null,
  hasConsultation: false,
  proposalStatus: "accepted",
  contractStatus: "completed",
  retainerInvoiceStatus: "paid",
  finalInvoiceStatus: null,
  questionnaireStatus: null,
  questionnaireHasAnswers: false,
  scheduleStatus: null,
  scheduleHasUsableItems: false,
  crewAccepted: 0,
  crewRequired: 0,
  crewCascadeActive: false,
  coiStatus: null,
  insuranceRequired: "not_required",
  dayBeforeDraftStatus: null,
  hasDelivery: false,
  albumOrReviewDone: false,
  trade: "hair",
};

const trialStep = (input: JourneyInput) => projectJourney(input).steps.find((step) => step.key === "trial");

test("a booked trial is in motion on the rail with its date, and never the next move", () => {
  const consultations = [{ purpose: "trial", status: "scheduled", startsAt: "2026-10-14T14:00:00.000Z", timezone: "America/Chicago" }];
  // On the job's clock, not the trial record's or the reader's.
  const when = trialWhen({ consultations, timeZone: "America/New_York" });
  assert.equal(when, "Wed, Oct 14 at 10:00 AM");
  assert.equal(trialWhen({ consultations, timeZone: null }), "Wed, Oct 14 at 9:00 AM");
  assert.equal(trialWhen({ consultations: [], timeZone: "America/New_York" }), null);

  const state = trialState({ consultations, now: "2026-10-10T15:00:00.000Z" });
  const step = trialStep({ ...booked, trial: { ...state, when } });
  assert.equal(step?.status, "waiting_other");
  assert.equal(step?.detail, "Booked for Wed, Oct 14 at 10:00 AM");
  assert.equal(step?.explain, true, "the rail shows the date, not the title alone");
  assert.equal(step?.action, null);
  assert.equal(step?.unlock, null, "not 'Unlocks when the steps above are done'");

  // The next move is whatever it was without the trial.
  const before = projectJourney({ ...booked, trial: { state: "not_booked", startsAt: null } });
  const after = projectJourney({ ...booked, trial: { ...state, when } });
  assert.equal(after.current?.key, before.current?.key);
  assert.notEqual(after.current?.key, "trial");

  // Not booked: optional and grey, as before. Held: done.
  assert.equal(trialStep({ ...booked, trial: { state: "not_booked", startsAt: null } })?.status, "upcoming");
  assert.equal(trialStep({ ...booked, trial: { state: "held", startsAt: "2026-10-01T14:00:00.000Z" } })?.status, "complete");
  // Without a label, the step still dates it.
  assert.match(String(trialStep({ ...booked, trial: { state: "booked", startsAt: "2026-10-14T14:00:00.000Z" } })?.detail), /^Booked for Wed, Oct 14/);
  // A photographer's journey has no trial step at all.
  assert.equal(trialStep({ ...booked, trade: "photographer", trial: { ...state, when } }), undefined);
});

test("the job's trial card says when it is booked, and the invite steps back", () => {
  const page = read("components/projects/live-project-detail.tsx");
  assert.match(page, /trial\.when \? `Booked for \$\{trial\.when\}` : "Booked"/);
  assert.match(page, /label="Send the link again"/);
  assert.match(page, /Note what you settled on below\./);
  // One reading for the card and the step.
  assert.match(read("components/projects/use-project-journey.ts"), /trialWhen\(\{ consultations: forProject\(consultations\.records\), timeZone:/);
  assert.match(read("components/projects/project-job-plan.tsx"), /if \(step\.key === "trial"\) return "Booked";/);
});

// ---------- F10: a trial can be booked months ahead ----------

test("a trial window runs from tomorrow to the day before the event, a week at a time", () => {
  const today = "2026-10-10";
  const eventDate = "2027-05-22";
  assert.deepEqual(trialWindow({ today, eventDate }), {
    start: "2026-10-11",
    end: "2026-10-17",
    earliest: "2026-10-11",
    latest: "2027-05-21",
    previous: null,
    next: "2026-10-18",
  });
  // Months later, once the veil is chosen.
  assert.deepEqual(trialWindow({ today, eventDate, from: "2027-03-08" }), {
    start: "2027-03-08",
    end: "2027-03-14",
    earliest: "2026-10-11",
    latest: "2027-05-21",
    previous: "2027-03-01",
    next: "2027-03-15",
  });
  // The last week stops the day before; nothing past it or before tomorrow.
  const last = trialWindow({ today, eventDate, from: "2027-05-19" });
  assert.deepEqual([last?.start, last?.end, last?.next], ["2027-05-19", "2027-05-21", null]);
  assert.deepEqual([trialWindow({ today, eventDate, from: "2028-01-01" })?.start, trialWindow({ today, eventDate, from: "2028-01-01" })?.end], ["2027-05-21", "2027-05-21"]);
  assert.equal(trialWindow({ today, eventDate, from: "2026-10-01" })?.start, "2026-10-11");
  assert.equal(trialWindow({ today, eventDate, from: "2026-10-13" })?.previous, "2026-10-11");
  assert.equal(trialWindow({ today, eventDate, from: "not a date" })?.start, "2026-10-11");
  // No day left to book.
  assert.equal(trialWindow({ today, eventDate: "2026-10-11" }), null);
  assert.equal(trialWindow({ today, eventDate: "2026-09-01" }), null);
  // No date on the job: a year ahead.
  assert.equal(trialWindow({ today, eventDate: null })?.latest, "2027-10-10");
  // The studio's clock decides "today".
  assert.equal(studioDay(new Date("2026-10-11T02:00:00.000Z"), "America/New_York"), "2026-10-10");
});

test("a trial link stays open to the day before the event; a call's link is unchanged", () => {
  assert.equal(trialLinkDays({ today: "2026-10-10", eventDate: "2027-05-22" }), daysBetween("2026-10-10", "2027-05-21") + 1);
  assert.equal(trialLinkDays({ today: "2026-10-10", eventDate: "2026-10-15" }), 14);
  assert.equal(trialLinkDays({ today: "2026-10-10", eventDate: null }), 365);
  const server = read("functions/src/booking/public-scheduling.ts");
  assert.match(server, /isAppointment\(\{ purpose: command\.input\.purpose \}\)\s*\? trialLinkDays\(/);
  assert.match(server, /: BOOKING_LINK_DAYS,/);
  // The browse is the trial's alone, and booking re-checks the pick against
  // the same week on the server.
  assert.match(server, /isAppointment\(link\.data\(\)\)\s*\? await trialSlotsFor\(/);
  assert.match(server, /\{ at: command\.input\.startsAt \}/);
  assert.match(server, /if \(!selected\) throw new Error\("TIME_NO_LONGER_AVAILABLE"\);/);
  const page = read("components/booking/public-consultation-scheduler.tsx");
  assert.match(page, /className="kit-week-nav"/);
  assert.match(page, /input: \{ token, from \}/);
  // Wraps, never squeezes; narrow, the dates take their own row above both
  // buttons rather than leaving "Later" alone on the next line.
  const css = read("app/kit.css");
  assert.match(css, /\.kit-week-nav \{\s*container-type: inline-size;\s*container-name: kit-week-nav;\s*display: flex;\s*flex-wrap: wrap;/);
  assert.match(css, /@container kit-week-nav \(max-width: 22rem\) \{\s*\.kit-week-nav-label \{\s*order: -1;\s*flex-basis: 100%;/);
});

// A week's openings are the server's, and so is the check on a pick: a
// Monday-to-Friday, nine-to-five studio with 45-minute calls and 15 minutes
// between, asked for a two-hour hair trial.
const studio = {
  durationMinutes: 45,
  bufferMinutes: 15,
  mode: "closed_default" as const,
  windows: (["mon", "tue", "wed", "thu", "fri"] as const).map((day) => ({ day, startMinute: 9 * 60, endMinute: 17 * 60 })),
  unavailableWindows: [],
  blockedDates: [],
  meetingFormats: ["zoom" as const],
  inPersonLocation: null,
};
// Monday, Oct 12, 9:00 AM in New York.
const MONDAY = new Date("2026-10-12T13:00:00.000Z");
const weekOf = (input: { from?: string | null; at?: string | null; eventDate?: unknown; busy?: { start: string; end: string }[]; settings?: typeof studio }) => {
  const settings = input.settings ?? studio;
  const plan = trialSlotPlan({
    now: MONDAY,
    timezone: "America/New_York",
    eventDate: input.eventDate === undefined ? "2027-05-21" : input.eventDate,
    from: input.from ?? null,
    at: input.at ?? null,
    callMinutes: settings.durationMinutes,
    bufferMinutes: settings.bufferMinutes,
    trialMinutes: 120,
  });
  if (!plan) return null;
  const slots = serverSlots({
    settings: { ...settings, durationMinutes: plan.durationMinutes },
    timezone: "America/New_York",
    now: MONDAY,
    startInDays: plan.startInDays,
    daysAhead: plan.daysAhead,
    busy: input.busy ?? [],
    maxSlots: plan.maxSlots,
    stepMinutes: plan.stepMinutes,
  });
  return { plan, slots };
};
/** What booking does with a pick: the week it starts in, and whether the pick is one of its openings. */
const bookable = (at: string, busy?: { start: string; end: string }[]) =>
  Boolean(weekOf({ at, busy })?.slots.some((slot) => slot.startsAt === at));

test("a trial pick is checked on the server against the week it falls in", () => {
  // Tomorrow, 10:00 AM: open.
  assert.equal(bookable("2026-10-13T14:00:00.000Z"), true);
  // Today, 2:00 PM: before tomorrow, never offered.
  assert.equal(bookable("2026-10-12T18:00:00.000Z"), false);
  // The day before a Friday event (Thursday) is open; the event day is not.
  assert.equal(bookable("2027-05-20T14:00:00.000Z"), true);
  assert.equal(bookable("2027-05-21T14:00:00.000Z"), false);
  assert.equal(bookable("2027-06-01T14:00:00.000Z"), false, "after the event");
  // Months ahead, once the veil is chosen: 3:00 PM ends at 5:00, the end of
  // the studio's day; 4:00 PM would run past it; Saturday has no hours.
  assert.equal(bookable("2027-03-09T20:00:00.000Z"), true);
  assert.equal(bookable("2027-03-09T21:00:00.000Z"), false);
  assert.equal(bookable("2027-03-09T15:30:00.000Z"), false, "10:30 AM is off the studio's cadence");
  assert.equal(bookable("2027-03-13T15:00:00.000Z"), false);
  // Something already in the studio's calendar takes it.
  assert.equal(bookable("2027-03-09T15:00:00.000Z", [{ start: "2027-03-09T16:00:00.000Z", end: "2027-03-09T17:00:00.000Z" }]), false);
  // No day left to book.
  assert.equal(weekOf({ eventDate: "2026-10-13" }), null);

  // The week shown, and how it asks: on the studio's cadence, for the whole trial.
  const march = weekOf({ from: "2027-03-08" })!;
  assert.deepEqual([march.plan.window.start, march.plan.window.end], ["2027-03-08", "2027-03-14"]);
  assert.equal(march.plan.startInDays, daysBetween("2026-10-12", "2027-03-08"));
  assert.equal(march.plan.daysAhead, 7);
  assert.equal(march.plan.durationMinutes, 120);
  assert.equal(march.plan.stepMinutes, 60);
  assert.equal(march.slots.length, 35, "nine to three, hourly, Monday to Friday");
  // Booked calls and the calendar are read a day either side of the week.
  assert.equal(march.plan.busyFrom, "2027-03-07T00:00:00.000Z");
  assert.equal(march.plan.busyTo, "2027-03-16T00:00:00.000Z");
  // A trade with no trial length takes the studio's call length.
  assert.equal(
    trialSlotPlan({ now: MONDAY, timezone: "America/New_York", eventDate: null, callMinutes: 45, bufferMinutes: 15, trialMinutes: null })?.durationMinutes,
    45,
  );
  const server = read("functions/src/booking/public-scheduling.ts");
  assert.match(server, /const plan = trialSlotPlan\(\{/);
  assert.match(server, /maxSlots: plan\.maxSlots,/);
});

test("a week of short starts over long days is offered whole, not cut off partway", () => {
  // A 15-minute call with no buffer, open eight to eight every day: a
  // two-hour trial starts every 15 minutes, 41 times a day.
  const everyDay = {
    ...studio,
    durationMinutes: 15,
    bufferMinutes: 0,
    windows: (["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const).map((day) => ({ day, startMinute: 8 * 60, endMinute: 20 * 60 })),
  };
  const week = weekOf({ from: "2027-03-08", settings: everyDay })!;
  assert.equal(week.plan.maxSlots, 7 * 96);
  assert.equal(week.slots.length, 7 * 41);
  const lastDay = week.slots.filter((slot) => slot.startsAt.startsWith("2027-03-14"));
  assert.ok(lastDay.length > 0, "the week's last day still has its times");
});

// ---------- F10: the slot picker follows the week ----------

test("a new week shows its own first day, not a day tapped in the last one", () => {
  const slot = (startsAt: string) => ({ startsAt, endsAt: startsAt });
  const lastWeek = [
    { key: "2026-10-13", slots: [slot("2026-10-13T14:00:00.000Z")] },
    { key: "2026-10-14", slots: [slot("2026-10-14T14:00:00.000Z")] },
  ];
  const nextWeek = [
    { key: "2026-10-20", slots: [slot("2026-10-20T14:00:00.000Z")] },
    { key: "2026-10-21", slots: [slot("2026-10-21T14:00:00.000Z")] },
  ];
  // Tapped Wed, Oct 14, then pressed Later.
  assert.equal(activeDayKey({ days: lastWeek, dayKey: "2026-10-14", selected: "" }), "2026-10-14");
  assert.equal(activeDayKey({ days: nextWeek, dayKey: "2026-10-14", selected: "" }), "2026-10-20");
  // Their pick still shows its day; a tapped day in this week still wins.
  assert.equal(activeDayKey({ days: nextWeek, dayKey: null, selected: "2026-10-21T14:00:00.000Z" }), "2026-10-21");
  assert.equal(activeDayKey({ days: nextWeek, dayKey: "2026-10-20", selected: "2026-10-21T14:00:00.000Z" }), "2026-10-20");
  assert.equal(activeDayKey({ days: [], dayKey: "2026-10-14", selected: "" }), null);
  // And the page starts each week's picker afresh.
  assert.match(read("components/booking/public-consultation-scheduler.tsx"), /<SlotPicker\s+key=\{range\?\.start \?\? "calls"\}/);
});

test("an empty week points only where there is somewhere to go", () => {
  assert.equal(noOpeningsThatWeek({ previous: null, next: "2026-10-18" }), "No openings that week. Try a later one, or jump to another date.");
  assert.equal(noOpeningsThatWeek({ previous: "2027-05-07", next: null }), "No openings that week. Try an earlier one, or reply to the studio’s email.");
  assert.equal(noOpeningsThatWeek({ previous: null, next: null }), "No openings before the day. Reply to the studio’s email and they’ll find a time.");
});

// ---------- F11: every time offered leaves room for the trial ----------

test("a trial's starts keep the studio's cadence and end inside its hours", () => {
  assert.equal(tradeProfile("hair").trialMinutes, 120);
  assert.equal(tradeProfile("makeup").trialMinutes, 90);
  assert.equal(tradeProfile("photographer").trialMinutes, null);
  assert.equal(tradeProfile("dj").trialMinutes, null);
  assert.equal(serverTradeProfile("hair").trialMinutes, 120);

  const input = {
    // A 45-minute call with 15 minutes between: hourly starts.
    settings: {
      durationMinutes: 120,
      bufferMinutes: 15,
      windows: [{ day: "mon" as const, startMinute: 9 * 60, endMinute: 17 * 60 }],
      blockedDates: [],
    },
    timezone: "America/New_York",
    now: new Date("2026-01-04T12:00:00.000Z"),
    startInDays: 1,
    daysAhead: 1,
    busy: [],
    maxSlots: 200,
    stepMinutes: 60,
  };
  const slots = generateConsultationSlots(input);
  const times = slots.map((slot) =>
    new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(slot.startsAt)).replace(/[  ]/g, " "),
  );
  assert.deepEqual(times, ["9:00 AM", "10:00 AM", "11:00 AM", "12:00 PM", "1:00 PM", "2:00 PM", "3:00 PM"]);
  // 3:00 PM ends at 5:00 PM, the end of the studio's hours; 4:00 PM is never offered.
  assert.equal(slots.at(-1)?.endsAt, "2026-01-05T22:00:00.000Z");
  // The server's copy agrees.
  assert.deepEqual(serverSlots({ ...input, settings: { ...input.settings, mode: "closed_default", unavailableWindows: [], meetingFormats: ["zoom"], inPersonLocation: null } }), slots);
  // Without a step, starts follow one another back to back, as a call's always have.
  assert.equal(generateConsultationSlots({ ...input, stepMinutes: undefined }).length, 3);
  const server = read("functions/src/booking/public-scheduling.ts");
  assert.match(server, /const trialMinutes = consultationPurpose\(link\.data\(\)\) === "walkthrough" \? shape\.walkthroughMinutes : shape\.trialMinutes;/);
  assert.match(server, /stepMinutes: plan\.stepMinutes,/);
});

// ---------- F12: Today asks the studio to invite a client who bought a trial ----------

const NOW = "2026-10-10T15:00:00.000Z";
const job = {
  id: "job1",
  tenantId: "t1",
  name: "Priya Shah",
  state: "BOOKED",
  eventDate: "2027-05-22",
  leadId: "lead1",
  clientContactIds: ["contact1"],
  packageSnapshotId: "snap1",
};
const snapshot = {
  id: "snap1",
  projectId: "job1",
  packageName: "Bridal hair",
  addOns: [{ addOnId: "a1", name: "Bridal hair trial", quantity: 1 }],
  includedDeliverables: ["Bridal hair", "Veil placement"],
};
const askedLead = {
  id: "lead1",
  projectId: "job1",
  status: "converted",
  customAnswers: [{ questionId: "trial-wanted", question: "Would you like a hair trial before the day?", answer: "Yes" }],
};

type Card = { id: string; title: string; detail: string; facts: string[]; action: Record<string, unknown> };
const trialCards = (input: Record<string, unknown>): Card[] =>
  (todayInbox({ now: NOW, tenantTrade: "hair", projects: [job], packageSnapshots: [snapshot], leads: [], ...input } as never).act as unknown as Card[]).filter(
    (card) => card.id.startsWith("trial-invite-"),
  );

test("a booked client who bought a trial and hasn't booked it is invited from Today", () => {
  const [card, ...rest] = trialCards({});
  assert.equal(rest.length, 0);
  assert.equal(card?.title, "Invite Priya Shah to book their hair trial");
  assert.match(card!.detail, /^Bridal hair trial is in their booking\./);
  assert.match(card!.detail, /veil is chosen/);
  assert.deepEqual(card?.action, { kind: "trial_invite", label: "Send the invite", projectId: "job1", contactId: "contact1" });
  // Asked for on the inquiry is enough, without buying one.
  const asked = trialCards({ packageSnapshots: [], leads: [askedLead] })[0];
  assert.match(asked!.detail, /^They asked for one on their inquiry\./);
  assert.equal(trialCards({ packageSnapshots: [], leads: [{ ...askedLead, customAnswers: [{ questionId: "trial-wanted", answer: "No" }] }] }).length, 0);
  assert.equal(trialCards({ packageSnapshots: [] }).length, 0, "nobody asked for one and nobody bought one");
  // A makeup artist's says makeup.
  const makeup = (todayInbox({ now: NOW, tenantTrade: "makeup", projects: [job], leads: [askedLead] } as never).act as unknown as Card[]).find((item) => item.id === "trial-invite-job1");
  assert.equal(makeup?.title, "Invite Priya Shah to book their makeup trial");
  // No client on the job: nobody to invite, and the job's trial card needs
  // one too, so there is no card to send the studio to.
  assert.equal(trialCards({ projects: [{ ...job, clientContactIds: [] }] }).length, 0);
});

test("the trial card goes once it is booked, invited, held, or the job is quiet", () => {
  const trial = { projectId: "job1", purpose: "trial", status: "scheduled", startsAt: "2027-03-09T15:00:00.000Z" };
  assert.equal(trialCards({ consultations: [trial] }).length, 0, "booked");
  assert.equal(trialCards({ consultations: [{ ...trial, status: "cancelled" }] }).length, 1, "a canceled trial is not a booking");
  // A sales call is not a trial.
  assert.equal(trialCards({ consultations: [{ ...trial, purpose: "consultation" }] }).length, 1);
  // Booked through the link, with the consultation outside the hundred Today reads.
  assert.equal(trialCards({ projects: [{ ...job, trialBookedAt: "2026-10-09T15:00:00.000Z" }] }).length, 0, "the job says it is booked");
  assert.equal(trialCards({ projects: [{ ...job, trialNotes: { look: "Low bun" } }] }).length, 0, "the trial happened");
  assert.equal(trialCards({ projects: [{ ...job, clientAutomationsPausedAt: "2026-10-01T00:00:00.000Z" }] }).length, 0, "quiet (imported or paused)");
  assert.equal(trialCards({ projects: [{ ...job, archivedAt: "2026-10-01T00:00:00.000Z" }] }).length, 0);
  assert.equal(trialCards({ projects: [{ ...job, state: "PROPOSAL" }] }).length, 0, "not booked yet");
  assert.equal(trialCards({ projects: [{ ...job, eventDate: "2026-10-11" }] }).length, 0, "no day left before the event");
  // A photographer's and a DJ's Today never carry it.
  for (const trade of ["photographer", "dj"]) {
    const act = todayInbox({ now: NOW, tenantTrade: trade, projects: [job], packageSnapshots: [snapshot], leads: [askedLead] } as never).act as unknown as Card[];
    assert.ok(!act.some((item) => item.id.startsWith("trial-invite-")), trade);
  }
  assert.match(read("components/today/today-inbox.tsx"), /item\.action\.kind === "trial_invite" \? \(\s*<TrialInviteActions/);
  // Every booked job's own snapshot, read by id beyond the sample, for a trade with a trial only.
  const hook = read("components/today/use-today-inbox.ts");
  assert.match(hook, /consultations: consultations\.records,\s*packageSnapshots: jobSnapshots,/);
  assert.match(hook, /useJobPackageSnapshots\(\{\s*enabled: Boolean\(tradeProfile\(workspace\.tenantTrade\)\.trial\),/);
});

// ---------- F12: once invited, the card stays away while the link works ----------

const invitedJob = {
  ...job,
  trialInvitedAt: "2026-08-20T15:00:00.000Z",
  // The day before the event (trial-window.ts trialLinkDays).
  trialInviteExpiresAt: "2027-05-21T15:00:00.000Z",
};

test("an invite is read from the job itself, not from a sample of email jobs", () => {
  // Sent 51 days ago, link open to the day before the event: no card, and
  // no monthly "Send the link again" while the bride waits for her veil.
  assert.equal(trialCards({ projects: [invitedJob], emailJobs: [] }).length, 0);
  // Its link closed (a job more than a year out): ask again.
  const closed = trialCards({ projects: [{ ...invitedJob, trialInviteExpiresAt: "2026-10-01T15:00:00.000Z" }] })[0];
  assert.equal(closed?.action.label, "Send the link again");
  assert.match(closed!.detail, /The link you sent them has closed\.$/);
  assert.ok(closed?.facts.includes("last invited 51 days ago"));
  // The job's evidence wins over whatever email jobs the sample holds.
  const oldEmail = { projectId: "job1", type: "consultation_invitation", purpose: "trial", createdAt: "2026-07-01T15:00:00.000Z" };
  assert.equal(trialCards({ projects: [invitedJob], emailJobs: [oldEmail] }).length, 0);

  // An invite sent before the job kept its own: its email job, with the
  // fourteen-day link it had then.
  const email = { projectId: "job1", type: "consultation_invitation", purpose: "trial", createdAt: "2026-10-05T15:00:00.000Z" };
  assert.equal(trialCards({ emailJobs: [email] }).length, 0, "sent five days ago, link open");
  const lapsed = trialCards({ emailJobs: [{ ...email, createdAt: "2026-08-20T15:00:00.000Z" }] })[0];
  assert.equal(lapsed?.action.label, "Send the link again");
  // Another job's invite, or a call's, is not this one.
  assert.equal(trialCards({ emailJobs: [{ ...email, projectId: "job2" }] })[0]?.action.label, "Send the invite");
  assert.equal(trialCards({ emailJobs: [{ ...email, purpose: "consultation" }] })[0]?.action.label, "Send the invite");

  assert.deepEqual(trialInvite({ project: invitedJob, emailJobs: [], now: NOW }), { sentAt: "2026-08-20T15:00:00.000Z", open: true });
  assert.equal(trialInvite({ project: job, emailJobs: [], now: NOW }), null);

  // The server writes what Today reads: the invite when it goes, the booking when it's made.
  const server = read("functions/src/booking/public-scheduling.ts");
  assert.match(server, /if \(command\.input\.purpose === "trial"\) \{\s*batch\.update\(project\.ref, \{ trialInvitedAt: now, trialInviteExpiresAt: expiresAt \}\);/);
  assert.match(server, /if \(consultationPurpose\(link\.data\(\)\) === "trial"\) \{\s*batch\.update\(project\.ref, \{ trialBookedAt: now \}\);/);
  // A page opened after the send is not handed the job from before it.
  assert.match(read("lib/booking/public-scheduling-client.ts"), /body\.type === "create_link" && input\?\.purpose === "trial"\) markTenantRecordsWritten\(\);/);
  assert.match(read("components/today/today-inbox.tsx"), /refreshTenantRecords\("projects", "emailJobs"\);/);
});

test("a trial is wanted when bought by name or asked for, and never by an unrelated word", () => {
  assert.deepEqual(trialWanted({ snapshots: [snapshot], leads: [] }), { reason: "bought", item: "Bridal hair trial" });
  assert.deepEqual(trialWanted({ snapshots: [{ packageName: "Bridal hair with trial", addOns: [], includedDeliverables: ["Hair trial", "Bridal hair"] }], leads: [] }), {
    reason: "bought",
    item: "Hair trial",
  });
  assert.equal(trialWanted({ snapshots: [{ packageName: "Industrial loft styling", addOns: [{ name: "Trialing nothing" }] }], leads: [] }), null);
  assert.deepEqual(trialWanted({ snapshots: [], leads: [askedLead] }), { reason: "asked" });
});

// ---------- F13: the trial card starts from the client's extensions answer ----------

test("the client's extensions answer is the trial card's starting choice", () => {
  assert.equal(extensionPlanFromAnswer("I have my own"), "own");
  assert.equal(extensionPlanFromAnswer("I'd like to buy them"), "buy");
  assert.equal(extensionPlanFromAnswer("I’d like to buy them"), "buy");
  assert.equal(extensionPlanFromAnswer("I'd like to rent them"), "rent");
  assert.equal(extensionPlanFromAnswer("No extensions"), "none");
  assert.equal(extensionPlanFromAnswer("Please recommend"), null);
  assert.equal(extensionPlanFromAnswer(undefined), null);
  assert.equal(
    clientExtensionPlan([
      { id: "older", updatedAt: "2026-10-01T00:00:00.000Z", answers: { extensions: "I'd like to rent them" } },
      { id: "newer", updatedAt: "2026-10-09T00:00:00.000Z", answers: { extensions: "I'd like to buy them" } },
      { id: "gone", updatedAt: "2026-10-10T00:00:00.000Z", archivedAt: "2026-10-10T00:00:00.000Z", answers: { extensions: "No extensions" } },
      { id: "other", updatedAt: "2026-10-10T00:00:00.000Z", answers: { veil: "Yes" } },
    ]),
    "buy",
  );
  assert.equal(clientExtensionPlan([]), null);
  const notes = read("components/crew/trial-notes.tsx");
  // Shown, not saved: the saved plan wins, and the stylist's pick wins over both.
  assert.match(notes, /const plan: ExtensionPlan \| "" = chosen \?\? clientPlan \?\? "";/);
  assert.match(read("components/projects/live-project-detail.tsx"), /clientExtensionPlan\(related\.questionnaires\)/);
});
