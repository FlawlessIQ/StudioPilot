import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { requireAppCheck, requireIdentity } from "../crm/security.js";
import { studioHubCors } from "../security/cors.js";

const triggerSetting = z.object({
  enabled: z.boolean(),
  offsetDays: z.number().int().min(-365).max(0),
  autoSend: z.boolean(),
});

const inputSchema = z.object({
  tenantId: z.string().min(1),
  settings: z.object({
    schedule_confirmation: triggerSetting,
    final_invoice_notice: triggerSetting,
    day_before_checklist: triggerSetting,
  }),
});

/**
 * Lifecycle messaging settings — including the trust dial.
 *
 * Owner-only and audited: switching a deterministic lifecycle message to
 * auto-send is an explicit business decision, so it is recorded with a
 * before/after audit event. AI-personalized drafts are unaffected — they
 * always require per-message review.
 */
export const lifecycleSettingsCommand = onRequest(
  { cors: studioHubCors, invoker: "private" },
  async (request, response) => {
    if (request.method !== "POST") {
      response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
      return;
    }
    try {
      await requireAppCheck(request);
      const identity = await requireIdentity(request);
      const input = inputSchema.parse(request.body);
      const db = getFirestore();
      const membership = await db
        .doc(`memberships/${input.tenantId}_${identity.uid}`)
        .get();
      if (
        !membership.exists ||
        membership.get("status") !== "active" ||
        membership.get("role") !== "studio_owner"
      )
        throw new Error("FORBIDDEN");
      const tenantReference = db.doc(`tenants/${input.tenantId}`);
      const tenant = await tenantReference.get();
      if (!tenant.exists) throw new Error("TENANT_NOT_FOUND");
      const now = new Date().toISOString();
      const before = tenant.get("lifecycleMessaging") ?? null;
      const auditReference = db.collection("auditEvents").doc();
      const batch = db.batch();
      batch.update(tenantReference, {
        lifecycleMessaging: input.settings,
        updatedAt: now,
        updatedBy: identity.uid,
      });
      batch.create(auditReference, {
        id: auditReference.id,
        tenantId: input.tenantId,
        projectId: null,
        actorId: identity.uid,
        actorType: "user",
        action: "tenant.lifecycle_messaging_updated",
        entityType: "tenant",
        entityId: input.tenantId,
        timestamp: now,
        before,
        after: input.settings,
        ipAddress: request.ip ?? null,
        userAgent: request.get("user-agent") ?? null,
        correlationId: auditReference.id,
        automationRunId: null,
        providerEventId: null,
      });
      await batch.commit();
      response
        .status(200)
        .json({ tenantId: input.tenantId, settings: input.settings });
    } catch (caught: unknown) {
      const message =
        caught instanceof z.ZodError
          ? "INVALID_REQUEST"
          : caught instanceof Error
            ? caught.message
            : "LIFECYCLE_SETTINGS_FAILED";
      response
        .status(message === "FORBIDDEN" ? 403 : 400)
        .json({ error: message.split(":")[0] });
    }
  },
);
