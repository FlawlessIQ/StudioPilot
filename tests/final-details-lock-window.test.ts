import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import { finalCallState } from "@/features/consultations/final-call";
import { canonicalJson, resolveContractDocument } from "@/features/contracts/document";
import { eventDetailsBlocks, eventDetailsFrom } from "@/features/contracts/event-details";
import { sampleContractSources, starterAgreementFor } from "@/features/contracts/sample";
import { projectJourney, type JourneyInput } from "@/features/journey/steps";
import { finalDetailsDue, finalDetailsToday, FINAL_DETAILS_STATES } from "@/features/planning/final-details-due";
import { resolvePlanningTimeline } from "@/features/planning/planning-timeline";
import { finalHeadcountState, returnedPartyList, returnedPartyNames } from "@/features/schedules/final-headcount";
import { finalDetailsNudge, partyListCandidates, todayInbox } from "@/features/today/inbox";
import { tradeVocab } from "@/features/trades/trades";
import { confirmFinalDetails, finalDetailsFor } from "@/server/planning/final-details";
import { amendedLockPassed } from "../functions/src/contracts/amendments.ts";
import { lockPassedOn, scheduleSaysLockPassed } from "../functions/src/contracts/sources.ts";
import { formJustReturned } from "../functions/src/planning/crew-brief-trigger.ts";
import { openFinalDetailsIfDue, refreshAwaitingSignoff } from "../functions/src/planning/final-details.ts";

/**
 * The final details lock, inside its own window (walking prod, 2026-10-12).
 *
 * Jess Styles Bridal (hair, a 30-day lock): Priya Shah's sangeet was dated the
 * day it was booked. While it was still a lead the journey said "Meanwhile,
 * waiting on the client: Final headcount" — the date alone said "invited",
 * though nothing goes to a client before they book (F5). Once booked, the
 * headcount waited for the next 16:00 UTC sweep, which for a same-day event is
 * the day itself (F14); and a sweep before her party list came back would have
 * asked "Still 0 getting ready?" (F15). Her agreement's Schedule A promised the
 * headcount "30 days before the date", a day already gone (F10).
 */

const read = (path: string) => readFileSync(path, "utf8");
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

// ── One rule for every reader ──────────────────────────────────────────

test("the functions copy of final-details-due is identical", () => {
  assert.equal(read("functions/src/planning/final-details-due.ts"), read("features/planning/final-details-due.ts"));
});

test("due: booked, not quiet, past the lock and not past the day", () => {
  const due = (overrides: Partial<Parameters<typeof finalDetailsDue>[0]> = {}) =>
    finalDetailsDue({ state: "BOOKED", quiet: false, eventDate: "2026-10-12", lockOn: "2026-09-12", today: "2026-10-12", ...overrides });
  assert.deepEqual([...FINAL_DETAILS_STATES], ["BOOKED", "PLANNING", "READY"]);
  assert.equal(due(), "due", "booked the day of the event");
  assert.equal(due({ state: "PLANNING" }), "due");
  assert.equal(due({ state: "READY" }), "due");
  assert.equal(due({ today: "2026-09-12" }), "due", "the lock day itself");
  assert.equal(due({ today: "2026-09-11" }), "before_lock");
  assert.equal(due({ lockOn: null }), "before_lock", "no date to lock from");
  assert.equal(due({ eventDate: "" }), "before_lock");
  assert.equal(due({ today: "2026-10-13" }), "event_passed");
  assert.equal(due({ quiet: true }), "quiet");
  for (const state of ["LEAD", "CONSULTATION", "PROPOSAL", "CONTRACT_PENDING", "RETAINER_PENDING", "EVENT_COMPLETE"])
    assert.equal(due({ state }), "not_booked", state);
});

test("today is the job's own calendar day: the event's zone, else the studio's, else UTC", () => {
  // 9:30 PM in New York on the 12th is already the 13th in UTC.
  const evening = "2026-10-13T01:30:00.000Z";
  assert.equal(finalDetailsToday(evening, "America/New_York"), "2026-10-12");
  assert.equal(finalDetailsToday(new Date(evening), "America/Los_Angeles"), "2026-10-12");
  assert.equal(finalDetailsToday(evening, null, "America/Chicago"), "2026-10-12", "no zone on the job: the studio's");
  assert.equal(finalDetailsToday(evening, "Not/AZone", "America/New_York"), "2026-10-12", "a zone that isn't one is skipped");
  assert.equal(finalDetailsToday(evening, "Asia/Tokyo", "America/New_York"), "2026-10-13", "the event's own zone first");
  assert.equal(finalDetailsToday(evening), "2026-10-13", "no zone at all: UTC, as the server always read it");
  assert.equal(finalDetailsToday(evening, "", undefined, 7), "2026-10-13");
});

// ── F5 + F15: where it stands, for the journey ─────────────────────────

const timeline = { lockDaysBefore: 30 };
const sangeet = { tenantId: "t", eventKind: "wedding", eventDate: "2026-10-12" };
const partyList = (list: string, extra: Record<string, unknown> = {}) => ({
  projectId: "p",
  status: "submitted",
  submittedAt: "2026-10-12T15:00:00Z",
  answers: { "party-list": list },
  ...extra,
});

test("a headcount waits on the client only once it has been asked", () => {
  const state = (project: Record<string, unknown>, extra: Partial<Parameters<typeof finalHeadcountState>[0]> = {}) =>
    finalHeadcountState({ project, planningTimeline: timeline, signoff: null, responses: [], trade: "hair", today: "2026-10-12", ...extra })?.state;
  const list = [partyList("Priya Shah — bride — hair\nAsha — bridesmaid — hair")];
  // Priya's sangeet as it was: a lead, dated today, inside its window.
  assert.equal(state({ ...sangeet, state: "LEAD" }), "at_booking", "a lead is never waiting on the client for this");
  assert.equal(state({ ...sangeet, state: "PROPOSAL" }, { responses: list }), "at_booking", "even with a list back");
  assert.equal(state({ ...sangeet, state: "BOOKED" }), "needs_party_list", "booked with no list: the list is what's missing");
  assert.equal(state({ ...sangeet, state: "BOOKED" }, { responses: list }), "due", "booked with a list: it goes now");
  assert.equal(state({ ...sangeet, state: "BOOKED", clientAutomationsPausedAt: "2026-10-01T00:00:00Z" }), "paused");
  assert.equal(state({ ...sangeet, state: "BOOKED" }, { signoff: { status: "awaiting_couple" } }), "invited");
  assert.equal(state({ ...sangeet, state: "BOOKED" }, { signoff: { status: "confirmed" } }), "held");
  assert.equal(state({ ...sangeet, state: "BOOKED", eventDate: "2026-12-20" }), "not_yet", "the lock still ahead");
  assert.equal(state({ ...sangeet, state: "BOOKED", eventKind: "family" }), undefined, "no lock, no step");
});

