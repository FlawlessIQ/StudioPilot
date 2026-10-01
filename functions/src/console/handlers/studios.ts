import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { REASON_MIN, consoleHandler, fail } from "../command-kit.js";
import { refreshAllSummaries, refreshStudioSummary } from "../rollup.js";

const tenantId = z.string().min(1).max(200);

/** Matches what a person typed against the studio's name, forgivingly. */
export function confirmsName(typed: string, names: Array<unknown>): boolean {
  const clean = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
  return names.some((name) => typeof name === "string" && name.trim() && clean(name) === clean(typed));
}

export const studioHandlers = {
  /**
   * Suspend a studio. Recorded on the subscription as well as the tenant,
   * because the subscription is what requireActiveSubscription already reads
   * on every studio command — one place, no extra read per request. Couples'
   * and crew portals stay up (decision 5, docs/console.md): a suspension must
   * not strand a wedding.
   */
  suspendTenant: consoleHandler({
    capability: "studios.suspend",
    input: z.object({ tenantId, reason: z.string().trim().min(REASON_MIN).max(1000), confirmName: z.string().trim().min(1) }),
    async run({ db, identity, now }, input) {
      const tenantReference = db.doc(`tenants/${input.tenantId}`);
      const tenant = await tenantReference.get();
      if (!tenant.exists) fail("TENANT_NOT_FOUND");
      if (!confirmsName(input.confirmName, [tenant.get("brandName"), tenant.get("businessName"), tenant.get("legalName")]))
        fail("CONFIRMATION_NAME_MISMATCH");
      if (tenant.get("status") === "suspended") fail("ALREADY_SUSPENDED");
      const batch = db.batch();
      batch.update(tenantReference, {
        status: "suspended",
        statusBeforeSuspension: tenant.get("status") ?? "active",
        suspensionReason: input.reason,
        suspendedAt: now,
        suspendedBy: identity.uid,
        updatedAt: now,
        updatedBy: identity.uid,
      });
      batch.set(db.doc(`subscriptions/${input.tenantId}`), { suspendedAt: now, updatedAt: now }, { merge: true });
      batch.set(db.doc(`consoleStudios/${input.tenantId}`), { suspended: true, lifecycle: "suspended", suspensionReason: input.reason }, { merge: true });
      await batch.commit();
      return {
        result: { tenantId: input.tenantId, status: "suspended" },
        audit: { tenantId: input.tenantId, entityType: "tenant", entityId: input.tenantId, before: { status: tenant.get("status") ?? null }, after: { status: "suspended" }, reason: input.reason },
      };
    },
  }),

  unsuspendTenant: consoleHandler({
    capability: "studios.suspend",
    input: z.object({ tenantId, reason: z.string().trim().min(REASON_MIN).max(1000) }),
    async run({ db, auth, identity, now }, input) {
      const tenantReference = db.doc(`tenants/${input.tenantId}`);
      const tenant = await tenantReference.get();
      if (!tenant.exists) fail("TENANT_NOT_FOUND");
      if (tenant.get("status") !== "suspended") fail("NOT_SUSPENDED");
      const restored = String(tenant.get("statusBeforeSuspension") ?? "active");
      const batch = db.batch();
      batch.update(tenantReference, {
        status: restored === "suspended" ? "active" : restored,
        statusBeforeSuspension: FieldValue.delete(),
        suspensionReason: null,
        suspendedAt: null,
        updatedAt: now,
        updatedBy: identity.uid,
      });
      batch.set(db.doc(`subscriptions/${input.tenantId}`), { suspendedAt: null, updatedAt: now }, { merge: true });
      await batch.commit();
      await refreshStudioSummary(db, auth, input.tenantId);
      return {
        result: { tenantId: input.tenantId, status: restored },
        audit: { tenantId: input.tenantId, entityType: "tenant", entityId: input.tenantId, before: { status: "suspended" }, after: { status: restored }, reason: input.reason },
      };
    },
  }),

  /**
   * A platform admin who created a studio and lost their own owner
   * membership can restore it. Only their own, only on a studio they created.
   */
  repairOwnerMembership: consoleHandler({
    capability: "console.read",
    input: z.object({ tenantId }),
    async run({ db, identity, now }, input) {
      const tenantReference = db.doc(`tenants/${input.tenantId}`);
      const membershipReference = db.doc(`memberships/${input.tenantId}_${identity.uid}`);
      const [tenant, membership] = await Promise.all([tenantReference.get(), membershipReference.get()]);
      if (!tenant.exists) fail("TENANT_NOT_FOUND");
      if (tenant.get("createdBy") !== identity.uid) fail("OWNER_RECOVERY_NOT_ALLOWED");
      let repaired = false;
      if (membership.exists) {
        if (membership.get("tenantId") !== input.tenantId || membership.get("userId") !== identity.uid)
          fail("MEMBERSHIP_IDENTITY_MISMATCH");
        if (membership.get("role") !== "studio_owner" || membership.get("status") !== "active")
          fail("MEMBERSHIP_REQUIRES_MANUAL_REVIEW");
      } else {
        await membershipReference.create({
          id: membershipReference.id,
          tenantId: input.tenantId,
          userId: identity.uid,
          role: "studio_owner",
          explicitPermissions: [],
          projectIds: [],
          status: "active",
          recoverySource: "platform_owner_self_recovery",
          createdAt: now,
          updatedAt: now,
          createdBy: identity.uid,
          updatedBy: identity.uid,
          archivedAt: null,
        });
        repaired = true;
      }
      return {
        result: { tenantId: input.tenantId, membershipId: membershipReference.id, repaired },
        audit: { tenantId: input.tenantId, entityType: "membership", entityId: membershipReference.id, after: { repaired } },
      };
    },
  }),

  refreshStudio: consoleHandler({
    capability: "console.read",
    input: z.object({ tenantId }),
    async run({ db, auth }, input) {
      const summary = await refreshStudioSummary(db, auth, input.tenantId);
      if (!summary) fail("TENANT_NOT_FOUND");
      return {
        result: { tenantId: input.tenantId, refreshedAt: summary.refreshedAt },
        audit: { tenantId: input.tenantId, entityType: "console_summary", entityId: input.tenantId },
      };
    },
  }),

  refreshAll: consoleHandler({
    capability: "console.read",
    input: z.object({}).optional(),
    async run({ db, auth }) {
      const outcome = await refreshAllSummaries(db, auth);
      return {
        result: outcome,
        audit: { tenantId: null, entityType: "console_summary", entityId: "all", after: outcome },
      };
    },
  }),
};
