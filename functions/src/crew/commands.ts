import { createHash, randomBytes } from "node:crypto";
import {
  getFirestore,
  type DocumentData,
  type DocumentSnapshot,
} from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { z } from "zod";
import { requireAppCheck, requireIdentity } from "../crm/security.js";
import { productEvent } from "../operations/product-events.js";
import { studioHubCors } from "../security/cors.js";
import { findDuplicateProfile } from "./duplicate-profile.js";

const requirement = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum([
    "w9",
    "insurance",
    "contract",
    "equipment",
    "file",
    "acknowledgement",
  ]),
  required: z.boolean(),
  dueAt: z.string().datetime().nullable(),
  instructions: z.string().max(1000).nullable().optional(),
});
const cascadeInput = z.object({
  projectId: z.string(),
  role: z.string().min(1).max(120),
  candidateIds: z.array(z.string().min(1)).min(1).max(20),
  responseWindowHours: z.number().int().min(1).max(168),
  compensationCents: z.number().int().nonnegative().nullable(),
  compensationType: z.enum(["hourly", "event"]).nullable(),
  currency: z.string().length(3),
  compensationVisibleToCrew: z.boolean(),
  arrivalAt: z.string().datetime(),
  departureAt: z.string().datetime(),
  locations: z
    .array(
      z.object({
        name: z.string().min(1),
        address: z.string().nullable(),
      }),
    )
    .min(1),
  responsibilities: z.array(z.string().min(1)),
  scheduleItemIds: z.array(z.string()),
  currentScheduleId: z.string().nullable(),
  currentScheduleVersion: z.number().int().nonnegative(),
  requirements: z.array(requirement),
});
const command = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("createCrewProfile"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      name: z.string().min(1).max(160),
      email: z.string().email(),
      phone: z.string().min(7).max(30).nullable(),
      specialties: z.array(z.string().min(1)),
      serviceAreas: z.array(z.string().min(1)),
      travelRadiusMiles: z.number().int().nonnegative().max(500),
      rateType: z.enum(["hourly", "event"]),
      rateCents: z.number().int().nonnegative(),
      currency: z.string().length(3),
    }),
  }),
  z.object({
    type: z.literal("inviteAssignment"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string(),
      crewProfileId: z.string(),
      userId: z.string().nullable(),
      role: z.string().min(1).max(120),
      compensationCents: z.number().int().nonnegative().nullable(),
      compensationType: z.enum(["hourly", "event"]).nullable(),
      currency: z.string().length(3),
      compensationVisibleToCrew: z.boolean(),
      arrivalAt: z.string().datetime(),
      departureAt: z.string().datetime(),
      locations: z
        .array(
          z.object({
            name: z.string().min(1),
            address: z.string().nullable(),
          }),
        )
        .min(1),
      responsibilities: z.array(z.string().min(1)),
      scheduleItemIds: z.array(z.string()),
      currentScheduleId: z.string().nullable(),
      currentScheduleVersion: z.number().int().nonnegative(),
      requirements: z.array(requirement),
    }),
  }),
  z.object({
    type: z.literal("createCrewCascade"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: cascadeInput,
  }),
  z.object({
    type: z.literal("createCrewPlan"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string(),
      cascades: z.array(cascadeInput).min(1).max(10),
    }),
  }),
  z.object({
    type: z.literal("respondAssignment"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string(),
      assignmentId: z.string(),
      decision: z.enum(["accepted", "declined"]),
    }),
  }),
  z.object({
    type: z.literal("setAvailability"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      crewProfileId: z.string().min(1),
      startsAt: z.string().datetime(),
      endsAt: z.string().datetime(),
      status: z.enum(["available", "unavailable", "tentative"]),
      notes: z.string().max(1000).nullable(),
    }),
  }),
  z.object({
    type: z.literal("updateAvailability"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      availabilityId: z.string().min(1),
      startsAt: z.string().datetime(),
      endsAt: z.string().datetime(),
      status: z.enum(["available", "unavailable", "tentative"]),
      notes: z.string().max(1000).nullable(),
    }),
  }),
  z.object({
    type: z.literal("deleteAvailability"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({ availabilityId: z.string().min(1) }),
  }),
  z.object({
    type: z.literal("updateCrewProfile"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      crewProfileId: z.string().min(1),
      phone: z.string().min(7).max(30).nullable(),
      specialties: z.array(z.string().min(1).max(80)).max(20),
      serviceAreas: z.array(z.string().min(1).max(120)).max(20),
      travelRadiusMiles: z.number().int().nonnegative().max(500),
      equipment: z.array(z.string().min(1).max(120)).max(50),
      emergencyContact: z.object({
        name: z.string().min(1).max(160),
        phone: z.string().min(7).max(30),
        relationship: z.string().min(1).max(80),
      }).nullable(),
    }),
  }),
  z.object({
    /**
     * The studio's own corrections to a directory entry.
     *
     * `updateCrewProfile` is strictly self-service — it requires
     * `role === "subcontractor"` and `userId === identity.uid` — so the studio
     * that typed a collaborator into their directory could never fix a typo in
     * it. The Crew page had no per-person control at all.
     *
     * Split on who the detail belongs to. Name, email, rate and the studio's
     * operational notes (specialties, service areas, travel radius) are the
     * directory entry, which the studio owns. Phone and emergency contact stay
     * out: those are the person's, and `updateCrewProfile` is where they change
     * them. Once a profile has a linked account, the studio can no longer
     * change the name or email — that identity is the crew member's, and the
     * email is how they sign in.
     */
    type: z.literal("updateCrewDirectoryEntry"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      crewProfileId: z.string().min(1),
      name: z.string().trim().min(1).max(160),
      email: z.string().email(),
      specialties: z.array(z.string().min(1).max(80)).max(20),
      serviceAreas: z.array(z.string().min(1).max(120)).max(20),
      travelRadiusMiles: z.number().int().nonnegative().max(500),
      rateType: z.enum(["hourly", "event"]),
      rateCents: z.number().int().nonnegative(),
      notes: z.string().max(2000).nullable().default(null),
    }),
  }),
  z.object({
    /**
     * Send, or re-send, a roster invite to somebody already in the directory.
     *
     * Every collaborator added before roster invites existed has no account
     * and no token, so without this they would stay inert forever.
     */
    type: z.literal("inviteCrewProfile"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      crewProfileId: z.string().min(1),
    }),
  }),
  z.object({
    /**
     * What the studio has actually collected from a collaborator.
     *
     * These three statuses were written once, at profile creation, hardcoded
     * to "missing", and no command could ever change them: the two update
     * commands carry the person's description, never their paperwork. Every
     * collaborator a studio added therefore read "missing" on all three
     * forever. It never blocked an offer — `rankCrewCandidates` scores
     * paperwork rather than gating on it — but it cost 15 points of ranking
     * and listed three permanent profile gaps the studio had no way to close.
     *
     * The studio attests to paperwork it holds elsewhere (a W-9 emailed over,
     * a COI on file), which is why this records a status rather than
     * accepting a document. It is an internal readiness record, not evidence:
     * nothing here signs, pays, or completes anything on the client's side.
     */
    type: z.literal("setCrewCompliance"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      crewProfileId: z.string().min(1),
      w9Status: z.enum(["missing", "requested", "received", "verified"]),
      insuranceStatus: z.enum([
        "missing",
        "requested",
        "received",
        "verified",
        "expired",
      ]),
      contractStatus: z.enum(["missing", "sent", "completed", "expired"]),
    }),
  }),
  z.object({
    /**
     * Take a collaborator out of the directory.
     *
     * Archive, never delete: they are named on assignments, schedules and
     * closeouts that must keep making sense. Refused while they hold an
     * assignment that has not been settled — removing them from the directory
     * would hide someone the studio is still counting on.
     */
    type: z.literal("archiveCrewProfile"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      crewProfileId: z.string().min(1),
      restore: z.boolean().default(false),
    }),
  }),
  z.object({
    type: z.literal("acknowledgeCalendar"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string(),
      assignmentId: z.string(),
    }),
  }),
  z.object({
    type: z.literal("acknowledgeSchedule"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string(),
      assignmentId: z.string(),
      scheduleId: z.string(),
      scheduleVersion: z.number().int().positive(),
    }),
  }),
  z.object({
    type: z.literal("completeRequirement"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string(),
      assignmentId: z.string(),
      requirementId: z.string(),
      documentId: z.string().nullable(),
    }),
  }),
  z.object({
    type: z.literal("waiveRequirement"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string(),
      assignmentId: z.string(),
      requirementId: z.string(),
      reason: z.string().min(1).max(1000),
    }),
  }),
  z.object({
    type: z.literal("completeAssignment"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string(),
      assignmentId: z.string(),
    }),
  }),
  z.object({
    type: z.literal("reviewAssignmentCloseout"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string(),
      assignmentId: z.string(),
      decision: z.enum(["approved", "needs_changes"]),
      reviewerNote: z.string().max(2000).nullable(),
    }),
  }),
  z.object({
    type: z.literal("updateAssignmentPayment"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string(),
      assignmentId: z.string(),
      status: z.enum(["scheduled", "processing", "paid"]),
      expectedAt: z.string().datetime().nullable(),
      reference: z.string().max(240).nullable(),
    }),
  }),
  z.object({
    type: z.literal("submitAssignmentCloseout"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string(),
      assignmentId: z.string(),
      actualStartsAt: z.string().datetime(),
      actualEndsAt: z.string().datetime(),
      extraMinutes: z.number().int().nonnegative().max(1440),
      expenses: z.array(z.object({
        description: z.string().min(1).max(240),
        amountCents: z.number().int().nonnegative().max(10_000_000),
      })).max(25),
      deliverables: z.array(z.string().url().max(2000)).max(25),
      notes: z.string().max(4000).nullable(),
    }),
  }),
  z.object({
    type: z.literal("contactStudio"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string(),
      assignmentId: z.string(),
      subject: z.string().min(1).max(160),
      message: z.string().min(1).max(4000),
      urgency: z.enum(["normal", "event_day"]),
    }),
  }),
  z.object({
    type: z.literal("submitRequirement"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string(),
      assignmentId: z.string(),
      requirementId: z.string(),
      documentId: z.string().min(1),
    }),
  }),
]);

