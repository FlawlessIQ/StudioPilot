import { createHash, randomUUID } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { requireAppCheck, requireIdentity } from "../crm/security.js";
import { studioHubCors } from "../security/cors.js";
import { starterTemplates } from "../workflow/starter-templates.js";
import { starterQuestionnaires } from "../planning/starter-questionnaires.js";

const inputSchema = z.object({
  businessName: z.string().trim().min(2).max(120),
  legalName: z.string().trim().min(2).max(160),
  timezone: z.string().min(1).max(80),
  currency: z
    .string()
    .length(3)
    .transform((value) => value.toUpperCase()),
});
/**
 * What a brand new tenant gets before it has chosen anything.
 *
 * This was Solo's shape: one seat, no COI, no custom workflows. Solo is
 * gone, and a trial that starts more restricted than the cheapest thing you
 * can buy teaches a studio the product cannot do what it can. A trial now
 * starts as the entry plan.
 */
const trialEntitlements = {
  maxInternalUsers: 3,
  maxBrands: 1,
  maxActiveSubcontractors: null,
  aiActionsMonthly: 2500,
  smsEnabled: true,
  coiEnabled: true,
  customWorkflowsEnabled: true,
  advancedReportingEnabled: true,
  apiAccessEnabled: false,
  prioritySupportEnabled: true,
};
const slug = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "studio";

