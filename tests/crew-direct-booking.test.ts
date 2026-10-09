import assert from "node:assert/strict";
import { test } from "node:test";
import { directBookingPlan } from "../functions/src/crew/direct-booking";
import { renderEmailTemplate } from "../functions/src/communications/email-templates";
import { EDITABLE_EMAILS } from "../features/communications/email-catalog";

const assignment = (id: string, crewProfileId: string, status: string, role = "Second photographer") => ({ id, crewProfileId, status, role });

test("someone already booked on the job can't be booked twice", () => {
  assert.deepEqual(
    directBookingPlan({ crewProfileId: "p1", role: "Second photographer", assignments: [assignment("a1", "p1", "accepted")], cascades: [] }),
    { ok: false, code: "CREW_ALREADY_BOOKED" },
  );
});

test("an offer already out to the same person becomes their booking", () => {
  const plan = directBookingPlan({
    crewProfileId: "p1",
    role: "Second photographer",
    assignments: [assignment("a1", "p1", "invited")],
    cascades: [{ id: "c1", role: "Second photographer", status: "active", currentAssignmentId: "a1" }],
  });
  assert.deepEqual(plan, { ok: true, reuseAssignmentId: "a1", fillCascadeIds: ["c1"], releaseAssignmentIds: [] });
});

test("a chain still waiting on someone else for the role is filled, and they're released", () => {
  const plan = directBookingPlan({
    crewProfileId: "p2",
    role: "second photographer ",
    assignments: [assignment("a1", "p1", "viewed"), assignment("a0", "p3", "declined")],
    cascades: [
      { id: "c1", role: "Second photographer", status: "active", currentAssignmentId: "a1" },
      { id: "c2", role: "Videographer", status: "active", currentAssignmentId: "a9" },
      { id: "c3", role: "Second photographer", status: "filled", currentAssignmentId: null },
    ],
  });
  assert.deepEqual(plan, { ok: true, reuseAssignmentId: null, fillCascadeIds: ["c1"], releaseAssignmentIds: ["a1"] });
});

test("an already-declined or expired chain offer isn't 'released' again", () => {
  const plan = directBookingPlan({
    crewProfileId: "p2",
    role: "DJ",
    assignments: [assignment("a1", "p1", "expired", "DJ")],
    cascades: [{ id: "c1", role: "DJ", status: "active", currentAssignmentId: "a1" }],
  });
  assert.deepEqual(plan, { ok: true, reuseAssignmentId: null, fillCascadeIds: ["c1"], releaseAssignmentIds: [] });
});

const brand = { studioName: "GR Productions", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: null };

test("the booked email says they're on, with nothing to accept, and opens the job", () => {
  const email = renderEmailTemplate({
    key: "crew_assigned",
    brand,
    recipientName: "Jordan Lee",
    projectName: "Smith Wedding",
    values: {
      role: "Second photographer",
      arrivalAt: "2027-06-12T16:00:00.000Z",
      departureAt: "2027-06-13T02:00:00.000Z",
      locationName: "Hollow Oak Barn",
      compensationCents: 50000,
      compensationType: "event",
      compensationVisibleToCrew: true,
      currency: "USD",
      inviteUrl: "https://studio-cue.com/auth/crew-invite?token=abc",
    },
  } as Parameters<typeof renderEmailTemplate>[0]);
  assert.match(email.subject, /^You're booked as Second photographer for Smith Wedding/);
  assert.match(email.text, /nothing to accept/);
  assert.match(email.text, /Pay: \$500\.00 total/);
  assert.match(email.html, /crew-invite\?token=abc/);
  assert.doesNotMatch(email.text, /respond by|accept or decline/i);
});

test("a released offer says the role is filled, not that they were dropped", () => {
  const email = renderEmailTemplate({
    key: "crew_assignment_cancelled",
    brand,
    recipientName: "Sam Ortiz",
    projectName: "Smith Wedding",
    values: { cause: "filled" },
  } as Parameters<typeof renderEmailTemplate>[0]);
  assert.match(email.subject, /^Filled:/);
  assert.match(email.text, /no need to reply/);
  assert.doesNotMatch(email.text, /released|called off/i);
});

test("studios can word the booked email", () => {
  assert.ok(EDITABLE_EMAILS.some((email) => email.key === "crew_assigned"));
});
