import { createHash, randomUUID } from "node:crypto";
import {
  FieldValue,
  getFirestore,
  type DocumentSnapshot,
  type Firestore,
} from "firebase-admin/firestore";
import { z } from "zod";
import { promoteContactTypesToClient } from "../contacts/promotion.js";
import { autoInstantiateWorkflow } from "../workflow/commands.js";
import {
  assessExistingBooking,
  bookingImportKey,
  clientAutomationsPaused,
  existingBookingSchema,
  importBlocked,
  planImportedBooking,
  type ExistingBooking,
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

const bookedStates = ["BOOKED", "PLANNING", "READY", "EVENT_COMPLETE"];

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
          issues: assessExistingBooking(booking, today),
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
  const issues = assessExistingBooking(input.booking, today);
  const blocking = issues.find((issue) => issue.severity === "error");
  if (importBlocked(issues) && blocking)
    throw new Error(`BOOKING_IMPORT_INVALID:${blocking.message}`);

  const emails = input.booking.clients
    .map((client) => client.email ?? "")
    .filter(Boolean);
  const known = await contactsByEmail(db, input.tenantId, emails);
  const primaryEmail = input.booking.clients[0]!.email!;
  const duplicate = await existingBookingFor(
    db,
    input.tenantId,
    input.booking,
    known.get(primaryEmail)?.id ?? null,
  );
  if (duplicate)
    throw new Error(
      `BOOKING_ALREADY_IN_STUDIOCUE:${String(duplicate.get("name") ?? "This booking")} is already in StudioCue on ${input.booking.eventDate}.`,
    );

  // Derived from the couple and the date, so two imports of the same booking
  // racing past the check above still cannot both land: the second create
  // fails at the database.
  const projectId = `imported_${createHash("sha256")
    .update(`${input.tenantId}|${bookingImportKey(input.booking)}`)
    .digest("hex")
    .slice(0, 32)}`;
  const contactIds: string[] = [];
  const batch = db.batch();
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
  });
  batch.create(db.doc(`projects/${projectId}`), {
    ...records.project,
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
    imported: { bookingDate: input.booking.signedOn, importedOn: today },
  });

  let state = "BOOKED";
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
  await contract.ref.update({
    signedDocumentId: input.documentPath,
    updatedAt: input.timestamp,
    updatedBy: input.actorId,
  });
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
    transaction.update(reference, {
      clientAutomationsPausedAt: null,
      broughtLiveAt: input.timestamp,
      broughtLiveBy: input.actorId,
      clientPortalActive: true,
      nextAction: "Invite the couple to their portal",
      updatedAt: input.timestamp,
      updatedBy: input.actorId,
    });
    if (input.calendarAndFolders) {
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
