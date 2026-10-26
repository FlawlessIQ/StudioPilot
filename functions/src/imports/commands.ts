import { createHash, randomBytes, randomUUID } from "node:crypto";
import { signedCopyDocument } from "../contracts/signed-copy-document.js";
import {
  FieldValue,
  getFirestore,
  type DocumentSnapshot,
  type Firestore,
} from "firebase-admin/firestore";
import { z } from "zod";
import { promoteContactTypesToClient } from "../contacts/promotion.js";
import { quickBooksPaymentHistory } from "../operations/provider-runtime.js";
import { autoInstantiateWorkflow } from "../workflow/commands.js";
import { jobKindOf } from "../job-kinds/job-kinds.js";
import { tradeProfile } from "../trades/trades.js";
import { templateKeyForKind } from "../job-kinds/template-key.js";
import {
  assessExistingBooking,
  bookingImportKey,
  clientAutomationsPaused,
  existingBookingSchema,
  importBlocked,
  balanceOwedCents,
  pastImportStates,
  planImportedBooking,
  type ExistingBooking,
  type ImportedCoverageRole,
} from "./existing-booking.js";

/**
 * The server side of importing existing bookings.
 *
 * Three commands, dispatched from bookingCommand so they inherit its identity,
 * App Check, subscription and idempotency handling:
 *
 * - preview: what an import would find — problems with the booking itself,
 *   clients StudioCue already knows, the same booking already imported, other
 *   jobs on the same date. Writes nothing.
 * - import: writes the booking directly in its real state, quiet. It never
 *   calls the manual-attestation commands or the booking gate, never creates a
 *   booking orchestration and never queues the booking side-effects job — every
 *   one of those exists to act on a live booking, and would email the couple.
 * - bring live: the studio's deliberate decision that StudioCue may now reach
 *   this couple.
 *
 * Only owners and admins, the same as recording a signature or a payment by
 * hand: an import asserts both.
 */

export const previewExistingBookingsInput = z.object({
  bookings: z.array(existingBookingSchema).min(1).max(200),
});

export const importExistingBookingInput = z.object({
  booking: existingBookingSchema,
  source: z.enum(["form", "cue", "spreadsheet"]),
  batchId: z.string().trim().min(1).max(80).nullable(),
});

export const attachImportedSignedCopyInput = z.object({
  projectId: z.string().min(1),
  documentPath: z.string().min(1).max(1024),
});

export const bringImportedBookingLiveInput = z.object({
  projectId: z.string().min(1),
  /** Create the production calendar event and the Dropbox folders now. */
  calendarAndFolders: z.boolean(),
});

export const lookupQuickBooksPaymentsInput = z.object({
  emails: z.array(z.string().trim().toLowerCase().email()).min(1).max(200),
});

// Past jobs import too (2026-10-26), so a job already there that day can be
// one in editing or delivered.
const bookedStates = ["BOOKED", "PLANNING", "READY", "EVENT_COMPLETE", "POST_PRODUCTION", "DELIVERED", "REVIEW_REQUESTED", "CLOSED"];

/** What the import needs to know about the studio's trade. */
async function studioTrade(db: Firestore, tenantId: string) {
  const profile = tradeProfile((await db.doc(`tenants/${tenantId}`).get()).get("trade"));
  return { profile, delivers: profile.delivery };
}

function requireImportRole(membership: Record<string, unknown>) {
  if (!["studio_owner", "studio_admin"].includes(String(membership.role)))
    throw new Error("BOOKING_IMPORT_PERMISSION_REQUIRED");
}

