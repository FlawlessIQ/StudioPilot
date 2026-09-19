import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { prepareCrewStaffing } from "../functions/src/crew/prepare-staffing.ts";

/**
 * Staffing prepared when the job is booked.
 *
 * The behaviour worth pinning here is not the ranking — `crew-staffing-plan`
 * covers that — but what booking does with it: that it prepares by default and
 * sends nothing, that turning the dial on actually sends, that an imported
 * booking is never offered automatically, and that a retry of the booking job
 * does not offer anybody twice.
 *
 * Run against an in-memory double rather than the emulator, which is why
 * `prepareCrewStaffing` takes its Firestore as an input.
 */

type Row = Record<string, unknown>;

function fakeFirestore(seed: Record<string, Row>) {
  const store = new Map<string, Row>(Object.entries(seed));
  const writes: { path: string; data: Row }[] = [];

  const snapshot = (path: string) => {
    const data = store.get(path);
    return {
      id: path.split("/").pop() ?? "",
      exists: data !== undefined,
      get: (field: string) => data?.[field],
      data: () => data,
      ref: { path },
    };
  };

  const query = (name: string, filters: [string, string, unknown][]) => ({
    where: (field: string, op: string, value: unknown) =>
      query(name, [...filters, [field, op, value]]),
    get: async () => ({
      docs: [...store.entries()]
        .filter(([path]) => path.startsWith(`${name}/`))
        .filter(([, data]) =>
          filters.every(([field, , value]) => data[field] === value),
        )
        .map(([path]) => snapshot(path)),
    }),
  });

  const db = {
    doc: (path: string) => ({
      ...snapshot(path),
      path,
      get: async () => snapshot(path),
    }),
    collection: (name: string) => query(name, []),
    batch: () => ({
      create: (ref: { path: string }, data: Row) => {
        writes.push({ path: ref.path, data });
      },
      commit: async () => {
        for (const write of writes) store.set(write.path, write.data);
      },
    }),
  };
  return { db, store, writes };
}

const now = "2026-09-19T12:00:00.000Z";

const seedFor = (overrides: { project?: Row; tenant?: Row } = {}) => ({
  "tenants/t1": { id: "t1", currency: "USD", ...overrides.tenant },
  "projects/p1": {
    tenantId: "t1",
    name: "Rivera wedding",
    eventType: "Wedding",
    eventDate: "2027-06-12",
    city: "Madison",
    venueName: "The Conservatory",
    venueAddress: "1 Garden Way",
    packageSnapshotId: "s1",
    ...overrides.project,
  },
  "packageSnapshots/s1": {
    tenantId: "t1",
    projectId: "p1",
    includedCoverage: [
      { role: "photographer", count: 2 },
      { role: "videographer", count: 1 },
    ],
    includedPhotographers: 2,
  },
  "crewProfiles/c-photo": {
    tenantId: "t1",
    name: "Ben Photo",
    active: true,
    archivedAt: null,
    specialties: ["weddings"],
    serviceAreas: ["Madison"],
    travelRadiusMiles: 50,
    rateCents: 60000,
    w9Status: "verified",
    insuranceStatus: "verified",
    contractStatus: "completed",
  },
  "crewProfiles/c-video": {
    tenantId: "t1",
    name: "Ana Video",
    active: true,
    archivedAt: null,
    specialties: ["video"],
    serviceAreas: ["Madison"],
    travelRadiusMiles: 50,
    rateCents: 80000,
    w9Status: "verified",
    insuranceStatus: "verified",
    contractStatus: "completed",
  },
});

const run = (seed: Record<string, Row>) => {
  const fake = fakeFirestore(seed);
  return prepareCrewStaffing({
    tenantId: "t1",
    projectId: "p1",
    actorId: "booking-orchestrator",
    now,
    db: fake.db as never,
  }).then((result) => ({ result, ...fake }));
};

// --- the default: prepare, send nothing ---------------------------------

test("booking prepares a plan and sends nothing", async () => {
  const { result, store } = await run(seedFor());
  assert.equal(result.toBook, 2);
  assert.equal(result.autoOffered, false);
  const plan = store.get("crewStaffingPlans/p1");
  assert.equal(plan?.status, "prepared");
  assert.deepEqual(plan?.offers, []);
  // Nothing was offered, so nothing was emailed.
  assert.equal(
    [...store.keys()].some((key) => key.startsWith("emailJobs/")),
    false,
  );
  assert.equal(
    [...store.keys()].some((key) => key.startsWith("crewAssignments/")),
    false,
  );
});

test("each role is shortlisted for its own trade", async () => {
  const { store } = await run(seedFor());
  const roles = (store.get("crewStaffingPlans/p1")?.roles ?? []) as Row[];
  const photographer = roles.find((role) => role.role === "Second photographer");
  const videographer = roles.find((role) => role.role === "Videographer");
  assert.deepEqual(photographer?.candidateIds, ["c-photo"]);
  assert.deepEqual(videographer?.candidateIds, ["c-video"]);
});

/** The fee comes from the rate the studio already pays that trade. */
test("the rate offered is that trade's rate, not one number for everyone", async () => {
  const { store } = await run(seedFor());
  const roles = (store.get("crewStaffingPlans/p1")?.roles ?? []) as Row[];
  assert.equal(
    roles.find((role) => role.role === "Second photographer")?.compensationCents,
    60000,
  );
  assert.equal(
    roles.find((role) => role.role === "Videographer")?.compensationCents,
    80000,
  );
});

