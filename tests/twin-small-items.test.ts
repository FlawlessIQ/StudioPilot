import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { extrasToSuggest, trialArrangedOnJob, trialDayLeft } from "../features/consultations/trial";
import { projectJourney, type JourneyInput } from "../features/journey/steps";
import {
  capExpiryAtEvent,
  defaultExpiryDay,
  expiryNeedsReanchoring,
  expiryOnSend,
  offerLastDay,
} from "../features/booking/proposal-expiry";
import {
  capExpiryAtEvent as serverCapExpiryAtEvent,
  expiryOnSend as serverExpiryOnSend,
  MINIMUM_DAYS_AFTER_SEND,
  offerLastDay as serverOfferLastDay,
} from "../functions/src/booking/proposal-expiry";
import { planClientProposalDecision } from "../server/client/proposal-decision";
import { proposalFollowUpCopy } from "../functions/src/booking/proposal-follow-ups";
import { projectThread } from "../features/journey/thread";
import { proposalNoticeStillHolds, proposalPdfNotice } from "../features/proposals/pdf-notice";
import { scheduleZoneLabel } from "../features/schedules/item-clock";
import { scheduleLineLabel } from "../features/billing/schedule-label";
import { SCHEDULE_LABELS } from "../features/job-kinds/job-kinds";
import { trialWindow } from "../functions/src/booking/trial-window";
import { proposalPdfPaymentLabel, proposalPdfUndatedSchedule } from "../functions/src/proposals/pdf-adjustments";

