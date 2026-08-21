import { randomUUID } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { requireAppCheck, requireIdentity } from "./security.js";
import { studioHubCors } from "../security/cors.js";

const projectStates = [
  "LEAD",
  "CONSULTATION",
  "PROPOSAL",
  "CONTRACT_PENDING",
  "RETAINER_PENDING",
  "BOOKED",
  "PLANNING",
  "READY",
  "EVENT_COMPLETE",
  "POST_PRODUCTION",
  "DELIVERED",
  "REVIEW_REQUESTED",
  "CLOSED",
  "CANCELLED",
  "POSTPONED",
  "ARCHIVED",
] as const;

const transitions: Readonly<
  Record<(typeof projectStates)[number], readonly string[]>
> = {
  LEAD: ["CONSULTATION", "CANCELLED", "ARCHIVED"],
  CONSULTATION: ["PROPOSAL", "CANCELLED", "POSTPONED"],
  PROPOSAL: ["CONTRACT_PENDING", "CANCELLED", "POSTPONED"],
  CONTRACT_PENDING: ["RETAINER_PENDING", "CANCELLED", "POSTPONED"],
  RETAINER_PENDING: ["BOOKED", "CANCELLED", "POSTPONED"],
  BOOKED: ["PLANNING", "CANCELLED", "POSTPONED"],
  PLANNING: ["READY", "CANCELLED", "POSTPONED"],
  READY: ["EVENT_COMPLETE", "PLANNING", "CANCELLED", "POSTPONED"],
  EVENT_COMPLETE: ["POST_PRODUCTION"],
  POST_PRODUCTION: ["DELIVERED"],
  DELIVERED: ["REVIEW_REQUESTED", "CLOSED"],
  REVIEW_REQUESTED: ["CLOSED"],
  CLOSED: ["ARCHIVED"],
  CANCELLED: ["ARCHIVED"],
  POSTPONED: ["CONSULTATION", "BOOKED", "PLANNING", "CANCELLED"],
  ARCHIVED: [],
};

const evidenceControlledTransitions = new Set([
  "PROPOSAL:CONTRACT_PENDING",
  "CONTRACT_PENDING:RETAINER_PENDING",
  "RETAINER_PENDING:BOOKED",
  "POSTPONED:BOOKED",
  "PLANNING:READY",
  "POST_PRODUCTION:DELIVERED",
]);

const commandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("createProject"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      name: z.string().trim().min(2).max(160),
      eventTypeId: z.string().min(1),
      eventType: z.string().min(2).max(80),
      eventDate: z.string().date(),
      timezone: z.string().min(1),
      clientContactIds: z.array(z.string()).min(1),
      leadPhotographerId: z.string().nullable(),
      leadId: z.string().nullable(),
      venueName: z.string().max(160).nullable(),
      city: z.string().max(120).nullable(),
    }),
  }),
  z.object({
    type: z.literal("transitionProject"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      projectId: z.string().min(1),
      expectedVersion: z.number().int().nonnegative(),
      targetState: z.enum(projectStates),
    }),
  }),
  z.object({
    type: z.literal("associateClientProject"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      contactId: z.string().min(1),
      projectId: z.string().min(1),
    }),
  }),
  z.object({
    type: z.literal("createContact"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      firstName: z.string().trim().min(1).max(80),
      lastName: z.string().trim().min(1).max(80),
      email: z.string().email().nullable(),
      phone: z.string().max(30).nullable(),
      company: z.string().max(160).nullable(),
      contactTypes: z.array(z.string().min(1)).min(1),
    }),
  }),
  z.object({
    type: z.literal("createPackage"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      name: z.string().trim().min(2).max(120),
      description: z.string().trim().min(10).max(3000),
      eventTypeId: z.string().min(1),
      eventTypeLabel: z.string().min(2).max(80),
      basePriceCents: z.number().int().nonnegative().safe(),
      currency: z.string().length(3),
      retainerRule: z.discriminatedUnion("type", [
        z.object({
          type: z.literal("fixed"),
          amountCents: z.number().int().nonnegative().safe(),
        }),
        z.object({
          type: z.literal("percentage"),
          basisPoints: z.number().int().min(0).max(10000),
        }),
        z.object({
          type: z.literal("per_crew_member"),
          amountPerCrewCents: z.number().int().nonnegative().safe(),
        }),
      ]),
      includedCoverageMinutes: z.number().int().positive(),
      includedPhotographers: z.number().int().positive(),
      includedDeliverables: z.array(z.string().min(1)).min(1),
      includedTravelArea: z.string().max(500),
      addOns: z.array(
        z.object({
          id: z.string().min(1),
          name: z.string().min(1).max(120),
          description: z.string().max(1000),
          unitPriceCents: z.number().int().nonnegative().safe(),
          taxable: z.boolean(),
          active: z.boolean(),
        }),
      ),
      taxRateBasisPoints: z.number().int().min(0).max(10000),
      terms: z.string().min(10).max(5000),
      active: z.boolean(),
      publicVisible: z.boolean(),
      displayOrder: z.number().int().nonnegative(),
      internalNotes: z.string().max(3000).nullable(),
    }),
  }),
  z.object({
    type: z.literal("selectPackage"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      projectId: z.string().min(1),
      packageId: z.string().min(1),
      selectedAddOns: z.array(
        z.object({
          addOnId: z.string().min(1),
          quantity: z.number().int().positive().max(100),
        }),
      ),
      discount: z.discriminatedUnion("type", [
        z.object({ type: z.literal("none") }),
        z.object({
          type: z.literal("fixed"),
          amountCents: z.number().int().nonnegative().safe(),
        }),
        z.object({
          type: z.literal("percentage"),
          basisPoints: z.number().int().min(0).max(10000),
        }),
      ]),
    }),
  }),
]);

const allowedRoles = ["studio_owner", "studio_admin", "studio_coordinator"];

