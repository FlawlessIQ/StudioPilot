import assert from "node:assert/strict";
import test from "node:test";
import { orderJobsForList } from "@/features/projects/job-order";

const NOW = new Date("2026-08-21T12:00:00.000Z");

const job = (name: string, eventDate: string | null) => ({ name, eventDate });

test("what is coming leads, soonest first", () => {
  const ordered = orderJobsForList(
    [
      job("Bianchi", "2026-10-17"),
      job("Castillo", "2026-08-24"),
      job("Ferrante", "2027-01-09"),
    ],
    NOW,
  );
  assert.deepEqual(
    ordered.map((entry) => entry.name),
    ["Castillo", "Bianchi", "Ferrante"],
  );
});

test("past events follow the upcoming ones, most recent first", () => {
  const ordered = orderJobsForList(
    [
      job("Whitfield", "2026-06-20"),
      job("Castillo", "2026-08-24"),
      job("Rivera", "2026-07-25"),
    ],
    NOW,
  );
  // The wedding still to come leads; then the freshest edit, then the oldest.
  assert.deepEqual(
    ordered.map((entry) => entry.name),
    ["Castillo", "Rivera", "Whitfield"],
  );
});

test("undated jobs sink to the bottom rather than sorting as ancient", () => {
  const ordered = orderJobsForList(
    [job("No date", null), job("Rivera", "2026-07-25"), job("Castillo", "2026-08-24")],
    NOW,
  );
  assert.deepEqual(
    ordered.map((entry) => entry.name),
    ["Castillo", "Rivera", "No date"],
  );
});

test("document-id order can never reassert itself", () => {
  // The exact failure from the audit: alphabetical keys put a wedding 310
  // days out above one four days out.
  const ordered = orderJobsForList(
    [job("job-bianchi", "2026-10-17"), job("job-castillo", "2026-08-24")],
    NOW,
  );
  assert.equal(ordered[0]?.name, "job-castillo");
});

test("ordering never mutates the caller's array", () => {
  const input = [job("Bianchi", "2026-10-17"), job("Castillo", "2026-08-24")];
  const before = input.map((entry) => entry.name);
  orderJobsForList(input, NOW);
  assert.deepEqual(input.map((entry) => entry.name), before);
});