/** Today in the studio's own calendar, so "already happened" means theirs. */
async function studioToday(db: Firestore, tenantId: string): Promise<string> {
  const tenant = await db.doc(`tenants/${tenantId}`).get();
  const timeZone = String(tenant.get("timezone") ?? "") || "UTC";
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

async function contactsByEmail(
  db: Firestore,
  tenantId: string,
  emails: string[],
): Promise<Map<string, DocumentSnapshot>> {
  const found = new Map<string, DocumentSnapshot>();
  for (const email of new Set(emails.filter(Boolean))) {
    const matches = await db
      .collection("contacts")
      .where("tenantId", "==", tenantId)
      .where("normalizedEmail", "==", email)
      .limit(5)
      .get();
    const live = matches.docs.find((contact) => !contact.get("archivedAt"));
    if (live) found.set(email, live);
  }
  return found;
}

/**
 * An inquiry that became a job on arrival and was never taken further. It is
 * not a booking: importing the real booking supersedes it rather than being
 * refused as a duplicate of it.
 */
function isUntouchedInquiry(project: DocumentSnapshot): boolean {
  return project.get("origin") === "inquiry" && project.get("state") === "LEAD";
}

/** A job already in StudioCue for this couple on this date. */
async function existingBookingFor(
  db: Firestore,
  tenantId: string,
  booking: ExistingBooking,
  primaryContactId: string | null,
): Promise<DocumentSnapshot | null> {
  const sameDay = await db
    .collection("projects")
    .where("tenantId", "==", tenantId)
    .where("eventDate", "==", booking.eventDate)
    .limit(25)
    .get();
  const key = bookingImportKey(booking);
  return (
    sameDay.docs.find(
      (project) =>
        !project.get("archivedAt") &&
        project.get("state") !== "CANCELLED" &&
        !isUntouchedInquiry(project) &&
        (project.get("importKey") === key ||
          (primaryContactId !== null &&
            Array.isArray(project.get("clientContactIds")) &&
            (project.get("clientContactIds") as unknown[]).includes(
              primaryContactId,
            ))),
    ) ?? null
  );
}

export async function previewExistingBookings(input: {
  tenantId: string;
  membership: Record<string, unknown>;
  bookings: ExistingBooking[];
}) {
  requireImportRole(input.membership);
  const db = getFirestore();
  const today = await studioToday(db, input.tenantId);
  const { delivers } = await studioTrade(db, input.tenantId);
  return {
    today,
    bookings: await Promise.all(
      input.bookings.map(async (booking) => {
        const emails = booking.clients
          .map((client) => client.email ?? "")
          .filter(Boolean);
        const contacts = await contactsByEmail(db, input.tenantId, emails);
        const primaryEmail = booking.clients[0]?.email ?? "";
        const primary = primaryEmail ? contacts.get(primaryEmail) ?? null : null;
        const [duplicate, sameDay] = await Promise.all([
          existingBookingFor(db, input.tenantId, booking, primary?.id ?? null),
          db
            .collection("projects")
            .where("tenantId", "==", input.tenantId)
            .where("eventDate", "==", booking.eventDate)
            .limit(25)
            .get(),
        ]);
        return {
          key: bookingImportKey(booking),
          issues: assessExistingBooking(booking, today, { delivers }),
          knownClients: booking.clients.map((client) => {
            const match = client.email ? contacts.get(client.email) : undefined;
            return match
              ? { contactId: match.id, displayName: String(match.get("displayName") ?? "") }
              : null;
          }),
          alreadyImported: duplicate
            ? {
                projectId: duplicate.id,
                name: String(duplicate.get("name") ?? duplicate.id),
                state: String(duplicate.get("state") ?? ""),
              }
            : null,
          // Other jobs booked that day. A multi-crew studio shoots two
          // weddings a day, so this warns rather than refuses.
          sameDayBookings: sameDay.docs
            .filter(
              (project) =>
                project.id !== duplicate?.id &&
                !project.get("archivedAt") &&
                bookedStates.includes(String(project.get("state"))),
            )
            .map((project) => ({
              projectId: project.id,
              name: String(project.get("name") ?? project.id),
            })),
        };
      }),
    ),
  };
}

export async function importExistingBooking(input: {
  tenantId: string;
  membership: Record<string, unknown>;
  actorId: string;
  timestamp: string;
  userAgent: string | null;
  booking: ExistingBooking;
  source: "form" | "cue" | "spreadsheet";
  batchId: string | null;
}) {
  requireImportRole(input.membership);
  const db = getFirestore();
  const today = await studioToday(db, input.tenantId);
  const trade = await studioTrade(db, input.tenantId);
  const issues = assessExistingBooking(input.booking, today, { delivers: trade.delivers });
  const blocking = issues.find((issue) => issue.severity === "error");
  if (importBlocked(issues) && blocking)
    throw new Error(`BOOKING_IMPORT_INVALID:${blocking.message}`);

  const emails = input.booking.clients
    .map((client) => client.email ?? "")
    .filter(Boolean);
  const known = await contactsByEmail(db, input.tenantId, emails);
  // A client may have only a phone (2026-10-26): no contact to match by email.
  const primaryEmail = input.booking.clients[0]!.email ?? "";
  const primaryKnown = primaryEmail ? known.get(primaryEmail) : undefined;
  const duplicate = await existingBookingFor(
    db,
    input.tenantId,
    input.booking,
    primaryKnown?.id ?? null,
  );
  if (duplicate)
    throw new Error(
      `BOOKING_ALREADY_IN_STUDIOCUE:${String(duplicate.get("name") ?? "This booking")} is already in StudioCue on ${input.booking.eventDate}.`,
    );

  // Derived from the couple and the date, so two imports of the same booking
  // racing past the check above still cannot both land: the second create
  // fails at the database.
  // The couple's inquiry, if it became a job on arrival, is the same wedding:
  // put away with the import rather than left open beside the booking.
  const supersededInquiries =
    primaryKnown === undefined
      ? []
      : (
          await db
            .collection("projects")
            .where("tenantId", "==", input.tenantId)
            .where("clientContactIds", "array-contains", primaryKnown.id)
            .limit(10)
            .get()
        ).docs.filter(
          (project) =>
            isUntouchedInquiry(project) &&
            !project.get("archivedAt") &&
            project.get("eventDate") === input.booking.eventDate,
        );
  const projectId = `imported_${createHash("sha256")
    .update(`${input.tenantId}|${bookingImportKey(input.booking)}`)
    .digest("hex")
    .slice(0, 32)}`;
  const contactIds: string[] = [];
  const batch = db.batch();
  for (const inquiry of supersededInquiries) {
    batch.update(inquiry.ref, {
      state: "ARCHIVED",
      stateVersion: Number(inquiry.get("stateVersion") ?? 0) + 1,
      archivedAt: input.timestamp,
      supersededBy: projectId,
      nextAction: null,
      updatedAt: input.timestamp,
      updatedBy: input.actorId,
    });
  }
  let contactsCreated = 0;
  let contactsMatched = 0;

  for (const client of input.booking.clients) {
    const existing = client.email ? known.get(client.email) : undefined;
    if (existing) {
      contactIds.push(existing.id);
      contactsMatched += 1;
      const types = Array.isArray(existing.get("contactTypes"))
        ? (existing.get("contactTypes") as unknown[]).map(String)
        : [];
      batch.update(existing.ref, {
        projectIds: FieldValue.arrayUnion(projectId),
        contactTypes: promoteContactTypesToClient(types),
        updatedAt: input.timestamp,
        updatedBy: input.actorId,
      });
      continue;
    }
    const contactId = randomUUID();
    contactIds.push(contactId);
    contactsCreated += 1;
    batch.create(db.doc(`contacts/${contactId}`), {
      id: contactId,
      tenantId: input.tenantId,
      firstName: client.firstName,
      lastName: client.lastName,
      email: client.email,
      phone: client.phone,
      company: null,
      contactTypes: ["client"],
      displayName: `${client.firstName} ${client.lastName}`,
      normalizedEmail: client.email,
      normalizedPhone: client.phone?.replace(/\D/g, "") || null,
      projectIds: [projectId],
      portalUserId: null,
      marketingConsent: false,
      notes: null,
      createdAt: input.timestamp,
      updatedAt: input.timestamp,
      createdBy: input.actorId,
      updatedBy: input.actorId,
      archivedAt: null,
    });
  }

  const records = planImportedBooking(input.booking, {
    tenantId: input.tenantId,
    projectId,
    packageSnapshotId: randomUUID(),
    contractId: randomUUID(),
    invoiceId: randomUUID(),
    contactIds,
    actorId: input.actorId,
    now: input.timestamp,
    source: input.source,
    batchId: input.batchId,
    primaryRole: trade.profile.coverageRoles[0] as ImportedCoverageRole,
    deliveryRecordId: randomUUID(),
    viewToken: randomBytes(24).toString("base64url"),
  });
  // The kind of work, read from the type the studio picked (job-kinds.ts).
  const eventKind = jobKindOf(records.project);
  batch.create(db.doc(`projects/${projectId}`), {
    ...records.project,
    eventKind,
    eventTypeId: templateKeyForKind(eventKind, String(records.project.eventTypeId ?? "")),
    eventTypeKey: null,
    importKey: bookingImportKey(input.booking),
  });
  batch.create(
    db.doc(`packageSnapshots/${String(records.packageSnapshot.id)}`),
    records.packageSnapshot,
  );
  batch.create(db.doc(`contracts/${String(records.contract.id)}`), records.contract);
  if (records.paidInvoice)
    batch.create(
      db.doc(`invoiceReferences/${String(records.paidInvoice.id)}`),
      records.paidInvoice,
    );
  // A delivered or finished job's own records, done before StudioCue.
  if (records.postProductionRecord)
    batch.set(db.doc(`postProductionRecords/${projectId}`), records.postProductionRecord);
  if (records.deliveryRecord)
    batch.create(db.doc(`deliveryRecords/${String(records.deliveryRecord.id)}`), records.deliveryRecord);
  if (records.closeout)
    batch.set(db.doc(`projectCloseouts/${String(records.closeout.id)}`), records.closeout);
  const auditId = randomUUID();
  batch.create(db.doc(`auditEvents/${auditId}`), {
    id: auditId,
    tenantId: input.tenantId,
    projectId,
    actorId: input.actorId,
    actorType: "user",
    action: "booking.imported",
    entityType: "project",
    entityId: projectId,
    timestamp: input.timestamp,
    before: null,
    after: {
      state: records.targetState,
      eventDate: input.booking.eventDate,
      signedOn: input.booking.signedOn,
      totalCents: input.booking.totalCents,
      paidCents: records.paidInvoice?.amountCents ?? 0,
      source: input.source,
      batchId: input.batchId,
      crew: input.booking.crew ?? null,
    },
    ipAddress: null,
    userAgent: input.userAgent,
    correlationId: `booking_import_${projectId}`,
    automationRunId: null,
    providerEventId: null,
  });
  try {
    await batch.commit();
  } catch (caught: unknown) {
    // ALREADY_EXISTS on the derived project id: the same booking won the race.
    if ((caught as { code?: unknown })?.code === 6)
      throw new Error(
        `BOOKING_ALREADY_IN_STUDIOCUE:This booking is already in StudioCue on ${input.booking.eventDate}.`,
      );
    throw caught;
  }

  // Steps due before today happened before StudioCue.
  const workflow = await autoInstantiateWorkflow({
    tenantId: input.tenantId,
    projectId,
    actorId: input.actorId,
    imported: {
      bookingDate: input.booking.signedOn,
      importedOn: today,
      balanceOwed: balanceOwedCents(input.booking) > 0,
    },
  });

  // Who worked it, booked with nothing sent (2026-10-26).
  const crew = await bookImportedCrew(db, {
    tenantId: input.tenantId,
    projectId,
    projectName: String(records.project.name),
    startTime: input.booking.startTime ?? null,
    currency: input.booking.currency,
    people: records.namedCrew,
    actorId: input.actorId,
    now: input.timestamp,
  });

  let state = pastImportStates.includes(records.targetState) ? records.targetState : "BOOKED";
  if (records.targetState === "PLANNING") {
    // Entered only now that checkpoints exist; see planImportedBooking.
    const reference = db.doc(`projects/${projectId}`);
    await db.runTransaction(async (transaction) => {
      const current = await transaction.get(reference);
      if (current.get("state") !== "BOOKED") return;
      transaction.update(reference, {
        state: "PLANNING",
        stateVersion: Number(current.get("stateVersion") ?? 1) + 1,
        updatedAt: input.timestamp,
        updatedBy: input.actorId,
      });
    });
    state = "PLANNING";
  }

  return {
    projectId,
    name: String(records.project.name),
    state,
    contactsCreated,
    contactsMatched,
    crew,
    paidCents: Number(records.paidInvoice?.amountCents ?? 0),
    workflow:
      "workflowRunId" in workflow
        ? { started: true, checkpointCount: workflow.checkpointCount }
        : { started: false, reason: workflow.skipped },
    warnings: issues
      .filter((issue) => issue.severity === "warning")
      .map((issue) => issue.message),
  };
}

const personKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * The people an imported job names, booked on it with nothing sent.
 *
 * Each name is matched to the studio's roster (by name: an import has no
 * email for them). A name not there is added to the roster quietly — no
 * invite, no email, Conor's decision (2026-10-26) — and can be invited later
 * once the studio adds an email; until then no offer can go to them
 * (crew/cascade.ts). Each person gets an accepted assignment on the job, past
 * or upcoming, with no calendar invite and no email:
 * the job reads as staffed because it was. Ids are derived from the job, the
 * role and the name, so a retried import books nobody twice.
 */
