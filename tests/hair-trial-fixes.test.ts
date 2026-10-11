import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { trialState, trialWanted, trialWhen } from "../features/consultations/trial";
import { generateConsultationSlots } from "../features/consultations/slots";
import { projectJourney, type JourneyInput } from "../features/journey/steps";
import { todayInbox, TRIAL_INVITE_QUIET_DAYS } from "../features/today/inbox";
import { clientExtensionPlan, extensionPlanFromAnswer } from "../features/trades/extensions";
import { tradeProfile } from "../features/trades/trades";
import { generateConsultationSlots as serverSlots } from "../functions/src/booking/availability";
import { daysBetween, studioDay, trialLinkDays, trialWindow } from "../functions/src/booking/trial-window";
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
  assert.match(server, /command\.input\.purpose === "trial"\s*\? trialLinkDays\(/);
  assert.match(server, /: BOOKING_LINK_DAYS,/);
  // The browse is the trial's alone, and booking re-checks the pick against
  // the same week on the server.
  assert.match(server, /consultationPurpose\(link\.data\(\)\) === "trial"\s*\? await trialSlotsFor\(/);
  assert.match(server, /\{ at: command\.input\.startsAt \}/);
  assert.match(server, /if \(!selected\) throw new Error\("TIME_NO_LONGER_AVAILABLE"\);/);
  const page = read("components/booking/public-consultation-scheduler.tsx");
  assert.match(page, /className="kit-week-nav"/);
  assert.match(page, /input: \{ token, from \}/);
  assert.match(read("app/kit.css"), /\.kit-week-nav \{\s*display: flex;\s*flex-wrap: wrap;/);
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
  assert.match(server, /tradeProfile\(tenant\.get\("trade"\)\)\.trialMinutes \?\? settings\.durationMinutes/);
  assert.match(server, /stepMinutes: settings\.durationMinutes \+ settings\.bufferMinutes/);
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
  // No client contact: the card opens the job's trial card instead.
  assert.deepEqual(trialCards({ projects: [{ ...job, clientContactIds: [] }] })[0]?.action, {
    kind: "link",
    label: "Open the trial card",
    href: "/studio/projects/job1#trial",
  });
});

test("the trial card goes once it is booked, invited, held, or the job is quiet", () => {
  const trial = { projectId: "job1", purpose: "trial", status: "scheduled", startsAt: "2027-03-09T15:00:00.000Z" };
  assert.equal(trialCards({ consultations: [trial] }).length, 0, "booked");
  assert.equal(trialCards({ consultations: [{ ...trial, status: "cancelled" }] }).length, 1, "a canceled trial is not a booking");
  // A sales call is not a trial.
  assert.equal(trialCards({ consultations: [{ ...trial, purpose: "consultation" }] }).length, 1);
  const invite = { projectId: "job1", type: "consultation_invitation", purpose: "trial", createdAt: "2026-10-05T15:00:00.000Z" };
  assert.equal(trialCards({ emailJobs: [invite] }).length, 0, "invited five days ago");
  const stale = trialCards({ emailJobs: [{ ...invite, createdAt: "2026-08-20T15:00:00.000Z" }] })[0];
  assert.ok(51 >= TRIAL_INVITE_QUIET_DAYS);
  assert.equal(stale?.action.label, "Send the link again");
  assert.ok(stale?.facts.includes("last invited 51 days ago"));
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
  assert.match(read("components/today/use-today-inbox.ts"), /consultations: consultations\.records,\s*packageSnapshots: packageSnapshots\.records,/);
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