export const crmCommand = onRequest(
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
      await requireAppCheck(request);
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
      | { role: string; status: string; projectIds?: string[] }
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
        if (execution.exists)
          return execution.data()?.result as Record<string, unknown>;

        if (command.type === "createProject") {
          const projectId = randomUUID();
          const leadReference = command.input.leadId
            ? db.doc(`leads/${command.input.leadId}`)
            : null;
          const contactReferences = command.input.clientContactIds.map(
            (contactId) => db.doc(`contacts/${contactId}`),
          );
          const [contactDocuments, leadDocument] = await Promise.all([
            Promise.all(
              contactReferences.map((reference) =>
                transaction.get(reference),
              ),
            ),
            leadReference ? transaction.get(leadReference) : null,
          ]);
          if (
            contactDocuments.some(
              (contact) =>
                !contact.exists ||
                contact.get("tenantId") !== command.tenantId ||
                contact.get("archivedAt"),
            )
          ) {
            throw new Error("CLIENT_NOT_FOUND");
          }
          if (leadReference) {
            if (
              !leadDocument?.exists ||
              leadDocument.get("tenantId") !== command.tenantId ||
              leadDocument.get("archivedAt") ||
              leadDocument.get("projectId")
            ) {
              throw new Error("LEAD_NOT_CONVERTIBLE");
            }
            // Most inquiries arrive from a web form long before the couple
            // is anyone in the address book, so `primaryContactId` is
            // routinely absent. There is nothing to mismatch in that case —
            // the caller has just created the contact from the inquiry — and
            // rejecting it made converting a cold lead impossible. Only a
            // lead that already names a contact has to agree with the
            // project's.
            const leadContactId = leadDocument.get("primaryContactId");
            if (
              typeof leadContactId === "string" &&
              leadContactId &&
              !command.input.clientContactIds.includes(leadContactId)
            ) {
              throw new Error("LEAD_CONTACT_MISMATCH");
            }
          }
          const project = {
            id: projectId,
            projectId,
            tenantId: command.tenantId,
            ...command.input,
            state: "LEAD",
            stateVersion: 0,
            packageSnapshotId: null,
            readinessScore: 0,
            nextAction: "Complete lead review",
            createdAt: timestamp,
            updatedAt: timestamp,
            createdBy: identity.uid,
            updatedBy: identity.uid,
            archivedAt: null,
          };
          transaction.create(db.doc(`projects/${projectId}`), project);
          if (leadReference) {
            transaction.update(leadReference, {
              projectId,
              // A lead that had no contact adopts the one the project was
              // created with, so the inquiry and the client stay joined up
              // afterwards rather than the link existing only in the project.
              primaryContactId:
                typeof leadDocument?.get("primaryContactId") === "string" &&
                leadDocument.get("primaryContactId")
                  ? leadDocument.get("primaryContactId")
                  : (command.input.clientContactIds[0] ?? null),
              status: "converted",
              convertedAt: timestamp,
              convertedBy: identity.uid,
              updatedAt: timestamp,
              updatedBy: identity.uid,
            });
          }
          for (const contact of contactDocuments) {
            const priorProjectIds = contact.get("projectIds");
            const projectIds = Array.from(
              new Set([
                ...(Array.isArray(priorProjectIds)
                  ? priorProjectIds.filter(
                      (value): value is string => typeof value === "string",
                    )
                  : []),
                projectId,
              ]),
            );
            transaction.update(contact.ref, {
              projectIds,
              updatedAt: timestamp,
              updatedBy: identity.uid,
            });
          }
          const auditId = randomUUID();
          transaction.create(db.doc(`auditEvents/${auditId}`), {
            id: auditId,
            tenantId: command.tenantId,
            projectId,
            actorId: identity.uid,
            actorType: "user",
            action: "project.created",
            entityType: "project",
            entityId: projectId,
            timestamp,
            before: null,
            after: { state: "LEAD", eventDate: command.input.eventDate },
            ipAddress: null,
            userAgent: request.header("user-agent") ?? null,
            correlationId,
            automationRunId: null,
            providerEventId: null,
          });
          if (leadReference) {
            const conversionAuditId = randomUUID();
            transaction.create(db.doc(`auditEvents/${conversionAuditId}`), {
              id: conversionAuditId,
              tenantId: command.tenantId,
              projectId,
              actorId: identity.uid,
              actorType: "user",
              action: "lead.converted",
              entityType: "lead",
              entityId: command.input.leadId,
              timestamp,
              before: { status: leadDocument?.get("status") ?? "new" },
              after: { status: "converted", projectId },
              ipAddress: null,
              userAgent: request.header("user-agent") ?? null,
              correlationId,
              automationRunId: null,
              providerEventId: null,
            });
          }
          const output = { projectId, state: "LEAD" };
          transaction.create(commandReference, {
            tenantId: command.tenantId,
            idempotencyKey: command.idempotencyKey,
            result: output,
            createdAt: timestamp,
          });
          return output;
        }

        if (command.type === "associateClientProject") {
          if (
            membershipData.role === "studio_coordinator" &&
            !membershipData.projectIds?.includes(command.input.projectId)
          ) {
            throw new Error("FORBIDDEN");
          }
          const contactReference = db.doc(
            `contacts/${command.input.contactId}`,
          );
          const projectReference = db.doc(
            `projects/${command.input.projectId}`,
          );
          const [contact, project] = await Promise.all([
            transaction.get(contactReference),
            transaction.get(projectReference),
          ]);
          if (
            !contact.exists ||
            contact.get("tenantId") !== command.tenantId ||
            contact.get("archivedAt")
          ) {
            throw new Error("CLIENT_NOT_FOUND");
          }
          if (
            !project.exists ||
            project.get("tenantId") !== command.tenantId ||
            project.get("state") === "ARCHIVED"
          ) {
            throw new Error("PROJECT_NOT_FOUND");
          }
          const priorContactProjects = contact.get("projectIds");
          const contactProjectIds = Array.from(
            new Set([
              ...(Array.isArray(priorContactProjects)
                ? priorContactProjects.filter(
                    (value): value is string => typeof value === "string",
                  )
                : []),
              command.input.projectId,
            ]),
          );
          const priorProjectClients = project.get("clientContactIds");
          const clientContactIds = Array.from(
            new Set([
              ...(Array.isArray(priorProjectClients)
                ? priorProjectClients.filter(
                    (value): value is string => typeof value === "string",
                  )
                : []),
              command.input.contactId,
            ]),
          );
          transaction.update(contactReference, {
            projectIds: contactProjectIds,
            updatedAt: timestamp,
            updatedBy: identity.uid,
          });
          transaction.update(projectReference, {
            clientContactIds,
            updatedAt: timestamp,
            updatedBy: identity.uid,
          });
          const auditId = randomUUID();
          transaction.create(db.doc(`auditEvents/${auditId}`), {
            id: auditId,
            tenantId: command.tenantId,
            projectId: command.input.projectId,
            actorId: identity.uid,
            actorType: "user",
            action: "client.project_associated",
            entityType: "contact",
            entityId: command.input.contactId,
            timestamp,
            before: {
              projectIds: Array.isArray(priorContactProjects)
                ? priorContactProjects
                : [],
            },
            after: { projectIds: contactProjectIds },
            ipAddress: null,
            userAgent: request.header("user-agent") ?? null,
            correlationId,
            automationRunId: null,
            providerEventId: null,
          });
          const output = {
            contactId: command.input.contactId,
            projectId: command.input.projectId,
            associated: true,
          };
          transaction.create(commandReference, {
            tenantId: command.tenantId,
            idempotencyKey: command.idempotencyKey,
            result: output,
            createdAt: timestamp,
          });
          return output;
        }

        if (command.type === "transitionProject") {
          const projectReference = db.doc(
            `projects/${command.input.projectId}`,
          );
          const projectSnapshot = await transaction.get(projectReference);
          const project = projectSnapshot.data() as
            | {
                tenantId: string;
                state: (typeof projectStates)[number];
                stateVersion: number;
              }
            | undefined;
          if (!project || project.tenantId !== command.tenantId) {
            throw new Error("PROJECT_NOT_FOUND");
          }
          if (project.stateVersion !== command.input.expectedVersion) {
            throw new Error("VERSION_CONFLICT");
          }
          if (!transitions[project.state].includes(command.input.targetState)) {
            throw new Error("INVALID_TRANSITION");
          }
          if (
            evidenceControlledTransitions.has(
              `${project.state}:${command.input.targetState}`,
            )
          ) {
            throw new Error("EVIDENCE_CONTROLLED_TRANSITION");
          }
          transaction.update(projectReference, {
            state: command.input.targetState,
            stateVersion: project.stateVersion + 1,
            updatedAt: timestamp,
            updatedBy: identity.uid,
          });
          const auditId = randomUUID();
          transaction.create(db.doc(`auditEvents/${auditId}`), {
            id: auditId,
            tenantId: command.tenantId,
            projectId: command.input.projectId,
            actorId: identity.uid,
            actorType: "user",
            action: "project.state_changed",
            entityType: "project",
            entityId: command.input.projectId,
            timestamp,
            before: {
              state: project.state,
              stateVersion: project.stateVersion,
            },
            after: {
              state: command.input.targetState,
              stateVersion: project.stateVersion + 1,
            },
            ipAddress: null,
            userAgent: request.header("user-agent") ?? null,
            correlationId,
            automationRunId: null,
            providerEventId: null,
          });
          const output = {
            projectId: command.input.projectId,
            state: command.input.targetState,
            stateVersion: project.stateVersion + 1,
          };
          transaction.create(commandReference, {
            tenantId: command.tenantId,
            idempotencyKey: command.idempotencyKey,
            result: output,
            createdAt: timestamp,
          });
          return output;
        }

        if (command.type === "createPackage") {
          const packageId = randomUUID();
          transaction.create(db.doc(`packages/${packageId}`), {
            id: packageId,
            tenantId: command.tenantId,
            ...command.input,
            version: 1,
            createdAt: timestamp,
            updatedAt: timestamp,
            createdBy: identity.uid,
            updatedBy: identity.uid,
            archivedAt: null,
          });
          const auditId = randomUUID();
          transaction.create(db.doc(`auditEvents/${auditId}`), {
            id: auditId,
            tenantId: command.tenantId,
            projectId: null,
            actorId: identity.uid,
            actorType: "user",
            action: "package.created",
            entityType: "package",
            entityId: packageId,
            timestamp,
            before: null,
            after: {
              name: command.input.name,
              version: 1,
              basePriceCents: command.input.basePriceCents,
            },
            ipAddress: null,
            userAgent: request.header("user-agent") ?? null,
            correlationId,
            automationRunId: null,
            providerEventId: null,
          });
          const output = { packageId, version: 1 };
          transaction.create(commandReference, {
            tenantId: command.tenantId,
            idempotencyKey: command.idempotencyKey,
            result: output,
            createdAt: timestamp,
          });
          return output;
        }

        if (command.type === "selectPackage") {
          const projectReference = db.doc(
            `projects/${command.input.projectId}`,
          );
          const packageReference = db.doc(
            `packages/${command.input.packageId}`,
          );
          const [projectDocument, packageDocument] = await Promise.all([
            transaction.get(projectReference),
            transaction.get(packageReference),
          ]);
          const project = projectDocument.data() as
            | { tenantId: string; packageSnapshotId: string | null }
            | undefined;
          const studioPackage = packageDocument.data() as
            | {
                tenantId: string;
                name: string;
                description: string;
                basePriceCents: number;
                currency: string;
                version: number;
                retainerRule:
                  | { type: "fixed"; amountCents: number }
                  | { type: "percentage"; basisPoints: number }
                  | { type: "per_crew_member"; amountPerCrewCents: number };
                includedCoverageMinutes: number;
                includedPhotographers: number;
                includedDeliverables: string[];
                includedTravelArea: string;
                addOns: Array<{
                  id: string;
                  name: string;
                  unitPriceCents: number;
                  taxable: boolean;
                  active: boolean;
                }>;
                taxRateBasisPoints: number;
                terms: string;
                active: boolean;
              }
            | undefined;
          if (!project || project.tenantId !== command.tenantId) {
            throw new Error("PROJECT_NOT_FOUND");
          }
          if (project.packageSnapshotId) {
            throw new Error("PACKAGE_ALREADY_SELECTED");
          }
          if (
            !studioPackage ||
            studioPackage.tenantId !== command.tenantId ||
            !studioPackage.active
          ) {
            throw new Error("PACKAGE_NOT_FOUND");
          }

          const selectedLines = command.input.selectedAddOns.map(
            (selection) => {
              const addOn = studioPackage.addOns.find(
                (candidate) =>
                  candidate.id === selection.addOnId && candidate.active,
              );
              if (!addOn) throw new Error("ADD_ON_NOT_FOUND");
              return {
                addOnId: addOn.id,
                name: addOn.name,
                quantity: selection.quantity,
                unitPriceCents: addOn.unitPriceCents,
                lineTotalCents: addOn.unitPriceCents * selection.quantity,
                taxable: addOn.taxable,
              };
            },
          );
          const addOnTotal = selectedLines.reduce(
            (sum, line) => sum + line.lineTotalCents,
            0,
          );
          const preDiscount = studioPackage.basePriceCents + addOnTotal;
          const requestedDiscount =
            command.input.discount.type === "none"
              ? 0
              : command.input.discount.type === "fixed"
                ? command.input.discount.amountCents
                : Math.round(
                    (preDiscount * command.input.discount.basisPoints) / 10000,
                  );
          const discountCents = Math.min(preDiscount, requestedDiscount);
          const subtotalCents = preDiscount - discountCents;
          const taxCents = Math.round(
            (subtotalCents * studioPackage.taxRateBasisPoints) / 10000,
          );
          const totalCents = subtotalCents + taxCents;
          const retainerCents =
            studioPackage.retainerRule.type === "fixed"
              ? Math.min(totalCents, studioPackage.retainerRule.amountCents)
              : studioPackage.retainerRule.type === "per_crew_member"
                ? Math.min(
                    totalCents,
                    studioPackage.retainerRule.amountPerCrewCents *
                      Math.max(1, studioPackage.includedPhotographers),
                  )
                : Math.round(
                    (totalCents * studioPackage.retainerRule.basisPoints) /
                      10000,
                  );
          const packageSnapshotId = randomUUID();
          transaction.create(db.doc(`packageSnapshots/${packageSnapshotId}`), {
            id: packageSnapshotId,
            tenantId: command.tenantId,
            projectId: command.input.projectId,
            packageId: command.input.packageId,
            packageVersion: studioPackage.version,
            packageName: studioPackage.name,
            description: studioPackage.description,
            currency: studioPackage.currency,
            basePriceCents: studioPackage.basePriceCents,
            addOns: selectedLines,
            discountCents,
            subtotalCents,
            taxCents,
            retainerCents,
            totalCents,
            includedCoverageMinutes: studioPackage.includedCoverageMinutes,
            includedPhotographers: studioPackage.includedPhotographers,
            includedDeliverables: studioPackage.includedDeliverables,
            includedTravelArea: studioPackage.includedTravelArea,
            terms: studioPackage.terms,
            selectionDate: timestamp,
            selectedBy: identity.uid,
            immutable: true,
            createdAt: timestamp,
            createdBy: identity.uid,
          });
          transaction.update(projectReference, {
            packageSnapshotId,
            updatedAt: timestamp,
            updatedBy: identity.uid,
          });
          const auditId = randomUUID();
          transaction.create(db.doc(`auditEvents/${auditId}`), {
            id: auditId,
            tenantId: command.tenantId,
            projectId: command.input.projectId,
            actorId: identity.uid,
            actorType: "user",
            action: "package.selected",
            entityType: "packageSnapshot",
            entityId: packageSnapshotId,
            timestamp,
            before: null,
            after: {
              packageId: command.input.packageId,
              packageVersion: studioPackage.version,
              totalCents,
            },
            ipAddress: null,
            userAgent: request.header("user-agent") ?? null,
            correlationId,
            automationRunId: null,
            providerEventId: null,
          });
          const output = { packageSnapshotId, totalCents, retainerCents };
          transaction.create(commandReference, {
            tenantId: command.tenantId,
            idempotencyKey: command.idempotencyKey,
            result: output,
            createdAt: timestamp,
          });
          return output;
        }

        // Explicit guard: this block used to be the implicit fallthrough, so
        // any future schema type without a handler would have silently
        // created a malformed contact from its input.
        if (command.type !== "createContact")
          throw new Error("UNSUPPORTED_COMMAND");
        const contactId = randomUUID();
        const normalizedEmail =
          command.input.email?.trim().toLowerCase() ?? null;
        transaction.create(db.doc(`contacts/${contactId}`), {
          id: contactId,
          tenantId: command.tenantId,
          ...command.input,
          displayName: `${command.input.firstName} ${command.input.lastName}`,
          normalizedEmail,
          normalizedPhone: command.input.phone?.replace(/\D/g, "") ?? null,
          projectIds: [],
          portalUserId: null,
          marketingConsent: false,
          notes: null,
          createdAt: timestamp,
          updatedAt: timestamp,
          createdBy: identity.uid,
          updatedBy: identity.uid,
          archivedAt: null,
        });
        const output = { contactId };
        transaction.create(commandReference, {
          tenantId: command.tenantId,
          idempotencyKey: command.idempotencyKey,
          result: output,
          createdAt: timestamp,
        });
        return output;
      });
      response.status(200).json(result);
    } catch (error) {
      const code = error instanceof Error ? error.message : "COMMAND_FAILED";
      const status =
        code === "VERSION_CONFLICT"
          ? 409
          : code === "PROJECT_NOT_FOUND"
            ? 404
            : 422;
      response.status(status).json({ error: code });
    }
  },
);
