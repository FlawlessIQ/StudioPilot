import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { requireAppCheck, requireIdentity } from "../crm/security.js";
import { studioHubCors } from "../security/cors.js";

const input = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("preview"),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({ token: z.string().min(32).max(200) }),
  }),
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
    type: z.literal("status"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      contactId: z.string().min(1),
    }),
  }),
  z.object({
    type: z.literal("revoke"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      invitationId: z.string().min(1),
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
const safeAccentColor = (value: unknown) =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
    ? value
    : "#345c46";
const safeLogoUrl = (value: unknown) => {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
};
const maskedEmail = (value: string) => {
  const [local = "", domain = ""] = normalizeEmail(value).split("@");
  if (!domain) return "the invited email address";
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"•".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
};
const invitationIdFor = (
  tenantId: string,
  projectId: string,
  email: string,
) =>
  `client_invite_${hash(`${tenantId}:${projectId}:${email}`).slice(0, 32)}`;

export const clientInvitationCommand = onRequest(
  { cors: studioHubCors, invoker: "private" },
  async (request, response) => {
    if (request.method !== "POST") {
      response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
      return;
    }
    try {
      await requireAppCheck(request);
      const parsed = input.parse(request.body);
      const db = getFirestore();
      const now = new Date().toISOString();

      if (parsed.type === "preview") {
        const tokenHash = hash(parsed.input.token);
        const invitations = await db
          .collection("clientInvitations")
          .where("tokenHash", "==", tokenHash)
          .limit(1)
          .get();
        const invitation = invitations.docs[0];
        if (!invitation || !equalHash(String(invitation.get("tokenHash")), tokenHash)) {
          throw new Error("INVITATION_NOT_FOUND");
        }
        const tenantId = String(invitation.get("tenantId"));
        const projectId = String(invitation.get("projectId"));
        const [tenant, project] = await Promise.all([
          db.doc(`tenants/${tenantId}`).get(),
          db.doc(`projects/${projectId}`).get(),
        ]);
        if (!tenant.exists || !project.exists) {
          throw new Error("INVITATION_NOT_FOUND");
        }
        const storedStatus = String(invitation.get("status"));
        const status: "pending" | "accepted" | "expired" | "revoked" =
          storedStatus === "pending" &&
          Date.parse(String(invitation.get("expiresAt"))) <= Date.now()
            ? "expired"
            : storedStatus === "accepted"
              ? "accepted"
              : storedStatus === "revoked"
                ? "revoked"
                : storedStatus === "pending"
                  ? "pending"
                  : "expired";
        response.status(200).json({
          status,
          expiresAt: String(invitation.get("expiresAt")),
          studioName: String(
            tenant.get("brandName") ??
              tenant.get("businessName") ??
              "Your photography studio",
          ),
          projectName: String(project.get("name") ?? "Your photography project"),
          eventDate:
            typeof project.get("eventDate") === "string"
              ? project.get("eventDate")
              : null,
          brandAccentColor: safeAccentColor(
            tenant.get("brandAccentColor") ??
              tenant.get("brandColors")?.primary,
          ),
          brandLogoUrl: safeLogoUrl(tenant.get("logoUrl")),
          maskedEmail: maskedEmail(String(invitation.get("normalizedEmail") ?? "")),
        });
        return;
      }

      const identity = await requireIdentity(request);

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
            !equalHash(String(invitation.get("tokenHash")), tokenHash)
          ) {
            throw new Error("INVITATION_NOT_FOUND");
          }
          if (
            normalizeEmail(identity.email as string) !==
            String(invitation.get("normalizedEmail"))
          ) {
            throw new Error("INVITED_EMAIL_MISMATCH");
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
      const activeOperator =
        membership.exists &&
        membership.get("status") === "active" &&
        ["studio_owner", "studio_admin", "studio_coordinator"].includes(role);
      const mayAccessProject = (projectId: string) =>
        ["studio_owner", "studio_admin"].includes(role) ||
        (role === "studio_coordinator" &&
          Array.isArray(assignedProjects) &&
          assignedProjects.includes(projectId));
      if (!activeOperator) throw new Error("FORBIDDEN");

      if (parsed.type === "status") {
        const contact = await db
          .doc(`contacts/${parsed.input.contactId}`)
          .get();
        if (
          !contact.exists ||
          contact.get("tenantId") !== parsed.tenantId
        ) {
          throw new Error("CLIENT_NOT_FOUND");
        }
        const projectIds = Array.isArray(contact.get("projectIds"))
          ? (contact.get("projectIds") as unknown[]).filter(
              (value): value is string =>
                typeof value === "string" && mayAccessProject(value),
            )
          : [];
        const email = normalizeEmail(String(contact.get("email") ?? ""));
        const references = projectIds.map((projectId) =>
          db.doc(
            `clientInvitations/${invitationIdFor(parsed.tenantId, projectId, email)}`,
          ),
        );
        const invitationDocuments = references.length
          ? await db.getAll(...references)
          : [];
        const invitations = await Promise.all(
          invitationDocuments
            .filter((invitation) => invitation.exists)
            .map(async (invitation) => {
              const latestEmailJobId = invitation.get("latestEmailJobId");
              const emailJob =
                typeof latestEmailJobId === "string"
                  ? await db.doc(`emailJobs/${latestEmailJobId}`).get()
                  : null;
              return {
                invitationId: invitation.id,
                projectId: String(invitation.get("projectId")),
                status: String(invitation.get("status")),
                expiresAt: String(invitation.get("expiresAt")),
                lastSentAt:
                  invitation.get("lastSentAt") ??
                  invitation.get("createdAt") ??
                  null,
                sendCount: Number(invitation.get("sendCount") ?? 1),
                deliveryStatus: emailJob?.get("deliveryStatus") ?? null,
                emailJobStatus: emailJob?.get("status") ?? null,
              };
            }),
        );
        response.status(200).json({ invitations });
        return;
      }

      if (parsed.type === "revoke") {
        const reference = db.doc(
          `clientInvitations/${parsed.input.invitationId}`,
        );
        const invitation = await reference.get();
        const projectId = String(invitation.get("projectId") ?? "");
        if (
          !invitation.exists ||
          invitation.get("tenantId") !== parsed.tenantId ||
          invitation.get("status") !== "pending" ||
          !mayAccessProject(projectId)
        ) {
          throw new Error("INVITATION_NOT_REVOCABLE");
        }
        const batch = db.batch();
        batch.update(reference, {
          status: "revoked",
          revokedAt: now,
          updatedAt: now,
          updatedBy: identity.uid,
        });
        batch.create(db.collection("auditEvents").doc(), {
          tenantId: parsed.tenantId,
          projectId,
          actorId: identity.uid,
          actorType: "user",
          action: "client.invitation_revoked",
          entityType: "client_invitation",
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
        await batch.commit();
        response
          .status(200)
          .json({ invitationId: reference.id, status: "revoked" });
        return;
      }

      if (!mayAccessProject(parsed.input.projectId))
        throw new Error("FORBIDDEN");
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
      const invitationId = invitationIdFor(
        parsed.tenantId,
        parsed.input.projectId,
        email,
      );
      const reference = db.doc(`clientInvitations/${invitationId}`);
      const existing = await reference.get();
      const isResend =
        existing.exists && existing.get("status") === "pending";
      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
      const appUrl =
        process.env.NEXT_PUBLIC_APP_URL ?? "https://studiohub.app";
      const inviteUrl = `${appUrl}/auth/client-invite?token=${encodeURIComponent(token)}`;
      const emailJobId = `client_invite_${invitationId}_${Date.now()}`;
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
        lastSentAt: now,
        sendCount: Number(existing.get("sendCount") ?? 0) + 1,
        latestEmailJobId: emailJobId,
        createdAt: existing.get("createdAt") ?? now,
        updatedAt: now,
        createdBy: existing.get("createdBy") ?? identity.uid,
        updatedBy: identity.uid,
        archivedAt: null,
      });
      batch.create(
        db.doc(`emailJobs/${emailJobId}`),
        {
          id: emailJobId,
          tenantId: parsed.tenantId,
          projectId: parsed.input.projectId,
          contactId: parsed.input.contactId,
          type: "client_invitation",
          invitationId,
          recipient: email,
          recipientName: String(
            contact.get("displayName") ??
              `${contact.get("firstName") ?? ""} ${contact.get("lastName") ?? ""}`,
          ).trim(),
          projectName: String(project.get("name") ?? ""),
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
        action: isResend ? "client.invitation_resent" : "client.invited",
        entityType: "client_invitation",
        entityId: invitationId,
        timestamp: now,
        before: isResend ? { status: "pending" } : null,
        after: {
          email,
          expiresAt,
          deliveryStatus: "queued",
          sendCount: Number(existing.get("sendCount") ?? 0) + 1,
        },
        ipAddress: request.ip ?? null,
        userAgent: request.get("user-agent") ?? null,
        correlationId: parsed.idempotencyKey,
        automationRunId: null,
        providerEventId: null,
      });
      await batch.commit();
      response.status(200).json({
        invitationId,
        email,
        expiresAt,
        status: "pending",
        deliveryStatus: "queued",
        resent: isResend,
      });
    } catch (caught: unknown) {
      const message =
        caught instanceof Error ? caught.message : "CLIENT_INVITATION_FAILED";
      const status = message === "INVITATION_NOT_FOUND"
        ? 404
        : ["AUTHENTICATION_REQUIRED", "VERIFIED_EMAIL_REQUIRED"].includes(message)
          ? 401
          : ["FORBIDDEN", "INVITED_EMAIL_MISMATCH"].includes(message)
            ? 403
            : 400;
      response.status(status).json({ error: message });
    }
  },
);
