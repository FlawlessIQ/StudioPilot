import { createHash, randomUUID } from "node:crypto";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { requireAppCheck, requireIdentity } from "../crm/security.js";
import { respondToCommandError } from "../security/command-errors.js";
import { studioHubCors } from "../security/cors.js";
import { legalAcceptance } from "../legal/versions.js";
import { starterTemplates } from "../workflow/starter-templates.js";
import { starterQuestionnaires } from "../planning/starter-questionnaires.js";
import { recommendedQuestionnaires } from "../planning/recommended-templates.js";
import { INQUIRY_FORM_EVENT_TYPES, INQUIRY_FORM_SETTINGS_PATH } from "../intake/inquiry-form.js";
import { attributionSchema } from "./attribution-schema.js";
import { TRADES, TRADE_LABELS, tradeProfile } from "../trades/trades.js";
import { entitlements as planEntitlements } from "./stripe.js";

const inputSchema = z.object({
  businessName: z.string().trim().min(2).max(120),
  legalName: z.string().trim().min(2).max(160),
  // Detected from the browser at signup now, so check it names a real zone:
  // every date the studio sees is formatted in it.
  timezone: z
    .string()
    .min(1)
    .max(80)
    .refine((zone) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: zone });
        return true;
      } catch {
        return false;
      }
    }, "Unknown timezone"),
  currency: z
    .string()
    .length(3)
    .transform((value) => value.toUpperCase()),
  /**
   * What the studio does (trades.ts): "What do you do?" at signup, or the
   * `?trade=` it arrived with. Missing is a photographer, as every studio was
   * before trades.
   */
  trade: z.enum(TRADES).default("photographer"),
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
  maxActiveSubcontractors: 25,
  aiActionsMonthly: 2500,
  smsEnabled: true,
  coiEnabled: true,
  customWorkflowsEnabled: true,
  advancedReportingEnabled: true,
  apiAccessEnabled: false,
  prioritySupportEnabled: true,
};

// Owner emails that get a free, comped studio — access granted at onboarding
// without Stripe Checkout. Set COMPED_OWNER_EMAILS (comma-separated) in
// functions/.env.studiohub-prod; matched case-insensitively against the
// verified owner email. Empty or unset means nobody is comped.
const compedOwnerEmails = new Set(
  (process.env.COMPED_OWNER_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean),
);
// A comped studio has no trial to end; park its period end far out so nothing
// treats it as expiring.
const COMPED_PERIOD_END = "2099-12-31T00:00:00.000Z";

const slug = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "studio";

/**
 * A photographer on the Console's pipeline who signs up with the same email:
 * the lead is linked to the new studio, and from then on the studio decides
 * where it stands (features/console/pipeline.ts). Best effort; a missed link
 * costs a manual one, never a signup.
 */
