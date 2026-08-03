import assert from "node:assert/strict";
import test from "node:test";
import {
  capabilitySelectionsSchema,
  eligibleProvidersFor,
  resolveActiveProvider,
  type RoutableConnection,
} from "../features/integrations/routing";
import { providerCapabilities } from "../features/integrations/schema";

function connection(
  provider: RoutableConnection["provider"],
  overrides: Partial<RoutableConnection> = {},
): RoutableConnection {
  return {
    provider,
    status: "connected",
    archivedAt: null,
    ...overrides,
  };
}

test("every provider declares at least one capability", () => {
  for (const capabilities of Object.values(providerCapabilities)) {
    assert.ok(capabilities.length > 0);
  }
});

test("capabilitySelectionsSchema accepts a partial map with some capabilities unset", () => {
  const result = capabilitySelectionsSchema.safeParse({ signing: "docusign" });
  assert.equal(result.success, true);
});

test("capabilitySelectionsSchema accepts an empty map", () => {
  const result = capabilitySelectionsSchema.safeParse({});
  assert.equal(result.success, true);
});

test("capabilitySelectionsSchema rejects a provider that doesn't exist", () => {
  const result = capabilitySelectionsSchema.safeParse({ signing: "fax_machine" });
  assert.equal(result.success, false);
});

test("with no connections and no selection, signing is unresolved", () => {
  const result = resolveActiveProvider({
    capability: "signing",
    routing: null,
    connections: [],
  });
  assert.deepEqual(result, { outcome: "unresolved", reason: "no_connected_provider" });
});

test("a single connected signing provider auto-resolves with no explicit selection", () => {
  const result = resolveActiveProvider({
    capability: "signing",
    routing: null,
    connections: [connection("docusign")],
  });
  assert.deepEqual(result, {
    outcome: "resolved",
    provider: "docusign",
    reason: "sole_connected_provider",
  });
});

test("two connected signing providers with no explicit selection are ambiguous", () => {
  const result = resolveActiveProvider({
    capability: "signing",
    routing: null,
    connections: [connection("docusign"), connection("dropbox_sign")],
  });
  assert.deepEqual(result, {
    outcome: "unresolved",
    reason: "ambiguous_multiple_providers",
  });
});

test("an explicit selection wins over the sole-provider default", () => {
  const result = resolveActiveProvider({
    capability: "signing",
    routing: { selections: { signing: "dropbox_sign" } },
    connections: [connection("docusign"), connection("dropbox_sign")],
  });
  assert.deepEqual(result, {
    outcome: "resolved",
    provider: "dropbox_sign",
    reason: "explicit_selection",
  });
});

test("an explicit selection to a disconnected provider does not resolve", () => {
  const result = resolveActiveProvider({
    capability: "signing",
    routing: { selections: { signing: "dropbox_sign" } },
    connections: [
      connection("docusign"),
      connection("dropbox_sign", { status: "disconnected" }),
    ],
  });
  assert.deepEqual(result, {
    outcome: "unresolved",
    reason: "selected_provider_not_connected",
  });
});

test("an explicit selection to a degraded provider does not resolve", () => {
  const result = resolveActiveProvider({
    capability: "signing",
    routing: { selections: { signing: "docusign" } },
    connections: [connection("docusign", { status: "degraded" })],
  });
  assert.deepEqual(result, {
    outcome: "unresolved",
    reason: "selected_provider_not_connected",
  });
});

test("an explicit selection to an archived connection does not resolve", () => {
  const result = resolveActiveProvider({
    capability: "signing",
    routing: { selections: { signing: "docusign" } },
    connections: [
      connection("docusign", { archivedAt: "2026-01-01T00:00:00.000Z" }),
    ],
  });
  assert.deepEqual(result, {
    outcome: "unresolved",
    reason: "selected_provider_not_connected",
  });
});

test("an explicit selection to a provider that cannot serve the capability does not resolve", () => {
  // quickbooks is connected, but only serves invoicing, not signing.
  const result = resolveActiveProvider({
    capability: "signing",
    routing: { selections: { signing: "quickbooks" } },
    connections: [connection("quickbooks")],
  });
  assert.deepEqual(result, {
    outcome: "unresolved",
    reason: "selected_provider_not_connected",
  });
});

test("a null explicit selection falls back to auto-resolution", () => {
  const result = resolveActiveProvider({
    capability: "invoicing",
    routing: { selections: { invoicing: null } },
    connections: [connection("quickbooks")],
  });
  assert.deepEqual(result, {
    outcome: "resolved",
    provider: "quickbooks",
    reason: "sole_connected_provider",
  });
});

test("invoicing resolves independently of signing on the same tenant", () => {
  const connections = [
    connection("docusign"),
    connection("dropbox_sign"),
    connection("quickbooks"),
  ];
  const invoicing = resolveActiveProvider({
    capability: "invoicing",
    routing: null,
    connections,
  });
  const signing = resolveActiveProvider({
    capability: "signing",
    routing: null,
    connections,
  });
  assert.equal(invoicing.outcome, "resolved");
  assert.equal(signing.outcome, "unresolved");
});

test("a provider connected for an unrelated capability does not count as a candidate", () => {
  const result = resolveActiveProvider({
    capability: "meetings",
    routing: null,
    connections: [connection("google_calendar"), connection("dropbox")],
  });
  assert.deepEqual(result, {
    outcome: "unresolved",
    reason: "no_connected_provider",
  });
});

test("eligibleProvidersFor lists only connected, capability-matching providers", () => {
  const eligible = eligibleProvidersFor("invoicing", [
    connection("quickbooks"),
    connection("stripe"),
    connection("docusign"),
    connection("dropbox", { status: "error" }),
  ]);
  assert.deepEqual(new Set(eligible), new Set(["quickbooks", "stripe"]));
});

test("eligibleProvidersFor excludes archived connections", () => {
  const eligible = eligibleProvidersFor("signing", [
    connection("docusign", { archivedAt: "2026-01-01T00:00:00.000Z" }),
    connection("dropbox_sign"),
  ]);
  assert.deepEqual(eligible, ["dropbox_sign"]);
});

test("eligibleProvidersFor returns an empty list when nothing qualifies", () => {
  const eligible = eligibleProvidersFor("signing", [connection("quickbooks")]);
  assert.deepEqual(eligible, []);
});
