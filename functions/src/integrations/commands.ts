import { randomUUID } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import {
  requireAppCheckOrAppHostingProxy,
  requireIdentity,
} from "../crm/security.js";
import { studioHubCors } from "../security/cors.js";
import { capabilitySchema, providerSchema, providerCapabilities, type Provider } from "./capability-resolution.js";

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
      response.status(400).json({ error: "INVALID_COMMAND" });
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
          const { templateId, templateName } = command.input;
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