const internalRoles = new Set([
  "studio_owner",
  "studio_admin",
  "studio_coordinator",
]);
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const stable = (scope: string, tenantId: string, key: string) =>
  `${scope}_${hash(`${tenantId}:${key}`).slice(0, 32)}`;
const appUrl = () =>
  process.env.NEXT_PUBLIC_APP_URL ?? "https://studiohub.app";

/**
 * The roster invite: an account, with no job attached.
 *
 * The only invite that existed was minted on a `crewAssignment`, so a
 * collaborator could not be given access until they were offered specific
 * work. Adding someone to the directory therefore sent nothing and left
 * `userId: null` — an inert row the studio had to maintain by hand, including
 * paperwork the person could have supplied themselves.
 *
 * This mints the same shape of token against the profile instead, so the two
 * accept paths can share one URL, one page and one command. Returned rather
 * than committed so the caller can batch it with whatever else it is writing.
 */
/**
 * Every profile in the tenant, for the duplicate check.
 *
 * Both call sites used to read `.limit(400)` with no ordering, so Firestore
 * returned an arbitrary 400 documents and anyone outside that window was
 * invisible to the check — which then returned "unique" and created the
 * duplicate it exists to prevent. It failed open, and which 400 you got was
 * not stable between calls. Archived entries count toward the cap too, so a
 * studio that takes on seasonal crew and archives them reaches it on history
 * alone, long before it has 400 people.
 *
 * The scan cannot become an equality query on email: addresses are stored as
 * the studio typed them, and `findDuplicateProfile` normalises both sides so
 * "Sam@Studio.com" collides with "sam@studio.com". Comparing raw values in
 * Firestore would miss exactly the case-typo duplicates this is for. So it
 * pages instead, and reads only the three fields the verdict needs.
 */
async function tenantCrewDirectory(
  db: FirebaseFirestore.Firestore,
  tenantId: string,
) {
  const profiles: Array<{
    id: string;
    email: string;
    name: string;
    archivedAt: string | null;
  }> = [];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    let query = db
      .collection("crewProfiles")
      .where("tenantId", "==", tenantId)
      .orderBy("__name__")
      .select("email", "name", "archivedAt")
      .limit(500);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    for (const document of page.docs) {
      profiles.push({
        id: document.id,
        email: String(document.get("email") ?? ""),
        name: String(document.get("name") ?? ""),
        archivedAt: (document.get("archivedAt") as string | null) ?? null,
      });
    }
    if (page.size < 500) return profiles;
    cursor = page.docs[page.size - 1];
  }
}

function crewRosterInvitation(input: {
  db: FirebaseFirestore.Firestore;
  profileId: string;
  tenantId: string;
  email: unknown;
  name: unknown;
  now: string;
  actorId: string;
}) {
  const inviteToken = randomBytes(32).toString("base64url");
  const inviteExpiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
  const inviteUrl = `${appUrl()}/auth/crew-invite?token=${encodeURIComponent(inviteToken)}`;
  return {
    inviteUrl,
    inviteExpiresAt,
    profileFields: {
      inviteTokenHash: hash(inviteToken),
      inviteExpiresAt,
      inviteStatus: "invited",
      invitedAt: input.now,
    },
    emailJob: {
      reference: input.db.doc(
        `emailJobs/crew_roster_invite_${input.profileId}_${hash(inviteToken).slice(0, 12)}`,
      ),
      value: {
        tenantId: input.tenantId,
        projectId: null,
        type: "crew_directory_invitation",
        crewProfileId: input.profileId,
        recipient: input.email,
        recipientName: input.name,
        inviteToken,
        inviteUrl,
        respondBy: inviteExpiresAt,
        status: "queued",
        attempts: 0,
        createdAt: input.now,
        updatedAt: input.now,
      },
    },
  };
}

function crewInvitationEmailFields(input: {
  role: unknown;
  arrivalAt: unknown;
  departureAt: unknown;
  respondBy: string;
  locations: unknown;
  responsibilities: unknown;
  compensationCents: unknown;
  compensationType: unknown;
  compensationVisibleToCrew: unknown;
  currency: unknown;
}) {
  const locations = Array.isArray(input.locations) ? input.locations : [];
  const firstLocation =
    typeof locations[0] === "object" && locations[0] !== null
      ? (locations[0] as Record<string, unknown>)
      : {};
  return {
    role: input.role,
    arrivalAt: input.arrivalAt,
    departureAt: input.departureAt,
    respondBy: input.respondBy,
    locationName: firstLocation.name ?? null,
    locationAddress: firstLocation.address ?? null,
    responsibilities: Array.isArray(input.responsibilities)
      ? input.responsibilities
      : [],
    compensationCents: input.compensationCents,
    compensationType: input.compensationType,
    compensationVisibleToCrew: input.compensationVisibleToCrew,
    currency: input.currency,
  };
}

function cascadeAssignment(input: {
  id: string;
  tenantId: string;
  cascadeId: string;
  candidateIndex: number;
  profile: DocumentSnapshot;
  cascade: DocumentData;
  token: string;
  now: string;
  actorId: string;
}) {
  const expiresAt = new Date(
    Date.parse(input.now) +
      Number(input.cascade.responseWindowHours ?? 24) * 60 * 60 * 1000,
  ).toISOString();
  return {
    assignment: {
      id: input.id,
      tenantId: input.tenantId,
      projectId: input.cascade.projectId,
      crewProfileId: input.profile.id,
      userId: input.profile.get("userId") ?? null,
      role: input.cascade.role,
      compensationCents: input.cascade.compensationCents,
      compensationType: input.cascade.compensationType,
      currency: input.cascade.currency,
      compensationVisibleToCrew: input.cascade.compensationVisibleToCrew,
      arrivalAt: input.cascade.arrivalAt,
      departureAt: input.cascade.departureAt,
      locations: input.cascade.locations,
      responsibilities: input.cascade.responsibilities,
      scheduleItemIds: input.cascade.scheduleItemIds,
      notes: null,
      status: "invited",
      invitationSentAt: input.now,
      viewedAt: null,
      respondedAt: null,
      calendarStatus: "not_added",
      calendarAcknowledgedAt: null,
      currentScheduleId: input.cascade.currentScheduleId,
      currentScheduleVersion: input.cascade.currentScheduleVersion,
      acknowledgedScheduleVersion: null,
      scheduleAcknowledgedAt: null,
      requirements: Array.isArray(input.cascade.requirements)
        ? input.cascade.requirements.map((itemValue: unknown) => {
            const item =
              typeof itemValue === "object" &&
              itemValue !== null &&
              !Array.isArray(itemValue)
                ? (itemValue as Record<string, unknown>)
                : {};
            return {
              ...item,
              status: "missing",
              documentId: null,
              completedAt: null,
              completedBy: null,
              notes: null,
            };
          })
        : [],
      inviteTokenHash: hash(input.token),
      inviteExpiresAt: expiresAt,
      cascadeId: input.cascadeId,
      cascadeCandidateIndex: input.candidateIndex,
      createdAt: input.now,
      updatedAt: input.now,
      createdBy: input.actorId,
      updatedBy: input.actorId,
      archivedAt: null,
    },
    emailJob: {
      id: `crew_invite_${input.id}`,
      tenantId: input.tenantId,
      projectId: input.cascade.projectId,
      type: "crew_invitation",
      assignmentId: input.id,
      cascadeId: input.cascadeId,
      recipient: input.profile.get("email"),
      recipientName: input.profile.get("name"),
      inviteToken: input.token,
      inviteUrl: `${appUrl()}/auth/crew-invite?token=${encodeURIComponent(input.token)}`,
      ...crewInvitationEmailFields({
        role: input.cascade.role,
        arrivalAt: input.cascade.arrivalAt,
        departureAt: input.cascade.departureAt,
        respondBy: expiresAt,
        locations: input.cascade.locations,
        responsibilities: input.cascade.responsibilities,
        compensationCents: input.cascade.compensationCents,
        compensationType: input.cascade.compensationType,
        compensationVisibleToCrew: input.cascade.compensationVisibleToCrew,
        currency: input.cascade.currency,
      }),
      status: "queued",
      attempts: 0,
      createdAt: input.now,
      updatedAt: input.now,
    },
    expiresAt,
  };
}