async function linkLead(db: Firestore, email: string, tenantId: string, now: string): Promise<void> {
  const leads = await db.collection("saasLeads").where("email", "==", email.trim().toLowerCase()).limit(5).get();
  const lead = leads.docs.find((doc) => !doc.get("tenantId"));
  if (lead) await lead.ref.update({ tenantId, stage: "trial", stageChangedAt: now, updatedAt: now });
}

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
      // Where the studio came from (Console → Sources). Parsed on its own so
      // a malformed record is dropped rather than stopping the signup.
      const attribution = attributionSchema.safeParse(
        (request.body as { attribution?: unknown } | undefined)?.attribution,
      );
      const db = getFirestore();
      const now = new Date().toISOString();
      const comped = compedOwnerEmails.has(identity.email.toLowerCase());
      const onboardingReference = db.doc(`tenantOnboarding/${identity.uid}`);
      const result = await db.runTransaction(async (transaction) => {
        const existing = await transaction.get(onboardingReference);
        if (existing.exists)
          return {
            tenantId: String(existing.get("tenantId")),
            created: false,
            checkoutRequired: !comped,
          };
        const tenantId = `tenant_${randomUUID()}`;
        const membershipId = `${tenantId}_${identity.uid}`;
        const publicSlug = `${slug(input.businessName)}-${createHash("sha256").update(identity.uid).digest("hex").slice(0, 8)}`;
        const trialEndAt = comped
          ? COMPED_PERIOD_END
          : new Date(Date.now() + 14 * 86400000).toISOString();
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
            // Which Terms and Privacy Policy this person accepted at signup.
            legalAcceptance: legalAcceptance(identity.uid, now),
            createdAt: now,
            updatedAt: now,
            createdBy: identity.uid,
            updatedBy: identity.uid,
            archivedAt: null,
          },
          { merge: true },
        );
        if (attribution.success)
          transaction.set(db.doc(`saasAttribution/${tenantId}`), {
            id: tenantId,
            tenantId,
            ...attribution.data,
            manual: null,
            createdAt: now,
          });
        // What the studio does, and so what it starts with (trades.ts). A
        // photographer starts exactly as before. A DJ, makeup artist or hair
        // stylist starts on the vendor plan, with nothing photographic: no
        // shot list, no final schedule built around photos, no gallery
        // defaults, no day-before "dress on a hanger" email. Their own forms
        // (the music planner, the party list) come with their journeys
        // (docs/vendor-journeys-plan.md).
        const trade = tradeProfile(input.trade);
        const photographer = trade.trade === "photographer";
        const planKey = trade.plans[0] as keyof typeof planEntitlements;
        const startingEntitlements = photographer ? trialEntitlements : planEntitlements[planKey];
        // The recommended wedding forms' ids, chosen now so the tenant's
        // planning timeline can name them (see "Weddings start with" below).
        const recommended = recommendedQuestionnaires().filter(
          (form) => photographer || form.id === "wedding-event-details",
        );
        const preloaded: Record<string, string> = Object.fromEntries(
          recommended.map((form) => [form.id, randomUUID()]),
        );
        transaction.create(db.doc(`tenants/${tenantId}`), {
          // The final schedule is the planning form, and the shot list goes
          // with it; the rest of the timeline keeps its defaults.
          planningTimeline: {
            // A vendor's planning form is the event details form until its
            // own arrives with its journey.
            formTemplateId: preloaded["wedding-final-schedule"] ?? preloaded["wedding-event-details"] ?? null,
            shotListTemplateId: preloaded["wedding-shot-list"] ?? null,
            updatedAt: now,
            updatedBy: identity.uid,
          },
          id: tenantId,
          tenantId,
          trade: trade.trade,
          businessName: input.businessName,
          legalName: input.legalName,
          brandName: input.businessName,
          publicSlug,
          // Every address this studio has ever had. The inquiry lookup matches
          // on this so a later slug change does not break links already
          // shared. See functions/src/crm/tenant-by-slug.ts.
          slugAliases: [publicSlug],
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
          ...(trade.delivery
            ? {
                deliveryDefaults: {
                  galleryProvider: "manual",
                  galleryExpirationDays: 90,
                  albumInstructionsUrl: null,
                },
              }
            : {}),
          // The client's day-before email is a photographer's ("the dress on
          // a hanger, ready to photograph"); off for every other trade.
          ...(trade.clientDayBefore
            ? {}
            : {
                lifecycleMessaging: {
                  schedule_confirmation: { enabled: true, offsetDays: -30, autoSend: false },
                  final_invoice_notice: { enabled: true, offsetDays: -30, autoSend: false },
                  day_before_checklist: { enabled: false, offsetDays: -1, autoSend: false },
                  consultation_prep: { enabled: true, offsetDays: -1, autoSend: false },
                },
              }),
          status: "trial",
          subscriptionPlan: planKey,
          trialEndAt,
          legalAcceptance: legalAcceptance(identity.uid, now),
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
          plan: planKey,
          cadence: "monthly",
          // A comped owner (COMPED_OWNER_EMAILS) is granted access immediately:
          // `active` with no Stripe ids, no Checkout, no trial to end. Nothing
          // flips it back — there is no Stripe subscription for a webhook to
          // touch, and no scheduler expires an `active` status by date.
          //
          // Everyone else: card-required onboarding. The trial does not start
          // until the studio completes Stripe Checkout; until then the
          // subscription is `incomplete` — `subscriptionGrantsAccess` refuses
          // it, so the app gate routes the studio to Checkout instead of into
          // the workspace. Provisioning (session return + the
          // customer.subscription.created webhook) flips this to `trialing`
          // with the real Stripe ids and trial_end. The entitlements snapshot
          // is kept so counters render; access is gated by status.
          status: comped ? "active" : "incomplete",
          checkoutRequired: !comped,
          comped,
          stripeCustomerId: null,
          stripeSubscriptionId: null,
          stripePriceId: null,
          currentPeriodStart: now,
          currentPeriodEnd: trialEndAt,
          cancelAtPeriodEnd: false,
          entitlements: startingEntitlements,
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
            // "Wedding Photography" is a photographer's; a DJ's is "Wedding (DJ)".
            name: photographer ? starter.name : `${starter.eventTypeLabel} (${TRADE_LABELS[trade.trade]})`,
            description: photographer ? starter.description : starter.description.replace(/ shoot\b/, " event"),
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
        /**
         * Weddings start with StudioCue's recommended set, switched on — GR
         * Productions' own forms (planning/recommended-templates.ts):
         *   - the event details form, on the couple's inquiry link;
         *   - the final schedule, as the planning form;
         *   - the shot list, which goes with it and reaches the crew.
         * GR ran for weeks with no shot list at all, because the recommended
         * one was a card to copy and a setting to find (2026-10-08: "Definitely
         * need a shot list form for the wedding options too"). Other kinds
         * keep their starter brief.
         */
        for (const form of recommended) {
          const questionnaireId = preloaded[form.id]!;
          transaction.create(db.doc(`questionnaireTemplates/${questionnaireId}`), {
            id: questionnaireId,
            tenantId,
            name: form.name,
            eventTypeId: form.eventTypeId,
            status: "active",
            sections: form.sections,
            dueDaysBeforeEvent: form.dueDaysBeforeEvent,
            reminderDaysBeforeDue: form.reminderDaysBeforeDue,
            recommendedId: form.id,
            version: 1,
            createdAt: now,
            updatedAt: now,
            createdBy: identity.uid,
            updatedBy: identity.uid,
            archivedAt: null,
          });
        }
        const eventDetailsId = preloaded["wedding-event-details"];
        if (eventDetailsId)
          transaction.set(db.doc(INQUIRY_FORM_SETTINGS_PATH(tenantId)), {
            tenantId,
            inquiryEventForm: {
              templateId: eventDetailsId,
              templateName: "Event details form",
              eventTypes: [...INQUIRY_FORM_EVENT_TYPES],
              updatedAt: now,
              updatedBy: identity.uid,
            },
            updatedAt: now,
          }, { merge: true });
        // The other kinds' starter briefs ask about photos ("Groups we must
        // photograph"): a photographer's only, for now.
        for (const starter of photographer ? starterQuestionnaires() : []) {
          // The wedding set above replaces the generic wedding questionnaire.
          if (starter.eventTypeId === "wedding") continue;
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
            trade: trade.trade,
            plan: planKey,
            status: "trial",
          },
          ipAddress: request.ip ?? null,
          userAgent: request.get("user-agent") ?? null,
          correlationId: identity.uid,
          automationRunId: null,
          providerEventId: null,
        });
        return { tenantId, created: true, checkoutRequired: !comped };
      });
      if (result.created)
        await linkLead(db, identity.email, result.tenantId, now).catch((caught: unknown) =>
          console.error(JSON.stringify({ severity: "ERROR", event: "onboarding.lead_link_failed", tenantId: result.tenantId, message: String(caught) })),
        );
      response.status(200).json(result);
    } catch (caught: unknown) {
      respondToCommandError(response, caught, {
        name: "tenantOnboardingCommand",
        status: (message) => (message === "VERIFIED_EMAIL_REQUIRED" ? 403 : 400),
      });
    }
  },
);
