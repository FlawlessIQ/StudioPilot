import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { combinedSnapshot } from "../functions/src/packages/combined-snapshot.ts";

const snapshot = (fields: Record<string, unknown>) => ({ get: (field: string) => fields[field] });
const read = (path: string) => readFileSync(path, "utf8");

test("money fields add up across a job's packages; everything else is the primary's", () => {
  const photo = snapshot({ packageName: "Photography", totalCents: 450_000, taxCents: 0, retainerCents: 100_000 });
  const film = snapshot({ packageName: "Film", totalCents: 300_000, retainerCents: 50_000 });
  const job = combinedSnapshot([photo, film]);
  assert.equal(job.get("totalCents"), 750_000, "the film is billed too");
  assert.equal(job.get("retainerCents"), 150_000);
  assert.equal(job.get("taxCents"), 0, "a field one package leaves out counts as nothing");
  assert.equal(job.get("packageName"), "Photography");
  assert.equal(job.get("discountCents"), undefined, "absent everywhere stays absent");
});

test("a job with one package reads exactly as that package", () => {
  const only = snapshot({ totalCents: 250_000, retainerCents: 50_000, packageName: "Family session" });
  const job = combinedSnapshot([only]);
  for (const field of ["totalCents", "retainerCents", "packageName"]) assert.equal(job.get(field), only.get(field), field);
});

test("every money fallback reads the whole job, not the primary snapshot", () => {
  // The accepted proposal still leads in each; these are the fallbacks for a
  // job with no accepted proposal (an imported booking, one booked straight
  // from a package).
  const finalInvoice = read("functions/src/booking/final-invoice.ts");
  assert.match(finalInvoice, /const packageSnapshot = combinedSnapshot\(jobSnapshots\);/);
  assert.match(finalInvoice, /readJobSnapshots\(db, project\.data\(\), tenantId, \(reference\) => transaction\.get\(reference\)\)/);

  const corrections = read("functions/src/booking/invoice-corrections.ts");
  assert.match(corrections, /snapshots\.length \? combinedSnapshot\(snapshots\) : null/);

  const orchestration = read("functions/src/booking/orchestration.ts");
  assert.equal(orchestration.match(/combinedSnapshot\(jobSnapshots\)/g)?.length, 2);
  assert.doesNotMatch(orchestration, /db\.doc\(`packageSnapshots\/\$\{packageSnapshotId\}`\)\.get\(\)/);

  const commands = read("functions/src/booking/commands.ts");
  assert.match(commands, /const jobTotal = combinedSnapshot\(\s*await readJobSnapshots\(firestore, project\.data\(\), command\.tenantId\),\s*\)\.get\("totalCents"\);/);

  // And the closeout screen shows the number the server will record.
  assert.match(read("components/post-event/delivery-closeout-workspace.tsx"), /currentJobSnapshots\(packageSnapshots \?\? \[\], project\)\.reduce\(/);
});
