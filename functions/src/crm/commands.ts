import { randomUUID } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { requireAppCheck, requireIdentity } from "./security.js";
import { requireActiveSubscription } from "../saas/entitlement-guard.js";
import { studioHubCors } from "../security/cors.js";
import { reconcileProjectReadiness } from "../workflow/readiness-triggers.js";
import { teamRoleForEmail } from "./team-email.js";
import { afterConversion, convertInquiryToJob } from "../intake/convert.js";
import { forwarderKey } from "../intake/short-address.js";
import { senderProtection, senderProtectionReason } from "../intake/ignorable-sender.js";
import { studioMailboxes } from "../communications/inbound.js";
import { pricePackage, type PackageDiscount } from "../pricing/package-price.js";
import { selectionDiscount, snapshotDiscountRule } from "../pricing/discount-rule.js";
import { packageChangeNeedsApprover } from "../booking/proposal-domain.js";
import { isStandingInvoice } from "../booking/invoice-standing.js";
import { holdResumeStates } from "./hold-resume.js";
import { eventDateLock } from "./event-date-lock.js";
import {
  readStoppedBilling,
  writeStoppedBilling,
} from "../booking/stopped-billing.js";

/** An inquiry's states before booking — the ones it can be closed from. */
/** One structured deliverable on a package (H4); mirrors features/packages/schema.ts. */
const packageDeliverableSchema = z.object({
  kind: z.enum(["sneak_peek", "gallery", "highlight_film", "full_film", "teaser", "raw_files", "album", "other"]),
  label: z.string().trim().min(1).max(80),
  turnaroundDays: z.number().int().min(0).max(730),
  final: z.boolean(),
});

const PRE_BOOKING = ["LEAD", "CONSULTATION", "PROPOSAL", "CONTRACT_PENDING", "RETAINER_PENDING"];

/**
 * An inquiry by its job or its lead: the job (if it is one) and every lead
 * behind it — a couple who wrote twice has two.
 */
async function readInquiryInTransaction(
  transaction: FirebaseFirestore.Transaction,
  input: { tenantId: string; projectId: string | null; leadId: string | null },
): Promise<{
  project: FirebaseFirestore.DocumentSnapshot | null;
  leads: FirebaseFirestore.DocumentSnapshot[];
}> {
  const db = getFirestore();
  let projectId = input.projectId;
  if (!projectId && input.leadId) {
    const lead = await transaction.get(db.doc(`leads/${input.leadId}`));
    if (!lead.exists || lead.get("tenantId") !== input.tenantId) throw new Error("LEAD_NOT_FOUND");
    projectId = typeof lead.get("projectId") === "string" && lead.get("projectId") ? String(lead.get("projectId")) : null;
    if (!projectId) return { project: null, leads: [lead] };
  }
  if (!projectId) throw new Error("INQUIRY_NOT_FOUND");
  const project = await transaction.get(db.doc(`projects/${projectId}`));
  if (!project.exists || project.get("tenantId") !== input.tenantId) throw new Error("PROJECT_NOT_FOUND");
  const leads = await transaction.get(
    db.collection("leads").where("tenantId", "==", input.tenantId).where("projectId", "==", projectId),
  );
  return { project, leads: leads.docs };
}

const inquiryLifecycleCommands: ReadonlySet<string> = new Set([
  "closeInquiry",
  "reopenInquiry",
  "inquiryHeardElsewhere",
  "keepInquiryOpen",
]);
type InquiryLifecycleCommand = Extract<
  z.infer<typeof commandSchema>,
  { type: "closeInquiry" | "reopenInquiry" | "inquiryHeardElsewhere" | "keepInquiryOpen" }
>;

/** Commands after which an inquiry may have become ready to be a job. */
const commandsThatCanConvert: ReadonlySet<string> = new Set(["updateLead"]);
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
  "LOST",
] as const;

const transitions: Readonly<
  Record<(typeof projectStates)[number], readonly string[]>
