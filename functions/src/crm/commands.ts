import { randomUUID } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { requireAppCheck, requireIdentity } from "./security.js";
import { requireActiveSubscription } from "../saas/entitlement-guard.js";
import { studioHubCors } from "../security/cors.js";
import { reconcileProjectReadiness } from "../workflow/readiness-triggers.js";
import { invalidCommandResponse } from "../security/invalid-command.js";
import {
  archiveBlockedBy,
  dispositionFor,
  isLiveAssignment,
} from "../crew/job-stopped.js";
import {
  coverageFromPhotographerCount,
  coverageRoleSchema,
  includedCoverageSchema,
  legacyPhotographerCount,
  resolveCoverage,
  type CoverageItem,
  type CoverageRole,
} from "../packages/coverage.js";

/**
 * Coverage as sent by the browser, from either shape.
 *
 * Both fields are optional on the wire and this is deliberate: functions
 * deploy before the app does, so the deployed command must still accept a
 * payload from the previous client, which sends `includedPhotographers`
 * alone.
 */
function coverageFromInput(input: {
  includedCoverage?: readonly CoverageItem[];
  includedPhotographers?: number;
}): CoverageItem[] {
  if (input.includedCoverage?.length) {
    return input.includedCoverage.map((item) => ({ ...item }));
  }
  return coverageFromPhotographerCount(input.includedPhotographers ?? 1);
}

/** The pair, written together so they can never drift apart. */
function coverageFields(coverage: readonly CoverageItem[]) {
  return {
    includedCoverage: coverage.map((item) => ({ ...item })),
    includedPhotographers: legacyPhotographerCount(coverage),
  };
}