export const crewCommand = onRequest(
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
      const hasProject = (projectId: string) =>
        ["studio_owner", "studio_admin"].includes(role) ||
        (Array.isArray(projectIds) && projectIds.includes(projectId));
      const execution = db.doc(
        `commandExecutions/${stable("crew", parsed.tenantId, parsed.idempotencyKey)}`,
      );
      const prior = await execution.get();
      if (prior.exists) {
        response.status(200).json(prior.get("result"));
        return;
      }
      const now = new Date().toISOString();
      let result: Record<string, unknown>;

      if (parsed.type === "createCrewProfile") {
        if (!internalRoles.has(role)) throw new Error("FORBIDDEN");
        /**
         * Not someone you already have.
         *
         * This wrote a new profile every time, with no check on the email, and
         * the production directory grew two entries on one address differing
         * only by how the name had been typed. Crew are ranked and offered work
         * per job, so a duplicate person can be offered the same wedding twice,
         * acknowledge on one entry and look unresponsive on the other.
         * See features/crew/duplicate-profile.ts.
         */
        const duplicate = findDuplicateProfile(
          parsed.input.email,
          await tenantCrewDirectory(db, parsed.tenantId),
        );
        if (duplicate.kind === "active") {
          throw new Error("CREW_EMAIL_ALREADY_IN_DIRECTORY");
        }
        if (duplicate.kind === "archived") {
          throw new Error("CREW_EMAIL_ARCHIVED_IN_DIRECTORY");
        }
        const id = stable(
          "crew_profile",
          parsed.tenantId,
          parsed.idempotencyKey,
        );
        // Adding somebody invites them. It used to write `userId: null` and
        // stop, which is why a studio could add a collaborator and watch
        // nothing at all happen.
        const invitation = crewRosterInvitation({
          db,
          profileId: id,
          tenantId: parsed.tenantId,
          email: parsed.input.email,
          name: parsed.input.name,
          now,
          actorId: identity.uid,
        });
        const created = db.batch();
        created.create(db.doc(`crewProfiles/${id}`), {
          id,
          tenantId: parsed.tenantId,
          userId: null,
          ...parsed.input,
          equipment: [],
          w9Status: "missing",
          insuranceStatus: "missing",
          contractStatus: "missing",
          emergencyContact: null,
          notes: null,
          active: true,
          ...invitation.profileFields,
          createdAt: now,
          updatedAt: now,
          createdBy: identity.uid,
          updatedBy: identity.uid,
          archivedAt: null,
        });
        created.create(
          invitation.emailJob.reference,
          invitation.emailJob.value,
        );
        await created.commit();
        result = {
          crewProfileId: id,
          invited: true,
          inviteExpiresAt: invitation.inviteExpiresAt,
        };
      } else if (parsed.type === "updateCrewDirectoryEntry") {
        if (!internalRoles.has(role)) throw new Error("FORBIDDEN");
        const reference = db.doc(`crewProfiles/${parsed.input.crewProfileId}`);
        const current = await reference.get();
        if (
          !current.exists ||
          current.get("tenantId") !== parsed.tenantId ||
          current.get("archivedAt")
        ) {
          throw new Error("CREW_PROFILE_NOT_FOUND");
        }
        // Changing an email onto somebody else's is the same collision by
        // another route.
        if (parsed.input.email !== current.get("email")) {
          const collision = findDuplicateProfile(
            parsed.input.email,
            await tenantCrewDirectory(db, parsed.tenantId),
            parsed.input.crewProfileId,
          );
          if (collision.kind !== "unique") {
            throw new Error("CREW_EMAIL_ALREADY_IN_DIRECTORY");
          }
        }
        const linkedUserId = current.get("userId");
        // Their identity, once they have an account. The email is how they
        // sign in, and a studio must not be able to change it out from under
        // them.
        const identityChanged =
          parsed.input.name !== current.get("name") ||
          parsed.input.email !== current.get("email");
        if (linkedUserId && identityChanged) {
          throw new Error("CREW_IDENTITY_OWNED_BY_MEMBER");
        }
        await reference.update({
          name: parsed.input.name,
          email: parsed.input.email,
          specialties: parsed.input.specialties,
          serviceAreas: parsed.input.serviceAreas,
          travelRadiusMiles: parsed.input.travelRadiusMiles,
          rateType: parsed.input.rateType,
          rateCents: parsed.input.rateCents,
          notes: parsed.input.notes,
          updatedAt: now,
          updatedBy: identity.uid,
        });
        result = {
          crewProfileId: parsed.input.crewProfileId,
          updated: true,
        };
      } else if (parsed.type === "inviteCrewProfile") {
        if (!internalRoles.has(role)) throw new Error("FORBIDDEN");
        const reference = db.doc(`crewProfiles/${parsed.input.crewProfileId}`);
        const current = await reference.get();
        if (
          !current.exists ||
          current.get("tenantId") !== parsed.tenantId ||
          current.get("archivedAt")
        ) {
          throw new Error("CREW_PROFILE_NOT_FOUND");
        }
        // Already theirs. Re-inviting would mint a token that can only fail
        // the "already used" check on the way back in.
        if (current.get("userId")) throw new Error("CREW_ALREADY_HAS_ACCOUNT");
        const invitation = crewRosterInvitation({
          db,
          profileId: reference.id,
          tenantId: parsed.tenantId,
          email: current.get("email"),
          name: current.get("name"),
          now,
          actorId: identity.uid,
        });
        const resent = db.batch();
        resent.update(reference, {
          ...invitation.profileFields,
          updatedAt: now,
          updatedBy: identity.uid,
        });
        resent.create(invitation.emailJob.reference, invitation.emailJob.value);
        await resent.commit();
        result = {
          crewProfileId: reference.id,
          invited: true,
          inviteExpiresAt: invitation.inviteExpiresAt,
        };
      } else if (parsed.type === "setCrewCompliance") {
        if (!internalRoles.has(role)) throw new Error("FORBIDDEN");
        const reference = db.doc(`crewProfiles/${parsed.input.crewProfileId}`);
        const current = await reference.get();
        if (
          !current.exists ||
          current.get("tenantId") !== parsed.tenantId ||
          current.get("archivedAt")
        ) {
          throw new Error("CREW_PROFILE_NOT_FOUND");
        }
        await reference.update({
          w9Status: parsed.input.w9Status,
          insuranceStatus: parsed.input.insuranceStatus,
          contractStatus: parsed.input.contractStatus,
          updatedAt: now,
          updatedBy: identity.uid,
        });
        result = {
          crewProfileId: parsed.input.crewProfileId,
          w9Status: parsed.input.w9Status,
          insuranceStatus: parsed.input.insuranceStatus,
          contractStatus: parsed.input.contractStatus,
        };
      } else if (parsed.type === "archiveCrewProfile") {
        if (!internalRoles.has(role)) throw new Error("FORBIDDEN");
        const reference = db.doc(`crewProfiles/${parsed.input.crewProfileId}`);
        const current = await reference.get();
        if (
          !current.exists ||
          current.get("tenantId") !== parsed.tenantId
        ) {
          throw new Error("CREW_PROFILE_NOT_FOUND");
        }
        if (!parsed.input.restore) {
          const open = await db
            .collection("crewAssignments")
            .where("tenantId", "==", parsed.tenantId)
            .where("crewProfileId", "==", parsed.input.crewProfileId)
            .where("archivedAt", "==", null)
            .limit(20)
            .get();
          const settled = ["declined", "withdrawn", "completed", "closed"];
          if (
            open.docs.some(
              (assignment) =>
                !settled.includes(String(assignment.get("status"))),
            )
          ) {
            throw new Error("CREW_HAS_OPEN_ASSIGNMENT");
          }
        }
        /**
         * Give the seat back.
         *
         * `activeSubcontractorCount` was incremented when they accepted an
         * invitation and decremented nowhere, so it counted everyone who had
         * ever joined rather than everyone currently on the roster. With
         * `maxActiveSubcontractors` null on every plan that was invisible;
         * the moment any plan carries a number it becomes a ratchet, and a
         * studio is refused new crew because of people who left years ago.
         *
         * Only a linked profile ever took a seat — an invited-but-never-
         * accepted row was never counted, so archiving one must not refund
         * what it did not spend. Clamped at zero because the count predates
         * this and may already be wrong in either direction.
         */
        if (current.get("userId")) {
          const subscriptionReference = db.doc(
            `subscriptions/${parsed.tenantId}`,
          );
          const subscription = await subscriptionReference.get();
          if (subscription.exists) {
            const seats = Number(
              subscription.get("activeSubcontractorCount") ?? 0,
            );
            const alreadyArchived = Boolean(current.get("archivedAt"));
            // Archiving twice must not refund twice, and restoring something
            // already active must not charge twice.
            const change = parsed.input.restore
              ? alreadyArchived
                ? 1
                : 0
              : alreadyArchived
                ? 0
                : -1;
            if (change !== 0) {
              await subscriptionReference.update({
                activeSubcontractorCount: Math.max(0, seats + change),
                updatedAt: now,
                updatedBy: identity.uid,
              });
            }
          }
        }
        await reference.update({
          archivedAt: parsed.input.restore ? null : now,
          active: parsed.input.restore,
          updatedAt: now,
          updatedBy: identity.uid,
        });
        result = {
          crewProfileId: parsed.input.crewProfileId,
          archived: !parsed.input.restore,
        };
      } else if (parsed.type === "createCrewPlan") {
        if (!internalRoles.has(role) || !hasProject(parsed.input.projectId))
          throw new Error("FORBIDDEN");
        if (
          parsed.input.cascades.some(
            (cascade) => cascade.projectId !== parsed.input.projectId,
          )
        )
          throw new Error("CREW_PLAN_PROJECT_MISMATCH");
        const candidateIds = parsed.input.cascades.flatMap(
          (cascade) => cascade.candidateIds,
        );
        if (new Set(candidateIds).size !== candidateIds.length)
          throw new Error("CREW_PLAN_CANDIDATES_MUST_BE_UNIQUE");
        if (
          parsed.input.cascades.some(
            (cascade) =>
              Date.parse(cascade.departureAt) <= Date.parse(cascade.arrivalAt),
          )
        )
          throw new Error("INVALID_ASSIGNMENT_RANGE");
        const profiles = await Promise.all(
          candidateIds.map((profileId) =>
            db.doc(`crewProfiles/${profileId}`).get(),
          ),
        );
        if (
          profiles.some(
            (profile) =>
              !profile.exists ||
              profile.get("tenantId") !== parsed.tenantId ||
              profile.get("active") !== true,
          )
        )
          throw new Error("CASCADE_CANDIDATE_INVALID");
        const conflicts = await db
          .collection("crewAssignments")
          .where("tenantId", "==", parsed.tenantId)
          .where("status", "==", "accepted")
          .get();
        for (const cascade of parsed.input.cascades) {
          const hasConflict = (profileId: string) =>
            conflicts.docs.some(
              (assignment) =>
                assignment.get("crewProfileId") === profileId &&
                Date.parse(String(assignment.get("arrivalAt"))) <
                  Date.parse(cascade.departureAt) &&
                Date.parse(String(assignment.get("departureAt"))) >
                  Date.parse(cascade.arrivalAt),
            );
          if (cascade.candidateIds.some(hasConflict))
            throw new Error("CASCADE_CANDIDATE_HAS_ACCEPTED_CONFLICT");
        }

        const batch = db.batch();
        const cascadeResults: Array<Record<string, unknown>> = [];
        const planId = stable(
          "crew_plan",
          parsed.tenantId,
          parsed.idempotencyKey,
        );
        for (const [index, cascade] of parsed.input.cascades.entries()) {
          const cascadeId = `${planId}_role_${index + 1}`;
          const assignmentId = `${cascadeId}_offer_1`;
          const token = randomBytes(32).toString("base64url");
          const cascadeRecord = {
            id: cascadeId,
            tenantId: parsed.tenantId,
            ...cascade,
            crewPlanId: planId,
            status: "active",
            currentCandidateIndex: 0,
            currentAssignmentId: assignmentId,
            acceptedAssignmentId: null,
            handlingStartedAt: now,
            handlingCompletedAt: null,
            escalatedAt: null,
            createdAt: now,
            updatedAt: now,
            createdBy: identity.uid,
            updatedBy: identity.uid,
            archivedAt: null,
          };
          const profile = profiles.find(
            (candidate) => candidate.id === cascade.candidateIds[0],
          )!;
          const prepared = cascadeAssignment({
            id: assignmentId,
            tenantId: parsed.tenantId,
            cascadeId,
            candidateIndex: 0,
            profile,
            cascade: cascadeRecord,
            token,
            now,
            actorId: identity.uid,
          });
          batch.create(db.doc(`crewCascades/${cascadeId}`), {
            ...cascadeRecord,
            currentOfferExpiresAt: prepared.expiresAt,
          });
          batch.create(
            db.doc(`crewAssignments/${assignmentId}`),
            prepared.assignment,
          );
          batch.create(
            db.doc(`emailJobs/${prepared.emailJob.id}`),
            prepared.emailJob,
          );
          cascadeResults.push({
            cascadeId,
            assignmentId,
            role: cascade.role,
            currentOfferExpiresAt: prepared.expiresAt,
          });
        }
        batch.create(db.doc(`aiActions/ai_crew_plan_${planId}`), {
          id: `ai_crew_plan_${planId}`,
          tenantId: parsed.tenantId,
          projectId: parsed.input.projectId,
          actorId: identity.uid,
          title: "Multi-role crew plan approved",
          capability: "crew_recommendation",
          authorityBoundary: "human_approval_required",
          status: "approved",
          modelProvider: "studiocue_eligibility_engine",
          modelVersion: "crew-ranking-v2",
          instructionVersion: "crew-ranking-v2",
          outputSchemaVersion: "crew-plan-v1",
          sourceReferences: profiles.map((profile) => ({
            entityType: "crew_profile",
            entityId: profile.id,
            versionId: null,
            label: String(profile.get("name") ?? profile.id),
            locator: "owner-approved unique candidate allocation",
          })),
          structuredOutput: {
            roles: parsed.input.cascades.map((cascade) => ({
              role: cascade.role,
              orderedCandidateIds: cascade.candidateIds,
              responseWindowHours: cascade.responseWindowHours,
            })),
          },
          confidence: { overall: 1, label: "high", uncertainFields: [] },
          validation: { status: "passed", issues: [] },
          decision: {
            actorId: identity.uid,
            action: "approved",
            decidedAt: now,
            note: "Owner approved all role orders in one decision.",
            editDelta: null,
          },
          downstreamCommand: {
            commandType: "create_crew_plan",
            commandId: planId,
            executedAt: now,
          },
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            estimatedCostMicros: 0,
            latencyMs: 0,
            estimatedMinutesSaved: 60,
          },
          failure: null,
          createdAt: now,
          updatedAt: now,
          createdBy: identity.uid,
          updatedBy: identity.uid,
          archivedAt: null,
        });
        await batch.commit();
        result = {
          crewPlanId: planId,
          status: "active",
          cascades: cascadeResults,
        };
      } else if (parsed.type === "createCrewCascade") {
        if (!internalRoles.has(role) || !hasProject(parsed.input.projectId))
          throw new Error("FORBIDDEN");
        if (
          Date.parse(parsed.input.departureAt) <=
          Date.parse(parsed.input.arrivalAt)
        )
          throw new Error("INVALID_ASSIGNMENT_RANGE");
        if (new Set(parsed.input.candidateIds).size !== parsed.input.candidateIds.length)
          throw new Error("DUPLICATE_CASCADE_CANDIDATE");
        const profiles = await Promise.all(
          parsed.input.candidateIds.map((profileId) =>
            db.doc(`crewProfiles/${profileId}`).get(),
          ),
        );
        if (
          profiles.some(
            (profile) =>
              !profile.exists ||
              profile.get("tenantId") !== parsed.tenantId ||
              profile.get("active") !== true,
          )
        )
          throw new Error("CASCADE_CANDIDATE_INVALID");
        const conflicts = await db
          .collection("crewAssignments")
          .where("tenantId", "==", parsed.tenantId)
          .where("status", "==", "accepted")
          .get();
        const hasConflict = (profileId: string) =>
          conflicts.docs.some(
            (assignment) =>
              assignment.get("crewProfileId") === profileId &&
              Date.parse(String(assignment.get("arrivalAt"))) <
                Date.parse(parsed.input.departureAt) &&
              Date.parse(String(assignment.get("departureAt"))) >
                Date.parse(parsed.input.arrivalAt),
          );
        if (parsed.input.candidateIds.some(hasConflict))
          throw new Error("CASCADE_CANDIDATE_HAS_ACCEPTED_CONFLICT");

        const cascadeId = stable(
          "crew_cascade",
          parsed.tenantId,
          parsed.idempotencyKey,
        );
        const assignmentId = `${cascadeId}_offer_1`;
        const token = randomBytes(32).toString("base64url");
        const cascadeRecord = {
          id: cascadeId,
          tenantId: parsed.tenantId,
          ...parsed.input,
          status: "active",
          currentCandidateIndex: 0,
          currentAssignmentId: assignmentId,
          acceptedAssignmentId: null,
          handlingStartedAt: now,
          handlingCompletedAt: null,
          escalatedAt: null,
          createdAt: now,
          updatedAt: now,
          createdBy: identity.uid,
          updatedBy: identity.uid,
          archivedAt: null,
        };
        const prepared = cascadeAssignment({
          id: assignmentId,
          tenantId: parsed.tenantId,
          cascadeId,
          candidateIndex: 0,
          profile: profiles[0]!,
          cascade: cascadeRecord,
          token,
          now,
          actorId: identity.uid,
        });
        const batch = db.batch();
        batch.create(db.doc(`crewCascades/${cascadeId}`), {
          ...cascadeRecord,
          currentOfferExpiresAt: prepared.expiresAt,
        });
        batch.create(
          db.doc(`crewAssignments/${assignmentId}`),
          prepared.assignment,
        );
        batch.create(
          db.doc(`emailJobs/${prepared.emailJob.id}`),
          prepared.emailJob,
        );
        batch.create(db.doc(`aiActions/ai_crew_${cascadeId}`), {
          id: `ai_crew_${cascadeId}`,
          tenantId: parsed.tenantId,
          projectId: parsed.input.projectId,
          actorId: identity.uid,
          title: "Crew recommendation approved for cascade",
          capability: "crew_recommendation",
          authorityBoundary: "human_approval_required",
          status: "approved",
          modelProvider: "studiocue_eligibility_engine",
          modelVersion: "crew-ranking-v1",
          instructionVersion: "crew-ranking-v1",
          outputSchemaVersion: "crew-ranking-v1",
          sourceReferences: parsed.input.candidateIds.map((candidateId) => ({
            entityType: "crew_profile",
            entityId: candidateId,
            versionId: null,
            label: String(
              profiles.find((profile) => profile.id === candidateId)?.get(
                "name",
              ) ?? candidateId,
            ),
            locator: "owner-ranked candidate order",
          })),
          structuredOutput: {
            role: parsed.input.role,
            orderedCandidateIds: parsed.input.candidateIds,
            responseWindowHours: parsed.input.responseWindowHours,
          },
          confidence: {
            overall: 1,
            label: "high",
            uncertainFields: [],
          },
          validation: { status: "passed", issues: [] },
          decision: {
            actorId: identity.uid,
            action: "approved",
            decidedAt: now,
            note: "Owner confirmed the candidate order before release.",
            editDelta: null,
          },
          downstreamCommand: {
            commandType: "create_crew_cascade",
            commandId: cascadeId,
            executedAt: now,
          },
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            estimatedCostMicros: 0,
            latencyMs: 0,
            estimatedMinutesSaved: 45,
          },
          failure: null,
          createdAt: now,
          updatedAt: now,
          createdBy: identity.uid,
          updatedBy: identity.uid,
          archivedAt: null,
        });
        await batch.commit();
        result = {
          cascadeId,
          assignmentId,
          status: "active",
          currentCandidateIndex: 0,
          currentOfferExpiresAt: prepared.expiresAt,
        };
      } else if (parsed.type === "inviteAssignment") {
        if (!internalRoles.has(role) || !hasProject(parsed.input.projectId))
          throw new Error("FORBIDDEN");
        const profile = await db
          .doc(`crewProfiles/${parsed.input.crewProfileId}`)
          .get();
        if (!profile.exists || profile.get("tenantId") !== parsed.tenantId)
          throw new Error("CREW_PROFILE_NOT_FOUND");
        const id = stable(
          "crew_assignment",
          parsed.tenantId,
          parsed.idempotencyKey,
        );
        const inviteToken = randomBytes(32).toString("base64url");
        const inviteExpiresAt = new Date(
          Date.now() + 7 * 86400000,
        ).toISOString();
        const inviteUrl = `${appUrl()}/auth/crew-invite?token=${encodeURIComponent(inviteToken)}`;
        const batch = db.batch();
        batch.create(db.doc(`crewAssignments/${id}`), {
          id,
          tenantId: parsed.tenantId,
          projectId: parsed.input.projectId,
          crewProfileId: parsed.input.crewProfileId,
          userId: parsed.input.userId,
          role: parsed.input.role,
          compensationCents: parsed.input.compensationCents,
          compensationType: parsed.input.compensationType,
          currency: parsed.input.currency,
          compensationVisibleToCrew: parsed.input.compensationVisibleToCrew,
          arrivalAt: parsed.input.arrivalAt,
          departureAt: parsed.input.departureAt,
          locations: parsed.input.locations,
          responsibilities: parsed.input.responsibilities,
          scheduleItemIds: parsed.input.scheduleItemIds,
          notes: null,
          status: "invited",
          invitationSentAt: now,
          viewedAt: null,
          respondedAt: null,
          calendarStatus: "not_added",
          calendarAcknowledgedAt: null,
          currentScheduleId: parsed.input.currentScheduleId,
          currentScheduleVersion: parsed.input.currentScheduleVersion,
          acknowledgedScheduleVersion: null,
          scheduleAcknowledgedAt: null,
          requirements: parsed.input.requirements.map((item) => ({
            ...item,
            status: "missing",
            documentId: null,
            completedAt: null,
            completedBy: null,
            notes: null,
          })),
          inviteTokenHash: hash(inviteToken),
          inviteExpiresAt,
          createdAt: now,
          updatedAt: now,
          createdBy: identity.uid,
          updatedBy: identity.uid,
          archivedAt: null,
        });
        batch.create(db.doc(`emailJobs/crew_invite_${id}`), {
          tenantId: parsed.tenantId,
          projectId: parsed.input.projectId,
          type: "crew_invitation",
          assignmentId: id,
          recipient: profile.get("email"),
          recipientName: profile.get("name"),
          inviteToken,
          inviteUrl,
          ...crewInvitationEmailFields({
            role: parsed.input.role,
            arrivalAt: parsed.input.arrivalAt,
            departureAt: parsed.input.departureAt,
            respondBy: inviteExpiresAt,
            locations: parsed.input.locations,
            responsibilities: parsed.input.responsibilities,
            compensationCents: parsed.input.compensationCents,
            compensationType: parsed.input.compensationType,
            compensationVisibleToCrew: parsed.input.compensationVisibleToCrew,
            currency: parsed.input.currency,
          }),
          status: "queued",
          attempts: 0,
          createdAt: now,
          updatedAt: now,
        });
        await batch.commit();
        result = {
          assignmentId: id,
          status: "invited",
          inviteExpiresAt,
          inviteUrl,
        };
      } else if (parsed.type === "setAvailability") {
        const profile = await db
          .doc(`crewProfiles/${parsed.input.crewProfileId}`)
          .get();
        if (
          !profile.exists ||
          profile.get("tenantId") !== parsed.tenantId ||
          profile.get("userId") !== identity.uid ||
          role !== "subcontractor"
        ) {
          throw new Error("FORBIDDEN");
        }
        if (
          Date.parse(parsed.input.endsAt) <= Date.parse(parsed.input.startsAt)
        ) {
          throw new Error("INVALID_AVAILABILITY_RANGE");
        }
        const id = stable(
          "crew_availability",
          parsed.tenantId,
          parsed.idempotencyKey,
        );
        await db.doc(`crewAvailability/${id}`).create({
          id,
          tenantId: parsed.tenantId,
          crewProfileId: parsed.input.crewProfileId,
          userId: identity.uid,
          startsAt: parsed.input.startsAt,
          endsAt: parsed.input.endsAt,
          status: parsed.input.status,
          notes: parsed.input.notes,
          createdAt: now,
          updatedAt: now,
          createdBy: identity.uid,
          updatedBy: identity.uid,
          archivedAt: null,
        });
        result = { availabilityId: id, status: parsed.input.status };
      } else if (
        parsed.type === "updateAvailability" ||
        parsed.type === "deleteAvailability"
      ) {
        const reference = db.doc(
          `crewAvailability/${parsed.input.availabilityId}`,
        );
        const current = await reference.get();
        if (
          !current.exists ||
          current.get("tenantId") !== parsed.tenantId ||
          current.get("userId") !== identity.uid ||
          role !== "subcontractor"
        ) {
          throw new Error("FORBIDDEN");
        }
        if (parsed.type === "deleteAvailability") {
          await reference.update({
            archivedAt: now,
            updatedAt: now,
            updatedBy: identity.uid,
          });
          result = { availabilityId: reference.id, status: "deleted" };
        } else {
          if (Date.parse(parsed.input.endsAt) <= Date.parse(parsed.input.startsAt))
            throw new Error("INVALID_AVAILABILITY_RANGE");
          await reference.update({
            startsAt: parsed.input.startsAt,
            endsAt: parsed.input.endsAt,
            status: parsed.input.status,
            notes: parsed.input.notes,
            updatedAt: now,
            updatedBy: identity.uid,
          });
          result = { availabilityId: reference.id, status: parsed.input.status };
        }
      } else if (parsed.type === "updateCrewProfile") {
        const reference = db.doc(`crewProfiles/${parsed.input.crewProfileId}`);
        const current = await reference.get();
        if (
          !current.exists ||
          current.get("tenantId") !== parsed.tenantId ||
          current.get("userId") !== identity.uid ||
          role !== "subcontractor"
        ) {
          throw new Error("FORBIDDEN");
        }
        await reference.update({
          phone: parsed.input.phone,
          specialties: parsed.input.specialties,
          serviceAreas: parsed.input.serviceAreas,
          travelRadiusMiles: parsed.input.travelRadiusMiles,
          equipment: parsed.input.equipment,
          emergencyContact: parsed.input.emergencyContact,
          updatedAt: now,
          updatedBy: identity.uid,
        });
        result = { crewProfileId: reference.id, status: "updated" };
      } else {
        if (!hasProject(parsed.input.projectId)) throw new Error("FORBIDDEN");
        const reference = db.doc(
          `crewAssignments/${parsed.input.assignmentId}`,
        );
        await db.runTransaction(async (transaction) => {
          const current = await transaction.get(reference);
          if (
            !current.exists ||
            current.get("tenantId") !== parsed.tenantId ||
            current.get("projectId") !== parsed.input.projectId
          ) {
            throw new Error("ASSIGNMENT_NOT_FOUND");
          }
          const ownsAssignment = current.get("userId") === identity.uid;
          const internal = internalRoles.has(role);
          if (!internal && !ownsAssignment) throw new Error("FORBIDDEN");
          if (parsed.type === "respondAssignment") {
            if (
              !ownsAssignment ||
              !["invited", "viewed"].includes(String(current.get("status")))
            )
              throw new Error("ASSIGNMENT_NOT_RESPONDABLE");
            if (
              Date.parse(String(current.get("inviteExpiresAt"))) <=
              Date.parse(now)
            )
              throw new Error("ASSIGNMENT_OFFER_EXPIRED");
            const cascadeId = String(current.get("cascadeId") ?? "");
            if (!cascadeId) {
              transaction.update(reference, {
                status: parsed.input.decision,
                respondedAt: now,
                calendarStatus:
                  parsed.input.decision === "declined"
                    ? "declined"
                    : "not_added",
                updatedAt: now,
                updatedBy: identity.uid,
              });
            } else {
              const cascadeReference = db.doc(`crewCascades/${cascadeId}`);
              const cascade = await transaction.get(cascadeReference);
              if (
                !cascade.exists ||
                cascade.get("status") !== "active" ||
                cascade.get("currentAssignmentId") !== reference.id
              )
                throw new Error("CASCADE_OFFER_IS_NOT_CURRENT");
              if (parsed.input.decision === "accepted") {
                const currentScheduleId = String(
                  current.get("currentScheduleId") ?? "",
                );
                const currentSchedule = currentScheduleId
                  ? await transaction.get(
                      db.doc(`schedules/${currentScheduleId}`),
                    )
                  : null;
                transaction.update(reference, {
                  status: "accepted",
                  respondedAt: now,
                  calendarStatus: "not_added",
                  updatedAt: now,
                  updatedBy: identity.uid,
                });
                transaction.update(cascadeReference, {
                  status: "filled",
                  acceptedAssignmentId: reference.id,
                  handlingCompletedAt: now,
                  currentOfferExpiresAt: null,
                  updatedAt: now,
                  updatedBy: identity.uid,
                });
                const handlingStartedAt = String(
                  cascade.get("handlingStartedAt") ?? "",
                );
                const activeSeconds = Math.max(
                  0,
                  Math.round(
                    (Date.parse(now) - Date.parse(handlingStartedAt)) / 1000,
                  ) || 0,
                );
                const event = productEvent({
                  tenantId: parsed.tenantId,
                  projectId: parsed.input.projectId,
                  actorId: identity.uid,
                  actorType: "subcontractor",
                  name: "lifecycle.crew_staffed",
                  occurredAt: now,
                  correlationId: parsed.idempotencyKey,
                  sourceEntityType: "crewCascade",
                  sourceEntityId: cascadeId,
                  properties: {
                    assignmentId: reference.id,
                    candidateIndex: cascade.get("currentCandidateIndex"),
                    role: cascade.get("role"),
                  },
                  handling: {
                    activeSeconds,
                    baselineSeconds: null,
                    verifiedSecondsSaved: null,
                    measurementMethod: "workflow_timestamps",
                  },
                });
                transaction.create(
                  db.doc(`productEvents/${event.id}`),
                  event,
                );
                transaction.set(
                  db.doc(`crewCalendarEvents/${reference.id}`),
                  {
                    id: reference.id,
                    tenantId: parsed.tenantId,
                    projectId: parsed.input.projectId,
                    assignmentId: reference.id,
                    crewProfileId: current.get("crewProfileId"),
                    userId: identity.uid,
                    title: `${String(
                      cascade.get("role"),
                    )} · photography assignment`,
                    startsAt: current.get("arrivalAt"),
                    endsAt: current.get("departureAt"),
                    locations: current.get("locations"),
                    currentScheduleId: current.get("currentScheduleId"),
                    status: "ready",
                    externalCalendarAuthority: "crew_download_or_provider",
                    createdAt: now,
                    updatedAt: now,
                  },
                  { merge: false },
                );
                // Close the loop: queue the Google Calendar invite for the
                // accepted crew member. Mock connections resolve locally.
                transaction.set(
                  db.doc(`providerJobs/crew_calendar_${reference.id}`),
                  {
                    id: `crew_calendar_${reference.id}`,
                    tenantId: parsed.tenantId,
                    projectId: parsed.input.projectId,
                    assignmentId: reference.id,
                    type: "add_crew_calendar_invite",
                    idempotencyKey: `crew_calendar_${reference.id}`,
                    status: "queued",
                    attempts: 0,
                    createdAt: now,
                    updatedAt: now,
                  },
                  { merge: true },
                );
                if (
                  currentSchedule?.exists &&
                  currentSchedule.get("tenantId") === parsed.tenantId &&
                  currentSchedule.get("projectId") === parsed.input.projectId
                ) {
                  const allowedIds = Array.isArray(
                    current.get("scheduleItemIds"),
                  )
                    ? new Set(
                        (current.get("scheduleItemIds") as unknown[]).map(
                          String,
                        ),
                      )
                    : new Set<string>();
                  const scopedItems = Array.isArray(
                    currentSchedule.get("items"),
                  )
                    ? (
                        currentSchedule.get("items") as Array<
                          Record<string, unknown>
                        >
                      ).filter(
                        (item) =>
                          ["crew", "shared"].includes(
                            String(item.visibility),
                          ) &&
                          (allowedIds.size === 0 ||
                            allowedIds.has(String(item.id))),
                      )
                    : [];
                  transaction.set(
                    db.doc(
                      `crewScheduleViews/${currentScheduleId}_${reference.id}`,
                    ),
                    {
                      id: `${currentScheduleId}_${reference.id}`,
                      tenantId: parsed.tenantId,
                      projectId: parsed.input.projectId,
                      assignmentId: reference.id,
                      userId: identity.uid,
                      crewProfileId: current.get("crewProfileId"),
                      sourceScheduleId: currentScheduleId,
                      version: currentSchedule.get("version"),
                      status: "published",
                      timezone: currentSchedule.get("timezone"),
                      items: scopedItems,
                      publishedAt: currentSchedule.get("publishedAt"),
                      createdAt: now,
                      updatedAt: now,
                    },
                    { merge: false },
                  );
                }
              } else {
                const candidateIds = Array.isArray(
                  cascade.get("candidateIds"),
                )
                  ? (cascade.get("candidateIds") as unknown[]).map(String)
                  : [];
                const nextIndex =
                  Number(cascade.get("currentCandidateIndex") ?? 0) + 1;
                const nextCandidateId = candidateIds[nextIndex];
                const nextProfile = nextCandidateId
                  ? await transaction.get(
                      db.doc(`crewProfiles/${nextCandidateId}`),
                    )
                  : null;
                transaction.update(reference, {
                  status: "declined",
                  respondedAt: now,
                  calendarStatus: "declined",
                  updatedAt: now,
                  updatedBy: identity.uid,
                });
                if (
                  nextCandidateId &&
                  nextProfile?.exists &&
                  nextProfile.get("tenantId") === parsed.tenantId &&
                  nextProfile.get("active") === true
                ) {
                  const nextAssignmentId = `${cascadeId}_offer_${nextIndex + 1}`;
                  const nextToken = randomBytes(32).toString("base64url");
                  const prepared = cascadeAssignment({
                    id: nextAssignmentId,
                    tenantId: parsed.tenantId,
                    cascadeId,
                    candidateIndex: nextIndex,
                    profile: nextProfile,
                    cascade: cascade.data() ?? {},
                    token: nextToken,
                    now,
                    actorId: identity.uid,
                  });
                  transaction.create(
                    db.doc(`crewAssignments/${nextAssignmentId}`),
                    prepared.assignment,
                  );
                  transaction.create(
                    db.doc(`emailJobs/${prepared.emailJob.id}`),
                    prepared.emailJob,
                  );
                  transaction.update(cascadeReference, {
                    currentCandidateIndex: nextIndex,
                    currentAssignmentId: nextAssignmentId,
                    currentOfferExpiresAt: prepared.expiresAt,
                    updatedAt: now,
                    updatedBy: identity.uid,
                  });
                } else {
                  transaction.update(cascadeReference, {
                    status: "exhausted",
                    currentOfferExpiresAt: null,
                    handlingCompletedAt: now,
                    escalatedAt: now,
                    updatedAt: now,
                    updatedBy: identity.uid,
                  });
                  transaction.set(
                    db.doc(`notifications/crew_cascade_${cascadeId}`),
                    {
                      id: `crew_cascade_${cascadeId}`,
                      tenantId: parsed.tenantId,
                      projectId: parsed.input.projectId,
                      audience: ["studio_owner", "studio_admin"],
                      title: "Crew role remains unfilled",
                      body: `${String(
                        cascade.get("role"),
                      )} exhausted every approved candidate.`,
                      severity: "warning",
                      href: `/studio/crew?project=${encodeURIComponent(
                        parsed.input.projectId,
                      )}`,
                      readBy: [],
                      createdAt: now,
                      updatedAt: now,
                    },
                    { merge: true },
                  );
                }
              }
            }
          } else if (parsed.type === "acknowledgeCalendar") {
            if (!ownsAssignment || current.get("status") !== "accepted")
              throw new Error("ASSIGNMENT_NOT_ACCEPTED");
            transaction.update(reference, {
              calendarStatus: "added",
              calendarAcknowledgedAt: now,
              updatedAt: now,
              updatedBy: identity.uid,
            });
          } else if (parsed.type === "acknowledgeSchedule") {
            if (
              !ownsAssignment ||
              current.get("status") !== "accepted" ||
              current.get("currentScheduleId") !== parsed.input.scheduleId ||
              current.get("currentScheduleVersion") !==
                parsed.input.scheduleVersion
            ) {
              throw new Error("SCHEDULE_VERSION_IS_NOT_CURRENT");
            }
            transaction.update(reference, {
              acknowledgedScheduleVersion: parsed.input.scheduleVersion,
              scheduleAcknowledgedAt: now,
              updatedAt: now,
              updatedBy: identity.uid,
            });
          } else if (parsed.type === "completeAssignment") {
            if (!internal || current.get("status") !== "accepted")
              throw new Error("ASSIGNMENT_NOT_COMPLETABLE");
            const requirements = Array.isArray(current.get("requirements"))
              ? (current.get("requirements") as Array<
                  Record<string, unknown>
                >)
              : [];
            if (
              requirements.some(
                (item) =>
                  item.required === true &&
                  !["complete", "waived"].includes(String(item.status)),
              )
            )
              throw new Error("ASSIGNMENT_REQUIREMENTS_INCOMPLETE");
            transaction.update(reference, {
              status: "completed",
              completedAt: now,
              completedBy: identity.uid,
              updatedAt: now,
              updatedBy: identity.uid,
            });
          } else if (parsed.type === "reviewAssignmentCloseout") {
            if (!internal) throw new Error("FORBIDDEN");
            const closeout = current.get("closeout") as
              | Record<string, unknown>
              | undefined;
            if (!closeout || closeout.status !== "submitted")
              throw new Error("CLOSEOUT_NOT_READY_FOR_REVIEW");
            transaction.update(reference, {
              closeout: {
                ...closeout,
                status: parsed.input.decision,
                reviewerNote: parsed.input.reviewerNote,
                reviewedAt: now,
                reviewedBy: identity.uid,
              },
              updatedAt: now,
              updatedBy: identity.uid,
            });
          } else if (parsed.type === "updateAssignmentPayment") {
            if (!internal) throw new Error("FORBIDDEN");
            const closeout = current.get("closeout") as
              | Record<string, unknown>
              | undefined;
            if (!closeout || closeout.status !== "approved")
              throw new Error("APPROVE_CLOSEOUT_BEFORE_PAYMENT");
            transaction.update(reference, {
              payment: {
                status: parsed.input.status,
                expectedAt: parsed.input.expectedAt,
                reference: parsed.input.reference,
                paidAt: parsed.input.status === "paid" ? now : null,
                updatedAt: now,
                updatedBy: identity.uid,
              },
              closeout: parsed.input.status === "paid"
                ? { ...closeout, status: "paid" }
                : closeout,
              updatedAt: now,
              updatedBy: identity.uid,
            });
          } else if (parsed.type === "submitRequirement") {
            if (!ownsAssignment) throw new Error("FORBIDDEN");
            const requirements = current.get("requirements") as Array<
              Record<string, unknown>
            >;
            if (
              !requirements.some(
                (item) => item.id === parsed.input.requirementId,
              )
            ) {
              throw new Error("REQUIREMENT_NOT_FOUND");
            }
            transaction.update(reference, {
              requirements: requirements.map((item) =>
                item.id === parsed.input.requirementId
                  ? {
                      ...item,
                      status: "submitted",
                      documentId: parsed.input.documentId,
                      completedAt: null,
                      completedBy: null,
                    }
                  : item,
              ),
              updatedAt: now,
              updatedBy: identity.uid,
            });
          } else if (parsed.type === "submitAssignmentCloseout") {
            if (
              !ownsAssignment ||
              !["accepted", "completed"].includes(String(current.get("status")))
            )
              throw new Error("ASSIGNMENT_NOT_READY_FOR_CLOSEOUT");
            if (Date.parse(parsed.input.actualEndsAt) <= Date.parse(parsed.input.actualStartsAt))
              throw new Error("INVALID_CLOSEOUT_RANGE");
            transaction.update(reference, {
              closeout: {
                status: "submitted",
                actualStartsAt: parsed.input.actualStartsAt,
                actualEndsAt: parsed.input.actualEndsAt,
                extraMinutes: parsed.input.extraMinutes,
                expenses: parsed.input.expenses,
                deliverables: parsed.input.deliverables,
                notes: parsed.input.notes,
                submittedAt: now,
                submittedBy: identity.uid,
                reviewedAt: null,
                reviewedBy: null,
              },
              updatedAt: now,
              updatedBy: identity.uid,
            });
            transaction.set(
              db.doc(`notifications/crew_closeout_${reference.id}`),
              {
                id: `crew_closeout_${reference.id}`,
                tenantId: parsed.tenantId,
                projectId: parsed.input.projectId,
                audience: ["studio_owner", "studio_admin", "studio_coordinator"],
                title: "Crew closeout submitted",
                body: `${String(current.get("role") ?? "Crew")} submitted hours, expenses, and deliverables for review.`,
                severity: "info",
                href: `/studio/crew/${reference.id}`,
                readBy: [],
                createdAt: now,
                updatedAt: now,
              },
              { merge: true },
            );
          } else if (parsed.type === "contactStudio") {
            if (!ownsAssignment && !internal) throw new Error("FORBIDDEN");
            const messageId = stable("crew_message", parsed.tenantId, parsed.idempotencyKey);
            const crewToStudio = ownsAssignment;
            transaction.create(db.doc(`crewMessages/${messageId}`), {
              id: messageId,
              tenantId: parsed.tenantId,
              projectId: parsed.input.projectId,
              assignmentId: reference.id,
              userId: current.get("userId"),
              actorId: identity.uid,
              direction: crewToStudio ? "crew_to_studio" : "studio_to_crew",
              subject: parsed.input.subject,
              message: parsed.input.message,
              urgency: parsed.input.urgency,
              status: "sent",
              createdAt: now,
              updatedAt: now,
            });
            transaction.set(
              db.doc(`notifications/crew_message_${messageId}`),
              {
                id: `crew_message_${messageId}`,
                tenantId: parsed.tenantId,
                projectId: parsed.input.projectId,
                audience: crewToStudio
                  ? ["studio_owner", "studio_admin", "studio_coordinator"]
                  : ["subcontractor"],
                userIds: crewToStudio ? [] : [current.get("userId")],
                title: crewToStudio
                  ? parsed.input.urgency === "event_day" ? "Urgent crew message" : "Crew message"
                  : "Studio replied to your crew message",
                body: parsed.input.subject,
                severity: parsed.input.urgency === "event_day" ? "warning" : "info",
                href: crewToStudio
                  ? `/studio/crew/${reference.id}`
                  : `/crew/jobs?assignment=${encodeURIComponent(reference.id)}`,
                readBy: [],
                createdAt: now,
                updatedAt: now,
              },
              { merge: true },
            );
          } else {
            const requirements = current.get("requirements") as Array<
              Record<string, unknown>
            >;
            const target = requirements.find(
              (item) => item.id === parsed.input.requirementId,
            );
            if (!target) throw new Error("REQUIREMENT_NOT_FOUND");
            if (parsed.type === "waiveRequirement") {
              if (!internal) throw new Error("FORBIDDEN");
              transaction.update(reference, {
                requirements: requirements.map((item) =>
                  item.id === parsed.input.requirementId
                    ? {
                        ...item,
                        status: "waived",
                        notes: parsed.input.reason,
                        completedAt: now,
                        completedBy: identity.uid,
                      }
                    : item,
                ),
                updatedAt: now,
                updatedBy: identity.uid,
              });
              return;
            }
            if (
              !internal &&
              !["equipment", "acknowledgement"].includes(String(target.kind))
            )
              throw new Error("REQUIREMENT_REQUIRES_STUDIO_REVIEW");
            transaction.update(reference, {
              requirements: requirements.map((item) =>
                item.id === parsed.input.requirementId
                  ? {
                      ...item,
                      status: "complete",
                      documentId: parsed.input.documentId,
                      completedAt: now,
                      completedBy: identity.uid,
                    }
                  : item,
              ),
              updatedAt: now,
              updatedBy: identity.uid,
            });
          }
        });
        result =
          parsed.type === "respondAssignment"
            ? {
                assignmentId: parsed.input.assignmentId,
                status: parsed.input.decision,
              }
            : { assignmentId: parsed.input.assignmentId, completed: true };
      }

      const auditId = stable("audit", parsed.tenantId, parsed.idempotencyKey);
      await db.doc(`auditEvents/${auditId}`).create({
        id: auditId,
        tenantId: parsed.tenantId,
        projectId: "projectId" in parsed.input ? parsed.input.projectId : null,
        actorId: identity.uid,
        actorType: "user",
        action: `crew.${parsed.type}`,
        // Was `createCrewProfile ? profile : assignment`, so every other
        // profile-scoped command audited itself as an assignment.
        entityType: (
          [
            "createCrewProfile",
            "updateCrewProfile",
            "updateCrewDirectoryEntry",
            "setCrewCompliance",
            "inviteCrewProfile",
            "archiveCrewProfile",
          ] as string[]
        ).includes(parsed.type)
          ? "crewProfile"
          : "crewAssignment",
        entityId: String(result.crewProfileId ?? result.assignmentId ?? ""),
        timestamp: now,
        before: null,
        after: result,
        ipAddress: request.ip ?? null,
        userAgent: request.get("user-agent") ?? null,
        correlationId: parsed.idempotencyKey,
        automationRunId: null,
        providerEventId: null,
      });
      await execution.create({
        tenantId: parsed.tenantId,
        result,
        createdAt: now,
      });
      response.status(200).json(result);
    } catch (caught: unknown) {
      const message =
        caught instanceof Error ? caught.message : "CREW_COMMAND_FAILED";
      response
        .status(message === "FORBIDDEN" ? 403 : 400)
        .json({ error: message });
    }
  },
);

