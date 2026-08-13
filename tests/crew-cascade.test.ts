import assert from "node:assert/strict";
import test from "node:test";
import {
  eventDaySnapshot,
  nextCrewCascadeState,
  rankCrewCandidates,
} from "../features/crew/cascade";

test("event day snapshot identifies now, next, and stale acknowledgements", () => {
  const snapshot = eventDaySnapshot({
    now: "2027-06-12T16:30:00.000Z",
    scheduleVersion: 3,
    items: [
      { id: "prep", startAt: "2027-06-12T15:00:00.000Z", endAt: "2027-06-12T16:00:00.000Z" },
      { id: "ceremony", startAt: "2027-06-12T16:00:00.000Z", endAt: "2027-06-12T17:00:00.000Z" },
      { id: "portraits", startAt: "2027-06-12T17:15:00.000Z", endAt: "2027-06-12T18:00:00.000Z" },
    ],
    assignments: [
      { id: "primary", acknowledgedScheduleVersion: 3 },
      { id: "second", acknowledgedScheduleVersion: 2 },
    ],
  });

  assert.equal(snapshot.currentItemId, "ceremony");
  assert.equal(snapshot.nextItemId, "portraits");
  assert.deepEqual(snapshot.unacknowledgedAssignmentIds, ["second"]);
});

const base = {
  active: true,
  specialties: ["weddings"],
  serviceAreas: ["New York"],
  travelRadiusMiles: 80,
  preferenceRank: null,
  w9Status: "verified",
  insuranceStatus: "verified",
  contractStatus: "completed",
  availability: [
    {
      startsAt: "2027-06-12T10:00:00.000Z",
      endsAt: "2027-06-13T02:00:00.000Z",
      status: "available" as const,
    },
  ],
  acceptedAssignments: [],
};

test("crew ranking explains eligibility, profile gaps, and conflicts", () => {
  const ranked = rankCrewCandidates({
    roleSpecialty: "weddings",
    serviceArea: "New York",
    startsAt: "2027-06-12T14:00:00.000Z",
    endsAt: "2027-06-13T00:00:00.000Z",
    candidates: [
      { ...base, id: "preferred", name: "Avery", preferenceRank: 1 },
      {
        ...base,
        id: "conflict",
        name: "Blake",
        acceptedAssignments: [
          {
            startsAt: "2027-06-12T18:00:00.000Z",
            endsAt: "2027-06-13T01:00:00.000Z",
          },
        ],
      },
      {
        ...base,
        id: "incomplete",
        name: "Casey",
        insuranceStatus: "missing",
        serviceAreas: [],
      },
    ],
  });

  assert.equal(ranked[0]?.crewProfileId, "preferred");
  assert.equal(ranked[0]?.eligible, true);
  assert.equal(
    ranked.find((candidate) => candidate.crewProfileId === "conflict")
      ?.eligible,
    false,
  );
  assert.ok(
    ranked
      .find((candidate) => candidate.crewProfileId === "incomplete")
      ?.incompleteProfile.includes("insurance"),
  );
});

test("a decline or expiry advances exactly one candidate", () => {
  assert.deepEqual(
    nextCrewCascadeState({
      status: "active",
      candidateIds: ["a", "b", "c"],
      currentCandidateIndex: 0,
      decision: "declined",
    }),
    {
      status: "active",
      currentCandidateIndex: 1,
      nextCandidateId: "b",
    },
  );
  assert.equal(
    nextCrewCascadeState({
      status: "active",
      candidateIds: ["a", "b"],
      currentCandidateIndex: 1,
      decision: "expired",
    }).status,
    "exhausted",
  );
});

test("authoritative acceptance fills and stops the cascade", () => {
  assert.deepEqual(
    nextCrewCascadeState({
      status: "active",
      candidateIds: ["a", "b"],
      currentCandidateIndex: 0,
      decision: "accepted",
    }),
    {
      status: "filled",
      currentCandidateIndex: 0,
      nextCandidateId: null,
    },
  );
  assert.throws(() =>
    nextCrewCascadeState({
      status: "filled",
      candidateIds: ["a", "b"],
      currentCandidateIndex: 0,
      decision: "declined",
    }),
  );
});
