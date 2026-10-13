import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  STARTER_PLANNING_CHECKLISTS,
  checklistDueDate,
  checklistFor,
  checklistIsCustom,
  checklistProblem,
  checklistProgress,
  checklistScopeOf,
  checklistTaskPlan,
  dayBefore,
  followEventDate,
  offsetLabel,
  planningChecklistTaskId,
} from "../features/planning/planning-checklist";
import { todayInbox } from "../features/today/inbox";

/**
 * A planner's planning checklist (docs/planner-journey-plan.md, N8, Phase 3):
 * the starter lists per tier, due dates from the wedding date, booking that
 * writes it once, a moved date that moves it, and the studio's own list.
 */

const read = (path: string) => readFileSync(path, "utf8");
const MARKER = "// ── mirrored below ──";
const below = (path: string) => read(path).slice(read(path).indexOf(MARKER));

test("the functions copy is the same below the marker", () => {
  assert.equal(below("functions/src/planning/planning-checklist.ts"), below("features/planning/planning-checklist.ts"));
});

test("full and partial planning have a starter list; month-of and every other job have none", () => {
  assert.equal(checklistScopeOf({ planningScope: "full" }), "full");
  assert.equal(checklistScopeOf({ planningScope: "partial" }), "partial");
  assert.equal(checklistScopeOf({ planningScope: "coordination" }), null);
  assert.equal(checklistScopeOf({}), null);
  assert.equal(checklistScopeOf({ planningScope: "anything" }), null);
  const full = STARTER_PLANNING_CHECKLISTS.full;
  const partial = STARTER_PLANNING_CHECKLISTS.partial;
  assert.ok(full.length >= 15 && full.length <= 20, `full has ${full.length}`);
  assert.ok(partial.length >= 8 && partial.length < full.length, `partial has ${partial.length}`);
  for (const list of [full, partial]) {
    assert.equal(checklistProblem(list), null);
    // Journey steps are steps, not checklist items.
    for (const entry of list) assert.doesNotMatch(entry.title, /walkthrough|final details|balance|timeline|confirm/i, entry.title);
  }
  // The venue and the budget lead a full planning year; the sourcing order follows.
  const order = full.map((entry) => entry.key);
  assert.deepEqual(order.slice(0, 2), ["budget", "venue"]);
  for (const [earlier, later] of [["venue", "photographer"], ["photographer", "florist"], ["caterer", "florist"], ["florist", "cake"], ["cake", "transportation"]]) {
    assert.ok(order.indexOf(earlier!) < order.indexOf(later!), `${earlier} before ${later}`);
  }
  // Partial starts about six months out, with no venue to book.
  assert.ok(partial.every((entry) => entry.unit === "weeks" || entry.amount <= 6));
  assert.ok(!partial.some((entry) => entry.key === "venue"));
  assert.equal(offsetLabel(full[2]!), "10 months before");
  assert.equal(offsetLabel({ amount: 1, unit: "weeks" }), "1 week before");
});

test("due dates count back from the wedding: months to the same day, the end of a short month, weeks in days", () => {
  assert.equal(dayBefore("2027-09-11", { amount: 10, unit: "months" }), "2026-11-11");
  assert.equal(dayBefore("2027-03-31", { amount: 1, unit: "months" }), "2027-02-28");
  assert.equal(dayBefore("2028-03-31", { amount: 1, unit: "months" }), "2028-02-29");
  assert.equal(dayBefore("2027-01-15", { amount: 2, unit: "months" }), "2026-11-15");
  assert.equal(dayBefore("2027-09-11", { amount: 2, unit: "weeks" }), "2027-08-28");
  assert.equal(dayBefore("not a date", { amount: 2, unit: "weeks" }), null);
  // Already past: due today, not in the past.
  assert.equal(checklistDueDate("2027-03-01", { amount: 12, unit: "months" }, "2026-10-12"), "2026-10-12");
  assert.equal(checklistDueDate("2027-09-11", { amount: 10, unit: "months" }, "2026-10-12"), "2026-11-11");
});

const ITEMS = STARTER_PLANNING_CHECKLISTS.full;
const TODAY = "2026-10-12";

test("booking writes a task per item with a fixed id, an 11-month-out wedding's first items due today", () => {
  const plan = checklistTaskPlan({ projectId: "p1", eventDate: "2027-09-11", items: ITEMS, today: TODAY, existing: [] });
  assert.equal(plan.create.length, ITEMS.length);
  assert.equal(plan.update.length, 0);
  const byKey = new Map(plan.create.map((task) => [task.checklistKey, task]));
  assert.equal(byKey.get("venue")!.id, "planning_p1_venue");
  assert.equal(byKey.get("venue")!.dueDate, TODAY, "12 months before has passed");
  assert.equal(byKey.get("photographer")!.dueDate, "2026-11-11");
  assert.equal(byKey.get("seating_chart")!.dueDate, "2027-08-28");
  for (const task of plan.create) assert.equal(task.checklistDueDate, task.dueDate);
});