export const tenantOnboardingCommand = onRequest(
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
      if (
        identity.email_verified !== true ||
        typeof identity.email !== "string"
      )
        throw new Error("VERIFIED_EMAIL_REQUIRED");
      const input = inputSchema.parse(request.body);
      const db = getFirestore();
      const now = new Date().toISOString();
      const onboardingReference = db.doc(`tenantOnboarding/${identity.uid}`);
      const result = await db.runTransaction(async (transaction) => {
        const existing = await transaction.get(onboardingReference);
        if (existing.exists)
          return { tenantId: String(existing.get("tenantId")), created: false };
        const tenantId = `tenant_${randomUUID()}`;
        const membershipId = `${tenantId}_${identity.uid}`;
        const publicSlug = `${slug(input.businessName)}-${createHash("sha256").update(identity.uid).digest("hex").slice(0, 8)}`;
        const trialEndAt = new Date(Date.now() + 14 * 86400000).toISOString();
        transaction.set(
          db.doc(`users/${identity.uid}`),
          {
            id: identity.uid,
            tenantId: "platform",
            email: identity.email,
            displayName: String(identity.name ?? input.businessName),
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
        transaction.create(db.doc(`tenants/${tenantId}`), {
          id: tenantId,
          tenantId,
          businessName: input.businessName,
          legalName: input.legalName,
          brandName: input.businessName,
          publicSlug,
          timezone: input.timezone,
          currency: input.currency,
          dateFormat: "MMM d, yyyy",
          reviewLinks: {
            google: null,
            weddingwire: null,
            theKnot: null,
            facebook: null,
            custom: null,
          },
          deliveryDefaults: {
            galleryProvider: "manual",
            galleryExpirationDays: 90,
            albumInstructionsUrl: null,
          },
          status: "trial",
          subscriptionPlan: "studio",
          trialEndAt,
          createdAt: now,
          updatedAt: now,
          createdBy: identity.uid,
          updatedBy: identity.uid,
          archivedAt: null,
        });
        transaction.create(db.doc(`memberships/${membershipId}`), {
          id: membershipId,
          tenantId,
          userId: identity.uid,
          role: "studio_owner",
          explicitPermissions: [],
          projectIds: [],
          status: "active",
          createdAt: now,
          updatedAt: now,
          createdBy: identity.uid,
          updatedBy: identity.uid,
          archivedAt: null,
        });
        transaction.create(db.doc(`subscriptions/${tenantId}`), {
          id: tenantId,
          tenantId,
          plan: "studio",
          cadence: "monthly",
          status: "trialing",
          stripeCustomerId: null,
          stripeSubscriptionId: null,
          stripePriceId: null,
          currentPeriodStart: now,
          currentPeriodEnd: trialEndAt,
          cancelAtPeriodEnd: false,
          entitlements: trialEntitlements,
          internalUserCount: 1,
          brandCount: 1,
          activeSubcontractorCount: 0,
          createdAt: now,
          updatedAt: now,
          createdBy: identity.uid,
          updatedBy: identity.uid,
          archivedAt: null,
        });
        /**
         * Readiness needs a workflow, and a new studio had none.
         *
         * autoInstantiateWorkflow resolves an active template by event type
         * when a job reaches booking. With nothing published, it returns
         * `no_active_template` and readiness silently never engages — so
         * the product's central idea was switched off until a photographer
         * authored a template themselves. These three are the same
         * definitions the demo studio has always used; there was never a
         * reason they belonged only to the demo.
         *
         * Inside the onboarding transaction, so a tenant either exists with
         * its workflows or does not exist at all.
         */
        for (const starter of starterTemplates()) {
          const templateId = randomUUID();
          transaction.create(db.doc(`workflowTemplates/${templateId}`), {
            id: templateId,
            tenantId,
            name: starter.name,
            description: starter.description,
            eventTypeId: starter.eventTypeId,
            eventTypeLabel: starter.eventTypeLabel,
            checkpointTemplates: starter.checkpointTemplates,
            automationRules: [],
            version: 1,
            status: "active",
            immutable: true,
            publishedAt: now,
            publishedBy: identity.uid,
            createdAt: now,
            updatedAt: now,
            createdBy: identity.uid,
            updatedBy: identity.uid,
            archivedAt: null,
          });
        }
        /**
         * And the questionnaires.
         *
         * "Questionnaire complete" is a blocking readiness checkpoint on the
         * starter wedding workflow, so a tenant with no questionnaire template
         * could only ever waive it. Composing twenty questions aimed at a
         * couple is copywriting, not configuration — nobody should have to do
         * it before their first client.
         * See features/questionnaires/starter-templates.ts.
         */
        for (const starter of starterQuestionnaires()) {
          const questionnaireId = randomUUID();
          transaction.create(
            db.doc(`questionnaireTemplates/${questionnaireId}`),
            {
              id: questionnaireId,
              tenantId,
              name: starter.name,
              eventTypeId: starter.eventTypeId,
              status: "active",
              sections: starter.sections,
              dueDaysBeforeEvent: starter.dueDaysBeforeEvent,
              reminderDaysBeforeDue: starter.reminderDaysBeforeDue,
              version: 1,
              createdAt: now,
              updatedAt: now,
              createdBy: identity.uid,
              updatedBy: identity.uid,
              archivedAt: null,
            },
          );
        }
        transaction.create(onboardingReference, {
          userId: identity.uid,
          tenantId,
          createdAt: now,
        });
        transaction.create(db.doc(`auditEvents/onboarding_${identity.uid}`), {
          id: `onboarding_${identity.uid}`,
          tenantId,
          projectId: null,
          actorId: identity.uid,
          actorType: "user",
          action: "tenant.created",
          entityType: "tenant",
          entityId: tenantId,
          timestamp: now,
          before: null,
          after: {
            businessName: input.businessName,
            plan: "studio",
            status: "trial",
          },
          ipAddress: request.ip ?? null,
          userAgent: request.get("user-agent") ?? null,
          correlationId: identity.uid,
          automationRunId: null,
          providerEventId: null,
        });
        return { tenantId, created: true };
      });
      response.status(200).json(result);
    } catch (caught: unknown) {
      const message =
        caught instanceof Error ? caught.message : "ONBOARDING_FAILED";
      response
        .status(message === "VERIFIED_EMAIL_REQUIRED" ? 403 : 400)
        .json({ error: message });
    }
  },
);
