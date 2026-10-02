import { createHash, randomBytes } from "node:crypto";
import {
  coiSettingsInput,
  readCoiSettings,
  saveCoiSettings,
  venueKey,
  venueProfileFrom,
  venueProfileId,
} from "../coi/automation.js";
import {
  approveAndSendCoi,
  approveAndSendCoiInput,
  approvePreparedCoi,
  approvePreparedCoiInput,
  attachCoiUpload,
  attachCoiUploadInput,
  completeCoiDetails,
  completeCoiDetailsInput,
  resendCoi,
  resendCoiInput,
} from "../coi/actions.js";
import { coiRequestIsOpen } from "../coi/corrections.js";
import { getFirestore, type DocumentData } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { requireAppCheck, requireIdentity } from "../crm/security.js";
import {
  requireActiveSubscription,
  requireEntitlement,
} from "../saas/entitlement-guard.js";
import { productEvent } from "../operations/product-events.js";
import { studioHubCors } from "../security/cors.js";
import { mintRunOfShowShare, shareIdFor } from "./share-mint.js";
import { parsePlannerTimeline } from "./timeline-authority.js";
import {
  mergeQuestionnaireAnswers,
  questionnaireFieldRules,
} from "./questionnaire-answers.js";
import {
  assertReopenable,
  assertResendable,
  assertWithdrawable,
  isReturned,
  liveAssignmentFor,
  statusAfterSave,
  submittedAtAfterSave,
} from "./questionnaire-lifecycle.js";
import { sameItemCrew, withCrewIds } from "./item-crew.js";
import { sortScheduleItems } from "./item-order.js";
import { studioNotificationAddress } from "../communications/notify-address.js";
import { questionnaireLinkFor } from "./questionnaire-link.js";
import { queuePartnerSends } from "../client/partner-invitations.js";
import { refreshResponsePrefill, refreshResponsePrefillWithChoices } from "./job-prefill.js";
import { sendNewQuestionnaire } from "./send-questionnaire.js";
import {
  INQUIRY_FORM_EVENT_TYPES,
  INQUIRY_FORM_SETTINGS_PATH,
} from "../intake/inquiry-form.js";
import {
  assertStudioMayRecordAnswer,
  revisedTimelineEmail,
  staleVendorShares,
} from "./schedule-lifecycle.js";
import { detailsLocked, detailsLockOn, resolvePlanningTimeline } from "./planning-timeline.js";
import { decideDetailChange, requestDetailChange } from "./detail-changes.js";
import { lockingFieldIds } from "./details-lock.js";

const item = z.object({
  id: z.string(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  title: z.string().min(1),
  description: z.string(),
  location: z.string().nullable(),
  address: z.string().nullable(),
  travelMinutes: z.number().int().nonnegative(),
  // Anyone on the segment, any trade (item-crew.ts). Optional both ways: a
  // browser still on the old bundle sends only photographerIds, a new one
  // sends both, and publishing writes both from whichever arrived.
  crewIds: z.array(z.string()).optional(),
  photographerIds: z.array(z.string()).default([]),
  participants: z.array(z.string()),
  vendorContactIds: z.array(z.string()),
  equipment: z.array(z.string()),
  notes: z.string().nullable(),
  visibility: z.enum(["studio", "client", "crew", "shared"]),
  blockingIssues: z.array(z.string()),
  sourceReferences: z
    .array(
      z.object({
        type: z.enum([
          "project_fact",
          "questionnaire_answer",
          "timing_rule",
          "package_fact",
          "crew_fact",
          "assumption",
        ]),
        sourceId: z.string().min(1),
        label: z.string().min(1),
      }),
    )
    .optional(),
});
const questionnaireField = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(200),
  type: z.enum([
    "text",
    "long_text",
    "email",
    "phone",
    "date",
    "time",
    "address",
    "dropdown",
    "multi_select",
    "radio",
    "checkbox",
    "file",
    "contact",
    "repeating_group",
    "acknowledgement",
    "information",
  ]),
  required: z.boolean(),
  locked: z.boolean(),
  internalOnly: z.boolean(),
  crewVisible: z.boolean().optional(),
  options: z.array(z.string()),
  conditionalOn: z
    .object({ fieldId: z.string(), equals: z.unknown() })
    .nullable(),
  // A note under the question, "TBD" allowed, a suggested time (field-extras.ts).
  help: z.string().max(500).optional(),
  allowTbd: z.boolean().optional(),
  suggestedFrom: z
    .object({ fieldId: z.string().min(1), minutes: z.number().int().min(-720).max(720) })
    .optional(),
});
const command = z.discriminatedUnion("type", [
  z.object({
    /**
     * After the lock, a couple asking to change where or when (planning/
     * details-lock.ts): the studio accepts or declines it on Today.
     */
    type: z.literal("requestDetailChange"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      responseId: z.string().min(1),
      projectId: z.string().min(1),
      fieldId: z.string().min(1).max(200),
      value: z.unknown(),
      note: z.string().max(1000).nullable().default(null),
    }),
  }),
  z.object({
    /** The studio's answer to a couple's change request. Accepting changes the answer and tells them. */
    type: z.literal("decideDetailChange"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      requestId: z.string().min(1),
      projectId: z.string().min(1),
      decision: z.enum(["accept", "decline"]),
    }),
  }),
  z.object({
    /** When the planning form goes out and when details lock (planning-timeline.ts). Owner or admin. */
    type: z.literal("setPlanningTimeline"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      formMonthsBefore: z.number().int().min(1).max(12),
      formSend: z.enum(["remind", "auto"]),
      formTemplateId: z.string().min(1).max(200).nullable(),
      lockDaysBefore: z.number().int().min(7).max(90),
    }),
  }),
  z.object({
    /**
     * Fill a sent form's blanks from what the job knows now, as the couple
     * (or studio) opens it (planning/job-prefill.ts). Never a touched field.
     */
    type: z.literal("refreshQuestionnairePrefill"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({ responseId: z.string(), projectId: z.string() }),
  }),
  z.object({
    type: z.literal("saveQuestionnaire"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      responseId: z.string(),
      projectId: z.string(),
      answers: z.record(z.string(), z.unknown()),
      submit: z.boolean(),
    }),
  }),
  z.object({
    type: z.literal("createQuestionnaireTemplate"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      name: z.string().min(2).max(160),
      eventTypeId: z.string().min(1),
      status: z.enum(["draft", "active"]),
      sections: z
        .array(
          z.object({
            id: z.string().min(1),
            title: z.string().min(1).max(160),
            fields: z.array(questionnaireField).min(1),
          }),
        )
        .min(1),
      dueDaysBeforeEvent: z.number().int().nonnegative().max(365),
      reminderDaysBeforeDue: z.array(z.number().int().nonnegative().max(365)),
      /** A copy of one of StudioCue's recommended forms. */
      recommendedId: z.string().min(1).max(80).optional(),
    }),
  }),
  z.object({
    /**
     * Correct a questionnaire template.
     *
     * Templates could be created and never changed: `questionnaireTemplates` is
     * `allow write: if false` in the rules and had only a create command. A
     * typo in a form you send every client was permanent, and the only recourse
     * was a second template sitting beside the first.
     *
     * Editing bumps the version rather than rewriting history in place, for the
     * same reason proposals and schedules do: a response already collected was
     * answered against the template as it stood, and `templateVersion` on the
     * response is what says which.
     */
    type: z.literal("updateQuestionnaireTemplate"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      templateId: z.string().min(1),
      name: z.string().min(2).max(160),
      status: z.enum(["draft", "active", "archived"]),
      sections: z
        .array(
          z.object({
            id: z.string().min(1),
            title: z.string().min(1).max(160),
            fields: z.array(questionnaireField).min(1),
          }),
        )
        .min(1),
      dueDaysBeforeEvent: z.number().int().nonnegative().max(365),
      reminderDaysBeforeDue: z.array(z.number().int().nonnegative().max(365)),
    }),
  }),
  z.object({
    /**
     * The studio's event form for new wedding inquiries, or none.
     *
     * Couples are asked to fill it in on their inquiry page before they pick a
     * consultation time (intake/inquiry-form.ts). Stored on the studio's
     * inquiry settings, leadCaptureSettings/{tenantId}.inquiryEventForm.
     */
    type: z.literal("setInquiryEventForm"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      templateId: z.string().min(1).max(200).nullable(),
    }),
  }),
  z.object({
    type: z.literal("assignQuestionnaire"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string(),
      templateId: z.string(),
    }),
  }),
  z.object({
    /**
     * Hand a sent-back questionnaire to the couple again, and tell them.
     *
     * After they submit, the couple is refused changes, and the only way back
     * was a second copy of the form. The crew brief stays as last submitted
     * until they send it again (questionnaire-lifecycle.ts).
     */
    type: z.literal("reopenQuestionnaire"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string(),
      responseId: z.string().min(1),
      note: z.string().trim().max(2000).default(""),
    }),
  }),
  z.object({
    /** Take back a form the couple has not sent. Archive, never delete. */
    type: z.literal("withdrawQuestionnaire"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string(),
      responseId: z.string().min(1),
    }),
  }),
  z.object({
    /** Email the couple the same form again: a reminder, not a second copy. */
    type: z.literal("resendQuestionnaire"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string(),
      responseId: z.string().min(1),
    }),
  }),
  z.object({
    type: z.literal("saveTimingRule"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      ruleId: z.string().nullable(),
      name: z.string().min(2).max(160),
      eventTypeId: z.string().min(1).max(80),
      anchor: z.string().min(1).max(120),
      offsetMinutes: z.number().int().min(-1440).max(1440),
      durationMinutes: z.number().int().positive().max(1440),
      bufferBeforeMinutes: z.number().int().nonnegative().max(600),
      bufferAfterMinutes: z.number().int().nonnegative().max(600),
      active: z.boolean(),
    }),
  }),
  z.object({
    type: z.literal("createVendor"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string(),
      company: z.string().min(1),
      contactName: z.string(),
      email: z.string().email().nullable(),
      type: z.string().min(1),
    }),
  }),
  z.object({
    /**
     * Correct a vendor or venue.
     *
     * `vendors` is `allow write: if false` in the rules and had only a create
     * command, so the Vendors page offered exactly one control — "Add vendor" —
     * and nothing else, ever. A venue that changes its contact, a florist who
     * changes email, a company name typed wrong: all permanent, and the venue
     * details feed the COI request that goes to the venue's own insurer.
     */
    type: z.literal("updateVendor"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      vendorId: z.string().min(1),
      company: z.string().trim().min(1).max(200),
      contactName: z.string().trim().max(160),
      email: z.string().email().nullable(),
      phone: z.string().max(40).nullable().default(null),
      type: z.string().min(1).max(80),
      website: z.string().url().nullable().default(null),
      notes: z.string().max(2000).nullable().default(null),
    }),
  }),
  z.object({
    /**
     * Take a vendor out of the working list. Archive, never delete: a vendor is
     * named on insurance requirements and project records that must keep
     * making sense.
     */
    type: z.literal("archiveVendor"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      vendorId: z.string().min(1),
      restore: z.boolean().default(false),
    }),
  }),
  z.object({
    type: z.literal("createCoiRequest"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string(),
      certificateHolder: z.string().min(2).max(300),
      venueLegalName: z.string().min(2).max(300),
      venueAddress: z.string().min(5).max(500),
      eventDate: z.string().date(),
      coverageTypes: z.array(z.string().min(1)).min(1),
      requiredLimits: z.record(z.string(), z.number().nonnegative()),
      additionalInsuredWording: z.string().max(2000).nullable(),
      waiverOfSubrogation: z.boolean(),
      primaryNoncontributory: z.boolean(),
      specialInstructions: z.string().max(3000).nullable(),
      // Needed to send it on, not to ask for it (H3): the venue's address
      // can follow once the certificate is back.
      submissionEmail: z.string().email().nullable().default(null),
      dueDate: z.string().date(),
      // The saved agent when omitted (Settings → Insurance).
      insuranceAgentEmail: z.string().email().nullable().default(null),
    }),
  }),
  z.object({
    type: z.literal("decideCoi"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string(),
      requestId: z.string(),
      decision: z.enum(["approved", "rejected"]),
      reason: z.string().min(5),
    }),
  }),
  z.object({
    type: z.literal("publishSchedule"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string(),
      timezone: z.string(),
      items: z.array(item).min(1),
      coverageMinutes: z.number().int().positive(),
    }),
  }),
  z.object({
    type: z.literal("approveSchedule"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string(),
      scheduleId: z.string(),
      decision: z.enum(["approved", "changes_requested"]),
      notes: z.string().max(2000),
      /**
       * The studio recording the couple's answer given another way (on the
       * phone, by email). Required from the studio, ignored from the couple:
       * an approval the couple never gave in the portal carries who gave it,
       * how and when, or it is not evidence of anything.
       */
      recordedAnswer: z
        .object({
          givenBy: z.string().trim().min(2).max(160),
          method: z.enum(["in_person", "phone", "email", "text", "other"]),
          givenOn: z.string().date(),
        })
        .optional(),
    }),
  }),
  z.object({
    type: z.literal("sendCoiToVenue"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string(),
      requestId: z.string(),
    }),
  }),
  // H3 — COI automation (functions/src/coi/).
  z.object({
    type: z.literal("saveCoiSettings"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: coiSettingsInput,
  }),
  z.object({
    type: z.literal("approvePreparedCoi"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: approvePreparedCoiInput,
  }),
  z.object({
    type: z.literal("completeCoiDetails"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: completeCoiDetailsInput,
  }),
  z.object({
    type: z.literal("attachCoiUpload"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: attachCoiUploadInput,
  }),
  z.object({
    type: z.literal("approveAndSendCoi"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: approveAndSendCoiInput,
  }),
  z.object({
    // Send it again with corrected details — to the agent, or to the venue
    // at the right address (coi/corrections.ts planCoiResend).
    type: z.literal("resendCoi"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: resendCoiInput,
  }),
  z.object({
    /**
     * Whose timeline is the real one for this wedding, and the planner's
     * latest version when it's theirs. See
     * features/schedules/timeline-authority.ts.
     */
    type: z.literal("setTimelineAuthority"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string(),
      authority: z.enum(["studio", "planner"]),
      plannerName: z.string().trim().max(120).optional(),
      /** The planner's timeline as they sent it. Omit to keep the saved one. */
      plannerTimelineText: z.string().max(20_000).optional(),
    }),
  }),
  z.object({
    /**
     * Whether this venue asks for proof of insurance.
     *
     * A job at a venue that does not was told to request a certificate for
     * the whole of its life, and counted the missing certificate among its
     * readiness blockers. The only escape was waiving the `coi-approved`
     * checkpoint, which records the studio accepting a risk — not the fact
     * that nobody ever asked.
     *
     * Deliberately not entitlement-gated: saying "this venue does not need
     * one" must stay available to a studio whose COI capability is switched
     * off, or the job stays blocked with no way out.
     */
    type: z.literal("setInsuranceRequirement"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string(),
      insuranceRequired: z.enum(["unknown", "required", "not_required"]),
    }),
  }),
  z.object({
    /**
     * Share the published run of show with an external wedding vendor.
     *
     * Not the crew path: no offer, no pay, no seat. The vendor gets a read-only
     * link to the parts of the timeline that concern them and a way to confirm.
     * The message is composed and approved by the operator (Cue drafts a
     * starting point client-side) — the command only carries what a human
     * approved.
     */
    type: z.literal("shareRunOfShow"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string(),
      vendorContactId: z.string().min(1),
      scope: z.enum(["vendor", "full"]).default("vendor"),
      message: z.string().max(4000),
    }),
  }),
  z.object({
    /**
     * Send the current timeline to every vendor still holding an older one.
     *
     * Each stale share is re-pointed at the current version with a fresh link
     * (the old one stops opening, as a single re-share already did), and a
     * vendor with an email address is sent the new link. Ones without an
     * address come back with their link for the studio to pass on.
     */
    type: z.literal("refreshRunOfShowShares"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string(),
      message: z.string().max(4000).default(""),
    }),
  }),
  z.object({
    type: z.literal("revokeRunOfShowShare"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string(),
      vendorContactId: z.string().min(1),
    }),
  }),
]);
const internalRoles = new Set([
  "studio_owner",
  "studio_admin",
  "studio_coordinator",
]);
const plainRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
function stable(scope: string, tenantId: string, key: string) {
  return `${scope}_${createHash("sha256").update(`${tenantId}:${key}`).digest("hex").slice(0, 32)}`;
}