/**
 * Small findings from walking a returning client's second job on prod
 * (Priya Shah Sangeet, Jess Styles Bridal, hair, 2026-10-12, booked the same
 * day as the event): a trial offered with no day left to hold it, a quote
 * valid a week past its event, a PDF notice that outlived the PDF, a time
 * zone shown as "America/New_York", and a vendor's quote PDF that said
 * Retainer. A photographer's journey, quote and PDF are unchanged.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const VENDORS = ["dj", "makeup", "hair"] as const;

// ---------- F6: no trial day left before the event ----------

test("a trial day is left only from tomorrow to the day before the event, as the trial link offers", () => {
  const today = "2026-10-12";
  assert.equal(trialDayLeft({ today, eventDate: "2026-10-12" }), false, "the event is today");
  assert.equal(trialDayLeft({ today, eventDate: "2026-10-13" }), false, "the event is tomorrow");
  assert.equal(trialDayLeft({ today, eventDate: "2026-10-14" }), true, "tomorrow is the day before");
  assert.equal(trialDayLeft({ today, eventDate: "2026-10-01" }), false, "the event is behind them");
  assert.equal(trialDayLeft({ today, eventDate: null }), true, "no date, no limit");
  assert.equal(trialDayLeft({ today, eventDate: "not a date" }), true);
  assert.equal(trialDayLeft({ today, eventDate: "2026-10-14T00:00:00.000Z" }), true);
  // The same answer the trial link gives (functions/src/booking/trial-window.ts).
  for (let offset = -5; offset <= 10; offset += 1) {
    const event = new Date(`${today}T12:00:00Z`);
    event.setUTCDate(event.getUTCDate() + offset);
    const eventDate = event.toISOString().slice(0, 10);
    assert.equal(trialDayLeft({ today, eventDate }), trialWindow({ today, eventDate }) !== null, eventDate);
  }
  assert.equal(trialDayLeft({ today, eventDate: null }), trialWindow({ today, eventDate: null }) !== null);
});

const sangeet: JourneyInput = {
  projectId: "1740d0bd",
  state: "BOOKED",
  eventDate: "2026-10-12",
  today: "2026-10-12",
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
  trial: { state: "not_booked", startsAt: null },
};

const trialStep = (input: JourneyInput) => projectJourney(input).steps.find((step) => step.key === "trial");

test("a job dated today does not list an unbooked trial as a step to come", () => {
  const step = trialStep(sangeet);
  assert.equal(step?.status, "passed");
  assert.equal(step?.explain, true, "the rail says why");
  assert.match(step?.detail ?? "", /no day is left before the wedding/);
  assert.equal(step?.action, null);
  // Tomorrow's event has no day either.
  assert.equal(trialStep({ ...sangeet, eventDate: "2026-10-13" })?.status, "passed");
  // Never the next move.
  assert.notEqual(projectJourney(sangeet).current?.key, "trial");
});

test("a trial with a day left, a booked or held one, and one after the event read as before", () => {
  const ahead = trialStep({ ...sangeet, eventDate: "2027-05-22" });
  assert.equal(ahead?.status, "upcoming");
  assert.match(ahead?.detail ?? "", /^Optional — invite them/);
  const booked = trialStep({ ...sangeet, eventDate: "2026-10-14", today: "2026-10-12", trial: { state: "booked", startsAt: "2026-10-13T14:00:00.000Z", when: "Tue, Oct 13 at 10:00 AM" } });
  assert.equal(booked?.status, "waiting_other");
  assert.equal(booked?.detail, "Booked for Tue, Oct 13 at 10:00 AM");
  const bookedToday = trialStep({ ...sangeet, trial: { state: "booked", startsAt: "2026-10-11T14:00:00.000Z", when: "Sun, Oct 11 at 10:00 AM" } });
  assert.match(bookedToday?.detail ?? "", /^Booked for/);
  const held = trialStep({ ...sangeet, trial: { state: "held", startsAt: "2026-10-10T14:00:00.000Z" } });
  assert.equal(held?.status, "complete");
  // After the event: passed, as every missed preparation step is, with its old line.
  const after = trialStep({ ...sangeet, state: "EVENT_COMPLETE", eventDate: "2026-10-01" });
  assert.equal(after?.status, "passed");
  assert.equal(after?.explain, false);
  assert.match(after?.detail ?? "", /^Optional — invite them/);
  // A photographer has no trial step at all.
  assert.equal(trialStep({ ...sangeet, trade: "photographer" }), undefined);
});

test("the job's trial card stops inviting when no day is left", () => {
  const detail = read("components/projects/live-project-detail.tsx");
  const card = detail.slice(detail.indexOf("const trialInviteEl ="), detail.indexOf("<TrialNotes"));
  const noDay = card.indexOf("!trial.dayLeft ?");
  const invite = card.indexOf("label={`Invite them to book the ${trialWord.toLowerCase()}`}");
  assert.ok(noDay > 0 && invite > noDay, "the no-day branch comes before the invite");
  assert.ok(card.indexOf('trial.state === "booked"') < noDay, "a booked trial's card is unchanged");
  assert.match(card, /No day is left before the \$\{vocab\(jobKindOf\(project\)\)\.event\} to hold a/);
  // A trial held off the books, its notes on the card, gets no such line.
  assert.match(card, /trial\.arranged \? null :/);
  // One answer for the card and the step: the same helper, today and date,
  // and the same reading of a trial the job records itself.
  const hook = read("components/projects/use-project-journey.ts");
  assert.match(hook, /dayLeft: trialDayLeft\(\{ today: todayLocalIso\(\), eventDate \}\)/);
  assert.match(hook, /arranged: trialArrangedOnJob\(journeyProject\)/);
  assert.doesNotMatch(detail, /trialArrangedOnJob\(/);
});

test("a trial held off the books reads as done on the step, as the card treats it, once no day is left", () => {
  // Its look noted, no trial consultation: the card says nothing more.
  const arranged = { state: "not_booked" as const, startsAt: null, arranged: true };
  const step = trialStep({ ...sangeet, trial: arranged });
  assert.equal(step?.status, "complete", "not 'passed', which the minimap counts as missed");
  assert.equal(step?.detail, "Done — the look goes on their day sheet");
  assert.equal(step?.explain, false);
  assert.doesNotMatch(step?.detail ?? "", /no day is left/);
  assert.equal(projectJourney({ ...sangeet, trial: arranged }).steps.filter((entry) => entry.status === "passed").length, 0);
  // Tomorrow's event, and after the event: the same.
  assert.equal(trialStep({ ...sangeet, eventDate: "2026-10-13", trial: arranged })?.status, "complete");
  assert.equal(trialStep({ ...sangeet, state: "EVENT_COMPLETE", eventDate: "2026-10-01", trial: arranged })?.status, "complete");
  // With a day left the card still invites, and the step still offers it.
  const ahead = trialStep({ ...sangeet, eventDate: "2027-05-22", trial: arranged });
  assert.equal(ahead?.status, "upcoming");
  assert.match(ahead?.detail ?? "", /^Optional — invite them/);
  // Not arranged: no day is left, as before.
  assert.equal(trialStep({ ...sangeet, trial: { ...arranged, arranged: false } })?.status, "passed");
  // Booked through StudioCue: unchanged by the flag.
  const booked = { state: "booked" as const, startsAt: "2026-10-13T14:00:00.000Z", when: "Tue, Oct 13 at 10:00 AM", arranged: true };
  assert.equal(trialStep({ ...sangeet, eventDate: "2026-10-14", trial: booked })?.status, "waiting_other");
});

test("a trial extra is not suggested once no day is left, unless one was booked or held", () => {
  const extras = [
    { id: "trial", name: "Bridal hair trial", unitPriceCents: 15000 },
    { id: "veil", name: "Veil placement", unitPriceCents: 4000 },
    { id: "industrial", name: "Industrial-strength hold", unitPriceCents: 1000 },
  ];
  const names = (rows: readonly { name: string }[]) => rows.map((row) => row.name);
  const today = "2026-10-12";
  assert.deepEqual(names(extrasToSuggest(extras, { trade: "hair", today, eventDate: "2026-10-12", trialArranged: false })), [
    "Veil placement",
    "Industrial-strength hold",
  ]);
  assert.deepEqual(names(extrasToSuggest(extras, { trade: "makeup", today, eventDate: "2026-10-13", trialArranged: false })), [
    "Veil placement",
    "Industrial-strength hold",
  ]);
  // A day left, a trial already on the books, or a trade with no trial: as before.
  assert.equal(extrasToSuggest(extras, { trade: "hair", today, eventDate: "2026-10-20", trialArranged: false }).length, 3);
  assert.equal(extrasToSuggest(extras, { trade: "hair", today, eventDate: "2026-10-12", trialArranged: true }).length, 3);
  assert.equal(extrasToSuggest(extras, { trade: "photographer", today, eventDate: "2026-10-12", trialArranged: false }).length, 3);
  assert.equal(extrasToSuggest(extras, { trade: "dj", today, eventDate: "2026-10-12", trialArranged: false }).length, 3);
  assert.equal(extrasToSuggest(extras, { trade: "hair", today, eventDate: null, trialArranged: false }).length, 3);

  assert.equal(trialArrangedOnJob({ trialBookedAt: "2026-10-01T12:00:00Z" }), true);
  assert.equal(trialArrangedOnJob({ trialNotes: { look: "Low bun" } }), true);
  assert.equal(trialArrangedOnJob({}), false);
  assert.equal(trialArrangedOnJob(null), false);

  // Both pickers that offer a package's extras ask it.
  for (const path of ["components/proposals/proposal-packages-panel.tsx", "components/booking/booking-amendment.tsx"]) {
    const source = read(path);
    assert.match(source, /extrasToSuggest\(/, path);
    assert.match(source, /trialArranged: trialArrangedOnJob\(project\)/, path);
  }
  assert.doesNotMatch(read("components/booking/booking-amendment.tsx"), /suggested=\{suggestionsOf\(/);
});

// ---------- F7: a quote's expiry stops at its event ----------

test("a new quote's expiry defaults to a week out, or the event's date when that is sooner", () => {
  const today = "2026-10-12";
  assert.equal(defaultExpiryDay({ today, eventDate: "2026-10-12" }), "2026-10-12", "Priya's sangeet, today");
  assert.equal(defaultExpiryDay({ today, eventDate: "2026-10-15" }), "2026-10-15");
  assert.equal(defaultExpiryDay({ today, eventDate: "2026-10-19" }), "2026-10-19");
  assert.equal(defaultExpiryDay({ today, eventDate: "2027-05-22" }), "2026-10-19");
  assert.equal(defaultExpiryDay({ today, eventDate: null }), "2026-10-19");
  assert.equal(defaultExpiryDay({ today, eventDate: "2026-10-01" }), "2026-10-19", "an event behind them is no cap");
  assert.equal(defaultExpiryDay({ today, eventDate: "2027-05-22", days: 14 }), "2026-10-26");
  // A day is stored as its end in UTC, and the server refuses an expiry
  // already past: on an evening in New York the event's day has ended there,
  // so the week stands rather than a date the save would refuse.
  const evening = new Date("2026-10-13T00:30:00.000Z");
  assert.equal(defaultExpiryDay({ today, eventDate: "2026-10-12", now: evening }), "2026-10-19");
  assert.equal(defaultExpiryDay({ today, eventDate: "2026-10-13", now: evening }), "2026-10-13");
  assert.equal(defaultExpiryDay({ today, eventDate: "2026-10-12", now: new Date("2026-10-12T15:00:00.000Z") }), "2026-10-12");

  const composer = read("components/proposals/studio-proposal-workspace.tsx");
  assert.doesNotMatch(composer, /addDays\(new Date\(\), 7\)/);
  // Set again for each way a job is chosen: from a link, from the picker, after a package is locked.
  for (const job of ["requestedProject", "nextProject", "readyProject"]) {
    assert.match(
      composer,
      new RegExp(`setExpiresOn\\(defaultExpiryDay\\(\\{ today: todayLocalIso\\(\\), eventDate: ${job}\\.eventDate, now: new Date\\(\\) \\}\\)\\)`),
      job,
    );
  }
});

test("sending never stretches a quote's window past the end of its event's day", () => {
  const sentAt = new Date("2026-10-12T15:00:00.000Z");
  // The composer's default for an event today, kept on send.
  assert.equal(expiryOnSend("2026-10-12T23:59:59.000Z", sentAt, MINIMUM_DAYS_AFTER_SEND, "2026-10-12"), "2026-10-12T23:59:59.000Z");
  // A stale draft re-anchors, but only as far as the event's day.
  assert.equal(expiryOnSend("2026-10-01T23:59:59.000Z", sentAt, MINIMUM_DAYS_AFTER_SEND, "2026-10-14"), "2026-10-14T23:59:59.000Z");
  // A date the studio chose further out is still theirs.
  assert.equal(expiryOnSend("2026-10-30T23:59:59.000Z", sentAt, MINIMUM_DAYS_AFTER_SEND, "2026-10-12"), "2026-10-30T23:59:59.000Z");
  // No date, a far date, or one already behind: the week from send, as before.
  for (const eventDate of [null, "2027-05-22", "2026-10-11", "nonsense"]) {
    assert.equal(expiryOnSend(null, sentAt, MINIMUM_DAYS_AFTER_SEND, eventDate), "2026-10-19T15:00:00.000Z", String(eventDate));
  }
  assert.equal(expiryOnSend(null, sentAt), "2026-10-19T15:00:00.000Z");

  // The server's copy gives the same answers.
  const now = new Date("2026-10-12T15:00:00.000Z");
  for (const eventDate of [null, "2026-10-12", "2026-10-13", "2026-10-19", "2026-10-20", "2026-10-11", "x"]) {
    for (const chosen of [null, "2026-10-12T23:59:59.000Z", "2026-10-25T23:59:59.000Z", "2026-10-01T00:00:00.000Z"]) {
      assert.equal(serverExpiryOnSend(chosen, now, 7, eventDate), expiryOnSend(chosen, now, 7, eventDate), `${eventDate} ${chosen}`);
    }
    const later = new Date("2026-10-26T15:00:00.000Z");
    assert.equal(serverCapExpiryAtEvent(later, eventDate, now).toISOString(), capExpiryAtEvent(later, eventDate, now).toISOString());
  }

  // Every send and draft default passes the job's date, and every send the
  // clock its day ends on: the job's zone, else the studio's.
  const proposals = read("functions/src/booking/proposals.ts");
  assert.equal((proposals.match(/expiryOnSend\(/g) ?? []).length, 2);
  assert.match(proposals, /MINIMUM_DAYS_AFTER_SEND,\s*project\.get\("eventDate"\),\s*offerZone,\s*\)/);
  assert.match(proposals, /MINIMUM_DAYS_AFTER_SEND,\s*projectForSend\.get\("eventDate"\),\s*offerZone,\s*\)/);
  assert.match(
    proposals,
    /const offerZone = eventZone\(\s*projectForSend\.get\("timezone"\),\s*\(await transaction\.get\(db\.doc\(`tenants\/\$\{command\.tenantId\}`\)\)\)\.get\("timezone"\),\s*\);/,
  );
  // Read with the other reads, before the send writes anything.
  assert.ok(proposals.indexOf("const offerZone = eventZone(") < proposals.indexOf("const writeInvitation = () =>"));
  const combined = read("functions/src/contracts/combined-commands.ts");
  assert.match(combined, /MINIMUM_DAYS_AFTER_SEND,\s*project\.get\("eventDate"\),\s*eventZone\(project\.get\("timezone"\), studioZone\),/);
  assert.match(combined, /const studioZone = \(await db\.doc\(`tenants\/\$\{context\.tenantId\}`\)\.get\(\)\)\.get\("timezone"\);/);
  assert.match(read("functions/src/ai/copilot.ts"), /capExpiryAtEvent\(\s*new Date\(Date\.now\(\) \+ 14 \* 24 \* 60 \* 60 \* 1000\),\s*projectDoc\.get\("eventDate"\),/);
  assert.match(read("components/booking/booking-autopilot-workspace.tsx"), /capExpiryAtEvent\(futureDate\(14\), project\?\.eventDate, new Date\(\)\)/);
  // Cue's "Draft a quote" card: two weeks, or the event's date.
  const cue = read("components/ai/actions/booking-actions.tsx");
  const draftCard = cue.slice(cue.indexOf("export function DraftProposalCard"), cue.indexOf("export function EditProposalCard"));
  assert.match(draftCard, /chosenExpiry \?\? defaultExpiryDay\(\{ today: todayLocalIso\(\), eventDate: job\.eventDate, days: 14, now: new Date\(\) \}\)/);
  assert.doesNotMatch(cue, /in14Days/);
});

test("a same-day quote stays open until midnight on the event's clock, not UTC's", () => {
  const NY = "America/New_York";
  // Sent at 2:30 PM in New York on the event's day; the client says yes at
  // 9:00 PM there, which is already Oct 13 in UTC.
  const sentAt = new Date("2026-10-12T18:30:00.000Z");
  const yesAt = "2026-10-13T01:00:00.000Z";
  for (const chosen of [null, "2026-10-12T23:59:59.000Z"]) {
    const expiresAt = expiryOnSend(chosen, sentAt, MINIMUM_DAYS_AFTER_SEND, "2026-10-12", NY);
    assert.equal(expiresAt, "2026-10-13T03:59:59.000Z", `11:59:59 PM in New York (${chosen})`);
    const plan = planClientProposalDecision({
      decision: "accepted",
      now: yesAt,
      project: { state: "PROPOSAL", packageSnapshotId: null },
      proposal: { status: "viewed", expiresAt, packageSnapshotId: "snapshot-1" },
    });
    assert.equal(plan.proposalStatus, "accepted", "still Oct 12 where they are");
    // And it does close at their midnight.
    assert.throws(
      () =>
        planClientProposalDecision({
          decision: "accepted",
          now: "2026-10-13T04:00:00.000Z",
          project: { state: "PROPOSAL", packageSnapshotId: null },
          proposal: { status: "viewed", expiresAt, packageSnapshotId: "snapshot-1" },
        }),
      /PROPOSAL_EXPIRED/,
    );
  }
  // What the review found without the clock: closed at 7:59 PM in New York.
  assert.equal(expiryOnSend(null, sentAt, MINIMUM_DAYS_AFTER_SEND, "2026-10-12"), "2026-10-12T23:59:59.000Z");
  // Each zone's own midnight, through both daylight-saving changes.
  assert.equal(expiryOnSend(null, sentAt, 7, "2026-10-12", "America/Los_Angeles"), "2026-10-13T06:59:59.000Z");
  assert.equal(expiryOnSend(null, sentAt, 7, "2026-10-14", "America/Chicago"), "2026-10-15T04:59:59.000Z");
  assert.equal(
    expiryOnSend(null, new Date("2026-10-30T15:00:00.000Z"), 7, "2026-11-01", NY),
    "2026-11-02T04:59:59.000Z",
    "Nov 1 ends on Eastern Standard Time",
  );
  assert.equal(
    expiryOnSend(null, new Date("2027-03-10T15:00:00.000Z"), 7, "2027-03-14", NY),
    "2027-03-15T03:59:59.000Z",
    "Mar 14 ends on Eastern Daylight Time",
  );
  // A zone that is no zone is the UTC day, as before; a later date the
  // studio chose and a far event are untouched by the clock.
  assert.equal(expiryOnSend(null, sentAt, 7, "2026-10-12", "Not/AZone"), "2026-10-12T23:59:59.000Z");
  assert.equal(expiryOnSend("2026-10-30T23:59:59.000Z", sentAt, 7, "2026-10-12", NY), "2026-10-30T23:59:59.000Z");
  assert.equal(expiryOnSend(null, sentAt, 7, "2027-05-22", NY), "2026-10-19T18:30:00.000Z");
  // Sent after midnight in UTC but still the event's evening in New York:
  // the floor is the rest of that evening, not a week.
  assert.equal(
    expiryOnSend(null, new Date("2026-10-13T00:30:00.000Z"), 7, "2026-10-12", NY),
    "2026-10-13T03:59:59.000Z",
  );
  assert.equal(expiryNeedsReanchoring("2026-10-12T23:59:59.000Z", sentAt, 7, "2026-10-12", NY), true);

  // The server's copy gives the same answers on every clock.
  for (const zone of [null, NY, "America/Los_Angeles", "Pacific/Honolulu", "Europe/London", "bad"]) {
    for (const eventDate of ["2026-10-12", "2026-10-13", "2026-10-19", "2026-11-01", null]) {
      for (const chosen of [null, "2026-10-12T23:59:59.000Z", "2026-10-25T23:59:59.000Z"]) {
        assert.equal(
          serverExpiryOnSend(chosen, sentAt, 7, eventDate, zone),
          expiryOnSend(chosen, sentAt, 7, eventDate, zone),
          `${zone} ${eventDate} ${chosen}`,
        );
      }
      const later = new Date("2026-10-26T15:00:00.000Z");
      assert.equal(
        serverCapExpiryAtEvent(later, eventDate, sentAt, zone).toISOString(),
        capExpiryAtEvent(later, eventDate, sentAt, zone).toISOString(),
      );
    }
  }
});

test("the day an offer stands to is read on the event's clock wherever it is written out", () => {
  const NY = "America/New_York";
  // A chosen date is that day, on any clock.
  assert.equal(offerLastDay("2026-10-12T23:59:59.000Z", NY), "2026-10-12");
  assert.equal(offerLastDay("2026-10-12T23:59:59.000Z", "Europe/Paris"), "2026-10-12");
  // A floor ending at the event's midnight is that day, not the next.
  assert.equal(offerLastDay("2026-10-17T03:59:59.000Z", NY), "2026-10-16");
  assert.equal(offerLastDay("2026-10-13T06:59:59.000Z", "America/Los_Angeles"), "2026-10-12");
  assert.equal(offerLastDay("", NY), null);
  assert.equal(offerLastDay("soon", NY), null);
  assert.equal(offerLastDay(null, NY), null);
  for (const [expiresAt, zone] of [
    ["2026-10-17T03:59:59.000Z", NY],
    ["2026-10-12T23:59:59.000Z", "Europe/Paris"],
    ["2026-10-26T18:30:00.000Z", "America/Chicago"],
  ] as const) {
    assert.equal(serverOfferLastDay(expiresAt, zone), offerLastDay(expiresAt, zone), expiresAt);
  }

  // The client's follow-up: "open until October 16", not the 17th.
  const copy = proposalFollowUpCopy({
    days: 3,
    viewed: true,
    firstName: "Priya",
    projectName: "Priya Shah Sangeet",
    sentAt: "2026-10-12T18:30:00.000Z",
    expiresAt: "2026-10-17T03:59:59.000Z",
    studioName: "Jess Styles Bridal",
    timeZone: NY,
  });
  assert.match(copy.body, /open until October 16/);
  const followUps = read("functions/src/booking/proposal-follow-ups.ts");
  assert.match(followUps, /timeZone: eventZone\(project\.get\("timezone"\), tenant\.get\("timezone"\)\),/);
  // The PDF, made again after a send, on the studio's clock.
  assert.match(
    read("functions/src/operations/ai-pdf.ts"),
    /expires_on:offerLastDay\(proposal\.get\("expiresAt"\),eventZone\(tenant\.get\("timezone"\)\)\)\?\?/,
  );

  // The job's thread, on the studio's own clock as "Valid through" is.
  const facts = (timeZone: string | null) =>
    projectThread({
      projectId: "1740d0bd",
      projectName: "Priya Shah Sangeet",
      projectCreatedAt: "2026-10-12T15:00:00.000Z",
      clientName: "Priya",
      proposals: [
        {
          id: "proposal-1",
          status: "sent",
          version: 1,
          createdAt: "2026-10-12T16:00:00.000Z",
          expiresAt: "2026-10-13T03:59:59.000Z",
          pricingSnapshot: { totalCents: 32700, currency: "USD", packageName: "Sangeet hair" },
        },
      ],
      trade: "hair",
      timeZone,
    }).find((entry) => entry.id === "proposal-proposal-1")?.artifact?.facts ?? [];
  assert.ok(facts(NY).includes("expires Oct 12, 2026"), facts(NY).join(" | "));
  assert.match(read("components/projects/use-project-thread.ts"), /timeZone: Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone \|\| null,/);
});

// ---------- F9: the approve notice goes once the PDF is ready ----------

test("'being generated' is dropped once the PDF is ready, as it is once it failed", () => {
  const approved = proposalPdfNotice(true, "queued");
  assert.equal(approved, "Approved. The branded PDF is being generated.");
  assert.equal(proposalNoticeStillHolds(approved, "queued"), true);
  assert.equal(proposalNoticeStillHolds(approved, "ready"), false);
  assert.equal(proposalNoticeStillHolds(approved, "failed"), false);
  assert.equal(proposalNoticeStillHolds("A fresh PDF is being generated.", "ready"), false);
  // Any other notice stays.
  assert.equal(proposalNoticeStillHolds("Approved. The branded PDF is ready.", "ready"), true);
  assert.equal(proposalNoticeStillHolds("Draft saved.", "ready"), true);
});

// ---------- F12: the zone in words ----------

test("the scheduling pages name the zone, not its database id", () => {
  assert.equal(scheduleZoneLabel("America/New_York"), "Eastern Time");
  assert.equal(scheduleZoneLabel("America/Chicago"), "Central Time");
  assert.equal(scheduleZoneLabel(""), null);
  assert.equal(scheduleZoneLabel("Not/AZone"), null);
  const scheduler = read("components/booking/public-consultation-scheduler.tsx");
  assert.match(scheduler, /const zone = scheduleZoneLabel\(timezone\) \?\? "the studio’s time zone";/);
  // Booked and choosing both say it the one way.
  assert.equal((scheduler.match(/shown in \{zone\}/g) ?? []).length, 2);
  const inquiry = read("components/inquiries/couple-inquiry-page.tsx");
  assert.doesNotMatch(inquiry, /shown in \{preview\.timezone\}/);
  assert.match(inquiry, /Times shown in \{scheduleZoneLabel\(preview\.timezone\) \?\? "the studio’s time zone"\}/);
});

// ---------- A vendor's quote PDF says Deposit ----------

test("a vendor's quote PDF prints their deposit word; a photographer's prints Retainer as before", () => {
  for (const trade of VENDORS) {
    assert.equal(proposalPdfPaymentLabel("Retainer", trade), "Deposit", trade);
    assert.equal(proposalPdfPaymentLabel("Final balance", trade), "Final balance", trade);
    assert.equal(proposalPdfPaymentLabel("Payment in full", trade), "Payment in full", trade);
    assert.deepEqual(proposalPdfUndatedSchedule(trade, "$327.00", "$981.00"), [
      { label: "Deposit", amount: "$327.00", due_date: null },
      { label: "Final balance", amount: "$981.00", due_date: null },
    ]);
  }
  assert.equal(proposalPdfPaymentLabel("Retainer", "photographer"), "Retainer");
  assert.equal(proposalPdfPaymentLabel("Retainer", undefined), "Retainer");
  // A photographer with no schedule is left to the PDF service's own rows.
  assert.deepEqual(proposalPdfUndatedSchedule("photographer", "$1,000.00", "$4,000.00"), []);
  // The same word the quote page shows (features/billing/schedule-label.ts).
  for (const trade of ["photographer", ...VENDORS, undefined]) {
    for (const label of Object.values(SCHEDULE_LABELS)) {
      assert.equal(proposalPdfPaymentLabel(label, trade), scheduleLineLabel(label, trade), `${trade} ${label}`);
    }
  }
  const pdf = read("functions/src/operations/ai-pdf.ts");
  assert.match(pdf, /label:clipForPdf\(proposalPdfPaymentLabel\(string\(item\.label\)\|\|"Payment",pdfTrade\.trade\),120\)/);
  assert.match(pdf, /:proposalPdfUndatedSchedule\(pdfTrade\.trade,retainerText,balanceText\)/);
  // The service is unchanged: it still prints its own rows only when sent none.
  assert.match(read("cloud-run/pdf/main.py"), /Paragraph\("Retainer", styles\["BodyStudio"\]\)/);
});
