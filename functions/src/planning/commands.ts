import { createHash, randomBytes } from "node:crypto";
import { getFirestore, type DocumentData } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { requireAppCheck, requireIdentity } from "../crm/security.js";
import { requireEntitlement } from "../saas/entitlement-guard.js";
import { productEvent } from "../operations/product-events.js";
import { studioHubCors } from "../security/cors.js";

const item = z.object({
  id: z.string(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  title: z.string().min(1),
  description: z.string(),
  location: z.string().nullable(),
  address: z.string().nullable(),
  travelMinutes: z.number().int().nonnegative(),
  photographerIds: z.array(z.string()),
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
  options: z.array(z.string()),
  conditionalOn: z
    .object({ fieldId: z.string(), equals: z.unknown() })
    .nullable(),
});
const command = z.discriminatedUnion("type", [
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
    type: z.literal("assignQuestionnaire"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string(),
      templateId: z.string(),
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
      submissionEmail: z.string().email(),
      dueDate: z.string().date(),
      insuranceAgentEmail: z.string().email(),
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
const normalizedLabel = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
const projectFactAliases = [
  {
    labels: ["event date", "wedding date", "date"],
    field: "eventDate",
    label: "Project event date",
  },
  {
    labels: ["venue", "venue name", "ceremony venue"],
    field: "venueName",
    label: "Project venue",
  },
  {
    labels: ["venue address", "event address", "ceremony address"],
    field: "venueAddress",
    label: "Project venue address",
  },
  {
    labels: ["client", "couple", "client name", "couple names"],
    field: "clientName",
    label: "Project client",
  },
  {
    labels: ["timezone", "time zone"],
    field: "timezone",
    label: "Project timezone",
  },
] as const;

function verifiedPrefill(
  projectId: string,
  project: DocumentData,
  sections: unknown,
) {
  const answers: Record<string, unknown> = {};
  const answerProvenance: Record<string, unknown> = {};
  const sectionValues = Array.isArray(sections) ? sections : [];
  for (const section of sectionValues) {
    const sectionRecord = plainRecord(section);
    const fields = Array.isArray(sectionRecord.fields)
      ? sectionRecord.fields
      : [];
    for (const candidate of fields) {
      const field = plainRecord(candidate);
      const fieldId = String(field.id ?? "");
      const label = normalizedLabel(field.label ?? field.id);
      const alias = projectFactAliases.find((item) =>
        item.labels.some((candidateLabel) => candidateLabel === label),
      );
      if (!fieldId || !alias) continue;
      const value = project.get(alias.field);
      if (
        value === null ||
        value === undefined ||
        (typeof value === "string" && !value.trim())
      )
        continue;
      answers[fieldId] = value;
      answerProvenance[fieldId] = {
        sourceType: "project_fact",
        sourceId: projectId,
        sourceField: alias.field,
        label: alias.label,
        verified: true,
      };
    }
  }
  return { answers, answerProvenance };
}

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
        parsed.type === "sendCoiToVenue"
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
      if (parsed.type === "saveQuestionnaire") {
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
        const priorAnswers = plainRecord(snapshot.get("answers"));
        const answerProvenance = {
          ...plainRecord(snapshot.get("answerProvenance")),
        };
        const changes = Object.entries(parsed.input.answers).flatMap(
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
        const changeHistory = Array.isArray(snapshot.get("changeHistory"))
          ? (snapshot.get("changeHistory") as unknown[])
          : [];
        const batch = db.batch();
        batch.update(reference, {
          answers: parsed.input.answers,
          answerProvenance,
          changeHistory: [...changeHistory, ...changes].slice(-200),
          hasPlanningChanges: changes.length > 0,
          status: parsed.input.submit ? "submitted" : "in_progress",
          completionPercent: parsed.input.submit
            ? 100
            : snapshot.get("completionPercent"),
          submittedAt: parsed.input.submit ? now : null,
          updatedAt: now,
          updatedBy: identity.uid,
        });
        if (parsed.input.submit) {
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
          status: parsed.input.submit ? "submitted" : "in_progress",
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
        const due = new Date(`${String(project.get("eventDate"))}T12:00:00.000Z`);
        due.setUTCDate(
          due.getUTCDate() - Number(template.get("dueDaysBeforeEvent") ?? 0),
        );
        const id = stable(
          "questionnaire_response",
          parsed.tenantId,
          parsed.idempotencyKey,
        );
        const sections = template.get("sections");
        const prefill = verifiedPrefill(
          parsed.input.projectId,
          project,
          sections,
        );
        const fieldValues = Array.isArray(sections)
          ? sections.flatMap((section) => {
              const fields = plainRecord(section).fields;
              return Array.isArray(fields) ? fields : [];
            })
          : [];
        const requiredFieldIds = fieldValues
          .map(plainRecord)
          .filter((field) => field.required === true)
          .map((field) => String(field.id));
        const completedRequired = requiredFieldIds.filter((fieldId) =>
          Object.prototype.hasOwnProperty.call(prefill.answers, fieldId),
        ).length;
        const completionPercent = requiredFieldIds.length
          ? Math.round((completedRequired / requiredFieldIds.length) * 100)
          : 0;
        await db.doc(`questionnaireResponses/${id}`).create({
          id,
          tenantId: parsed.tenantId,
          projectId: parsed.input.projectId,
          templateId: parsed.input.templateId,
          templateVersion: Number(template.get("version")),
          templateName: String(template.get("name")),
          templateSnapshot: {
            name: String(template.get("name")),
            sections,
          },
          status: "not_started",
          answers: prefill.answers,
          answerProvenance: prefill.answerProvenance,
          changeHistory: [],
          hasPlanningChanges: false,
          completionPercent,
          dueDate: due.toISOString().slice(0, 10),
          submittedAt: null,
          createdAt: now,
          updatedAt: now,
          createdBy: identity.uid,
          updatedBy: identity.uid,
          archivedAt: null,
        });
        result = {
          responseId: id,
          status: "not_started",
          prefilledFieldCount: Object.keys(prefill.answers).length,
        };
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
        await reference.update({
          archivedAt: parsed.input.restore ? null : now,
          updatedAt: now,
          updatedBy: identity.uid,
        });
        result = {
          vendorId: parsed.input.vendorId,
          archived: !parsed.input.restore,
        };
      } else if (parsed.type === "createCoiRequest") {
        if (!internalRoles.has(role)) throw new Error("FORBIDDEN");
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
          requestEmail: parsed.input.insuranceAgentEmail,
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
          recipient: parsed.input.insuranceAgentEmail,
          replyAddress,
          requirement: {
            certificateHolder: parsed.input.certificateHolder,
            venueLegalName: parsed.input.venueLegalName,
            venueAddress: parsed.input.venueAddress,
            eventDate: parsed.input.eventDate,
            coverageTypes: parsed.input.coverageTypes,
            requiredLimits: parsed.input.requiredLimits,
            dueDate: parsed.input.dueDate,
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
            !["under_review", "correction_required"].includes(
              String(current.get("status")),
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
          await db.doc(`emailJobs/coi_correction_${parsed.input.requestId}`).set({
            id: `coi_correction_${parsed.input.requestId}`,
            tenantId: parsed.tenantId,
            projectId: parsed.input.projectId,
            type: "coi_correction",
            requestId: parsed.input.requestId,
            recipient: reviewed.requestEmail,
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
        await db.doc(`emailJobs/coi_venue_${parsed.input.requestId}`).create({
          id: `coi_venue_${parsed.input.requestId}`,
          tenantId: parsed.tenantId,
          projectId: parsed.input.projectId,
          type: "coi_venue_delivery",
          requestId: parsed.input.requestId,
          documentId: current.get("documentId"),
          recipient: requirement.get("submissionEmail"),
          venueName: requirement.get("venueLegalName"),
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
      } else if (parsed.type === "setInsuranceRequirement") {
        if (!internalRoles.has(role)) throw new Error("FORBIDDEN");
        const project = db.doc(`projects/${parsed.input.projectId}`);
        const snapshot = await project.get();
        if (!snapshot.exists || snapshot.get("tenantId") !== parsed.tenantId) {
          throw new Error("NOT_FOUND");
        }
        await project.update({
          insuranceRequired: parsed.input.insuranceRequired,
          updatedAt: now,
          updatedBy: identity.uid,
        });
        result = {
          projectId: parsed.input.projectId,
          insuranceRequired: parsed.input.insuranceRequired,
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
        const currentItems = parsed.input.items.map((scheduleItem) => ({
          ...scheduleItem,
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
            ["photographers", JSON.stringify(priorItem.photographerIds ?? []), JSON.stringify(scheduleItem.photographerIds)],
          ]
            .filter(([, before, after]) => before !== after)
            .map(([field]) => field);
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
        const batch = db.batch();
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
                scheduleUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://studiohub.app"}/crew/schedule`,
                status: "queued",
                attempts: 0,
                createdAt: now,
                updatedAt: now,
              },
              { merge: false },
            );
          }
        }
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
        result = {
          scheduleId: id,
          version,
          acknowledgementReset: true,
          crewNotified: acceptedAssignments.size,
          changeImpact,
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
        await reference.update({
          approvalState:
            parsed.input.decision === "approved"
              ? "client_approved"
              : "changes_requested",
          status: parsed.input.decision,
          approvedBy:
            parsed.input.decision === "approved" ? identity.uid : null,
          approvalNotes: parsed.input.notes,
          updatedAt: now,
          updatedBy: identity.uid,
        });
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
