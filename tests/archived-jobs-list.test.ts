import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * "Archived" means the same thing on every list.
 *
 * Leads, contacts, vendors, crew profiles and the generic domain view all read
 * `archivedAt`. The Jobs list read only `state === "ARCHIVED"`, so a job put
 * away any other way stayed on the Active tab permanently and never appeared
 * under Archived — found while clearing a dry run's test jobs out of a live
 * account, where nine archive writes hid the inquiries and none of the jobs.
 */
const source = readFileSync(
  `${process.cwd()}/components/live/tenant-records.tsx`,
  "utf8",
);

test("the jobs list honours both the state and the field", () => {
  const rows = source.slice(
    source.indexOf("export function LiveProjectRows"),
    source.indexOf("export function LiveProjectRows") + 4000,
  );
  assert.match(rows, /const putAway =\s*\n?\s*item\.state === "ARCHIVED" \|\| Boolean\(item\.archivedAt\)/);
  assert.match(rows, /view === "archived" \? putAway : !putAway/);
});
