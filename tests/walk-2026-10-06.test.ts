import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import { inquiryFormChoices, suggestedInquiryForm } from "@/features/questionnaires/inquiry-form-setting";
import { fillVenueFromForm, venueAnswer, venueFromAnswer } from "../functions/src/planning/venue-from-form";

/**
 * The full test wedding walked on production, 2026-10-06 (Maya Brooks,
 * FlawlessIQ). What it found, held here.
 */

const read = (path: string) => readFileSync(path, "utf8");

const FIELDS = [
  { id: "getting-ready", label: "Bridal prep location" },
  { id: "ceremony-location", label: "Ceremony location" },
  { id: "ceremony-time", label: "Ceremony start time" },
  { id: "reception-location", label: "Reception location" },
  { id: "reception-time", label: "Reception start time" },
];

test("the venue comes from the reception, then the ceremony, never prep or a time", () => {
  assert.equal(
    venueAnswer(FIELDS, {
      "getting-ready": "The Inn, 1 Main St",
      "ceremony-location": "St Ann's, 2 Elm St, Madison, NJ",
      "reception-location": "The Madison Hotel, 1 Convent Rd, Morristown, NJ 07960",
      "reception-time": "18:30",
    }),
    "The Madison Hotel, 1 Convent Rd, Morristown, NJ 07960",
  );
  assert.equal(venueAnswer(FIELDS, { "ceremony-location": "St Ann's\n2 Elm St", "reception-location": "TBD" }), "St Ann's, 2 Elm St");
  assert.equal(venueAnswer(FIELDS, { "getting-ready": "The Inn" }), null);
  // GR's imported form says "Venue address".
  assert.equal(venueAnswer([{ id: "q9", label: "Venue address" }], { q9: "Primavera Regency, 1080 Valley Rd" }), "Primavera Regency, 1080 Valley Rd");
  assert.deepEqual(venueFromAnswer("The Madison Hotel, 1 Convent Rd, Morristown"), {
    name: "The Madison Hotel",
    formatted: "The Madison Hotel, 1 Convent Rd, Morristown",
  });
  assert.equal(venueFromAnswer("1080 Valley Rd, Stirling, NJ").name, "1080 Valley Rd, Stirling, NJ");
});

function fakeDb(docs: Record<string, Record<string, unknown>>) {
  const writes: Array<{ path: string; data: Record<string, unknown> }> = [];
  const snap = (path: string) => ({ exists: Boolean(docs[path]), get: (key: string) => docs[path]?.[key] });
  const db = {
    doc: (path: string) => ({ path }),
    runTransaction: async <T,>(run: (transaction: unknown) => Promise<T>) =>
      run({
        get: async (reference: { path: string }) => snap(reference.path),
        update: (reference: { path: string }, data: Record<string, unknown>) => writes.push({ path: reference.path, data }),
        create: (reference: { path: string }, data: Record<string, unknown>) => writes.push({ path: reference.path, data }),
      }),
  };
  return { db: db as unknown as Firestore, writes };
}

const RESPONSE = {
  tenantId: "t1",
  projectId: "p1",
  status: "submitted",
  templateSnapshot: { sections: [{ fields: FIELDS }] },
  answers: { "reception-location": "The Madison Hotel, 1 Convent Rd, Morristown, NJ 07960" },
};

test("a submitted form fills an empty venue, unverified; never over one the studio set", async () => {
  const empty = fakeDb({ "projects/p1": { tenantId: "t1", venueName: null, venue: null } });
  assert.equal(await fillVenueFromForm(empty.db, "r1", RESPONSE), "saved");
  const update = empty.writes.find((write) => write.path === "projects/p1")!.data;
  assert.equal(update.venueName, "The Madison Hotel");
  assert.equal((update.venue as { verified: boolean; formatted: string }).verified, false);
  const set = fakeDb({ "projects/p1": { tenantId: "t1", venueName: "Oak Hill Barn" } });
  assert.equal(await fillVenueFromForm(set.db, "r1", RESPONSE), "skipped");
  const draft = fakeDb({ "projects/p1": { tenantId: "t1" } });
  assert.equal(await fillVenueFromForm(draft.db, "r1", { ...RESPONSE, status: "in_progress" }), "skipped");
  assert.equal(set.writes.length + draft.writes.length, 0);
  assert.match(read("functions/src/planning/crew-brief-trigger.ts"), /await fillVenueFromForm\(getFirestore\(\), responseId, after\)\.catch\(/);
});

test("an undecided inquiry form opens on the Event details copy, never a post-booking form", () => {
  const rows = [
    { id: "wpq", name: "Wedding Planning Questionnaire", status: "active", eventTypeId: "wedding" },
    { id: "final", name: "Final schedule", status: "active", eventTypeId: "wedding", recommendedId: "wedding-final-schedule" },
    { id: "details", name: "Event details form", status: "active", eventTypeId: "wedding", recommendedId: "wedding-event-details" },
    { id: "shot", name: "Shot list", status: "active", eventTypeId: "wedding", recommendedId: "wedding-shot-list" },
  ];
  assert.equal(suggestedInquiryForm(inquiryFormChoices(rows)), "details");
  // Without the copy: not the planning form or the shot list.
  const noCopy = rows.filter((row) => row.id !== "details");
  assert.equal(suggestedInquiryForm(inquiryFormChoices([...noCopy, { id: "venue", name: "Venue form", status: "active", eventTypeId: "wedding" }])), "venue");
});

test("no screen says a wedding's day is drafted from timing rules", () => {
  assert.doesNotMatch(read("features/journey/steps.ts"), /using your timing rules/);
  assert.doesNotMatch(read("components/ai/actions/planning-actions.tsx"), /and your timing rules/);
});

test("recording a retainer re-reads once the booking has had time to land", () => {
  const workspace = read("components/booking/project-booking-workspace.tsx");
  assert.match(workspace, /const settleAfterRetainer = \(\) => \{\s*window\.setTimeout\(/);
  assert.ok((workspace.match(/settleAfterRetainer\(\);/g) ?? []).length >= 2);
  assert.doesNotMatch(read("components/booking/record-retainer-payment.tsx"), /recorded against your name\. Confirm the booking/);
});

test("an invitation opened while signed in as someone else leads to the set-password form", () => {
  // 2026-10-07: Pick Test's invite opened in a window still signed in as Maya.
  // The accept was refused and "Continue and set your password" did nothing.
  const page = read("features/auth/accept-client-invitation.tsx");
  assert.match(page, /if \(signedInAs && invited && signedInAs !== invited\) \{/);
  assert.match(page, /if \(preview\?\.hasAccount === false\) \{\s*acceptStarted\.current = false;\s*setMessage\(""\);\s*setActivation\("idle"\);\s*return;\s*\}/);
});
