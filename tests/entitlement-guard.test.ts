import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { requireEntitlement } from "../functions/src/saas/entitlement-guard.ts";

/** Just enough Firestore for a guard that reads one document. */
function db(subscription: Record<string, unknown> | null) {
  return {
    doc: (path: string) => ({
      get: async () => {
        assert.match(path, /^subscriptions\//, "the guard reads the tenant's subscription");
        return {
          exists: subscription !== null,
          get: (field: string) =>
            field.split(".").reduce<unknown>(
              (value, key) =>
                typeof value === "object" && value !== null
                  ? (value as Record<string, unknown>)[key]
                  : undefined,
              subscription ?? undefined,
            ),
        };
      },
    }),
  } as never;
}

const entitled = { coiEnabled: true, customWorkflowsEnabled: true, advancedReportingEnabled: true };

test("an entitled tenant on a live subscription is allowed through", async () => {
  for (const status of ["trialing", "active"]) {
    await requireEntitlement(db({ status, entitlements: entitled }), "tenant-a", "coiEnabled");
  }
});

test("a lapsed subscription loses the capability", async () => {
  // The half that bites today. Outside AI quota nothing asked whether a
  // tenant was still paying, so a cancelled subscription kept chasing
  // certificates and authoring automations indefinitely.
  for (const status of ["past_due", "paused", "cancelled", "incomplete"]) {
    await assert.rejects(
      () => requireEntitlement(db({ status, entitlements: entitled }), "tenant-a", "coiEnabled"),
      /ACTIVE_SUBSCRIPTION_REQUIRED/,
      `${status} must not keep the capability`,
    );
  }
  // No subscription at all is not an accidental free pass.
  await assert.rejects(
    () => requireEntitlement(db(null), "tenant-a", "coiEnabled"),
    /ACTIVE_SUBSCRIPTION_REQUIRED/,
  );
});

test("a capability the plan does not include is refused by name", async () => {
  await assert.rejects(
    () =>
      requireEntitlement(
        db({ status: "active", entitlements: { ...entitled, coiEnabled: false } }),
        "tenant-a",
        "coiEnabled",
      ),
    /ENTITLEMENT_REQUIRED:coiEnabled/,
  );
});

test("a missing or non-boolean entitlement fails closed", async () => {
  // An older subscription snapshot may predate a flag. Absent must mean no,
  // never "assume yes" — the snapshot is what the tenant was sold.
  for (const entitlements of [{}, { coiEnabled: "true" }, { coiEnabled: 1 }, undefined]) {
    await assert.rejects(
      () => requireEntitlement(db({ status: "active", entitlements }), "tenant-a", "coiEnabled"),
      /ENTITLEMENT_REQUIRED/,
      JSON.stringify(entitlements),
    );
  }
});

test("the guard is actually called where the capability is sold", () => {
  // hasEntitlement sat with zero call sites while every plan card advertised
  // what it gated. A guard nobody calls is the same bug with a new name.
  const planning = readFileSync("functions/src/planning/commands.ts", "utf8");
  assert.match(planning, /requireEntitlement\(db, parsed\.tenantId, "coiEnabled"\)/);
  for (const type of ["createCoiRequest", "decideCoi", "sendCoiToVenue"]) {
    assert.match(planning, new RegExp(`parsed\\.type === "${type}"`), type);
  }
  const workflow = readFileSync("functions/src/workflow/commands.ts", "utf8");
  assert.match(workflow, /requireEntitlement\(db, command\.tenantId, "customWorkflowsEnabled"\)/);
  // Running existing work is deliberately not gated: a lapsed tenant stops
  // building new automation, it does not have live jobs seize up.
  assert.doesNotMatch(workflow, /instantiateWorkflow[\s\S]{0,120}requireEntitlement/);
});
