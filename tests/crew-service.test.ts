import assert from "node:assert/strict";
import test from "node:test";
import { crewAssignmentSchema, type CrewAssignment } from "../features/crew/schema";
import {
  acknowledgeCalendar,
  acknowledgeSchedule,
  completeRequirement,
  crewAssignmentReadiness,
  requireNewScheduleAcknowledgement,
  transitionAssignment,
} from "../server/services/crew-service";

const assignment = crewAssignmentSchema.parse({
  id: "assignment-1", tenantId: "tenant-a", projectId: "project-a",
  crewProfileId: "crew-a", userId: "user-a", role: "Second photographer",
  compensationCents: 80000, compensationType: "event", currency: "USD",
  compensationVisibleToCrew: true, arrivalAt: "2026-08-15T17:15:00.000Z",
  departureAt: "2026-08-16T01:30:00.000Z",
  locations: [{ name: "The Foundry", address: "Long Island City" }],
  responsibilities: ["Ceremony reactions"], scheduleItemIds: ["ceremony"],
  notes: null, status: "invited", invitationSentAt: "2026-07-26T12:00:00.000Z",
  viewedAt: null, respondedAt: null, calendarStatus: "not_added",
  calendarAcknowledgedAt: null, currentScheduleId: "schedule-v4",
  currentScheduleVersion: 4, acknowledgedScheduleVersion: null,
  scheduleAcknowledgedAt: null,
  requirements: [{ id: "insurance", name: "Liability insurance", kind: "insurance",
    required: true, status: "submitted", dueAt: null, documentId: "doc-1",
    completedAt: null, completedBy: null, notes: null }],
  inviteTokenHash: "a".repeat(64), inviteExpiresAt: "2026-08-01T12:00:00.000Z",
  createdAt: "2026-07-26T12:00:00.000Z", updatedAt: "2026-07-26T12:00:00.000Z",
  createdBy: "owner", updatedBy: "owner", archivedAt: null,
});

test("assignment transitions are explicit and acceptance records evidence", () => {
  const accepted = transitionAssignment(assignment, "accepted", "user-a", "2026-07-27T12:00:00.000Z");
  assert.equal(accepted.status, "accepted");
  assert.equal(accepted.respondedAt, "2026-07-27T12:00:00.000Z");
  assert.throws(() => transitionAssignment(accepted, "declined", "user-a", accepted.updatedAt));
});

test("calendar and schedule acknowledgements require an accepted current assignment", () => {
  assert.throws(() => acknowledgeCalendar(assignment, "user-a", assignment.updatedAt));
  const accepted = transitionAssignment(assignment, "accepted", "user-a", "2026-07-27T12:00:00.000Z");
  const calendared = acknowledgeCalendar(accepted, "user-a", "2026-07-27T12:01:00.000Z");
  assert.equal(calendared.calendarStatus, "added");
  assert.throws(() => acknowledgeSchedule(calendared, "schedule-v3", 3, "user-a", calendared.updatedAt));
  assert.equal(
    acknowledgeSchedule(calendared, "schedule-v4", 4, "user-a", "2026-07-27T12:02:00.000Z")
      .acknowledgedScheduleVersion,
    4,
  );
});

test("publishing a newer schedule invalidates the prior acknowledgement", () => {
  const accepted = transitionAssignment(assignment, "accepted", "user-a", "2026-07-27T12:00:00.000Z");
  const acknowledged = acknowledgeSchedule(accepted, "schedule-v4", 4, "user-a", "2026-07-27T12:02:00.000Z");
  const updated = requireNewScheduleAcknowledgement(
    acknowledged, "schedule-v5", 5, "owner", "2026-07-28T12:00:00.000Z",
  );
  assert.equal(updated.acknowledgedScheduleVersion, null);
  assert.equal(updated.scheduleAcknowledgedAt, null);
});

test("required documents and acknowledgements deterministically control crew readiness", () => {
  let current: CrewAssignment = transitionAssignment(assignment, "accepted", "user-a", "2026-07-27T12:00:00.000Z");
  current = acknowledgeCalendar(current, "user-a", "2026-07-27T12:01:00.000Z");
  current = acknowledgeSchedule(current, "schedule-v4", 4, "user-a", "2026-07-27T12:02:00.000Z");
  assert.equal(crewAssignmentReadiness(current).ready, false);
  current = completeRequirement(current, "insurance", "doc-1", "owner", "2026-07-27T12:03:00.000Z");
  assert.deepEqual(crewAssignmentReadiness(current), { ready: true, blockers: [] });
});
