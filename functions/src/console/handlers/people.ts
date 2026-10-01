import { z } from "zod";
import { appActionUrl, tenantForAccount } from "../../auth/emails.js";
import { REASON_MIN, consoleHandler, fail } from "../command-kit.js";
import { CONSOLE_ROLES, roleFromClaims } from "../roles.js";

/**
 * Account actions on a person (docs/console.md, "People"). Firebase Auth is
 * the record; each action is the same one the person could trigger
 * themselves, done for them, and audited.
 */
const uid = z.string().min(1).max(200);

async function accountTenant(userId: string, email: string): Promise<string> {
  try {
    return await tenantForAccount(userId, email);
  } catch {
    return "platform";
  }
}

export const peopleHandlers = {
  /** Emails the person a password reset link, exactly as "Forgot password" does. */
  sendPasswordReset: consoleHandler({
    capability: "people.support",
    input: z.object({ uid }),
    async run({ db, auth, now }, input) {
      const user = await auth.getUser(input.uid).catch(() => null);
      if (!user) fail("PERSON_NOT_FOUND");
      if (!user.email) fail("PERSON_HAS_NO_EMAIL");
      const generated = await auth.generatePasswordResetLink(user.email, {
        url: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://studio-cue.com"}/auth/login`,
        handleCodeInApp: true,
      });
      const tenantId = await accountTenant(user.uid, user.email);
      const jobId = `console_password_reset_${user.uid}_${Date.now()}`;
      await db.doc(`emailJobs/${jobId}`).create({
        id: jobId,
        tenantId,
        projectId: null,
        type: "password_reset",
        recipient: user.email,
        recipientName: user.displayName ?? null,
        actionUrl: appActionUrl(generated, "/auth/reset-password"),
        status: "queued",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      });
      return { result: { uid: user.uid, sent: true }, audit: { tenantId, entityType: "person", entityId: user.uid, after: { passwordResetSent: true } } };
    },
  }),

  resendVerification: consoleHandler({
    capability: "people.support",
    input: z.object({ uid }),
    async run({ db, auth, now }, input) {
      const user = await auth.getUser(input.uid).catch(() => null);
      if (!user) fail("PERSON_NOT_FOUND");
      if (!user.email) fail("PERSON_HAS_NO_EMAIL");
      if (user.emailVerified) fail("EMAIL_ALREADY_VERIFIED");
      const generated = await auth.generateEmailVerificationLink(user.email, {
        url: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://studio-cue.com"}/auth/login`,
        handleCodeInApp: true,
      });
      const tenantId = await accountTenant(user.uid, user.email);
      const jobId = `console_verification_${user.uid}_${Date.now()}`;
      await db.doc(`emailJobs/${jobId}`).create({
        id: jobId,
        tenantId,
        projectId: null,
        type: "email_verification",
        recipient: user.email,
        recipientName: user.displayName ?? null,
        actionUrl: appActionUrl(generated, "/auth/verify-email"),
        status: "queued",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      });
      return { result: { uid: user.uid, sent: true }, audit: { tenantId, entityType: "person", entityId: user.uid, after: { verificationSent: true } } };
    },
  }),

  /** Signs the person out everywhere; their next request asks them to sign in. */
  revokeSessions: consoleHandler({
    capability: "people.manage",
    input: z.object({ uid, reason: z.string().trim().min(REASON_MIN).max(1000) }),
    async run({ auth, identity }, input) {
      if (input.uid === identity.uid) fail("CANNOT_TARGET_YOURSELF");
      await auth.revokeRefreshTokens(input.uid);
      return { result: { uid: input.uid, revoked: true }, audit: { tenantId: null, entityType: "person", entityId: input.uid, after: { sessionsRevoked: true }, reason: input.reason } };
    },
  }),

  setPersonDisabled: consoleHandler({
    capability: "people.manage",
    input: z.object({ uid, disabled: z.boolean(), reason: z.string().trim().min(REASON_MIN).max(1000) }),
    async run({ db, auth, identity, now }, input) {
      if (input.uid === identity.uid) fail("CANNOT_TARGET_YOURSELF");
      const user = await auth.getUser(input.uid).catch(() => null);
      if (!user) fail("PERSON_NOT_FOUND");
      if (roleFromClaims(user.customClaims ?? null) === "owner") fail("CANNOT_DISABLE_OWNER");
      await auth.updateUser(input.uid, { disabled: input.disabled });
      if (input.disabled) await auth.revokeRefreshTokens(input.uid);
      await db.doc(`consolePeople/${input.uid}`).set({ disabled: input.disabled, refreshedAt: now }, { merge: true });
      return {
        result: { uid: input.uid, disabled: input.disabled },
        audit: { tenantId: null, entityType: "person", entityId: input.uid, before: { disabled: user.disabled }, after: { disabled: input.disabled }, reason: input.reason },
      };
    },
  }),

  /**
   * Grant, change or remove someone's Console role. Owner only. Claims are the
   * authority (every rule reads `platformAdmin`); `platformAdmins` mirrors
   * them for Settings. Sessions are revoked so the change applies now.
   */
  setConsoleRole: consoleHandler({
    capability: "admins.manage",
    input: z.object({
      uid: uid.optional(),
      email: z.string().email().max(320).optional(),
      role: z.enum([...CONSOLE_ROLES, "none"]),
      reason: z.string().trim().min(REASON_MIN).max(1000),
    }),
    async run({ db, auth, identity, now }, input) {
      const user = input.uid
        ? await auth.getUser(input.uid).catch(() => null)
        : input.email
          ? await auth.getUserByEmail(input.email).catch(() => null)
          : null;
      if (!user) fail("PERSON_NOT_FOUND");
      if (user.uid === identity.uid) fail("CANNOT_TARGET_YOURSELF");
      const claims = { ...(user.customClaims ?? {}) } as Record<string, unknown>;
      const before = roleFromClaims(claims);
      if (input.role === "none") {
        delete claims.platformAdmin;
        delete claims.platformRole;
      } else {
        claims.platformAdmin = true;
        claims.platformRole = input.role;
      }
      await auth.setCustomUserClaims(user.uid, claims);
      await auth.revokeRefreshTokens(user.uid);
      await db.doc(`platformAdmins/${user.uid}`).set(
        {
          id: user.uid,
          uid: user.uid,
          email: user.email ?? null,
          name: user.displayName ?? null,
          role: input.role === "none" ? null : input.role,
          active: input.role !== "none",
          updatedAt: now,
          updatedBy: identity.uid,
          syncedAt: now,
        },
        { merge: true },
      );
      await db.doc(`consolePeople/${user.uid}`).set({ consoleRole: input.role === "none" ? null : input.role, refreshedAt: now }, { merge: true });
      return {
        result: { uid: user.uid, role: input.role },
        audit: { tenantId: null, entityType: "console_admin", entityId: user.uid, before: { role: before }, after: { role: input.role === "none" ? null : input.role }, reason: input.reason },
      };
    },
  }),
};