async function bookImportedCrew(
  db: Firestore,
  input: {
    tenantId: string;
    projectId: string;
    projectName: string;
    startTime: string | null;
    currency: string;
    people: { role: string; label: string; name: string }[];
    actorId: string;
    now: string;
  },
): Promise<{ assigned: number; addedToRoster: { id: string; name: string }[]; matched: number }> {
  if (!input.people.length) return { assigned: 0, addedToRoster: [], matched: 0 };
  const roster = await db.collection("crewProfiles").where("tenantId", "==", input.tenantId).get();
  const byName = new Map<string, DocumentSnapshot>();
  // Active entries win over archived ones with the same name.
  for (const profile of [...roster.docs].sort((a, b) => Number(Boolean(a.get("archivedAt"))) - Number(Boolean(b.get("archivedAt")))))
    if (!byName.has(personKey(String(profile.get("name") ?? "")))) byName.set(personKey(String(profile.get("name") ?? "")), profile);
  const batch = db.batch();
  const added: { id: string; name: string }[] = [];
  let matched = 0;
  const created = new Map<string, string>();
  for (const person of input.people) {
    const key = personKey(person.name);
    let profileId = byName.get(key)?.id ?? created.get(key);
    const profile = byName.get(key);
    if (profile) matched += 1;
    if (!profileId) {
      profileId = `crew_imported_${createHash("sha256").update(`${input.tenantId}|${key}`).digest("hex").slice(0, 24)}`;
      created.set(key, profileId);
      added.push({ id: profileId, name: person.name });
      batch.set(
        db.doc(`crewProfiles/${profileId}`),
        {
          id: profileId,
          tenantId: input.tenantId,
          userId: null,
          name: person.name,
          // None yet: added from an imported job. Invite once the studio adds one.
          email: null,
          phone: null,
          specialties: [],
          trades: [person.role],
          serviceAreas: [],
          travelRadiusMiles: 0,
          rateType: "event",
          rateCents: 0,
          currency: input.currency,
          equipment: [],
          w9Status: "missing",
          insuranceStatus: "missing",
          contractStatus: "missing",
          emergencyContact: null,
          notes: `Added from an imported job (${input.projectName}).`,
          active: true,
          addedByImport: true,
          createdAt: input.now,
          updatedAt: input.now,
          createdBy: input.actorId,
          updatedBy: input.actorId,
          archivedAt: null,
        },
        { merge: true },
      );
    }
    const userId = profile ? (profile.get("userId") as string | null) ?? null : null;
    const assignmentId = `assign_imported_${createHash("sha256").update(`${input.projectId}|${person.role}|${key}`).digest("hex").slice(0, 24)}`;
    batch.set(db.doc(`crewAssignments/${assignmentId}`), {
      id: assignmentId,
      tenantId: input.tenantId,
      projectId: input.projectId,
      projectName: input.projectName,
      crewProfileId: profileId,
      userId,
      role: person.label,
      compensationCents: null,
      compensationType: null,
      currency: input.currency,
      compensationVisibleToCrew: false,
      arrivalAt: null,
      departureAt: null,
      locations: [],
      responsibilities: [],
      scheduleItemIds: [],
      notes: input.startTime ? `The day starts at ${input.startTime}.` : null,
      // Agreed to before StudioCue. Accepted on a past job too, as a live
      // job's crew stay until the studio completes them: "completed" read as
      // nobody booked on the job page (prod walk, 2026-10-26).
      status: "accepted",
      invitationSentAt: null,
      viewedAt: null,
      respondedAt: input.now,
      calendarStatus: "not_added",
      calendarAcknowledgedAt: null,
      currentScheduleId: null,
      currentScheduleVersion: null,
      acknowledgedScheduleVersion: null,
      scheduleAcknowledgedAt: null,
      requirements: [],
      inviteTokenHash: null,
      inviteExpiresAt: null,
      assignedDirectly: true,
      assignedBy: input.actorId,
      completionAuthority: "imported",
      createdAt: input.now,
      updatedAt: input.now,
      createdBy: input.actorId,
      updatedBy: input.actorId,
      archivedAt: null,
    }, { merge: true });
    // Someone with an account sees the job in their app; nothing is sent.
    if (userId)
      batch.set(
        db.doc(`memberships/${input.tenantId}_${userId}`),
        { projectIds: FieldValue.arrayUnion(input.projectId) },
        { merge: true },
      );
  }
  await batch.commit();
  return { assigned: input.people.length, addedToRoster: added, matched };
}

