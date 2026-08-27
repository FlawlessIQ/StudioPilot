import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { requireAppCheck, requireIdentity } from "../crm/security.js";
import { studioHubCors } from "../security/cors.js";
import {
  normalizeSlug,
  slugProblem,
  SUPPORTED_CURRENCIES,
} from "./identity.js";

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

const identitySchema = z.object({
  tenantId: z.string().min(1),
  legalName: z.string().trim().min(2).max(200),
  businessName: z.string().trim().min(2).max(200),
  timezone: z.string().trim().min(3).max(64),
  currency: z.enum(SUPPORTED_CURRENCIES),
  publicSlug: z.string().trim().min(3).max(60),
});

/**
 * The studio's own identity: what it is called, where it is, and the address
 * of its public inquiry form.
 *
 * All six fields were written in exactly one place — `saas/onboarding.ts` —
 * and nowhere else, so a studio that typed its legal name wrong had it on
 * every contract from then on, and its inquiry URL stayed whatever signup
 * generated. See features/tenants/identity.ts.
 *
 * The slug is the field with a cost attached, and it gets two protections:
 *
 *   1. **Uniqueness.** Two studios cannot share a public address; the inquiry
 *      lookup takes the first match, so a collision would quietly route one
 *      studio's clients to another.
 *   2. **Every slug it has ever had is kept.** A studio hands this URL out on
 *      cards and in email signatures; changing it must not turn those into
 *      404s. `slugAliases` accumulates, and the inquiry lookup matches on it.
 */
export const tenantIdentityCommand = onRequest(
  { cors: studioHubCors, invoker: "private" },
  async (request, response) => {
    if (request.method !== "POST") {
      response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
      return;
    }
    try {
      await requireAppCheck(request);
      const identity = await requireIdentity(request);
      const input = identitySchema.parse(request.body);
      await requireOwner(input.tenantId, identity.uid);

      const slug = normalizeSlug(input.publicSlug);
      const problem = slugProblem(slug);
      if (problem) throw new Error("PUBLIC_SLUG_INVALID");

      const db = getFirestore();
      const tenantReference = db.doc(`tenants/${input.tenantId}`);
      const tenant = await tenantReference.get();
      if (!tenant.exists) throw new Error("TENANT_NOT_FOUND");

      const currentSlug = String(tenant.get("publicSlug") ?? "");
      if (slug !== currentSlug) {
        // Not somebody else's address, and not one somebody else used to have:
        // an old link pointing at a slug a different studio now owns would
        // send that studio's clients to this one.
        const [bySlug, byAlias] = await Promise.all([
          db.collection("tenants").where("publicSlug", "==", slug).limit(2).get(),
          db
            .collection("tenants")
            .where("slugAliases", "array-contains", slug)
            .limit(2)
            .get(),
        ]);
        const taken = [...bySlug.docs, ...byAlias.docs].some(
          (candidate) => candidate.id !== input.tenantId,
        );
        if (taken) throw new Error("PUBLIC_SLUG_TAKEN");
      }

      const priorAliases = Array.isArray(tenant.get("slugAliases"))
        ? (tenant.get("slugAliases") as string[])
        : [];
      const slugAliases = Array.from(
        new Set([...priorAliases, currentSlug, slug].filter(Boolean)),
      );

      const before = {
        legalName: tenant.get("legalName") ?? null,
        businessName: tenant.get("businessName") ?? null,
        timezone: tenant.get("timezone") ?? null,
        currency: tenant.get("currency") ?? null,
        publicSlug: currentSlug,
      };
      const now = new Date().toISOString();
      const auditReference = db.collection("auditEvents").doc();
      const batch = db.batch();
      batch.update(tenantReference, {
        legalName: input.legalName,
        businessName: input.businessName,
        timezone: input.timezone,
        currency: input.currency,
        publicSlug: slug,
        slugAliases,
        updatedAt: now,
        updatedBy: identity.uid,
      });
      batch.create(auditReference, {
        id: auditReference.id,
        tenantId: input.tenantId,
        projectId: null,
        actorId: identity.uid,
        actorType: "user",
        action: "tenant.identity_updated",
        entityType: "tenant",
        entityId: input.tenantId,
        timestamp: now,
        before,
        after: {
          legalName: input.legalName,
          businessName: input.businessName,
          timezone: input.timezone,
          currency: input.currency,
            publicSlug: slug,
          slugAliases,
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
        publicSlug: slug,
        slugAliases,
      });
    } catch (caught: unknown) {
      const message =
        caught instanceof Error ? caught.message : "IDENTITY_UPDATE_FAILED";
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
