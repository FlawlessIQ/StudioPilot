import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assignCandidatesToRoles,
  crewRequiredFromCoverage,
  planCrewStaffing,
  rolesToBook,
  specialtyForCoverageRole,
} from "@/features/crew/staffing-plan";
import type { CrewCandidateInput } from "@/features/crew/cascade";

const startsAt = "2027-06-12T14:00:00.000Z";
const endsAt = "2027-06-12T23:00:00.000Z";

const candidate = (
  id: string,
  name: string,
  specialties: string[],
  overrides: Partial<CrewCandidateInput> = {},
): CrewCandidateInput => ({
  id,
  name,
  active: true,
  specialties,
  serviceAreas: ["Madison"],
  travelRadiusMiles: 50,
  preferenceRank: null,
  w9Status: "verified",
  insuranceStatus: "verified",
  contractStatus: "completed",
  availability: [{ startsAt, endsAt, status: "available" }],
  acceptedAssignments: [],
  ...overrides,
});

const photoAndVideo = [
  { role: "photographer" as const, count: 2 },
  { role: "videographer" as const, count: 1 },
];

// --- who the job has to book ------------------------------------------

test("the studio covers one of its own, and the rest are roles to book", () => {
  const plan = rolesToBook(photoAndVideo);
  assert.deepEqual(
    plan.roles.map((role) => role.role),
    ["Second photographer", "Videographer"],
  );
  assert.deepEqual(plan.studioCovers, {
    role: "photographer",
    label: "photographer",
  });
});

/**
 * The assumption used to be hard-coded to photographers, so a video-led studio
 * booked a full crew of videographers and left its own owner idle.
 */
test("a video-only package has the studio covering a videographer", () => {
  const plan = rolesToBook([{ role: "videographer", count: 2 }]);
  assert.deepEqual(
    plan.roles.map((role) => role.role),
    ["Second videographer"],
  );
  assert.equal(plan.studioCovers?.role, "videographer");
});

test("a solo package books nobody", () => {
  assert.deepEqual(rolesToBook([{ role: "photographer", count: 1 }]).roles, []);
  assert.equal(crewRequiredFromCoverage([{ role: "photographer", count: 1 }]), 0);
});

test("crewRequired counts people, not the flat 1 readiness used to assume", () => {
  assert.equal(crewRequiredFromCoverage(photoAndVideo), 2);
  assert.equal(
    crewRequiredFromCoverage([
      { role: "photographer", count: 3 },
      { role: "videographer", count: 2 },
    ]),
    4,
  );
});

test("roles past the second photographer are numbered plainly", () => {
  assert.deepEqual(
    rolesToBook([{ role: "photographer", count: 3 }]).roles.map((r) => r.role),
    ["Second photographer", "Photographer 3"],
  );
  assert.deepEqual(
    rolesToBook([
      { role: "photographer", count: 1 },
      { role: "videographer", count: 2 },
    ]).roles.map((r) => r.role),
    ["Videographer 1", "Videographer 2"],
  );
});

// --- ranking each role against its own trade ---------------------------

test("video ranks against video; photography ranks against the event", () => {
  assert.equal(specialtyForCoverageRole("videographer", "weddings"), "video");
  assert.equal(specialtyForCoverageRole("photographer", "weddings"), "weddings");
  assert.equal(specialtyForCoverageRole("photographer", "corporate"), "corporate");
});

/**
 * The defect this module exists for: one ranking, split across roles by
 * `index % roles.length`, offered whoever happened to land on an even index
 * the photography slot.
 */
test("a videographer is offered the video role, not the photography one", () => {
  const plan = planCrewStaffing({
    coverage: photoAndVideo,
    eventSpecialty: "weddings",
    serviceArea: "Madison",
    startsAt,
    endsAt,
    candidates: [
      candidate("vid-1", "Ana Video", ["video"]),
      candidate("pho-1", "Ben Photo", ["weddings"]),
    ],
  });
  const photographer = plan.roles.find((role) => role.role === "Second photographer");
  const videographer = plan.roles.find((role) => role.role === "Videographer");
  assert.deepEqual(
    photographer?.candidates.map((c) => c.crewProfileId),
    ["pho-1"],
  );
  assert.deepEqual(
    videographer?.candidates.map((c) => c.crewProfileId),
    ["vid-1"],
  );
});

/**
 * The matcher this all rests on could not fail: the candidate's specialty was
 * compared against a list containing the role itself, so `role.includes(role)`
 * matched everyone. Pinned here because the whole plan is wrong without it.
 */