export async function attachImportedSignedCopy(input: {
  tenantId: string;
  membership: Record<string, unknown>;
  actorId: string;
  timestamp: string;
  projectId: string;
  documentPath: string;
}) {
  requireImportRole(input.membership);
  // Only a file in this project's own contracts folder, so a valid request
  // cannot attach somebody else's document to this couple.
  const prefix = `tenants/${input.tenantId}/projects/${input.projectId}/contracts/`;
  if (!input.documentPath.startsWith(prefix))
    throw new Error("SIGNED_COPY_PATH_MISMATCH");
  const db = getFirestore();
  const contracts = await db
    .collection("contracts")
    .where("tenantId", "==", input.tenantId)
    .where("projectId", "==", input.projectId)
    .where("completionAuthority", "==", "imported")
    .limit(1)
    .get();
  const contract = contracts.docs[0];
  if (!contract) throw new Error("IMPORTED_CONTRACT_NOT_FOUND");
  if (contract.get("signedDocumentId"))
    throw new Error("SIGNED_COPY_ALREADY_ATTACHED");
  // Filed as a document, so it opens wherever the contract is mentioned.
  const document = signedCopyDocument({
    tenantId: input.tenantId,
    projectId: input.projectId,
    contractId: contract.id,
    path: input.documentPath,
    authority: "imported",
    actorId: input.actorId,
    now: input.timestamp,
  });
  const batch = db.batch();
  batch.set(db.doc(`documents/${document.id}`), document.data);
  batch.update(contract.ref, {
    signedDocumentId: document.id,
    updatedAt: input.timestamp,
    updatedBy: input.actorId,
  });
  await batch.commit();
  return { projectId: input.projectId, contractId: contract.id, attached: true };
}

