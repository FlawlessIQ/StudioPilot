import assert from "node:assert/strict";
import { test } from "node:test";
import {
  offerCanBeAnswered,
  offerLapse,
  offerLapseNotice,
} from "@/features/crew/offer-moment";

/**
 * The crew workspace presented an offer the server would refuse.
 *
 * Jordan Reid's invitation queue showed "Response requested" with live Accept
 * and Decline buttons for a lighting-assistant role whose response deadline had
 * lapsed on 2 August, on a wedding shot on 22 August. Pressing Accept produced
 * ASSIGNMENT_OFFER_EXPIRED. The Jobs page filed the same offer under the
 * heading "Finished work".
 */
const now = new Date("2026-08-28T12:00:00Z");

test("an offer past its deadline cannot be answered", () => {
  const input = {
    status: "invited",
    inviteExpiresAt: "2026-08-02T12:00:00Z",
    arrivalAt: "2026-09-30T18:00:00Z",
    now,
  };
  assert.equal(offerLapse(input), "expired");
  assert.equal(offerCanBeAnswered(input), false);
});

test("an offer for a date already gone cannot be answered", () => {
  const input = {
    status: "invited",
    inviteExpiresAt: "2026-09-30T12:00:00Z",
    arrivalAt: "2026-08-22T18:00:00Z",
    now,
  };
  assert.equal(offerLapse(input), "event_passed");
  assert.equal(offerCanBeAnswered(input), false);
});

test("expiry is reported ahead of a passed date, to match the server's refusal", () => {
  // Both conditions hold. The crew member hit ASSIGNMENT_OFFER_EXPIRED, so that
  // is the sentence the page has to show them.
  assert.equal(
    offerLapse({
      status: "invited",
      inviteExpiresAt: "2026-08-02T12:00:00Z",
      arrivalAt: "2026-08-22T18:00:00Z",
      now,
    }),
    "expired",
  );
});

test("a live offer is answerable", () => {
  const input = {
    status: "invited",
    inviteExpiresAt: "2026-09-10T12:00:00Z",
    arrivalAt: "2026-09-30T18:00:00Z",
    now,
  };
  assert.equal(offerLapse(input), null);
  assert.equal(offerCanBeAnswered(input), true);
});

test("an offer with no deadline is judged only by its date", () => {
  assert.equal(
    offerCanBeAnswered({
      status: "viewed",
      inviteExpiresAt: null,
      arrivalAt: "2026-09-30T18:00:00Z",
      now,
    }),
    true,
  );
  assert.equal(
    offerLapse({
      status: "viewed",
      inviteExpiresAt: null,
      arrivalAt: "2026-08-01T18:00:00Z",
      now,
    }),
    "event_passed",
  );
});

test("an already-answered assignment is not an offer at all", () => {
  for (const status of ["accepted", "declined", "completed", "cancelled"]) {
    assert.equal(
      offerLapse({ status, inviteExpiresAt: "2026-08-02T12:00:00Z", arrivalAt: null, now }),
      null,
      status,
    );
    assert.equal(offerCanBeAnswered({ status, now }), false, status);
  }
});

test("every lapse has something to say instead of a dead button", () => {
  for (const lapse of ["expired", "event_passed"] as const) {
    const notice = offerLapseNotice(lapse);
    assert.ok(notice.title.length > 0);
    assert.ok(notice.detail.length > 20);
  }
});
