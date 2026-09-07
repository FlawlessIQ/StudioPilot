import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

import { subscriptionGrantsAccess } from "../features/subscriptions/entitlements.ts";

/**
 * Card-required onboarding means every tenant carries a subscription, so studio
 * work sits behind billing: each studio command endpoint must call
 * `requireActiveSubscription` after resolving identity + membership. This guard
 * pins the endpoints already gated so the gate can't be silently removed, and
 * ratchets `KNOWN_UNGATED` down to nothing as the rest are covered.
 *
 * Source assertions (not execution) for the same reason the original billing gap
 * was invisible: nothing exercised the Firebase-heavy command handlers.
 */

// Behaviour of the shared access rule — the truth table both guards share.
test("subscriptionGrantsAccess: only trialing/active grant access", () => {
  assert.equal(subscriptionGrantsAccess("trialing"), true);
  assert.equal(subscriptionGrantsAccess("active"), true);
  for (const s of ["incomplete", "past_due", "paused", "canceled", "expired", ""]) {
    assert.equal(subscriptionGrantsAccess(s), false, `${s} must not grant access`);
  }
});

// The server guard mirrors the same rule and must refuse everything else.
test("server entitlement-guard shares the trialing/active rule and exposes the gate", () => {
  const src = readFileSync("functions/src/saas/entitlement-guard.ts", "utf8");
  assert.match(src, /export async function requireActiveSubscription\(/);
  assert.match(
    src,
    /status === "trialing" \|\| status === "active"/,
    "server subscriptionGrantsAccess must match the shared rule",
  );
});

// Studio command endpoints that MUST enforce the gate. Add to this list (and
// remove from KNOWN_UNGATED) as each is covered.
const GATED = [
  "functions/src/crm/commands.ts",
  "functions/src/planning/commands.ts",
  "functions/src/post-event/commands.ts",
  "functions/src/booking/commands.ts",
  "functions/src/booking/proposals.ts",
  "functions/src/ai/schedule.ts",
  "functions/src/integrations/commands.ts",
  "functions/src/ai/communications.ts",
  "functions/src/ai/message-draft.ts",
  "functions/src/ai/timing-rules.ts",
  "functions/src/ai/actions.ts",
  "functions/src/ai/copilot.ts",
  "functions/src/crew/commands.ts",
  "functions/src/workflow/commands.ts",
  "functions/src/communications/commands.ts",
  "functions/src/studio-import/commands.ts",
  "functions/src/communications/lifecycle-settings.ts",
  "functions/src/saas/branding.ts",
];

for (const file of GATED) {
  test(`${file} enforces requireActiveSubscription`, () => {
    const src = readFileSync(file, "utf8");
    assert.match(
      src,
      /requireActiveSubscription\(/,
      `${file} must gate studio work behind a live subscription`,
    );
  });
}

/**
 * Remaining studio command endpoints not yet gated — the ratchet. Each should
 * move into GATED (and off this list) as it's covered; the goal is an empty
 * KNOWN_UNGATED. Listed so the work is visible and nothing here is mistaken for
 * a deliberate exception.
 */
const KNOWN_UNGATED = [
  // membershipCommand handles BOTH the studio inviting teammates AND an invitee
  // accepting — a whole-command gate would block acceptance when the studio is
  // incomplete/lapsed. Needs per-command-type gating (gate the invite/manage
  // types, not acceptInvitation) before it can move into GATED.
  "functions/src/saas/memberships.ts",
];

/**
 * Endpoints that must NEVER be gated — gating them would trap a studio (can't
 * pay, can't recover) or punish non-paying parties (clients, crew) for the
 * studio's billing state:
 *   tenantOnboardingCommand, billingCommand, authEmailCommand,
 *   clientInvitationCommand, crewInvitationCommand/Preview, tenantDataCommand +
 *   tenantExportDownload (data must remain exportable), saasAdminCommand +
 *   supportTenantSummary (platform admin), createSession, health,
 *   signingTemplatesQuery / consultation availability (reads).
 */
test("KNOWN_UNGATED shrinks toward empty (progress marker)", () => {
  // Every studio command is gated except membershipCommand (see its note above).
  // If this grows, a new studio command shipped ungated — gate it or justify it.
  assert.ok(
    KNOWN_UNGATED.length <= 1,
    `unexpected ungated studio commands: ${KNOWN_UNGATED.join(", ")}`,
  );
});