/** Mirrors billedCrewCount in features/packages/create-snapshot.ts. */
function billedCrewCount(
  coverage: readonly CoverageItem[],
  billedRoles: readonly CoverageRole[] | undefined,
): number {
  const roles = billedRoles?.length ? billedRoles : (["photographer"] as const);
  return Math.max(
    1,
    roles.reduce(
      (sum, role) =>
        sum + (coverage.find((item) => item.role === role)?.count ?? 0),
      0,
    ),
  );
}

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
  /**
   * `EVENT_COMPLETE` from BOOKED and PLANNING, not only from READY.
   *
   * The old shape said a wedding could only have been shot if the studio had
   * first reached 100% readiness — so a job whose date had passed while it sat
   * in PLANNING could not be recorded as having happened at all. The studio had
   * to waive its way to full preparation for a wedding already in the past
   * before StudioCue would accept that it took place.
   *
   * That is backwards. Weddings happen whether or not the checkboxes were
   * ticked, and READY is a statement about preparation, not about reality.
   * Nothing is loosened by this: EVENT_COMPLETE was never evidence-controlled,
   * and the gate that matters — signature and retainer — is behind the job
   * before BOOKED.
   */
  BOOKED: ["PLANNING", "EVENT_COMPLETE", "CANCELLED", "POSTPONED"],
  PLANNING: ["READY", "EVENT_COMPLETE", "CANCELLED", "POSTPONED"],
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
      // The venue as captured, not as typed. Mirrors
      // capturedPlaceSchema in features/places/schema.ts — functions/ is a
      // separate package with no "@/features" path, so the shape is
      // duplicated here and tests/places-schema.test.ts asserts the two
      // copies still agree. `verified` is what a certificate of insurance
      // has to check before it trusts the address.
      venue: z
        .object({
          placeId: z.string().max(400).nullable(),
          formatted: z.string().min(1).max(500),
          name: z.string().max(300).nullable(),
          line1: z.string().max(300).nullable(),
          city: z.string().max(160).nullable(),
          region: z.string().max(160).nullable(),
          postalCode: z.string().max(40).nullable(),
          country: z.string().length(2).nullable(),
          latitude: z.number().min(-90).max(90).nullable(),
          longitude: z.number().min(-180).max(180).nullable(),
          verified: z.boolean(),
        })
        .nullable()
        .default(null),
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
      /**
       * Why, for the moves where why is the whole point.
       *
       * Required when a job is put on hold or called off — six months later
       * "POSTPONED" on its own tells nobody anything. Optional elsewhere,
       * where the move speaks for itself.
       */
      reason: z.string().max(500).nullable().default(null),
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
    /**
     * Correct a client's details.
     *
     * Contacts could be created and never changed: no `updateContact` command
     * existed, and the People page offered a client three controls — message,
     * pick a project, send a portal invite. A misspelt name, a new phone
     * number or an email typed wrong at the inquiry form was permanent, and
     * the wrong email means no proposal, no portal and no gallery.
     *
     * Deliberately the contact's own details. Project links, portal identity
     * and consent are set by the flows that own them, and a general-purpose
     * overwrite here would let a form clear them by omission.
     */
    type: z.literal("updateContact"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      contactId: z.string().min(1),
      firstName: z.string().trim().min(1).max(80),
      lastName: z.string().trim().min(1).max(80),
      /**
       * What the studio calls them, when that is not "first last".
       *
       * A wedding client is usually a couple held as one contact — "Avery &
       * Sam" — and rebuilding the display name from the two name fields turned
       * that into "Avery Sam" the first time anyone edited the record. The
       * studio types the name they use; the derived form is only the fallback.
       */
      displayName: z.string().trim().max(200).nullable().default(null),
      email: z.string().email().nullable(),
      phone: z.string().max(30).nullable(),
      company: z.string().max(160).nullable(),
      notes: z.string().max(2000).nullable().default(null),
    }),
  }),
  z.object({
    /**
     * Correct a job's own details.
     *
     * StudioCue was write-once for everything except a client. A studio could
     * create a job and never change its name, its date, its venue or its type
     * — and the reference studio proved the cost of that in an afternoon: he
     * typed a client email with a deliberate typo to see whether he could fix
     * it, could not, and then sent a proposal four times to an address nobody
     * reads. `firestore.rules` has allowed a browser to update a project the
     * whole time; only the act was missing.
     *
     * Deliberately the job's own descriptive fields. `state` is a deterministic
     * transition with its own evidence-controlled path and is not editable
     * here; `packageSnapshotId`, `readinessScore` and the audit fields are
     * derived, and a general-purpose overwrite would let a form clear them by
     * omission.
     */
    type: z.literal("updateProject"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      projectId: z.string().min(1),
      name: z.string().trim().min(1).max(200),
      /**
       * The day the work happens.
       *
       * Everything dated hangs off this — relative-date automations, the
       * invoice scheduler, readiness. Changing it is legitimate (a couple
       * moves the wedding) and it is the one field here with consequences
       * beyond the record, so the handler re-derives readiness after it moves.
       */
      eventDate: z.string().date(),
      eventType: z.string().trim().min(1).max(80),
      venueName: z.string().trim().max(200).nullable().default(null),
      city: z.string().trim().max(120).nullable().default(null),
      timezone: z.string().trim().min(1).max(80),
    }),
  }),
  z.object({
    /**
     * Take a client out of the working list.
     *
     * Archive, not delete: `firestore.rules` refuses a delete on every
     * collection in this product, because a contact is referenced by projects,
     * proposals, contracts and messages that must keep making sense. The
     * People page has always had an "Archived" filter; nothing could put
     * anything in it.
     *
     * A contact attached to a live project is refused — archiving it would
     * hide the client of a job still in flight.
     */
    type: z.literal("archiveContact"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      contactId: z.string().min(1),
      /** Undo, for the archive filter's own restore control. */
      restore: z.boolean().default(false),
    }),
  }),
  z.object({
    /**
     * Take a job off the working list.
     *
     * Bookkeeping, not an outcome: the Jobs list has always had an Archived
     * tab and nothing could put a job in it, so "delete" was the word studios
     * reached for. Deliberately allowed at any stage — a studio archiving a
     * dead enquiry or a duplicate should not have to cancel a wedding that was
     * never on — and deliberately distinct from CANCELLED, which records that
     * the wedding is off and tells the rest of the product to stop chasing it.
     *
     * Reversible, and it deletes nothing.
     */
    type: z.literal("archiveProject"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      projectId: z.string().min(1),
      restore: z.boolean().default(false),
    }),
  }),
  /**
   * Correct a package that already exists.
   *
   * An imported price list rarely states a retainer or says whether the
   * pricing may be shown to clients, so the importer writes a zero retainer
   * and keeps the package private. Until this existed there was no way to
   * change either: packages could be created and never edited, so an import
   * with the wrong deposit was permanent.
   *
   * Deliberately narrow — the fields a studio corrects after an import,
   * not a general-purpose overwrite.
   */
  z.object({
    type: z.literal("updatePackage"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      packageId: z.string().min(1),
      name: z.string().trim().min(2).max(120).optional(),
      description: z.string().trim().min(10).max(3000).optional(),
      basePriceCents: z.number().int().nonnegative().safe().optional(),
      retainerRule: z
        .discriminatedUnion("type", [
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
            billedRoles: z.array(coverageRoleSchema).min(1).optional(),
          }),
        ])
        .optional(),
      includedCoverageMinutes: z.number().int().positive().optional(),
      includedCoverage: includedCoverageSchema.optional(),
      includedPhotographers: z.number().int().positive().optional(),
      active: z.boolean().optional(),
      publicVisible: z.boolean().optional(),
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
          billedRoles: z.array(coverageRoleSchema).min(1).optional(),
        }),
      ]),
      includedCoverageMinutes: z.number().int().positive(),
      includedCoverage: includedCoverageSchema.optional(),
      includedPhotographers: z.number().int().positive().optional(),
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

