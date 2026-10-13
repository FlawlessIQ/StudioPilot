import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Conor, 2026-10-13: capture the business address with Google Places on the
 * step after sign-in. It becomes the address on contracts and at the bottom
 * of the studio's emails (Email branding), so they never carry StudioCue's.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the create-your-studio step asks for the address, with Places, and it's optional", () => {
  const form = read("features/auth/onboarding-form.tsx");
  assert.match(form, /<AddressField[\s\S]{0,300}label="Business address"/);
  assert.doesNotMatch(form, /<AddressField[\s\S]{0,300}required/, "a home studio can leave it blank");
  assert.match(form, /businessAddress: address\?\.formatted\?\.trim\(\)\.slice\(0, 240\) \|\| null,/);
});

test("signup saves it as the studio's email and contract address", () => {
  const onboarding = read("functions/src/saas/onboarding.ts");
  assert.match(onboarding, /businessAddress: z\.string\(\)\.trim\(\)\.max\(240\)\.nullable\(\)\.optional\(\),/);
  assert.match(onboarding, /\.\.\.\(input\.businessAddress \? \{ emailBranding: \{ postalAddress: input\.businessAddress \} \} : \{\}\),/);
});

test("a verified account creating its studio may use the address lookup before it has a membership", () => {
  const route = read("app/api/studio/places/route.ts");
  assert.match(route, /if \(identity\.email_verified !== true\) \{\s*const memberships = await adminFirestore/);
  assert.match(route, /await adminAppCheck\.verifyToken\(appCheckToken\);/, "App Check still required");
});
