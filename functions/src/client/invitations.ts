import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { requireAppCheck, requireIdentity } from "../crm/security.js";
import { studioHubCors } from "../security/cors.js";

const input = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("invite"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      contactId: z.string().min(1),
      projectId: z.string().min(1),
    }),
  }),
  z.object({
    type: z.literal("accept"),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({ token: z.string().min(32).max(200) }),
  }),
]);
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const equalHash = (left: string, right: string) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};
const normalizeEmail = (value: string) => value.trim().toLowerCase();

export const clientInvitationCommand = onRequest(
  { cors: studioHubCors, invoker: "private" },
  async (request, response) => {
    if (request.method !== "POST") {
      response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
      return;
    }
    try {
      await requireAppCheck(request);
      const identity = await requireIdentity(request);
      const parsed = input.parse(request.body);
      const db = getFirestore();
      const now = new Date().toISOString();

      if (parsed.type === "accept") {
        if (
          identity.email_verified !== true ||
          typeof identity.email !== "string"
        ) {
          throw new Error("VERIFIED_EMAIL_REQUIRED");
        }
        const tokenHash = hash(parsed.input.token);
        const invitations = await db
          .collection("clientInvitations")
          .where("tokenHash", "==", tokenHash)
          .limit(1)
          .get();
        const invitationReference = invitations.docs[0]?.ref;
        if (!invitationReference) throw new Error("INVITATION_NOT_FOUND");
        const result = await db.runTransaction(async (transaction) => {
          const invitation = await transaction.get(invitationReference);
          if (
            !invitation.exists ||
            !equalHash(String(invitation.get("tokenHash")), tokenHash) ||
            normalizeEmail(identity.email as string) !==
              String(invitation.get("normalizedEmail"))
          ) {
            throw new Error("INVITATION_NOT_FOUND");
          }
          if (invitation.get("status") === "accepted") {
            if (invitation.get("acceptedBy") !== identity.uid)
              throw new Error("INVITATION_ALREADY_USED");
            return {
              tenantId: invitation.get("tenantId"),
              projectId: invitation.get("projectId"),
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
          const projectId = String(invitation.get("projectId"));
          const contactId = String(invitation.get("contactId"));
          const contactReference = db.doc(`contacts/${contactId}`);
          const membershipReference = db.doc(
            `memberships/${tenantId}_${identity.uid}`,
          );
          const [contact, membership] = await Promise.all([
            transaction.get(contactReference),
            transaction.get(membershipReference),
          ]);
          if (
            !contact.exists ||
            contact.get("tenantId") !== tenantId ||
            normalizeEmail(String(contact.get("email"))) !==
              normalizeEmail(identity.email as string)
          ) {
            throw new Error("INVITED_EMAIL_MISMATCH");
          }
          if (
            contact.get("portalUserId") &&
            contact.get("portalUserId") !== identity.uid
          ) {
            throw new Error("CLIENT_ALREADY_LINKED");
          }
          if (
            membership.exists &&
            membership.get("role") !== "client"
          ) {
            throw new Error("MEMBERSHIP_ROLE_CONFLICT");
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
              email: normalizeEmail(identity.email as string),
              displayName: String(identity.name ?? contact.get("displayName")),
              role: "client",
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
              email: normalizeEmail(identity.email as string),
              displayName: String(identity.name ?? contact.get("displayName")),
              emailVerified: true,
              photoUrl: identity.picture ?? null,
              phone: contact.get("phone") ?? null,
              lastLoginAt: now,
              createdAt: now,
              updatedAt: now,
              createdBy: identity.uid,
              updatedBy: identity.uid,
              archivedAt: null,
            },
            { merge: true },
          );
          transaction.update(contactReference, {
            portalUserId: identity.uid,
            updatedAt: now,
            updatedBy: identity.uid,
          });
          transaction.update(invitationReference, {
            status: "accepted",
            acceptedAt: now,
            acceptedBy: identity.uid,
            updatedAt: now,
            updatedBy: identity.uid,
          });
          transaction.create(
            db.doc(`auditEvents/client_invite_accept_${invitationReference.id}`),
            {
              id: `client_invite_accept_${invitationReference.id}`,
              tenantId,
              projectId,
              actorId: identity.uid,
              actorType: "client",
              action: "client.portal_activated",
              entityType: "contact",
              entityId: contactId,
              timestamp: now,
              before: { portalUserId: contact.get("portalUserId") ?? null },
              after: { portalUserId: identity.uid },
              ipAddress: request.ip ?? null,
              userAgent: request.get("user-agent") ?? null,
              correlationId: parsed.idempotencyKey,
              automationRunId: null,
              providerEventId: null,
            },
          );
          return { tenantId, projectId, status: "active" };
        });
        response.status(200).json(result);
        return;
      }

      const membership = await db
        .doc(`memberships/${parsed.tenantId}_${identity.uid}`)
        .get();
      const role = String(membership.get("role"));
      const assignedProjects = membership.get("projectIds");
      const mayInvite =
        membership.exists &&
        membership.get("status") === "active" &&
        (["studio_owner", "studio_admin"].includes(role) ||
          (role === "studio_coordinator" &&
            Array.isArray(assignedProjects) &&
            assignedProjects.includes(parsed.input.projectId)));
      if (!mayInvite) throw new Error("FORBIDDEN");
      const [contact, project] = await Promise.all([
        db.doc(`contacts/${parsed.input.contactId}`).get(),
        db.doc(`projects/${parsed.input.projectId}`).get(),
      ]);
      if (
        !contact.exists ||
        contact.get("tenantId") !== parsed.tenantId ||
        !project.exists ||
        project.get("tenantId") !== parsed.tenantId
      ) {
        throw new Error("CLIENT_OR_PROJECT_NOT_FOUND");
      }
      const contactProjects = contact.get("projectIds");
      if (
        !Array.isArray(contactProjects) ||
        !contactProjects.includes(parsed.input.projectId)
      ) {
        throw new Error("CLIENT_NOT_ASSOCIATED_WITH_PROJECT");
      }
      const email = normalizeEmail(String(contact.get("email") ?? ""));
      if (!z.string().email().safeParse(email).success)
        throw new Error("CLIENT_EMAIL_REQUIRED");
      const invitationId = `client_invite_${hash(
        `${parsed.tenantId}:${parsed.input.projectId}:${email}`,
      ).slice(0, 32)}`;
      const reference = db.doc(`clientInvitations/${invitationId}`);
      const existing = await reference.get();
      if (
        existing.exists &&
        existing.get("status") === "pending" &&
        Date.parse(String(existing.get("expiresAt"))) > Date.now()
      ) {
        throw new Error("INVITATION_ALREADY_PENDING");
      }
      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
      const appUrl =
        process.env.NEXT_PUBLIC_APP_URL ?? "https://studiohub.app";
      const inviteUrl = `${appUrl}/auth/client-invite?token=${encodeURIComponent(token)}`;
      const batch = db.batch();
      batch.set(reference, {
        id: invitationId,
        tenantId: parsed.tenantId,
        projectId: parsed.input.projectId,
        contactId: parsed.input.contactId,
        email,
        normalizedEmail: email,
        status: "pending",
        tokenHash: hash(token),
        expiresAt,
        acceptedAt: null,
        acceptedBy: null,
        revokedAt: null,
        createdAt: existing.get("createdAt") ?? now,
        updatedAt: now,
        createdBy: existing.get("createdBy") ?? identity.uid,
        updatedBy: identity.uid,
        archivedAt: null,
      });
      batch.create(
        db.doc(`emailJobs/client_invite_${invitationId}_${Date.now()}`),
        {
          tenantId: parsed.tenantId,
          projectId: parsed.input.projectId,
          type: "client_invitation",
          invitationId,
          recipient: email,
          inviteUrl,
          status: "queued",
          attempts: 0,
          createdAt: now,
          updatedAt: now,
        },
      );
      batch.create(db.collection("auditEvents").doc(), {
        tenantId: parsed.tenantId,
        projectId: parsed.input.projectId,
        actorId: identity.uid,
        actorType: "user",
        action: "client.invited",
        entityType: "client_invitation",
        entityId: invitationId,
        timestamp: now,
        before: null,
        after: { email, expiresAt },
        ipAddress: request.ip ?? null,
        userAgent: request.get("user-agent") ?? null,
        correlationId: parsed.idempotencyKey,
        automationRunId: null,
        providerEventId: null,
      });
      await batch.commit();
      response
        .status(200)
        .json({ invitationId, inviteUrl, email, expiresAt });
    } catch (caught: unknown) {
      const message =
        caught instanceof Error ? caught.message : "CLIENT_INVITATION_FAILED";
      response.status(400).json({ error: message });
    }
  },
);