test("a role nobody can work is still in the plan, carrying its reason", async () => {
  const seed = seedFor();
  delete (seed as Record<string, unknown>)["crewProfiles/c-video"];
  const { store } = await run(seed);
  const roles = (store.get("crewStaffingPlans/p1")?.roles ?? []) as Row[];
  const videographer = roles.find((role) => role.role === "Videographer");
  assert.equal(videographer !== undefined, true);
  assert.deepEqual(videographer?.candidateIds, []);
  assert.match(String((videographer?.gap as Row)?.reason), /Nobody on your roster/);
});

// --- the dial ------------------------------------------------------------

test("with the dial on, the first name for each role is offered", async () => {
  const { result, store } = await run(
    seedFor({ tenant: { crewOffers: { autoOfferOnBooking: true, responseWindowHours: 24 } } }),
  );
  assert.equal(result.autoOffered, true);
  assert.equal(store.get("crewStaffingPlans/p1")?.status, "offered");
  const assignments = [...store.keys()].filter((key) =>
    key.startsWith("crewAssignments/"),
  );
  const emails = [...store.keys()].filter((key) => key.startsWith("emailJobs/"));
  assert.equal(assignments.length, 2);
  assert.equal(emails.length, 2);
});

test("only the first name is asked, never the whole shortlist", async () => {
  const seed = seedFor({
    tenant: { crewOffers: { autoOfferOnBooking: true, responseWindowHours: 24 } },
  });
  seed["crewProfiles/c-photo-2"] = {
    ...(seed["crewProfiles/c-photo"] as Row),
    name: "Dana Photo",
  };
  const { store } = await run(seed);
  const photographerOffers = [...store.entries()].filter(
    ([key, value]) =>
      key.startsWith("crewAssignments/") && value.role === "Second photographer",
  );
  assert.equal(photographerOffers.length, 1);
  // The rest of the list is recorded on the cascade, to be worked down later.
  const cascade = [...store.entries()].find(
    ([key, value]) =>
      key.startsWith("crewCascades/") && value.role === "Second photographer",
  );
  assert.equal((cascade?.[1].candidateIds as string[]).length, 2);
});

/**
 * An imported wedding was booked elsewhere months ago and is usually already
 * staffed. Offering its crew automatically would send a fee for work that is
 * already arranged.
 */
test("an imported booking is never offered automatically", async () => {
  const { result, store } = await run(
    seedFor({
      project: { importedAt: "2026-09-01T00:00:00.000Z" },
      tenant: { crewOffers: { autoOfferOnBooking: true, responseWindowHours: 24 } },
    }),
  );
  assert.equal(result.autoOffered, false);
  const plan = store.get("crewStaffingPlans/p1");
  assert.equal(plan?.status, "prepared");
  assert.equal(plan?.autoOfferSuppressed, "imported_booking");
  // The plan is still there: a studio that has not staffed it wants the list.
  assert.equal((plan?.roles as Row[]).length, 2);
});

// --- retries -------------------------------------------------------------

test("a retry of the booking job offers nobody twice", async () => {
  const seed = seedFor({
    tenant: { crewOffers: { autoOfferOnBooking: true, responseWindowHours: 24 } },
  });
  const fake = fakeFirestore(seed);
  const once = () =>
    prepareCrewStaffing({
      tenantId: "t1",
      projectId: "p1",
      actorId: "booking-orchestrator",
      now,
      db: fake.db as never,
    });
  await once();
  const second = await once();
  assert.equal(second.skipped, "already_prepared");
  assert.equal(
    [...fake.store.keys()].filter((key) => key.startsWith("crewAssignments/"))
      .length,
    2,
  );
});

test("a job with no date prepares nothing rather than guessing one", async () => {
  const { result, store } = await run(seedFor({ project: { eventDate: "" } }));
  assert.equal(result.skipped, "no_event_date");
  assert.equal(store.has("crewStaffingPlans/p1"), false);
});

// --- the wiring ----------------------------------------------------------

/**
 * The step has to actually run. `completeBookingResources` is one long
 * function and the call is easy to lose in a merge.
 */
test("the booking worker runs the staffing step", () => {
  const source = readFileSync(
    `${process.cwd()}/functions/src/operations/provider-runtime.ts`,
    "utf8",
  );
  assert.match(source, /await prepareCrewStaffing\(\{/);
  // And its failure never fails the booking.
  const call = source.slice(source.indexOf("await prepareCrewStaffing({") - 200);
  assert.match(call.slice(0, 600), /catch/);
});

test("booking declares the step it now performs", () => {
  for (const path of [
    "functions/src/booking/commands.ts",
    "functions/src/booking/orchestration.ts",
  ]) {
    assert.match(
      readFileSync(`${process.cwd()}/${path}`, "utf8"),
      /"crew_plan"/,
      `${path} queues the booking job and must declare the step`,
    );
  }
});

/** Studio-side only: it names who the studio may pay, and what. */
test("the prepared plan is readable by the studio and nobody else", () => {
  const rules = readFileSync(`${process.cwd()}/firestore.rules`, "utf8");
  const block = rules.slice(
    rules.indexOf("match /crewStaffingPlans/{planId}"),
    rules.indexOf("match /crewStaffingPlans/{planId}") + 500,
  );
  assert.match(block, /studio_owner/);
  assert.doesNotMatch(block, /subcontractor/);
  assert.match(block, /allow write: if false;/);
});