const managerRoles = ["studio_owner", "studio_admin"];
const allowedRoles = [...managerRoles, "studio_coordinator"];

/**
 * Whether this member may act on this particular project.
 *
 * Owners and admins are tenant-wide. A coordinator holds a list of permitted
 * project ids, and `firestore.rules` enforces it for direct writes:
 * `canManageProject` lets a coordinator update only a project they are assigned
 * to. This endpoint did not. Of its eight command types, exactly one —
 * `associateClientProject` — checked assignment, so a coordinator could
 * transition *any* project in the studio through its entire lifecycle, and lock
 * a package onto it, regardless of what they were assigned.
 *
 * The other five command endpoints all had this gate already
 * (`hasProjectAccess` in workflow, the equivalent in booking, planning,
 * post-event and communications). This one was the omission.
 */
function hasProjectAccess(
  membership: { role: string; projectIds?: string[] },
  projectId: string,
): boolean {
  return (
    managerRoles.includes(membership.role) ||
    membership.projectIds?.includes(projectId) === true
  );
}

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
      response.status(400).json(invalidCommandResponse(parsed.error));
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
    // Whole-product billing gate: no studio work without a live trial/paid
    // subscription. 402 Payment Required so the client can route to Checkout.
    try {
      await requireActiveSubscription(db, command.tenantId);
    } catch {
      response.status(402).json({ error: "ACTIVE_SUBSCRIPTION_REQUIRED" });
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

    /**
     * The crew this job is still holding, read before the transaction.
     *
     * Calling off or filing away a job has to answer for the people on it, and
     * a transaction cannot start with a collection query. Read here, acted on
     * inside — the same shape the booking gate uses for its contracts and
     * invoices. A new offer created in the gap is not caught; that is a
     * narrower window than the one this closes.
     */
    const crewProjectId = ((): string | null => {
      /**
       * Read structurally rather than by `command.type`.
       *
       * Two guards — tests/command-project-assignment and the receipt check in
       * tests/command-idempotency — find a command's branch by its first
       * `command.type === "…"` test and read what follows. A second test out
       * here would hand them this block instead of the real handler, and they
       * would report a missing assignment check and a missing receipt. They are
       * right to: one branch per command type is the shape this file keeps.
       */
      const input = command.input as Record<string, unknown>;
      const projectId =
        typeof input.projectId === "string" ? input.projectId : null;
      if (!projectId) return null;
      // Filing a job away (rather than restoring one).
      if (input.restore === false) return projectId;
      // Or calling it off / putting it on hold.
      return ["CANCELLED", "POSTPONED"].includes(String(input.targetState ?? ""))
        ? projectId
        : null;
    })();
    const liveCrew = crewProjectId
      ? (
          await db
            .collection("crewAssignments")
            .where("tenantId", "==", command.tenantId)
            .where("projectId", "==", crewProjectId)
            .get()
        ).docs.filter((assignment) => isLiveAssignment(assignment.get("status")))
      : [];
    /**
     * Where a cancellation notice goes, resolved here and written onto the
     * job.
     *
     * `recipientFor` in the email worker falls back to the project's first
     * *client* contact when a job carries no recipient — which for a crew
     * notice would mail the couple to say their photographer's assignment is
     * off. An assignment holds a `crewProfileId`, not an address, so the
     * address is looked up now and stated explicitly.
     */
    /**
     * The cascades behind those assignments, and whether they still exist.
     *
     * A cascade still working down its list would offer the next name on a job
     * that has stopped, so it has to be closed — but `transaction.update`
     * throws on a document that is gone, and a wedding must not fail to be
     * cancelled because a cascade record was tidied away.
     */
    const liveCascadeIds: string[] = [];
    for (const cascadeId of new Set(
      liveCrew
        .map((assignment) => String(assignment.get("cascadeId") ?? ""))
        .filter(Boolean),
    )) {
      const cascade = await db.doc(`crewCascades/${cascadeId}`).get();
      if (cascade.exists && cascade.get("status") === "active")
        liveCascadeIds.push(cascadeId);
    }
    const crewEmails = new Map<string, { email: string; name: string }>();
    for (const profileId of new Set(
      liveCrew
        .map((assignment) => String(assignment.get("crewProfileId") ?? ""))
        .filter(Boolean),
    )) {
      const profile = await db.doc(`crewProfiles/${profileId}`).get();
      const email = String(profile.get("email") ?? "");
      if (profile.exists && email.includes("@"))
        crewEmails.set(profileId, {
          email,
          name: String(profile.get("name") ?? "there"),
        });
    }

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
          if (!hasProjectAccess(membershipData, command.input.projectId)) {
            throw new Error("PROJECT_NOT_PERMITTED");
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
          if (!hasProjectAccess(membershipData, command.input.projectId)) {
            throw new Error("PROJECT_NOT_PERMITTED");
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
          if (
            ["POSTPONED", "CANCELLED"].includes(command.input.targetState) &&
            (command.input.reason?.trim().length ?? 0) < 10
          ) {
            throw new Error("INTERRUPTION_REASON_REQUIRED");
          }
          transaction.update(projectReference, {
            state: command.input.targetState,
            stateVersion: project.stateVersion + 1,
            // Kept on the project, not only in the audit log, so the job page
            // can say why it is on hold without a log query.
            ...(["POSTPONED", "CANCELLED"].includes(command.input.targetState)
              ? {
                  interruptionReason: command.input.reason ?? null,
                  interruptionAt: timestamp,
                }
              : {}),
            updatedAt: timestamp,
            updatedBy: identity.uid,
          });
          /**
           * The crew, when the job stops.
           *
           * Calling a wedding off used to leave every offer standing: an
           * un-answered one in somebody's inbox with a fee on it, and an
           * accepted one belonging to a second shooter holding the date. They
           * were told nothing.
           *
           * Somebody who never accepted is withdrawn quietly — the offer
           * vanishing from their portal is the whole message. Somebody who
           * accepted is withdrawn *and* emailed, because they are the one who
           * turned other work down. A postponement keeps an accepted
           * assignment: the date is moving, not gone, and re-agreeing it is a
           * conversation rather than a side effect.
           */
          const stopReason =
            command.input.targetState === "CANCELLED"
              ? ("cancelled" as const)
              : ("postponed" as const);
          const withdrawn: string[] = [];
          if (["CANCELLED", "POSTPONED"].includes(command.input.targetState)) {
            for (const assignment of liveCrew) {
              const disposition = dispositionFor({
                reason: stopReason,
                status: String(assignment.get("status")),
              });
              if (disposition.action !== "withdraw") continue;
              transaction.update(assignment.ref, {
                status: "cancelled",
                cancelledAt: timestamp,
                cancelledReason: command.input.reason ?? null,
                updatedAt: timestamp,
                updatedBy: identity.uid,
              });
              withdrawn.push(assignment.id);
              if (!disposition.notify) continue;
              const contact = crewEmails.get(
                String(assignment.get("crewProfileId") ?? ""),
              );
              // No address, no mail — never fall through to the worker's
              // client-contact default, which would tell the couple.
              if (!contact) continue;
              const noticeId = `crew_cancelled_${assignment.id}`;
              transaction.create(db.doc(`emailJobs/${noticeId}`), {
                id: noticeId,
                tenantId: command.tenantId,
                projectId: command.input.projectId,
                assignmentId: assignment.id,
                type: "crew_assignment_cancelled",
                recipient: contact?.email ?? null,
                recipientName: contact?.name ?? null,
                crewProfileId: assignment.get("crewProfileId") ?? null,
                role: assignment.get("role") ?? null,
                reason: command.input.reason ?? null,
                status: "queued",
                attempts: 0,
                createdAt: timestamp,
                updatedAt: timestamp,
              });
            }
            // A cascade still working down its list would offer the next name
            // on a job that has stopped. Only the ones still there and still
            // active — see the read above.
            for (const cascadeId of liveCascadeIds) {
              transaction.update(db.doc(`crewCascades/${cascadeId}`), {
                status: "exhausted",
                handlingCompletedAt: timestamp,
                updatedAt: timestamp,
                updatedBy: identity.uid,
              });
            }
          }
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
              // The whole point of the audit entry when a job is held or
              // called off.
              reason: command.input.reason ?? null,
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

        if (command.type === "updatePackage") {
          const reference = db.doc(`packages/${command.input.packageId}`);
          const existing = await transaction.get(reference);
          if (!existing.exists || existing.get("tenantId") !== command.tenantId)
            throw new Error("PACKAGE_NOT_FOUND");
          const { packageId, ...changes } = command.input;
          // Only what was actually sent; an omitted field is untouched.
          const patch: Record<string, unknown> = Object.fromEntries(
            Object.entries(changes).filter(([, value]) => value !== undefined),
          );
          if (!Object.keys(patch).length) throw new Error("NO_PACKAGE_CHANGES");
          /**
           * Coverage is two fields describing one fact, so an edit that moves
           * either must move both. An edit that touches neither leaves the
           * package exactly as it was, including a legacy package that has no
           * `includedCoverage` yet.
           */
          if (
            changes.includedCoverage !== undefined ||
            changes.includedPhotographers !== undefined
          ) {
            Object.assign(patch, coverageFields(coverageFromInput(changes)));
          }
          const nextVersion = Number(existing.get("version") ?? 1) + 1;
          transaction.update(reference, {
            ...patch,
            version: nextVersion,
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
            action: "package.updated",
            entityType: "package",
            entityId: packageId,
            timestamp,
            before: Object.fromEntries(
              Object.keys(patch).map((key) => [key, existing.get(key) ?? null]),
            ),
            after: patch,
            providerEventId: null,
          });
          const output = { packageId, version: nextVersion };
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
          /**
           * The studio's currency, not the browser's.
           *
           * `create-package-form.tsx` sends a hardcoded "USD", so a studio
           * outside the US priced everything in dollars regardless of the
           * currency on their own workspace — and that currency was read
           * nowhere at all, which is why nobody noticed. The tenant is the
           * authority; the submitted value is the fallback for a tenant
           * created before the field existed.
           */
          const tenantForCurrency = await transaction.get(
            db.doc(`tenants/${command.tenantId}`),
          );
          const currency =
            typeof tenantForCurrency.get("currency") === "string" &&
            String(tenantForCurrency.get("currency")).length === 3
              ? String(tenantForCurrency.get("currency"))
              : command.input.currency;
          transaction.create(db.doc(`packages/${packageId}`), {
            id: packageId,
            tenantId: command.tenantId,
            ...command.input,
            // After the spread: the pair is derived, never taken as sent.
            ...coverageFields(coverageFromInput(command.input)),
            currency,
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
                  | {
                      type: "per_crew_member";
                      amountPerCrewCents: number;
                      billedRoles?: CoverageRole[];
                    };
                includedCoverageMinutes: number;
                includedCoverage?: CoverageItem[];
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
          if (!hasProjectAccess(membershipData, command.input.projectId)) {
            throw new Error("PROJECT_NOT_PERMITTED");
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
          const coverage = resolveCoverage(studioPackage);
          const retainerCents =
            studioPackage.retainerRule.type === "fixed"
              ? Math.min(totalCents, studioPackage.retainerRule.amountCents)
              : studioPackage.retainerRule.type === "per_crew_member"
                ? Math.min(
                    totalCents,
                    studioPackage.retainerRule.amountPerCrewCents *
                      billedCrewCount(
                        coverage,
                        studioPackage.retainerRule.billedRoles,
                      ),
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
            ...coverageFields(coverage),
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

        if (command.type === "updateContact") {
          // Editing and archiving a client is an owner/admin decision: a
          // coordinator works jobs, they do not curate the address book.
          if (!["studio_owner", "studio_admin"].includes(membershipData.role)) {
            throw new Error("FORBIDDEN");
          }
          const contactReference = db.doc(
            `contacts/${command.input.contactId}`,
          );
          const contact = await transaction.get(contactReference);
          if (
            !contact.exists ||
            contact.get("tenantId") !== command.tenantId ||
            contact.get("archivedAt")
          ) {
            throw new Error("CONTACT_NOT_FOUND");
          }
          const before = {
            firstName: contact.get("firstName") ?? null,
            lastName: contact.get("lastName") ?? null,
            email: contact.get("email") ?? null,
            phone: contact.get("phone") ?? null,
            company: contact.get("company") ?? null,
          };
          const email = command.input.email?.trim() ?? null;
          transaction.update(contactReference, {
            firstName: command.input.firstName,
            lastName: command.input.lastName,
            displayName:
              command.input.displayName ||
              `${command.input.firstName} ${command.input.lastName}`,
            email,
            // Kept in step with the create path, which every lookup depends on:
            // `findContactByEmail` matches on the normalised form, so leaving
            // it stale would make a corrected email unfindable.
            normalizedEmail: email?.toLowerCase() ?? null,
            phone: command.input.phone,
            normalizedPhone: command.input.phone?.replace(/\D/g, "") ?? null,
            company: command.input.company,
            notes: command.input.notes,
            updatedAt: timestamp,
            updatedBy: identity.uid,
          });
          const contactAuditId = randomUUID();
          transaction.create(db.doc(`auditEvents/${contactAuditId}`), {
            id: contactAuditId,
            tenantId: command.tenantId,
            projectId: null,
            actorId: identity.uid,
            actorType: "user",
            action: "contact.updated",
            entityType: "contact",
            entityId: command.input.contactId,
            timestamp,
            before,
            after: {
              firstName: command.input.firstName,
              lastName: command.input.lastName,
              email,
              phone: command.input.phone,
              company: command.input.company,
            },
            ipAddress: null,
            userAgent: request.header("user-agent") ?? null,
            correlationId,
            automationRunId: null,
            providerEventId: null,
          });
          const output = { contactId: command.input.contactId, updated: true };
          transaction.create(commandReference, {
            tenantId: command.tenantId,
            idempotencyKey: command.idempotencyKey,
            result: output,
            createdAt: timestamp,
          });
          return output;
        }

        if (command.type === "updateProject") {
          /**
           * A coordinator runs jobs, so a coordinator may correct one. This is
           * a lower bar than editing the address book or archiving, both of
           * which curate what the studio has rather than fix what it typed.
           */
          if (
            !["studio_owner", "studio_admin", "studio_coordinator"].includes(
              membershipData.role,
            )
          ) {
            throw new Error("FORBIDDEN");
          }
          const projectReference = db.doc(`projects/${command.input.projectId}`);
          const project = await transaction.get(projectReference);
          if (!project.exists || project.get("tenantId") !== command.tenantId) {
            throw new Error("PROJECT_NOT_FOUND");
          }
          if (!hasProjectAccess(membershipData, project.id)) {
            throw new Error("PROJECT_ACCESS_DENIED");
          }
          // A job the studio has put away is not one to edit, for the same
          // reason Cue will not staff one.
          if (project.get("archivedAt")) {
            throw new Error("PROJECT_ARCHIVED");
          }
          const before = {
            name: project.get("name") ?? null,
            eventDate: project.get("eventDate") ?? null,
            eventType: project.get("eventType") ?? null,
            venueName: project.get("venueName") ?? null,
            city: project.get("city") ?? null,
            timezone: project.get("timezone") ?? null,
          };
          transaction.update(projectReference, {
            name: command.input.name,
            eventDate: command.input.eventDate,
            eventType: command.input.eventType,
            venueName: command.input.venueName,
            city: command.input.city,
            timezone: command.input.timezone,
            updatedAt: timestamp,
            updatedBy: identity.uid,
          });
          const projectAuditId = randomUUID();
          transaction.create(db.doc(`auditEvents/${projectAuditId}`), {
            id: projectAuditId,
            tenantId: command.tenantId,
            projectId: command.input.projectId,
            actorUserId: identity.uid,
            action: "project.updated",
            occurredAt: timestamp,
            /**
             * Both sides, because "the date moved" is the question someone
             * asks weeks later when a dated automation fired at the wrong
             * time, and an audit that records only the new value cannot
             * answer it.
             */
            payload: {
              before,
              after: {
                name: command.input.name,
                eventDate: command.input.eventDate,
                eventType: command.input.eventType,
                venueName: command.input.venueName,
                city: command.input.city,
                timezone: command.input.timezone,
              },
            },
            ipAddress: null,
            userAgent: request.header("user-agent") ?? null,
            correlationId,
            automationRunId: null,
            providerEventId: null,
          });
          const output = {
            projectId: command.input.projectId,
            updated: true,
            // Read by the caller so the handler below knows whether the dated
            // work needs re-deriving, without re-reading the document.
            eventDateChanged: before.eventDate !== command.input.eventDate,
          };
          transaction.create(commandReference, {
            tenantId: command.tenantId,
            idempotencyKey: command.idempotencyKey,
            result: output,
            createdAt: timestamp,
          });
          return output;
        }

        if (command.type === "archiveProject") {
          // Same bar as archiving a client: curating the working list is an
          // owner/admin decision, not a coordinator's.
          if (!["studio_owner", "studio_admin"].includes(membershipData.role)) {
            throw new Error("FORBIDDEN");
          }
          const projectReference = db.doc(`projects/${command.input.projectId}`);
          const project = await transaction.get(projectReference);
          if (
            !project.exists ||
            project.get("tenantId") !== command.tenantId
          ) {
            throw new Error("PROJECT_NOT_FOUND");
          }
          if (!hasProjectAccess(membershipData, project.id)) {
            throw new Error("PROJECT_ACCESS_DENIED");
          }
          /**
           * Never file away a job somebody is waiting on.
           *
           * Archiving is bookkeeping and stays allowed at any stage — that is
           * how a dead enquiry or a duplicate gets cleared, and why it was
           * deliberately not gated on state. But it ends nothing, so archiving
           * a job with a live offer on it hid the offer from the studio while
           * leaving it standing for the crew member, who would have turned up.
           *
           * The same rule archiving a client already follows, for the same
           * reason. Cancelling is the move that actually ends the offers.
           */
          const archiveBlock = archiveBlockedBy(
            liveCrew.map((assignment) => ({
              status: String(assignment.get("status")),
              role: assignment.get("role") as string | null,
            })),
          );
          if (!command.input.restore && archiveBlock.blocked) {
            throw new Error("PROJECT_HAS_LIVE_CREW");
          }
          transaction.update(projectReference, {
            archivedAt: command.input.restore ? null : timestamp,
            updatedAt: timestamp,
            updatedBy: identity.uid,
          });
          const projectArchiveAuditId = randomUUID();
          transaction.create(db.doc(`auditEvents/${projectArchiveAuditId}`), {
            id: projectArchiveAuditId,
            tenantId: command.tenantId,
            projectId: command.input.projectId,
            actorId: identity.uid,
            actorType: "user",
            action: command.input.restore
              ? "project.restored"
              : "project.archived",
            entityType: "project",
            entityId: command.input.projectId,
            timestamp,
            before: { archivedAt: project.get("archivedAt") ?? null },
            after: { archivedAt: command.input.restore ? null : timestamp },
            ipAddress: null,
            userAgent: request.header("user-agent") ?? null,
            correlationId,
            automationRunId: null,
            providerEventId: null,
          });
          const projectArchiveOutput = {
            projectId: command.input.projectId,
            archived: !command.input.restore,
          };
          transaction.create(commandReference, {
            tenantId: command.tenantId,
            idempotencyKey: command.idempotencyKey,
            result: projectArchiveOutput,
            createdAt: timestamp,
          });
          return projectArchiveOutput;
        }

        if (command.type === "archiveContact") {
          // Editing and archiving a client is an owner/admin decision: a
          // coordinator works jobs, they do not curate the address book.
          if (!["studio_owner", "studio_admin"].includes(membershipData.role)) {
            throw new Error("FORBIDDEN");
          }
          const contactReference = db.doc(
            `contacts/${command.input.contactId}`,
          );
          const contact = await transaction.get(contactReference);
          if (
            !contact.exists ||
            contact.get("tenantId") !== command.tenantId
          ) {
            throw new Error("CONTACT_NOT_FOUND");
          }
          /**
           * Not while a job of theirs is live.
           *
           * Archiving the client of a wedding in flight would take them out of
           * the working list while the studio still has to reach them. The
           * projects they are attached to decide.
           */
          if (!command.input.restore) {
            const projectIds = Array.isArray(contact.get("projectIds"))
              ? (contact.get("projectIds") as string[])
              : [];
            const settled = ["CLOSED", "CANCELLED", "ARCHIVED"];
            for (const projectId of projectIds.slice(0, 30)) {
              const project = await transaction.get(
                db.doc(`projects/${projectId}`),
              );
              if (
                project.exists &&
                !settled.includes(String(project.get("state")))
              ) {
                throw new Error("CONTACT_HAS_LIVE_PROJECT");
              }
            }
          }
          transaction.update(contactReference, {
            archivedAt: command.input.restore ? null : timestamp,
            updatedAt: timestamp,
            updatedBy: identity.uid,
          });
          const archiveAuditId = randomUUID();
          transaction.create(db.doc(`auditEvents/${archiveAuditId}`), {
            id: archiveAuditId,
            tenantId: command.tenantId,
            projectId: null,
            actorId: identity.uid,
            actorType: "user",
            action: command.input.restore
              ? "contact.restored"
              : "contact.archived",
            entityType: "contact",
            entityId: command.input.contactId,
            timestamp,
            before: { archivedAt: contact.get("archivedAt") ?? null },
            after: { archivedAt: command.input.restore ? null : timestamp },
            ipAddress: null,
            userAgent: request.header("user-agent") ?? null,
            correlationId,
            automationRunId: null,
            providerEventId: null,
          });
          const output = {
            contactId: command.input.contactId,
            archived: !command.input.restore,
          };
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
      /**
       * A moved date is not just a changed field.
       *
       * `readinessOnProjectPlanning` only fires when a project's STATE changes
       * into PLANNING, so editing the date alone leaves readiness answering for
       * the old one. Re-derived here, after the write has committed, because
       * the reconcile reads the records this transaction just changed.
       *
       * Deliberately not fatal: the edit itself succeeded and the studio should
       * be told so. Readiness recomputes on its next trigger regardless, and a
       * failure here must not present as a failed edit.
       */
      /**
       * Keyed off the result rather than the command type, because only
       * `updateProject` returns `eventDateChanged` and because
       * `command.type === "…"` in this file is where the idempotency guard
       * looks for a receipt — a second one out here would read to it as a
       * branch that forgot to write one.
       */
      const dateMoved = result as {
        eventDateChanged?: boolean;
        projectId?: string;
      };
      if (dateMoved.eventDateChanged && dateMoved.projectId) {
        try {
          await reconcileProjectReadiness(
            db,
            command.tenantId,
            dateMoved.projectId,
          );
        } catch (caught: unknown) {
          console.warn(
            `[crm] readiness reconcile after date change failed: ${String(caught).slice(0, 160)}`,
          );
        }
      }
      response.status(200).json(result);
    } catch (error) {
      const code = error instanceof Error ? error.message : "COMMAND_FAILED";
      const status =
        code === "VERSION_CONFLICT"
          ? 409
          : code === "PROJECT_NOT_FOUND"
            ? 404
            : code === "FORBIDDEN" || code === "PROJECT_ACCESS_DENIED"
              ? 403
              : 422;
      response.status(status).json({ error: code });
    }
  },
);
