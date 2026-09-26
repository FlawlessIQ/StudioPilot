import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * The signup screens make promises the billing gate has to honour.
 *
 * On 2026-07-28 the register page shipped "14-day Solo trial · No card
 * required". Billing enforcement made the studio trial card-required on
 * 2026-09-07 and Solo was removed from `PlanKey` — and the register page kept
 * both claims until 2026-09-22, so a studio read "No card required" and was
 * asked for a card by the very next screen. A marketing-accuracy pass on
 * 2026-09-10 fixed the landing page and missed this one, because it swept
 * components/marketing/ and the auth pages do not live there.
 *
 * Same shape as the audit's recurring finding: the capability changes and the
 * screen that describes it keeps the pre-change wording. Copy that contradicts
 * the gate is a defect, so it gets a test.
 */

const SIGNUP_SURFACES = [
  "app/auth/register/page.tsx",
  "app/page.tsx",
  "components/marketing/marketing-layout.tsx",
  "features/auth/sign-in-form.tsx",
  "features/auth/onboarding-form.tsx",
];

const read = (path: string) => readFileSync(path, "utf8");

test("onboarding still makes a studio trial card-required", () => {
  // The premise of the rest of this file. If this flips — if a studio trial
  // stops needing a card — these assertions are the wrong way round and
  // should be rewritten, not deleted.
  const onboarding = read("functions/src/saas/onboarding.ts");
  assert.match(
    onboarding,
    /status:\s*comped\s*\?\s*"active"\s*:\s*"incomplete"/,
    "a non-comped studio no longer starts `incomplete` — recheck the signup copy",
  );
  assert.match(onboarding, /checkoutRequired:\s*!comped/);
});

test("no studio signup surface promises that no card is needed", () => {
  const claim = /no card|card (?:is )?not required|without a card|free forever/i;
  for (const path of SIGNUP_SURFACES) {
    for (const [index, line] of read(path).split("\n").entries()) {
      if (!claim.test(line)) continue;
      // A client invite genuinely needs no card — clients never pay. That
      // promise is allowed, but only where it is actually branched on.
      assert.match(
        line,
        /isClientInvite/,
        `${path}:${index + 1} promises a studio no card is needed, but ` +
          "onboarding starts a non-comped studio `incomplete` and routes it " +
          "to Stripe Checkout. Say what the landing page says: " +
          '"Card required, nothing charged for 14 days".',
      );
    }
  }
});

test("signup surfaces never name a plan that does not exist", () => {
  const plans = read("features/subscriptions/entitlements.ts");
  const keys = /export type PlanKey =([^;]+);/.exec(plans);
  assert.ok(keys, "could not read PlanKey");
  const live = new Set(
    keys[1]!.split("|").map((part) => part.trim().replace(/"/g, "")),
  );
  // Names that have been sold at some point and must not resurface in copy
  // unless they are back in PlanKey.
  const retired = ["solo", "starter", "agency", "enterprise"];
  for (const path of SIGNUP_SURFACES) {
    for (const [index, line] of read(path).split("\n").entries()) {
      for (const name of retired) {
        if (live.has(name)) continue;
        const named = new RegExp(`\\b${name}\\b[^"]*\\b(trial|plan)\\b`, "i");
        assert.ok(
          !named.test(line),
          `${path}:${index + 1} offers a "${name}" plan, which is not in ` +
            `PlanKey (${[...live].join(", ")}).`,
        );
      }
    }
  }
});
