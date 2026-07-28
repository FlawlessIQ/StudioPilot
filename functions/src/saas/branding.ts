import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { requireAppCheck, requireIdentity } from "../crm/security.js";
import { studioHubCors } from "../security/cors.js";

const brandingSchema = z.object({
  tenantId: z.string().min(1),
  brandName: z.string().trim().min(2).max(120),
  primaryColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/),
  logoUrl: z.union([
    z.literal(""),
    z.string().trim().url().startsWith("https://"),
  ]),
  replyTo: z.union([z.literal(""), z.string().trim().email().max(254)]),
});

async function requireOwner(tenantId: string, userId: string) {
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
}

export const tenantBrandingCommand = onRequest(
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
      const input = brandingSchema.parse(request.body);
      await requireOwner(input.tenantId, identity.uid);

      const db = getFirestore();
      const tenantReference = db.doc(`tenants/${input.tenantId}`);
      const tenant = await tenantReference.get();
      if (!tenant.exists) throw new Error("TENANT_NOT_FOUND");

      const before = {
        brandName: String(
          tenant.get("brandName") ?? tenant.get("businessName") ?? "",
        ),
        emailBranding: tenant.get("emailBranding") ?? null,
      };
      const now = new Date().toISOString();
      const emailBranding = {
        primaryColor: input.primaryColor.toUpperCase(),
        logoUrl: input.logoUrl || null,
        replyTo: input.replyTo || null,
      };
      const auditReference = db.collection("auditEvents").doc();
      const batch = db.batch();

      batch.update(tenantReference, {
        brandName: input.brandName,
        emailBranding,
        updatedAt: now,
        updatedBy: identity.uid,
      });
      batch.create(auditReference, {
        id: auditReference.id,
        tenantId: input.tenantId,
        projectId: null,
        actorId: identity.uid,
        actorType: "user",
        action: "tenant.email_branding_updated",
        entityType: "tenant",
        entityId: input.tenantId,
        timestamp: now,
        before,
        after: {
          brandName: input.brandName,
          emailBranding,
        },
        ipAddress: request.ip ?? null,
        userAgent: request.get("user-agent") ?? null,
        correlationId: auditReference.id,
        automationRunId: null,
        providerEventId: null,
      });
      await batch.commit();

      response.status(200).json({
        tenantId: input.tenantId,
        brandName: input.brandName,
        emailBranding,
      });
    } catch (caught: unknown) {
      const message =
        caught instanceof Error ? caught.message : "BRANDING_UPDATE_FAILED";
      const status =
        message === "FORBIDDEN"
          ? 403
          : message === "TENANT_NOT_FOUND"
            ? 404
            : 400;
      response.status(status).json({ error: message });
    }
  },
);
