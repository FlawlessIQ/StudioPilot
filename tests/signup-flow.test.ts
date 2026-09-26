import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Signup, with the steps the 2026-09-26 onboarding assessment found it could
 * lose: typing the password twice, filling in a form it then refused, choosing
 * a plan twice, and waiting on a webhook with no end.
 */
const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");

test("a new studio owner stays signed in, and verifying carries on to setting up the studio", () => {
  const register = read("features/auth/register-form.tsx");
  assert.match(register, /intent === "studio" \? "\/auth\/onboarding" : null/);
  assert.match(register, /next: verifiedNext/);
  // Only an invited client is signed out, as before.
  assert.match(register, /if \(intent === "client"\) await signOut\(auth\)/);
  // The "check your email" screen moves on by itself.
  assert.match(register, /window\.location\.assign\("\/auth\/onboarding"\)/);
  assert.match(read("app/auth/login/page.tsx"), /Email verified\. Sign in to carry on\./);
});

test("onboarding answers who is here before anything is typed", () => {
  const form = read("features/auth/onboarding-form.tsx");
  assert.match(form, /\/auth\/login\?next=\$\{encodeURIComponent\("\/auth\/onboarding"\)\}/);
  assert.match(form, /if \(active && !user\.emailVerified\) setPhase\("needs_verification"\)/);
  assert.match(form, /One last step: start your trial/);
});

test("the plan picked on the website is the one the picker shows", () => {
  assert.match(read("features/auth/register-form.tsx"), /rememberChosenPlan\(/);
  const picker = read("components/saas/live-subscription.tsx");
  assert.match(picker, /You picked this/);
  // Before a trial there's no "Current" plan to claim.
  assert.match(picker, /preTrial \? card\.key === picked : card\.key === plan/);
});

test("the trial starts from the returned Checkout Session if the webhook is late", () => {
  assert.match(read("functions/src/saas/stripe-checkout.ts"), /session_id=\{CHECKOUT_SESSION_ID\}/);
  const stripe = read("functions/src/saas/stripe.ts");
  const branch = stripe.slice(stripe.indexOf('parsed.type === "confirmCheckout"'), stripe.indexOf("const subscription = await db"));
  // Only a completed session, and only for this studio.
  assert.match(branch, /if \(sessionTenant !== parsed\.tenantId\) throw new Error\("FORBIDDEN"\)/);
  assert.match(branch, /session\.status !== "complete"/);
  // Written exactly as the webhook writes it.
  assert.match(branch, /writeSubscriptionFromStripe\(/);
  assert.match(stripe, /const \{ status, plan \} = await writeSubscriptionFromStripe\(\s*batch,/);
  // And the page says so when it's slow, rather than spinning.
  assert.match(read("components/saas/live-subscription.tsx"), /This is taking longer than usual/);
});

test("the inbox setup is pre-filled with an address the studio actually has", () => {
  const commands = read("functions/src/communications/commands.ts");
  assert.match(commands, /branding\?\.replyTo/);
  assert.match(commands, /identity\.email === "string" \? identity\.email : null/);
});