export const crewCascadeExpiryScheduler = onSchedule(
  {
    schedule: "every 15 minutes",
    timeZone: "UTC",
    retryCount: 3,
  },
  async () => {
    const db = getFirestore();
    const now = new Date().toISOString();
    const active = await db
      .collection("crewCascades")
      .where("status", "==", "active")
      .limit(100)
      .get();
    for (const cascadeSnapshot of active.docs) {
      if (
        Date.parse(String(cascadeSnapshot.get("currentOfferExpiresAt"))) >
        Date.parse(now)
      )
        continue;
      await db.runTransaction(async (transaction) => {
        const cascade = await transaction.get(cascadeSnapshot.ref);
        if (
          !cascade.exists ||
          cascade.get("status") !== "active" ||
          Date.parse(String(cascade.get("currentOfferExpiresAt"))) >
            Date.parse(now)
        )
          return;
        const assignmentReference = db.doc(
          `crewAssignments/${String(cascade.get("currentAssignmentId"))}`,
        );
        const assignment = await transaction.get(assignmentReference);
        if (
          !assignment.exists ||
          !["invited", "viewed"].includes(String(assignment.get("status")))
        )
          return;
        const candidateIds = Array.isArray(cascade.get("candidateIds"))
          ? (cascade.get("candidateIds") as unknown[]).map(String)
          : [];
        const nextIndex =
          Number(cascade.get("currentCandidateIndex") ?? 0) + 1;
        const nextCandidateId = candidateIds[nextIndex];
        const nextProfile = nextCandidateId
          ? await transaction.get(db.doc(`crewProfiles/${nextCandidateId}`))
          : null;
        transaction.update(assignmentReference, {
          status: "expired",
          respondedAt: now,
          calendarStatus: "declined",
          updatedAt: now,
          updatedBy: "crew-cascade-expiry",
        });
        if (
          nextCandidateId &&
          nextProfile?.exists &&
          nextProfile.get("tenantId") === cascade.get("tenantId") &&
          nextProfile.get("active") === true
        ) {
          const nextAssignmentId = `${cascade.id}_offer_${nextIndex + 1}`;
          const token = randomBytes(32).toString("base64url");
          const prepared = cascadeAssignment({
            id: nextAssignmentId,
            tenantId: String(cascade.get("tenantId")),
            cascadeId: cascade.id,
            candidateIndex: nextIndex,
            profile: nextProfile,
            cascade: cascade.data() ?? {},
            token,
            now,
            actorId: "crew-cascade-expiry",
          });
          transaction.create(
            db.doc(`crewAssignments/${nextAssignmentId}`),
            prepared.assignment,
          );
          transaction.create(
            db.doc(`emailJobs/${prepared.emailJob.id}`),
            prepared.emailJob,
          );
          transaction.update(cascade.ref, {
            currentCandidateIndex: nextIndex,
            currentAssignmentId: nextAssignmentId,
            currentOfferExpiresAt: prepared.expiresAt,
            updatedAt: now,
            updatedBy: "crew-cascade-expiry",
          });
        } else {
          transaction.update(cascade.ref, {
            status: "exhausted",
            currentOfferExpiresAt: null,
            handlingCompletedAt: now,
            escalatedAt: now,
            updatedAt: now,
            updatedBy: "crew-cascade-expiry",
          });
          transaction.set(
            db.doc(`notifications/crew_cascade_${cascade.id}`),
            {
              id: `crew_cascade_${cascade.id}`,
              tenantId: cascade.get("tenantId"),
              projectId: cascade.get("projectId"),
              audience: ["studio_owner", "studio_admin"],
              title: "Crew role remains unfilled",
              body: `${String(
                cascade.get("role"),
              )} exhausted every approved candidate.`,
              severity: "warning",
              href: `/studio/crew?project=${encodeURIComponent(
                String(cascade.get("projectId")),
              )}`,
              readBy: [],
              createdAt: now,
              updatedAt: now,
            },
            { merge: true },
          );
        }
      });
    }
  },
);
