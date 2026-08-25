import assert from "node:assert/strict";
import test from "node:test";
import { providerFailureHint } from "../features/booking/provider-failure-hint";

const PAYMENT_REQUIRED = "DROPBOX_SIGN_CREATE_FAILED:402:PROVIDER_ERROR";

test("a 402 does not tell a studio to switch on what it already switched on", () => {
  // The reported case. Conor turned test mode on, the send still failed,
  // and the panel answered by telling him to turn on test mode. Advice you
  // have already taken reads as the product not knowing its own state.
  const onceOn = providerFailureHint(PAYMENT_REQUIRED, "Dropbox Sign", true);
  assert.doesNotMatch(onceOn, /turn on test mode/i);
  assert.match(onceOn, /Test mode is on/);
  // With it off, offering it is the useful thing to say.
  assert.match(
    providerFailureHint(PAYMENT_REQUIRED, "Dropbox Sign", false),
    /turn on test mode/i,
  );
});

test("a refused send always names the way round it", () => {
  // The panel renders the manual attestation form directly underneath. A
  // studio reading only the error should know that is the way forward,
  // whichever branch it lands in.
  for (const testMode of [true, false]) {
    assert.match(
      providerFailureHint(PAYMENT_REQUIRED, "Dropbox Sign", testMode),
      /recording the signature below|record the signature below/,
    );
  }
});

test("the other statuses each say what to do about that status", () => {
  assert.match(
    providerFailureHint("X:401:Y", "Dropbox Sign", false),
    /Reconnect it/,
  );
  assert.match(
    providerFailureHint("X:400:Y", "Dropbox Sign", false),
    /signer role/,
  );
  assert.match(
    providerFailureHint("X:429:Y", "Dropbox Sign", false),
    /rate limiting/,
  );
  // An unparseable message still gets a sentence rather than "NaN".
  const unknown = providerFailureHint("", "Dropbox Sign", false);
  assert.match(unknown, /could not create the request/);
  assert.doesNotMatch(unknown, /NaN|undefined/);
});
