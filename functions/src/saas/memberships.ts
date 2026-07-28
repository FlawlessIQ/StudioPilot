import {
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { requireAppCheck, requireIdentity } from "../crm/security.js";
import { studioHubCors } from "../security/cors.js";

const internalRole = z.enum([
  "studio_admin",
  "studio_coordinator",
  "staff_photographer",
]);
const command = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("inviteMember"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8),
    input: z.object({
      email: z.string().email(),
      displayName: z.string().trim().min(2).max(120),
      role: internalRole,
    }),
  }),
  z.object({
    type: z.literal("revokeInvitation"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8),
    input: z.object({ invitationId: z.string().min(1) }),
  }),
  z.object({
    type: z.literal("updateMember"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8),
    input: z.object({
      membershipId: z.string().min(1),
      role: internalRole.optional(),
      status: z.enum(["active", "suspended", "revoked"]).optional(),
      reason: z.string().trim().min(10).max(1000),
    }),
  }),
  z.object({
    type: z.literal("acceptInvitation"),
    idempotencyKey: z.string().min(8),
    input: z.object({ token: z.string().min(32).max(200) }),
  }),
]);

const internalRoles = new Set([
  "studio_owner",
  "studio_admin",
  "studio_coordinator",
  "staff_photographer",
]);
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const normalizedEmail = (value: string) => value.trim().toLowerCase();
const equalHash = (left: string, right: string) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

async function ownerMembership(tenantId: string, userId: string) {
  const membership = await getFirestore()
    .doc(`memberships/${tenantId}_${userId}`)
    .get();
  if (
    !membership.exists ||
    membership.get("status") !== "active" ||
    membership.get("role") !== "studio_owner"
  ) {
    throw new Error("FORBIDDEN");
  }
  return membership;
}

