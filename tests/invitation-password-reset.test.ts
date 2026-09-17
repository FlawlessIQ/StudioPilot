import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * A forgotten password shouldn't cost someone their invitation.
 *
 * Every other leg of the reset round trip already carries `next`: the
 * forgot-password page reads it, the form sends it with the email, the reset
 * page offers "Return to my invitation". Only the link on the invitation
 * itself dropped it — so a crew member who doesn't remember setting a password
 * reset it and landed on a generic sign-in, with the invitation back in the
 * inbox they just left.
 */
test("the invitation's reset link carries the invitation back", () => {
  const join = readFileSync(`${process.cwd()}/features/auth/invitation-join.tsx`, "utf8");
  assert.match(join, /const returnTo =/);
  assert.match(join, /\/auth\/forgot-password\?email=\$\{encodeURIComponent\(invited\)\}/);
  assert.match(join, /returnTo \? `&next=\$\{encodeURIComponent\(returnTo\)\}` : ""/);
});

test("the rest of the round trip still passes it through", () => {
  const form = readFileSync(`${process.cwd()}/features/auth/forgot-password-form.tsx`, "utf8");
  assert.match(form, /input: \{ email, next \}/);
  const reset = readFileSync(`${process.cwd()}/app/auth/reset-password/page.tsx`, "utf8");
  assert.match(reset, /const safeNext = next\?\.startsWith\("\/"\)/);
});
