import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * A refresh must not be served a read that started before the write.
 *
 * `cachedTenantDocuments` shares one in-flight request per key, which is right
 * for a page reading a dozen collections. It was wrong across a write: two
 * commands in a row — record a closeout attestation, then reconcile — each
 * called `refreshTenantRecords`, and the second refresh was handed the read the
 * first had started, from before the attestation existed. The panel sat at
 * "6 of 8 are settled" with the row still listed, while the reconcile line
 * beside it already knew there were seven: two contradicting counts on one
 * panel, correct again only after a manual reload.
 *
 * Every "refresh after an action" in the product goes through this one path,
 * which is why the same staleness has been reported on unrelated screens.
 *
 * Asserted at source because the mechanism is module-level caching inside a
 * "use client" component that imports the Firebase SDK; the behaviour has no
 * seam to call. Each assertion names a distinct half of the fix.
 */
const source = readFileSync(
  `${process.cwd()}/components/live/tenant-records.tsx`,
  "utf8",
);

test("a refresh drops in-flight reads as well as cached answers", () => {
  const refresh = source.slice(
    source.indexOf("export function refreshTenantRecords"),
    source.indexOf("export function refreshTenantRecords") + 2600,
  );
  assert.match(
    refresh,
    /tenantRecordsRequests\.keys\(\)[\s\S]*tenantRecordsRequests\.delete\(key\)/,
    "refreshTenantRecords must forget in-flight reads, not only the cache",
  );
  assert.match(refresh, /tenantRecordsCache\.delete\(key\)/);
});

test("a dropped read cannot put its stale answer back in the cache", () => {
  const cached = source.slice(
    source.indexOf("async function cachedTenantDocuments"),
    source.indexOf("async function cachedTenantDocuments") + 2000,
  );
  // The cache write is guarded by "this read is still the registered one".
  assert.match(
    cached,
    /if \(tenantRecordsRequests\.get\(key\) === request\)\s*\n?\s*tenantRecordsCache\.set\(/,
  );
});

test("a settled read only clears its own map entry", () => {
  const cached = source.slice(
    source.indexOf("async function cachedTenantDocuments"),
    source.indexOf("async function cachedTenantDocuments") + 2000,
  );
  assert.match(
    cached,
    /if \(tenantRecordsRequests\.get\(key\) === request\)\s*\n?\s*tenantRecordsRequests\.delete\(key\)/,
    "a stale read's finally must not evict the newer read under the same key",
  );
});

/**
 * A page that loads its own records must re-run on the same signal.
 *
 * `refreshTenantRecords` only reaches components reading through
 * `useTenantDocuments`. The job page loads the project itself, so every write
 * made from it — archiving in particular — left the page describing the
 * project as it was before: the archive command succeeded and the page went on
 * offering "Archive job" with no sign it had worked. Seen on production.
 *
 * `useTenantRecordsGeneration` exists for exactly this. Any page holding its
 * own loader beside a write control has to depend on it.
 */
test("the job page re-reads the project after a write made on it", () => {
  const page = readFileSync(
    `${process.cwd()}/components/projects/live-project-detail.tsx`,
    "utf8",
  );
  assert.match(
    page,
    /useTenantRecordsGeneration/,
    "the job page loads the project itself and must re-run on the refresh signal",
  );
  // In the loader's dependencies, not merely imported.
  const loader = page.slice(page.indexOf("export function LiveProjectDetail"));
  assert.match(
    loader,
    /\}, \[projectId, recordsGeneration, workspace\.loading, workspace\.tenantId\]\);/,
    "the generation must be a dependency of the effect that loads the project",
  );
});
