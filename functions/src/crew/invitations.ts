import { createHash, timingSafeEqual } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { requireAppCheck, requireIdentity } from "../crm/security.js";
import { studioHubCors } from "../security/cors.js";

const input = z.object({
  token: z.string().min(32).max(200),
  idempotencyKey: z.string().min(8).max(160),
});
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const equalHash = (left: string, right: string) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};
const normalizedEmail = (value: string) => value.trim().toLowerCase();

export const crewInvitationCommand = onRequest(
  {
    cors: studioHubCors,
    invoker: "private",
  },
  async (request, response) => {
    if (request.method !== "POST") {
      response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
      return;
    }
    try {
      await requireAppCheck(request);
      const identity = await requireIdentity(request);
      if (
        identity.email_verified !== true ||
        typeof identity.email !== "string"
      ) {
        throw new Error("VERIFIED_EMAIL_REQUIRED");
      }
      const parsed = input.parse(request.body);
      const tokenHash = hash(parsed.token);
      const db = getFirestore();
      const assignments = await db
        .collection("crewAssignments")
        .where("inviteTokenHash", "==", tokenHash)
        .limit(1)
        .get();
      const assignmentReference = assignments.docs[0]?.ref;
      if (!assignmentReference) throw new Error("INVITATION_NOT_FOUND");
      const identityEmail = normalizedEmail(identity.email);
      const now = new Date().toISOString();
      const result = await db.runTransaction(async (transaction) => {
        const assignment = await transaction.get(assignmentReference);
        if (
          !assignment.exists ||
          !equalHash(String(assignment.get("inviteTokenHash")), tokenHash)
        ) {
          throw new Error("INVITATION_NOT_FOUND");
        }
        if (
          !["invited", "viewed"].includes(String(assignment.get("status"))) ||
          Date.parse(String(assignment.get("inviteExpiresAt"))) <= Date.now()
        ) {
          throw new Error("INVITATION_EXPIRED");
        }
        if (
          assignment.get("userId") &&
          assignment.get("userId") !== identity.uid
        ) {
          throw new Error("INVITATION_ALREADY_USED");
        }
        if (
          assignment.get("userId") === identity.uid &&
          assignment.get("status") === "viewed"
        ) {
          return {
            tenantId: String(assignment.get("tenantId")),
            projectId: String(assignment.get("projectId")),
            assignmentId: assignmentReference.id,
            status: "viewed",
          };
        }
        const tenantId = String(assignment.get("tenantId"));
        const projectId = String(assignment.get("projectId"));
        const profileReference = db.doc(
          `crewProfiles/${String(assignment.get("crewProfileId"))}`,
        );
        const membershipReference = db.doc(
          `memberships/${tenantId}_${identity.uid}`,
        );
        const subscriptionReference = db.doc(`subscriptions/${tenantId}`);
        const [profile, membership, subscription] = await Promise.all([
          transaction.get(profileReference),
          transaction.get(membershipReference),
          transaction.get(subscriptionReference),
        ]);
        if (
          !profile.exists ||
          normalizedEmail(String(profile.get("email"))) !== identityEmail
        ) {
          throw new Error("INVITED_EMAIL_MISMATCH");
        }
        if (profile.get("userId") && profile.get("userId") !== identity.uid)
          throw new Error("INVITATION_ALREADY_USED");
        if (
          membership.exists &&
          !["subcontractor"].includes(String(membership.get("role")))
        ) {
          throw new Error("MEMBERSHIP_ROLE_CONFLICT");
        }
        const wasLinked = Boolean(profile.get("userId"));
        if (!wasLinked && subscription.exists) {
          const maximumValue = subscription.get(
            "entitlements.maxActiveSubcontractors",
          );
          const maximum =
            typeof maximumValue === "number" ? maximumValue : null;
          const current = Number(
            subscription.get("activeSubcontractorCount") ?? 0,
          );
          if (maximum !== null && current >= maximum)
            throw new Error("SUBCONTRACTOR_LIMIT_REACHED");
          transaction.update(subscriptionReference, {
            activeSubcontractorCount: current + 1,
            updatedAt: now,
            updatedBy: identity.uid,
          });
        }
        const priorProjects = membership.get("projectIds");
        const projectIds = Array.from(
          new Set([
            ...(Array.isArray(priorProjects)
              ? priorProjects.filter(
                  (value): value is string => typeof value === "string",
                )
              : []),
            projectId,
          ]),
        );
        transaction.set(
          membershipReference,
          {
            id: membershipReference.id,
            tenantId,
            userId: identity.uid,
            email: identityEmail,
            displayName: String(identity.name ?? profile.get("name")),
            role: "subcontractor",
            explicitPermissions: [],
            projectIds,
            status: "active",
            createdAt: membership.get("createdAt") ?? now,
            updatedAt: now,
            createdBy: membership.get("createdBy") ?? identity.uid,
            updatedBy: identity.uid,
            archivedAt: null,
          },
          { merge: true },
        );
        transaction.set(
          db.doc(`users/${identity.uid}`),
          {
            id: identity.uid,
            tenantId: "platform",
            email: identityEmail,
            displayName: String(identity.name ?? profile.get("name")),
            emailVerified: true,
            photoUrl: identity.picture ?? null,
            phone: profile.get("phone") ?? null,
            lastLoginAt: now,
            createdAt: now,
            updatedAt: now,
            createdBy: identity.uid,
            updatedBy: identity.uid,
            archivedAt: null,
          },
          { merge: true },
        );
        transaction.update(profileReference, {
          userId: identity.uid,
          updatedAt: now,
          updatedBy: identity.uid,
        });
        transaction.update(assignmentReference, {
          userId: identity.uid,
          status: "viewed",
          viewedAt: assignment.get("viewedAt") ?? now,
          updatedAt: now,
          updatedBy: identity.uid,
        });
        transaction.create(
          db.doc(`auditEvents/crew_invite_accept_${assignmentReference.id}`),
          {
            id: `crew_invite_accept_${assignmentReference.id}`,
            tenantId,
            projectId,
            actorId: identity.uid,
            actorType: "subcontractor",
            action: "crew.invitation_accepted",
            entityType: "crew_assignment",
            entityId: assignmentReference.id,
            timestamp: now,
            before: {
              status: assignment.get("status"),
              userId: assignment.get("userId") ?? null,
            },
            after: { status: "viewed", userId: identity.uid },
            ipAddress: request.ip ?? null,
            userAgent: request.get("user-agent") ?? null,
            correlationId: parsed.idempotencyKey,
            automationRunId: null,
            providerEventId: null,
          },
        );
        return {
          tenantId,
          projectId,
          assignmentId: assignmentReference.id,
          status: "viewed",
        };
      });
      response.status(200).json(result);
    } catch (caught: unknown) {
      const message =
        caught instanceof Error ? caught.message : "CREW_INVITATION_FAILED";
      response.status(400).json({ error: message });
    }
  },
);