export const membershipCommand = onRequest(
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
      const parsed = command.parse(request.body);
      const db = getFirestore();
      const now = new Date().toISOString();

      if (parsed.type === "acceptInvitation") {
        if (
          identity.email_verified !== true ||
          typeof identity.email !== "string"
        ) {
          throw new Error("VERIFIED_EMAIL_REQUIRED");
        }
        const identityEmail = identity.email;
        const tokenHash = hash(parsed.input.token);
        const invitations = await db
          .collection("tenantInvitations")
          .where("tokenHash", "==", tokenHash)
          .limit(1)
          .get();
        const invitationReference = invitations.docs[0]?.ref;
        if (!invitationReference) throw new Error("INVITATION_NOT_FOUND");
        const result = await db.runTransaction(async (transaction) => {
          const invitation = await transaction.get(invitationReference);
          if (!invitation.exists) throw new Error("INVITATION_NOT_FOUND");
          if (
            !equalHash(String(invitation.get("tokenHash")), tokenHash) ||
            normalizedEmail(String(identity.email)) !==
              String(invitation.get("normalizedEmail"))
          ) {
            throw new Error("INVITATION_NOT_FOUND");
          }
          if (invitation.get("status") === "accepted") {
            if (invitation.get("acceptedBy") !== identity.uid)
              throw new Error("INVITATION_ALREADY_USED");
            return {
              tenantId: String(invitation.get("tenantId")),
              role: String(invitation.get("role")),
              status: "active",
            };
          }
          if (
            invitation.get("status") !== "pending" ||
            Date.parse(String(invitation.get("expiresAt"))) <= Date.now()
          ) {
            throw new Error("INVITATION_EXPIRED");
          }
          const tenantId = String(invitation.get("tenantId"));
          const role = String(invitation.get("role"));
          if (!internalRoles.has(role) || role === "studio_owner")
            throw new Error("INVALID_INVITATION_ROLE");
          const membershipReference = db.doc(
            `memberships/${tenantId}_${identity.uid}`,
          );
          const subscriptionReference = db.doc(`subscriptions/${tenantId}`);
          const [membership, subscription] = await Promise.all([
            transaction.get(membershipReference),
            transaction.get(subscriptionReference),
          ]);
          const wasActive =
            membership.exists && membership.get("status") === "active";
          transaction.set(
            membershipReference,
            {
              id: membershipReference.id,
              tenantId,
              userId: identity.uid,
              email: normalizedEmail(identityEmail),
              displayName: String(
                identity.name ?? invitation.get("displayName"),
              ),
              role,
              explicitPermissions: [],
              projectIds: [],
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
              email: normalizedEmail(identityEmail),
              displayName: String(
                identity.name ?? invitation.get("displayName"),
              ),
              emailVerified: true,
              photoUrl: identity.picture ?? null,
              phone: null,
              lastLoginAt: now,
              createdAt: now,
              updatedAt: now,
              createdBy: identity.uid,
              updatedBy: identity.uid,
              archivedAt: null,
            },
            { merge: true },
          );
          transaction.update(invitationReference, {
            status: "accepted",
            acceptedAt: now,
            acceptedBy: identity.uid,
            updatedAt: now,
            updatedBy: identity.uid,
          });
          if (subscription.exists && !wasActive) {
            transaction.update(subscriptionReference, {
              internalUserCount:
                Number(subscription.get("internalUserCount") ?? 0) + 1,
              updatedAt: now,
              updatedBy: identity.uid,
            });
          }
          transaction.create(
            db.doc(`auditEvents/member_accept_${invitationReference.id}`),
            {
              id: `member_accept_${invitationReference.id}`,
              tenantId,
              projectId: null,
              actorId: identity.uid,
              actorType: "user",
              action: "membership.invitation_accepted",
              entityType: "membership",
              entityId: membershipReference.id,
              timestamp: now,
              before: membership.exists ? { status: membership.get("status") } : null,
              after: { role, status: "active" },
              ipAddress: request.ip ?? null,
              userAgent: request.get("user-agent") ?? null,
              correlationId: parsed.idempotencyKey,
              automationRunId: null,
              providerEventId: null,
            },
          );
          return { tenantId, role, status: "active" };
        });
        response.status(200).json(result);
        return;
      }

      await ownerMembership(parsed.tenantId, identity.uid);
      if (parsed.type === "inviteMember") {
        const email = normalizedEmail(parsed.input.email);
        const token = randomBytes(32).toString("base64url");
        const invitationId = `invite_${hash(`${parsed.tenantId}:${email}`).slice(0, 32)}`;
        const invitationReference = db.doc(
          `tenantInvitations/${invitationId}`,
        );
        const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
        const appUrl =
          process.env.NEXT_PUBLIC_APP_URL ?? "https://studiohub.app";
        const inviteUrl = `${appUrl}/auth/invite?token=${encodeURIComponent(token)}`;
        const result = await db.runTransaction(async (transaction) => {
          const activeMembershipsQuery = db
            .collection("memberships")
            .where("tenantId", "==", parsed.tenantId)
            .where("status", "==", "active");
          const pendingInvitationsQuery = db
            .collection("tenantInvitations")
            .where("tenantId", "==", parsed.tenantId)
            .where("status", "==", "pending");
          const [
            subscription,
            activeMemberships,
            pendingInvitations,
            existingInvitation,
          ] = await Promise.all([
            transaction.get(db.doc(`subscriptions/${parsed.tenantId}`)),
            transaction.get(activeMembershipsQuery),
            transaction.get(pendingInvitationsQuery),
            transaction.get(invitationReference),
          ]);
          if (
            existingInvitation.exists &&
            existingInvitation.get("status") === "pending" &&
            Date.parse(String(existingInvitation.get("expiresAt"))) >
              Date.now()
          ) {
            throw new Error("INVITATION_ALREADY_PENDING");
          }
          const activeCount = activeMemberships.docs.filter((membership) =>
            internalRoles.has(String(membership.get("role"))),
          ).length;
          const pendingCount = pendingInvitations.docs.filter((invitation) =>
            internalRoles.has(String(invitation.get("role"))),
          ).length;
          const maximum = Number(
            subscription.get("entitlements.maxInternalUsers") ?? 1,
          );
          if (activeCount + pendingCount >= maximum)
            throw new Error("INTERNAL_USER_LIMIT_REACHED");
          transaction.set(invitationReference, {
            id: invitationId,
            tenantId: parsed.tenantId,
            email,
            normalizedEmail: email,
            displayName: parsed.input.displayName,
            role: parsed.input.role,
            projectIds: [],
            status: "pending",
            tokenHash: hash(token),
            expiresAt,
            acceptedAt: null,
            acceptedBy: null,
            revokedAt: null,
            createdAt: existingInvitation.get("createdAt") ?? now,
            updatedAt: now,
            createdBy: existingInvitation.get("createdBy") ?? identity.uid,
            updatedBy: identity.uid,
            archivedAt: null,
          });
          transaction.create(
            db.doc(`emailJobs/member_invite_${invitationId}_${Date.now()}`),
            {
              tenantId: parsed.tenantId,
              projectId: null,
              type: "staff_invitation",
              invitationId,
              recipient: email,
              inviteUrl,
              status: "queued",
              attempts: 0,
              createdAt: now,
              updatedAt: now,
            },
          );
          transaction.create(
            db.collection("auditEvents").doc(),
            {
              tenantId: parsed.tenantId,
              projectId: null,
              actorId: identity.uid,
              actorType: "user",
              action: "membership.invited",
              entityType: "tenant_invitation",
              entityId: invitationId,
              timestamp: now,
              before: null,
              after: {
                email,
                role: parsed.input.role,
                expiresAt,
              },
              ipAddress: request.ip ?? null,
              userAgent: request.get("user-agent") ?? null,
              correlationId: parsed.idempotencyKey,
              automationRunId: null,
              providerEventId: null,
            },
          );
          return {
            invitationId,
            email,
            role: parsed.input.role,
            expiresAt,
            inviteUrl,
          };
        });
        response.status(200).json(result);
        return;
      }

      if (parsed.type === "revokeInvitation") {
        const reference = db.doc(
          `tenantInvitations/${parsed.input.invitationId}`,
        );
        const invitation = await reference.get();
        if (
          !invitation.exists ||
          invitation.get("tenantId") !== parsed.tenantId ||
          invitation.get("status") !== "pending"
        ) {
          throw new Error("INVITATION_NOT_REVOCABLE");
        }
        await reference.update({
          status: "revoked",
          revokedAt: now,
          updatedAt: now,
          updatedBy: identity.uid,
        });
        await db.collection("auditEvents").add({
          tenantId: parsed.tenantId,
          projectId: null,
          actorId: identity.uid,
          actorType: "user",
          action: "membership.invitation_revoked",
          entityType: "tenant_invitation",
          entityId: reference.id,
          timestamp: now,
          before: { status: "pending" },
          after: { status: "revoked" },
          ipAddress: request.ip ?? null,
          userAgent: request.get("user-agent") ?? null,
          correlationId: parsed.idempotencyKey,
          automationRunId: null,
          providerEventId: null,
        });
        response.status(200).json({ invitationId: reference.id, status: "revoked" });
        return;
      }

      const reference = db.doc(
        `memberships/${parsed.input.membershipId}`,
      );
      const member = await reference.get();
      if (
        !member.exists ||
        member.get("tenantId") !== parsed.tenantId ||
        member.get("role") === "studio_owner" ||
        member.get("userId") === identity.uid
      ) {
        throw new Error("MEMBER_NOT_EDITABLE");
      }
      const before = {
        role: String(member.get("role")),
        status: String(member.get("status")),
      };
      const nextRole = parsed.input.role ?? before.role;
      const nextStatus = parsed.input.status ?? before.status;
      await db.runTransaction(async (transaction) => {
        const subscriptionReference = db.doc(
          `subscriptions/${parsed.tenantId}`,
        );
        const subscription = await transaction.get(subscriptionReference);
        transaction.update(reference, {
          role: nextRole,
          status: nextStatus,
          statusReason: parsed.input.reason,
          archivedAt: nextStatus === "revoked" ? now : null,
          updatedAt: now,
          updatedBy: identity.uid,
        });
        const wasActive =
          before.status === "active" && internalRoles.has(before.role);
        const isActive =
          nextStatus === "active" && internalRoles.has(nextRole);
        if (subscription.exists && wasActive !== isActive) {
          transaction.update(subscriptionReference, {
            internalUserCount: Math.max(
              1,
              Number(subscription.get("internalUserCount") ?? 1) +
                (isActive ? 1 : -1),
            ),
            updatedAt: now,
            updatedBy: identity.uid,
          });
        }
        transaction.create(db.collection("auditEvents").doc(), {
          tenantId: parsed.tenantId,
          projectId: null,
          actorId: identity.uid,
          actorType: "user",
          action: "membership.updated",
          entityType: "membership",
          entityId: reference.id,
          timestamp: now,
          before,
          after: { role: nextRole, status: nextStatus, reason: parsed.input.reason },
          ipAddress: request.ip ?? null,
          userAgent: request.get("user-agent") ?? null,
          correlationId: parsed.idempotencyKey,
          automationRunId: null,
          providerEventId: null,
        });
      });
      response.status(200).json({
        membershipId: reference.id,
        role: nextRole,
        status: nextStatus,
      });
    } catch (caught: unknown) {
      const message =
        caught instanceof Error
          ? caught.message
          : "MEMBERSHIP_COMMAND_FAILED";
      response.status(message === "FORBIDDEN" ? 403 : 400).json({ error: message });
    }
  },
);