> = {
  LEAD: ["CONSULTATION", "CANCELLED", "ARCHIVED", "LOST"],
  CONSULTATION: ["PROPOSAL", "CANCELLED", "POSTPONED", "LOST"],
  PROPOSAL: ["CONTRACT_PENDING", "CANCELLED", "POSTPONED", "LOST"],
  // Back to PROPOSAL when the couple changes what they're booking before the
  // agreement goes out: they accept a revised proposal (proposals.ts
  // "revise_packages").
  CONTRACT_PENDING: ["RETAINER_PENDING", "PROPOSAL", "CANCELLED", "POSTPONED", "LOST"],
  RETAINER_PENDING: ["BOOKED", "CANCELLED", "POSTPONED", "LOST"],
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
  // Back to where it was held from — see hold-resume.ts, which narrows this
  // to the one stage a given hold may return to.
  POSTPONED: ["CONSULTATION", "PROPOSAL", "CONTRACT_PENDING", "RETAINER_PENDING", "BOOKED", "PLANNING", "CANCELLED"],
  ARCHIVED: [],
  // Reopened to where it closed from, or put away.
  LOST: ["LEAD", "CONSULTATION", "PROPOSAL", "CONTRACT_PENDING", "RETAINER_PENDING", "ARCHIVED"],
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
     * Put the second person on the job.
     *
     * A wedding is two people and a project has always carried
     * `clientContactIds` as an array — but nothing could append to it after
     * creation, and every send path took the first and ignored the rest. The
     * partner heard nothing: not the proposal, not the questionnaire, not the
     * gallery. "A lot of the time they both want to be on emails. Believe it
     * or not this age group the men care about this shit!"
     *
     * Finds the contact by email before creating one, because a studio that
     * has already met the partner should not end up with them twice — the same
     * rule `findDuplicateProfile` applies to crew, for the same reason.
     */
    type: z.literal("addProjectClient"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      projectId: z.string().min(1),
      firstName: z.string().trim().min(1).max(80),
      lastName: z.string().trim().min(1).max(80),
      email: z.string().email(),
      phone: z.string().max(30).nullable().default(null),
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
     * Correct what inbox capture read from an inquiry.
     *
     * A contact-form notification is read by rules and a model; the studio is
     * the authority. Every field sent here is marked as the studio's in
     * `fieldProvenance`, so the review card stops flagging it as inferred.
     * `confirmInquiry` answers the "Maybe an inquiry" tray: yes, and remember
     * that sender.
     */
    type: z.literal("updateLead"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      leadId: z.string().min(1),
      firstName: z.string().trim().max(80).nullable().optional(),
      lastName: z.string().trim().max(80).nullable().optional(),
      partnerName: z.string().trim().max(120).nullable().optional(),
      email: z.string().trim().toLowerCase().email().max(160).nullable().optional(),
      phone: z.string().trim().max(40).nullable().optional(),
      eventDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable()
        .optional(),
      venue: z.string().trim().max(160).nullable().optional(),
      city: z.string().trim().max(120).nullable().optional(),
      ceremonyTime: z.string().trim().max(40).nullable().optional(),
      estimatedGuestCount: z.number().int().min(1).max(100000).nullable().optional(),
      budgetRange: z.string().trim().max(80).nullable().optional(),
      referralSource: z.string().trim().max(120).nullable().optional(),
      servicesRequested: z
        .array(z.enum(["photography", "videography"]))
        .min(1)
        .optional(),
      confirmInquiry: z.boolean().optional(),
    }),
  }),
  z.object({
    /**
     * "Not an inquiry": file the capture away, and — only when the studio
     * chose to, having been shown the address — stop capturing that sender.
     * The sender is the address the notification came from (a newsletter, a
     * vendor), never the person. It used to be learned on every tap, and a
     * studio's own website form or mailbox, learned once, silently dropped
     * every inquiry after it; those are now never learned
     * (intake/ignorable-sender.ts), and removeIgnoredSender undoes the rest.
     */
    type: z.literal("markLeadNotInquiry"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      leadId: z.string().min(1),
      ignoreSender: z.boolean().default(false),
    }),
  }),
  z.object({
    /** Start capturing a sender that "not an inquiry" taught capture to ignore. */
    type: z.literal("removeIgnoredSender"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({ sender: z.string().trim().toLowerCase().min(3).max(320) }),
  }),
  z.object({
    /**
     * End an inquiry that didn't book, and say why.
     *
     * The only way to take a real inquiry off the list used to be "Not an
     * inquiry", which also taught capture to ignore that couple's address. A
     * close records a reason and teaches nothing; the job goes to LOST and
     * reopens by itself if the couple writes again.
     */
    type: z.literal("closeInquiry"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      projectId: z.string().min(1).nullable().default(null),
      leadId: z.string().min(1).nullable().default(null),
      reason: z.enum(["went_quiet", "booked_elsewhere", "budget", "date_taken", "not_a_fit", "other"]),
    }),
  }),
  z.object({
    type: z.literal("reopenInquiry"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      projectId: z.string().min(1).nullable().default(null),
      leadId: z.string().min(1).nullable().default(null),
    }),
  }),
  z.object({
    /**
     * "They replied, just not here": the couple answered in the studio's own
     * inbox. Follow-ups restart their clock from now and any drafted nudge is
     * withdrawn, so nobody is chased who already answered.
     */
    type: z.literal("inquiryHeardElsewhere"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      projectId: z.string().min(1).nullable().default(null),
      leadId: z.string().min(1).nullable().default(null),
    }),
  }),
  z.object({
    /** Not ready to close a quiet inquiry: ask again in a week. */
    type: z.literal("keepInquiryOpen"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      projectId: z.string().min(1).nullable().default(null),
      leadId: z.string().min(1).nullable().default(null),
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
      /** The package's own terms line for proposals; empty clears it. */
      terms: z.string().trim().max(6000).optional(),
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
      deliverables: z.array(packageDeliverableSchema).max(8).optional(),
      /** The library add-ons this package suggests (H2). Replaces the list. */
      addOnIds: z.array(z.string().min(1)).max(20).optional(),
      active: z.boolean().optional(),
      publicVisible: z.boolean().optional(),
    }),
  }),
  /**
   * An add-on in the studio's library (H2, docs/proposal-agreement-and-addons-plan-2026-09-28.md):
   * "Second shooter hour", "Engagement session", "Travel beyond 50 miles".
   * Written once, suggested by any package, priced on any proposal. No
   * `addOnId` creates one; with one, it is updated. Archiving keeps it on
   * every proposal it is already part of.
   */
  z.object({
    type: z.literal("saveAddOn"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      addOnId: z.string().min(1).nullable().default(null),
      name: z.string().trim().min(2).max(120),
      description: z.string().trim().max(1000).default(""),
      unitPriceCents: z.number().int().nonnegative().safe(),
      taxable: z.boolean().default(true),
      allowQuantity: z.boolean().default(false),
      archived: z.boolean().default(false),
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
      deliverables: z.array(packageDeliverableSchema).max(8).optional(),
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
      /** Library add-ons to suggest; resolved on the server (H2). */
      addOnIds: z.array(z.string().min(1)).max(20).optional(),
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
      /**
       * Whether this package replaces the job's package or joins it.
       *
       * A studio selling photography and video on one wedding holds two
       * packages, and the client should get one proposal with one total. The
       * default stays "replace" so every existing caller and every existing
       * job is unchanged: `packageSnapshotId` remains the primary package that
       * the booking gate, readiness and the invoice scheduler already read.
       */
      mode: z.enum(["replace", "add"]).optional().default("replace"),
      /**
       * Replacing a package the job already has must be asked for by name.
       * Every older caller (Cue's package flow, the booking autopilot) sends
       * "replace" meaning "choose the first one", and relied on the server
       * refusing when a package was already there — so without this, relaxing
       * that refusal would have let them swap a couple's package silently.
       */
      confirmReplace: z.boolean().optional().default(false),
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
        // On a swap, the replaced package's discount carries over; otherwise
        // none. What the Packages panel, Cue and Today send, so a swap no
        // longer quietly drops a discount the couple was promised
        // (../pricing/discount-rule.ts).
        z.object({ type: z.literal("keep") }),
      ]),
    }),
  }),
  z.object({
    /**
     * The discount on one package on a job, changed after it was chosen: 10%
     * off, $250 off, or none. The snapshot is immutable, so the package is
     * priced again into a new one, as setJobAddOns does, and the proposal is
     * then revised from the job's packages.
     */
    type: z.literal("setPackageDiscount"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      projectId: z.string().min(1),
      packageSnapshotId: z.string().min(1),
      discount: z.discriminatedUnion("type", [
        z.object({ type: z.literal("none") }),
        z.object({ type: z.literal("fixed"), amountCents: z.number().int().positive().safe() }),
        z.object({ type: z.literal("percentage"), basisPoints: z.number().int().min(1).max(10000) }),
      ]),
    }),
  }),
  z.object({
    /**
     * Take a package off a job that has more than one: the couple dropped the
     * video, or the wrong package was added. The job always keeps at least
     * one — swapping the only package is `selectPackage` with "replace".
     */
    type: z.literal("removePackage"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      projectId: z.string().min(1),
      packageSnapshotId: z.string().min(1),
    }),
  }),
  z.object({
    /**
     * The extras on one package on a job (H2 slice 3): from the package's
     * suggestions, the studio's library, or written for this couple only
     * ("special family shots"). The snapshot is immutable, so the package is
     * priced again into a new one and the job points at it; the proposal is
     * then revised from the job's packages, as for any package change.
     */
    type: z.literal("setJobAddOns"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      projectId: z.string().min(1),
      packageSnapshotId: z.string().min(1),
      addOns: z
        .array(
          z.object({
            /** A library or package add-on; null for a one-off. */
            addOnId: z.string().min(1).nullable().default(null),
            name: z.string().trim().min(2).max(120).optional(),
            description: z.string().trim().max(1000).optional(),
            unitPriceCents: z.number().int().nonnegative().safe().optional(),
            taxable: z.boolean().optional(),
            quantity: z.number().int().positive().max(100).default(1),
            /** A one-off the studio will sell again goes into the library. */
            saveToLibrary: z.boolean().default(false),
          }),
        )
        .max(20),
    }),
  }),
  z.object({
    /**
     * The studio's answer to a couple asking, in their portal, to add a
     * package. Approving records the revised proposal it produced — the
     * package itself is added through selectPackage and the proposal revised
     * through revise_packages, the same two steps the Packages panel and Cue
     * take — so this only closes the request and says how.
     */
    type: z.literal("decidePackageRequest"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      requestId: z.string().min(1),
      decision: z.enum(["approved", "declined"]),
      resultProposalId: z.string().min(1).nullable().default(null),
    }),
  }),
]);

/**
 * Stages at which a job's packages can still change: anything before the
 * agreement is signed. A change after acceptance goes back to the couple as a
 * revised proposal (booking/proposals.ts "revise_packages").
 */
const PACKAGE_EDITABLE_STATES = ["LEAD", "CONSULTATION", "PROPOSAL", "CONTRACT_PENDING"];
/** An agreement in any of these has left the studio: its packages are what was sent. */
const AGREEMENT_OUT_STATUSES = ["queued", "sent", "delivered", "viewed", "partially_signed", "completed"];

/**
 * Whether a job's packages may change right now, read inside the caller's
 * transaction (before any write). Throws the reason when they may not.
 */
async function assertPackagesEditable(
  transaction: FirebaseFirestore.Transaction,
  input: { tenantId: string; projectId: string; state: string; role: string },
): Promise<void> {
  if (!PACKAGE_EDITABLE_STATES.includes(input.state)) {
    throw new Error("PACKAGES_LOCKED_AFTER_SIGNING");
  }
  // The proposal has to be re-priced after this change, and only an owner or
  // admin may do that; a coordinator's change would strand it.
  const proposals = await transaction.get(
    getFirestore()
      .collection("proposals")
      .where("tenantId", "==", input.tenantId)
      .where("projectId", "==", input.projectId),
  );
  if (
    packageChangeNeedsApprover(
      input.role,
      proposals.docs.map((proposal) => String(proposal.get("status") ?? "")),
    )
  ) {
    throw new Error("PACKAGE_CHANGE_NEEDS_APPROVER");
  }
  const contracts = await transaction.get(
    getFirestore()
      .collection("contracts")
      .where("tenantId", "==", input.tenantId)
      .where("projectId", "==", input.projectId),
  );
  const out = contracts.docs.filter((contract) => AGREEMENT_OUT_STATUSES.includes(String(contract.get("status"))));
  if (out.length) {
    // The remedy depends on which: a signed agreement can't be withdrawn, and
    // one out through a signing app is withdrawn there, not on the Booking tab.
    // The copy used to say "void it on the Booking tab" to all three.
    const signed = out.some((contract) => contract.get("status") === "completed");
    const provider = out.some((contract) => contract.get("provider") && contract.get("provider") !== "studiocue");
    if (signed) throw new Error("AGREEMENT_ALREADY_SENT:signed");
    if (provider) throw new Error("AGREEMENT_ALREADY_SENT:provider");
    throw new Error("AGREEMENT_ALREADY_SENT");
  }
  // A bill raised against the old total would contradict the new one.
  const invoices = await transaction.get(
    getFirestore()
      .collection("invoiceReferences")
      .where("tenantId", "==", input.tenantId)
      .where("projectId", "==", input.projectId),
  );
  // Only a bill that still stands. A provider-refused (`failed`) or replaced
  // (`superseded`) attempt was never the couple's to pay, and counting one
  // blocked every package change with "void it first" on a bill nobody holds.
  if (
    invoices.docs.some((invoice) => {
      const status = String(invoice.get("status"));
      return isStandingInvoice(status) && !["void", "cancelled"].includes(status);
    })
  ) {
    throw new Error("INVOICE_ALREADY_RAISED");
  }
}

