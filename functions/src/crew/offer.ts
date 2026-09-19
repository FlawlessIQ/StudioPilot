import { createHash } from "node:crypto";
import type { DocumentData, DocumentSnapshot } from "firebase-admin/firestore";

/**
 * One crew offer: the assignment row, and the email that carries its link.
 *
 * Lifted out of `commands.ts` unchanged so booking can prepare and — when the
 * studio has asked for it — release offers without going through an
 * authenticated command. There must be exactly one way to build an offer: the
 * token hash, the expiry and the email fields are the parts that go wrong
 * quietly when a second copy drifts.
 */

export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export const appUrl = () =>
  process.env.NEXT_PUBLIC_APP_URL ?? "https://studiohub.app";

export function crewInvitationEmailFields(input: {
  role: unknown;
  arrivalAt: unknown;
  departureAt: unknown;
  respondBy: string;
  locations: unknown;
  responsibilities: unknown;
  compensationCents: unknown;
  compensationType: unknown;
  compensationVisibleToCrew: unknown;
  currency: unknown;
}) {
  const locations = Array.isArray(input.locations) ? input.locations : [];
  const firstLocation =
    typeof locations[0] === "object" && locations[0] !== null
      ? (locations[0] as Record<string, unknown>)
      : {};
  return {
    role: input.role,
    arrivalAt: input.arrivalAt,
    departureAt: input.departureAt,
    respondBy: input.respondBy,
    locationName: firstLocation.name ?? null,
    locationAddress: firstLocation.address ?? null,
    responsibilities: Array.isArray(input.responsibilities)
      ? input.responsibilities
      : [],
    compensationCents: input.compensationCents,
    compensationType: input.compensationType,
    compensationVisibleToCrew: input.compensationVisibleToCrew,
    currency: input.currency,
  };
}

export function cascadeAssignment(input: {
  id: string;
  tenantId: string;
  cascadeId: string;
  candidateIndex: number;
  profile: DocumentSnapshot;
  cascade: DocumentData;
  token: string;
  now: string;
  actorId: string;
}) {
  const expiresAt = new Date(
    Date.parse(input.now) +
      Number(input.cascade.responseWindowHours ?? 24) * 60 * 60 * 1000,
  ).toISOString();
  return {
    assignment: {
      id: input.id,
      tenantId: input.tenantId,
      projectId: input.cascade.projectId,
      // Named here because an outstanding offer is all the crew member can
      // read: the project itself stays closed until they accept.
      projectName: input.cascade.projectName ?? null,
      crewProfileId: input.profile.id,
      userId: input.profile.get("userId") ?? null,
      role: input.cascade.role,
      compensationCents: input.cascade.compensationCents,
      compensationType: input.cascade.compensationType,
      currency: input.cascade.currency,
      compensationVisibleToCrew: input.cascade.compensationVisibleToCrew,
      arrivalAt: input.cascade.arrivalAt,
      departureAt: input.cascade.departureAt,
      locations: input.cascade.locations,
      responsibilities: input.cascade.responsibilities,
      scheduleItemIds: input.cascade.scheduleItemIds,
      notes: null,
      status: "invited",
      invitationSentAt: input.now,
      viewedAt: null,
      respondedAt: null,
      calendarStatus: "not_added",
      calendarAcknowledgedAt: null,
      currentScheduleId: input.cascade.currentScheduleId,
      currentScheduleVersion: input.cascade.currentScheduleVersion,
      acknowledgedScheduleVersion: null,
      scheduleAcknowledgedAt: null,
      requirements: Array.isArray(input.cascade.requirements)
        ? input.cascade.requirements.map((itemValue: unknown) => {
            const item =
              typeof itemValue === "object" &&
              itemValue !== null &&
              !Array.isArray(itemValue)
                ? (itemValue as Record<string, unknown>)
                : {};
            return {
              ...item,
              status: "missing",
              documentId: null,
              completedAt: null,
              completedBy: null,
              notes: null,
            };
          })
        : [],
      inviteTokenHash: hash(input.token),
      inviteExpiresAt: expiresAt,
      cascadeId: input.cascadeId,
      cascadeCandidateIndex: input.candidateIndex,
      createdAt: input.now,
      updatedAt: input.now,
      createdBy: input.actorId,
      updatedBy: input.actorId,
      archivedAt: null,
    },
    emailJob: {
      id: `crew_invite_${input.id}`,
      tenantId: input.tenantId,
      projectId: input.cascade.projectId,
      type: "crew_invitation",
      assignmentId: input.id,
      cascadeId: input.cascadeId,
      recipient: input.profile.get("email"),
      recipientName: input.profile.get("name"),
      inviteToken: input.token,
      inviteUrl: `${appUrl()}/auth/crew-invite?token=${encodeURIComponent(input.token)}`,
      ...crewInvitationEmailFields({
        role: input.cascade.role,
        arrivalAt: input.cascade.arrivalAt,
        departureAt: input.cascade.departureAt,
        respondBy: expiresAt,
        locations: input.cascade.locations,
        responsibilities: input.cascade.responsibilities,
        compensationCents: input.cascade.compensationCents,
        compensationType: input.cascade.compensationType,
        compensationVisibleToCrew: input.cascade.compensationVisibleToCrew,
        currency: input.cascade.currency,
      }),
      status: "queued",
      attempts: 0,
      createdAt: input.now,
      updatedAt: input.now,
    },
    expiresAt,
  };
}

