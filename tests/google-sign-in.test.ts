import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { googleSignInMessage } from "../features/auth/google-sign-in-errors";

test("closing the Google window says nothing", () => {
  for (const code of ["auth/popup-closed-by-user", "auth/cancelled-popup-request", "auth/user-cancelled"])
    assert.equal(googleSignInMessage(code), "");
});

test("a blocked popup and an existing password account each say what to do", () => {
  assert.match(googleSignInMessage("auth/popup-blocked"), /pop-ups/);
  assert.match(googleSignInMessage("auth/account-exists-with-different-credential"), /email and password/);
  assert.match(googleSignInMessage("auth/internal-error"), /try again/i);
});

test("Google is offered to studios, never on an invited client's sign-in", () => {
  const signIn = readFileSync("features/auth/sign-in-form.tsx", "utf8");
  const register = readFileSync("features/auth/register-form.tsx", "utf8");
  assert.match(signIn, /intent === "studio" && !mockMode \? <GoogleSignIn/);
  assert.match(register, /intent === "studio" && authIsLive \? <GoogleSignIn/);
});

test("password and Google sign-in route through the same destination", () => {
  const signIn = readFileSync("features/auth/sign-in-form.tsx", "utf8");
  const google = readFileSync("features/auth/google-sign-in.tsx", "utf8");
  assert.match(signIn, /destinationForSignedInUser\(auth, firestore\)/);
  assert.match(google, /destinationForSignedInUser\(auth, firestore\)/);
  // A popup: a redirect's result is lost where the handler's domain differs.
  assert.match(google, /signInWithPopup/);
  assert.doesNotMatch(google, /signInWithRedirect/);
});

test("the Google window opens straight from the click: auth and App Check are warmed on mount", () => {
  const google = readFileSync("features/auth/google-sign-in.tsx", "utf8");
  // Safari blocks a popup opened after a slow await; Firebase awaits its
  // frame and an App Check token before window.open, so both are prepared early.
  assert.match(google, /useEffect\(\(\) => \{[\s\S]*getFirebaseClient\(\)[\s\S]*getToken\(appCheck\)/);
});

test("crew signing in get a crew page: no trial link, no Google", () => {
  const page = readFileSync("app/auth/login/page.tsx", "utf8");
  assert.match(page, /next\?\.startsWith\("\/crew"\)/);
  assert.match(page, /Sign in to your crew workspace/);
  const form = readFileSync("features/auth/sign-in-form.tsx", "utf8");
  assert.match(form, /intent === "crew" \? \(\s*<p className="sign-up-copy">First time here\? Open the link in your invitation email\./);
  // Google stays studio-only.
  assert.match(form, /intent === "studio" && !mockMode \? <GoogleSignIn/);
});
