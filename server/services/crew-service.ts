import type {
  AssignmentStatus,
  CrewAssignment,
  CrewRequirement,
} from "@/features/crew/schema";

const allowedTransitions: Readonly<Record<AssignmentStatus, readonly AssignmentStatus[]>> = {
  draft: ["invited", "cancelled"],
  invited: ["viewed", "accepted", "declined", "cancelled"],
  viewed: ["accepted", "declined", "cancelled"],
  accepted: ["reassigned", "cancelled", "completed"],
  declined: ["reassigned"],
  reassigned: [],
  cancelled: [],
  completed: [],
};

export function transitionAssignment(
  assignment: CrewAssignment,
  next: AssignmentStatus,
  actorId: string,
  occurredAt: string,
): CrewAssignment {
  if (!allowedTransitions[assignment.status].includes(next)) {
    throw new Error(`ASSIGNMENT_TRANSITION_NOT_ALLOWED:${assignment.status}:${next}`);
  }
  return {
    ...assignment,
    status: next,
    viewedAt: next === "viewed" ? occurredAt : assignment.viewedAt,
    respondedAt: ["accepted", "declined"].includes(next) ? occurredAt : assignment.respondedAt,
    calendarStatus: next === "declined" ? "declined" : assignment.calendarStatus,
    updatedAt: occurredAt,
    updatedBy: actorId,
  };
}

export function acknowledgeCalendar(
  assignment: CrewAssignment,
  actorId: string,
  occurredAt: string,
): CrewAssignment {
  if (assignment.status !== "accepted") throw new Error("ASSIGNMENT_NOT_ACCEPTED");
  return {
    ...assignment,
    calendarStatus: "added",
    calendarAcknowledgedAt: occurredAt,
    updatedAt: occurredAt,
    updatedBy: actorId,
  };
}

export function acknowledgeSchedule(
  assignment: CrewAssignment,
  scheduleId: string,
  scheduleVersion: number,
  actorId: string,
  occurredAt: string,
): CrewAssignment {
  if (assignment.status !== "accepted") throw new Error("ASSIGNMENT_NOT_ACCEPTED");
  if (
    assignment.currentScheduleId !== scheduleId
    || assignment.currentScheduleVersion !== scheduleVersion
  ) {
    throw new Error("SCHEDULE_VERSION_IS_NOT_CURRENT");
  }
  return {
    ...assignment,
    acknowledgedScheduleVersion: scheduleVersion,
    scheduleAcknowledgedAt: occurredAt,
    updatedAt: occurredAt,
    updatedBy: actorId,
  };
}

export function requireNewScheduleAcknowledgement(
  assignment: CrewAssignment,
  scheduleId: string,
  scheduleVersion: number,
  actorId: string,
  occurredAt: string,
): CrewAssignment {
  if (scheduleVersion <= assignment.currentScheduleVersion) {
    throw new Error("SCHEDULE_VERSION_MUST_INCREASE");
  }
  return {
    ...assignment,
    currentScheduleId: scheduleId,
    currentScheduleVersion: scheduleVersion,
    acknowledgedScheduleVersion: null,
    scheduleAcknowledgedAt: null,
    updatedAt: occurredAt,
    updatedBy: actorId,
  };
}

export function completeRequirement(
  assignment: CrewAssignment,
  requirementId: string,
  documentId: string | null,
  actorId: string,
  occurredAt: string,
): CrewAssignment {
  const requirement = assignment.requirements.find((item) => item.id === requirementId);
  if (!requirement) throw new Error("REQUIREMENT_NOT_FOUND");
  const requirements = assignment.requirements.map<CrewRequirement>((item) =>
    item.id === requirementId
      ? {
          ...item,
          status: "complete",
          documentId,
          completedAt: occurredAt,
          completedBy: actorId,
        }
      : item,
  );
  return { ...assignment, requirements, updatedAt: occurredAt, updatedBy: actorId };
}

export function crewAssignmentReadiness(assignment: CrewAssignment) {
  const blockingRequirements = assignment.requirements.filter(
    (item) => item.required && !["complete", "waived"].includes(item.status),
  );
  const scheduleCurrent =
    assignment.currentScheduleVersion > 0
    && assignment.acknowledgedScheduleVersion === assignment.currentScheduleVersion;
  const blockers = [
    ...(assignment.status === "accepted" ? [] : ["Assignment not accepted"]),
    ...(assignment.calendarStatus === "added" ? [] : ["Calendar not acknowledged"]),
    ...(scheduleCurrent ? [] : ["Current schedule not acknowledged"]),
    ...blockingRequirements.map((item) => item.name),
  ];
  return { ready: blockers.length === 0, blockers };
}