/**
 * A package on a job, priced again from what the couple was already quoted:
 * the snapshot's own base price, with these extras and this discount. A
 * percentage retainer follows the new total; a fixed or per-crew one stays the
 * amount it was — an existing retainer is never re-derived from today's
 * package. Shared by setJobAddOns and setPackageDiscount.
 */
function repriceSnapshot(
  previous: FirebaseFirestore.DocumentSnapshot,
  packageDocument: FirebaseFirestore.DocumentSnapshot,
  addOns: ReadonlyArray<{ unitPriceCents: number; quantity: number; taxable: boolean }>,
  discount: PackageDiscount,
) {
  const rule = packageDocument.get("retainerRule") as { type?: string; basisPoints?: number } | undefined;
  return pricePackage({
    basePriceCents: Number(previous.get("basePriceCents") ?? 0),
    addOns,
    discount,
    // Untaxed as quoted stays untaxed — unless it was untaxed only because a
    // full discount left nothing to tax, which says nothing about the rate.
    taxRateBasisPoints:
      Number(previous.get("taxCents") ?? 0) === 0 && Number(previous.get("subtotalCents") ?? 0) > 0
        ? 0
        : Number(packageDocument.get("taxRateBasisPoints") ?? 0),
    retainerRule:
      rule?.type === "percentage"
        ? { type: "percentage", basisPoints: Number(rule.basisPoints ?? 0) }
        : { type: "fixed", amountCents: Number(previous.get("retainerCents") ?? 0) },
    billedCrew: 1,
  });
}

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
/**
 * The package's copy of its suggested add-ons, from the library.
 *
 * A package keeps the definitions themselves, not just the ids: selection,
 * the couple's portal and every existing snapshot already read
 * `package.addOns`, and a price the couple saw must not move because the
 * library entry was edited later. An archived or foreign add-on is refused.
 */
