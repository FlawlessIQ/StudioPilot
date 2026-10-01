import { z } from "zod";
import { REASON_MIN, consoleHandler, fail } from "../command-kit.js";

/**
 * Support sessions: explicit, reasoned, time-bounded, revocable. A grant is
 * authorization context for supportTenantSummary, never impersonation
 * (docs/security.md).
 */
export const supportHandlers = {
  grantSupportAccess: consoleHandler({
    capability: "support.session",
    input: z.object({
      tenantId: z.string().min(1).max(200),
      reason: z.string().trim().min(REASON_MIN).max(1000),
      durationMinutes: z.number().int().min(5).max(60),
    }),
    async run({ db, identity, now }, input) {
      const tenant = await db.doc(`tenants/${input.tenantId}`).get();
      if (!tenant.exists) fail("TENANT_NOT_FOUND");
      const id = `support_${input.tenantId}_${Date.now()}`;
      const expiresAt = new Date(Date.now() + input.durationMinutes * 60_000).toISOString();
      const studioName =
        [tenant.get("brandName"), tenant.get("businessName"), tenant.get("legalName")].find(
          (value): value is string => typeof value === "string" && value.trim().length > 0,
        ) ?? input.tenantId;
      await db.doc(`supportAccess/${id}`).create({
        id,
        tenantId: input.tenantId,
        studioName,
        platformUserId: identity.uid,
        platformUserEmail: identity.email ?? null,
        reason: input.reason,
        durationMinutes: input.durationMinutes,
        status: "active",
        expiresAt,
        revokedAt: null,
        viewCount: 0,
        createdAt: now,
        updatedAt: now,
        createdBy: identity.uid,
        updatedBy: identity.uid,
      });
      return {
        result: { tenantId: input.tenantId, supportAccessId: id, expiresAt },
        audit: { tenantId: input.tenantId, entityType: "support_access", entityId: id, after: { expiresAt, durationMinutes: input.durationMinutes }, reason: input.reason },
      };
    },
  }),

  revokeSupportAccess: consoleHandler({
    capability: "support.session",
    input: z.object({ supportAccessId: z.string().min(1).max(300), reason: z.string().trim().min(REASON_MIN).max(1000) }),
    async run({ db, identity, now }, input) {
      const reference = db.doc(`supportAccess/${input.supportAccessId}`);
      const access = await reference.get();
      if (!access.exists || access.get("status") !== "active") fail("SUPPORT_ACCESS_NOT_ACTIVE");
      await reference.update({
        status: "revoked",
        revokedAt: now,
        revokedBy: identity.uid,
        revocationReason: input.reason,
        updatedAt: now,
        updatedBy: identity.uid,
      });
      return {
        result: { tenantId: String(access.get("tenantId")), supportAccessId: input.supportAccessId, status: "revoked" },
        audit: { tenantId: String(access.get("tenantId")), entityType: "support_access", entityId: input.supportAccessId, before: { status: "active" }, after: { status: "revoked" }, reason: input.reason },
      };
    },
  }),
};
