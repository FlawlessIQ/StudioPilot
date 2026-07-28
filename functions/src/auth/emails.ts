import { createHash, randomUUID } from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import {
  requestFingerprint,
  requireAppCheck,
  requireIdentity,
} from "../crm/security.js";
import { studioHubCors } from "../security/cors.js";

const requestSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("passwordReset"),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      email: z.string().email().max(320),
      next: z.string().max(1000).nullable(),
    }),
  }),
  z.object({
    type: z.literal("emailVerification"),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      email: z.string().email().max(320),
      next: z.string().max(1000).nullable(),
    }),
  }),
]);

const normalizeEmail = (value: string) => value.trim().toLowerCase();
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

function safeNext(value: string | null): string | null {
  return value?.startsWith("/") && !value.startsWith("//") ? value : null;
}

function appActionUrl(
  generatedLink: string,
  pathname: "/auth/reset-password" | "/auth/verify-email",
  next: string | null = null,
) {
  const generated = new URL(generatedLink);
  const oobCode = generated.searchParams.get("oobCode");
  if (!oobCode) throw new Error("AUTH_ACTION_CODE_MISSING");
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://studiohub.app";
  const action = new URL(pathname, appUrl);
  action.searchParams.set("oobCode", oobCode);
  if (next) action.searchParams.set("next", next);
  return action.toString();
}

async function tenantForAccount(
  userId: string,
  email: string,
): Promise<string> {
  const db = getFirestore();
  const memberships = await getFirestore()
    .collection("memberships")
    .where("userId", "==", userId)
    .where("status", "==", "active")
    .limit(1)
    .get();
  const tenantId = memberships.docs[0]?.get("tenantId");
  if (typeof tenantId === "string" && tenantId) return tenantId;
  const invitations = await db
    .collection("clientInvitations")
    .where("normalizedEmail", "==", normalizeEmail(email))
    .limit(20)
    .get();
  const invitation = invitations.docs.find(
    (document) =>
      document.get("status") === "pending" &&
      Date.parse(String(document.get("expiresAt"))) > Date.now(),
  );
  const invitedTenantId = invitation?.get("tenantId");
  return typeof invitedTenantId === "string" && invitedTenantId
    ? invitedTenantId
    : "platform";
}

async function withinCooldown(
  key: string,
  fingerprint: string,
): Promise<boolean> {
  const db = getFirestore();
  const reference = db.doc(`authEmailRequests/${key}`);
  return db.runTransaction(async (transaction) => {
    const current = await transaction.get(reference);
    const lastRequestedAt = Date.parse(
      String(current.get("lastRequestedAt") ?? ""),
    );
    if (
      Number.isFinite(lastRequestedAt) &&
      Date.now() - lastRequestedAt < 60_000
    ) {
      return true;
    }
    const now = new Date().toISOString();
    transaction.set(
      reference,
      {
        id: key,
        fingerprint,
        lastRequestedAt: now,
        requestCount: Number(current.get("requestCount") ?? 0) + 1,
        createdAt: current.get("createdAt") ?? now,
        updatedAt: now,
      },
      { merge: true },
    );
    return false;
  });
}

export const authEmailCommand = onRequest(
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
      const parsed = requestSchema.parse(request.body);
      const email = normalizeEmail(parsed.input.email);
      const emailHash = hash(email);
      const fingerprint = requestFingerprint(request, parsed.type);
      const cooldownKey = hash(`${parsed.type}:${email}`);
      if (await withinCooldown(cooldownKey, fingerprint)) {
        response.status(202).json({ accepted: true });
        return;
      }

      let actionUrl: string;
      let tenantId: string;
      let recipientName: string | null = null;
      let templateKey: "password_reset" | "email_verification";
      if (parsed.type === "emailVerification") {
        const identity = await requireIdentity(request);
        if (
          typeof identity.email !== "string" ||
          normalizeEmail(identity.email) !== email
        ) {
          throw new Error("EMAIL_MISMATCH");
        }
        const generated = await getAuth().generateEmailVerificationLink(
          email,
          {
            url: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://studiohub.app"}/auth/login`,
            handleCodeInApp: true,
          },
        );
        actionUrl = appActionUrl(
          generated,
          "/auth/verify-email",
          safeNext(parsed.input.next),
        );
        tenantId = await tenantForAccount(identity.uid, email);
        recipientName =
          typeof identity.name === "string" ? identity.name : null;
        templateKey = "email_verification";
      } else {
        templateKey = "password_reset";
        try {
          const user = await getAuth().getUserByEmail(email);
          const generated = await getAuth().generatePasswordResetLink(email, {
            url: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://studiohub.app"}/auth/login`,
            handleCodeInApp: true,
          });
          actionUrl = appActionUrl(
            generated,
            "/auth/reset-password",
            safeNext(parsed.input.next),
          );
          tenantId = await tenantForAccount(user.uid, email);
          recipientName = user.displayName ?? null;
        } catch {
          // Do not disclose whether an account exists.
          response.status(202).json({ accepted: true });
          return;
        }
      }

      const now = new Date().toISOString();
      const db = getFirestore();
      const jobId = `auth_${templateKey}_${emailHash.slice(0, 24)}_${Date.now()}`;
      const auditId = randomUUID();
      const batch = db.batch();
      batch.create(db.doc(`emailJobs/${jobId}`), {
        id: jobId,
        tenantId,
        projectId: null,
        type: templateKey,
        recipient: email,
        recipientName,
        actionUrl,
        status: "queued",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      });
      batch.create(db.doc(`auditEvents/${auditId}`), {
        id: auditId,
        tenantId,
        projectId: null,
        actorId:
          parsed.type === "emailVerification" ? emailHash : "anonymous",
        actorType:
          parsed.type === "emailVerification" ? "user" : "anonymous",
        action:
          parsed.type === "emailVerification"
            ? "auth.verification_requested"
            : "auth.password_reset_requested",
        entityType: "auth_email",
        entityId: emailHash,
        timestamp: now,
        before: null,
        after: { queued: true, templateKey },
        ipAddress: null,
        userAgent: request.get("user-agent") ?? null,
        correlationId: parsed.idempotencyKey,
        automationRunId: null,
        providerEventId: null,
      });
      await batch.commit();
      response.status(202).json({ accepted: true });
    } catch (caught: unknown) {
      const message =
        caught instanceof Error ? caught.message : "AUTH_EMAIL_FAILED";
      const status = [
        "APP_CHECK_REQUIRED",
        "AUTHENTICATION_REQUIRED",
      ].includes(message)
        ? 401
        : 400;
      response.status(status).json({ error: message });
    }
  },
);