test("the party list a headcount counts: returned, not archived, the newest, the studio's own service", () => {
  assert.deepEqual(returnedPartyNames([], "hair"), []);
  assert.deepEqual(returnedPartyNames([partyList("Priya — bride", { status: "draft" })], "hair"), [], "a draft isn't back");
  assert.deepEqual(returnedPartyNames([partyList("Priya — bride", { archivedAt: "2026-10-01T00:00:00Z" })], "hair"), []);
  assert.deepEqual(returnedPartyNames([partyList("Priya — bride", { status: "locked" })], "hair"), ["Priya"]);
  assert.deepEqual(
    returnedPartyNames(
      [
        partyList("Asha — bridesmaid\nPriya — bride", { submittedAt: "2026-10-12T16:00:00Z" }),
        partyList("Priya — bride", { submittedAt: "2026-10-01T16:00:00Z" }),
      ],
      "hair",
    ),
    ["Asha", "Priya"],
    "the newest list wins, whatever order they come in",
  );
  // A makeup artist doesn't count the flower girl having only her hair done.
  assert.deepEqual(returnedPartyNames([partyList("Priya — bride — hair and makeup\nMira — flower girl — hair")], "makeup"), ["Priya"]);
  assert.deepEqual(returnedPartyNames([partyList("Mira — flower girl — hair")], "makeup"), [], "nobody having makeup");
  // The list as written, for saying which: never back, back with nobody, or nobody having the service.
  assert.equal(returnedPartyList([]), "");
  assert.equal(returnedPartyList([partyList("Priya — bride", { status: "sent" })]), "", "not back");
  assert.equal(returnedPartyList([{ projectId: "p", status: "submitted", answers: { venue: "Oak Hall" } }]), "", "back with no list on it");
  assert.equal(
    returnedPartyList([partyList("Mira — flower girl — hair", { submittedAt: "2026-10-01T00:00:00Z" }), partyList("  ", { submittedAt: "2026-10-12T00:00:00Z" })]),
    "Mira — flower girl — hair",
    "the newest with anything in it",
  );
});

test("a final details call is invited only once its link has gone", () => {
  const wedding = { tenantId: "t", eventKind: "wedding", eventDate: "2027-06-12" };
  const state = (project: Record<string, unknown>, extra: Partial<Parameters<typeof finalCallState>[0]> = {}) =>
    finalCallState({ project, planningTimeline: {}, consultations: [], today: "2027-05-20", now: "2027-05-20T15:00:00Z", ...extra })?.state;
  assert.equal(state({ ...wedding, state: "PROPOSAL" }), "at_booking", "a lead inside the window: when they book");
  assert.equal(state({ ...wedding, state: "PLANNING" }), "due", "booked, nothing open yet: within the day");
  assert.equal(state({ ...wedding, state: "PLANNING", archivedAt: "2027-05-01T00:00:00Z" }), "paused");
  assert.equal(state({ ...wedding, state: "PLANNING" }, { today: "2027-04-01" }), "not_yet");
  assert.equal(state({ ...wedding, state: "PLANNING" }, { signoff: { status: "awaiting_couple", finalCallLinkId: "link-1" } }), "invited");
  assert.equal(state({ ...wedding, state: "PLANNING" }, { signoff: { status: "awaiting_couple" } }), "invited", "a sign-off from before the field: it sent the link");
  assert.equal(state({ ...wedding, state: "PLANNING" }, { signoff: { status: "awaiting_couple", finalCallLinkId: null } }), "not_sent", "nobody to send it to");
  const call = { purpose: "final_details", status: "scheduled", startsAt: "2027-05-25T19:00:00Z" };
  assert.equal(state({ ...wedding, state: "PLANNING" }, { consultations: [call] }), "booked");
  assert.equal(state({ ...wedding, state: "PLANNING" }, { consultations: [call], now: "2027-05-26T00:00:00Z" }), "held");
  assert.equal(state({ ...wedding, state: "PLANNING" }, { planningTimeline: { finalCall: false } }), undefined, "the studio turned it off");
});

const journeyBase: JourneyInput = {
  projectId: "p",
  state: "PROPOSAL",
  eventDate: "2026-10-12",
  today: "2026-10-12",
  lead: { id: "l", status: "converted", replied: true },
  hasConsultation: false,
  proposalStatus: "sent",
  contractStatus: null,
  retainerInvoiceStatus: null,
  finalInvoiceStatus: null,
  questionnaireStatus: null,
  questionnaireHasAnswers: false,
  scheduleStatus: null,
  scheduleApprovalState: "none",
  scheduleHasUsableItems: false,
  crewAccepted: 0,
  crewRequired: 0,
  crewCascadeActive: false,
  coiStatus: null,
  insuranceRequired: "not_required",
  dayBeforeDraftStatus: null,
  hasDelivery: false,
  albumOrReviewDone: false,
} as JourneyInput;

test("the journey: a lead inside the window is never waiting on the client for its final details", () => {
  const step = (input: Partial<JourneyInput>) =>
    projectJourney({ ...journeyBase, ...input }).steps.find((candidate) => candidate.key === "final_call")!;
  // Priya's sangeet as a lead, at Jess Styles Bridal.
  const lead = { ...sangeet, state: "PROPOSAL" };
  const hairLead = projectJourney({
    ...journeyBase,
    trade: "hair",
    finalCall: finalHeadcountState({ project: lead, planningTimeline: timeline, signoff: null, responses: [], trade: "hair", today: "2026-10-12" }),
  });
  const headcount = hairLead.steps.find((candidate) => candidate.key === "final_call")!;
  assert.equal(headcount.title, "Final headcount");
  assert.notEqual(headcount.status, "waiting_client");
  // Booking alone doesn't ask it: with no list back, openSignoff has nothing to count.
  assert.equal(headcount.detail, "Asked once they've booked and their party list is in. The details have already locked.");
  assert.notEqual(
    hairLead.steps.find((candidate) => candidate.status === "waiting_client")?.title,
    "Final headcount",
    "not the job card's \"Meanwhile, waiting on the client\"",
  );

  // Booked, no party list back: the list is what's missing.
  const booked = { ...sangeet, state: "BOOKED" };
  const needsList = step({
    state: "BOOKED",
    trade: "hair",
    finalCall: finalHeadcountState({ project: booked, planningTimeline: timeline, signoff: null, responses: [], trade: "hair", today: "2026-10-12" }),
  });
  assert.equal(needsList.status, "upcoming");
  assert.equal(needsList.detail, `Asked as soon as their ${tradeVocab("hair").detailsForm!.toLowerCase()} is in. The details have locked.`);
  assert.equal(needsList.unlock, needsList.detail, "the step's own line says when, not \"goes out on\" a day already gone");
  assert.equal(
    step({ state: "BOOKED", trade: "hair", finalCall: { state: "due", lockOn: "2026-09-12", startsAt: null } }).detail,
    "Asked within the day. The details have locked.",
  );
  const asked = step({ state: "BOOKED", trade: "hair", finalCall: { state: "invited", lockOn: "2026-09-12", startsAt: null } });
  assert.equal(asked.status, "waiting_client");
  assert.equal(asked.detail, "Waiting for them to confirm who's getting ready");

  // A photographer's final details call, the same way. Booked and otherwise
  // ready, so a step of the studio's own can be the next move.
  const ready: Partial<JourneyInput> = {
    hasConsultation: true,
    proposalStatus: "accepted",
    contractStatus: "completed",
    retainerInvoiceStatus: "paid",
    questionnaireStatus: "submitted",
    questionnaireHasAnswers: true,
    scheduleStatus: "published",
    scheduleHasUsableItems: true,
    crewAccepted: 1,
    crewRequired: 1,
  };
  const call = (state: NonNullable<JourneyInput["finalCall"]>["state"], projectState = "PROPOSAL") =>
    step({ ...(projectState === "PROPOSAL" ? {} : ready), state: projectState, finalCall: { state, lockOn: "2026-09-14", startsAt: null } });
  assert.equal(call("at_booking").status, "upcoming");
  assert.equal(call("at_booking").detail, "The invitation goes out as soon as they book. The details have already locked.");
  assert.equal(call("due", "BOOKED").detail, "The invitation goes out within the day. The details have locked.");
  assert.equal(call("paused", "BOOKED").detail, "Not sent while emails to them are paused");
  assert.equal(call("not_sent", "BOOKED").status, "current", "the studio invites them by hand");
  assert.equal(call("invited", "BOOKED").status, "waiting_client");
  // The lock still ahead reads as it always did.
  const ahead = projectJourney({
    ...journeyBase,
    state: "BOOKED",
    eventDate: "2027-06-12",
    finalCall: { state: "not_yet", lockOn: "2027-05-15", startsAt: null },
  }).steps.find((candidate) => candidate.key === "final_call")!;
  assert.equal(ahead.detail, "The couple are invited to book it when the details lock");
  assert.match(ahead.unlock ?? "", /^The invitation goes out on .*, when the details lock\.$/);
});

