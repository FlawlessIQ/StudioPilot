import { randomUUID } from "node:crypto";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import {
  requireAppCheckOrAppHostingProxy,
  requireIdentity,
} from "../crm/security.js";
import { requireActiveSubscription } from "../saas/entitlement-guard.js";
import { studioHubCors } from "../security/cors.js";
import { capabilitySchema, providerSchema, providerCapabilities, type Provider } from "./capability-resolution.js";
import { invalidCommandResponse } from "../security/invalid-command.js";
import { hasPaymentsScope } from "../billing/autopay-core.js";
import {
  MAX_ESTIMATE_RATE_BASIS_POINTS,
  normaliseBillingSettings,
} from "../billing/sales-tax-settings.js";
import {
  STUDIO_INVOICE_MAX_DUE_DAYS,
  STUDIO_INVOICE_MAX_TAX_BASIS_POINTS,
  STUDIO_INVOICE_TEXT_LIMITS,
  normalisePayLink,
  normaliseStudioInvoiceSettings,
} from "../billing/studio-invoice-settings.js";

const allowedRoles = ["studio_owner", "studio_admin"];

const commandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("setCapabilityProvider"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      capability: capabilitySchema,
      // null clears an explicit selection and returns the capability to
      // auto-resolution (see features/integrations/routing.ts).
      provider: providerSchema.nullable(),
    }),
  }),
  z.object({
    /**
     * The studio's default agreement template.
     *
     * `defaultContractSettings.templateId` was read by the booking
     * workspace and by the setup checklist, and written by nothing — so the
     * booking page's "set the studio default in Settings" pointed at a
     * field no code path could produce, and the setup step for the
     * agreement could never be ticked. This is the writer.
     */
    type: z.literal("setContractTemplate"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      // null clears the default and returns every project to asking for a
      // template id per send.
      templateId: z.string().min(1).max(200).nullable(),
      /** Shown instead of the id once chosen; the id stays authoritative. */
      templateName: z.string().max(200).nullable().default(null),
      /**
       * Send this agreement automatically when a couple accepts a proposal.
       *
       * The studio's standing approval for one outward step, given once here
       * rather than per booking. Explicit: absent means off.
       */
      sendOnAcceptance: z.boolean().default(false),
    }),
  }),
  z.object({
    /**
     * Whether a provider sends for real.
     *
     * A Dropbox Sign account with no paid API plan answers 402 to every
     * live send, so the booking chain cannot be exercised at all. Test mode
     * uses the real API and the real webhooks, but the document is
     * watermarked and the signature is not legally binding — so it is
     * stored per tenant, on the connection, where the UI can say so
     * wherever a contract is about to go out.
     */
    type: z.literal("setProviderTestMode"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      provider: providerSchema,
      testMode: z.boolean(),
    }),
  }),
  z.object({
    /**
     * How the studio's clients sign, when StudioCue doesn't send contracts.
     *
     * Setup asks "How do your clients sign?", and for a studio without a
     * signing app or StudioCue signing there was no answer it could give: the
     * step could never be ticked, so setup stopped at "n of 5" for good
     * (docs/onboarding-assessment-2026-09-26.md). "record_own" is the answer
     * most studios have: they send their own agreement and record the
     * signature on the job. null withdraws it.
     *
     * Written as one field, so the template, StudioCue-agreement and
     * auto-send settings beside it are untouched.
     */
    type: z.literal("setSignatureMode"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({ mode: z.enum(["record_own"]).nullable() }),
  }),
  z.object({
    /**
     * Where a step outside StudioCue stands, as the studio tells it: "I've
     * applied" (waiting) or "Approved" (done); null clears it. For steps
     * StudioCue cannot see — Intuit's decision on a QuickBooks Payments
     * application, for one (features/outside-steps/registry.ts, whose ids
     * this list mirrors; tests/outside-steps.test.ts keeps them in step).
     */
    type: z.literal("setOutsideStep"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      stepId: z.enum(["quickbooks_payments_apply", "quickbooks_payments_reconnect", "inquiry_capture", "zoom_meeting_summaries", "quickbooks_sales_tax"]),
      state: z.enum(["waiting", "done"]).nullable(),
    }),
  }),
  z.object({
    /**
     * Offer autopay to this studio's couples.
     *
     * Turning it on needs a QuickBooks connection that granted the payments
     * permission. Whether Intuit has approved the studio's QuickBooks Payments
     * application is only known when a card is saved; that refusal is recorded
     * on the card and surfaced back here.
     */
    type: z.literal("setAutopay"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({ enabled: z.boolean() }),
  }),
  z.object({
    /**
     * The studio's billing settings (`billingSettings/{tenantId}`, shape in
     * features/billing/sales-tax-settings.ts): whether QuickBooks adds sales
     * tax, the rate proposals estimate with, and whether retainer invoices
     * wait for review. The QuickBooks item ids on the same document are
     * StudioCue's to keep (integrations/quickbooks-items.ts), never set here.
     */
    type: z.literal("setBillingSettings"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      salesTax: z.object({
        mode: z.enum(["quickbooks", "none"]),
        estimateRateBasisPoints: z.number().int().min(0).max(MAX_ESTIMATE_RATE_BASIS_POINTS).nullable(),
      }),
      holdRetainerForReview: z.boolean(),
    }),
  }),
  z.object({
    /**
     * What goes on the invoices StudioCue issues when a studio bills a job
     * itself (`billingSettings/{tenantId}.studioInvoices`, shape in
     * features/billing/studio-invoice-settings.ts). Independent of the
     * QuickBooks settings above.
     */
    type: z.literal("setStudioInvoiceSettings"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      businessName: z.string().max(STUDIO_INVOICE_TEXT_LIMITS.businessName).nullable(),
      businessAddress: z.string().max(STUDIO_INVOICE_TEXT_LIMITS.businessAddress).nullable(),
      businessEmail: z.string().max(STUDIO_INVOICE_TEXT_LIMITS.businessEmail).nullable(),
      businessPhone: z.string().max(STUDIO_INVOICE_TEXT_LIMITS.businessPhone).nullable(),
      paymentInstructions: z.string().max(STUDIO_INVOICE_TEXT_LIMITS.paymentInstructions).nullable(),
      payLinkUrl: z.string().max(STUDIO_INVOICE_TEXT_LIMITS.payLinkUrl).nullable(),
      dueDays: z.number().int().min(0).max(STUDIO_INVOICE_MAX_DUE_DAYS),
      tax: z.object({
        rateBasisPoints: z.number().int().min(0).max(STUDIO_INVOICE_MAX_TAX_BASIS_POINTS).nullable(),
        label: z.string().max(STUDIO_INVOICE_TEXT_LIMITS.taxLabel).nullable(),
      }),
      footer: z.string().max(STUDIO_INVOICE_TEXT_LIMITS.footer).nullable(),
    }),
  }),
]);