test("a specialty that does not match the role is an exclusion", () => {
  const plan = planCrewStaffing({
    coverage: [{ role: "videographer", count: 2 }],
    eventSpecialty: "weddings",
    serviceArea: "Madison",
    startsAt,
    endsAt,
    candidates: [candidate("pho-1", "Ben Photo", ["weddings"])],
  });
  const considered = plan.roles[0]?.considered[0];
  assert.equal(considered?.eligible, false);
  assert.ok(considered?.exclusions.includes("Role or specialty does not match"));
});

test("the specialty `video` still reaches a role called videographer", () => {
  const plan = planCrewStaffing({
    coverage: [{ role: "videographer", count: 2 }],
    eventSpecialty: "weddings",
    serviceArea: "Madison",
    startsAt,
    endsAt,
    candidates: [candidate("vid-1", "Ana Video", ["video"])],
  });
  assert.equal(plan.roles[0]?.candidates.length, 1);
});

test("nobody is offered two roles on the same day", () => {
  const plan = planCrewStaffing({
    coverage: photoAndVideo,
    eventSpecialty: "weddings",
    serviceArea: "Madison",
    startsAt,
    endsAt,
    // One person who matches both trades, and nobody else.
    candidates: [candidate("both-1", "Cass Both", ["weddings", "video"])],
  });
  const offered = plan.roles.flatMap((role) =>
    role.candidates.map((c) => c.crewProfileId),
  );
  assert.deepEqual(offered, ["both-1"]);
  assert.equal(new Set(offered).size, offered.length);
});

/**
 * Dealt a round at a time: the first role must not take every good person
 * before the second role is considered.
 */
test("one role cannot starve the next", () => {
  const plan = planCrewStaffing({
    coverage: photoAndVideo,
    eventSpecialty: "weddings",
    serviceArea: "Madison",
    startsAt,
    endsAt,
    candidates: [
      candidate("a", "A Both", ["weddings", "video"]),
      candidate("b", "B Both", ["weddings", "video"]),
    ],
    depth: 5,
  });
  const photographer = plan.roles.find((r) => r.role === "Second photographer");
  const videographer = plan.roles.find((r) => r.role === "Videographer");
  assert.equal(photographer?.candidates.length, 1);
  assert.equal(videographer?.candidates.length, 1);
  assert.notEqual(
    photographer?.candidates[0]?.crewProfileId,
    videographer?.candidates[0]?.crewProfileId,
  );
});

test("the cascade for a role goes as deep as there are people for it", () => {
  const plan = planCrewStaffing({
    coverage: [{ role: "photographer", count: 2 }],
    eventSpecialty: "weddings",
    serviceArea: "Madison",
    startsAt,
    endsAt,
    candidates: [
      candidate("a", "A", ["weddings"]),
      candidate("b", "B", ["weddings"]),
      candidate("c", "C", ["weddings"]),
    ],
    depth: 2,
  });
  assert.equal(plan.roles[0]?.candidates.length, 2);
});

test("crew the studio removed by hand are never offered", () => {
  const plan = planCrewStaffing({
    coverage: [{ role: "photographer", count: 2 }],
    eventSpecialty: "weddings",
    serviceArea: "Madison",
    startsAt,
    endsAt,
    candidates: [candidate("a", "A", ["weddings"]), candidate("b", "B", ["weddings"])],
    excludedIds: ["a"],
  });
  assert.deepEqual(
    plan.roles[0]?.candidates.map((c) => c.crewProfileId),
    ["b"],
  );
});

// --- gaps, named rather than hidden ------------------------------------

/** A role that cannot be filled is stated, not quietly dropped. */
test("a role with nobody for it is still in the plan, carrying its gap", () => {
  const plan = planCrewStaffing({
    coverage: photoAndVideo,
    eventSpecialty: "weddings",
    serviceArea: "Madison",
    startsAt,
    endsAt,
    candidates: [candidate("pho-1", "Ben Photo", ["weddings"])],
  });
  assert.equal(plan.roles.length, 2);
  assert.equal(plan.toBook, 2);
  const videographer = plan.roles.find((r) => r.role === "Videographer");
  assert.equal(videographer?.candidates.length, 0);
  assert.equal(videographer?.gap?.kind, "no_eligible_candidate");
  assert.equal(plan.gaps.length, 1);
});

test("a gap says which of the two problems it is", () => {
  // One person who matches both; the photography role takes them first, so the
  // video role is short for a different reason than "nobody can do it".
  const plan = planCrewStaffing({
    coverage: photoAndVideo,
    eventSpecialty: "weddings",
    serviceArea: "Madison",
    startsAt,
    endsAt,
    candidates: [candidate("both-1", "Cass Both", ["weddings", "video"])],
  });
  const videographer = plan.roles.find((r) => r.role === "Videographer");
  assert.equal(videographer?.gap?.kind, "all_candidates_taken");
  assert.match(String(videographer?.gap?.reason), /already offered another role/);
});