test("running it again writes nothing new and never brings back a finished or removed item", () => {
  const first = checklistTaskPlan({ projectId: "p1", eventDate: "2027-09-11", items: ITEMS, today: TODAY, existing: [] });
  const existing = first.create.map((task) => ({ ...task, status: "not_started" }));
  const again = checklistTaskPlan({ projectId: "p1", eventDate: "2027-09-11", items: ITEMS, today: TODAY, existing });
  assert.deepEqual(again, { create: [], update: [] });
  const marked = existing.map((task) =>
    task.checklistKey === "photographer"
      ? { ...task, status: "complete" }
      : task.checklistKey === "videographer"
        ? { ...task, status: "cancelled" }
        : task.checklistKey === "officiant"
          ? { ...task, dueDate: "2026-12-24" }
          : task,
  );
  // The date moved before a second delivery: open, untouched items follow; the rest stay.
  const moved = checklistTaskPlan({ projectId: "p1", eventDate: "2027-10-09", items: ITEMS, today: TODAY, existing: marked });
  assert.equal(moved.create.length, 0);
  const ids = moved.update.map((change) => change.id);
  for (const key of ["photographer", "videographer", "officiant"]) assert.ok(!ids.includes(planningChecklistTaskId("p1", key)), key);
  assert.ok(ids.includes(planningChecklistTaskId("p1", "florist")));
});

test("a moved wedding moves open items by their own offset; done, removed, hand-moved and one-off items stay", () => {
  const tasks = [
    { id: "a", status: "not_started", dueDate: "2026-11-11", checklistDueDate: "2026-11-11", checklistAmount: 10, checklistUnit: "months" },
    { id: "b", status: "complete", dueDate: "2027-01-11", checklistDueDate: "2027-01-11", checklistAmount: 8, checklistUnit: "months" },
    { id: "c", status: "cancelled", dueDate: "2027-01-11", checklistDueDate: "2027-01-11", checklistAmount: 8, checklistUnit: "months" },
    { id: "d", status: "not_started", dueDate: "2027-02-01", checklistDueDate: "2027-01-11", checklistAmount: 8, checklistUnit: "months" },
    { id: "e", status: "not_started", dueDate: "2027-03-01" },
    { id: "f", status: "in_progress", dueDate: "2027-08-28", checklistDueDate: "2027-08-28", checklistAmount: 2, checklistUnit: "weeks" },
    { id: "g", status: "not_started", dueDate: TODAY, checklistDueDate: TODAY, checklistAmount: 12, checklistUnit: "months" },
  ];
  const moves = followEventDate({ eventDate: "2027-10-09", today: TODAY, tasks });
  assert.deepEqual(moves, [
    { id: "a", dueDate: "2026-12-09", checklistDueDate: "2026-12-09" },
    { id: "f", dueDate: "2027-09-25", checklistDueDate: "2027-09-25" },
  ]);
  // Moved earlier, an item already past is due today (g stays today: nothing to write).
  const earlier = followEventDate({ eventDate: "2027-06-05", today: TODAY, tasks });
  assert.deepEqual(earlier.find((move) => move.id === "a"), { id: "a", dueDate: TODAY, checklistDueDate: TODAY });
  assert.ok(!earlier.some((move) => move.id === "g"));
  assert.deepEqual(followEventDate({ eventDate: null, today: TODAY, tasks }), []);
});

test("the studio's own list replaces the starter one; an empty list is a choice; a broken one falls back", () => {
  assert.deepEqual(checklistFor(undefined, "full"), [...ITEMS]);
  assert.equal(checklistIsCustom(undefined, "full"), false);
  const own = [{ key: "own_1", title: "  Book the photo booth ", amount: 5, unit: "months" }];
  const stored = { full: { items: own, updatedAt: "x" } };
  assert.deepEqual(checklistFor(stored, "full"), [{ key: "own_1", title: "Book the photo booth", amount: 5, unit: "months" }]);
  assert.equal(checklistIsCustom(stored, "full"), true);
  assert.deepEqual(checklistFor(stored, "partial"), [...STARTER_PLANNING_CHECKLISTS.partial], "the other tier keeps its starter list");
  assert.deepEqual(checklistFor({ full: { items: [] } }, "full"), []);
  assert.deepEqual(checklistFor({ full: { items: null } }, "full"), [...ITEMS], "null is the starter list back");
  assert.deepEqual(checklistFor({ full: { items: [{ key: "x", title: "", amount: 1, unit: "months" }] } }, "full"), [...ITEMS]);
});

