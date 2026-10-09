import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { trialState } from "../features/consultations/trial";
import { consultationPurpose, isSalesConsultation, isTrial } from "../features/consultations/purpose";
import { currentSalesConsultation } from "../features/consultations/live";
import { coverageRoleForLabel, coverageTradeNamed } from "../features/crew/staffing-plan";
import { projectJourney, type JourneyInput } from "../features/journey/steps";
import { defaultInquiryFormFor } from "../features/leads/inquiry-form-config";
import { normalizeUnitLabel, quantityText } from "../features/packages/unit-label";
import { recommendedFor } from "../features/questionnaires/recommended-templates";
import { chairDayPlan, planChairs } from "../features/schedules/chair-plan";
import { crewLabels } from "../features/schedules/crew-labels";
import { clockMinutes } from "../features/schedules/day-clock";
import { parsePartyList, partyHeadcount } from "../features/schedules/party-list";
import { tradeProfile, tradeVocab } from "../features/trades/trades";
import { renderEmailTemplate } from "../functions/src/communications/email-templates";

/**
 * Phase 3 of the vendor journeys (docs/vendor-journeys-plan.md): what a makeup
 * artist and a hair stylist share — per-person pricing, the trial, the party
 * list, the chair schedule, the balance on the day and the prep guide.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the functions copy of the unit label matches features/", () => {
  const body = (source: string) => source.slice(source.indexOf("/**"));
  assert.equal(body(read("functions/src/packages/unit-label.ts")), body(read("features/packages/unit-label.ts")));
});

test("an extra priced per person reads as people on the quote", () => {
  assert.equal(normalizeUnitLabel("  Person "), "person");
  assert.equal(normalizeUnitLabel(""), null);
  assert.equal(normalizeUnitLabel(7), null);
  assert.equal(quantityText(6, "person"), "6 people");
  assert.equal(quantityText(1, "person"), "1 person");
  assert.equal(quantityText(3, "hour"), "3 hours");
  assert.equal(quantityText(2, "child"), "2 children");
  assert.equal(quantityText(4, "lashes"), "4 lashes");
  // No unit is the number alone, as before.
  assert.equal(quantityText(6, null), "6");
  // The client's proposal, the studio's composer and the PDF all say it.
  assert.match(read("components/client/kit/client-proposal.tsx"), /quantityText\(/);
  assert.match(read("components/proposals/studio-proposal-workspace.tsx"), /quantityText\(/);
  assert.match(read("functions/src/operations/ai-pdf.ts"), /quantityText\(/);
  assert.match(read("functions/src/crm/commands.ts"), /unitLabel: normalizeUnitLabel\(/);
});

test("makeup artists and hair stylists are crew roles: M1, H1, never photographers", () => {
  for (const label of ["Makeup artist", "make-up", "MUA", "Lead artist"]) assert.equal(coverageRoleForLabel(label), "makeup_artist", label);
  for (const label of ["Hair stylist", "hair", "Stylist"]) assert.equal(coverageRoleForLabel(label), "hair_stylist", label);
  assert.equal(coverageTradeNamed("MUA"), "makeup_artist");
  assert.equal(coverageTradeNamed("hair stylist"), "hair_stylist");
  const labels = crewLabels([
    { id: "a", role: "makeup_artist" },
    { id: "b", role: "makeup_artist" },
    { id: "c", role: "hair_stylist" },
  ] as never);
  assert.deepEqual([...labels.values()].map((label) => label.label).sort(), ["H1", "M1", "M2"]);
});

test("the party list reads one person per line, however it is written", () => {
  const people = parsePartyList(
    [
      "Bridesmaids:",
      "Maya Brooks — bride — hair and makeup — sensitive skin",
      "- Jess Hart, maid of honor, makeup",
      "2) Ana Brooks — mother of the bride",
      "Sara Brooks — sister of the bride — makeup",
      "Rose — bride's grandmother",
      "Lily — flower girl — hair",
      "",
      "Priya Shah\tbridesmaid\tlashes",
    ].join("\n"),
    "makeup",
  );
  assert.deepEqual(
    people.map((person) => [person.name, person.role, person.services.join("+"), person.notes]),
    [
      ["Maya Brooks", "bride", "hair+makeup", "sensitive skin"],
      ["Jess Hart", "party", "makeup", null],
      ["Ana Brooks", "mother", "makeup", null],
      ["Sara Brooks", "party", "makeup", null],
      ["Rose", "mother", "makeup", null],
      ["Lily", "child", "hair", null],
      ["Priya Shah", "party", "makeup", "lashes"],
    ],
  );
  assert.deepEqual(partyHeadcount(people, "makeup"), { bride: 1, party: 3, mother: 2, child: 0 });
  assert.deepEqual(partyHeadcount(people, "hair"), { bride: 1, party: 0, mother: 0, child: 1 });
  assert.deepEqual(parsePartyList(undefined, "hair"), []);
});

const party = parsePartyList(
  ["Maya — bride", "Jess — bridesmaid", "Priya — bridesmaid", "Ana — bridesmaid", "Kate — bridesmaid", "Ruth — mother", "Lily — flower girl"].join("\n"),
  "makeup",
);

test("the morning is worked back from the ready-by time, every chair ending together", () => {
  const plan = planChairs({ people: party, service: "makeup", readyBy: "13:00", artists: 2 });
  assert.equal(plan.slots.length, 7);
  assert.equal(plan.artists, 2);
  assert.ok(plan.fits);
  for (const artist of [1, 2]) {
    const chair = plan.slots.filter((slot) => slot.artist === artist);
    assert.equal(chair.map((slot) => slot.end).sort().at(-1), "13:00", `chair ${artist} ends at the ready-by time`);
    // Back to back: each slot starts where the one before it ended.
    const ordered = [...chair].sort((left, right) => left.start.localeCompare(right.start));
    for (let index = 1; index < ordered.length; index += 1) assert.equal(ordered[index]!.start, ordered[index - 1]!.end);
  }
  // The bride is on chair 1, never first and never last.
  const chairOne = plan.slots.filter((slot) => slot.artist === 1).sort((left, right) => left.start.localeCompare(right.start));
  const brideAt = chairOne.findIndex((slot) => slot.role === "bride");
  assert.ok(brideAt > 0 && brideAt < chairOne.length - 1, `bride at ${brideAt} of ${chairOne.length}`);
  assert.equal(chairOne[brideAt]!.end > chairOne[brideAt]!.start, true);
  assert.equal(clockMinutes(chairOne[brideAt]!.end) - clockMinutes(chairOne[brideAt]!.start), 75);
});

test("too short a window says how many artists the morning needs", () => {
  const one = planChairs({ people: party, service: "makeup", readyBy: "13:00", earliestStart: "10:00", artists: 1 });
  assert.equal(one.fits, false);
  // 75 + 4×45 + 45 + 15 = 315 minutes; a three-hour window needs two chairs.
  assert.equal(one.artistsNeeded, 2);
  assert.match(one.notes[0]!, /needs 2 to finish by 13:00/);
  const asNeeded = planChairs({ people: party, service: "makeup", readyBy: "13:00", earliestStart: "10:00" });
  assert.equal(asNeeded.artists, 2);
  assert.ok(asNeeded.fits);
  assert.ok(asNeeded.start! >= "10:00");
  // No ready-by time, or nobody for this service, lays out nothing and says why.
  assert.match(planChairs({ people: party, service: "makeup", readyBy: null }).notes[0]!, /ready/);
  assert.match(planChairs({ people: party, service: "hair", readyBy: "13:00" }).notes[0]!, /Nobody/);
});

test("the chair plan becomes run-of-show lines, one per chair, each with its own end", () => {
  const plan = planChairs({ people: party, service: "makeup", readyBy: "13:00", artists: 2 });
  const day = chairDayPlan(plan, { service: "makeup", place: "Bridal suite", readyBy: "13:00" });
  assert.equal(day.rows.length, 7);
  assert.ok(day.rows.every((row) => row.end && row.where === "Bridal suite" && /^Chair [12]$/.test(row.sourceLabel)));
  assert.ok(day.rows.some((row) => row.title === "Maya (bride) — makeup"));
  assert.equal(day.coverageEnd, "13:00");
  assert.match(day.notes[0]!, /7 chairs across 2 artists/);
  // The editor lays out the morning for a beauty studio.
  assert.match(read("components/planning/ai-schedule-generator.tsx"), /chairDayPlan\(/);
  // …and says whose chair each line is.
  assert.match(read("components/planning/ai-schedule-generator.tsx"), /Coverage starts\|Chair \\d\)/);
});

test("a trial is booked like a call and never read as the sales consultation", () => {
  const trial = { purpose: "trial", status: "scheduled", startsAt: "2026-09-01T15:00:00Z" };
  assert.equal(consultationPurpose(trial), "trial");
  assert.ok(isTrial(trial));
  assert.equal(isSalesConsultation(trial), false);
  assert.equal(currentSalesConsultation([trial]), null);
  // Every server site that means "the sales call" asks the one gate.
  for (const path of [
    "functions/src/booking/consultation-prep.ts",
    "functions/src/booking/zoom-webhook.ts",
    "functions/src/automation/runtime.ts",
    "functions/src/intake/inquiry-form.ts",
    "functions/src/ai/copilot.ts",
  ]) {
    assert.match(read(path), /isSalesConsultation\(/, path);
    assert.doesNotMatch(read(path), /!== "final_details"/, path);
  }
  const mirror = (path: string) => read(path).slice(read(path).indexOf("export const FINAL_DETAILS_PURPOSE"));
  assert.equal(mirror("functions/src/booking/consultation-purpose.ts"), mirror("features/consultations/purpose.ts"));
});

test("the trial is a step on the journey, informational, done once held", () => {
  assert.deepEqual(trialState({ consultations: [], now: "2026-09-02T00:00:00Z" }), { state: "not_booked", startsAt: null });
  const booked = [{ purpose: "trial", status: "scheduled", startsAt: "2026-09-10T15:00:00Z" }];
  assert.equal(trialState({ consultations: booked, now: "2026-09-02T00:00:00Z" }).state, "booked");
  assert.equal(trialState({ consultations: booked, now: "2026-09-11T00:00:00Z" }).state, "held");
  // A sales call is not a trial.
  assert.equal(trialState({ consultations: [{ status: "scheduled", startsAt: "2026-09-10T15:00:00Z" }], now: "2026-09-11T00:00:00Z" }).state, "not_booked");

  const base: JourneyInput = {
    projectId: "p1",
    state: "PLANNING",
    eventDate: "2026-10-20",
    today: "2026-09-19",
    lead: null,
    hasConsultation: true,
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
    insuranceRequired: "unknown",
    dayBeforeDraftStatus: null,
    hasDelivery: false,
    albumOrReviewDone: false,
  };
  const makeup = projectJourney({ ...base, trade: "makeup", trial: { state: "not_booked", startsAt: null } });
  const step = makeup.steps.find((candidate) => candidate.key === "trial");
  assert.equal(step?.title, "Makeup trial");
  assert.equal(step?.action ?? null, null);
  assert.notEqual(step?.status, "complete");
  const held = projectJourney({ ...base, trade: "hair", trial: { state: "held", startsAt: "2026-09-10T15:00:00Z" } });
  assert.equal(held.steps.find((candidate) => candidate.key === "trial")?.status, "complete");
  assert.equal(held.steps.find((candidate) => candidate.key === "trial")?.title, "Hair trial");
  // Nothing changes for a photographer or a DJ.
  for (const trade of [undefined, "photographer", "dj"] as const)
    assert.ok(!projectJourney({ ...base, trade }).steps.some((candidate) => candidate.key === "trial"), String(trade));
});

test("the studio invites the client to book the trial and notes what it settled", () => {
  const page = read("components/projects/live-project-detail.tsx");
  assert.match(page, /purpose="trial"/);
  assert.match(page, /<TrialNotes/);
  const commands = read("functions/src/crew/commands.ts");
  assert.match(commands, /type: z\.literal\("setTrialNotes"\)/);
  // On the crew's brief beside the client's own answers, and gone when cleared.
  assert.match(commands, /crewBriefs\/trial_\$\{parsed\.input\.projectId\}/);
  assert.match(commands, /else batch\.delete\(briefReference\);/);
  assert.match(read("functions/src/booking/booking-link.ts"), /trial_/);
});

test("a makeup or hair balance is due on the day; a photographer's is unchanged", () => {
  assert.equal(tradeProfile("makeup").balanceDueDaysBefore, 0);
  assert.equal(tradeProfile("hair").balanceDueDaysBefore, 0);
  assert.equal(tradeProfile("photographer").balanceDueDaysBefore, 14);
  assert.equal(tradeProfile("dj").balanceDueDaysBefore, 14);
  assert.match(read("components/proposals/studio-proposal-workspace.tsx"), /tradeProfile\(workspace\.tenantTrade\)\.balanceDueDaysBefore/);
});

const brand = { studioName: "Glow Studio", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: null };

test("the week-before email is a prep guide for makeup and hair, unchanged for a photographer", () => {
  const values = { eventKind: "wedding", eventDate: "2026-10-20", portalUrl: "https://studio-cue.com/client" };
  const makeup = renderEmailTemplate({ key: "event_reminder", brand, recipientName: "Maya", values: { ...values, trade: "makeup" } });
  assert.equal(makeup.subject, "Your prep guide from Glow Studio");
  assert.match(makeup.text, /makeup goes on beautifully/);
  assert.match(makeup.text, /button-up or zip-front top/);
  const hair = renderEmailTemplate({ key: "event_reminder", brand, recipientName: "Maya", values: { ...values, trade: "hair" } });
  assert.match(hair.text, /So your hair holds all day, please/);
  for (const email of [makeup, hair]) assert.doesNotMatch(email.text, /photograph/i);
  const photo = renderEmailTemplate({ key: "event_reminder", brand, recipientName: "Maya", values });
  assert.doesNotMatch(photo.subject, /prep guide/);
  // The trial invitation says trial, not consultation.
  const invite = renderEmailTemplate({ key: "consultation_invitation", brand, values: { trade: "makeup", purpose: "trial", actionUrl: "https://studio-cue.com/x" } });
  assert.match(invite.subject, /trial/i);
  assert.doesNotMatch(invite.text, /consultation|photograph/i);
});

test("makeup and hair start with the Party list, sent at booking, locked a month out", () => {
  for (const trade of ["makeup", "hair"] as const) {
    // One form (simpler vendor journeys): the party list alone.
    assert.deepEqual(recommendedFor(trade).map((form) => form.id), [`${trade}-party-list`]);
    assert.deepEqual(tradeProfile(trade).planning, { formAtBooking: true, lockDaysBefore: 30 });
    assert.equal(tradeVocab(trade).detailsForm, "Party list");
  }
  const form = recommendedFor("makeup").find((candidate) => candidate.id === "makeup-party-list")!;
  const fields = form.sections.flatMap((section) => section.fields);
  for (const id of ["ready-by-time", "getting-ready", "party-list"])
    assert.equal(fields.find((field) => field.id === id)?.required, true, id);
  assert.match(read("functions/src/saas/onboarding.ts"), /preloaded\["makeup-party-list"\] \?\? preloaded\["hair-party-list"\]/);
});

test("a makeup or hair inquiry form asks how many people, the ready-by time and the trial", () => {
  for (const trade of ["makeup", "hair"] as const) {
    const config = defaultInquiryFormFor(trade);
    assert.deepEqual(config.eventTypes.map((type) => type.id), ["wedding", "event", "general"]);
    assert.deepEqual(config.questions.map((question) => question.id), ["party-size", "ready-by", "trial-wanted"]);
    // No certificate of insurance or guest count for a beauty booking.
    assert.equal(config.eventTypes[0]!.coi, false);
    assert.equal(config.eventTypes[0]!.guests, false);
  }
  assert.match(defaultInquiryFormFor("hair").questions[0]!.label, /hair styling/);
  assert.match(defaultInquiryFormFor("makeup").questions[2]!.label, /makeup trial/);
  assert.equal(defaultInquiryFormFor("photographer").questions.length, 0);
  assert.match(read("functions/src/saas/onboarding.ts"), /trade\.trade !== "photographer" \? \{ inquiryForm: defaultInquiryFormFor\(trade\.trade\) \}/);
  const setup = read("components/setup/setup-conversation.tsx");
  assert.match(setup, /ask: "When can clients book a trial\?"/);
});
