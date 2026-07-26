import { createHash, randomBytes } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { requireAppCheck, requireIdentity } from "../crm/security.js";

const requirement = z.object({
  id: z.string().min(1), name: z.string().min(1),
  kind: z.enum(["w9", "insurance", "contract", "equipment", "file", "acknowledgement"]),
  required: z.boolean(), dueAt: z.string().datetime().nullable(),
});
const command = z.discriminatedUnion("type", [
  z.object({ type: z.literal("createCrewProfile"), tenantId: z.string(), idempotencyKey: z.string().min(8), input: z.object({
    name: z.string().min(1).max(160), email: z.string().email(),
    phone: z.string().min(7).max(30).nullable(), specialties: z.array(z.string().min(1)),
    serviceAreas: z.array(z.string().min(1)), travelRadiusMiles: z.number().int().nonnegative().max(500),
    rateType: z.enum(["hourly", "event"]), rateCents: z.number().int().nonnegative(),
    currency: z.string().length(3),
  }) }),
  z.object({ type: z.literal("inviteAssignment"), tenantId: z.string(), idempotencyKey: z.string().min(8), input: z.object({
    projectId: z.string(), crewProfileId: z.string(), userId: z.string().nullable(),
    role: z.string().min(1).max(120), compensationCents: z.number().int().nonnegative().nullable(),
    compensationType: z.enum(["hourly", "event"]).nullable(), currency: z.string().length(3),
    compensationVisibleToCrew: z.boolean(), arrivalAt: z.string().datetime(),
    departureAt: z.string().datetime(), locations: z.array(z.object({
      name: z.string().min(1), address: z.string().nullable(),
    })).min(1), responsibilities: z.array(z.string().min(1)),
    scheduleItemIds: z.array(z.string()), currentScheduleId: z.string().nullable(),
    currentScheduleVersion: z.number().int().nonnegative(), requirements: z.array(requirement),
  }) }),
  z.object({ type: z.literal("respondAssignment"), tenantId: z.string(), idempotencyKey: z.string().min(8), input: z.object({
    projectId: z.string(), assignmentId: z.string(), decision: z.enum(["accepted", "declined"]),
  }) }),
  z.object({ type: z.literal("acknowledgeCalendar"), tenantId: z.string(), idempotencyKey: z.string().min(8), input: z.object({
    projectId: z.string(), assignmentId: z.string(),
  }) }),
  z.object({ type: z.literal("acknowledgeSchedule"), tenantId: z.string(), idempotencyKey: z.string().min(8), input: z.object({
    projectId: z.string(), assignmentId: z.string(), scheduleId: z.string(),
    scheduleVersion: z.number().int().positive(),
  }) }),
  z.object({ type: z.literal("completeRequirement"), tenantId: z.string(), idempotencyKey: z.string().min(8), input: z.object({
    projectId: z.string(), assignmentId: z.string(), requirementId: z.string(),
    documentId: z.string().nullable(),
  }) }),
  z.object({ type: z.literal("submitRequirement"), tenantId: z.string(), idempotencyKey: z.string().min(8), input: z.object({
    projectId: z.string(), assignmentId: z.string(), requirementId: z.string(),
    documentId: z.string().min(1),
  }) }),
]);

const internalRoles = new Set(["studio_owner", "studio_admin", "studio_coordinator"]);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const stable = (scope: string, tenantId: string, key: string) =>
  `${scope}_${hash(`${tenantId}:${key}`).slice(0, 32)}`;

