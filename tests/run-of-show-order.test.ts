import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  compareScheduleItemsByStart,
  moveScheduleItem,
  scheduleItemMoves,
  sortScheduleItems,
} from "../features/schedules/run-of-show-order";
import * as serverOrder from "../functions/src/planning/item-order";
import { displayableScheduleItems } from "../features/schedules/item-clock";
import {
  WEDDING_STANDARD_MOMENTS,
  isWeddingJob,
  placeStandardMoment,
} from "../features/schedules/standard-moments";
import * as serverMoments from "../functions/src/ai/schedule-moments";
import { projectJourney, type JourneyInput } from "../features/journey/steps";
import { scheduleAnswer, todayInbox, type TodayInput } from "../features/today/inbox";
import { renderEmailTemplate } from "../functions/src/communications/email-templates";

/**
 * GR Productions, 2026-10-01: "AI building out of order. And can't move them
 * around." — and a couple's review of the day plan that nobody could see.
 */

const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");

const item = (id: string, start: string, end: string, title = id) => ({
  id,
  title,
  startAt: `2027-06-12T${start}:00.000Z`,
  endAt: `2027-06-12T${end}:00.000Z`,
});
const clock = (value: string) => value.slice(11, 16);

// --- one order, everywhere ----------------------------------------------------

test("items sort by start, stable for equal times, unusable times last", () => {
  const items = [
    item("cake", "21:00", "21:15"),
    { id: "broken", title: "broken", startAt: "", endAt: "" },
    item("toast-a", "20:00", "20:10"),
    item("toast-b", "20:00", "20:10"),
    item("ceremony", "16:00", "16:30"),
  ];
  assert.deepEqual(
    sortScheduleItems(items).map((entry) => entry.id),
    ["ceremony", "toast-a", "toast-b", "cake", "broken"],
  );
  // The other way round stays the other way round: the sort never reorders
  // equal times on its own.
  assert.deepEqual(
    sortScheduleItems([items[3], items[2]]).map((entry) => entry.id),
    ["toast-b", "toast-a"],
  );
});

test("the clock decides, not the string: offsets compare as instants", () => {
  const items = [
    { id: "later", startAt: "2027-06-12T13:00:00-04:00" }, // 17:00Z
    { id: "earlier", startAt: "2027-06-12T16:00:00Z" },
  ];
  assert.deepEqual(sortScheduleItems(items).map((entry) => entry.id), ["earlier", "later"]);
});

