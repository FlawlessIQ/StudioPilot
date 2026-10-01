import { randomUUID } from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { consoleHandlers } from "../console/handlers/index.js";
import { roleCan, roleFromClaims } from "../console/roles.js";
import { requireAppCheck, requireIdentity } from "../crm/security.js";
import { studioHubCors } from "../security/cors.js";

/**
 * Every StudioCue Console command (docs/console.md).
 *
 * One private endpoint, so one invoker binding and one relay entry, however
 * many commands the Console grows. Each command lives in
 * functions/src/console/handlers and declares the capability it needs; this
 * does the rest identically for all of them, in order: App Check, verified
 * identity, console role from the token, capability, input schema, run, and
 * one audit event.
 */
const envelope = z.object({
  type: z.string().min(1).max(64),
  input: z.unknown().optional(),
});

export const saasAdminCommand = onRequest(
  {
    cors: studioHubCors,
    invoker: "private",
    // Billing commands call Stripe; the rest never touch the secret.
    secrets: ["STRIPE_SECRET_KEY"],
    // A full summary refresh walks every studio.
    timeoutSeconds: 300,
    memory: "512MiB",
  },
  async (request, response) => {
    if (request.method !== "POST") {
      response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
      return;
    }
    let type = "unknown";
    try {
      await requireAppCheck(request);
      const identity = await requireIdentity(request);
      const role = roleFromClaims(identity as unknown as Record<string, unknown>);
      if (!role) throw new Error("FORBIDDEN");
      const parsed = envelope.parse(request.body);
      type = parsed.type;
      const handler = consoleHandlers[parsed.type];
      if (!handler) throw new Error("UNKNOWN_COMMAND");
      if (!roleCan(role, handler.capability)) throw new Error("FORBIDDEN");
      const input = handler.input.parse(parsed.input ?? {});
      const db = getFirestore();
      const now = new Date().toISOString();
      const outcome = await handler.run({ db, auth: getAuth(), identity, role, now, request }, input);
      const audits = outcome.audit === null ? [] : Array.isArray(outcome.audit) ? outcome.audit : [outcome.audit];
      if (audits.length) {
        const correlationId = request.get("x-correlation-id") ?? randomUUID();
        const batch = db.batch();
        for (const audit of audits) {
          const id = randomUUID();
          batch.create(db.doc(`auditEvents/${id}`), {
            id,
            tenantId: audit.tenantId ?? "platform",
            projectId: null,
            actorId: identity.uid,
            actorType: "platform_admin",
            actorEmail: identity.email ?? null,
            actorRole: role,
            action: `platform.${parsed.type}`,
            entityType: audit.entityType,
            entityId: audit.entityId,
            reason: audit.reason ?? null,
            timestamp: now,
            before: (audit.before ?? null) as never,
            after: (audit.after ?? outcome.result) as never,
            ipAddress: request.get("x-studiohub-client-ip") ?? request.ip ?? null,
            userAgent: request.get("user-agent") ?? null,
            correlationId,
            automationRunId: null,
            providerEventId: null,
          });
        }
        await batch.commit();
      }
      response.status(200).json(outcome.result);
    } catch (caught: unknown) {
      const message =
        caught instanceof z.ZodError
          ? `INVALID_REQUEST:${caught.issues[0]?.path.join(".") || "input"}`
          : caught instanceof Error
            ? caught.message
            : "ADMIN_COMMAND_FAILED";
      const code = message.split(":")[0] ?? "ADMIN_COMMAND_FAILED";
      const status =
        code === "FORBIDDEN"
          ? 403
          : ["APP_CHECK_REQUIRED", "AUTHENTICATION_REQUIRED"].includes(code)
            ? 401
            : code.endsWith("_NOT_FOUND")
              ? 404
              : 400;
      if (status === 400 && !code.startsWith("INVALID_REQUEST"))
        console.error(JSON.stringify({ severity: "ERROR", event: "console.command_failed", type, detail: message.slice(0, 300) }));
      response.status(status).json({ error: message });
    }
  },
);
