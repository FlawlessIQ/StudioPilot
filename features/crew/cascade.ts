export type CrewCandidateInput = {
  id: string;
  name: string;
  active: boolean;
  specialties: readonly string[];
  serviceAreas: readonly string[];
  travelRadiusMiles: number;
  preferenceRank: number | null;
  w9Status: string;
  insuranceStatus: string;
  contractStatus: string;
  availability: readonly {
    startsAt: string;
    endsAt: string;
    status: "available" | "unavailable" | "tentative";
  }[];
  acceptedAssignments: readonly {
    startsAt: string;
    endsAt: string;
  }[];
};

export type CrewCandidateRecommendation = {
  crewProfileId: string;
  name: string;
  eligible: boolean;
  score: number;
  explanations: string[];
  /** Dimensions with no data — reported as unknown, not as objections. */
  unknowns: string[];
  exclusions: string[];
  incompleteProfile: string[];
};

const overlaps = (
  startsAt: string,
  endsAt: string,
  otherStartsAt: string,
  otherEndsAt: string,
) =>
  Date.parse(startsAt) < Date.parse(otherEndsAt) &&
  Date.parse(endsAt) > Date.parse(otherStartsAt);

export function rankCrewCandidates(input: {
  roleSpecialty: string;
  serviceArea: string;
  startsAt: string;
  endsAt: string;
  candidates: readonly CrewCandidateInput[];
}): CrewCandidateRecommendation[] {
  const role = input.roleSpecialty.toLocaleLowerCase();
  const area = input.serviceArea.toLocaleLowerCase();
  return input.candidates
    .map((candidate) => {
      const incompleteProfile: string[] = [];
      if (!candidate.specialties.length) incompleteProfile.push("specialties");
      if (!candidate.serviceAreas.length) incompleteProfile.push("service area");
      if (!candidate.travelRadiusMiles) incompleteProfile.push("travel radius");
      if (!["received", "verified"].includes(candidate.w9Status))
        incompleteProfile.push("W-9");
      if (candidate.insuranceStatus !== "verified")
        incompleteProfile.push("insurance");
      if (candidate.contractStatus !== "completed")
        incompleteProfile.push("crew agreement");

      const specialtyMatch = candidate.specialties.some((specialty) =>
        [specialty.toLocaleLowerCase(), role].some(
          (value) => value.includes(role) || role.includes(value),
        ),
      );
      const serviceAreaMatch =
        !area ||
        candidate.serviceAreas.some((serviceArea) =>
          serviceArea.toLocaleLowerCase().includes(area),
        );
      const explicitAvailability = candidate.availability.find((window) =>
        overlaps(
          input.startsAt,
          input.endsAt,
          window.startsAt,
          window.endsAt,
        ),
      );
      const assignmentConflict = candidate.acceptedAssignments.some(
        (assignment) =>
          overlaps(
            input.startsAt,
            input.endsAt,
            assignment.startsAt,
            assignment.endsAt,
          ),
      );
      const exclusions = [
        ...(candidate.active ? [] : ["Profile is inactive"]),
        ...(specialtyMatch ? [] : ["Role or specialty does not match"]),
        ...(explicitAvailability?.status === "unavailable"
          ? ["Marked unavailable"]
          : []),
        ...(assignmentConflict ? ["Conflicts with accepted work"] : []),
      ];
      let score = 0;
      if (specialtyMatch) score += 35;
      if (explicitAvailability?.status === "available") score += 30;
      else if (explicitAvailability?.status === "tentative") score += 15;
      if (serviceAreaMatch) score += 10;
      if (!incompleteProfile.includes("insurance")) score += 5;
      if (!incompleteProfile.includes("W-9")) score += 5;
      if (!incompleteProfile.includes("crew agreement")) score += 5;
      if (candidate.preferenceRank !== null)
        score += Math.max(0, 10 - candidate.preferenceRank);
      return {
        crewProfileId: candidate.id,
        name: candidate.name,
        eligible: exclusions.length === 0,
        score,
        // Only what is actually known about this person. The list used to
        // carry a line per dimension whether or not there was anything to
        // say, so a perfectly good candidate was described as "No explicit
        // availability signal · Travel area needs confirmation · No studio
        // preference rank" — three absences reading as three objections.
        // What is unknown is still reported, separately and as unknown.
        explanations: [
          specialtyMatch ? "Specialty matches the requested role" : null,
          explicitAvailability
            ? `Availability is ${explicitAvailability.status}`
            : null,
          serviceAreaMatch ? "Service area matches" : null,
          candidate.preferenceRank === null
            ? null
            : `Studio preference rank ${candidate.preferenceRank}`,
        ].filter((value): value is string => value !== null),
        unknowns: [
          specialtyMatch ? null : "specialty",
          explicitAvailability ? null : "availability",
          serviceAreaMatch ? null : "travel area",
        ].filter((value): value is string => value !== null),
        exclusions,
        incompleteProfile,
      };
    })
    .sort(
      (left, right) =>
        Number(right.eligible) - Number(left.eligible) ||
        right.score - left.score ||
        left.name.localeCompare(right.name),
    );
}

export function nextCrewCascadeState(input: {
  status: "active" | "filled" | "exhausted";
  candidateIds: readonly string[];
  currentCandidateIndex: number;
  decision: "accepted" | "declined" | "expired";
}) {
  if (input.status !== "active") throw new Error("CASCADE_NOT_ACTIVE");
  if (input.decision === "accepted") {
    return {
      status: "filled" as const,
      currentCandidateIndex: input.currentCandidateIndex,
      nextCandidateId: null,
    };
  }
  const nextIndex = input.currentCandidateIndex + 1;
  return nextIndex < input.candidateIds.length
    ? {
        status: "active" as const,
        currentCandidateIndex: nextIndex,
        nextCandidateId: input.candidateIds[nextIndex] ?? null,
      }
    : {
        status: "exhausted" as const,
        currentCandidateIndex: input.currentCandidateIndex,
        nextCandidateId: null,
      };
}

export function eventDaySnapshot(input: {
  now: string;
  scheduleVersion: number;
  items: ReadonlyArray<{ id: string; startAt: string; endAt: string }>;
  assignments: ReadonlyArray<{
    id: string;
    acknowledgedScheduleVersion: number | null;
  }>;
}) {
  const now = Date.parse(input.now);
  const ordered = [...input.items].sort(
    (left, right) => Date.parse(left.startAt) - Date.parse(right.startAt),
  );
  return {
    currentItemId:
      ordered.find(
        (item) => Date.parse(item.startAt) <= now && Date.parse(item.endAt) > now,
      )?.id ?? null,
    nextItemId:
      ordered.find((item) => Date.parse(item.startAt) > now)?.id ?? null,
    unacknowledgedAssignmentIds: input.assignments
      .filter(
        (assignment) =>
          Number(assignment.acknowledgedScheduleVersion ?? 0) <
          input.scheduleVersion,
      )
      .map((assignment) => assignment.id),
  };
}