export const planningCommand = onRequest(
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
      const parsed = command.parse(request.body);
      const db = getFirestore();
      const membership = await db
        .doc(`memberships/${parsed.tenantId}_${identity.uid}`)
        .get();
      if (!membership.exists || membership.get("status") !== "active")
        throw new Error("FORBIDDEN");
      // Whole-product billing gate (studio commands require a live subscription).
      await requireActiveSubscription(db, parsed.tenantId);
      const role = String(membership.get("role"));
      const projectIds = membership.get("projectIds") as unknown;
      const projectId =
        "projectId" in parsed.input ? parsed.input.projectId : null;
      if (
        !["studio_owner", "studio_admin"].includes(role) &&
        (!projectId ||
          !Array.isArray(projectIds) ||
          !projectIds.includes(projectId))
      )
        throw new Error("FORBIDDEN");
      // COI is a plan capability, and until now it was one in name only:
      // published on the pricing page, checked nowhere. This also asks
      // whether the tenant is still paying, which nothing outside AI quota
      // did — a cancelled subscription kept chasing certificates for free.
      if (
        parsed.type === "createCoiRequest" ||
        parsed.type === "decideCoi" ||
        parsed.type === "sendCoiToVenue" ||
        parsed.type === "approvePreparedCoi" ||
        parsed.type === "completeCoiDetails" ||
        parsed.type === "attachCoiUpload" ||
        parsed.type === "approveAndSendCoi" ||
        parsed.type === "resendCoi"
      ) {
        await requireEntitlement(db, parsed.tenantId, "coiEnabled");
      }
      const execution = db.doc(
        `commandExecutions/${stable("planning", parsed.tenantId, parsed.idempotencyKey)}`,
      );
      const prior = await execution.get();
      if (prior.exists) {
        response.status(200).json(prior.get("result"));
        return;
      }
      const now = new Date().toISOString();
      let result: Record<string, unknown>;
      if (parsed.type === "setPlanningTimeline") {
        if (!["studio_owner", "studio_admin"].includes(role)) throw new Error("FORBIDDEN");
        if (parsed.input.formTemplateId) {
          const template = await db.doc(`questionnaireTemplates/${parsed.input.formTemplateId}`).get();
          if (!template.exists || template.get("tenantId") !== parsed.tenantId) throw new Error("QUESTIONNAIRE_TEMPLATE_NOT_FOUND");
        }
        const tenantReference = db.doc(`tenants/${parsed.tenantId}`);
        const before = (await tenantReference.get()).get("planningTimeline") ?? null;
        const timeline = { ...parsed.input, updatedAt: now, updatedBy: identity.uid };
        const auditId = stable("audit_planning_timeline", parsed.tenantId, parsed.idempotencyKey);
        const batch = db.batch();
        batch.set(tenantReference, { planningTimeline: timeline }, { merge: true });
        batch.set(db.doc(`auditEvents/${auditId}`), {
          id: auditId,
          tenantId: parsed.tenantId,
          projectId: null,
          actorId: identity.uid,
          actorType: "user",
          action: "tenant.planning_timeline_updated",
          entityType: "tenant",
          entityId: parsed.tenantId,
          timestamp: now,
          before,
          after: parsed.input,
          ipAddress: null,
          userAgent: null,
          correlationId: auditId,
          automationRunId: null,
          providerEventId: null,
        });
        await batch.commit();
        result = { planningTimeline: parsed.input };
      } else if (parsed.type === "requestDetailChange") {
        if (role !== "client") throw new Error("FORBIDDEN");
        result = await requestDetailChange(db, {
          tenantId: parsed.tenantId,
          ...parsed.input,
          actorId: identity.uid,
          now,
        });
      } else if (parsed.type === "decideDetailChange") {
        if (!internalRoles.has(role)) throw new Error("FORBIDDEN");
        result = await decideDetailChange(db, {
          tenantId: parsed.tenantId,
          ...parsed.input,
          actorId: identity.uid,
          now,
        });
      } else if (parsed.type === "refreshQuestionnairePrefill") {
        if (role !== "client" && !internalRoles.has(role)) throw new Error("FORBIDDEN");
        const { filled, roleChoices } = await refreshResponsePrefillWithChoices(db, {
          tenantId: parsed.tenantId,
          responseId: parsed.input.responseId,
          projectId: parsed.input.projectId,
          // Opening a form never spends the studio's AI allowance; a map
          // made when it was sent is used if there is one.
          allowAi: false,
          actorId: identity.uid,
        });
        // What the form needs to know to show itself: whether the final
        // details have locked, which answers that covers, and the changes
        // already asked for (the couple can't read either record directly).
        const [projectSnapshot, tenantSnapshot, responseSnapshot, pending] = await Promise.all([
          db.doc(`projects/${parsed.input.projectId}`).get(),
          db.doc(`tenants/${parsed.tenantId}`).get(),
          db.doc(`questionnaireResponses/${parsed.input.responseId}`).get(),
          db
            .collection("detailChangeRequests")
            .where("tenantId", "==", parsed.tenantId)
            .where("responseId", "==", parsed.input.responseId)
            .limit(50)
            .get(),
        ]);
        const timeline = resolvePlanningTimeline(tenantSnapshot.get("planningTimeline"));
        const eventDate = String(projectSnapshot.get("eventDate") ?? "");
        result = {
          filled,
          // "I'm the bride / I'm the groom", for a form that asks by role.
          roleChoices,
          locked: detailsLocked(eventDate, now.slice(0, 10), timeline),
          lockOn: detailsLockOn(eventDate, timeline),
          lockingFieldIds: [...lockingFieldIds(plainRecord(responseSnapshot.get("templateSnapshot")).sections)],
          pendingChanges: pending.docs
            .filter((request) => request.get("status") === "pending")
            .map((request) => ({ fieldId: String(request.get("fieldId")), to: request.get("to") ?? null })),
        };
      } else if (parsed.type === "saveQuestionnaire") {
        const reference = db.doc(
          `questionnaireResponses/${parsed.input.responseId}`,
        );
        const snapshot = await reference.get();
        if (
          !snapshot.exists ||
          snapshot.get("tenantId") !== parsed.tenantId ||
          snapshot.get("projectId") !== parsed.input.projectId
        )
          throw new Error("RESPONSE_NOT_FOUND");
        const byClient = role === "client";
        if (!byClient && !internalRoles.has(role)) throw new Error("FORBIDDEN");
        // Sent back, a couple's form is still theirs to keep current (GR
        // Productions, 2026-10-02): little things any time, and locations and
        // times until their final details lock (planning/details-lock.ts).
        // It stays submitted; the studio sees each change on the job.
        const priorStatus = String(snapshot.get("status") ?? "not_started");
        const amendingReturned = byClient && isReturned(priorStatus);
        const nextStatus = amendingReturned
          ? priorStatus
          : statusAfterSave({
              prior: priorStatus,
              submit: parsed.input.submit,
              byClient,
            });
        const priorAnswers = plainRecord(snapshot.get("answers"));
        const nextAnswers = mergeQuestionnaireAnswers({
          prior: priorAnswers,
          incoming: parsed.input.answers,
          rules: questionnaireFieldRules(snapshot.get("templateSnapshot")),
          byClient,
        });
        const answerProvenance = {
          ...plainRecord(snapshot.get("answerProvenance")),
        };
        const changes = Object.entries(nextAnswers).flatMap(
          ([fieldId, after]) => {
            const before = priorAnswers[fieldId];
            if (JSON.stringify(before) === JSON.stringify(after)) return [];
            answerProvenance[fieldId] = {
              sourceType: role === "client" ? "client_answer" : "studio_answer",
              sourceId: fieldId,
              label: role === "client" ? "Client answer" : "Studio answer",
              verified: role !== "client",
              changedAt: now,
              changedFrom: before ?? null,
            };
            return [
              {
                fieldId,
                before: before ?? null,
                after,
                affectsPlanning: true,
                changedAt: now,
                changedBy: identity.uid,
              },
            ];
          },
        );
        // After the lock, a couple's change to where or when they already gave
        // is a request the studio accepts, never a save (requestDetailChange).
        // A form they haven't sent back yet is theirs to fill in, lock or not:
        // a planning form sent three weeks out refused every time on it.
        if (amendingReturned && changes.length) {
          const [projectSnapshot, tenantSnapshot] = await Promise.all([
            db.doc(`projects/${parsed.input.projectId}`).get(),
            db.doc(`tenants/${parsed.tenantId}`).get(),
          ]);
          const locked = detailsLocked(
            String(projectSnapshot.get("eventDate") ?? ""),
            now.slice(0, 10),
            resolvePlanningTimeline(tenantSnapshot.get("planningTimeline")),
          );
          if (locked) {
            const locking = lockingFieldIds(plainRecord(snapshot.get("templateSnapshot")).sections);
            if (changes.some((change) => locking.has(change.fieldId)))
              throw new Error("DETAILS_LOCKED");
          }
        }
        const changeHistory = Array.isArray(snapshot.get("changeHistory"))
          ? (snapshot.get("changeHistory") as unknown[])
          : [];
        const batch = db.batch();
        if (amendingReturned && changes.length) {
          // The studio hears about a change to a form it already had.
          const receiptId = stable("receipt_form_change", parsed.tenantId, parsed.idempotencyKey);
          batch.set(db.doc(`actionReceipts/${receiptId}`), {
            id: receiptId,
            tenantId: parsed.tenantId,
            projectId: parsed.input.projectId,
            title: `The couple updated ${changes.length === 1 ? "an answer" : `${changes.length} answers`} on ${String(snapshot.get("templateName") ?? "their form")}`,
            summary: "Changed after they sent it back — see the form on the job.",
            status: "completed",
            source: "client_form_update",
            affectedEntityType: "questionnaireResponse",
            affectedEntityId: parsed.input.responseId,
            providerEvidence: null,
            reversible: false,
            retryable: false,
            canCancel: false,
            canRetry: false,
            createdAt: now,
            updatedAt: now,
          });
        }
        batch.update(reference, {
          answers: nextAnswers,
          answerProvenance,
          changeHistory: [...changeHistory, ...changes].slice(-200),
          hasPlanningChanges: changes.length > 0,
          status: nextStatus,
          completionPercent: isReturned(nextStatus)
            ? 100
            : snapshot.get("completionPercent"),
          // Keeping a sent form current isn't sending it again.
          submittedAt: amendingReturned
            ? (snapshot.get("submittedAt") ?? now)
            : submittedAtAfterSave({
                nextStatus,
                priorSubmittedAt: snapshot.get("submittedAt"),
                byClient,
                now,
              }),
          // The couple sending it again closes the reopening.
          ...(byClient && isReturned(nextStatus) ? { reopenedAt: null } : {}),
          ...(!byClient && changes.length
            ? { studioEditedAt: now, studioEditedBy: identity.uid }
            : {}),
          updatedAt: now,
          updatedBy: identity.uid,
        });
        // A studio correction to a returned form changes what the analysis
        // was run on, so it runs again; the crew brief follows the write.
        // A couple keeping a sent form current doesn't re-run it each time.
        if (
          (parsed.input.submit && !amendingReturned) ||
          (!byClient && isReturned(nextStatus) && changes.length > 0)
        ) {
          batch.set(
            db.doc(`aiJobs/questionnaire_${parsed.input.responseId}`),
            {
              id: `questionnaire_${parsed.input.responseId}`,
              tenantId: parsed.tenantId,
              projectId: parsed.input.projectId,
              responseId: parsed.input.responseId,
              type: "questionnaire_analysis",
              status: "queued",
              attempts: 0,
              humanReviewRequired: true,
              createdAt: now,
              updatedAt: now,
            },
            { merge: true },
          );
        }
        await batch.commit();
        result = {
          responseId: parsed.input.responseId,
          status: nextStatus,
          changedFieldCount: changes.length,
        };
      } else if (
        parsed.type === "reopenQuestionnaire" ||
        parsed.type === "withdrawQuestionnaire" ||
        parsed.type === "resendQuestionnaire"
      ) {
        // Reopening changes what the crew and the couple were told is final,
        // so it is the owner's call; the other two are everyday coordination.
        if (
          parsed.type === "reopenQuestionnaire"
            ? !["studio_owner", "studio_admin"].includes(role)
            : !internalRoles.has(role)
        )
          throw new Error("FORBIDDEN");
        const reference = db.doc(
          `questionnaireResponses/${parsed.input.responseId}`,
        );
        const snapshot = await reference.get();
        if (
          !snapshot.exists ||
          snapshot.get("tenantId") !== parsed.tenantId ||
          snapshot.get("projectId") !== parsed.input.projectId ||
          snapshot.get("archivedAt")
        )
          throw new Error("RESPONSE_NOT_FOUND");
        const status = snapshot.get("status");
        const appUrl =
          process.env.NEXT_PUBLIC_APP_URL ?? "https://studiohub.app";
        const batch = db.batch();
        if (parsed.type === "reopenQuestionnaire") {
          assertReopenable(status);
          batch.update(reference, {
            status: "reopened",
            reopenedAt: now,
            reopenedBy: identity.uid,
            // Kept: the date of the submission the crew brief still shows.
            submittedAt: snapshot.get("submittedAt") ?? null,
            updatedAt: now,
            updatedBy: identity.uid,
          });
          // Written by the studio and sent on their say-so, so the ordinary
          // message template, not an automated one.
          const note = parsed.input.note.trim();
          batch.create(
            db.doc(
              `emailJobs/${stable("questionnaire_reopened", parsed.tenantId, parsed.idempotencyKey)}`,
            ),
            {
              id: stable("questionnaire_reopened", parsed.tenantId, parsed.idempotencyKey),
              tenantId: parsed.tenantId,
              projectId: parsed.input.projectId,
              type: "manual_message",
              questionnaireResponseId: parsed.input.responseId,
              customSubject: "Your questionnaire is open again",
              customBody: [
                note ||
                  "We've reopened your questionnaire so you can change your answers.",
                "Everything you sent is still there. Make your changes, then send it back to us.",
              ].join("\n\n"),
              actionLabel: "Update your answers",
              actionUrl: `${appUrl}/client/questionnaire`,
              status: "queued",
              attempts: 0,
              createdAt: now,
              updatedAt: now,
            },
          );
        } else if (parsed.type === "withdrawQuestionnaire") {
          assertWithdrawable(status);
          batch.update(reference, {
            status: "withdrawn",
            withdrawnAt: now,
            withdrawnBy: identity.uid,
            archivedAt: now,
            updatedAt: now,
            updatedBy: identity.uid,
          });
        } else {
          assertResendable(status);
          // One reminder per press. The id names the press, so a retried
          // request is the same email, not a second one.
          const jobId = stable("questionnaire_resend", parsed.tenantId, parsed.idempotencyKey);
          // Still not in the portal (sent to an inquiry, say)? The reminder
          // carries the invitation too (questionnaire-link.ts).
          const project = await db.doc(`projects/${parsed.input.projectId}`).get();
          const link = await questionnaireLinkFor(db, {
            tenantId: parsed.tenantId,
            projectId: parsed.input.projectId,
            clientContactIds:
              project.get("tenantId") === parsed.tenantId
                ? project.get("clientContactIds")
                : null,
            emailJobId: jobId,
            actorId: identity.uid,
            now,
          });
          if (link.invitationWrite)
            batch.set(link.invitationWrite.reference, link.invitationWrite.data, {
              merge: true,
            });
          const reminderJob = {
            id: jobId,
            tenantId: parsed.tenantId,
            projectId: parsed.input.projectId,
            type: "questionnaire_reminder",
            actionUrl: link.actionUrl,
            questionnaireResponseId: parsed.input.responseId,
            soleRecipient: link.partnerSends.length > 0,
            status: "queued",
            attempts: 0,
            createdAt: now,
            updatedAt: now,
          };
          batch.create(db.doc(`emailJobs/${jobId}`), reminderJob);
          queuePartnerSends(db, batch, reminderJob, link.partnerSends);
          // Not updatedAt: a reminder isn't an edit (see the scheduler).
          batch.update(reference, { lastReminderAt: now });
        }
        const auditReference = db.doc(
          `auditEvents/${stable("questionnaire_audit", parsed.tenantId, parsed.idempotencyKey)}`,
        );
        batch.create(auditReference, {
          id: auditReference.id,
          tenantId: parsed.tenantId,
          projectId: parsed.input.projectId,
          actorId: identity.uid,
          actorType: "user",
          action: `questionnaire.${parsed.type.replace("Questionnaire", "")}`,
          entityType: "questionnaireResponse",
          entityId: parsed.input.responseId,
          timestamp: now,
          before: { status: status ?? null },
          after: null,
          ipAddress: null,
          userAgent: request.header("user-agent") ?? null,
          correlationId: parsed.idempotencyKey,
          automationRunId: null,
          providerEventId: null,
        });
        await batch.commit();
        result = {
          responseId: parsed.input.responseId,
          status:
            parsed.type === "reopenQuestionnaire"
              ? "reopened"
              : parsed.type === "withdrawQuestionnaire"
                ? "withdrawn"
                : String(status),
          emailed: parsed.type !== "withdrawQuestionnaire",
        };
      } else if (parsed.type === "createQuestionnaireTemplate") {
        if (!["studio_owner", "studio_admin"].includes(role))
          throw new Error("FORBIDDEN");
        const versions = await db
          .collection("questionnaireTemplates")
          .where("tenantId", "==", parsed.tenantId)
          .where("name", "==", parsed.input.name)
          .get();
        const version =
          Math.max(0, ...versions.docs.map((item) => Number(item.get("version")))) +
          1;
        const id = stable(
          "questionnaire_template",
          parsed.tenantId,
          parsed.idempotencyKey,
        );
        const batch = db.batch();
        if (parsed.input.status === "active") {
          for (const priorTemplate of versions.docs) {
            if (priorTemplate.get("status") === "active")
              batch.update(priorTemplate.ref, {
                status: "archived",
                archivedAt: now,
                updatedAt: now,
                updatedBy: identity.uid,
              });
          }
        }
        batch.create(db.doc(`questionnaireTemplates/${id}`), {
          id,
          tenantId: parsed.tenantId,
          ...parsed.input,
          version,
          createdAt: now,
          updatedAt: now,
          createdBy: identity.uid,
          updatedBy: identity.uid,
          archivedAt: null,
        });
        await batch.commit();
        result = { templateId: id, version, status: parsed.input.status };
      } else if (parsed.type === "updateQuestionnaireTemplate") {
        if (!["studio_owner", "studio_admin"].includes(role))
          throw new Error("FORBIDDEN");
        const current = await db
          .doc(`questionnaireTemplates/${parsed.input.templateId}`)
          .get();
        if (
          !current.exists ||
          current.get("tenantId") !== parsed.tenantId
        ) {
          throw new Error("QUESTIONNAIRE_TEMPLATE_NOT_FOUND");
        }
        /**
         * A new version, not a rewrite.
         *
         * `questionnaireResponses` carry `templateVersion`, and a couple who
         * has already answered answered the template as it stood. Editing the
         * fields under them would leave their answers describing questions
         * nobody asked. So this supersedes: the edited template becomes the
         * next version, and the one it replaces is archived if it was live.
         */
        const eventTypeId = String(current.get("eventTypeId"));
        const siblings = await db
          .collection("questionnaireTemplates")
          .where("tenantId", "==", parsed.tenantId)
          .where("name", "==", current.get("name"))
          .get();
        const version =
          Math.max(
            0,
            ...siblings.docs.map((item) => Number(item.get("version") ?? 0)),
          ) + 1;
        const id = stable(
          "questionnaire_template",
          parsed.tenantId,
          parsed.idempotencyKey,
        );
        const batch = db.batch();
        if (parsed.input.status === "active") {
          for (const sibling of siblings.docs) {
            if (sibling.get("status") === "active") {
              batch.update(sibling.ref, {
                status: "archived",
                archivedAt: now,
                updatedAt: now,
                updatedBy: identity.uid,
              });
            }
          }
        }
        batch.create(db.doc(`questionnaireTemplates/${id}`), {
          id,
          tenantId: parsed.tenantId,
          name: parsed.input.name,
          eventTypeId,
          status: parsed.input.status,
          sections: parsed.input.sections,
          dueDaysBeforeEvent: parsed.input.dueDaysBeforeEvent,
          reminderDaysBeforeDue: parsed.input.reminderDaysBeforeDue,
          // A copy of a recommended form stays one through its edits.
          ...(current.get("recommendedId") ? { recommendedId: String(current.get("recommendedId")) } : {}),
          version,
          // What this version replaced, so the trail is readable.
          supersedesTemplateId: parsed.input.templateId,
          createdAt: now,
          updatedAt: now,
          createdBy: identity.uid,
          updatedBy: identity.uid,
          archivedAt: parsed.input.status === "archived" ? now : null,
        });
        await batch.commit();
        result = {
          templateId: id,
          version,
          status: parsed.input.status,
          supersedes: parsed.input.templateId,
        };
      } else if (parsed.type === "assignQuestionnaire") {
        if (!internalRoles.has(role)) throw new Error("FORBIDDEN");
        const [project, template] = await Promise.all([
          db.doc(`projects/${parsed.input.projectId}`).get(),
          db.doc(`questionnaireTemplates/${parsed.input.templateId}`).get(),
        ]);
        if (
          !project.exists ||
          project.get("tenantId") !== parsed.tenantId ||
          !template.exists ||
          template.get("tenantId") !== parsed.tenantId ||
          template.get("status") !== "active"
        )
          throw new Error("QUESTIONNAIRE_ASSIGNMENT_INVALID");
        // The same form sent again is a reminder about the copy they have,
        // never a second copy (questionnaire-lifecycle.ts, liveAssignmentFor).
        const onJob = await db
          .collection("questionnaireResponses")
          .where("tenantId", "==", parsed.tenantId)
          .where("projectId", "==", parsed.input.projectId)
          .get();
        const existing = liveAssignmentFor(
          onJob.docs.map((response) => ({ id: response.id, ...response.data() })),
          { id: parsed.input.templateId, name: String(template.get("name")) },
        );
        if (existing) {
          assertResendable(existing.status);
          // Sent again: what the job has learned since fills the blanks first.
          const refilled = await refreshResponsePrefill(db, {
            tenantId: parsed.tenantId,
            responseId: existing.id,
            projectId: parsed.input.projectId,
            allowAi: true,
            actorId: identity.uid,
          }).catch(() => 0);
          const jobId = stable("questionnaire_resend", parsed.tenantId, parsed.idempotencyKey);
          // A couple without portal access gets an invitation in the email,
          // not a sign-in page (questionnaire-link.ts).
          const link = await questionnaireLinkFor(db, {
            tenantId: parsed.tenantId,
            projectId: parsed.input.projectId,
            clientContactIds: project.get("clientContactIds"),
            emailJobId: jobId,
            actorId: identity.uid,
            now,
          });
          const batch = db.batch();
          const reminderJob = {
            id: jobId,
            tenantId: parsed.tenantId,
            projectId: parsed.input.projectId,
            type: "questionnaire_reminder",
            actionUrl: link.actionUrl,
            questionnaireResponseId: existing.id,
            soleRecipient: link.partnerSends.length > 0,
            status: "queued",
            attempts: 0,
            createdAt: now,
            updatedAt: now,
          };
          batch.create(db.doc(`emailJobs/${jobId}`), reminderJob);
          queuePartnerSends(db, batch, reminderJob, link.partnerSends);
          batch.update(db.doc(`questionnaireResponses/${existing.id}`), {
            lastReminderAt: now,
          });
          if (link.invitationWrite)
            batch.set(link.invitationWrite.reference, link.invitationWrite.data, {
              merge: true,
            });
          await batch.commit();
          result = {
            responseId: existing.id,
            status: String(existing.status),
            resent: true,
            prefilledFieldCount: refilled,
            invited: Boolean(link.invitationWrite),
          };
        } else {
        result = await sendNewQuestionnaire(db, {
          tenantId: parsed.tenantId,
          projectId: parsed.input.projectId,
          project,
          template,
          idempotencyKey: parsed.idempotencyKey,
          actorId: identity.uid,
          now,
          allowAi: true,
        });
        }
      } else if (parsed.type === "setInquiryEventForm") {
        // A setting that reaches every couple who writes in: the owner's call.
        if (!["studio_owner", "studio_admin"].includes(role))
          throw new Error("FORBIDDEN");
        let templateName: string | null = null;
        if (parsed.input.templateId) {
          const template = await db
            .doc(`questionnaireTemplates/${parsed.input.templateId}`)
            .get();
          if (
            !template.exists ||
            template.get("tenantId") !== parsed.tenantId ||
            template.get("status") !== "active"
          )
            throw new Error("QUESTIONNAIRE_TEMPLATE_NOT_FOUND");
          templateName = String(template.get("name") ?? "");
        }
        const settingsReference = db.doc(INQUIRY_FORM_SETTINGS_PATH(parsed.tenantId));
        const before = await settingsReference.get();
        const batch = db.batch();
        batch.set(
          settingsReference,
          {
            tenantId: parsed.tenantId,
            inquiryEventForm: parsed.input.templateId
              ? {
                  templateId: parsed.input.templateId,
                  templateName,
                  eventTypes: [...INQUIRY_FORM_EVENT_TYPES],
                  updatedAt: now,
                  updatedBy: identity.uid,
                }
              : null,
            updatedAt: now,
          },
          { merge: true },
        );
        const auditReference = db.doc(
          `auditEvents/${stable("inquiry_form_setting", parsed.tenantId, parsed.idempotencyKey)}`,
        );
        batch.create(auditReference, {
          id: auditReference.id,
          tenantId: parsed.tenantId,
          projectId: null,
          actorId: identity.uid,
          actorType: "user",
          action: "lead_capture.inquiry_event_form_set",
          entityType: "leadCaptureSettings",
          entityId: parsed.tenantId,
          timestamp: now,
          before: { inquiryEventForm: before.get("inquiryEventForm") ?? null },
          after: { templateId: parsed.input.templateId, templateName },
          ipAddress: null,
          userAgent: request.header("user-agent") ?? null,
          correlationId: parsed.idempotencyKey,
          automationRunId: null,
          providerEventId: null,
        });
        await batch.commit();
        result = { templateId: parsed.input.templateId, templateName };
      } else if (parsed.type === "saveTimingRule") {
        if (!["studio_owner", "studio_admin"].includes(role))
          throw new Error("FORBIDDEN");
        const id =
          parsed.input.ruleId ||
          stable("timing_rule", parsed.tenantId, parsed.idempotencyKey);
        const reference = db.doc(`timingRules/${id}`);
        const current = await reference.get();
        if (current.exists && current.get("tenantId") !== parsed.tenantId)
          throw new Error("TIMING_RULE_NOT_FOUND");
        const version = Number(current.get("version") ?? 0) + 1;
        await reference.set(
          {
            id,
            tenantId: parsed.tenantId,
            name: parsed.input.name,
            eventTypeId: parsed.input.eventTypeId,
            anchor: parsed.input.anchor,
            offsetMinutes: parsed.input.offsetMinutes,
            durationMinutes: parsed.input.durationMinutes,
            bufferBeforeMinutes: parsed.input.bufferBeforeMinutes,
            bufferAfterMinutes: parsed.input.bufferAfterMinutes,
            active: parsed.input.active,
            version,
            source: String(current.get("source") ?? "studio"),
            approvedAt: parsed.input.active ? now : null,
            approvedBy: parsed.input.active ? identity.uid : null,
            createdAt: current.get("createdAt") ?? now,
            createdBy: current.get("createdBy") ?? identity.uid,
            updatedAt: now,
            updatedBy: identity.uid,
            archivedAt: null,
          },
          { merge: true },
        );
        result = { ruleId: id, version, active: parsed.input.active };
      } else if (parsed.type === "createVendor") {
        if (!internalRoles.has(role)) throw new Error("FORBIDDEN");
        const id = stable("vendor", parsed.tenantId, parsed.idempotencyKey);
        await db
          .doc(`vendors/${id}`)
          .create({
            id,
            tenantId: parsed.tenantId,
            projectId: parsed.input.projectId,
            projectIds: [parsed.input.projectId],
            company: parsed.input.company,
            contactName: parsed.input.contactName,
            email: parsed.input.email,
            phone: null,
            type: parsed.input.type,
            website: null,
            address: null,
            notes: null,
            createdAt: now,
            updatedAt: now,
            createdBy: identity.uid,
            updatedBy: identity.uid,
            archivedAt: null,
          });
        result = { vendorId: id };
      } else if (parsed.type === "updateVendor") {
        if (!internalRoles.has(role)) throw new Error("FORBIDDEN");
        const reference = db.doc(`vendors/${parsed.input.vendorId}`);
        const vendor = await reference.get();
        if (
          !vendor.exists ||
          vendor.get("tenantId") !== parsed.tenantId ||
          vendor.get("archivedAt")
        ) {
          throw new Error("VENDOR_NOT_FOUND");
        }
        await reference.update({
          company: parsed.input.company,
          contactName: parsed.input.contactName,
          email: parsed.input.email,
          phone: parsed.input.phone,
          type: parsed.input.type,
          website: parsed.input.website,
          notes: parsed.input.notes,
          updatedAt: now,
          updatedBy: identity.uid,
        });
        result = { vendorId: parsed.input.vendorId, updated: true };
      } else if (parsed.type === "archiveVendor") {
        if (!internalRoles.has(role)) throw new Error("FORBIDDEN");
        const reference = db.doc(`vendors/${parsed.input.vendorId}`);
        const vendor = await reference.get();
        if (!vendor.exists || vendor.get("tenantId") !== parsed.tenantId) {
          throw new Error("VENDOR_NOT_FOUND");
        }
        const batch = db.batch();
        batch.update(reference, {
          archivedAt: parsed.input.restore ? null : now,
          updatedAt: now,
          updatedBy: identity.uid,
        });
        /**
         * A removed vendor's link stops opening.
         *
         * The link is their whole credential, and archiving left it live for
         * its full 120 days: a florist the couple let go could still read the
         * day's timeline, addresses and all. Restoring does not bring it back;
         * the studio shares again if they want to.
         */
        let revokedShares = 0;
        if (!parsed.input.restore) {
          const shares = await db
            .collection("scheduleShares")
            .where("tenantId", "==", parsed.tenantId)
            .where("vendorContactId", "==", parsed.input.vendorId)
            .get();
          for (const share of shares.docs) {
            if (share.get("status") === "revoked") continue;
            batch.update(share.ref, {
              status: "revoked",
              revokedAt: now,
              revokedReason: "vendor_archived",
              updatedAt: now,
              updatedBy: identity.uid,
            });
            revokedShares += 1;
          }
        }
        await batch.commit();
        result = {
          vendorId: parsed.input.vendorId,
          archived: !parsed.input.restore,
          revokedShares,
        };
      } else if (parsed.type === "refreshRunOfShowShares") {
        if (!internalRoles.has(role)) throw new Error("FORBIDDEN");
        const [schedules, shares, project] = await Promise.all([
          db
            .collection("schedules")
            .where("tenantId", "==", parsed.tenantId)
            .where("projectId", "==", parsed.input.projectId)
            .orderBy("version", "desc")
            .limit(1)
            .get(),
          db
            .collection("scheduleShares")
            .where("tenantId", "==", parsed.tenantId)
            .where("projectId", "==", parsed.input.projectId)
            .get(),
          db.doc(`projects/${parsed.input.projectId}`).get(),
        ]);
        const current = schedules.docs[0];
        if (!current || current.get("status") !== "published")
          throw new Error("NO_PUBLISHED_RUN_OF_SHOW");
        if (!project.exists || project.get("tenantId") !== parsed.tenantId)
          throw new Error("NOT_FOUND");
        const version = Number(current.get("version"));
        const stale = staleVendorShares(
          shares.docs.map((share) => ({
            id: share.id,
            ref: share.ref,
            status: share.get("status"),
            revokedAt: share.get("revokedAt"),
            scheduleId: share.get("scheduleId"),
            vendorContactId: String(share.get("vendorContactId") ?? ""),
            sendCount: Number(share.get("sendCount") ?? 0),
          })),
          current.id,
        );
        const vendors = await Promise.all(
          stale.map((share) =>
            db.doc(`vendors/${String(share.vendorContactId)}`).get(),
          ),
        );
        const projectName = String(project.get("name") ?? "the wedding");
        const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://studio-cue.com";
        const batch = db.batch();
        const refreshed: Array<Record<string, unknown>> = [];
        for (const [index, share] of stale.entries()) {
          const vendor = vendors[index]!;
          // An archived vendor's share should already be revoked; one made
          // before that rule is revoked now rather than refreshed.
          if (
            !vendor.exists ||
            vendor.get("tenantId") !== parsed.tenantId ||
            vendor.get("archivedAt")
          ) {
            batch.update(share.ref, {
              status: "revoked",
              revokedAt: now,
              revokedReason: "vendor_archived",
              updatedAt: now,
              updatedBy: identity.uid,
            });
            continue;
          }
          const minted = mintRunOfShowShare({
            tenantId: parsed.tenantId,
            projectId: parsed.input.projectId,
            vendorContactId: String(share.vendorContactId),
            appUrl,
          });
          const message = parsed.input.message.trim();
          batch.update(share.ref, {
            scheduleId: current.id,
            sharedVersion: version,
            tokenHash: minted.tokenHash,
            // A new version is a new question: "does this work for you?"
            status: "sent",
            sentAt: now,
            viewedAt: null,
            viewedVersion: null,
            acknowledgedAt: null,
            acknowledgedVersion: null,
            expiresAt: minted.expiresAt,
            sendCount: share.sendCount + 1,
            ...(message ? { message } : {}),
            updatedAt: now,
            updatedBy: identity.uid,
          });
          const email = vendor.get("email");
          const emailed = typeof email === "string" && email.includes("@");
          if (emailed) {
            const jobId = `run_of_show_revised_${share.id}_v${version}`;
            batch.set(db.doc(`emailJobs/${jobId}`), {
              id: jobId,
              tenantId: parsed.tenantId,
              projectId: parsed.input.projectId,
              type: "manual_message",
              recipient: email,
              recipientName:
                String(vendor.get("contactName") ?? "").trim() ||
                String(vendor.get("company") ?? "").trim() ||
                null,
              projectName,
              ...revisedTimelineEmail({
                projectName,
                version,
                message,
                shareUrl: minted.shareUrl,
              }),
              status: "queued",
              attempts: 0,
              createdAt: now,
              updatedAt: now,
            });
          }
          refreshed.push({
            vendorContactId: String(share.vendorContactId),
            company: String(vendor.get("company") ?? ""),
            emailed,
            // Only the ones nobody emailed: the studio passes these on.
            shareUrl: emailed ? null : minted.shareUrl,
          });
        }
        await batch.commit();
        result = {
          scheduleId: current.id,
          version,
          refreshed,
          refreshedCount: refreshed.length,
        };
      } else if (parsed.type === "shareRunOfShow") {
        if (!internalRoles.has(role)) throw new Error("FORBIDDEN");
        // The vendor must be real and ours. Resolve here so the share record
        // can denormalize company/type for display without a second read on the
        // public page (which runs with admin credentials and no tenant scope).
        const vendor = await db
          .doc(`vendors/${parsed.input.vendorContactId}`)
          .get();
        if (
          !vendor.exists ||
          vendor.get("tenantId") !== parsed.tenantId ||
          vendor.get("archivedAt")
        ) {
          throw new Error("VENDOR_NOT_FOUND");
        }
        // Share the current run of show — the highest version for the project.
        const schedules = await db
          .collection("schedules")
          .where("tenantId", "==", parsed.tenantId)
          .where("projectId", "==", parsed.input.projectId)
          .orderBy("version", "desc")
          .limit(1)
          .get();
        const current = schedules.docs[0];
        if (!current || current.get("status") !== "published") {
          // Nothing to send until a run of show is actually published.
          throw new Error("NO_PUBLISHED_RUN_OF_SHOW");
        }
        const minted = mintRunOfShowShare({
          tenantId: parsed.tenantId,
          projectId: parsed.input.projectId,
          vendorContactId: parsed.input.vendorContactId,
          appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "https://studio-cue.com",
        });
        // Re-sharing reuses the same document (one per vendor) but rotates the
        // token, so a newer run of show cannot be read through an older link and
        // the vendor always confirms against what the studio last sent.
        const priorShare = await db.doc(`scheduleShares/${minted.shareId}`).get();
        const sendCount = Number(priorShare.get("sendCount") ?? 0) + 1;
        await db.doc(`scheduleShares/${minted.shareId}`).set({
          id: minted.shareId,
          tenantId: parsed.tenantId,
          projectId: parsed.input.projectId,
          scheduleId: current.id,
          sharedVersion: Number(current.get("version")),
          vendorContactId: parsed.input.vendorContactId,
          vendorCompany: String(vendor.get("company") ?? ""),
          vendorType: String(vendor.get("type") ?? "other"),
          scope: parsed.input.scope,
          message: parsed.input.message,
          tokenHash: minted.tokenHash,
          status: "sent",
          sentAt: now,
          viewedAt: null,
          viewedVersion: null,
          acknowledgedAt: null,
          acknowledgedVersion: null,
          revokedAt: null,
          expiresAt: minted.expiresAt,
          sendCount,
          createdAt: priorShare.get("createdAt") ?? now,
          updatedAt: now,
          createdBy: priorShare.get("createdBy") ?? identity.uid,
          updatedBy: identity.uid,
          archivedAt: null,
        });
        result = {
          shareId: minted.shareId,
          shareUrl: minted.shareUrl,
          sharedVersion: Number(current.get("version")),
          status: "sent",
          sendCount,
          expiresAt: minted.expiresAt,
        };
      } else if (parsed.type === "revokeRunOfShowShare") {
        if (!internalRoles.has(role)) throw new Error("FORBIDDEN");
        const shareId = shareIdFor(
          parsed.tenantId,
          parsed.input.projectId,
          parsed.input.vendorContactId,
        );
        const reference = db.doc(`scheduleShares/${shareId}`);
        const share = await reference.get();
        if (!share.exists || share.get("tenantId") !== parsed.tenantId) {
          throw new Error("SHARE_NOT_FOUND");
        }
        await reference.update({
          status: "revoked",
          revokedAt: now,
          updatedAt: now,
          updatedBy: identity.uid,
        });
        result = { shareId, status: "revoked" };
      } else if (parsed.type === "createCoiRequest") {
        if (!internalRoles.has(role)) throw new Error("FORBIDDEN");
        const savedCoiSettings = readCoiSettings(await db.doc(`coiSettings/${parsed.tenantId}`).get());
        const agentEmail = parsed.input.insuranceAgentEmail ?? savedCoiSettings?.agentEmail ?? null;
        if (!agentEmail) throw new Error("COI_AGENT_EMAIL_REQUIRED");
        const requirementId = stable(
          "coi_requirement",
          parsed.tenantId,
          parsed.idempotencyKey,
        );
        const requestId = stable(
          "coi_request",
          parsed.tenantId,
          parsed.idempotencyKey,
        );
        const token = randomBytes(32).toString("base64url");
        const replyDomain = process.env.SENDGRID_INBOUND_DOMAIN;
        if (!replyDomain) throw new Error("COI_INBOUND_DOMAIN_NOT_CONFIGURED");
        const replyAddress = `coi+${token}@${replyDomain}`;
        const batch = db.batch();
        batch.create(db.doc(`insuranceRequirements/${requirementId}`), {
          id: requirementId,
          tenantId: parsed.tenantId,
          projectId: parsed.input.projectId,
          status: "requested",
          certificateHolder: parsed.input.certificateHolder,
          venueLegalName: parsed.input.venueLegalName,
          venueAddress: parsed.input.venueAddress,
          eventDate: parsed.input.eventDate,
          coverageTypes: parsed.input.coverageTypes,
          requiredLimits: parsed.input.requiredLimits,
          additionalInsuredWording: parsed.input.additionalInsuredWording,
          waiverOfSubrogation: parsed.input.waiverOfSubrogation,
          primaryNoncontributory: parsed.input.primaryNoncontributory,
          specialInstructions: parsed.input.specialInstructions,
          submissionEmail: parsed.input.submissionEmail,
          dueDate: parsed.input.dueDate,
          approvedAt: null,
          approvedBy: null,
          createdAt: now,
          updatedAt: now,
          createdBy: identity.uid,
          updatedBy: identity.uid,
          archivedAt: null,
        });
        batch.create(db.doc(`insuranceRequests/${requestId}`), {
          id: requestId,
          tenantId: parsed.tenantId,
          projectId: parsed.input.projectId,
          requirementId,
          status: "requested",
          replyTokenHash: createHash("sha256").update(token).digest("hex"),
          requestEmail: agentEmail,
          venueName: parsed.input.venueLegalName,
          dueDate: parsed.input.dueDate,
          inboundMessageId: null,
          documentId: null,
          extractedData: null,
          discrepancies: [],
          humanDecision: "pending",
          requestedAt: now,
          receivedAt: null,
          sentToVenueAt: null,
          venueAcknowledgedAt: null,
          createdAt: now,
          updatedAt: now,
          createdBy: identity.uid,
          updatedBy: identity.uid,
          archivedAt: null,
        });
        batch.create(db.doc(`emailJobs/coi_request_${requestId}`), {
          id: `coi_request_${requestId}`,
          tenantId: parsed.tenantId,
          projectId: parsed.input.projectId,
          type: "coi_request",
          requestId,
          recipient: agentEmail,
          replyAddress,
          requirement: {
            certificateHolder: parsed.input.certificateHolder,
            venueLegalName: parsed.input.venueLegalName,
            venueAddress: parsed.input.venueAddress,
            eventDate: parsed.input.eventDate,
            coverageTypes: parsed.input.coverageTypes,
            requiredLimits: parsed.input.requiredLimits,
            dueDate: parsed.input.dueDate,
            // Everything the agent needs to issue it without writing back
            // (walked on prod: the request gave the holder but no address).
            additionalInsuredWording: parsed.input.additionalInsuredWording,
            waiverOfSubrogation: parsed.input.waiverOfSubrogation,
            primaryNoncontributory: parsed.input.primaryNoncontributory,
            specialInstructions:
              [parsed.input.specialInstructions, savedCoiSettings?.agentNotes].filter(Boolean).join("\n") || null,
          },
          status: "queued",
          attempts: 0,
          createdAt: now,
          updatedAt: now,
        });
        batch.create(db.doc(`auditEvents/coi_request_${requestId}`), {
          id: `coi_request_${requestId}`,
          tenantId: parsed.tenantId,
          projectId: parsed.input.projectId,
          actorId: identity.uid,
          actorType: "user",
          action: "coi.requested",
          entityType: "insuranceRequest",
          entityId: requestId,
          timestamp: now,
          before: null,
          after: { status: "requested", requirementId },
          ipAddress: request.ip ?? null,
          userAgent: request.get("user-agent") ?? null,
          correlationId: parsed.idempotencyKey,
          automationRunId: null,
          providerEventId: null,
        });
        await batch.commit();
        result = { requestId, requirementId, status: "requested" };
      } else if (parsed.type === "decideCoi") {
        if (!["studio_owner", "studio_admin"].includes(role))
          throw new Error("FORBIDDEN");
        const reference = db.doc(`insuranceRequests/${parsed.input.requestId}`);
        let currentRequest: DocumentData | null = null;
        await db.runTransaction(async (tx) => {
          const current = await tx.get(reference);
          if (
            !current.exists ||
            current.get("tenantId") !== parsed.tenantId ||
            current.get("projectId") !== parsed.input.projectId ||
            !(
              ["under_review", "correction_required"].includes(String(current.get("status"))) ||
              // A PDF that failed the safety scan can only be sent back: the
              // correction email asks the agent to send it again (H3).
              (current.get("status") === "failed" && parsed.input.decision === "rejected")
            )
          )
            throw new Error("COI_NOT_REVIEWABLE");
          currentRequest = current.data() ?? null;
          tx.update(reference, {
            status:
              parsed.input.decision === "approved"
                ? "approved"
                : "correction_required",
            humanDecision: parsed.input.decision,
            decisionReason: parsed.input.reason,
            decidedAt: now,
            decidedBy: identity.uid,
            updatedAt: now,
            updatedBy: identity.uid,
          });
        });
        const reviewed = currentRequest as DocumentData | null;
        if (parsed.input.decision === "rejected" && reviewed) {
          // The agent's corrected PDF has to come back to the request's own
          // coi+ address, or inbound never sees it and it lands in the
          // studio's inbox instead. Only a hash of the token is kept on the
          // request, so the address is read from the original request email.
          const original = await db
            .doc(`emailJobs/coi_request_${parsed.input.requestId}`)
            .get();
          const replyAddress = original.get("replyAddress");
          // An agent handles many clients' certificates; the correction has
          // to say which event it is about, as the request did.
          const correctionRequirement = reviewed.requirementId
            ? await db.doc(`insuranceRequirements/${String(reviewed.requirementId)}`).get()
            : null;
          await db.doc(`emailJobs/coi_correction_${parsed.input.requestId}`).set({
            ...(correctionRequirement?.exists
              ? {
                  requirement: {
                    venueLegalName: correctionRequirement.get("venueLegalName") ?? null,
                    eventDate: correctionRequirement.get("eventDate") ?? null,
                    certificateHolder: correctionRequirement.get("certificateHolder") ?? null,
                  },
                }
              : {}),
            id: `coi_correction_${parsed.input.requestId}`,
            tenantId: parsed.tenantId,
            projectId: parsed.input.projectId,
            type: "coi_correction",
            requestId: parsed.input.requestId,
            recipient: reviewed.requestEmail,
            ...(typeof replyAddress === "string" ? { replyAddress } : {}),
            reason: parsed.input.reason,
            status: "queued",
            attempts: 0,
            createdAt: now,
            updatedAt: now,
          });
        }
        if (parsed.input.decision === "approved" && reviewed) {
          const documentId = `coi_${parsed.input.requestId}`;
          const object = String(reviewed.temporaryObject ?? "");
          if (!object.startsWith("gs://")) throw new Error("COI_DOCUMENT_MISSING");
          await db.doc(`documents/${documentId}`).set({
            id: documentId,
            tenantId: parsed.tenantId,
            projectId: parsed.input.projectId,
            provider: "cloud_storage",
            providerFileId: object,
            providerRevision: null,
            canonicalPath: object,
            name: String(reviewed.sourceFilename ?? "certificate-of-insurance.pdf"),
            contentType: "application/pdf",
            sizeBytes: null,
            hash: null,
            visibility: "shared",
            clientVisible: true,
            category: "coi",
            status: "approved",
            createdAt: now,
            updatedAt: now,
            createdBy: identity.uid,
            updatedBy: identity.uid,
            archivedAt: null,
          });
          await reference.update({ documentId });
          await db.doc(`providerJobs/dropbox_coi_${parsed.input.requestId}`).set({
            id: `dropbox_coi_${parsed.input.requestId}`,
            tenantId: parsed.tenantId,
            projectId: parsed.input.projectId,
            type: "upload_dropbox_document",
            documentId,
            targetFolder: "05_COI",
            status: "queued",
            attempts: 0,
            createdAt: now,
            updatedAt: now,
          });
        }
        result = {
          requestId: parsed.input.requestId,
          decision: parsed.input.decision,
        };
      } else if (parsed.type === "sendCoiToVenue") {
        if (!["studio_owner", "studio_admin"].includes(role))
          throw new Error("FORBIDDEN");
        const reference = db.doc(`insuranceRequests/${parsed.input.requestId}`);
        const current = await reference.get();
        if (
          !current.exists ||
          current.get("tenantId") !== parsed.tenantId ||
          current.get("projectId") !== parsed.input.projectId ||
          current.get("status") !== "approved" ||
          !current.get("documentId")
        )
          throw new Error("COI_NOT_APPROVED");
        const requirement = await db
          .doc(`insuranceRequirements/${String(current.get("requirementId"))}`)
          .get();
        if (!requirement.exists) throw new Error("COI_REQUIREMENT_NOT_FOUND");
        if (!requirement.get("submissionEmail")) throw new Error("COI_VENUE_EMAIL_REQUIRED");
        // The venue's reply comes back to this request (C5): its original
        // coi+ address, read from the request email.
        const originalRequest = await db.doc(`emailJobs/coi_request_${parsed.input.requestId}`).get();
        const venueReplyAddress = originalRequest.get("replyAddress");
        const key =
          (typeof requirement.get("venueKey") === "string" && requirement.get("venueKey")) ||
          venueKey({ name: requirement.get("venueLegalName") });
        if (key) {
          await db.doc(`venueCoiProfiles/${venueProfileId(parsed.tenantId, String(key))}`).set({
            ...venueProfileFrom(requirement, String(requirement.get("submissionEmail"))),
            tenantId: parsed.tenantId,
            venueKey: key,
            lastRequestId: parsed.input.requestId,
            updatedAt: now,
            updatedBy: identity.uid,
          });
        }
        await db.doc(`emailJobs/coi_venue_${parsed.input.requestId}`).create({
          ...(typeof venueReplyAddress === "string" ? { replyAddress: venueReplyAddress } : {}),
          id: `coi_venue_${parsed.input.requestId}`,
          tenantId: parsed.tenantId,
          projectId: parsed.input.projectId,
          type: "coi_venue_delivery",
          requestId: parsed.input.requestId,
          documentId: current.get("documentId"),
          recipient: requirement.get("submissionEmail"),
          venueName: requirement.get("venueLegalName"),
          eventDate: requirement.get("eventDate") ?? null,
          status: "queued",
          attempts: 0,
          createdAt: now,
          updatedAt: now,
        });
        await reference.update({
          status: "sent_to_venue",
          sentToVenueAt: now,
          updatedAt: now,
          updatedBy: identity.uid,
        });
        result = { requestId: parsed.input.requestId, status: "sent_to_venue" };
      } else if (parsed.type === "saveCoiSettings") {
        result = await saveCoiSettings(db, { tenantId: parsed.tenantId, actorId: identity.uid, role, now }, parsed.input);
      } else if (parsed.type === "approvePreparedCoi") {
        result = await approvePreparedCoi(db, { tenantId: parsed.tenantId, actorId: identity.uid, role, now }, parsed.input);
      } else if (parsed.type === "completeCoiDetails") {
        result = await completeCoiDetails(db, { tenantId: parsed.tenantId, actorId: identity.uid, role, now }, parsed.input);
      } else if (parsed.type === "attachCoiUpload") {
        result = await attachCoiUpload(db, { tenantId: parsed.tenantId, actorId: identity.uid, role, now }, parsed.input);
      } else if (parsed.type === "approveAndSendCoi") {
        result = await approveAndSendCoi(db, { tenantId: parsed.tenantId, actorId: identity.uid, role, now }, parsed.input);
      } else if (parsed.type === "resendCoi") {
        result = await resendCoi(db, { tenantId: parsed.tenantId, actorId: identity.uid, role, now }, parsed.input);
      } else if (parsed.type === "setTimelineAuthority") {
        if (!internalRoles.has(role)) throw new Error("FORBIDDEN");
        const project = db.doc(`projects/${parsed.input.projectId}`);
        const snapshot = await project.get();
        if (!snapshot.exists || snapshot.get("tenantId") !== parsed.tenantId) {
          throw new Error("NOT_FOUND");
        }
        const update: Record<string, unknown> = {
          timelineAuthority: parsed.input.authority,
          updatedAt: now,
          updatedBy: identity.uid,
        };
        if (parsed.input.plannerName !== undefined) {
          update.plannerName = parsed.input.plannerName || null;
        }
        let plannerItemCount: number | null = null;
        if (parsed.input.plannerTimelineText !== undefined) {
          const text = parsed.input.plannerTimelineText.trim();
          if (!text) {
            update.plannerTimeline = null;
          } else {
            const items = parsePlannerTimeline(text);
            // Saving text we can't read would show "no differences" — the one
            // answer that must never be wrong.
            if (!items.length) throw new Error("PLANNER_TIMELINE_UNREADABLE");
            update.plannerTimeline = {
              text,
              items,
              receivedAt: now,
              receivedBy: identity.uid,
            };
            plannerItemCount = items.length;
          }
        }
        const auditReference = db.collection("auditEvents").doc();
        const batch = db.batch();
        batch.update(project, update);
        batch.create(auditReference, {
          id: auditReference.id,
          tenantId: parsed.tenantId,
          projectId: parsed.input.projectId,
          actorId: identity.uid,
          actorType: "user",
          action: "project.timeline_authority_set",
          entityType: "project",
          entityId: parsed.input.projectId,
          timestamp: now,
          before: { timelineAuthority: snapshot.get("timelineAuthority") ?? "studio" },
          after: { timelineAuthority: parsed.input.authority, plannerItemCount },
          ipAddress: null,
          userAgent: request.header("user-agent") ?? null,
        });
        await batch.commit();
        result = {
          projectId: parsed.input.projectId,
          authority: parsed.input.authority,
          plannerItemCount,
        };
      } else if (parsed.type === "setInsuranceRequirement") {
        if (!internalRoles.has(role)) throw new Error("FORBIDDEN");
        const project = db.doc(`projects/${parsed.input.projectId}`);
        const snapshot = await project.get();
        if (!snapshot.exists || snapshot.get("tenantId") !== parsed.tenantId) {
          throw new Error("NOT_FOUND");
        }
        /**
         * "Not required" ends what was asking for one. It used to change this
         * field alone, so the chase scheduler went on emailing the agent about
         * a certificate nobody needed and the Today card stayed. Open requests
         * are cancelled and filed away — kept, as the record of what was
         * asked — and a certificate already at the venue is left as it is.
         */
        const cancelled: string[] = [];
        if (parsed.input.insuranceRequired === "not_required") {
          const requests = await db
            .collection("insuranceRequests")
            .where("tenantId", "==", parsed.tenantId)
            .where("projectId", "==", parsed.input.projectId)
            .limit(20)
            .get();
          const batch = db.batch();
          for (const insuranceRequest of requests.docs) {
            if (!coiRequestIsOpen(insuranceRequest.data())) continue;
            cancelled.push(insuranceRequest.id);
            batch.update(insuranceRequest.ref, {
              status: "cancelled",
              cancelledReason: "not_required",
              priorStatus: insuranceRequest.get("status") ?? null,
              archivedAt: now,
              updatedAt: now,
              updatedBy: identity.uid,
            });
            const requirementId = insuranceRequest.get("requirementId");
            if (typeof requirementId === "string" && requirementId) {
              batch.set(
                db.doc(`insuranceRequirements/${requirementId}`),
                { status: "cancelled", archivedAt: now, updatedAt: now, updatedBy: identity.uid },
                { merge: true },
              );
            }
          }
          batch.update(project, {
            insuranceRequired: parsed.input.insuranceRequired,
            updatedAt: now,
            updatedBy: identity.uid,
          });
          if (cancelled.length) {
            batch.create(db.doc(`auditEvents/${stable("audit_coi_not_required", parsed.tenantId, parsed.idempotencyKey)}`), {
              tenantId: parsed.tenantId,
              projectId: parsed.input.projectId,
              actorId: identity.uid,
              actorType: "user",
              action: "coi.requests_cancelled",
              entityType: "project",
              entityId: parsed.input.projectId,
              timestamp: now,
              before: { insuranceRequired: snapshot.get("insuranceRequired") ?? null },
              after: { insuranceRequired: "not_required", cancelledRequestIds: cancelled },
              ipAddress: request.ip ?? null,
              userAgent: request.get("user-agent") ?? null,
              correlationId: parsed.idempotencyKey,
              automationRunId: null,
              providerEventId: null,
            });
          }
          await batch.commit();
        } else {
          await project.update({
            insuranceRequired: parsed.input.insuranceRequired,
            updatedAt: now,
            updatedBy: identity.uid,
          });
        }
        result = {
          projectId: parsed.input.projectId,
          insuranceRequired: parsed.input.insuranceRequired,
          cancelledRequests: cancelled.length,
        };
      } else if (parsed.type === "publishSchedule") {
        if (!internalRoles.has(role)) throw new Error("FORBIDDEN");
        const schedules = await db
          .collection("schedules")
          .where("tenantId", "==", parsed.tenantId)
          .where("projectId", "==", parsed.input.projectId)
          .orderBy("version", "desc")
          .limit(1)
          .get();
        const priorSchedule = schedules.docs[0];
        const version = Number(priorSchedule?.get("version") ?? 0) + 1;
        const id = stable("schedule", parsed.tenantId, parsed.idempotencyKey);
        const acceptedAssignments = await db
          .collection("crewAssignments")
          .where("tenantId", "==", parsed.tenantId)
          .where("projectId", "==", parsed.input.projectId)
          .where("status", "==", "accepted")
          .get();
        const crewProfiles = await Promise.all(
          acceptedAssignments.docs.map((assignment) =>
            db.doc(`crewProfiles/${String(assignment.get("crewProfileId"))}`).get(),
          ),
        );
        const priorItems = priorSchedule && Array.isArray(priorSchedule.get("items"))
          ? (priorSchedule.get("items") as unknown[]).map((value) =>
              typeof value === "object" && value !== null
                ? (value as Record<string, unknown>)
                : {},
            )
          : [];
        // Stored in start order, so every reader — crew day sheet, vendor
        // link, PDF, the couple's portal — sees the day the studio saw. The
        // editor keeps this order too; this is the guarantee, not the habit.
        const currentItems = sortScheduleItems(parsed.input.items).map((scheduleItem) => ({
          ...withCrewIds(scheduleItem),
          sourceReferences:
            scheduleItem.sourceReferences?.length
              ? scheduleItem.sourceReferences
              : [
                  {
                    type: "assumption" as const,
                    sourceId: `assumption_${scheduleItem.id}`,
                    label: "Human-reviewed schedule assumption",
                  },
                ],
        }));
        const priorById = new Map(
          priorItems.map((scheduleItem) => [String(scheduleItem.id), scheduleItem]),
        );
        const currentById = new Map(
          currentItems.map((scheduleItem) => [scheduleItem.id, scheduleItem]),
        );
        const addedItemIds = currentItems
          .filter((scheduleItem) => !priorById.has(scheduleItem.id))
          .map((scheduleItem) => scheduleItem.id);
        const removedItemIds = priorItems
          .filter((scheduleItem) => !currentById.has(String(scheduleItem.id)))
          .map((scheduleItem) => String(scheduleItem.id));
        const changedItems = currentItems.flatMap((scheduleItem) => {
          const priorItem = priorById.get(scheduleItem.id);
          if (!priorItem) return [];
          const changedFields = [
            ["time", `${String(priorItem.startAt)}:${String(priorItem.endAt)}`, `${scheduleItem.startAt}:${scheduleItem.endAt}`],
            ["location", `${String(priorItem.location)}:${String(priorItem.address)}`, `${String(scheduleItem.location)}:${String(scheduleItem.address)}`],
            ["title", String(priorItem.title), scheduleItem.title],
          ]
            .filter(([, before, after]) => before !== after)
            .map(([field]) => field);
          // Compared as sets through itemCrewIds, so a version published
          // before crewIds existed does not read as a crew change against its
          // own republish — which would tell every accepted crew member their
          // day changed when it had not.
          if (!sameItemCrew(priorItem, scheduleItem)) changedFields.push("crew");
          return changedFields.length
            ? [{ itemId: scheduleItem.id, title: scheduleItem.title, changedFields }]
            : [];
        });
        const changeImpact = {
          addedItemIds,
          removedItemIds,
          changedItems,
          changedItemCount:
            addedItemIds.length + removedItemIds.length + changedItems.length,
          requiresRenewedCrewAcknowledgement:
            acceptedAssignments.size > 0 &&
            (addedItemIds.length > 0 ||
              removedItemIds.length > 0 ||
              changedItems.length > 0),
          calculatedAt: now,
        };
        /**
         * The couple's change request, answered by this version.
         *
         * Asking for changes opens a task on the job (approveSchedule below).
         * Publishing the revision is the answer, so the task closes with it
         * rather than turning up on Today as overdue the next morning.
         */
        const answeredRequest =
          priorSchedule?.get("approvalState") === "changes_requested"
            ? await db.doc(`tasks/schedule_changes_${priorSchedule.id}`).get()
            : null;
        const batch = db.batch();
        if (
          answeredRequest?.exists &&
          answeredRequest.get("tenantId") === parsed.tenantId &&
          !["complete", "completed", "cancelled"].includes(String(answeredRequest.get("status")))
        )
          batch.update(answeredRequest.ref, {
            status: "complete",
            completedAt: now,
            completedBy: identity.uid,
            updatedAt: now,
            updatedBy: identity.uid,
          });
        if (priorSchedule)
          batch.update(priorSchedule.ref, {
            status: "superseded",
            updatedAt: now,
            updatedBy: identity.uid,
          });
        batch.create(db.doc(`schedules/${id}`), {
          id,
          tenantId: parsed.tenantId,
          projectId: parsed.input.projectId,
          version,
          status: "published",
          timezone: parsed.input.timezone,
          items: currentItems,
          sourceTrace: {
            traceableItemCount: currentItems.length,
            assumptionItemCount: currentItems.filter((scheduleItem) =>
              scheduleItem.sourceReferences.some(
                (source) => source.type === "assumption",
              ),
            ).length,
            verifiedAt: now,
          },
          approvalState: "client_pending",
          publishedAt: now,
          approvedBy: null,
          pdfDocumentId: null,
          dropboxDocumentId: null,
          supersedesId: priorSchedule?.id ?? null,
          changeImpact,
          immutable: true,
          createdAt: now,
          updatedAt: now,
          createdBy: identity.uid,
          updatedBy: identity.uid,
          archivedAt: null,
        });
        batch.create(db.doc(`pdfJobs/schedule_${id}`), {
          tenantId: parsed.tenantId,
          projectId: parsed.input.projectId,
          scheduleId: id,
          type: "schedule_pdf",
          status: "queued",
          createdAt: now,
        });
        for (const [assignmentIndex, assignment] of acceptedAssignments.docs.entries()) {
          batch.update(assignment.ref, {
            currentScheduleId: id,
            currentScheduleVersion: version,
            acknowledgedScheduleVersion: null,
            scheduleAcknowledgedAt: null,
            updatedAt: now,
            updatedBy: identity.uid,
          });
          const profile = crewProfiles[assignmentIndex];
          const scopedItemIds = Array.isArray(assignment.get("scheduleItemIds"))
            ? new Set(
                (assignment.get("scheduleItemIds") as unknown[]).map(String),
              )
            : new Set<string>();
          batch.set(
            db.doc(`crewScheduleViews/${id}_${assignment.id}`),
            {
              id: `${id}_${assignment.id}`,
              tenantId: parsed.tenantId,
              projectId: parsed.input.projectId,
              assignmentId: assignment.id,
              userId: assignment.get("userId") ?? null,
              crewProfileId: assignment.get("crewProfileId"),
              sourceScheduleId: id,
              version,
              status: "published",
              timezone: parsed.input.timezone,
              items: currentItems.filter(
                (scheduleItem) =>
                  ["crew", "shared"].includes(scheduleItem.visibility) &&
                  (scopedItemIds.size === 0 ||
                    scopedItemIds.has(scheduleItem.id)),
              ),
              publishedAt: now,
              createdAt: now,
              updatedAt: now,
            },
            { merge: false },
          );
          if (profile?.exists && typeof profile.get("email") === "string") {
            batch.set(
              db.doc(`emailJobs/schedule_crew_${id}_${assignment.id}`),
              {
                id: `schedule_crew_${id}_${assignment.id}`,
                tenantId: parsed.tenantId,
                projectId: parsed.input.projectId,
                assignmentId: assignment.id,
                recipient: profile.get("email"),
                recipientName: profile.get("name"),
                type: "final_schedule_published",
                scheduleId: id,
                scheduleVersion: version,
                // To this job's day sheet, not whichever job the page picks.
                scheduleUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://studiohub.app"}/crew/schedule?assignment=${encodeURIComponent(assignment.id)}`,
                status: "queued",
                attempts: 0,
                createdAt: now,
                updatedAt: now,
              },
              { merge: false },
            );
          }
        }
        // The couple's schedule view only renders items marked "client" or
        // "shared" (components/client/live-client-views.tsx). Telling them "your
        // event-day schedule is ready" while every item is crew-only lands them
        // on a page that says "no times are set" — the studio believes it shared
        // a schedule the couple cannot see (audit-2 N4). Only queue the client
        // email when there is something on it for them; the crew still get theirs.
        const clientVisibleItemCount = currentItems.filter((scheduleItem) =>
          ["client", "shared"].includes(scheduleItem.visibility),
        ).length;
        if (clientVisibleItemCount > 0) {
          batch.set(
            db.doc(`emailJobs/schedule_client_${id}`),
            {
              id: `schedule_client_${id}`,
              tenantId: parsed.tenantId,
              projectId: parsed.input.projectId,
              type: "schedule_review",
              scheduleId: id,
              scheduleVersion: version,
              scheduleUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://studiohub.app"}/client/schedule`,
              status: "queued",
              attempts: 0,
              createdAt: now,
              updatedAt: now,
            },
            { merge: false },
          );
        }
        const auditReference = db.doc(`auditEvents/schedule_published_${id}`);
        batch.create(auditReference, {
          id: auditReference.id,
          tenantId: parsed.tenantId,
          projectId: parsed.input.projectId,
          actorId: identity.uid,
          actorType: "user",
          action: "schedule.published",
          entityType: "schedule",
          entityId: id,
          timestamp: now,
          before: priorSchedule
            ? { scheduleId: priorSchedule.id, version: version - 1 }
            : null,
          after: { scheduleId: id, version, changeImpact },
          ipAddress: null,
          userAgent: request.header("user-agent") ?? null,
          correlationId: parsed.idempotencyKey,
          automationRunId: null,
          providerEventId: null,
        });
        const event = productEvent({
          tenantId: parsed.tenantId,
          projectId: parsed.input.projectId,
          actorId: identity.uid,
          name: "lifecycle.schedule_published",
          occurredAt: now,
          correlationId: parsed.idempotencyKey,
          sourceEntityType: "schedule",
          sourceEntityId: id,
          properties: {
            version,
            itemCount: currentItems.length,
            assumptionItemCount: currentItems.filter((scheduleItem) =>
              scheduleItem.sourceReferences.some(
                (source) => source.type === "assumption",
              ),
            ).length,
            crewNotified: acceptedAssignments.size,
            changedItemCount: changeImpact.changedItemCount,
          },
        });
        batch.create(db.doc(`productEvents/${event.id}`), event);
        await batch.commit();
        // Crew are told above; vendors are not, because their links carry
        // what the studio approved sending them. Say how many now hold the
        // old version, so the studio is offered the re-share instead of
        // finding out from the florist.
        const vendorShares = await db
          .collection("scheduleShares")
          .where("tenantId", "==", parsed.tenantId)
          .where("projectId", "==", parsed.input.projectId)
          .get();
        result = {
          scheduleId: id,
          version,
          acknowledgementReset: true,
          crewNotified: acceptedAssignments.size,
          changeImpact,
          staleVendorShareCount: staleVendorShares(
            vendorShares.docs.map((share) => ({ id: share.id, ...share.data() })),
            id,
          ).length,
        };
      } else {
        const reference = db.doc(`schedules/${parsed.input.scheduleId}`);
        const current = await reference.get();
        if (
          !current.exists ||
          current.get("tenantId") !== parsed.tenantId ||
          current.get("projectId") !== parsed.input.projectId
        )
          throw new Error("SCHEDULE_NOT_FOUND");
        /**
         * A couple answers the version they were asked about.
         *
         * Publishing writes `status: "published"` with `approvalState:
         * "client_pending"`, and this used to accept a couple's answer only
         * at `status: "client_review"` — a status nothing sets. So no couple
         * could ever approve a timeline (found 2026-09-29). A published
         * version awaiting them is answerable now, and its status stays
         * "published": the run of show, crew views and vendor shares all read
         * the current version by that status, and the answer belongs in
         * `approvalState`. A draft, a superseded version or one already
         * answered is still refused.
         */
        const status = String(current.get("status"));
        const awaitingCouple =
          status === "client_review" ||
          (status === "published" && current.get("approvalState") === "client_pending");
        if (role === "client" && !awaitingCouple)
          throw new Error("SCHEDULE_NOT_IN_REVIEW");
        /**
         * The studio recording the couple's answer.
         *
         * This branch had no guard at all for anyone but the couple: any
         * member assigned to the job — crew included — could mark any
         * version approved, a superseded one too, and nothing recorded who
         * the couple were said to have told, or how.
         */
        const recorded = role === "client" ? null : parsed.input.recordedAnswer ?? null;
        if (role !== "client") {
          if (!internalRoles.has(role)) throw new Error("FORBIDDEN");
          if (!recorded) throw new Error("SCHEDULE_ANSWER_DETAILS_REQUIRED");
          assertStudioMayRecordAnswer({
            status,
            approvalState: current.get("approvalState"),
          });
          // Only the version the couple is being asked about: a newer one
          // may exist even when this one was never marked superseded.
          const newest = await db
            .collection("schedules")
            .where("tenantId", "==", parsed.tenantId)
            .where("projectId", "==", parsed.input.projectId)
            .orderBy("version", "desc")
            .limit(1)
            .get();
          if (newest.docs[0]?.id !== current.id)
            throw new Error("SCHEDULE_SUPERSEDED");
        }
        const approvalBatch = db.batch();
        approvalBatch.update(reference, {
          approvedAt: parsed.input.decision === "approved" ? now : null,
          approvalState:
            parsed.input.decision === "approved"
              ? "client_approved"
              : "changes_requested",
          ...(status === "published" ? {} : { status: parsed.input.decision }),
          approvedBy:
            parsed.input.decision === "approved" ? identity.uid : null,
          approvalNotes: parsed.input.notes,
          // Who the couple were, how they said it and when, and which
          // studio member wrote it down.
          ...(recorded
            ? {
                approvalRecordedByStudio: {
                  ...recorded,
                  decision: parsed.input.decision,
                  recordedBy: identity.uid,
                  recordedAt: now,
                },
              }
            : {}),
          updatedAt: now,
          updatedBy: identity.uid,
        });
        if (recorded) {
          const auditReference = db.doc(
            `auditEvents/${stable("schedule_answer", parsed.tenantId, parsed.idempotencyKey)}`,
          );
          approvalBatch.create(auditReference, {
            id: auditReference.id,
            tenantId: parsed.tenantId,
            projectId: parsed.input.projectId,
            actorId: identity.uid,
            actorType: "user",
            action: "schedule.client_answer_recorded",
            entityType: "schedule",
            entityId: parsed.input.scheduleId,
            timestamp: now,
            before: { approvalState: current.get("approvalState") ?? null },
            after: { decision: parsed.input.decision, ...recorded },
            ipAddress: null,
            userAgent: request.header("user-agent") ?? null,
            correlationId: parsed.idempotencyKey,
            automationRunId: null,
            providerEventId: null,
          });
        }
        // The studio hears about a request for changes where it works: a
        // task on the job, with the couple's words.
        if (role === "client" && parsed.input.decision === "changes_requested") {
          const taskId = `schedule_changes_${parsed.input.scheduleId}`;
          approvalBatch.set(db.doc(`tasks/${taskId}`), {
            id: taskId,
            tenantId: parsed.tenantId,
            projectId: parsed.input.projectId,
            workflowRunId: null,
            checkpointId: null,
            title: `The couple asked for changes to timeline version ${Number(current.get("version") ?? 1)}`,
            description: parsed.input.notes.slice(0, 3000),
            status: "not_started",
            priority: "high",
            assignedUserId: null,
            assignedRole: "studio_owner",
            dueDate: now.slice(0, 10),
            blocking: false,
            completedAt: null,
            completedBy: null,
            source: "client_schedule_review",
            createdAt: now,
            updatedAt: now,
            createdBy: identity.uid,
            updatedBy: identity.uid,
            archivedAt: null,
          });
          /**
           * And by email, because the task alone was invisible.
           *
           * It is due today, and Today lists a task only once it is overdue —
           * so a couple who asked for changes heard nothing back and the
           * studio found out the next day, if they opened Tasks. Today now
           * carries a card for it too; this reaches a studio that is not
           * looking at StudioCue. One per version, keyed on it.
           */
          const [studioAddress, projectRecord] = await Promise.all([
            studioNotificationAddress(db, parsed.tenantId).catch(() => null),
            db.doc(`projects/${parsed.input.projectId}`).get(),
          ]);
          if (studioAddress) {
            const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://studio-cue.com").replace(/\/$/, "");
            const jobName = String(projectRecord.get("name") ?? "").trim();
            const emailId = `schedule_changes_${parsed.input.scheduleId}`;
            approvalBatch.set(db.doc(`emailJobs/${emailId}`), {
              id: emailId,
              tenantId: parsed.tenantId,
              projectId: parsed.input.projectId,
              type: "studio_schedule_changes_requested",
              recipient: studioAddress,
              coupleName: jobName.replace(/\s+wedding$/i, "").trim() || "Your couple",
              scheduleVersion: Number(current.get("version") ?? 1),
              changeNote: parsed.input.notes.slice(0, 2000),
              actionUrl: `${appUrl}/studio/schedules/new?project=${encodeURIComponent(parsed.input.projectId)}`,
              status: "queued",
              attempts: 0,
              createdAt: now,
              updatedAt: now,
            });
          } else {
            console.warn("schedule_changes_studio_address_missing", {
              tenantId: parsed.tenantId,
              scheduleId: parsed.input.scheduleId,
            });
          }
        }
        await approvalBatch.commit();
        result = {
          scheduleId: parsed.input.scheduleId,
          decision: parsed.input.decision,
        };
      }
      await execution.create({
        tenantId: parsed.tenantId,
        result,
        createdAt: now,
      });
      response.status(200).json(result);
    } catch (caught: unknown) {
      const message =
        caught instanceof Error ? caught.message : "PLANNING_COMMAND_FAILED";
      // A refusal on entitlement or a lapsed subscription is an
      // authorization answer, not "your request was malformed". A client
      // that cannot tell those apart shows the wrong thing to a studio whose
      // card expired.
      const forbidden =
        message === "FORBIDDEN" ||
        message === "ACTIVE_SUBSCRIPTION_REQUIRED" ||
        message.startsWith("ENTITLEMENT_REQUIRED");
      response.status(forbidden ? 403 : 400).json({ error: message });
    }
  },
);