async function libraryAddOns(
  transaction: FirebaseFirestore.Transaction,
  db: FirebaseFirestore.Firestore,
  tenantId: string,
  addOnIds: readonly string[],
): Promise<Array<Record<string, unknown>>> {
  const unique = [...new Set(addOnIds)];
  const documents = await Promise.all(
    unique.map((id) => transaction.get(db.doc(`addOns/${id}`))),
  );
  return documents.map((document) => {
    if (!document.exists || document.get("tenantId") !== tenantId || document.get("archivedAt")) {
      throw new Error("ADD_ON_NOT_FOUND");
    }
    return {
      id: document.id,
      name: String(document.get("name")),
      description: String(document.get("description") ?? ""),
      unitPriceCents: Number(document.get("unitPriceCents") ?? 0),
      taxable: document.get("taxable") !== false,
      allowQuantity: document.get("allowQuantity") === true,
      active: true,
    };
  });
}

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
          const output = {
            projectId,
            state: "LEAD",
            convertedLeadId: leadReference ? command.input.leadId : null,
          };
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
                postponedFromState?: unknown;
                bookingCompletedAt?: unknown;
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
          // A hold returns a job to where it was, never past the booking gate
          // (hold-resume.ts).
          if (
            project.state === "POSTPONED" &&
            !holdResumeStates(project).includes(command.input.targetState)
          ) {
            throw new Error("HOLD_RESUME_NOT_ALLOWED");
          }
          if (
            ["POSTPONED", "CANCELLED"].includes(command.input.targetState) &&
            (command.input.reason?.trim().length ?? 0) < 10
          ) {
            throw new Error("INTERRUPTION_REASON_REQUIRED");
          }
          // Calling a job off closes its billing in the same transaction —
          // stopped-billing.ts. Reads first, as a transaction requires.
          const billingStop =
            command.input.targetState === "CANCELLED"
              ? ("cancelled" as const)
              : command.input.targetState === "LOST"
                ? ("lost" as const)
                : null;
          const billingReads = billingStop
            ? await readStoppedBilling(
                db,
                transaction,
                command.tenantId,
                command.input.projectId,
              )
            : null;
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
            // Where it comes back to. Without it a hold was a way round the
            // booking gate: PROPOSAL → POSTPONED → PLANNING.
            ...(command.input.targetState === "POSTPONED"
              ? { postponedFromState: project.state }
              : {}),
            updatedAt: timestamp,
            updatedBy: identity.uid,
          });
          const billingClosed =
            billingStop && billingReads
              ? writeStoppedBilling(db, transaction, {
                  tenantId: command.tenantId,
                  projectId: command.input.projectId,
                  stop: billingStop,
                  reads: billingReads,
                  now: timestamp,
                  actor: identity.uid,
                })
              : null;
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
              ...(billingClosed ? { billingClosed } : {}),
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
            ...(billingClosed ? { billingClosed } : {}),
          };
          transaction.create(commandReference, {
            tenantId: command.tenantId,
            idempotencyKey: command.idempotencyKey,
            result: output,
            createdAt: timestamp,
          });
          return output;
        }

        if (command.type === "saveAddOn") {
          const addOnId = command.input.addOnId ?? randomUUID();
          const reference = db.doc(`addOns/${addOnId}`);
          const existing = await transaction.get(reference);
          if (command.input.addOnId && (!existing.exists || existing.get("tenantId") !== command.tenantId)) {
            throw new Error("ADD_ON_NOT_FOUND");
          }
          const fields = {
            name: command.input.name,
            description: command.input.description,
            unitPriceCents: command.input.unitPriceCents,
            taxable: command.input.taxable,
            allowQuantity: command.input.allowQuantity,
            archivedAt: command.input.archived ? (existing.get("archivedAt") ?? timestamp) : null,
          };
          transaction.set(
            reference,
            existing.exists
              ? { ...fields, updatedAt: timestamp, updatedBy: identity.uid }
              : {
                  id: addOnId,
                  tenantId: command.tenantId,
                  ...fields,
                  createdAt: timestamp,
                  createdBy: identity.uid,
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
            action: existing.exists ? "add_on.updated" : "add_on.created",
            entityType: "addOn",
            entityId: addOnId,
            timestamp,
            before: existing.exists
              ? Object.fromEntries(Object.keys(fields).map((key) => [key, existing.get(key) ?? null]))
              : null,
            after: fields,
            providerEventId: null,
          });
          const output = { addOnId };
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
          const { packageId, addOnIds, ...changes } = command.input;
          // Only what was actually sent; an omitted field is untouched.
          const patch: Record<string, unknown> = Object.fromEntries(
            Object.entries(changes).filter(([, value]) => value !== undefined),
          );
          if (addOnIds !== undefined) {
            patch.addOns = await libraryAddOns(transaction, db, command.tenantId, addOnIds);
          }
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
          const { addOnIds: suggestedAddOnIds, ...packageInput } = command.input;
          const suggestedAddOns = suggestedAddOnIds?.length
            ? await libraryAddOns(transaction, db, command.tenantId, suggestedAddOnIds)
            : null;
          transaction.create(db.doc(`packages/${packageId}`), {
            id: packageId,
            tenantId: command.tenantId,
            ...packageInput,
            ...(suggestedAddOns ? { addOns: suggestedAddOns } : {}),
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

        if (command.type === "decidePackageRequest") {
          const requestReference = db.doc(`packageRequests/${command.input.requestId}`);
          const packageRequest = await transaction.get(requestReference);
          if (!packageRequest.exists || packageRequest.get("tenantId") !== command.tenantId) {
            throw new Error("PACKAGE_REQUEST_NOT_FOUND");
          }
          if (!hasProjectAccess(membershipData, String(packageRequest.get("projectId")))) {
            throw new Error("PROJECT_NOT_PERMITTED");
          }
          const previous = String(packageRequest.get("status"));
          if (previous !== "pending") {
            const settled = { requestId: packageRequest.id, status: previous, alreadyDecided: true };
            transaction.create(commandReference, {
              tenantId: command.tenantId,
              idempotencyKey: command.idempotencyKey,
              result: settled,
              createdAt: timestamp,
            });
            return settled;
          }
          transaction.update(requestReference, {
            status: command.input.decision,
            decidedAt: timestamp,
            decidedBy: identity.uid,
            resultProposalId: command.input.resultProposalId,
            updatedAt: timestamp,
          });
          const requestAuditId = randomUUID();
          transaction.create(db.doc(`auditEvents/${requestAuditId}`), {
            id: requestAuditId,
            tenantId: command.tenantId,
            projectId: packageRequest.get("projectId"),
            actorId: identity.uid,
            actorType: "user",
            action: `package_request.${command.input.decision}`,
            entityType: "packageRequest",
            entityId: packageRequest.id,
            timestamp,
            before: { status: previous },
            after: { status: command.input.decision, resultProposalId: command.input.resultProposalId },
            ipAddress: null,
            userAgent: request.header("user-agent") ?? null,
            correlationId,
            automationRunId: null,
            providerEventId: null,
          });
          const decided = { requestId: packageRequest.id, status: command.input.decision };
          transaction.create(commandReference, {
            tenantId: command.tenantId,
            idempotencyKey: command.idempotencyKey,
            result: decided,
            createdAt: timestamp,
          });
          return decided;
        }

        if (command.type === "setJobAddOns") {
          const projectReference = db.doc(`projects/${command.input.projectId}`);
          const projectDocument = await transaction.get(projectReference);
          if (!projectDocument.exists || projectDocument.get("tenantId") !== command.tenantId) {
            throw new Error("PROJECT_NOT_FOUND");
          }
          if (!hasProjectAccess(membershipData, command.input.projectId)) {
            throw new Error("PROJECT_NOT_PERMITTED");
          }
          await assertPackagesEditable(transaction, {
            tenantId: command.tenantId,
            projectId: command.input.projectId,
            state: String(projectDocument.get("state")),
            role: String(membershipData.role),
          });
          const primary = String(projectDocument.get("packageSnapshotId") ?? "");
          const additional = Array.isArray(projectDocument.get("additionalPackageSnapshotIds"))
            ? (projectDocument.get("additionalPackageSnapshotIds") as unknown[]).map(String)
            : [];
          const target = command.input.packageSnapshotId;
          if (target !== primary && !additional.includes(target)) throw new Error("PACKAGE_NOT_ON_JOB");
          const previous = await transaction.get(db.doc(`packageSnapshots/${target}`));
          if (!previous.exists || previous.get("tenantId") !== command.tenantId) {
            throw new Error("PACKAGE_SNAPSHOT_INVALID");
          }
          const packageDocument = await transaction.get(db.doc(`packages/${String(previous.get("packageId"))}`));
          const suggested = (
            packageDocument.exists && Array.isArray(packageDocument.get("addOns"))
              ? (packageDocument.get("addOns") as Array<Record<string, unknown>>)
              : []
          ).filter((item) => item.active !== false);
          const fromLibrary = new Map<string, Record<string, unknown>>();
          const libraryIds = command.input.addOns
            .map((item) => item.addOnId)
            .filter((id): id is string => Boolean(id) && !suggested.some((item) => item.id === id));
          for (const document of await Promise.all(
            [...new Set(libraryIds)].map((id) => transaction.get(db.doc(`addOns/${id}`))),
          )) {
            if (!document.exists || document.get("tenantId") !== command.tenantId || document.get("archivedAt")) {
              throw new Error("ADD_ON_NOT_FOUND");
            }
            fromLibrary.set(document.id, document.data() ?? {});
          }
          const newLibraryEntries: Array<{ id: string; fields: Record<string, unknown> }> = [];
          const lines = command.input.addOns.map((item) => {
            if (item.addOnId) {
              const definition =
                suggested.find((candidate) => candidate.id === item.addOnId) ?? fromLibrary.get(item.addOnId)!;
              return {
                addOnId: item.addOnId,
                name: String(definition.name),
                quantity: item.quantity,
                unitPriceCents: Number(definition.unitPriceCents ?? 0),
                lineTotalCents: Number(definition.unitPriceCents ?? 0) * item.quantity,
                taxable: definition.taxable !== false,
              };
            }
            if (!item.name || item.unitPriceCents === undefined) throw new Error("CUSTOM_ADD_ON_INCOMPLETE");
            const id = item.saveToLibrary ? randomUUID() : `custom_${randomUUID()}`;
            if (item.saveToLibrary) {
              newLibraryEntries.push({
                id,
                fields: {
                  name: item.name,
                  description: item.description ?? "",
                  unitPriceCents: item.unitPriceCents,
                  taxable: item.taxable ?? true,
                  allowQuantity: item.quantity > 1,
                },
              });
            }
            return {
              addOnId: id,
              name: item.name,
              quantity: item.quantity,
              unitPriceCents: item.unitPriceCents,
              lineTotalCents: item.unitPriceCents * item.quantity,
              taxable: item.taxable ?? true,
            };
          });
          // The discount as its rule: a percentage stays a percentage of the
          // new total. This used to freeze it into its old amount.
          const discountRule = snapshotDiscountRule(previous.data());
          const priced = repriceSnapshot(previous, packageDocument, lines, discountRule);
          const snapshotId = randomUUID();
          transaction.create(db.doc(`packageSnapshots/${snapshotId}`), {
            ...previous.data(),
            id: snapshotId,
            addOns: lines,
            discountRule,
            discountCents: priced.discountCents,
            subtotalCents: priced.subtotalCents,
            taxCents: priced.taxCents,
            retainerCents: priced.retainerCents,
            totalCents: priced.totalCents,
            supersedesSnapshotId: target,
            selectionDate: timestamp,
            selectedBy: identity.uid,
            createdAt: timestamp,
            createdBy: identity.uid,
          });
          for (const entry of newLibraryEntries) {
            transaction.create(db.doc(`addOns/${entry.id}`), {
              id: entry.id,
              tenantId: command.tenantId,
              ...entry.fields,
              archivedAt: null,
              createdAt: timestamp,
              createdBy: identity.uid,
              updatedAt: timestamp,
              updatedBy: identity.uid,
            });
          }
          const next =
            target === primary
              ? { packageSnapshotId: snapshotId }
              : { additionalPackageSnapshotIds: additional.map((id) => (id === target ? snapshotId : id)) };
          transaction.update(projectReference, { ...next, updatedAt: timestamp, updatedBy: identity.uid });
          const addOnsAuditId = randomUUID();
          transaction.create(db.doc(`auditEvents/${addOnsAuditId}`), {
            id: addOnsAuditId,
            tenantId: command.tenantId,
            projectId: command.input.projectId,
            actorId: identity.uid,
            actorType: "user",
            action: "package.add_ons_set",
            entityType: "packageSnapshot",
            entityId: snapshotId,
            timestamp,
            before: { packageSnapshotId: target, addOns: previous.get("addOns") ?? [], totalCents: previous.get("totalCents") ?? null },
            after: { packageSnapshotId: snapshotId, addOns: lines, totalCents: priced.totalCents },
            ipAddress: null,
            userAgent: request.header("user-agent") ?? null,
            correlationId,
            automationRunId: null,
            providerEventId: null,
          });
          const output = { packageSnapshotId: snapshotId, replaced: target, totalCents: priced.totalCents };
          transaction.create(commandReference, {
            tenantId: command.tenantId,
            idempotencyKey: command.idempotencyKey,
            result: output,
            createdAt: timestamp,
          });
          return output;
        }

        if (command.type === "setPackageDiscount") {
          const projectReference = db.doc(`projects/${command.input.projectId}`);
          const projectDocument = await transaction.get(projectReference);
          if (!projectDocument.exists || projectDocument.get("tenantId") !== command.tenantId) {
            throw new Error("PROJECT_NOT_FOUND");
          }
          if (!hasProjectAccess(membershipData, command.input.projectId)) {
            throw new Error("PROJECT_NOT_PERMITTED");
          }
          await assertPackagesEditable(transaction, {
            tenantId: command.tenantId,
            projectId: command.input.projectId,
            state: String(projectDocument.get("state")),
            role: String(membershipData.role),
          });
          const primary = String(projectDocument.get("packageSnapshotId") ?? "");
          const additional = Array.isArray(projectDocument.get("additionalPackageSnapshotIds"))
            ? (projectDocument.get("additionalPackageSnapshotIds") as unknown[]).map(String)
            : [];
          const target = command.input.packageSnapshotId;
          if (target !== primary && !additional.includes(target)) throw new Error("PACKAGE_NOT_ON_JOB");
          const previous = await transaction.get(db.doc(`packageSnapshots/${target}`));
          if (!previous.exists || previous.get("tenantId") !== command.tenantId) {
            throw new Error("PACKAGE_SNAPSHOT_INVALID");
          }
          const packageDocument = await transaction.get(db.doc(`packages/${String(previous.get("packageId"))}`));
          const lines = (Array.isArray(previous.get("addOns")) ? (previous.get("addOns") as Array<Record<string, unknown>>) : []).map(
            (line) => ({
              unitPriceCents: Number(line.unitPriceCents ?? 0),
              quantity: Number(line.quantity ?? 1),
              taxable: line.taxable !== false,
            }),
          );
          const discountRule: PackageDiscount = command.input.discount;
          const priced = repriceSnapshot(previous, packageDocument, lines, discountRule);
          const snapshotId = randomUUID();
          transaction.create(db.doc(`packageSnapshots/${snapshotId}`), {
            ...previous.data(),
            id: snapshotId,
            discountRule,
            discountCents: priced.discountCents,
            subtotalCents: priced.subtotalCents,
            taxCents: priced.taxCents,
            retainerCents: priced.retainerCents,
            totalCents: priced.totalCents,
            supersedesSnapshotId: target,
            selectionDate: timestamp,
            selectedBy: identity.uid,
            createdAt: timestamp,
            createdBy: identity.uid,
          });
          const next =
            target === primary
              ? { packageSnapshotId: snapshotId }
              : { additionalPackageSnapshotIds: additional.map((id) => (id === target ? snapshotId : id)) };
          transaction.update(projectReference, { ...next, updatedAt: timestamp, updatedBy: identity.uid });
          const discountAuditId = randomUUID();
          transaction.create(db.doc(`auditEvents/${discountAuditId}`), {
            id: discountAuditId,
            tenantId: command.tenantId,
            projectId: command.input.projectId,
            actorId: identity.uid,
            actorType: "user",
            action: "package.discount_set",
            entityType: "packageSnapshot",
            entityId: snapshotId,
            timestamp,
            before: { packageSnapshotId: target, discount: snapshotDiscountRule(previous.data()), totalCents: previous.get("totalCents") ?? null },
            after: { packageSnapshotId: snapshotId, discount: discountRule, totalCents: priced.totalCents },
            ipAddress: null,
            userAgent: request.header("user-agent") ?? null,
            correlationId,
            automationRunId: null,
            providerEventId: null,
          });
          const output = { packageSnapshotId: snapshotId, replaced: target, totalCents: priced.totalCents, discountCents: priced.discountCents };
          transaction.create(commandReference, {
            tenantId: command.tenantId,
            idempotencyKey: command.idempotencyKey,
            result: output,
            createdAt: timestamp,
          });
          return output;
        }

        if (command.type === "removePackage") {
          const projectReference = db.doc(`projects/${command.input.projectId}`);
          const projectDocument = await transaction.get(projectReference);
          if (!projectDocument.exists || projectDocument.get("tenantId") !== command.tenantId) {
            throw new Error("PROJECT_NOT_FOUND");
          }
          if (!hasProjectAccess(membershipData, command.input.projectId)) {
            throw new Error("PROJECT_NOT_PERMITTED");
          }
          await assertPackagesEditable(transaction, {
            tenantId: command.tenantId,
            projectId: command.input.projectId,
            state: String(projectDocument.get("state")),
            role: String(membershipData.role),
          });
          const primary = String(projectDocument.get("packageSnapshotId") ?? "");
          const additional = Array.isArray(projectDocument.get("additionalPackageSnapshotIds"))
            ? (projectDocument.get("additionalPackageSnapshotIds") as unknown[]).map(String)
            : [];
          const target = command.input.packageSnapshotId;
          if (target !== primary && !additional.includes(target)) throw new Error("PACKAGE_NOT_ON_JOB");
          if (target === primary && additional.length === 0) throw new Error("LAST_PACKAGE_ON_JOB");
          // Removing the main package promotes the next one: `packageSnapshotId`
          // is what readiness, crew staffing and the booking gate read.
          const next =
            target === primary
              ? { packageSnapshotId: additional[0]!, additionalPackageSnapshotIds: additional.slice(1) }
              : { packageSnapshotId: primary, additionalPackageSnapshotIds: additional.filter((id) => id !== target) };
          transaction.update(projectReference, { ...next, updatedAt: timestamp, updatedBy: identity.uid });
          const removeAuditId = randomUUID();
          transaction.create(db.doc(`auditEvents/${removeAuditId}`), {
            id: removeAuditId,
            tenantId: command.tenantId,
            projectId: command.input.projectId,
            actorId: identity.uid,
            actorType: "user",
            action: "package.removed",
            entityType: "packageSnapshot",
            entityId: target,
            timestamp,
            before: { packageSnapshotId: primary, additionalPackageSnapshotIds: additional },
            after: next,
            ipAddress: null,
            userAgent: request.header("user-agent") ?? null,
            correlationId,
            automationRunId: null,
            providerEventId: null,
          });
          const output = { ...next, removed: target };
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
                deliverables?: unknown[];
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
          /**
           * A job that already has a package can still take another, or swap
           * it, until the agreement goes out. This used to refuse outright
           * ("PACKAGE_ALREADY_SELECTED"), so the "add alongside" path below
           * could never run and a couple who asked for video on top of their
           * photography had no way to get it onto the job.
           */
          if (project.packageSnapshotId) {
            if (command.input.mode === "replace" && !command.input.confirmReplace) {
              throw new Error("PACKAGE_ALREADY_SELECTED");
            }
            await assertPackagesEditable(transaction, {
              tenantId: command.tenantId,
              projectId: command.input.projectId,
              state: String(projectDocument.get("state")),
              role: String(membershipData.role),
            });
            const alreadyAdditional = Array.isArray(projectDocument.get("additionalPackageSnapshotIds"))
              ? (projectDocument.get("additionalPackageSnapshotIds") as unknown[]).length
              : 0;
            if (command.input.mode === "add" && alreadyAdditional >= 3) {
              throw new Error("PACKAGE_LIMIT_REACHED");
            }
            // The same package twice is a double tap or a request already met
            // (a couple asked, and the studio added it from the proposal).
            if (command.input.mode === "add") {
              const onJob = await Promise.all(
                [
                  String(projectDocument.get("packageSnapshotId")),
                  ...(Array.isArray(projectDocument.get("additionalPackageSnapshotIds"))
                    ? (projectDocument.get("additionalPackageSnapshotIds") as unknown[]).map(String)
                    : []),
                ].map((id) => transaction.get(db.doc(`packageSnapshots/${id}`))),
              );
              if (onJob.some((snapshot) => snapshot.get("packageId") === command.input.packageId)) {
                throw new Error("PACKAGE_ALREADY_ON_JOB");
              }
            }
          }
          // A swap carries the replaced package's discount when asked to
          // ("keep"); read here, before any write in this transaction.
          const replacing = command.input.mode !== "add" && Boolean(project.packageSnapshotId);
          const replacedSnapshot =
            replacing && command.input.discount.type === "keep"
              ? await transaction.get(db.doc(`packageSnapshots/${String(project.packageSnapshotId)}`))
              : null;
          const discount = selectionDiscount(command.input.discount, {
            replacing,
            replacedSnapshot:
              replacedSnapshot?.exists && replacedSnapshot.get("tenantId") === command.tenantId
                ? (replacedSnapshot.data() ?? null)
                : null,
          });
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
          const coverage = resolveCoverage(studioPackage);
          // One price, the same as the portal and the snapshot factory (H2).
          const { discountCents, subtotalCents, taxCents, totalCents, retainerCents } = pricePackage({
            basePriceCents: studioPackage.basePriceCents,
            addOns: selectedLines,
            discount,
            taxRateBasisPoints: studioPackage.taxRateBasisPoints,
            retainerRule: studioPackage.retainerRule,
            billedCrew:
              studioPackage.retainerRule.type === "per_crew_member"
                ? billedCrewCount(coverage, studioPackage.retainerRule.billedRoles)
                : 1,
          });
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
            // The rule, not only its amount, so a later re-price keeps it.
            discountRule: discount,
            discountCents,
            subtotalCents,
            taxCents,
            retainerCents,
            totalCents,
            includedCoverageMinutes: studioPackage.includedCoverageMinutes,
            ...coverageFields(coverage),
            includedDeliverables: studioPackage.includedDeliverables,
            // What the job will deliver and by when (H4); absent on packages
            // saved before it existed.
            ...(Array.isArray(studioPackage.deliverables) && studioPackage.deliverables.length
              ? { deliverables: studioPackage.deliverables }
              : {}),
            includedTravelArea: studioPackage.includedTravelArea,
            terms: studioPackage.terms,
            selectionDate: timestamp,
            selectedBy: identity.uid,
            immutable: true,
            createdAt: timestamp,
            createdBy: identity.uid,
          });
          /**
           * "replace" overwrites the primary; "add" joins it.
           *
           * The primary is deliberately never moved by an add, because
           * `packageSnapshotId` is what the booking gate, readiness, the
           * invoice scheduler and a hundred other readers already resolve. A
           * second package is additive information, and everything that only
           * knows about one keeps working exactly as it did.
           */
          const existingAdditional = Array.isArray(
            projectDocument.get("additionalPackageSnapshotIds"),
          )
            ? (
                projectDocument.get("additionalPackageSnapshotIds") as unknown[]
              ).map((value) => String(value))
            : [];
          const hasPrimary = Boolean(project?.packageSnapshotId);
          transaction.update(
            projectReference,
            command.input.mode === "add" && hasPrimary
              ? {
                  additionalPackageSnapshotIds: [
                    ...existingAdditional,
                    packageSnapshotId,
                  ],
                  updatedAt: timestamp,
                  updatedBy: identity.uid,
                }
              : {
                  packageSnapshotId,
                  // Replacing the primary drops any second package with it: it
                  // was priced against the package being replaced, and leaving
                  // it would put a stale line on the next proposal.
                  additionalPackageSnapshotIds: [],
                  updatedAt: timestamp,
                  updatedBy: identity.uid,
                },
          );
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

        if (command.type === "addProjectClient") {
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
          if (project.get("archivedAt")) throw new Error("PROJECT_ARCHIVED");
          const existingIds = Array.isArray(project.get("clientContactIds"))
            ? (project.get("clientContactIds") as unknown[]).map((value) =>
                String(value),
              )
            : [];
          const normalizedEmail = command.input.email.trim().toLowerCase();
          // Reuse the person the studio already has, rather than making a
          // second record of them under the same address.
          const matches = await transaction.get(
            db
              .collection("contacts")
              .where("tenantId", "==", command.tenantId)
              .where("normalizedEmail", "==", normalizedEmail)
              .limit(1),
          );
          const existingContact = matches.docs[0] ?? null;
          const contactId = existingContact?.id ?? randomUUID();
          if (existingIds.includes(contactId)) {
            throw new Error("CLIENT_ALREADY_ON_PROJECT");
          }
          if (!existingContact) {
            transaction.create(db.doc(`contacts/${contactId}`), {
              id: contactId,
              tenantId: command.tenantId,
              firstName: command.input.firstName,
              lastName: command.input.lastName,
              displayName: `${command.input.firstName} ${command.input.lastName}`,
              email: command.input.email.trim(),
              normalizedEmail,
              phone: command.input.phone,
              normalizedPhone: command.input.phone?.replace(/\D/g, "") ?? null,
              company: null,
              contactTypes: ["client"],
              projectIds: [command.input.projectId],
              portalUserId: null,
              marketingConsent: false,
              notes: null,
              archivedAt: null,
              createdAt: timestamp,
              updatedAt: timestamp,
              createdBy: identity.uid,
              updatedBy: identity.uid,
            });
          }
          transaction.update(projectReference, {
            clientContactIds: [...existingIds, contactId],
            updatedAt: timestamp,
            updatedBy: identity.uid,
          });
          const addAuditId = randomUUID();
          transaction.create(db.doc(`auditEvents/${addAuditId}`), {
            id: addAuditId,
            tenantId: command.tenantId,
            projectId: command.input.projectId,
            actorUserId: identity.uid,
            action: "project.client_added",
            occurredAt: timestamp,
            payload: {
              contactId,
              email: normalizedEmail,
              reusedExistingContact: Boolean(existingContact),
            },
            ipAddress: null,
            userAgent: request.header("user-agent") ?? null,
            correlationId,
            automationRunId: null,
            providerEventId: null,
          });
          const output = {
            projectId: command.input.projectId,
            contactId,
            created: !existingContact,
          };
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
          /**
           * A signed booking's date moves by a booking change, not here.
           *
           * This moved the date and nothing else: the signed contract, the
           * crew's calendar invites, the questionnaire's due date and the day
           * the final bill is raised all kept the old one. The amendment path
           * moves every one of them, with the couple's signature. Every other
           * field stays editable, and so does the date before signing.
           */
          if (project.get("eventDate") !== command.input.eventDate) {
            const contracts = await transaction.get(
              db
                .collection("contracts")
                .where("tenantId", "==", command.tenantId)
                .where("projectId", "==", command.input.projectId),
            );
            const lock = eventDateLock({
              state: project.get("state"),
              postponedFromState: project.get("postponedFromState"),
              bookingCompletedAt: project.get("bookingCompletedAt"),
              contractStatuses: contracts.docs.map((contract) => contract.get("status")),
            });
            if (lock === "signed") throw new Error("EVENT_DATE_LOCKED_AFTER_SIGNING");
            if (lock === "agreement_out") throw new Error("EVENT_DATE_LOCKED_AGREEMENT_OUT");
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

        if (command.type === "updateLead") {
          const leadReference = db.doc(`leads/${command.input.leadId}`);
          const lead = await transaction.get(leadReference);
          if (!lead.exists || lead.get("tenantId") !== command.tenantId) {
            throw new Error("LEAD_NOT_FOUND");
          }
          const { leadId, confirmInquiry, ...edits } = command.input;
          const changes: Record<string, unknown> = {};
          const provenance: Record<string, { source: "studio"; label: null }> = {};
          const provenanceKey: Record<string, string> = {
            estimatedGuestCount: "guestCount",
            budgetRange: "budget",
            servicesRequested: "services",
          };
          for (const [key, value] of Object.entries(edits)) {
            if (value === undefined) continue;
            changes[key] = value === "" ? null : value;
            provenance[provenanceKey[key] ?? key] = { source: "studio", label: null };
          }
          const next = { ...lead.data(), ...changes } as Record<string, unknown>;
          if ("eventDate" in changes) {
            const date = changes.eventDate as string | null;
            if (date) {
              const clash = await transaction.get(
                db
                  .collection("projects")
                  .where("tenantId", "==", command.tenantId)
                  .where("eventDate", "==", date)
                  .where("state", "in", [
                    "CONSULTATION",
                    "PROPOSAL",
                    "CONTRACT_PENDING",
                    "RETAINER_PENDING",
                    "BOOKED",
                    "PLANNING",
                    "READY",
                  ])
                  .limit(20),
              );
              // An archived job holds no date.
              changes.availabilityStatus = clash.docs.some((project) => !project.get("archivedAt"))
                ? "conflict"
                : "available";
            } else {
              changes.availabilityStatus = "unknown";
            }
          }
          if ("firstName" in changes || "lastName" in changes || "partnerName" in changes) {
            const name = [next.firstName, next.lastName]
              .filter((part) => typeof part === "string" && part)
              .join(" ");
            if (name) {
              changes.displayName =
                typeof next.partnerName === "string" && next.partnerName
                  ? `${name} & ${next.partnerName}`
                  : name;
            }
          }
          if (Object.keys(provenance).length) {
            changes.fieldProvenance = {
              ...((lead.get("fieldProvenance") as Record<string, unknown>) ?? {}),
              ...provenance,
            };
          }
          changes.missingInformation = [
            ...(next.email || next.phone ? [] : ["how to reach them"]),
            ...(next.eventDate ? [] : ["event date"]),
            ...(next.venue ? [] : ["venue"]),
            ...(next.estimatedGuestCount ? [] : ["guest count"]),
          ];
          let learnedSender: string | null = null;
          let learnedForwarders: string[] = [];
          if (confirmInquiry && lead.get("needsConfirmation") === true) {
            changes.needsConfirmation = false;
            const captureId = lead.get("captureId");
            if (typeof captureId === "string" && captureId) {
              const capture = await transaction.get(db.doc(`inboundCaptures/${captureId}`));
              const sender = capture.get("notificationSender");
              // A form's notification address is learned; a person's own
              // address (a manual forward) is not a form and is not.
              const personal = String(next.email ?? "").toLowerCase();
              if (typeof sender === "string" && sender && sender !== personal) learnedSender = sender;
              // The studio's own mailbox that forwarded it, with the service
              // that signed it, is learned too: from now on its forwards are
              // trusted without the studio ever touching DNS. Only a mailbox
              // that is the studio's — a stranger's "Yes" teaches nothing.
              const forwarder = capture.get("authentication.forwarder") as
                | { mailbox?: unknown; ownMailbox?: unknown; signers?: unknown }
                | undefined;
              if (
                forwarder?.ownMailbox === true &&
                typeof forwarder.mailbox === "string" &&
                Array.isArray(forwarder.signers)
              ) {
                learnedForwarders = forwarder.signers
                  .filter((signer): signer is string => typeof signer === "string" && signer.length > 0)
                  .map((signer) => forwarderKey(forwarder.mailbox as string, signer));
              }
            }
          }
          const settingsReference = db.doc(`leadCaptureSettings/${command.tenantId}`);
          const settings =
            learnedSender || learnedForwarders.length ? await transaction.get(settingsReference) : null;
          transaction.update(leadReference, {
            ...changes,
            updatedAt: timestamp,
            updatedBy: identity.uid,
          });
          if (learnedSender || learnedForwarders.length) {
            const known = (settings?.get("inquirySenders") as string[] | undefined) ?? [];
            const forwarders = (settings?.get("trustedForwarders") as string[] | undefined) ?? [];
            transaction.set(
              settingsReference,
              {
                tenantId: command.tenantId,
                ...(learnedSender
                  ? { inquirySenders: Array.from(new Set([...known, learnedSender])).slice(-200) }
                  : {}),
                ...(learnedForwarders.length
                  ? { trustedForwarders: Array.from(new Set([...forwarders, ...learnedForwarders])).slice(-200) }
                  : {}),
                updatedAt: timestamp,
              },
              { merge: true },
            );
          }
          const leadAuditId = randomUUID();
          transaction.create(db.doc(`auditEvents/${leadAuditId}`), {
            id: leadAuditId,
            tenantId: command.tenantId,
            projectId: null,
            actorId: identity.uid,
            actorType: "user",
            action: confirmInquiry ? "lead.confirmed" : "lead.updated",
            entityType: "lead",
            entityId: leadId,
            timestamp,
            before: Object.fromEntries(
              Object.keys(changes)
                .filter((key) => key !== "fieldProvenance" && key !== "missingInformation")
                .map((key) => [key, lead.get(key) ?? null]),
            ),
            after: Object.fromEntries(
              Object.entries(changes).filter(
                ([key]) => key !== "fieldProvenance" && key !== "missingInformation",
              ),
            ),
            ipAddress: null,
            userAgent: request.header("user-agent") ?? null,
            correlationId,
            automationRunId: null,
            providerEventId: null,
          });
          const output = { leadId, updated: Object.keys(changes) };
          transaction.create(commandReference, {
            tenantId: command.tenantId,
            idempotencyKey: command.idempotencyKey,
            result: output,
            createdAt: timestamp,
          });
          return output;
        }

        if (command.type === "markLeadNotInquiry") {
          const leadReference = db.doc(`leads/${command.input.leadId}`);
          const lead = await transaction.get(leadReference);
          if (!lead.exists || lead.get("tenantId") !== command.tenantId) {
            throw new Error("LEAD_NOT_FOUND");
          }
          // An inquiry that became a job on arrival is still only an inquiry:
          // "not an inquiry" puts its untouched job away with it. A job the
          // studio has moved on, or made by hand, is not undone from here.
          const linkedProjectId = lead.get("projectId");
          const linkedProject =
            typeof linkedProjectId === "string" && linkedProjectId
              ? await transaction.get(db.doc(`projects/${linkedProjectId}`))
              : null;
          if (
            linkedProject &&
            !(
              linkedProject.exists &&
              linkedProject.get("tenantId") === command.tenantId &&
              linkedProject.get("origin") === "inquiry" &&
              linkedProject.get("state") === "LEAD"
            )
          ) {
            throw new Error("LEAD_NOT_CONVERTIBLE");
          }
          const captureId = lead.get("captureId");
          const capture =
            typeof captureId === "string" && captureId
              ? await transaction.get(db.doc(`inboundCaptures/${captureId}`))
              : null;
          const sender = capture?.get("notificationSender");
          const settingsReference = db.doc(`leadCaptureSettings/${command.tenantId}`);
          const settings = await transaction.get(settingsReference);
          // A reply drafted to this "inquiry" must not stay approvable: sent,
          // it would email a newsletter or a vendor. Read with the rest,
          // before any write, and retired below. Equality filters only, so
          // no composite index is needed.
          const pendingReplies = await transaction.get(
            db
              .collection("aiActions")
              .where("tenantId", "==", command.tenantId)
              .where("capability", "==", "inquiry_reply_draft")
              .where("status", "==", "review_required"),
          );
          const repliesToRetire = pendingReplies.docs.filter((draft) => {
            const references = draft.get("sourceReferences");
            return (
              Array.isArray(references) &&
              references.some(
                (reference: Record<string, unknown> | null) =>
                  reference?.entityType === "lead" && reference?.entityId === command.input.leadId,
              )
            );
          });
          // The sender is remembered only when the studio asked for it, and
          // never when it is the couple's own address, the studio's own
          // mailbox, or a form/marketplace address every real inquiry also
          // comes from (intake/ignorable-sender.ts). Otherwise only this one
          // message is filed away. Read before the first write.
          const protection = command.input.ignoreSender
            ? senderProtection({
                sender: typeof sender === "string" ? sender : null,
                leadEmail: String(lead.get("email") ?? ""),
                formBuilder:
                  typeof lead.get("formBuilder") === "string"
                    ? String(lead.get("formBuilder"))
                    : typeof capture?.get("builder") === "string"
                      ? String(capture.get("builder"))
                      : null,
                studioAddresses: await studioMailboxes(db, command.tenantId, settings),
              })
            : null;
          const learn =
            command.input.ignoreSender && protection === null && typeof sender === "string";
          transaction.update(leadReference, {
            status: "archived",
            needsConfirmation: false,
            notInquiry: true,
            archivedAt: timestamp,
            updatedAt: timestamp,
            updatedBy: identity.uid,
          });
          if (linkedProject?.exists) {
            transaction.update(linkedProject.ref, {
              state: "ARCHIVED",
              stateVersion: Number(linkedProject.get("stateVersion") ?? 0) + 1,
              archivedAt: timestamp,
              nextAction: null,
              updatedAt: timestamp,
              updatedBy: identity.uid,
            });
          }
          if (learn) {
            const known = (settings.get("notInquirySenders") as string[] | undefined) ?? [];
            const inquirySenders = (settings.get("inquirySenders") as string[] | undefined) ?? [];
            transaction.set(
              settingsReference,
              {
                tenantId: command.tenantId,
                notInquirySenders: Array.from(new Set([...known, sender])).slice(-200),
                inquirySenders: inquirySenders.filter((value) => value !== sender),
                updatedAt: timestamp,
              },
              { merge: true },
            );
          }
          for (const draft of repliesToRetire) {
            transaction.update(draft.ref, {
              status: "dismissed",
              decision: {
                actorId: identity.uid,
                action: "dismissed",
                decidedAt: timestamp,
                note: "The lead was marked not an inquiry.",
                editDelta: null,
              },
              updatedAt: timestamp,
            });
          }
          const notInquiryAuditId = randomUUID();
          transaction.create(db.doc(`auditEvents/${notInquiryAuditId}`), {
            id: notInquiryAuditId,
            tenantId: command.tenantId,
            projectId: null,
            actorId: identity.uid,
            actorType: "user",
            action: "lead.not_inquiry",
            entityType: "lead",
            entityId: command.input.leadId,
            timestamp,
            before: { status: lead.get("status") ?? "new" },
            after: {
              status: "archived",
              ignoredSender: learn ? sender : null,
              archivedProjectId: linkedProject?.exists ? linkedProject.id : null,
            },
            ipAddress: null,
            userAgent: request.header("user-agent") ?? null,
            correlationId,
            automationRunId: null,
            providerEventId: null,
          });
          const output = {
            leadId: command.input.leadId,
            ignoredSender: learn ? (sender as string) : null,
            // Asked to ignore it and didn't: why, for the screen to say.
            senderKept:
              command.input.ignoreSender && protection
                ? {
                    sender: typeof sender === "string" ? sender : null,
                    reason: protection,
                    message: senderProtectionReason(protection),
                  }
                : null,
          };
          transaction.create(commandReference, {
            tenantId: command.tenantId,
            idempotencyKey: command.idempotencyKey,
            result: output,
            createdAt: timestamp,
          });
          return output;
        }

        if (command.type === "removeIgnoredSender") {
          // The sender lists steer what capture keeps, so — like the form
          // mappings beside them — only owners and admins change them.
          if (!["studio_owner", "studio_admin"].includes(membershipData.role)) {
            throw new Error("FORBIDDEN");
          }
          const settingsReference = db.doc(`leadCaptureSettings/${command.tenantId}`);
          const settings = await transaction.get(settingsReference);
          const known = (settings.get("notInquirySenders") as string[] | undefined) ?? [];
          const removed = known.includes(command.input.sender);
          if (removed) {
            transaction.set(
              settingsReference,
              {
                tenantId: command.tenantId,
                notInquirySenders: known.filter((value) => value !== command.input.sender),
                updatedAt: timestamp,
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
              action: "lead_capture.ignored_sender_removed",
              entityType: "leadCaptureSettings",
              entityId: command.tenantId,
              timestamp,
              before: { ignoredSender: command.input.sender },
              after: { ignoredSender: null },
              ipAddress: null,
              userAgent: request.header("user-agent") ?? null,
              correlationId,
              automationRunId: null,
              providerEventId: null,
            });
          }
          const output = { sender: command.input.sender, removed };
          transaction.create(commandReference, {
            tenantId: command.tenantId,
            idempotencyKey: command.idempotencyKey,
            result: output,
            createdAt: timestamp,
          });
          return output;
        }

        // One branch for the four inquiry-lifecycle commands, which share
        // their reads and their receipt.
        if (inquiryLifecycleCommands.has(command.type)) {
          const lifecycle = command as InquiryLifecycleCommand;
          const kind = lifecycle.type;
          const inquiry = await readInquiryInTransaction(transaction, {
            tenantId: lifecycle.tenantId,
            projectId: lifecycle.input.projectId,
            leadId: lifecycle.input.leadId,
          });
          const leadIds = inquiry.leads.map((lead) => lead.id);
          // Drafts that answer or chase this couple. Equality filters only.
          const pendingDrafts = leadIds.length
            ? (
                await transaction.get(
                  db
                    .collection("aiActions")
                    .where("tenantId", "==", command.tenantId)
                    .where("status", "==", "review_required"),
                )
              ).docs.filter((draft) => {
                const output = (draft.get("structuredOutput") ?? {}) as Record<string, unknown>;
                const references = Array.isArray(draft.get("sourceReferences"))
                  ? (draft.get("sourceReferences") as Array<Record<string, unknown>>)
                  : [];
                const forThisCouple =
                  leadIds.includes(String(output.leadId ?? "")) ||
                  references.some(
                    (reference) => reference?.entityType === "lead" && leadIds.includes(String(reference.entityId)),
                  );
                const capability = String(draft.get("capability") ?? "");
                return (
                  forThisCouple &&
                  (capability === "inquiry_follow_up" ||
                    (kind === "closeInquiry" && capability === "inquiry_reply_draft"))
                );
              })
            : [];
          const retire = (note: string) => {
            for (const draft of pendingDrafts) {
              transaction.update(draft.ref, {
                status: "dismissed",
                decision: { actorId: identity.uid, action: "dismissed", decidedAt: timestamp, note, editDelta: null },
                updatedAt: timestamp,
              });
            }
          };
          let output: Record<string, unknown> = { projectId: inquiry.project?.id ?? null, leadIds };

          if (lifecycle.type === "closeInquiry") {
            if (inquiry.project) {
              const state = String(inquiry.project.get("state"));
              if (!PRE_BOOKING.includes(state)) throw new Error("INQUIRY_NOT_CLOSABLE");
              // A lost inquiry at RETAINER_PENDING can have a retainer out and a
              // booking plan waiting on it. Closed with the job — see
              // stopped-billing.ts. Read before any write below.
              const billingReads = await readStoppedBilling(
                db,
                transaction,
                lifecycle.tenantId,
                inquiry.project.id,
              );
              writeStoppedBilling(db, transaction, {
                tenantId: lifecycle.tenantId,
                projectId: inquiry.project.id,
                stop: "lost",
                reads: billingReads,
                now: timestamp,
                actor: identity.uid,
              });
              transaction.update(inquiry.project.ref, {
                state: "LOST",
                lostFromState: state,
                lostReason: lifecycle.input.reason,
                lostAt: timestamp,
                stateVersion: Number(inquiry.project.get("stateVersion") ?? 0) + 1,
                nextAction: null,
                updatedAt: timestamp,
                updatedBy: identity.uid,
              });
            }
            for (const lead of inquiry.leads) {
              transaction.update(lead.ref, {
                status: "lost",
                lostReason: lifecycle.input.reason,
                lostAt: timestamp,
                closeSuggestedAt: null,
                updatedAt: timestamp,
                updatedBy: identity.uid,
              });
            }
            retire("The inquiry was closed.");
            output = { ...output, state: "LOST", reason: lifecycle.input.reason };
          } else if (kind === "reopenInquiry") {
            if (inquiry.project) {
              if (inquiry.project.get("state") !== "LOST") throw new Error("INQUIRY_NOT_CLOSED");
              const back = String(inquiry.project.get("lostFromState") || "LEAD");
              transaction.update(inquiry.project.ref, {
                state: PRE_BOOKING.includes(back) ? back : "LEAD",
                lostReason: null,
                lostAt: null,
                stateVersion: Number(inquiry.project.get("stateVersion") ?? 0) + 1,
                updatedAt: timestamp,
                updatedBy: identity.uid,
              });
            }
            for (const lead of inquiry.leads) {
              transaction.update(lead.ref, {
                status: inquiry.project ? "converted" : "new",
                lostReason: null,
                lostAt: null,
                closeSuggestedAt: null,
                closeDeferredUntil: null,
                updatedAt: timestamp,
                updatedBy: identity.uid,
              });
            }
            output = { ...output, reopened: true };
          } else if (kind === "inquiryHeardElsewhere") {
            for (const lead of inquiry.leads) {
              transaction.update(lead.ref, {
                heardElsewhereAt: timestamp,
                closeSuggestedAt: null,
                updatedAt: timestamp,
                updatedBy: identity.uid,
              });
            }
            retire("The couple replied outside StudioCue.");
          } else {
            const inAWeek = new Date(Date.parse(timestamp) + 7 * 86_400_000).toISOString();
            for (const lead of inquiry.leads) {
              transaction.update(lead.ref, {
                closeSuggestedAt: null,
                closeDeferredUntil: inAWeek,
                updatedAt: timestamp,
                updatedBy: identity.uid,
              });
            }
          }
          const inquiryAuditId = randomUUID();
          transaction.create(db.doc(`auditEvents/${inquiryAuditId}`), {
            id: inquiryAuditId,
            tenantId: command.tenantId,
            projectId: inquiry.project?.id ?? null,
            actorId: identity.uid,
            actorType: "user",
            action: `inquiry.${kind}`,
            entityType: inquiry.project ? "project" : "lead",
            entityId: inquiry.project?.id ?? leadIds[0] ?? null,
            timestamp,
            before: { state: inquiry.project?.get("state") ?? null },
            after: output,
            ipAddress: null,
            userAgent: request.header("user-agent") ?? null,
            correlationId,
            automationRunId: null,
            providerEventId: null,
          });
          transaction.create(commandReference, {
            tenantId: command.tenantId,
            idempotencyKey: command.idempotencyKey,
            result: output,
            createdAt: timestamp,
          });
          return output;
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
      /**
       * The inquiry thread follows the lead onto the job, so the couple's first
       * message and the studio's reply are on the job's Messages rather than
       * stranded on a converted lead. Not fatal: the job exists either way.
       */
      const converted = result as { convertedLeadId?: string | null; projectId?: string };
      if (converted.convertedLeadId && converted.projectId) {
        await afterConversion(db, {
          tenantId: command.tenantId,
          leadId: converted.convertedLeadId,
          projectId: converted.projectId,
          now: new Date().toISOString(),
        });
      }
      /**
       * An edit can make an inquiry a job: the studio confirming a "maybe",
       * or adding the date it arrived without. convertInquiryToJob decides,
       * and does nothing for a lead that isn't ready or already is one.
       */
      if (commandsThatCanConvert.has(command.type)) {
        // A confirmed "maybe" had its reply held back (operations/ai-pdf.ts):
        // run the intake job again, now that it is an inquiry.
        const edit = command.input as { leadId: string; confirmInquiry?: boolean };
        if (edit.confirmInquiry) {
          await db
            .doc(`aiJobs/lead_intake_${edit.leadId}`)
            .set(
              {
                id: `lead_intake_${edit.leadId}`,
                tenantId: command.tenantId,
                projectId: null,
                leadId: edit.leadId,
                type: "lead_intake_analysis",
                status: "queued",
                attempts: 0,
                nextAttemptAt: null,
                humanApprovalRequired: false,
                updatedAt: new Date().toISOString(),
              },
              { merge: true },
            )
            .catch((caught: unknown) => {
              console.warn(`[crm] re-queuing the confirmed inquiry's reply failed: ${String(caught).slice(0, 160)}`);
            });
        }
        try {
          await convertInquiryToJob(db, {
            tenantId: command.tenantId,
            leadId: (command.input as { leadId: string }).leadId,
            now: new Date().toISOString(),
          });
        } catch (caught: unknown) {
          console.warn(`[crm] converting the edited inquiry failed: ${String(caught).slice(0, 160)}`);
        }
      }
      /**
       * A client given an address that belongs to the studio's own team or
       * crew cannot get portal access with it. Said now, at the save, rather
       * than when the couple's invitation fails. Keyed off the result and the
       * input rather than the command type (see the note above).
       */
      const savedContact = result as { contactId?: string };
      const inputEmail = (command.input as { email?: unknown }).email;
      if (savedContact.contactId && typeof inputEmail === "string") {
        const teamRole = await teamRoleForEmail(db, command.tenantId, inputEmail).catch(
          () => null,
        );
        if (teamRole) {
          response.status(200).json({ ...(result as object), emailBelongsToTeamRole: teamRole });
          return;
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