export async function bringImportedBookingLive(input: {
  tenantId: string;
  membership: Record<string, unknown>;
  actorId: string;
  timestamp: string;
  userAgent: string | null;
  idempotencyKey: string;
  projectId: string;
  calendarAndFolders: boolean;
}) {
  requireImportRole(input.membership);
  const db = getFirestore();
  const reference = db.doc(`projects/${input.projectId}`);
  const result = await db.runTransaction(async (transaction) => {
    const project = await transaction.get(reference);
    if (!project.exists || project.get("tenantId") !== input.tenantId)
      throw new Error("PROJECT_NOT_FOUND");
    if (!project.get("importedAt")) throw new Error("NOT_AN_IMPORTED_BOOKING");
    if (!clientAutomationsPaused(project.data()))
      return { projectId: input.projectId, alreadyLive: true };
    // A job imported after its event (2026-10-26) has no day to put in a
    // calendar, and inviting the client is a choice, not its next step.
    const past = pastImportStates.includes(String(project.get("state")) as never) || ["REVIEW_REQUESTED", "ARCHIVED"].includes(String(project.get("state")));
    transaction.update(reference, {
      clientAutomationsPausedAt: null,
      broughtLiveAt: input.timestamp,
      broughtLiveBy: input.actorId,
      clientPortalActive: true,
      ...(past ? {} : { nextAction: "Invite the couple to their portal" }),
      updatedAt: input.timestamp,
      updatedBy: input.actorId,
    });
    if (input.calendarAndFolders && !past) {
      // The same job a live booking queues. completeBookingResources skips its
      // confirmation email for an imported booking — they booked long ago —
      // and the workflow it would start already exists.
      transaction.create(db.doc(`providerJobs/booking_${input.projectId}`), {
        tenantId: input.tenantId,
        projectId: input.projectId,
        type: "complete_booking_side_effects",
        idempotencyKey: input.idempotencyKey,
        status: "queued",
        steps: ["dropbox_folders", "production_calendar"],
        createdAt: input.timestamp,
      });
    }
    const auditId = randomUUID();
    transaction.create(db.doc(`auditEvents/${auditId}`), {
      id: auditId,
      tenantId: input.tenantId,
      projectId: input.projectId,
      actorId: input.actorId,
      actorType: "user",
      action: "booking.brought_live",
      entityType: "project",
      entityId: input.projectId,
      timestamp: input.timestamp,
      before: { clientAutomationsPausedAt: project.get("clientAutomationsPausedAt") },
      after: {
        clientAutomationsPausedAt: null,
        calendarAndFolders: input.calendarAndFolders,
      },
      ipAddress: null,
      userAgent: input.userAgent,
      correlationId: `booking_live_${input.projectId}`,
      automationRunId: null,
      providerEventId: null,
    });
    return { projectId: input.projectId, alreadyLive: false };
  });
  return { ...result, calendarAndFolders: input.calendarAndFolders };
}

/**
 * What QuickBooks shows each client has paid, to prefill an import.
 *
 * Read-only, and only ever a prefill: the payments come back to the form or
 * the spreadsheet review, where the studio sees them before anything is
 * imported. Held to the import permission, because what a couple has paid is
 * not something every team member needs to be able to pull.
 */
export async function lookupQuickBooksPayments(input: {
  tenantId: string;
  membership: Record<string, unknown>;
  emails: string[];
}) {
  requireImportRole(input.membership);
  return quickBooksPaymentHistory(input.tenantId, input.emails);
}