// ── Today ──────────────────────────────────────────────────────────────

type TodayItem = { id: string; title: string; detail: string; action: { kind: string; label?: string; href?: string } | null };
const inbox = (input: Record<string, unknown>) =>
  (todayInbox({ tenantTrade: "hair", planningTimeline: timeline, ...input } as never) as unknown as { act: TodayItem[] }).act;

test("Today: a booked headcount with no party list says the list is what's missing; a lead says nothing", () => {
  const now = "2026-10-12T14:00:00.000Z";
  const project = { id: "p", name: "Priya Shah Sangeet", ...sangeet, state: "BOOKED" };
  const sent = { id: "q", projectId: "p", status: "sent" };
  // Today reads the job's own records before it says the list is missing: what
  // the tenant-wide reads lack proves nothing (they stop at 100).
  const card = (input: Record<string, unknown>) => {
    const responses = (input.questionnaireResponses ?? []) as Record<string, unknown>[];
    const signoffs = (input.detailSignoffs ?? []) as Record<string, unknown>[];
    return inbox({
      now,
      projects: [project],
      finalDetailsRecords: { p: { signoff: signoffs[0] ?? null, responses } },
      ...input,
    }).find((item) => item.id === "party-list-p");
  };

  const waiting = card({ questionnaireResponses: [sent] });
  assert.equal(waiting?.title, "Priya Shah Sangeet haven't sent their party list");
  assert.equal(waiting?.action?.label, "Message them");
  const neverSent = card({ questionnaireResponses: [] });
  assert.equal(neverSent?.title, "Priya Shah Sangeet haven't been sent their party list");
  assert.equal(neverSent?.action?.label, "Send the form");
  assert.equal(
    card({
      questionnaireResponses: [],
      journeys: [
        {
          projectId: "p",
          projectName: "Priya Shah Sangeet",
          eventDate: "2026-10-12",
          state: "BOOKED",
          stepKey: "schedule_form",
          stepTitle: "Party list",
          stepDetail: "Send the form",
          owner: "studio",
          actionLabel: "Send the form",
          actionHref: "/studio/questionnaires?project=p",
          updatedAt: null,
        },
      ],
    }),
    undefined,
    "the job's own card already says send the form",
  );

  // Back, but nobody to count: said as it is.
  const headings = card({ questionnaireResponses: [partyList("Bridesmaids:")] });
  assert.equal(headings?.title, "Priya Shah Sangeet's party list came back with nobody on it");
  assert.equal(headings?.action?.label, "Check the form");
  // A form back with no list on it at all hasn't sent the list.
  const noList = card({ questionnaireResponses: [{ id: "q", projectId: "p", status: "submitted", answers: { venue: "Oak Hall" } }] });
  assert.equal(noList?.title, "Priya Shah Sangeet haven't sent their party list");
  assert.equal(noList?.action?.label, "Message them");
  // A makeup artist's client who listed only people having their hair done.
  const makeup = inbox({
    now,
    tenantTrade: "makeup",
    projects: [project],
    finalDetailsRecords: { p: { signoff: null, responses: [partyList("Mira — flower girl — hair\nAsha — bridesmaid — hair")] } },
  }).find((item) => item.id === "party-list-p");
  assert.equal(makeup?.title, "Priya Shah Sangeet's party list has nobody down for makeup");
  assert.equal(makeup?.detail, "Nobody on it is having makeup done, so there's no headcount to confirm. Add who's getting ready, or ask them.");
  assert.equal(makeup?.action?.label, "Check the form");

  assert.equal(card({ questionnaireResponses: [partyList("Priya — bride")] }), undefined, "a list back: it goes, nothing to chase");
  assert.equal(card({ detailSignoffs: [{ id: "s", projectId: "p", status: "awaiting_couple", lockOn: "2026-09-12" }] }), undefined, "already asked");
  assert.equal(inbox({ now, projects: [{ ...project, state: "PROPOSAL" }], finalDetailsRecords: { p: { signoff: null, responses: [] } } }).find((item) => item.id === "party-list-p"), undefined, "a lead");
  assert.equal(inbox({ now, tenantTrade: "photographer", projects: [project], finalDetailsRecords: { p: { signoff: null, responses: [] } } }).find((item) => item.id === "party-list-p"), undefined, "not a per-person trade");
});