test("functions sorts publish and AI drafts by the same rule", () => {
  const items = [
    item("c", "19:00", "19:30"),
    item("a", "13:00", "13:30"),
    { id: "x", title: "x", startAt: "nope", endAt: "" },
    item("b1", "17:00", "17:30"),
    item("b2", "17:00", "17:30"),
  ];
  assert.deepEqual(
    serverOrder.sortScheduleItems(items).map((entry) => entry.id),
    sortScheduleItems(items).map((entry) => entry.id),
  );
  for (const [left, right] of [
    [items[0], items[1]],
    [items[2], items[3]],
    [items[3], items[4]],
  ] as const) {
    assert.equal(
      Math.sign(serverOrder.compareScheduleItemsByStart(left, right)),
      Math.sign(compareScheduleItemsByStart(left, right)),
    );
  }
  const planning = read("functions/src/planning/commands.ts");
  assert.match(planning, /const currentItems = sortScheduleItems\(parsed\.input\.items\)/);
  assert.match(read("functions/src/ai/schedule.ts"), /const normalized = sortScheduleItems\(/);
});

test("the couple's portal reads the day in the studio's order", () => {
  const items = [item("b2", "17:00", "17:30"), item("a", "13:00", "13:30"), item("b1", "17:00", "17:30")];
  assert.deepEqual(
    displayableScheduleItems(items).map((entry) => entry.id),
    sortScheduleItems(items).map((entry) => entry.id),
  );
});

// --- moving -----------------------------------------------------------------------

test("moving an item up trades time slots; each keeps its length and the gap stays", () => {
  const day = [
    item("first-dance", "19:00", "19:10"),
    item("cake", "19:30", "19:45"),
    item("dancing", "20:00", "22:00"),
  ];
  const moved = moveScheduleItem(day, 1, "up");
  assert.deepEqual(moved.map((entry) => entry.id), ["cake", "first-dance", "dancing"]);
  const [cake, dance] = moved;
  assert.equal(clock(cake!.startAt), "19:00");
  assert.equal(clock(cake!.endAt), "19:15");
  // The 20-minute gap between them is carried over.
  assert.equal(clock(dance!.startAt), "19:35");
  assert.equal(clock(dance!.endAt), "19:45");
  // The pair still ends where it ended.
  assert.equal(dance!.endAt, day[1]!.endAt);
  // Nobody else moved.
  assert.equal(moved[2], day[2]);
});

test("moving down is the same trade from the other side", () => {
  const day = [item("a", "13:00", "13:30"), item("b", "13:30", "14:30")];
  const moved = moveScheduleItem(day, 0, "down");
  assert.deepEqual(moved.map((entry) => entry.id), ["b", "a"]);
  assert.equal(clock(moved[0]!.startAt), "13:00");
  assert.equal(clock(moved[0]!.endAt), "14:00");
  assert.equal(clock(moved[1]!.startAt), "14:00");
  assert.equal(clock(moved[1]!.endAt), "14:30");
});

test("items at the same time just swap places, and the sort keeps the choice", () => {
  const day = [item("toast-1", "20:00", "20:10"), item("toast-2", "20:00", "20:10")];
  const moved = moveScheduleItem(day, 1, "up");
  assert.deepEqual(moved.map((entry) => entry.id), ["toast-2", "toast-1"]);
  assert.equal(moved[0]!.startAt, day[1]!.startAt);
  // Re-sorting does not fight it.
  assert.deepEqual(sortScheduleItems(moved).map((entry) => entry.id), ["toast-2", "toast-1"]);
});

test("a move always leaves the list in time order", () => {
  const day = [
    item("a", "13:00", "15:00"),
    item("b", "13:30", "13:40"),
    item("c", "13:45", "14:00"),
  ];
  for (let index = 0; index < day.length; index += 1) {
    for (const direction of ["up", "down"] as const) {
      const moved = moveScheduleItem(day, index, direction);
      assert.deepEqual(moved, sortScheduleItems(moved), `${index} ${direction}`);
      assert.equal(moved.length, day.length);
    }
  }
});

test("the ends of the list cannot move further", () => {
  const day = [item("a", "13:00", "13:30"), item("b", "14:00", "14:30")];
  assert.deepEqual(moveScheduleItem(day, 0, "up"), day);
  assert.deepEqual(moveScheduleItem(day, 1, "down"), day);
  assert.deepEqual(scheduleItemMoves(2, 0), { up: false, down: true });
  assert.deepEqual(scheduleItemMoves(2, 1), { up: true, down: false });
  assert.deepEqual(scheduleItemMoves(1, 0), { up: false, down: false });
});

// --- standard moments -------------------------------------------------------------

const anchors = {
  coverageStartsAt: "2027-06-12T12:00:00.000Z",
  coverageEndsAt: "2027-06-12T22:00:00.000Z",
  ceremonyAt: "2027-06-12T16:00:00.000Z",
  receptionAt: "2027-06-12T18:00:00.000Z",
};

test("moments land around the ceremony and reception", () => {
  const place = (key: Parameters<typeof placeStandardMoment>[0]) =>
    placeStandardMoment(key, [], anchors);
  assert.deepEqual(place("first_look"), {
    title: "First look",
    startAt: "2027-06-12T15:00:00.000Z",
    endAt: "2027-06-12T15:20:00.000Z",
  });
  assert.equal(clock(place("dress").startAt), "14:30");
  assert.equal(clock(place("details").startAt), "12:00");
  assert.equal(clock(place("ceremony").startAt), "16:00");
  // Cocktail hour runs from the end of the ceremony, for an hour.
  assert.equal(clock(place("cocktail").startAt), "16:30");
  assert.equal(clock(place("cocktail").endAt), "17:30");
  assert.equal(clock(place("family").startAt), "16:30");
  assert.equal(clock(place("portraits").startAt), "17:00");
  assert.equal(clock(place("reception").startAt), "18:00");
  assert.equal(clock(place("dinner").startAt), "18:30");
  assert.equal(clock(place("dinner").endAt), "19:30");
  assert.equal(clock(place("cake").startAt), "19:30");
  assert.equal(clock(place("cake").endAt), "19:45");
});

test("the Ceremony on the page wins over the form, and its own end is used", () => {
  const items = [item("c", "15:00", "15:45", "Ceremony")];
  assert.equal(clock(placeStandardMoment("cocktail", items, anchors).startAt), "15:45");
  assert.equal(clock(placeStandardMoment("first_look", items, anchors).startAt), "14:00");
});

test("a Ceremony stretched to the reception is not read as two hours of vows", () => {
  // "Build it myself" runs each seeded item up to the next one.
  const items = [item("c", "16:00", "18:00", "Ceremony"), item("r", "18:00", "22:00", "Reception")];
  assert.equal(clock(placeStandardMoment("cocktail", items, anchors).startAt), "16:30");
});

test("times the couple gave on the form are used as they are", () => {
  const placed = placeStandardMoment("cake", [], {
    ...anchors,
    cakeAt: "2027-06-12T20:15:00.000Z",
  });
  assert.equal(clock(placed.startAt), "20:15");
});

test("nothing is placed before coverage starts", () => {
  const placed = placeStandardMoment("dress", [], {
    ...anchors,
    coverageStartsAt: "2027-06-12T15:00:00.000Z",
  });
  assert.equal(clock(placed.startAt), "15:00");
});

test("with no anchor at all, a moment goes after the last item", () => {
  const placed = placeStandardMoment("cake", [item("a", "13:00", "14:00")], {});
  assert.equal(clock(placed.startAt), "14:00");
  assert.equal(clock(placed.endAt), "14:15");
});

test("the AI is given the same moments, in the same order, for weddings only", () => {
  assert.deepEqual(
    serverMoments.WEDDING_STANDARD_MOMENTS.map(({ title, minutes }) => ({ title, minutes })),
    WEDDING_STANDARD_MOMENTS.map(({ title, minutes }) => ({ title, minutes })),
  );
  const instruction = serverMoments.standardMomentsInstruction(true);
  let cursor = 0;
  for (const moment of WEDDING_STANDARD_MOMENTS) {
    const at = instruction.indexOf(moment.title, cursor);
    assert.ok(at >= cursor, `${moment.title} is missing or out of order`);
    cursor = at;
  }
  assert.equal(serverMoments.standardMomentsInstruction(false), "");
  assert.equal(serverMoments.isWeddingEventType("corporate"), false);
  assert.equal(serverMoments.isWeddingEventType("wedding"), true);
  assert.equal(isWeddingJob({ eventTypeId: "sports" }), false);
  assert.equal(isWeddingJob({ eventTypeId: "wedding" }), true);
  assert.match(read("functions/src/ai/schedule.ts"), /momentsInstruction \+/);
});

test("the editor offers the moments and keeps its list in order", () => {
  const editor = read("components/planning/ai-schedule-generator.tsx");
  assert.match(editor, /WEDDING_STANDARD_MOMENTS\.map\(/);
  assert.match(editor, /placeStandardMoment\(key, current\.items/);
  assert.match(editor, /moveScheduleItem\(current\.items, index, direction\)/);
  assert.match(editor, /onBlur=\{resortItems\}/);
  assert.match(editor, /items: sortScheduleItems\(draft\.items\)\.map\(\(item\) => withCrewIds\(item\)\)/);
  // The answer to "did the questions go?" is beside the Send button.
  assert.match(editor, /Sent to \$\{clientName\} — their answers will ground the next draft\./);
  assert.match(editor, /className=\{\s*askResult\.tone === "error"/);
});

// --- the couple's answer ----------------------------------------------------------

const journeyInput = (overrides: Partial<JourneyInput> = {}): JourneyInput => ({
  projectId: "p1",
  state: "PLANNING",
  eventDate: "2027-06-12",
  today: "2026-10-01",
  lead: null,
  hasConsultation: true,
  proposalStatus: "accepted",
  contractStatus: "signed",
  retainerInvoiceStatus: "paid",
  finalInvoiceStatus: null,
  questionnaireStatus: "submitted",
  questionnaireHasAnswers: true,
  scheduleStatus: "published",
  scheduleHasUsableItems: true,
  crewAccepted: 0,
  crewRequired: 0,
  crewCascadeActive: false,
  coiStatus: null,
  insuranceRequired: "unknown",
  dayBeforeDraftStatus: null,
  hasDelivery: false,
  albumOrReviewDone: false,
  ...overrides,
});
const runOfShow = (overrides: Partial<JourneyInput>) =>
  projectJourney(journeyInput(overrides)).steps.find((step) => step.key === "run_of_show");

test("the job's run-of-show step says what the couple answered", () => {
  const pending = runOfShow({ scheduleApprovalState: "client_pending" });
  assert.equal(pending?.status, "complete");
  assert.equal(pending?.detail, "Shared with your crew and the couple");

  const approved = runOfShow({ scheduleApprovalState: "client_approved" });
  assert.equal(approved?.status, "complete");
  assert.equal(approved?.detail, "Approved by the couple");

  const changes = runOfShow({ scheduleApprovalState: "changes_requested" });
  assert.equal(changes?.status, "current", "a change request is the studio's move");
  assert.equal(changes?.detail, "Couple asked for changes");
  assert.deepEqual(changes?.action, {
    kind: "link",
    label: "See what they asked",
    href: "/studio/schedules/new?project=p1",
  });

  // Callers that do not pass it are unchanged.
  assert.equal(runOfShow({})?.detail, "Shared with your crew and the couple");
});

const NOW = "2026-10-01T15:00:00.000Z";
const job = { id: "p1", tenantId: "t1", name: "Beth & Tom wedding", state: "PLANNING", eventDate: "2027-06-12" };
const schedule = (overrides: Record<string, unknown> = {}) => ({
  id: "s2",
  tenantId: "t1",
  projectId: "p1",
  version: 2,
  status: "published",
  approvalState: "client_pending",
  updatedAt: "2026-10-01T14:00:00.000Z",
  ...overrides,
});
const inbox = (input: Partial<TodayInput>) =>
  todayInbox({ now: NOW, projects: [job], ...input });

test("a couple asking for changes is a card on Today the same day, with their words", () => {
  const today = inbox({
    schedules: [
      schedule({ id: "s1", version: 1, status: "superseded", approvalState: "client_approved" }),
      schedule({
        approvalState: "changes_requested",
        approvalNotes: "Schedule item: Family photos (4:30 PM). Can we do family photos before cocktails?",
      }),
    ],
  });
  const card = today.act.find((entry) => entry.id === "schedule-changes-s2");
  assert.ok(card, "the change request reaches Today");
  assert.equal(card?.title, "Beth & Tom asked for changes to the day plan");
  assert.match(card!.detail, /Can we do family photos before cocktails\?/);
  assert.match(card!.detail, /Your crew still have version 2 until you publish the change\./);
  assert.equal(card?.evidence, "Asked in their portal");
  assert.deepEqual(card?.action, {
    kind: "link",
    label: "Open the day plan",
    href: "/studio/schedules/new?project=p1",
  });
});

test("the change request is one card: not again as a task or a journey step", () => {
  const today = todayInbox({
    now: "2026-10-03T15:00:00.000Z",
    projects: [job],
    schedules: [schedule({ approvalState: "changes_requested", approvalNotes: "Later dinner please" })],
    tasks: [
      {
        id: "schedule_changes_s2",
        projectId: "p1",
        title: "The couple asked for changes to timeline version 2",
        status: "not_started",
        dueDate: "2026-10-01",
        source: "client_schedule_review",
      },
    ],
    journeys: [
      {
        projectId: "p1",
        projectName: "Beth & Tom wedding",
        eventDate: "2027-06-12",
        state: "PLANNING",
        stepKey: "run_of_show",
        stepTitle: "Run of show",
        stepDetail: "Couple asked for changes",
        owner: "studio",
        actionLabel: "See what they asked",
        actionHref: "/studio/schedules/new?project=p1",
        updatedAt: NOW,
      },
    ],
  });
  assert.deepEqual(today.act.map((entry) => entry.id), ["schedule-changes-s2"]);
});

test("an approval is a quiet receipt for a week, and a pending version is nothing", () => {
  const approved = inbox({
    schedules: [schedule({ approvalState: "client_approved", approvedAt: "2026-09-30T10:00:00.000Z" })],
  });
  assert.equal(approved.act.length, 0);
  const receipt = approved.fyi.find((entry) => entry.id === "schedule-approved-s2");
  assert.equal(receipt?.title, "Beth & Tom approved the day plan");
  assert.equal(receipt?.action.kind, "none");

  const old = inbox({
    schedules: [schedule({ approvalState: "client_approved", approvedAt: "2026-09-01T10:00:00.000Z" })],
  });
  assert.equal(old.fyi.length, 0);

  const pending = inbox({ schedules: [schedule()] });
  assert.equal(pending.act.length + pending.fyi.length, 0);

  // An answer the studio wrote down for them is not news to the studio.
  const recorded = inbox({
    schedules: [
      schedule({
        approvalState: "client_approved",
        approvedAt: "2026-09-30T10:00:00.000Z",
        approvalRecordedByStudio: { recordedBy: "u1", recordedAt: "2026-09-30T10:00:00.000Z" },
      }),
    ],
  });
  assert.equal(recorded.fyi.length, 0);
});

test("only the newest version counts, and a superseded request is answered", () => {
  const today = inbox({
    schedules: [
      schedule({ id: "s1", version: 1, status: "superseded", approvalState: "changes_requested" }),
      schedule({ id: "s2", version: 2 }),
    ],
  });
  assert.equal(today.act.length, 0);
  assert.deepEqual(scheduleAnswer(schedule()), null);
  assert.equal(scheduleAnswer(schedule({ status: "changes_requested", approvalState: null }))?.decision, "changes_requested");
});

test("the studio is emailed when the couple ask for changes, and publishing closes the task", () => {
  const planning = read("functions/src/planning/commands.ts");
  assert.match(planning, /type: "studio_schedule_changes_requested"/);
  assert.match(planning, /studioNotificationAddress\(db, parsed\.tenantId\)/);
  assert.match(planning, /tasks\/schedule_changes_\$\{priorSchedule\.id\}/);

  const rendered = renderEmailTemplate({
    key: "studio_schedule_changes_requested",
    brand: {
      studioName: "GR Productions",
      productName: "StudioCue",
      accentColor: "#35664a",
      logoUrl: null,
      contactEmail: null,
    },
    values: {
      coupleName: "Beth & Tom",
      scheduleVersion: 2,
      changeNote: "Can we push dinner to 7?",
      actionUrl: "https://example.com/studio/schedules/new?project=p1",
    },
  });
  assert.equal(rendered.subject, "Beth & Tom asked for changes to the day plan");
  assert.match(rendered.text, /version 2 of the day plan/);
  assert.match(rendered.text, /Can we push dinner to 7\?/);
  assert.match(rendered.html, /https:\/\/example\.com\/studio\/schedules\/new\?project=p1/);
});

test("the couple are told their answer went only when it reached the studio", () => {
  const portal = read("components/client/kit/client-schedule.tsx");
  assert.match(portal, /const response = await sendPlanningCommand\("approveSchedule"/);
  assert.match(portal, /if \(!response\.persisted\)/);
  assert.doesNotMatch(portal, /if \(dataIsLive\)\s*\n?\s*await sendPlanningCommand/);
});
