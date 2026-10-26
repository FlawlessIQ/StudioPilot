import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assessExistingBooking,
  clientAutomationEmailTypes,
  existingBookingSchema,
  planImportedBooking,
  type ExistingBooking,
} from "../features/imports/existing-booking";
import { rankCrewCandidates } from "../features/crew/cascade";

/**
 * Importing jobs, past ones and their crew (docs/import-bookings-review-2026-10-26.md).
 * Conor's decisions: an assistant per trade, named crew added to the roster
 * quietly, and past and in-progress jobs importable now.
 */
const read = (path: string) => readFileSync(path, "utf8");
const base: ExistingBooking = existingBookingSchema.parse({
  clients: [{ firstName: "Maya", lastName: "Johnson", email: "maya@example.com", phone: null }],
  projectName: null,
  eventTypeId: "wedding",
  eventType: "Wedding",
  eventDate: "2026-06-12",
  timezone: "America/New_York",
  venueName: "The Grove",
  city: "Madison",
  state: "DELIVERED",
  packageName: "Signature",
  coverageMinutes: 480,
  photographers: 2,
  crew: [
    { role: "photographer", count: 2, names: ["Gabe"] },
    { role: "photo_assistant", count: 1, names: ["Lena"] },
  ],
  startTime: "15:00",
  galleryUrl: "https://maya.pixieset.com/wedding",
  deliveredOn: "2026-08-01",
  currency: "USD",
  totalCents: 649_900,
  taxCents: 0,
  signedOn: "2026-01-02",
  signerName: "Maya Johnson",
  hasSignedCopy: false,
  payments: [{ amountCents: 649_900, paidOn: "2026-05-01", method: "Check" }],
  notes: null,
});
const plan = (booking: ExistingBooking) =>
  planImportedBooking(booking, {
    tenantId: "t",
    projectId: "p",
    packageSnapshotId: "s",
    contractId: "c",
    invoiceId: "i",
    contactIds: ["k"],
    actorId: "u",
    now: "2026-10-26T12:00:00.000Z",
    source: "spreadsheet",
    batchId: null,
    deliveryRecordId: "d",
    viewToken: "v",
  });

test("a delivered job lands delivered, with its checklist done and its gallery linked", () => {
  const records = plan(base);
  assert.equal(records.project.state, "DELIVERED");
  assert.equal(records.project.readinessScore, 100);
  assert.equal(records.project.eventStartTime, "15:00");
  // Closeout doesn't wait for review asks that were never scheduled here.
  assert.equal(records.project.reviewRequestsSkippedReason, "imported_past_job");
  const steps = records.postProductionRecord?.steps as Record<string, { complete: boolean }>;
  assert.equal(steps.delivery_sent?.complete, true);
  assert.equal(steps.project_archived?.complete, false);
  assert.equal(records.deliveryRecord?.galleryUrl, "https://maya.pixieset.com/wedding");
  assert.equal(records.deliveryRecord?.completionAuthority, "imported");
  assert.equal(records.closeout, null);
});

test("a finished job can be archived; a job in editing gets its checklist from the trigger", () => {
  const closed = plan({ ...base, state: "CLOSED" });
  assert.equal(closed.closeout?.status, "completed");
  assert.equal((closed.postProductionRecord?.steps as Record<string, { complete: boolean }>).project_archived?.complete, true);
  const editing = plan({ ...base, state: "POST_PRODUCTION", galleryUrl: null });
  assert.equal(editing.project.state, "POST_PRODUCTION");
  assert.equal(editing.postProductionRecord, null);
  assert.equal(editing.deliveryRecord, null);
  // An upcoming job still lands BOOKED and enters planning afterwards.
  assert.equal(plan({ ...base, state: "PLANNING", eventDate: "2027-06-12" }).project.state, "BOOKED");
});

test("paid in full is said, so closeout's final balance is met; the crew is the lines", () => {
  const records = plan(base);
  assert.equal(records.paidInvoice?.paidInFull, true);
  assert.equal(plan({ ...base, payments: [{ amountCents: 100, paidOn: "2026-05-01", method: "Check" }] }).paidInvoice?.paidInFull, false);
  assert.deepEqual(records.packageSnapshot.includedCoverage, [
    { role: "photographer", count: 2 },
    { role: "photo_assistant", count: 1 },
  ]);
  assert.deepEqual(records.namedCrew, [
    { role: "photographer", label: "Photographer", name: "Gabe" },
    { role: "photo_assistant", label: "Photo assistant", name: "Lena" },
  ]);
});

test("a job's date must match where it is, and a studio that delivers nothing can't be mid-delivery", () => {
  const codes = (booking: ExistingBooking, delivers = true) =>
    assessExistingBooking(booking, "2026-10-26", { delivers }).filter((issue) => issue.severity === "error").map((issue) => issue.code);
  assert.deepEqual(codes(base), []);
  assert.deepEqual(codes({ ...base, eventDate: "2027-06-12", deliveredOn: null }), ["EVENT_NOT_YET"]);
  assert.deepEqual(codes({ ...base, state: "BOOKED" }), ["EVENT_ALREADY_HAPPENED"]);
  assert.deepEqual(codes(base, false), ["STATE_NOT_FOR_TRADE"]);
  assert.deepEqual(codes({ ...base, state: "CLOSED" }, false), []);
});

test("past jobs' follow-up emails are held while a job is quiet", () => {
  for (const type of ["review_request", "album_selection_reminder", "delivery_expiry_reminder"])
    assert.ok(clientAutomationEmailTypes.includes(type), type);
});

test("someone added by name, with no email, is never offered work until the studio adds one", () => {
  const candidate = {
    id: "lena",
    name: "Lena",
    active: true,
    specialties: ["weddings"],
    serviceAreas: [],
    travelRadiusMiles: 0,
    preferenceRank: null,
    w9Status: "missing",
    insuranceStatus: "missing",
    contractStatus: "missing",
    availability: [],
    acceptedAssignments: [],
  };
  const ranked = (email: string | null | undefined) =>
    rankCrewCandidates({
      candidates: [{ ...candidate, email }],
      roleSpecialty: "weddings",
      serviceArea: "",
      startsAt: "2027-06-12T15:00:00.000Z",
      endsAt: "2027-06-12T23:00:00.000Z",
    })[0]!;
  assert.equal(ranked("").eligible, false);
  assert.match(ranked("").exclusions.join(" "), /No email yet/);
  assert.equal(ranked("lena@example.com").eligible, true);
  // A caller that predates the field checks nothing.
  assert.equal(ranked(undefined).eligible, true);
});

test("booking imported crew sends nothing, and inviting a name-only entry says to add an email", () => {
  const commands = read("functions/src/imports/commands.ts");
  const crew = commands.slice(commands.indexOf("async function bookImportedCrew"), commands.indexOf("export async function attachImportedSignedCopy"));
  assert.ok(crew.length > 500, "bookImportedCrew moved");
  assert.doesNotMatch(crew, /emailJobs|providerJobs/);
  assert.match(crew, /email: null,/);
  assert.match(crew, /status: input\.past \? "completed" : "accepted"/);
  assert.match(read("functions/src/crew/commands.ts"), /throw new Error\("CREW_EMAIL_REQUIRED"\)/);
  // The two copies of the import core stay one.
  assert.equal(read("functions/src/imports/existing-booking.ts"), read("features/imports/existing-booking.ts"));
});