test("Today: a party list is missing only when the job's own records say so, not the capped tenant-wide reads", () => {
  const now = "2026-10-12T14:00:00.000Z";
  const project = { id: "p", name: "Priya Shah Sangeet", ...sangeet, state: "BOOKED" };
  const at = (input: Record<string, unknown>) => inbox({ now, projects: [project], questionnaireResponses: [], detailSignoffs: [], ...input }).find((item) => item.id === "party-list-p");
  // Nothing in the tenant-wide reads: a candidate, whose own records Today reads.
  assert.deepEqual(partyListCandidates({ now, tenantTrade: "hair", planningTimeline: timeline, projects: [project], detailSignoffs: [], questionnaireResponses: [] }), ["p"]);
  assert.equal(at({}), undefined, "its own records not read yet: nothing said");
  assert.equal(at({ finalDetailsRecords: {} }), undefined);
  // The busy studio: its confirmed sign-off and returned list fell outside the 100.
  assert.equal(at({ finalDetailsRecords: { p: { signoff: { id: "t_p", projectId: "p", status: "confirmed" }, responses: [] } } }), undefined, "already confirmed");
  assert.equal(at({ finalDetailsRecords: { p: { signoff: null, responses: [partyList("Priya — bride")] } } }), undefined, "the list is back");
  assert.match(at({ finalDetailsRecords: { p: { signoff: null, responses: [] } } })?.title ?? "", /haven't been sent their party list/);
  // Present in the tenant-wide reads is proof: no candidate, nothing read.
  const candidates = (input: Record<string, unknown>) =>
    partyListCandidates({ now, tenantTrade: "hair", planningTimeline: timeline, projects: [project], detailSignoffs: [], questionnaireResponses: [], ...input });
  assert.deepEqual(candidates({ detailSignoffs: [{ id: "s", projectId: "p", status: "awaiting_couple" }] }), []);
  assert.deepEqual(candidates({ questionnaireResponses: [partyList("Priya — bride")] }), []);
  assert.deepEqual(candidates({ projects: [{ ...project, state: "PROPOSAL" }] }), [], "a lead");
  assert.deepEqual(candidates({ tenantTrade: "photographer" }), []);
  // The job's own day: 9:30 PM in New York on the event day is still the event day.
  const evening = "2026-10-13T01:30:00.000Z";
  assert.deepEqual(candidates({ now: evening }), [], "UTC's tomorrow: the day has been");
  assert.deepEqual(candidates({ now: evening, studioTimezone: "America/New_York" }), ["p"]);
  assert.deepEqual(candidates({ now: evening, projects: [{ ...project, timezone: "America/New_York" }] }), ["p"]);
  assert.match(
    at({ now: evening, studioTimezone: "America/New_York", finalDetailsRecords: { p: { signoff: null, responses: [] } } })?.title ?? "",
    /haven't been sent their party list/,
  );
});

test("Today nudges five days after they were asked, not five days after a lock they were booked past", () => {
  // Opened by the sweep on the lock day: as before.
  assert.deepEqual(finalDetailsNudge({ lockOn: "2027-05-15", openedAt: "2027-05-15T16:00:00Z", eventDate: "2027-06-12" }), {
    on: "2027-05-20",
    askedOn: "2027-05-15",
    askedLate: false,
  });
  assert.equal(finalDetailsNudge({ lockOn: "2027-05-15", openedAt: null, eventDate: "2027-06-12" }).on, "2027-05-20", "a sign-off with no createdAt");
  // Booked a week into the window: five days after that.
  assert.deepEqual(finalDetailsNudge({ lockOn: "2027-05-15", openedAt: "2027-05-22T10:00:00Z", eventDate: "2027-06-12" }), {
    on: "2027-05-27",
    askedOn: "2027-05-22",
    askedLate: true,
  });
  // Booked three days out: the day before, never the day it was asked.
  assert.equal(finalDetailsNudge({ lockOn: "2027-05-15", openedAt: "2027-06-09T10:00:00Z", eventDate: "2027-06-12" }).on, "2027-06-11");
  assert.equal(finalDetailsNudge({ lockOn: "2027-05-15", openedAt: "2027-06-11T10:00:00Z", eventDate: "2027-06-12" }).on, "2027-06-12");

  const project = { id: "p1", name: "Avery & Sam", state: "PLANNING", eventKind: "wedding", eventDate: "2027-06-12" };
  const late = { id: "s1", projectId: "p1", status: "awaiting_couple", lockOn: "2027-05-15", createdAt: "2027-05-22T10:00:00Z" };
  const at = (now: string) => inbox({ now, tenantTrade: "photographer", planningTimeline: {}, projects: [project], detailSignoffs: [late] }).find((item) => item.id === "final-details-s1");
  assert.equal(at("2027-05-22T12:00:00.000Z"), undefined, "not the moment it opened");
  assert.equal(at("2027-05-26T12:00:00.000Z"), undefined);
  assert.match(at("2027-05-27T12:00:00.000Z")?.detail ?? "", /^They were asked on .+\. A quick message usually does it\.$/);
  const onTime = { ...late, createdAt: "2027-05-15T16:00:00Z" };
  assert.equal(
    inbox({ now: "2027-05-21T12:00:00.000Z", tenantTrade: "photographer", planningTimeline: {}, projects: [project], detailSignoffs: [onTime] }).find((item) => item.id === "final-details-s1")?.detail,
    "They were asked when the details locked. A quick message usually does it.",
  );
});

// ── F14 + F15: opened the moment it can be ─────────────────────────────

type Doc = Record<string, unknown>;
function fakeDb(seed: Record<string, Doc>) {
  const docs = new Map<string, Doc>(Object.entries(seed).map(([path, data]) => [path, structuredClone(data)]));
  const snapshot = (path: string) => {
    const data = docs.get(path);
    return {
      id: path.split("/").pop()!,
      ref: { path },
      exists: data !== undefined,
      data: () => (data === undefined ? undefined : structuredClone(data)),
      get: (field: string) => data?.[field],
    };
  };
  const reference = (path: string) => ({ id: path.split("/").pop()!, path, get: async () => snapshot(path) });
  const query = (collection: string, filters: Array<[string, unknown]> = [], order: [string, string] | null = null, max = 1000) => ({
    where: (field: string, _op: string, value: unknown) => query(collection, [...filters, [field, value]], order, max),
    orderBy: (field: string, direction = "asc") => query(collection, filters, [field, direction], max),
    limit: (count: number) => query(collection, filters, order, count),
    get: async () => {
      let found = [...docs.keys()]
        .filter((path) => path.startsWith(`${collection}/`) && path.split("/").length === 2)
        .filter((path) => filters.every(([field, value]) => docs.get(path)?.[field] === value))
        .map(snapshot);
      if (order) {
        const [field, direction] = order;
        found = found.sort((left, right) => String(left.get(field) ?? "").localeCompare(String(right.get(field) ?? "")) * (direction === "desc" ? -1 : 1));
      }
      return { docs: found.slice(0, max), empty: found.length === 0 };
    },
  });
  const db = {
    doc: reference,
    collection: (name: string) => query(name),
    runTransaction: async <T,>(work: (transaction: unknown) => Promise<T>) => {
      const writes: Array<() => void> = [];
      const result = await work({
        get: (ref: { get: () => Promise<unknown> }) => ref.get(),
        update: (ref: { path: string }, data: Doc) => void writes.push(() => void docs.set(ref.path, { ...docs.get(ref.path), ...structuredClone(data) })),
        set: (ref: { path: string }, data: Doc) => void writes.push(() => void docs.set(ref.path, structuredClone(data))),
        create: (ref: { path: string }, data: Doc) =>
          void writes.push(() => {
            if (docs.has(ref.path)) throw Object.assign(new Error("ALREADY_EXISTS"), { code: 6 });
            docs.set(ref.path, structuredClone(data));
          }),
      });
      for (const write of writes) write();
      return result;
    },
    batch: () => {
      const writes: Array<() => void> = [];
      return {
        set: (ref: { path: string }, data: Doc) => void writes.push(() => void docs.set(ref.path, structuredClone(data))),
        create: (ref: { path: string }, data: Doc) =>
          void writes.push(() => {
            if (docs.has(ref.path)) throw Object.assign(new Error("ALREADY_EXISTS"), { code: 6 });
            docs.set(ref.path, structuredClone(data));
          }),
        commit: async () => {
          for (const write of writes) write();
        },
      };
    },
  };
  return { db: db as unknown as Firestore, docs };
}

const NOW = "2026-10-12T14:00:00.000Z";
const studio = (trade: string, extra: Doc = {}) => ({ tenantId: "t", trade, planningTimeline: { lockDaysBefore: 30 }, ...extra });
const job = (extra: Doc = {}) => ({ tenantId: "t", name: "Priya Shah Sangeet", eventKind: "wedding", eventDate: "2026-10-12", state: "BOOKED", clientContactIds: ["c"], ...extra });
const form = (list: string) => ({ tenantId: "t", projectId: "p", status: "submitted", submittedAt: "2026-10-12T13:00:00Z", answers: { "party-list": list } });
const opened = (docs: Map<string, Doc>) => [...docs.keys()].filter((path) => /^(detailSignoffs|emailJobs|consultationBookingLinks)\//.test(path)).sort();

test("a hair client booked inside the window is asked for the headcount once the party list is in, never \"Still 0\"", async () => {
  const { db, docs } = fakeDb({ "tenants/t": studio("hair"), "projects/p": job(), "contacts/c": { tenantId: "t", email: "priya@example.com" } });
  assert.equal(await openFinalDetailsIfDue(db, { tenantId: "t", projectId: "p" }, NOW), "no_party_list");
  assert.deepEqual(opened(docs), [], "nothing written, nothing emailed");

  // The party list comes back.
  docs.set("questionnaireResponses/q", form("Priya Shah — bride — hair\nAsha — bridesmaid — hair\nMira — flower girl — makeup"));
  assert.equal(await openFinalDetailsIfDue(db, { tenantId: "t", projectId: "p" }, NOW), "opened");
  assert.deepEqual(opened(docs), ["detailSignoffs/t_p", "emailJobs/final_details_request_t_p"], "no call to book");
  const signoff = docs.get("detailSignoffs/t_p")!;
  assert.equal(signoff.kind, "headcount");
  assert.equal(signoff.headcount, 2, "the flower girl isn't having her hair done");
  assert.equal(signoff.lockOn, "2026-09-12");
  assert.equal(signoff.createdAt, NOW);
  assert.ok(!("finalCallLinkId" in signoff));
  assert.equal(docs.get("emailJobs/final_details_request_t_p")!.headcount, 2);

  // Idempotent: a second moment (a retry, the sweep) leaves it as it is.
  assert.equal(await openFinalDetailsIfDue(db, { tenantId: "t", projectId: "p" }, "2026-10-12T16:00:00.000Z"), "exists");
  assert.equal(docs.get("detailSignoffs/t_p")!.createdAt, NOW);
});

test("a photographer's job booked inside the window gets its final details and call link at booking", async () => {
  const { db, docs } = fakeDb({
    "tenants/t": studio("photographer"),
    "projects/p": job({ eventDate: "2026-10-30" }),
    "contacts/c": { tenantId: "t", email: "priya@example.com" },
  });
  assert.equal(await openFinalDetailsIfDue(db, { tenantId: "t", projectId: "p" }, NOW), "opened");
  const signoff = docs.get("detailSignoffs/t_p")!;
  assert.equal(signoff.kind, undefined);
  assert.equal(typeof signoff.finalCallLinkId, "string", "the call's link went with it: invited");
  assert.ok(docs.has(`consultationBookingLinks/${signoff.finalCallLinkId}`));
  assert.match(String(docs.get("emailJobs/final_details_request_t_p")!.finalCallUrl), /^https?:\/\//);

  // Nobody to send the link to: it goes without one, and the journey says so.
  const bare = fakeDb({ "tenants/t": studio("photographer"), "projects/p": job({ eventDate: "2026-10-30", clientContactIds: [] }) });
  assert.equal(await openFinalDetailsIfDue(bare.db, { tenantId: "t", projectId: "p" }, NOW), "opened");
  assert.equal(bare.docs.get("detailSignoffs/t_p")!.finalCallLinkId, null);
  assert.equal(
    finalCallState({ project: job(), planningTimeline: {}, consultations: [], signoff: bare.docs.get("detailSignoffs/t_p")!, today: "2026-10-12", now: NOW })?.state,
    "not_sent",
  );
});

test("asked at booking before the form was back: the form coming back is what they confirm, until they have", async () => {
  const { db, docs } = fakeDb({ "tenants/t": studio("photographer"), "projects/p": job({ eventDate: "2026-10-30", clientContactIds: [] }) });
  assert.equal(await openFinalDetailsIfDue(db, { tenantId: "t", projectId: "p" }, NOW), "opened");
  const first = docs.get("detailSignoffs/t_p")!;
  assert.deepEqual((first.snapshot as { responseIds: string[] }).responseIds, []);

  docs.set("questionnaireResponses/q", {
    tenantId: "t",
    projectId: "p",
    status: "submitted",
    submittedAt: "2026-10-12T15:00:00Z",
    answers: [{ question: "Ceremony Location", answer: "St Mary's Church" }],
  });
  const later = "2026-10-12T15:30:00.000Z";
  assert.equal(await refreshAwaitingSignoff(db, { tenantId: "t", projectId: "p" }, later), "refreshed");
  const refreshed = docs.get("detailSignoffs/t_p")!;
  assert.deepEqual((refreshed.snapshot as { responseIds: string[] }).responseIds, ["q"]);
  assert.notEqual(refreshed.snapshotHash, first.snapshotHash);
  assert.equal(refreshed.updatedAt, later);
  assert.equal(refreshed.createdAt, NOW, "still asked when it was asked");
  assert.equal(await refreshAwaitingSignoff(db, { tenantId: "t", projectId: "p" }, later), "unchanged");

  // Confirmed: left exactly as they signed it.
  docs.set("detailSignoffs/t_p", { ...refreshed, status: "confirmed" });
  docs.set("questionnaireResponses/q", { ...docs.get("questionnaireResponses/q")!, answers: [{ question: "Ceremony Location", answer: "St Paul's" }] });
  assert.equal(await refreshAwaitingSignoff(db, { tenantId: "t", projectId: "p" }, later), "not_awaiting");
  assert.equal(docs.get("detailSignoffs/t_p")!.snapshotHash, refreshed.snapshotHash);

});

const hairList = (count: number) =>
  ["Priya — bride — hair", "Asha — bridesmaid — hair", "Leena — bridesmaid — hair", "Mona — mother of the bride — hair", "Ria — bridesmaid — hair", "Tara — bridesmaid — hair", "Zoya — bridesmaid — hair"]
    .slice(0, count)
    .join("\n");
const signer = { uid: "client-1", email: "priya@example.com", emailVerified: true, authMethod: "password" };
const evidence = { ipAddress: "203.0.113.9", userAgent: "test" };
/** The client's one tap, as the portal makes it: the names on the card they were shown. */
async function confirmTap(db: Firestore) {
  const view = await finalDetailsFor(db, { tenantId: "t", projectId: "p" });
  await confirmFinalDetails(db, { tenantId: "t", projectId: "p", typedName: "", snapshotHash: view!.snapshotHash, signer, evidence, now: "2026-10-12T18:00:00.000Z" });
  return view!;
}

test("a headcount's number at the lock is the floor: a list cut afterwards never lowers it", async () => {
  // Jess Styles Bridal: six on the list when it opens; then the client sends the form again with four.
  const { db, docs } = fakeDb({ "tenants/t": studio("hair"), "projects/p": job(), "questionnaireResponses/q": form(hairList(6)) });
  assert.equal(await openFinalDetailsIfDue(db, { tenantId: "t", projectId: "p" }, NOW), "opened");
  assert.equal(docs.get("detailSignoffs/t_p")!.headcount, 6);
  const asked = docs.get("detailSignoffs/t_p")!;

  docs.set("questionnaireResponses/q", form(hairList(4)));
  // The trigger's path: the list changed on a returned form, the sign-off exists, so it refreshes.
  assert.equal(formJustReturned(form(hairList(6)), form(hairList(4))), true);
  assert.equal(await openFinalDetailsIfDue(db, { tenantId: "t", projectId: "p" }, NOW), "exists");
  assert.equal(await refreshAwaitingSignoff(db, { tenantId: "t", projectId: "p" }, "2026-10-12T15:30:00.000Z"), "unchanged");
  assert.deepEqual(docs.get("detailSignoffs/t_p"), asked, "the sign-off is left exactly as it was asked");

  const view = await confirmTap(db);
  assert.equal(view.lockedHeadcount, 6, "the card still says the booking stays at six");
  assert.equal(view.people?.length, 4, "and shows the list as it stands");
  const confirmed = docs.get("detailSignoffs/t_p")!;
  assert.equal(confirmed.status, "confirmed");
  assert.equal(confirmed.confirmedHeadcount, 6, "people can be added, not taken off");
  assert.equal(confirmed.headcount, 6);
});

test("a headcount's floor doesn't move up with the list either: someone added is counted when they confirm", async () => {
  const { db, docs } = fakeDb({ "tenants/t": studio("hair"), "projects/p": job(), "questionnaireResponses/q": form(hairList(1)) });
  assert.equal(await openFinalDetailsIfDue(db, { tenantId: "t", projectId: "p" }, NOW), "opened");
  docs.set("questionnaireResponses/q", form(hairList(2)));
  assert.equal(await refreshAwaitingSignoff(db, { tenantId: "t", projectId: "p" }, "2026-10-12T15:30:00.000Z"), "unchanged");
  assert.equal(docs.get("detailSignoffs/t_p")!.headcount, 1, "the number when the details locked");
  await confirmTap(db);
  assert.equal(docs.get("detailSignoffs/t_p")!.confirmedHeadcount, 2, "Asha, added since, counts");
  // And a list emptied afterwards never takes it to nobody.
  const empty = fakeDb({ "tenants/t": studio("hair"), "projects/p": job(), "questionnaireResponses/q": form(hairList(2)) });
  assert.equal(await openFinalDetailsIfDue(empty.db, { tenantId: "t", projectId: "p" }, NOW), "opened");
  empty.docs.set("questionnaireResponses/q", form(""));
  assert.equal(await refreshAwaitingSignoff(empty.db, { tenantId: "t", projectId: "p" }, NOW), "unchanged");
  assert.equal(empty.docs.get("detailSignoffs/t_p")!.headcount, 2);
});

test("a \"Still 0\" sign-off from before takes the list's number once, the first time it names someone", async () => {
  // Opened by the old sweep before the party list was back.
  const still0 = {
    id: "t_p",
    tenantId: "t",
    projectId: "p",
    status: "awaiting_couple",
    lockOn: "2026-09-12",
    kind: "headcount",
    headcount: 0,
    snapshot: { rows: [], timeline: [], responseIds: [], scheduleId: null, scheduleVersion: null, people: [] },
    snapshotHash: "old",
    changes: [],
    createdAt: "2026-09-12T16:00:00.000Z",
    updatedAt: "2026-09-12T16:00:00.000Z",
  };
  const { db, docs } = fakeDb({ "tenants/t": studio("hair"), "projects/p": job(), "detailSignoffs/t_p": still0 });
  assert.equal(await refreshAwaitingSignoff(db, { tenantId: "t", projectId: "p" }, NOW), "unchanged", "still no list");
  docs.set("questionnaireResponses/q", form(hairList(3)));
  assert.equal(await refreshAwaitingSignoff(db, { tenantId: "t", projectId: "p" }, NOW), "refreshed");
  assert.equal(docs.get("detailSignoffs/t_p")!.headcount, 3);
  assert.deepEqual((docs.get("detailSignoffs/t_p")!.snapshot as { people: string[] }).people, ["Priya", "Asha", "Leena"]);
  docs.set("questionnaireResponses/q", form(hairList(2)));
  assert.equal(await refreshAwaitingSignoff(db, { tenantId: "t", projectId: "p" }, NOW), "unchanged", "and never again");
  assert.equal(docs.get("detailSignoffs/t_p")!.headcount, 3);
});

test("the sweep's own guards: booked, not quiet, a job with a lock, inside the window, not past the day, the studio's own", async () => {
  const outcome = async (project: Doc, tenant: Doc = studio("photographer"), input = { tenantId: "t", projectId: "p" }) => {
    const { db, docs } = fakeDb({ "tenants/t": tenant, "projects/p": project });
    const result = await openFinalDetailsIfDue(db, input, NOW);
    return { result, written: opened(docs) };
  };
  for (const [project, expected] of [
    [job({ state: "PROPOSAL" }), "not_booked"],
    [job({ state: "RETAINER_PENDING" }), "not_booked"],
    [job({ clientAutomationsPausedAt: "2026-10-01T00:00:00Z" }), "quiet"],
    [job({ archivedAt: "2026-10-01T00:00:00Z" }), "quiet"],
    [job({ state: "POSTPONED" }), "not_booked"],
    [job({ eventKind: "family" }), "no_lock"],
    [job({ eventDate: "2026-12-20" }), "before_lock"],
    [job({ eventDate: "2026-10-11" }), "event_passed"],
    [job({ tenantId: "other" }), "no_project"],
  ] as const) {
    const { result, written } = await outcome(project);
    assert.equal(result, expected, JSON.stringify(project));
    assert.deepEqual(written, [], `${expected}: nothing written`);
  }
  assert.equal((await outcome(job(), studio("photographer"), { tenantId: "t", projectId: "missing" })).result, "no_project");
});

test("the server reads the job's own calendar day, as the job page does: a US evening is still today", async () => {
  // 9:30 PM in New York on the 12th: UTC is already on the 13th.
  const evening = "2026-10-13T01:30:00.000Z";
  const open = async (project: Doc, tenant: Doc) => {
    const { db, docs } = fakeDb({ "tenants/t": tenant, "projects/p": project, "contacts/c": { tenantId: "t", email: "priya@example.com" } });
    return { result: await openFinalDetailsIfDue(db, { tenantId: "t", projectId: "p" }, evening), docs };
  };
  // Booked that evening for that day: it goes, where the UTC date called the day gone.
  assert.equal((await open(job(), studio("photographer"))).result, "event_passed", "no zone anywhere: UTC, as before");
  assert.equal((await open(job({ timezone: "America/New_York" }), studio("photographer"))).result, "opened");
  assert.equal((await open(job(), studio("photographer", { timezone: "America/New_York" }))).result, "opened", "the studio's zone");
  // The evening before the lock day by the studio's clock: not a day early.
  const lockTomorrow = job({ eventDate: "2026-11-12", timezone: "America/New_York" });
  assert.equal((await open(lockTomorrow, studio("photographer"))).result, "before_lock");
  assert.equal((await open({ ...lockTomorrow, timezone: null }, studio("photographer"))).result, "opened", "UTC is on the lock day");
  // And the journey, given the same zone, says the same.
  assert.equal(
    finalCallState({
      project: job({ timezone: "America/New_York" }),
      planningTimeline: { lockDaysBefore: 30 },
      consultations: [],
      signoff: null,
      today: finalDetailsToday(evening, "America/New_York"),
      now: evening,
    })?.state,
    "due",
  );
});

test("wired: at booking, when the form comes back, and the daily sweep, all under one rule", () => {
  const runtime = read("functions/src/operations/provider-runtime.ts");
  assert.match(runtime, /import \{ openFinalDetailsIfDue \} from "\.\.\/planning\/final-details\.js";/);
  // Both returns of completeBookingResources: the first pass and a retry's early return.
  assert.equal(runtime.match(/finalDetails:await openFinalDetails\(\)/g)?.length, 2);
  // Every booking path queues those side effects: the orchestrator and the booking gate.
  assert.match(read("functions/src/booking/orchestration.ts"), /type: "complete_booking_side_effects"/);
  assert.match(read("functions/src/booking/commands.ts"), /type: "complete_booking_side_effects"/);
  assert.match(read("functions/src/operations/jobs.ts"), /if \(type === "complete_booking_side_effects"\)\s*return completeBookingResources\(document\);/);

  const trigger = read("functions/src/planning/crew-brief-trigger.ts");
  assert.match(trigger, /if \(formJustReturned\(event\.data\?\.before\?\.data\(\), after\)\) \{[\s\S]*?const outcome = await openFinalDetailsIfDue\(db, job, now\)/);
  assert.match(trigger, /opened === "exists" \? await refreshAwaitingSignoff\(db, job, now\) : opened/);

  const sweep = read("functions/src/planning/final-details.ts");
  assert.match(sweep, /FINAL_DETAILS_STATES\.includes\(text\(data\.state\)\)/);
  assert.match(sweep, /finalDetailsDue\(\{ state: data\.state, quiet: false, eventDate: data\.eventDate, lockOn, today \}\) !== "due"\) continue;/);
  assert.match(sweep, /if \(headcount === 0\) return "no_party_list";/);
  assert.match(sweep, /tally\[outcome\] = \(tally\[outcome\] \?\? 0\) \+ 1;/, "no_party_list is counted in the sweep's tally");
  assert.match(sweep, /if \(alreadyExists\(caught\)\) return "exists";/, "two openers at once: one sign-off");

  // Every reader asks on the job's own calendar day.
  assert.match(sweep, /const today = finalDetailsToday\(now, data\.timezone, tenant\.get\("timezone"\)\);/, "the booking and form-return path");
  assert.match(sweep, /const today = finalDetailsToday\(nowDate, data\.timezone, zone\);/, "the sweep");

  // The journey and Today read the job's own sign-off and party list, not the
  // tenant-wide reads that stop at 100, and the job's own day.
  const hook = read("components/projects/use-project-journey.ts");
  assert.match(hook, /const ownFinalDetails = useFinalDetailsRecords\(\[projectId\]\)\[projectId\] \?\? null;/);
  assert.match(hook, /const finalSignoff = ownFinalDetails \? ownFinalDetails\.signoff : /);
  assert.match(hook, /const finalResponses = ownFinalDetails \? ownFinalDetails\.responses : /);
  assert.match(hook, /const finalDetailsDay = finalDetailsToday\(new Date\(\), journeyProject\?\.timezone, jobStudio\?\.timezone\);/);
  assert.equal(hook.match(/signoff: finalSignoff,/g)?.length, 2, "the headcount and the call");
  assert.equal(hook.match(/today: finalDetailsDay,/g)?.length, 2);
  assert.match(hook, /responses: finalResponses,/);
  const today = read("components/today/use-today-inbox.ts");
  assert.match(today, /const finalDetailsRecords = useFinalDetailsRecords\(\s*partyListCandidates\(\{/);
  assert.match(today, /questionnaireResponses: questionnaires\.records,\s*finalDetailsRecords,\s*studioTimezone,\s*planningTimeline,/);
  const reader = read("components/planning/use-final-details-records.ts");
  assert.match(reader, /collection\(firestore, "detailSignoffs"\), where\("tenantId", "==", tenantId\), where\("projectId", "==", projectId\), limit\(1\)/);
  assert.match(reader, /collection\(firestore, "questionnaireResponses"\), where\("tenantId", "==", tenantId\), where\("projectId", "==", projectId\), limit\(20\)/);
});

test("the form coming back is the moment, not every write to it", () => {
  const returned = { tenantId: "t", projectId: "p", status: "submitted", answers: { "party-list": "Priya — bride" } };
  assert.equal(formJustReturned(undefined, returned), true, "created already returned");
  assert.equal(formJustReturned({ ...returned, status: "sent" }, returned), true, "sent back");
  assert.equal(formJustReturned({ ...returned, status: "reopened" }, returned), true, "sent back again");
  assert.equal(formJustReturned(returned, { ...returned, status: "locked" }), false, "locked by the studio: the same list");
  assert.equal(formJustReturned(returned, { ...returned, reminderSentAt: "x" }), false, "a reminder stamp");
  assert.equal(formJustReturned(returned, { ...returned, answers: { "party-list": "Priya — bride\nAsha — bridesmaid" } }), true, "the list changed");
  assert.equal(formJustReturned(returned, { ...returned, status: "sent" }), false, "reopened is not back");
  assert.equal(formJustReturned(undefined, { ...returned, archivedAt: "x" }), false);
  assert.equal(formJustReturned(undefined, { ...returned, tenantId: undefined }), false);
});

// ── F10: Schedule A, written after the lock ────────────────────────────

/**
 * Captured from origin/main (aed5e6f1) before Schedule A learned about a lock
 * already passed: every agreement written with the lock still ahead must read,
 * and hash, exactly as these did. `document:` is the whole starter agreement
 * for each trade, resolved from the editor's sample job; `matrix` is
 * eventDetailsFrom + eventDetailsBlocks over 450 kinds, trades and lock days.
 */
const GOLDEN = {
  "document:default": "393846322e94599472ba1f277e1ac5d70918f75b563895163d8ac8d14366cdb8",
  "document:photographer": "393846322e94599472ba1f277e1ac5d70918f75b563895163d8ac8d14366cdb8",
  "document:makeup": "8c7a5a031aef5e34decbc63525b1af37ed2e434046b838464d05d2a4c9c434e4",
  "document:hair": "b86a374017354eb03bb2c9d01e69c3d7c3cc9bb009431208c169d43ae1d84102",
  "document:dj": "fb97b9ef94bb51ed22648e337845ced619f18cca191354eef62a03ce486560eb",
  matrix: "03d2bb51c4a67e780827119db96d67185064008eab954db65b41ab7104a922b2",
};
const LOCK_AHEAD = {
  photographer:
    'These details form part of this agreement. Anything marked "To be confirmed" is added when the final details are confirmed, four weeks before the date. After that, changes to locations or times are agreed with us in writing.',
  dj: 'These details form part of this agreement. Anything marked "To be confirmed" is added when the final details are confirmed, 10 days before the date. After that, changes to locations or times are agreed with us in writing.',
  beauty:
    'These details form part of this agreement. Anything marked "To be confirmed" is added when the final headcount is confirmed, 30 days before the date. After that, people can be added but not taken off, and changes to times or the location are agreed with us in writing.',
};
const sentence = (blocks: ReturnType<typeof eventDetailsBlocks>) => JSON.stringify(blocks[1]).match(/"text":"((?:[^"\\]|\\.)*)"/)![1]!.replace(/\\"/g, '"');

test("an agreement written with the lock still ahead is byte-identical to before", () => {
  for (const trade of [undefined, "photographer", "makeup", "hair", "dj"]) {
    const sources = sampleContractSources("Alder & Muse", "2026-10-12", trade);
    const resolved = resolveContractDocument({ template: { ...starterAgreementFor(trade), customFields: [] }, sources, overrides: {} });
    assert.equal(sha(canonicalJson(resolved.document)), GOLDEN[`document:${trade ?? "default"}` as keyof typeof GOLDEN], String(trade));
    assert.ok(!("lockPassed" in sources.eventDetails!), "no new key on the stored sources");
    const expected = trade === "makeup" || trade === "hair" ? LOCK_AHEAD.beauty : trade === "dj" ? LOCK_AHEAD.dj : LOCK_AHEAD.photographer;
    assert.equal(sentence(eventDetailsBlocks(sources.eventDetails!)), expected, String(trade));
  }
  const answers = [
    { question: "Bride Getting Ready Address", answer: "The Lodge, 14 Mill Lane" },
    { question: "Ceremony Location", answer: "St Mary's Church" },
    { question: "Ceremony Times", answer: "3:00 PM" },
  ];
  for (const lockPassed of [undefined, false]) {
    const matrix: string[] = [];
    for (const trade of [null, "photographer", "makeup", "hair", "dj"])
      for (const eventKind of [undefined, "wedding", "portraits", "corporate", "family"])
        for (const lockDaysBefore of [undefined, 28, 30, 14, 10, 7, 21, null, 0])
          for (const withAnswers of [true, false]) {
            const details = eventDetailsFrom({
              eventType: "Wedding",
              eventKind,
              date: "June 12, 2027",
              venue: "Harbor View Estate",
              coverage: "2 photographers, 8 hours",
              answers: withAnswers ? answers : [],
              lockDaysBefore,
              trade,
              ...(lockPassed === undefined ? {} : { lockPassed }),
            });
            matrix.push(JSON.stringify({ details, blocks: eventDetailsBlocks(details) }));
          }
    assert.equal(matrix.length, 450);
    assert.equal(sha(matrix.join("\n")), GOLDEN.matrix, `lockPassed: ${lockPassed}`);
  }
});

test("an agreement written after the lock says the details are confirmed now, in each trade's words", () => {
  const details = (trade: string | null, lockDaysBefore: number | null) =>
    eventDetailsFrom({ eventType: "Wedding", eventKind: "wedding", date: "October 12, 2026", venue: "Oak Hall", coverage: null, answers: [], lockDaysBefore, trade, lockPassed: true });
  const photo = details(null, 28);
  assert.equal(photo.lockPassed, true);
  assert.equal(
    sentence(eventDetailsBlocks(photo)),
    'These details form part of this agreement. The date is within four weeks, so the final details are confirmed as soon as the booking is made, and anything marked "To be confirmed" is added once it is decided. After that, changes to locations or times are agreed with us in writing.',
  );
  assert.match(sentence(eventDetailsBlocks(details("dj", 10))), /^These details form part of this agreement\. The date is within 10 days, so the final details are confirmed as soon as the booking is made/);
  for (const trade of ["makeup", "hair"]) {
    // The headcount is counted from the trade's own party list.
    assert.equal(tradeVocab(trade).detailsForm, "Party list", trade);
    assert.equal(
      sentence(eventDetailsBlocks(details(trade, 30))),
      'These details form part of this agreement. The date is within 30 days, so the final headcount is confirmed as soon as the party list is in, and anything marked "To be confirmed" is added then. After that, people can be added but not taken off, and changes to times or the location are agreed with us in writing.',
      trade,
    );
  }
  // No lock, nothing to have passed.
  for (const lock of [null, 0]) {
    const none = details(null, lock);
    assert.ok(!("lockPassed" in none));
    assert.equal(sentence(eventDetailsBlocks(none)), 'These details form part of this agreement. Anything marked "To be confirmed" is added once it is decided.');
  }
  // A stored schedule from before has no flag, and renders as it did.
  const stored = { ...photo };
  delete stored.lockPassed;
  assert.equal(sentence(eventDetailsBlocks(stored)), LOCK_AHEAD.photographer);
});

test("when it was written decides: the lock day on, never before; an amendment keeps the signed agreement's words unless the date moves", () => {
  const studioTimeline = resolvePlanningTimeline({ lockDaysBefore: 30 });
  assert.equal(lockPassedOn("2026-10-12", studioTimeline, "2026-09-11"), false);
  assert.equal(lockPassedOn("2026-10-12", studioTimeline, "2026-09-12"), true, "the lock day");
  assert.equal(lockPassedOn("2026-10-12", studioTimeline, "2026-10-12"), true, "booked the day of the event");
  assert.equal(lockPassedOn("", studioTimeline, "2026-10-12"), false, "no date");
  assert.equal(lockPassedOn("2026-10-12", studioTimeline, "today"), false);

  const contract = (fields: Record<string, unknown>) => ({ get: (field: string) => fields[field] });
  const flagged = contract({ document: {}, detailsLockPassed: true });
  const before = contract({ document: {} });
  assert.equal(amendedLockPassed(flagged), true);
  assert.equal(amendedLockPassed(before), false, "every agreement before 2026-10-12");
  assert.equal(amendedLockPassed(undefined), false);
  assert.equal(amendedLockPassed(flagged, true), undefined, "a moved date is decided from the new date");
  assert.equal(amendedLockPassed(before, true), undefined);

  // What the restated Schedule A says, from the date being written and the day.
  const says = (eventDate: string, today: string, restated?: boolean, lockDaysBefore = 30) =>
    scheduleSaysLockPassed({ locks: true, eventDate, timeline: resolvePlanningTimeline({ lockDaysBefore }), today, restated });
  assert.equal(says("2026-10-30", "2026-10-12"), true, "written now, inside the window");
  assert.equal(says("2027-01-16", "2026-10-12"), false, "written now, the lock ahead");
  assert.equal(scheduleSaysLockPassed({ locks: false, eventDate: "2026-10-30", timeline: studioTimeline, today: "2026-10-12" }), false, "no lock");
  assert.equal(says("2026-10-30", "2026-10-20", amendedLockPassed(flagged)), true, "signed after the lock, changed: still so");
  assert.equal(says("2026-10-30", "2026-10-20", amendedLockPassed(before)), false, "signed months ahead, changed inside the window: its words kept");
  assert.equal(says("2026-10-30", "2026-10-20", amendedLockPassed(flagged), 7), false, "a lock shortened since: its day is ahead again");
  assert.equal(says("2026-10-25", "2026-10-20", amendedLockPassed(before, true)), true, "brought into the window: the lock has gone");

  // Priya's sangeet, signed the day of the event, postponed three months:
  // the agreement she signs promises the new date's lock day, as on origin/main.
  assert.equal(lockPassedOn("2027-01-16", studioTimeline, "2026-10-20"), false);
  const postponed = says("2027-01-16", "2026-10-20", amendedLockPassed(flagged, true));
  assert.equal(postponed, false);
  const restated = eventDetailsFrom({
    eventType: "Wedding",
    eventKind: "wedding",
    date: "January 16, 2027",
    venue: null,
    coverage: null,
    answers: [],
    lockDaysBefore: 30,
    trade: "hair",
    lockPassed: postponed,
  });
  assert.ok(!("lockPassed" in restated));
  assert.equal(sentence(eventDetailsBlocks(restated)), LOCK_AHEAD.beauty);
  assert.match(sentence(eventDetailsBlocks(restated)), /30 days before the date/);

  const sources = read("functions/src/contracts/sources.ts");
  assert.match(sources, /lockPassed: scheduleSaysLockPassed\(\{ locks, eventDate, timeline, today: input\.today, restated: input\.lockPassed \}\),/);
  assert.match(sources, /return input\.locks && input\.restated !== false && lockPassedOn\(input\.eventDate, input\.timeline, input\.today\);/);
  const commands = read("functions/src/contracts/commands.ts");
  assert.match(commands, /lockPassed: loaded\.sources\.eventDetails\?\.lockPassed === true,/);
  assert.match(commands, /\.\.\.\(recheck\.lockPassed \? \{ detailsLockPassed: true \} : \{\}\),/);
  // The send's recheck resolves on the day it was prepared, so it reads the same.
  assert.match(commands, /today: String\(draftSnapshot\.get\("preparedOn"\) \?\? context\.timestamp\.slice\(0, 10\)\),/);
  assert.match(read("functions/src/contracts/combined-commands.ts"), /\.\.\.\(resolved\.draft\.lockPassed \? \{ detailsLockPassed: true \} : \{\}\),/);
  const amendments = read("functions/src/contracts/amendments.ts");
  assert.match(amendments, /\.\.\.amendedDepositLabel\(signedContract\),\s*lockPassed: amendedLockPassed\(signedContract, dateChanged\),/);
  // The amendment files what its restated Schedule A printed, not the signed one's flag.
  assert.match(amendments, /lockPassed = draft\.lockPassed;/);
  assert.match(amendments, /\.\.\.\(document && lockPassed \? \{ detailsLockPassed: true \} : \{\}\),/);
  assert.match(read("functions/src/booking/amendment-apply.ts"), /amendment\.get\("detailsLockPassed"\) === true \? \{ detailsLockPassed: true \} : \{\}/);
  // A signed agreement is its stored document: nothing renders Schedule A again from records but these.
  const renderers = ["functions/src/contracts/document.ts", "features/contracts/document.ts"].map(read);
  for (const source of renderers) assert.equal(source.match(/eventDetailsBlocks\(sources\.eventDetails\)/g)?.length, 2);
});

test("an imported job brought in with nothing known is not asked to confirm blanks; its signed contract is enough", async () => {
  // Imported 11 days out and brought in: "Your final details are ready to
  // confirm", every place and time "To be confirmed" (imported-job walk,
  // 2026-10-27).
  const imported = job({ eventDate: "2026-10-30", importedAt: "2026-10-12T12:00:00.000Z" });
  const blank = fakeDb({ "tenants/t": studio("photographer"), "projects/p": imported, "contacts/c": { tenantId: "t", email: "ivy@example.com" } });
  assert.equal(await openFinalDetailsIfDue(blank.db, { tenantId: "t", projectId: "p" }, NOW), "nothing_to_confirm");
  assert.deepEqual(opened(blank.docs), [], "nothing written, nothing emailed");

  // The studio adds the signed contract: those details are what they confirm.
  const read = fakeDb({
    "tenants/t": studio("photographer"),
    "projects/p": {
      ...imported,
      contractDetails: { rows: [{ key: "ceremony location", label: "Ceremony location", type: "text", value: "Harborview Hall" }] },
    },
    "contacts/c": { tenantId: "t", email: "ivy@example.com" },
  });
  assert.equal(await openFinalDetailsIfDue(read.db, { tenantId: "t", projectId: "p" }, NOW), "opened");
  const rows = JSON.stringify((read.docs.get("detailSignoffs/t_p")!.snapshot as { rows: unknown }).rows);
  assert.match(rows, /Harborview Hall/);
});