export const crewCommand = onRequest(
  { cors: [/localhost/, /\.studiohub\.app$/, /\.flawlessiq\.chatgpt\.site$/], invoker: "public" },
  async (request, response) => {
    if (request.method !== "POST") { response.status(405).json({ error: "METHOD_NOT_ALLOWED" }); return; }
    try {
      await requireAppCheck(request);
      const identity = await requireIdentity(request);
      const parsed = command.parse(request.body);
      const db = getFirestore();
      const membership = await db.doc(`memberships/${parsed.tenantId}_${identity.uid}`).get();
      if (!membership.exists || membership.get("status") !== "active") throw new Error("FORBIDDEN");
      const role = String(membership.get("role"));
      const projectIds = membership.get("projectIds") as unknown;
      const hasProject = (projectId: string) =>
        ["studio_owner", "studio_admin"].includes(role)
        || (Array.isArray(projectIds) && projectIds.includes(projectId));
      const execution = db.doc(`commandExecutions/${stable("crew", parsed.tenantId, parsed.idempotencyKey)}`);
      const prior = await execution.get();
      if (prior.exists) { response.status(200).json(prior.get("result")); return; }
      const now = new Date().toISOString();
      let result: Record<string, unknown>;

      if (parsed.type === "createCrewProfile") {
        if (!internalRoles.has(role)) throw new Error("FORBIDDEN");
        const id = stable("crew_profile", parsed.tenantId, parsed.idempotencyKey);
        await db.doc(`crewProfiles/${id}`).create({
          id, tenantId: parsed.tenantId, userId: null, ...parsed.input, equipment: [],
          w9Status: "missing", insuranceStatus: "missing", contractStatus: "missing",
          emergencyContact: null, notes: null, active: true, createdAt: now, updatedAt: now,
          createdBy: identity.uid, updatedBy: identity.uid, archivedAt: null,
        });
        result = { crewProfileId: id };
      } else if (parsed.type === "inviteAssignment") {
        if (!internalRoles.has(role) || !hasProject(parsed.input.projectId)) throw new Error("FORBIDDEN");
        const profile = await db.doc(`crewProfiles/${parsed.input.crewProfileId}`).get();
        if (!profile.exists || profile.get("tenantId") !== parsed.tenantId) throw new Error("CREW_PROFILE_NOT_FOUND");
        const id = stable("crew_assignment", parsed.tenantId, parsed.idempotencyKey);
        const inviteToken = randomBytes(32).toString("base64url");
        const inviteExpiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
        const batch = db.batch();
        batch.create(db.doc(`crewAssignments/${id}`), {
          id, tenantId: parsed.tenantId, projectId: parsed.input.projectId,
          crewProfileId: parsed.input.crewProfileId, userId: parsed.input.userId,
          role: parsed.input.role, compensationCents: parsed.input.compensationCents,
          compensationType: parsed.input.compensationType, currency: parsed.input.currency,
          compensationVisibleToCrew: parsed.input.compensationVisibleToCrew,
          arrivalAt: parsed.input.arrivalAt, departureAt: parsed.input.departureAt,
          locations: parsed.input.locations, responsibilities: parsed.input.responsibilities,
          scheduleItemIds: parsed.input.scheduleItemIds, notes: null, status: "invited",
          invitationSentAt: now, viewedAt: null, respondedAt: null,
          calendarStatus: "not_added", calendarAcknowledgedAt: null,
          currentScheduleId: parsed.input.currentScheduleId,
          currentScheduleVersion: parsed.input.currentScheduleVersion,
          acknowledgedScheduleVersion: null, scheduleAcknowledgedAt: null,
          requirements: parsed.input.requirements.map((item) => ({
            ...item, status: "missing", documentId: null, completedAt: null,
            completedBy: null, notes: null,
          })),
          inviteTokenHash: hash(inviteToken), inviteExpiresAt, createdAt: now, updatedAt: now,
          createdBy: identity.uid, updatedBy: identity.uid, archivedAt: null,
        });
        batch.create(db.doc(`emailJobs/crew_invite_${id}`), {
          tenantId: parsed.tenantId, projectId: parsed.input.projectId,
          type: "crew_invitation", assignmentId: id, recipient: profile.get("email"),
          inviteToken, status: "queued", createdAt: now,
        });
        await batch.commit();
        result = { assignmentId: id, status: "invited", inviteExpiresAt };
      } else {
        if (!hasProject(parsed.input.projectId)) throw new Error("FORBIDDEN");
        const reference = db.doc(`crewAssignments/${parsed.input.assignmentId}`);
        await db.runTransaction(async (transaction) => {
          const current = await transaction.get(reference);
          if (!current.exists || current.get("tenantId") !== parsed.tenantId || current.get("projectId") !== parsed.input.projectId) {
            throw new Error("ASSIGNMENT_NOT_FOUND");
          }
          const ownsAssignment = current.get("userId") === identity.uid;
          const internal = internalRoles.has(role);
          if (!internal && !ownsAssignment) throw new Error("FORBIDDEN");
          if (parsed.type === "respondAssignment") {
            if (!ownsAssignment || !["invited", "viewed"].includes(String(current.get("status")))) throw new Error("ASSIGNMENT_NOT_RESPONDABLE");
            transaction.update(reference, {
              status: parsed.input.decision, respondedAt: now,
              calendarStatus: parsed.input.decision === "declined" ? "declined" : "not_added",
              updatedAt: now, updatedBy: identity.uid,
            });
          } else if (parsed.type === "acknowledgeCalendar") {
            if (!ownsAssignment || current.get("status") !== "accepted") throw new Error("ASSIGNMENT_NOT_ACCEPTED");
            transaction.update(reference, {
              calendarStatus: "added", calendarAcknowledgedAt: now,
              updatedAt: now, updatedBy: identity.uid,
            });
          } else if (parsed.type === "acknowledgeSchedule") {
            if (!ownsAssignment || current.get("status") !== "accepted"
              || current.get("currentScheduleId") !== parsed.input.scheduleId
              || current.get("currentScheduleVersion") !== parsed.input.scheduleVersion) {
              throw new Error("SCHEDULE_VERSION_IS_NOT_CURRENT");
            }
            transaction.update(reference, {
              acknowledgedScheduleVersion: parsed.input.scheduleVersion,
              scheduleAcknowledgedAt: now, updatedAt: now, updatedBy: identity.uid,
            });
          } else if (parsed.type === "submitRequirement") {
            if (!ownsAssignment) throw new Error("FORBIDDEN");
            const requirements = current.get("requirements") as Array<Record<string, unknown>>;
            if (!requirements.some((item) => item.id === parsed.input.requirementId)) {
              throw new Error("REQUIREMENT_NOT_FOUND");
            }
            transaction.update(reference, {
              requirements: requirements.map((item) => item.id === parsed.input.requirementId
                ? { ...item, status: "submitted", documentId: parsed.input.documentId,
                    completedAt: null, completedBy: null }
                : item),
              updatedAt: now, updatedBy: identity.uid,
            });
          } else {
            const requirements = current.get("requirements") as Array<Record<string, unknown>>;
            const target = requirements.find((item) => item.id === parsed.input.requirementId);
            if (!target) throw new Error("REQUIREMENT_NOT_FOUND");
            if (!internal && !["equipment", "acknowledgement"].includes(String(target.kind))) throw new Error("REQUIREMENT_REQUIRES_STUDIO_REVIEW");
            transaction.update(reference, {
              requirements: requirements.map((item) => item.id === parsed.input.requirementId
                ? { ...item, status: "complete", documentId: parsed.input.documentId,
                    completedAt: now, completedBy: identity.uid }
                : item),
              updatedAt: now, updatedBy: identity.uid,
            });
          }
        });
        result = parsed.type === "respondAssignment"
          ? { assignmentId: parsed.input.assignmentId, status: parsed.input.decision }
          : { assignmentId: parsed.input.assignmentId, completed: true };
      }

      const auditId = stable("audit", parsed.tenantId, parsed.idempotencyKey);
      await db.doc(`auditEvents/${auditId}`).create({
        id: auditId, tenantId: parsed.tenantId,
        projectId: "projectId" in parsed.input ? parsed.input.projectId : null,
        actorId: identity.uid, actorType: "user", action: `crew.${parsed.type}`,
        entityType: parsed.type === "createCrewProfile" ? "crewProfile" : "crewAssignment",
        entityId: String(result.crewProfileId ?? result.assignmentId ?? ""),
        timestamp: now, before: null, after: result, ipAddress: request.ip ?? null,
        userAgent: request.get("user-agent") ?? null, correlationId: parsed.idempotencyKey,
        automationRunId: null, providerEventId: null,
      });
      await execution.create({ tenantId: parsed.tenantId, result, createdAt: now });
      response.status(200).json(result);
    } catch (caught: unknown) {
      const message = caught instanceof Error ? caught.message : "CREW_COMMAND_FAILED";
      response.status(message === "FORBIDDEN" ? 403 : 400).json({ error: message });
    }
  },
);