test("someone unavailable that day is not a candidate", () => {
  const plan = planCrewStaffing({
    coverage: [{ role: "photographer", count: 2 }],
    eventSpecialty: "weddings",
    serviceArea: "Madison",
    startsAt,
    endsAt,
    candidates: [
      candidate("a", "A", ["weddings"], {
        availability: [{ startsAt, endsAt, status: "unavailable" }],
      }),
    ],
  });
  assert.equal(plan.roles[0]?.candidates.length, 0);
  assert.equal(plan.roles[0]?.gap?.kind, "no_eligible_candidate");
});

test("someone already working that day is not a candidate", () => {
  const plan = planCrewStaffing({
    coverage: [{ role: "photographer", count: 2 }],
    eventSpecialty: "weddings",
    serviceArea: "Madison",
    startsAt,
    endsAt,
    candidates: [
      candidate("a", "A", ["weddings"], {
        acceptedAssignments: [{ startsAt, endsAt }],
      }),
    ],
  });
  assert.equal(plan.roles[0]?.candidates.length, 0);
});

test("a plan reports what the package sends and what is left to book", () => {
  const plan = planCrewStaffing({
    coverage: photoAndVideo,
    eventSpecialty: "weddings",
    serviceArea: "Madison",
    startsAt,
    endsAt,
    candidates: [],
  });
  assert.equal(plan.coverageTotal, 3);
  assert.equal(plan.toBook, 2);
});

/**
 * functions/ is a separate package with no "@/features" path, so booking can
 * only prepare the plan server-side from a duplicate. Compare below the headers.
 */
test("the functions copy of the staffing plan matches features/", () => {
  const body = (path: string) => {
    const source = readFileSync(`${process.cwd()}/${path}`, "utf8");
    return source.slice(source.indexOf("export const VIDEO_SPECIALTY"));
  };
  assert.equal(
    body("functions/src/crew/staffing-plan.ts"),
    body("features/crew/staffing-plan.ts"),
  );
});

// --- the studio's own order reaches the offers ------------------------

/**
 * "You control the final order" has to be true of the offers, not the list.
 *
 * Found on production 2026-09-22 while walking a videographer job. The
 * staffing screen ranked everyone once, flat, and numbered the list from that
 * — while the plan that `create()` actually sends was rebuilt per role from
 * the engine. The two disagreed in both directions: a photographer showed as
 * "2" for a videographer role he would never be offered, and a videographer
 * the studio moved to the top with the arrows stayed second in the offers.
 */

const videoRole = [
  { role: "Videographer", coverageRole: "videographer" as const },
];

const shooters = [
  candidate("alex", "Alex Rivera", ["weddings"], {
    trades: ["photographer", "videographer"],
  }),
  candidate("marco", "Marco Silva", ["weddings"], {
    trades: ["videographer"],
  }),
];

const planFor = (preferredOrder?: string[]) =>
  assignCandidatesToRoles({
    roles: videoRole,
    eventSpecialty: "weddings",
    serviceArea: "Madison",
    startsAt,
    endsAt,
    candidates: shooters,
    ...(preferredOrder ? { preferredOrder } : {}),
  });

test("with no manual order the engine's ranking is untouched", () => {
  const [plan] = planFor();
  assert.ok(plan);
  assert.deepEqual(
    plan.candidates.map((candidate) => candidate.crewProfileId),
    ["alex", "marco"],
  );
});

test("the studio's order decides who is offered the role first", () => {
  const [plan] = planFor(["marco", "alex"]);
  assert.ok(plan);
  assert.deepEqual(
    plan.candidates.map((candidate) => candidate.crewProfileId),
    ["marco", "alex"],
    "moving someone to the top of the list must move them to the top of the offers",
  );
});

test("people the studio never moved keep their relative ranking", () => {
  // Only marco is named; alex has no stated position and must stay behind him
  // rather than being reshuffled arbitrarily.
  const [plan] = planFor(["marco"]);
  assert.ok(plan);
  assert.deepEqual(
    plan.candidates.map((candidate) => candidate.crewProfileId),
    ["marco", "alex"],
  );
});

test("a trade-matched role still ranks by trade when nothing is moved", () => {
  const [plan] = assignCandidatesToRoles({
    roles: videoRole,
    eventSpecialty: "weddings",
    serviceArea: "Madison",
    startsAt,
    endsAt,
    candidates: [
      candidate("jordan", "Jordan Reid", ["weddings"], {
        trades: ["photographer"],
      }),
      candidate("marco", "Marco Silva", ["weddings"], {
        trades: ["videographer"],
      }),
    ],
  });
  assert.ok(plan);
  assert.equal(
    plan.candidates[0]?.crewProfileId,
    "marco",
    "a videographer role must reach the videographer before the photographer",
  );
});
