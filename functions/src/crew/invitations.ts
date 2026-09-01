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
      const identityEmail = normalizedEmail(identity.email);
      const now = new Date().toISOString();
      /**
       * Two kinds of invitation arrive on this one URL.
       *
       * An assignment invite offers specific work and is answered yes or no.
       * A roster invite has no job attached: the studio added somebody to
       * their directory and wants them set up before any work exists. They
       * share a token shape and a page deliberately, so a collaborator follows
       * one kind of link from the studio whichever they were sent, and so
       * there is only ever one place that turns a token into a membership.
       */
      if (!assignmentReference) {
        const profiles = await db
          .collection("crewProfiles")
          .where("inviteTokenHash", "==", tokenHash)
          .limit(1)
          .get();
        const rosterReference = profiles.docs[0]?.ref;
        if (!rosterReference) throw new Error("INVITATION_NOT_FOUND");
        const rosterResult = await db.runTransaction(async (transaction) => {
          const profile = await transaction.get(rosterReference);
          if (
            !profile.exists ||
            !equalHash(String(profile.get("inviteTokenHash")), tokenHash)
          ) {
            throw new Error("INVITATION_NOT_FOUND");
          }
          if (
            Date.parse(String(profile.get("inviteExpiresAt"))) <= Date.now()
          ) {
            throw new Error("INVITATION_EXPIRED");
          }
          if (normalizedEmail(String(profile.get("email"))) !== identityEmail)
            throw new Error("INVITED_EMAIL_MISMATCH");
          const linked = profile.get("userId");
          if (linked && linked !== identity.uid)
            throw new Error("INVITATION_ALREADY_USED");
          const tenantId = String(profile.get("tenantId"));
          const membershipReference = db.doc(
            `memberships/${tenantId}_${identity.uid}`,
          );
          const subscriptionReference = db.doc(`subscriptions/${tenantId}`);
          const [membership, subscription] = await Promise.all([
            transaction.get(membershipReference),
            transaction.get(subscriptionReference),
          ]);
          // Accepting twice is a refresh, not an error, and must not spend a
          // second seat.
          if (linked === identity.uid) {
            return {
              tenantId,
              projectId: null,
              crewProfileId: rosterReference.id,
              kind: "roster",
              status: "accepted",
            };
          }
          if (
            membership.exists &&
            String(membership.get("role")) !== "subcontractor"
          ) {
            throw new Error("MEMBERSHIP_ROLE_CONFLICT");
          }
          if (subscription.exists) {
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
              // No job yet, so no project. They see the roster side of the
              // crew workspace — profile, availability, documents — and any
              // assignment adds its own project id when it is offered.
              projectIds: Array.isArray(priorProjects) ? priorProjects : [],
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
          transaction.update(rosterReference, {
            userId: identity.uid,
            inviteStatus: "accepted",
            acceptedAt: now,
            updatedAt: now,
            updatedBy: identity.uid,
          });
          transaction.create(
            db.doc(`auditEvents/crew_roster_accept_${rosterReference.id}`),
            {
              id: `crew_roster_accept_${rosterReference.id}`,
              tenantId,
              projectId: null,
              actorId: identity.uid,
              actorType: "subcontractor",
              action: "crew.roster_invitation_accepted",
              entityType: "crewProfile",
              entityId: rosterReference.id,
              timestamp: now,
              before: { userId: profile.get("userId") ?? null },
              after: { userId: identity.uid, inviteStatus: "accepted" },
              ipAddress: request.ip ?? null,
              userAgent: request.get("user-agent") ?? null,
              correlationId: parsed.idempotencyKey,
              automationRunId: null,
              providerEventId: null,
            },
          );
          return {
            tenantId,
            projectId: null,
            crewProfileId: rosterReference.id,
            kind: "roster",
            status: "accepted",
          };
        });
        response.status(200).json(rosterResult);
        return;
      }
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
