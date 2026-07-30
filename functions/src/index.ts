import "./runtime.js";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAppCheck } from "firebase-admin/app-check";
import { getAuth } from "firebase-admin/auth";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { studioHubCors } from "./security/cors.js";
export { crmCommand } from "./crm/commands.js";
export { publicLeadIntake } from "./crm/public-lead.js";
export { workflowCommand } from "./workflow/commands.js";
export { bookingCommand } from "./booking/commands.js";
export { publicConsultationScheduling } from "./booking/public-scheduling.js";
export { proposalCommand } from "./booking/proposals.js";
export { docusignWebhook, quickbooksWebhook } from "./booking/webhooks.js";
export { planningCommand } from "./planning/commands.js";
export { sendgridInboundCoi } from "./planning/inbound.js";
export { sendgridEventWebhook } from "./communications/sendgrid-events.js";
export {
  communicationsCommand,
  scheduledEmailRelease,
} from "./communications/commands.js";
export {
  crewCascadeExpiryScheduler,
  crewCommand,
} from "./crew/commands.js";
export { crewInvitationCommand } from "./crew/invitations.js";
export { clientInvitationCommand } from "./client/invitations.js";
export { postEventCommand } from "./post-event/commands.js";
export {
  albumReminderScheduler,
  reviewRequestScheduler,
} from "./post-event/jobs.js";
export { billingCommand, stripeWebhook } from "./saas/stripe.js";
export { saasAdminCommand } from "./saas/admin.js";
export { operationsHealthScheduler } from "./saas/jobs.js";
export { tenantOnboardingCommand } from "./saas/onboarding.js";
export { tenantBrandingCommand } from "./saas/branding.js";
export { membershipCommand } from "./saas/memberships.js";
export { operationsJobScheduler } from "./operations/jobs.js";
export {
  aiJobTaskDispatch,
  emailJobTaskDispatch,
  operationsTaskWorker,
  pdfJobTaskDispatch,
  providerJobTaskDispatch,
} from "./operations/task-queue.js";
export { fileSafetyOnFinalize } from "./operations/file-safety.js";
export { studioImportCommand } from "./studio-import/commands.js";
export { integrationOAuth } from "./integrations/oauth.js";
export {
  tenantDataCommand,
  tenantExportDownload,
  tenantExportScheduler,
} from "./saas/data-lifecycle.js";
export { supportTenantSummary } from "./saas/support.js";
export { finalInvoiceScheduler } from "./operations/invoice-scheduler.js";
export { aiCopilotCommand } from "./ai/copilot.js";
export { aiScheduleCommand } from "./ai/schedule.js";
export { aiActionCommand } from "./ai/actions.js";
export { authEmailCommand } from "./auth/emails.js";
export {
  automationRetryScheduler,
  consumeDomainEvent,
  domainEventOutboxScheduler,
  normalizeDomainEvent,
  processDomainEvent,
  relativeDateScheduler,
} from "./automation/runtime.js";

if (getApps().length === 0) {
  initializeApp();
}

const sessionRequestSchema = z.object({
  idToken: z.string().min(20),
});

const fiveDaysMs = 5 * 24 * 60 * 60 * 1000;

export const createSession = onRequest(
  {
    cors: studioHubCors,
    invoker: "private",
  },
  async (request, response) => {
    if (request.method !== "POST") {
      response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
      return;
    }

    if (process.env.FUNCTIONS_EMULATOR !== "true") {
      const appCheckToken = request.header("x-firebase-appcheck");
      if (!appCheckToken) {
        response.status(401).json({ error: "APP_CHECK_REQUIRED" });
        return;
      }
      try {
        await getAppCheck().verifyToken(appCheckToken);
      } catch {
        response.status(401).json({ error: "INVALID_APP_CHECK_TOKEN" });
        return;
      }
    }

    const csrfCookie = request.cookies["__Host-studiohub_csrf"];
    const csrfHeader = request.header("x-studiohub-csrf");
    if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
      response.status(403).json({ error: "CSRF_VALIDATION_FAILED" });
      return;
    }

    const parsed = sessionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "INVALID_REQUEST" });
      return;
    }

    try {
      const decoded = await getAuth().verifyIdToken(parsed.data.idToken, true);
      if (!decoded.email_verified) {
        response.status(403).json({ error: "EMAIL_NOT_VERIFIED" });
        return;
      }

      const sessionCookie = await getAuth().createSessionCookie(
        parsed.data.idToken,
        {
          expiresIn: fiveDaysMs,
        },
      );
      response.setHeader(
        "Set-Cookie",
        `__Host-studiohub_session=${sessionCookie}; Max-Age=${fiveDaysMs / 1000}; Path=/; HttpOnly; Secure; SameSite=Lax`,
      );
      response.status(204).send();
    } catch {
      response.status(401).json({ error: "INVALID_ID_TOKEN" });
    }
  },
);

export const health = onRequest(
  { cors: false, invoker: "private" },
  (_request, response) => {
    response.status(200).json({
      service: "studiohub-functions",
      status: "ok",
      timestamp: new Date().toISOString(),
    });
  },
);
