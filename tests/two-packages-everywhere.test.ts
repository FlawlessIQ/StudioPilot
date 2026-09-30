import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Photo and video on one wedding, wherever a package is chosen (Gabe,
 * 2026-09-30: "Cant pick two packages" and "Think we need a back or undo
 * button").
 */
const read = (file: string) => readFileSync(file, "utf8");

test("the consultation brief takes more than one package, and adds the rest alongside the first", () => {
  const brief = read("components/booking/booking-autopilot-workspace.tsx");
  assert.match(brief, /const \[extraPackageIds, setExtraPackageIds\] = useState<string\[\]>\(\[\]\)/);
  assert.match(brief, /aria-pressed=\{main \|\| extra\}/);
  assert.match(brief, /for \(const packageId of extraPackageIds\) \{[\s\S]{0,200}mode: "add"/);
  assert.match(brief, /PACKAGE_ALREADY_ON_JOB/);
});

test("the proposal composer can add, remove or start over, and prices every package", () => {
  const composer = read("components/proposals/studio-proposal-workspace.tsx");
  assert.match(composer, /Add or change packages/);
  assert.match(composer, /runCrmCommand\("removePackage", \{ projectId: projectIdToEdit, packageSnapshotId \}\)/);
  assert.match(composer, /confirmReplace: mode === "replace" && Boolean\(selectedFor\(packagePickerFor\.id\)\)/);
  assert.match(composer, /"Start over with this one"/);
  // The offer snapshot is the job's whole total, as create_draft prices it.
  assert.match(composer, /totalCents: allSnapshots\.reduce/);
  assert.match(composer, /retainerCents: allSnapshots\.reduce/);
  assert.match(composer, /extraSnapshots: extras/);
});
