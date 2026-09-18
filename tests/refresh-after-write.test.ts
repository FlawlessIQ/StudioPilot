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
