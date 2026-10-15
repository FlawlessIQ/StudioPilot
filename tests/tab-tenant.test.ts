import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Each tab works in its own studio (lib/firebase/tab-tenant.ts). Prod test
 * 2026-10-15: a second tab switched the shared localStorage choice, and the
 * first tab's Data & account screen exported the other studio while its
 * sidebar still named the first.
 */
test("nothing reads or writes the studio choice except through the per-tab helper", () => {
  const offenders = globSync("{app,components,features,lib}/**/*.{ts,tsx}")
    .filter((file) => file !== "lib/firebase/tab-tenant.ts")
    .filter((file) => /(local|session)Storage\.(get|set)Item\(\s*"studiohub\.activeTenantId"/.test(readFileSync(file, "utf8")));
  assert.deepEqual(offenders, []);
});

test("the tab's own choice wins over the one every tab shares", async () => {
  const stores: Record<string, Map<string, string>> = { session: new Map(), local: new Map() };
  const storage = (map: Map<string, string>) => ({ getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) });
  (globalThis as Record<string, unknown>).window = { sessionStorage: storage(stores.session!), localStorage: storage(stores.local!) };
  const { preferredTenantId, rememberTenantId } = await import("../lib/firebase/tab-tenant.ts");
  rememberTenantId("test-studio");
  // Another tab switches the shared choice…
  stores.local!.set("studiohub.activeTenantId", "flawlessiq");
  // …and this tab keeps its own.
  assert.equal(preferredTenantId(), "test-studio");
  // A new tab starts from the shared choice.
  stores.session!.clear();
  assert.equal(preferredTenantId(), "flawlessiq");
  delete (globalThis as Record<string, unknown>).window;
});