test("the editor refuses what can't be saved, in the studio's words", () => {
  const good = { key: "own_1", title: "Book the photo booth", amount: 5, unit: "months" };
  assert.equal(checklistProblem([good]), null);
  assert.equal(checklistProblem([]), null);
  assert.match(checklistProblem("nope")!, /didn't come through/);
  assert.match(checklistProblem([{ ...good, title: " " }])!, /Item 1 needs a name/);
  assert.match(checklistProblem([good, good])!, /Item 2 is in the list twice/);
  assert.match(checklistProblem([{ ...good, key: "Bad Key" }])!, /missing its key/);
  assert.match(checklistProblem([{ ...good, amount: 0 }])!, /between 1 and 24 months/);
  assert.match(checklistProblem([{ ...good, amount: 25 }])!, /between 1 and 24 months/);
  assert.equal(checklistProblem([{ ...good, amount: 30, unit: "weeks" }]), null);
  assert.match(checklistProblem([{ ...good, amount: 2.5 }])!, /between 1 and/);
  assert.match(checklistProblem([{ ...good, unit: "days" }])!, /months or weeks/);
  assert.match(checklistProblem([{ ...good, title: "x".repeat(121) }])!, /too long/);
  assert.match(checklistProblem(Array.from({ length: 41 }, (_, index) => ({ ...good, key: `k${index}` })))!, /up to 40/);
});

test("the job's panel reads '6 of 18 done' and the next due first; removed items don't count", () => {
  const tasks = [
    { id: "1", source: "planning_checklist", title: "Book the venue", status: "complete", dueDate: "2026-10-12" },
    { id: "2", source: "planning_checklist", title: "Book the florist", status: "not_started", dueDate: "2027-01-11" },
    { id: "3", source: "planning_checklist", title: "Book the caterer", status: "not_started", dueDate: "2026-10-01" },
    { id: "4", source: "planning_checklist", title: "Book the cake", status: "cancelled", dueDate: "2027-03-11" },
    { id: "5", source: "trial_extensions", title: "Order extensions", status: "not_started", dueDate: "2026-10-01" },
    { id: "6", source: "planning_checklist", title: "Photo booth", status: "not_started", dueDate: null },
  ];
  const progress = checklistProgress(tasks, TODAY);
  assert.equal(progress.summary, "1 of 4 done");
  assert.equal(progress.overdue, 1);
  assert.deepEqual(progress.open.map((row) => row.id), ["3", "2", "6"]);
  assert.equal(checklistProgress([], TODAY).summary, "Nothing on it yet");
});

test("Today: a checklist item arrives the day it falls due and opens the job's checklist; other tasks still wait a day", () => {
  const project = { id: "p1", name: "Shah Wedding", state: "BOOKED", eventDate: "2027-09-11" };
  const inbox = todayInbox({
    now: "2026-10-12T15:00:00.000Z",
    projects: [project],
    tasks: [
      { id: "planning_p1_venue", projectId: "p1", source: "planning_checklist", title: "Book the venue", status: "not_started", dueDate: "2026-10-12" },
      { id: "planning_p1_photographer", projectId: "p1", source: "planning_checklist", title: "Book the photographer", status: "not_started", dueDate: "2026-11-11" },
      { id: "plain", projectId: "p1", title: "Call the venue", status: "not_started", dueDate: "2026-10-12" },
      { id: "late", projectId: "p1", source: "planning_checklist", title: "Book the caterer", status: "not_started", dueDate: "2026-10-01" },
      { id: "done", projectId: "p1", source: "planning_checklist", title: "Set the budget", status: "complete", dueDate: "2026-10-01" },
    ],
  });
  const ids = inbox.act.map((item) => item.id);
  assert.ok(ids.includes("task-planning_p1_venue"));
  assert.ok(ids.includes("task-late"));
  assert.ok(!ids.includes("task-planning_p1_photographer"));
  assert.ok(!ids.includes("task-plain"), "an ordinary task still reaches Today once overdue");
  assert.ok(!ids.includes("task-done"));
  const venue = inbox.act.find((item) => item.id === "task-planning_p1_venue")!;
  assert.equal(venue.evidence, "On your planning checklist");
  assert.equal(venue.band, "soon", "due today is not late");
  assert.equal(inbox.act.find((item) => item.id === "task-late")!.band, "overdue");
  assert.ok(venue.facts.includes("due today"));
  assert.deepEqual(venue.action, { kind: "link", label: "Open the checklist", href: "/studio/projects/p1#planning-checklist" });
});

test("the server pieces are wired: the command, the one-off item, the trigger", () => {
  const commands = read("functions/src/planning/commands.ts");
  assert.match(commands, /type: z\.literal\("setPlanningChecklist"\)/);
  assert.match(commands, /tradeProfile\(tenantSnapshot\.get\("trade"\)\)\.planningScope/);
  assert.match(read("functions/src/workflow/commands.ts"), /source: z\.literal\("planning_checklist"\)\.optional\(\)/);
  assert.match(read("functions/src/index.ts"), /planningChecklistOnProjectWritten/);
  const sync = read("functions/src/planning/planning-checklist-sync.ts");
  // Every job without a tier, and every month-of job, returns before reading anything.
  assert.match(sync, /if \(!applied && !checklistScopeOf\(after\)\) return;/);
});
