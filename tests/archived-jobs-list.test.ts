import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isPutAway, liveProjects } from "../features/projects/put-away";

/**
 * "Archived" means the same thing on every list.
 *
 * Leads, contacts, vendors, crew profiles and the generic domain view all read
 * `archivedAt`. The Jobs list read only `state === "ARCHIVED"`, so a job put
 * away any other way stayed on the Active tab permanently and never appeared
 * under Archived — found while clearing a dry run's test jobs out of a live
 * account, where nine archive writes hid the inquiries and none of the jobs.
 *
 * Fixing the list left the same jobs turning up in every *picker*: the delivery
 * page offered five archived weddings, one of them a questionnaire test, in the
 * dropdown that chooses whose photographs go out. So the rule is one function
 * now, and these tests hold both halves.
 */

test("a job is put away by the state or by the field", () => {
  assert.equal(isPutAway({ state: "ARCHIVED" }), true);
  assert.equal(isPutAway({ state: "CLOSED", archivedAt: "2026-09-18" }), true);
  assert.equal(isPutAway({ state: "CLOSED", archivedAt: null }), false);
  assert.equal(isPutAway({ state: "BOOKED" }), false);
  // A closed job is finished, but it has not been put away.
  assert.equal(isPutAway({ state: "DELIVERED" }), false);
  assert.equal(isPutAway(undefined), false);
});

test("liveProjects keeps only the jobs a studio can still act on", () => {
  const jobs = [
    { id: "a", state: "BOOKED", archivedAt: null },
    { id: "b", state: "ARCHIVED", archivedAt: null },
    { id: "c", state: "CLOSED", archivedAt: "2026-09-18T00:00:00.000Z" },
    { id: "d", state: "DELIVERED", archivedAt: null },
  ];
  assert.deepEqual(
    liveProjects(jobs).map((job) => job.id),
    ["a", "d"],
  );
  assert.deepEqual(liveProjects(null), []);
});

/**
 * Every project picker offers live jobs only. Source-level because the failure
 * is a picker that simply forgot to ask — there is nothing to assert about a
 * dropdown that maps the raw list.
 */
test("no project picker maps the raw project list", () => {
  const pickers = [
    "components/post-event/delivery-form.tsx",
    "components/booking/studio-calendar.tsx",
    "components/planning/coi-workflow-panel.tsx",
    "components/planning/ai-schedule-generator.tsx",
    "components/workflows/create-task-form.tsx",
    "components/live/tenant-records.tsx",
  ];
  for (const picker of pickers) {
    const source = readFileSync(`${process.cwd()}/${picker}`, "utf8");
    assert.match(
      source,
      /liveProjects\(/,
      `${picker} offers a project picker and must filter put-away jobs`,
    );
  }
});

test("the jobs list splits on the shared predicate", () => {
  const source = readFileSync(
    `${process.cwd()}/components/live/tenant-records.tsx`,
    "utf8",
  );
  const rows = source.slice(
    source.indexOf("export function LiveProjectRows"),
    source.indexOf("export function LiveProjectRows") + 4000,
  );
  assert.match(
    rows,
    /view === "archived" \? isPutAway\(item\) : !isPutAway\(item\)/,
  );
});