export const integrationsCommand = onRequest(
  {
    cors: studioHubCors,
    invoker: "private",
  },
  async (request, response) => {
    if (request.method !== "POST") {
      response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
      return;
    }

    let identity;
    try {
      await requireAppCheckOrAppHostingProxy(request);
      identity = await requireIdentity(request);
    } catch {
      response.status(401).json({ error: "AUTHENTICATION_REQUIRED" });
      return;
    }

    const parsed = commandSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json(invalidCommandResponse(parsed.error));
      return;
    }
    const command = parsed.data;
    const db = getFirestore();
    const membership = await db
      .doc(`memberships/${command.tenantId}_${identity.uid}`)
      .get();
    const membershipData = membership.data() as
      | { role: string; status: string }
      | undefined;
    if (
      !membershipData ||
      membershipData.status !== "active" ||
      !allowedRoles.includes(membershipData.role)
    ) {
      response.status(403).json({ error: "FORBIDDEN" });
      return;
    }
    // Whole-product billing gate (studio commands require a live subscription).
    try {
      await requireActiveSubscription(db, command.tenantId);
    } catch (caught: unknown) {
      // The guard's own code: read-only and suspended studios are told so.
      response.status(402).json({ error: caught instanceof Error ? caught.message : "ACTIVE_SUBSCRIPTION_REQUIRED" });
      return;
    }

    const commandReference = db.doc(
      `commandExecutions/${command.tenantId}_${command.idempotencyKey}`,
    );
    const prior = await commandReference.get();
    if (prior.exists) {
      response.status(200).json(prior.data()?.result);
      return;
    }

    const timestamp = new Date().toISOString();
    const correlationId = request.header("x-correlation-id") ?? randomUUID();

    try {
      const result = await db.runTransaction(async (transaction) => {
        const execution = await transaction.get(commandReference);
        if (execution.exists) {
          return execution.data()?.result as Record<string, unknown>;
        }

        if (command.type === "setCapabilityProvider") {
          const { capability, provider } = command.input;

          if (provider !== null) {
            if (!providerCapabilities[provider].includes(capability)) {
              throw new Error("PROVIDER_DOES_NOT_SERVE_CAPABILITY");
            }
            const connectionReference = db.doc(
              `integrationConnections/${command.tenantId}_${provider}`,
            );
            const connection = await transaction.get(connectionReference);
            if (
              !connection.exists ||
              connection.get("tenantId") !== command.tenantId ||
              connection.get("status") !== "connected" ||
              connection.get("archivedAt") !== null
            ) {
              throw new Error("PROVIDER_NOT_CONNECTED");
            }
          }

          const routingReference = db.doc(
            `integrationRouting/${command.tenantId}`,
          );
          const existing = await transaction.get(routingReference);
          const existingData = existing.data() as
            | {
                selections?: Record<string, Provider | null>;
                createdAt?: string;
                createdBy?: string;
              }
            | undefined;
          const nextSelections = {
            ...(existingData?.selections ?? {}),
            [capability]: provider,
          };

          transaction.set(routingReference, {
            tenantId: command.tenantId,
            selections: nextSelections,
            createdAt: existingData?.createdAt ?? timestamp,
            createdBy: existingData?.createdBy ?? identity.uid,
            updatedAt: timestamp,
            updatedBy: identity.uid,
          });

          const auditId = randomUUID();
          transaction.create(db.doc(`auditEvents/${auditId}`), {
            id: auditId,
            tenantId: command.tenantId,
            projectId: null,
            actorId: identity.uid,
            actorType: "user",
            action: "integration.capability_provider_set",
            entityType: "integrationRouting",
            entityId: command.tenantId,
            timestamp,
            before: { capability, provider: existingData?.selections?.[capability] ?? null },
            after: { capability, provider },
            ipAddress: request.ip ?? null,
            userAgent: request.header("user-agent") ?? null,
            correlationId,
            automationRunId: null,
            providerEventId: null,
          });

          const output = { capability, provider };
          transaction.create(commandReference, {
            tenantId: command.tenantId,
            idempotencyKey: command.idempotencyKey,
            result: output,
            createdAt: timestamp,
          });
          return output;
        }

        if (command.type === "setContractTemplate") {
          const { templateId, templateName, sendOnAcceptance } = command.input;
          const tenantReference = db.doc(`tenants/${command.tenantId}`);
          const tenant = await transaction.get(tenantReference);
          if (!tenant.exists) throw new Error("TENANT_NOT_FOUND");
          const before =
            (tenant.get("defaultContractSettings") as
              | { templateId?: string; templateName?: string }
              | undefined) ?? {};

          transaction.update(tenantReference, {
            defaultContractSettings: {
              templateId,
              templateName: templateId ? templateName : null,
              sendOnAcceptance: templateId ? sendOnAcceptance : false,
              updatedAt: timestamp,
              updatedBy: identity.uid,
            },
            updatedAt: timestamp,
            updatedBy: identity.uid,
          });

          const auditId = randomUUID();
          transaction.create(db.doc(`auditEvents/${auditId}`), {
            id: auditId,
            tenantId: command.tenantId,
            projectId: null,
            actorId: identity.uid,
            actorType: "user",
            action: "integration.contract_template_set",
            entityType: "tenant",
            entityId: command.tenantId,
            timestamp,
            before: { templateId: before.templateId ?? null },
            after: { templateId },
            ipAddress: request.ip ?? null,
            userAgent: request.header("user-agent") ?? null,
            correlationId,
            automationRunId: null,
            providerEventId: null,
          });

          const output = { templateId, templateName: templateId ? templateName : null };
          transaction.create(commandReference, {
            tenantId: command.tenantId,
            idempotencyKey: command.idempotencyKey,
            result: output,
            createdAt: timestamp,
          });
          return output;
        }

        if (command.type === "setOutsideStep") {
          const { stepId, state } = command.input;
          const tenantReference = db.doc(`tenants/${command.tenantId}`);
          const tenant = await transaction.get(tenantReference);
          if (!tenant.exists) throw new Error("TENANT_NOT_FOUND");
          const before =
            ((tenant.get("outsideSteps") as Record<string, { state?: string }> | undefined) ?? {})[
              stepId
            ]?.state ?? null;
          transaction.update(tenantReference, {
            [`outsideSteps.${stepId}`]: state
              ? { state, at: timestamp, by: identity.uid }
              : FieldValue.delete(),
            updatedAt: timestamp,
            updatedBy: identity.uid,
          });
          const auditId = randomUUID();
          transaction.create(db.doc(`auditEvents/${auditId}`), {
            id: auditId,
            tenantId: command.tenantId,
            projectId: null,
            actorId: identity.uid,
            actorType: "user",
            action: "integration.outside_step_set",
            entityType: "tenant",
            entityId: command.tenantId,
            timestamp,
            before: { stepId, state: before },
            after: { stepId, state },
            ipAddress: request.ip ?? null,
            userAgent: request.header("user-agent") ?? null,
            correlationId,
            automationRunId: null,
            providerEventId: null,
          });
          const output = { stepId, state };
          transaction.create(commandReference, {
            tenantId: command.tenantId,
            idempotencyKey: command.idempotencyKey,
            result: output,
            createdAt: timestamp,
          });
          return output;
        }

        if (command.type === "setSignatureMode") {
          const { mode } = command.input;
          const tenantReference = db.doc(`tenants/${command.tenantId}`);
          const tenant = await transaction.get(tenantReference);
          if (!tenant.exists) throw new Error("TENANT_NOT_FOUND");
          const before =
            ((tenant.get("defaultContractSettings") as { signatureMode?: string } | undefined) ?? {})
              .signatureMode ?? null;
          transaction.update(tenantReference, {
            "defaultContractSettings.signatureMode": mode,
            updatedAt: timestamp,
            updatedBy: identity.uid,
          });
          const auditId = randomUUID();
          transaction.create(db.doc(`auditEvents/${auditId}`), {
            id: auditId,
            tenantId: command.tenantId,
            projectId: null,
            actorId: identity.uid,
            actorType: "user",
            action: "integration.signature_mode_set",
            entityType: "tenant",
            entityId: command.tenantId,
            timestamp,
            before: { signatureMode: before },
            after: { signatureMode: mode },
            ipAddress: request.ip ?? null,
            userAgent: request.header("user-agent") ?? null,
            correlationId,
            automationRunId: null,
            providerEventId: null,
          });
          const output = { signatureMode: mode };
          transaction.create(commandReference, {
            tenantId: command.tenantId,
            idempotencyKey: command.idempotencyKey,
            result: output,
            createdAt: timestamp,
          });
          return output;
        }

        if (command.type === "setAutopay") {
          const { enabled } = command.input;
          const tenantReference = db.doc(`tenants/${command.tenantId}`);
          const connectionReference = db.doc(
            `integrationConnections/${command.tenantId}_quickbooks`,
          );
          const [tenant, connection] = await Promise.all([
            transaction.get(tenantReference),
            transaction.get(connectionReference),
          ]);
          if (!tenant.exists) throw new Error("TENANT_NOT_FOUND");
          if (
            enabled &&
            (!connection.exists ||
              connection.get("status") !== "connected" ||
              (connection.get("mockMode") !== true &&
                !hasPaymentsScope(connection.get("scopes"))))
          ) {
            throw new Error("QUICKBOOKS_PAYMENTS_NOT_GRANTED");
          }
          transaction.update(tenantReference, {
            autopay: { enabled, updatedAt: timestamp, updatedBy: identity.uid },
            updatedAt: timestamp,
            updatedBy: identity.uid,
          });
          const auditId = randomUUID();
          transaction.create(db.doc(`auditEvents/${auditId}`), {
            id: auditId,
            tenantId: command.tenantId,
            projectId: null,
            actorId: identity.uid,
            actorType: "user",
            action: "billing.autopay_set",
            entityType: "tenant",
            entityId: command.tenantId,
            timestamp,
            before: { enabled: tenant.get("autopay.enabled") === true },
            after: { enabled },
            ipAddress: request.ip ?? null,
            userAgent: request.header("user-agent") ?? null,
            correlationId,
            automationRunId: null,
            providerEventId: null,
          });
          const output = { enabled };
          transaction.create(commandReference, {
            tenantId: command.tenantId,
            idempotencyKey: command.idempotencyKey,
            result: output,
            createdAt: timestamp,
          });
          return output;
        }

        if (command.type === "setBillingSettings") {
          const { salesTax, holdRetainerForReview } = command.input;
          const settingsReference = db.doc(`billingSettings/${command.tenantId}`);
          const existing = await transaction.get(settingsReference);
          const before = normaliseBillingSettings(
            existing.exists ? existing.data() : null,
            command.tenantId,
          );
          transaction.set(
            settingsReference,
            {
              tenantId: command.tenantId,
              salesTax: {
                mode: salesTax.mode,
                estimateRateBasisPoints: salesTax.estimateRateBasisPoints,
              },
              holdRetainerForReview,
              quickbooksItems: before.quickbooksItems,
              updatedAt: timestamp,
              updatedBy: identity.uid,
            },
            { merge: true },
          );
          const auditId = randomUUID();
          transaction.create(db.doc(`auditEvents/${auditId}`), {
            id: auditId,
            tenantId: command.tenantId,
            projectId: null,
            actorId: identity.uid,
            actorType: "user",
            action: "billing.settings_set",
            entityType: "billingSettings",
            entityId: command.tenantId,
            timestamp,
            before: existing.exists
              ? { salesTax: before.salesTax, holdRetainerForReview: before.holdRetainerForReview }
              : null,
            after: { salesTax, holdRetainerForReview },
            ipAddress: request.ip ?? null,
            userAgent: request.header("user-agent") ?? null,
            correlationId,
            automationRunId: null,
            providerEventId: null,
          });
          const output = { salesTax, holdRetainerForReview };
          transaction.create(commandReference, {
            tenantId: command.tenantId,
            idempotencyKey: command.idempotencyKey,
            result: output,
            createdAt: timestamp,
          });
          return output;
        }

        if (command.type === "setStudioInvoiceSettings") {
          const input = command.input;
          if (input.payLinkUrl !== null && input.payLinkUrl.trim() && !normalisePayLink(input.payLinkUrl)) {
            throw new Error("INVOICE_PAY_LINK_INVALID");
          }
          const settingsReference = db.doc(`billingSettings/${command.tenantId}`);
          const existing = await transaction.get(settingsReference);
          const before = normaliseStudioInvoiceSettings(existing.exists ? existing.data() : null);
          // Normalised through the same reader every invoice uses, so what is
          // stored is exactly what will print.
          const after = normaliseStudioInvoiceSettings({ studioInvoices: input });
          transaction.set(
            settingsReference,
            {
              tenantId: command.tenantId,
              studioInvoices: after,
              updatedAt: timestamp,
              updatedBy: identity.uid,
            },
            { merge: true },
          );
          const auditId = randomUUID();
          transaction.create(db.doc(`auditEvents/${auditId}`), {
            id: auditId,
            tenantId: command.tenantId,
            projectId: null,
            actorId: identity.uid,
            actorType: "user",
            action: "billing.invoice_settings_set",
            entityType: "billingSettings",
            entityId: command.tenantId,
            timestamp,
            before: existing.exists ? before : null,
            after,
            ipAddress: request.ip ?? null,
            userAgent: request.header("user-agent") ?? null,
            correlationId,
            automationRunId: null,
            providerEventId: null,
          });
          transaction.create(commandReference, {
            tenantId: command.tenantId,
            idempotencyKey: command.idempotencyKey,
            result: after,
            createdAt: timestamp,
          });
          return after;
        }

        if (command.type === "setProviderTestMode") {
          const { provider, testMode } = command.input;
          const connectionReference = db.doc(
            `integrationConnections/${command.tenantId}_${provider}`,
          );
          const connection = await transaction.get(connectionReference);
          if (
            !connection.exists ||
            connection.get("tenantId") !== command.tenantId
          ) {
            throw new Error("PROVIDER_NOT_CONNECTED");
          }

          transaction.update(connectionReference, {
            testMode,
            updatedAt: timestamp,
            updatedBy: identity.uid,
          });

          const auditId = randomUUID();
          transaction.create(db.doc(`auditEvents/${auditId}`), {
            id: auditId,
            tenantId: command.tenantId,
            projectId: null,
            actorId: identity.uid,
            actorType: "user",
            action: "integration.test_mode_set",
            entityType: "integrationConnection",
            entityId: `${command.tenantId}_${provider}`,
            timestamp,
            before: { testMode: connection.get("testMode") === true },
            after: { testMode },
            ipAddress: request.ip ?? null,
            userAgent: request.header("user-agent") ?? null,
            correlationId,
            automationRunId: null,
            providerEventId: null,
          });

          const output = { provider, testMode };
          transaction.create(commandReference, {
            tenantId: command.tenantId,
            idempotencyKey: command.idempotencyKey,
            result: output,
            createdAt: timestamp,
          });
          return output;
        }

        throw new Error("UNKNOWN_COMMAND");
      });
      response.status(200).json(result);
    } catch (error) {
      const code = error instanceof Error ? error.message : "COMMAND_FAILED";
      const status =
        code === "PROVIDER_NOT_CONNECTED" || code === "PROVIDER_DOES_NOT_SERVE_CAPABILITY"
          ? 422
          : 400;
      response.status(status).json({ error: code });
    }
  },
);
