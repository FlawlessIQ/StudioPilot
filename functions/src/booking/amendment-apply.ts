import { FieldValue, getFirestore, type DocumentSnapshot, type Firestore } from "firebase-admin/firestore";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import { isStandingInvoice } from "./invoice-standing.js";
import { raiseFinalInvoice } from "./final-invoice.js";
import { amendmentMoney, longDate, shiftDate, shiftInZone } from "./amendment-core.js";
import { signedOneOff } from "./amendment-packages.js";
import { assignmentIcs, assignmentPlace } from "../crew/calendar-ics.js";
import { studioNotificationAddress } from "../communications/notify-address.js";
import { reconcileProjectReadiness } from "../workflow/readiness-triggers.js";
import { jobBillingFor } from "../billing/job-billing-reader.js";

/**
 * What a signed booking change does.
 *
 * Runs when an amendment reaches "signed" — the couple in their portal
 * (server/contracts/amendment-signing.ts) or the studio vouching for a
 * signature taken elsewhere (functions/src/contracts/amendments.ts) — so both
 * paths change the job the same way. The job keeps its stage throughout.
 *
 * 1. The records: the change's proposal becomes the accepted one and the old
 *    one superseded; the amended agreement is filed as a completed contract
 *    beside the original; the job takes the new packages and date. A package
 *    whose extras changed comes as a new snapshot, so taking it is the same
 *    swap of ids as any package change; a one-off written inside the change
 *    becomes active (./amendment-packages.ts).
 * 2. The money: an unpaid bill written for the old total or date is
 *    superseded and raised again; a refund owed becomes a task. Payments
 *    already made are kept (see amendment-core.ts).
 * 3. The date: crew are asked to confirm the new day, and every stamped copy
 *    of the old one — crew times, checkpoint and questionnaire due dates,
 *    certificate requests, calendar events — moves with it.
 *
 * Idempotent: `appliedAt` is set once, and every later step is safe to repeat.
 */

const text = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const strings = (value: unknown) => (Array.isArray(value) ? value.map(String).filter(Boolean) : []);
const ACTOR = "booking-amendment";

const paidOf = (invoice: DocumentSnapshot) => {
  const amount = num(invoice.get("amountCents"));
  const balance = typeof invoice.get("balanceCents") === "number" ? num(invoice.get("balanceCents")) : amount;
  return Math.max(0, amount - balance);
};

function task(input: {
  id: string;
  tenantId: string;
  projectId: string;
  title: string;
  description: string;
  now: string;
  priority?: "normal" | "high" | "urgent";
  blocking?: boolean;
}) {
  return {
    id: input.id,
    tenantId: input.tenantId,
    projectId: input.projectId,
    workflowRunId: null,
    checkpointId: null,
    title: input.title,
    description: input.description,
    status: "not_started",
    priority: input.priority ?? "high",
    assignedUserId: null,
    assignedRole: "studio_owner",
    dueDate: input.now.slice(0, 10),
    blocking: input.blocking ?? false,
    completedAt: null,
    completedBy: null,
    source: "booking_amendment",
    createdAt: input.now,
    updatedAt: input.now,
    createdBy: ACTOR,
    updatedBy: ACTOR,
    archivedAt: null,
  };
}

export async function applyAmendment(db: Firestore, amendmentId: string) {
  const amendmentReference = db.doc(`bookingAmendments/${amendmentId}`);
  const now = new Date().toISOString();
  const core = await db.runTransaction(async (transaction) => {
    const amendment = await transaction.get(amendmentReference);
    if (!amendment.exists || amendment.get("status") !== "signed" || amendment.get("appliedAt")) return null;
    const tenantId = text(amendment.get("tenantId"));
    const projectId = text(amendment.get("projectId"));
    const base = obj(amendment.get("base"));
    const next = obj(amendment.get("next"));
    const projectReference = db.doc(`projects/${projectId}`);
    const heldReference = db.doc(`amendmentProposals/${text(amendment.get("proposalId"))}`);
    const pendingReference = db.doc(`proposals/${text(amendment.get("proposalId"))}`);
    const baseProposalReference = db.doc(`proposals/${text(base.proposalId)}`);
    const baseContractId = text(base.contractId);
    const oneOffPackageId = text(amendment.get("oneOffPackageId"));
    const [project, pendingProposal, baseProposal, baseContract, invoices, schedules, oneOffPackage] = await Promise.all([
      transaction.get(projectReference),
      transaction.get(heldReference),
      transaction.get(baseProposalReference),
      baseContractId ? transaction.get(db.doc(`contracts/${baseContractId}`)) : Promise.resolve(null),
      transaction.get(
        db.collection("invoiceReferences").where("tenantId", "==", tenantId).where("projectId", "==", projectId).limit(40),
      ),
      transaction.get(
        db.collection("schedules").where("tenantId", "==", tenantId).where("projectId", "==", projectId).where("status", "==", "published").limit(5),
      ),
      oneOffPackageId ? transaction.get(db.doc(`packages/${oneOffPackageId}`)) : Promise.resolve(null),
    ]);
    if (!project.exists || project.get("tenantId") !== tenantId) return null;
    const previousDate = text(project.get("eventDate"));
    const newDate = text(next.eventDate) || previousDate;
    const dateChanged = newDate !== previousDate;
    const shift = num(amendment.get("dateShiftDays")) || 0;
    const newTotalCents = num(next.totalCents);
    const previousTotalCents = num(base.totalCents);
    const totalChanged = newTotalCents !== previousTotalCents;
    const signature = obj(amendment.get("clientSignature"));
    const attested = signature.kind === "manual_attested";
    const signedAt = text(amendment.get("signedAt")) || now;
    const nextIds = strings(next.packageSnapshotIds);
    const schedule = Array.isArray(next.paymentSchedule) ? (next.paymentSchedule as Array<Record<string, unknown>>) : [];

    // 1. The records.
    if (!pendingProposal.exists) return null;
    transaction.set(pendingReference, {
      ...(pendingProposal.data() as Record<string, unknown>),
      status: "accepted",
      acceptedAt: signedAt,
      acceptedBy: attested ? text(signature.attestedBy) : text(signature.signerUid) || null,
      acceptanceAuthority: attested ? "amendment_attested" : "amendment_signed",
      updatedAt: now,
      updatedBy: ACTOR,
    });
    transaction.update(heldReference, { status: "filed", filedAt: now, updatedAt: now });
    if (baseProposal.exists && baseProposal.get("status") === "accepted")
      transaction.update(baseProposalReference, {
        status: "superseded",
        supersededByProposalId: pendingReference.id,
        supersededReason: "The booking was changed.",
        updatedAt: now,
        updatedBy: ACTOR,
      });
    const contractId = `amendment_${amendmentId}`;
    const studioSignature = obj(amendment.get("studioSignature"));
    transaction.set(db.doc(`contracts/${contractId}`), {
      id: contractId,
      tenantId,
      projectId,
      proposalId: pendingReference.id,
      amendmentId,
      amendsContractId: baseContractId || null,
      status: "completed",
      provider: amendment.get("signingMode") === "studiocue" && !attested ? "studiocue" : null,
      providerEnvelopeId: null,
      providerState: "not_applicable",
      document: amendment.get("document") ?? null,
      documentHash: amendment.get("documentHash") ?? null,
      signers: [
        ...(studioSignature.typedName
          ? [{ name: studioSignature.typedName, email: studioSignature.email ?? null, role: "studio", order: 1, status: "completed", signedAt: studioSignature.signedAt }]
          : []),
        {
          name: text(signature.typedName, text(amendment.get("clientName"), "Client")),
          email: text(amendment.get("clientEmail")) || null,
          role: "primary_client",
          order: 2,
          status: "completed",
          signedAt,
        },
      ],
      signatures: [
        ...(studioSignature.id ? [{ id: studioSignature.id, role: "studio", typedName: studioSignature.typedName, signedAt: studioSignature.signedAt }] : []),
        ...(signature.id ? [{ id: signature.id, role: "client", typedName: signature.typedName, signedAt }] : []),
      ],
      completionAuthority: attested ? "manual_attested" : "client_signed",
      completionEvidence: attested
        ? { kind: "manual_attestation", method: signature.method ?? null, signerName: signature.typedName ?? null, attestedBy: signature.attestedBy ?? null, signedOn: signature.signedOn ?? null }
        : { kind: "studiocue_signature", signatureId: signature.id ?? null, documentHash: amendment.get("documentHash") ?? null, typedName: signature.typedName ?? null, signedAt },
      sentAt: amendment.get("sentAt") ?? null,
      viewedAt: null,
      completedAt: signedAt,
      signedDocumentId: null,
      certificateDocumentId: null,
      voidedAt: null,
      voidedBy: null,
      voidReason: null,
      createdAt: now,
      updatedAt: now,
      createdBy: ACTOR,
      updatedBy: ACTOR,
      archivedAt: null,
    });
    if (baseContract?.exists)
      transaction.update(baseContract.ref, { amendedByContractId: contractId, amendedAt: now, updatedAt: now });
    // A one-off written inside the change is the job's now, like any package
    // on it (it waited inactive so no list offered it before the signature).
    if (oneOffPackage?.exists && oneOffPackage.get("tenantId") === tenantId)
      transaction.update(oneOffPackage.ref, signedOneOff(now, ACTOR));
    transaction.update(projectReference, {
      packageSnapshotId: nextIds[0] ?? project.get("packageSnapshotId"),
      additionalPackageSnapshotIds: nextIds.slice(1),
      ...(dateChanged ? { eventDate: newDate } : {}),
      pendingAmendmentId: null,
      lastAmendmentId: amendmentId,
      amendmentCount: FieldValue.increment(1),
      nextAction: null,
      updatedAt: now,
      updatedBy: ACTOR,
    });

    // 2. The money.
    const standing = invoices.docs.filter((invoice) => isStandingInvoice(invoice.get("status")));
    const paidCents = standing.reduce((sum, invoice) => sum + paidOf(invoice), 0);
    const money = amendmentMoney({
      previousTotalCents,
      newTotalCents,
      agreedRetainerCents: num(schedule[0]?.amountCents),
      paidCents,
    });
    const superseded: DocumentSnapshot[] = [];
    let finalSuperseded = false;
    for (const invoice of standing) {
      const owed = num(invoice.get("balanceCents")) > 0 && invoice.get("status") !== "paid";
      if (!owed) continue;
      const kind = text(invoice.get("kind"));
      const stale =
        (kind === "final" && (totalChanged || dateChanged)) ||
        (kind === "retainer" && num(invoice.get("amountCents")) !== money.retainerCents);
      if (!stale) continue;
      superseded.push(invoice);
      if (kind === "final") finalSuperseded = true;
      transaction.update(invoice.ref, {
        status: "superseded",
        supersededAt: now,
        supersededBy: `bookingAmendments/${amendmentId}`,
        updatedAt: now,
        updatedBy: ACTOR,
      });
      const providerInvoiceId = text(invoice.get("providerInvoiceId"));
      if (providerInvoiceId && !providerInvoiceId.startsWith("pending_")) {
        const number = text(invoice.get("providerDocNumber"));
        transaction.set(
          db.doc(`tasks/amendment_void_${invoice.id}`),
          task({
            id: `amendment_void_${invoice.id}`,
            tenantId,
            projectId,
            title: `Void ${number ? `invoice ${number}` : "the old invoice"} in ${text(invoice.get("provider"), "your invoicing app") === "quickbooks" ? "QuickBooks" : "your invoicing app"}`,
            description: `The booking change replaced this ${kind === "final" ? "balance" : "retainer"} invoice. StudioCue no longer counts it; void it where it was raised so the couple isn't billed twice.`,
            now,
          }),
        );
      }
    }
    if (money.refundCents > 0)
      transaction.set(
        db.doc(`tasks/amendment_refund_${amendmentId}`),
        task({
          id: `amendment_refund_${amendmentId}`,
          tenantId,
          projectId,
          title: `Refund the couple ${(money.refundCents / 100).toLocaleString("en-US", { style: "currency", currency: text(amendment.get("currency"), "USD") })}`,
          description: "They had paid more than the booking now costs after the change.",
          now,
          priority: "urgent",
        }),
      );
    if (dateChanged && !schedules.empty)
      transaction.set(
        db.doc(`tasks/amendment_timeline_${amendmentId}`),
        task({
          id: `amendment_timeline_${amendmentId}`,
          tenantId,
          projectId,
          title: `Publish the timeline again for ${newDate}`,
          description: "The wedding moved. The published timeline still has the old day's times; open it, check the times and publish it again so the couple and crew have the new one.",
          now,
        }),
      );

    transaction.update(amendmentReference, {
      status: "applied",
      appliedAt: now,
      applied: {
        contractId,
        proposalId: pendingReference.id,
        supersededInvoiceIds: superseded.map((invoice) => invoice.id),
        refundCents: money.refundCents,
        outstandingCents: money.outstandingCents,
      },
      updatedAt: now,
    });
    transaction.set(db.doc(`auditEvents/audit_amendment_applied_${amendmentId}`), {
      id: `audit_amendment_applied_${amendmentId}`,
      tenantId,
      projectId,
      actorId: ACTOR,
      actorType: "system",
      action: "booking.amendment_applied",
      entityType: "bookingAmendment",
      entityId: amendmentId,
      timestamp: now,
      before: { eventDate: previousDate, packageSnapshotIds: strings(base.packageSnapshotIds), totalCents: previousTotalCents },
      after: { eventDate: newDate, packageSnapshotIds: nextIds, totalCents: newTotalCents },
      ipAddress: null,
      userAgent: null,
      correlationId: amendmentId,
      automationRunId: null,
      providerEventId: null,
    });
    return {
      tenantId,
      projectId,
      previousDate,
      newDate,
      dateChanged,
      shift,
      finalSuperseded,
      money,
      changes: strings(amendment.get("changes")),
      clientEmail: text(amendment.get("clientEmail")),
      clientName: text(amendment.get("clientName")),
      projectName: text(project.get("name")),
      timezone: text(project.get("timezone")) || null,
      state: text(project.get("state")),
      contactId: strings(project.get("clientContactIds"))[0] ?? null,
      hadPaidFinal: standing.some((invoice) => invoice.get("kind") === "final" && invoice.get("status") === "paid"),
      consultationMoves: (Array.isArray(amendment.get("consultationMoves"))
        ? (amendment.get("consultationMoves") as Array<Record<string, unknown>>)
        : []
      ).map((move) => ({
        consultationId: text(move.consultationId),
        fromStartsAt: text(move.fromStartsAt),
        toStartsAt: text(move.toStartsAt),
        toEndsAt: text(move.toEndsAt),
      })),
    };
  });
  if (!core) return { applied: false };

  // The replacement balance invoice, where one is due now.
  const daysOut = Math.round((Date.parse(`${core.newDate}T00:00:00Z`) - Date.now()) / 86_400_000);
  const billNow =
    ["BOOKED", "PLANNING", "READY"].includes(core.state) &&
    core.money.outstandingCents > 0 &&
    (core.finalSuperseded || core.hadPaidFinal || daysOut <= 28);
  if (billNow) {
    try {
      const project = await db.doc(`projects/${core.projectId}`).get();
      const count = num(project.get("amendmentCount"));
      const billing = await jobBillingFor(db, core.tenantId, core.projectId, project.data() ?? null);
      const outcome = await db.runTransaction((transaction) =>
        raiseFinalInvoice(db, transaction, project, {
          invoiceId: `final_${core.projectId}_a${count}`,
          actor: ACTOR,
          now: new Date().toISOString(),
          billing,
        }),
      );
      // A change that leaves money owed and raises no bill should be findable.
      logger.info("amendmentFinalInvoice", { amendmentId, ...outcome });
    } catch (caught) {
      logger.error("amendmentFinalInvoiceFailed", { amendmentId, message: String(caught).slice(0, 200) });
    }
  }

  if (core.dateChanged) await moveDate(db, core, amendmentId).catch((caught) =>
    logger.error("amendmentDateMoveFailed", { amendmentId, message: String(caught).slice(0, 200) }),
  );
  if (core.consultationMoves.length)
    await moveConsultations(db, core, amendmentId).catch((caught) =>
      logger.error("amendmentConsultationMoveFailed", { amendmentId, message: String(caught).slice(0, 200) }),
    );
  await reconcileProjectReadiness(db, core.tenantId, core.projectId).catch(() => undefined);
  await settleCoupleRequests(db, core, amendmentId).catch((caught) =>
    logger.error("amendmentRequestSettleFailed", { amendmentId, message: String(caught).slice(0, 200) }),
  );

  // Everyone hears.
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://studio-cue.com").replace(/\/$/, "");
  const batch = db.batch();
  if (core.clientEmail)
    batch.set(db.doc(`emailJobs/amendment_confirmed_${amendmentId}`), {
      id: `amendment_confirmed_${amendmentId}`,
      tenantId: core.tenantId,
      projectId: core.projectId,
      contactId: core.contactId,
      recipient: core.clientEmail,
      recipientName: core.clientName || null,
      projectName: core.projectName,
      type: "manual_message",
      customSubject: "Your booking change is confirmed",
      customBody: ["Thank you — the change to your booking is signed and confirmed:", ...core.changes.map((line) => `• ${line}`)].join("\n"),
      actionLabel: "Open your portal",
      actionUrl: `${appUrl}/client`,
      category: "contract",
      status: "queued",
      attempts: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  const studio = await studioNotificationAddress(db, core.tenantId).catch(() => null);
  if (studio)
    batch.set(db.doc(`emailJobs/amendment_studio_${amendmentId}`), {
      id: `amendment_studio_${amendmentId}`,
      tenantId: core.tenantId,
      projectId: core.projectId,
      type: "client_message_received",
      recipient: studio,
      senderName: core.clientName || "The couple",
      messageSubject: `${core.projectName}: booking change signed`,
      messagePreview: ["The change is signed and applied:", ...core.changes].join("\n"),
      actionUrl: `${appUrl}/studio/projects/${core.projectId}`,
      status: "queued",
      attempts: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  await batch.commit();
  return { applied: true };
}

/** Every stamped copy of the old date follows the new one. */
async function moveDate(
  db: Firestore,
  core: { tenantId: string; projectId: string; newDate: string; shift: number; projectName: string; timezone: string | null },
  amendmentId: string,
) {
  const { tenantId, projectId, shift } = core;
  // Times keep their local clock across a daylight-saving change.
  const shiftTimestamp = (value: unknown, days: number) => shiftInZone(value, days, core.timezone);
  const now = new Date().toISOString();
  const scoped = (collection: string) =>
    db.collection(collection).where("tenantId", "==", tenantId).where("projectId", "==", projectId).limit(60).get();
  const [assignments, cascades, calendarEvents, checkpoints, questionnaires, requirements, requests, profiles] = await Promise.all([
    scoped("crewAssignments"),
    scoped("crewCascades"),
    scoped("crewCalendarEvents"),
    scoped("checkpoints"),
    scoped("questionnaireResponses"),
    scoped("insuranceRequirements"),
    scoped("insuranceRequests"),
    db.collection("crewProfiles").where("tenantId", "==", tenantId).limit(200).get(),
  ]);
  const batch = db.batch();
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://studio-cue.com").replace(/\/$/, "");
  const weekOut = new Date(Date.now() + 7 * 86_400_000).toISOString();

  // Crew: their times move, and anyone who had said yes is asked again — a
  // new day is a new question. A no releases the role to be staffed.
  const newDateLong = longDate(core.newDate);
  for (const assignment of assignments.docs) {
    const status = text(assignment.get("status"));
    if (!["invited", "viewed", "accepted"].includes(status)) continue;
    const arrivalAt = shiftTimestamp(assignment.get("arrivalAt"), shift);
    const departureAt = shiftTimestamp(assignment.get("departureAt"), shift);
    // A crew member's own calendar copy (downloaded from the crew app) is out
    // of StudioCue's reach; the next version of the same event, attached to
    // the email below, is what moves it.
    const calendarSequence = num(assignment.get("calendarSequence")) + 1;
    batch.update(assignment.ref, {
      arrivalAt,
      departureAt,
      calendarSequence,
      ...(status === "accepted"
        ? { status: "invited", reconfirmForDateChange: true, previouslyAcceptedAt: assignment.get("respondedAt") ?? now }
        : {}),
      inviteExpiresAt: weekOut,
      calendarStatus: "not_added",
      calendarAcknowledgedAt: null,
      dateChangedFrom: shiftDate(core.newDate, -shift),
      updatedAt: now,
      updatedBy: ACTOR,
    });
    const profile = profiles.docs.find((candidate) => candidate.id === assignment.get("crewProfileId"));
    const email = text(profile?.get("email"));
    if (email)
      batch.set(db.doc(`emailJobs/amendment_crew_${amendmentId}_${assignment.id}`), {
        id: `amendment_crew_${amendmentId}_${assignment.id}`,
        tenantId,
        projectId,
        recipient: email,
        recipientName: text(profile?.get("name")) || null,
        projectName: core.projectName,
        type: "manual_message",
        customSubject: `${core.projectName} moved to ${newDateLong}`,
        customBody: `${core.projectName} has moved to ${newDateLong}. ${
          status === "accepted" ? "Please confirm you can still do it" : "Your offer is for the new day"
        } in your crew app; if you can't, decline it there and the studio will find cover.${
          status === "accepted" && typeof arrivalAt === "string" && typeof departureAt === "string"
            ? " If you added it to your calendar, open the attached calendar file and it moves to the new day."
            : ""
        }`,
        // Only someone who had said yes can have the old day in their calendar.
        calendarAttachment:
          status === "accepted" && typeof arrivalAt === "string" && typeof departureAt === "string"
            ? {
                filename: "studiocue-assignment.ics",
                content: assignmentIcs({
                  assignmentId: assignment.id,
                  startsAt: arrivalAt,
                  endsAt: departureAt,
                  projectName: core.projectName,
                  role: text(assignment.get("role"), "Crew"),
                  location: assignmentPlace(assignment.get("locations")),
                  sequence: calendarSequence,
                  stampedAt: now,
                }),
              }
            : null,
        actionLabel: "Open the crew app",
        actionUrl: `${appUrl}/crew`,
        status: "queued",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      });
  }
  for (const cascade of cascades.docs)
    if (!["completed", "cancelled", "exhausted"].includes(text(cascade.get("status"))))
      batch.update(cascade.ref, {
        arrivalAt: shiftTimestamp(cascade.get("arrivalAt"), shift),
        departureAt: shiftTimestamp(cascade.get("departureAt"), shift),
        updatedAt: now,
      });
  const plan = await db.doc(`crewStaffingPlans/${projectId}`).get();
  if (plan.exists && plan.get("tenantId") === tenantId)
    batch.update(plan.ref, {
      arrivalAt: shiftTimestamp(plan.get("arrivalAt"), shift),
      departureAt: shiftTimestamp(plan.get("departureAt"), shift),
      updatedAt: now,
    });
  for (const event of calendarEvents.docs)
    batch.update(event.ref, {
      startsAt: shiftTimestamp(event.get("startsAt"), shift),
      endsAt: shiftTimestamp(event.get("endsAt"), shift),
      updatedAt: now,
    });

  // Due dates counted from the wedding.
  for (const checkpoint of checkpoints.docs) {
    const rule = obj(checkpoint.get("dueDateRule"));
    const due = text(checkpoint.get("resolvedDueDate"));
    if (rule.type === "relative" && rule.anchor === "event_date" && due)
      batch.update(checkpoint.ref, { resolvedDueDate: shiftDate(due, shift), updatedAt: now });
  }
  for (const response of questionnaires.docs) {
    const due = text(response.get("dueDate"));
    if (due && !["submitted", "complete", "locked"].includes(text(response.get("status"))))
      batch.update(response.ref, { dueDate: shiftDate(due, shift), updatedAt: now });
  }
  for (const requirement of requirements.docs)
    batch.update(requirement.ref, {
      eventDate: core.newDate,
      ...(text(requirement.get("dueDate")) ? { dueDate: shiftDate(text(requirement.get("dueDate")), shift) } : {}),
      updatedAt: now,
    });
  for (const request of requests.docs)
    if (!["approved", "sent_to_venue", "cancelled"].includes(text(request.get("status"))))
      batch.update(request.ref, {
        eventDate: core.newDate,
        ...(text(request.get("dueDate")) ? { dueDate: shiftDate(text(request.get("dueDate")), shift) } : {}),
        updatedAt: now,
      });

  // The studio's calendar and crew invites.
  batch.set(db.doc(`providerJobs/move_calendar_${amendmentId}`), {
    id: `move_calendar_${amendmentId}`,
    tenantId,
    projectId,
    type: "move_booking_calendar_events",
    idempotencyKey: `move-calendar-${amendmentId}`,
    status: "queued",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  });
  await batch.commit();
}

/**
 * The consultations the studio chose to move with the date. Each moves in
 * place — its id, and so its calendar event and Zoom meeting, stay the same —
 * and the same provider job as rescheduleConsultation updates both, which
 * sends the couple the updated invitation. A call rescheduled some other way
 * after the change was written up is left where it now is.
 */
async function moveConsultations(
  db: Firestore,
  core: {
    tenantId: string;
    projectId: string;
    consultationMoves: Array<{ consultationId: string; fromStartsAt: string; toStartsAt: string; toEndsAt: string }>;
  },
  amendmentId: string,
) {
  const now = new Date().toISOString();
  for (const move of core.consultationMoves) {
    const reference = db.doc(`consultations/${move.consultationId}`);
    const moved = await db.runTransaction(async (transaction) => {
      const consultation = await transaction.get(reference);
      if (
        !consultation.exists ||
        consultation.get("tenantId") !== core.tenantId ||
        consultation.get("projectId") !== core.projectId ||
        consultation.get("status") !== "scheduled" ||
        text(consultation.get("startsAt")) !== move.fromStartsAt
      )
        return false;
      transaction.update(reference, {
        startsAt: move.toStartsAt,
        endsAt: move.toEndsAt,
        rescheduledAt: now,
        rescheduledByAmendmentId: amendmentId,
        updatedAt: now,
        updatedBy: ACTOR,
      });
      transaction.set(db.doc(`providerJobs/consultresched_${amendmentId}_${move.consultationId}`), {
        tenantId: core.tenantId,
        projectId: core.projectId,
        consultationId: move.consultationId,
        type: "reschedule_consultation_resources",
        idempotencyKey: `amendment_${amendmentId}_${move.consultationId}`,
        status: "queued",
        createdAt: now,
      });
      return true;
    });
    if (!moved) logger.info("amendmentConsultationSkipped", { amendmentId, consultationId: move.consultationId });
  }
}

/**
 * What the couple asked for in their portal (packageRequests: a package or a
 * new date) is met once the change that gives it to them is signed, so their
 * portal says so and Today stops asking.
 */
async function settleCoupleRequests(
  db: Firestore,
  core: { tenantId: string; projectId: string; newDate: string },
  amendmentId: string,
) {
  const [requests, project] = await Promise.all([
    db
      .collection("packageRequests")
      .where("tenantId", "==", core.tenantId)
      .where("projectId", "==", core.projectId)
      .where("status", "==", "pending")
      .limit(20)
      .get(),
    db.doc(`projects/${core.projectId}`).get(),
  ]);
  if (requests.empty) return;
  const snapshotIds = [text(project.get("packageSnapshotId")), ...strings(project.get("additionalPackageSnapshotIds"))].filter(Boolean);
  const snapshots = await Promise.all(snapshotIds.map((id) => db.doc(`packageSnapshots/${id}`).get()));
  const onJob = new Set(snapshots.map((snapshot) => text(snapshot.get("packageId"))).filter(Boolean));
  const now = new Date().toISOString();
  const batch = db.batch();
  for (const request of requests.docs) {
    const met =
      text(request.get("kind")) === "date_change"
        ? text(request.get("requestedDate")) === core.newDate
        : onJob.has(text(request.get("packageId")));
    if (!met) continue;
    batch.update(request.ref, {
      status: "approved",
      decidedAt: now,
      decidedBy: ACTOR,
      resultAmendmentId: amendmentId,
      updatedAt: now,
    });
  }
  await batch.commit();
}

/**
 * Retried, as the job-dispatch triggers are (operations/task-queue.ts): a
 * transient failure in the apply used to leave the change at "signed" for
 * good — the couple had signed, the booking never took it. The same event is
 * redelivered, so the before/after guard below still holds, and applyAmendment
 * is idempotent (`appliedAt`). A failure that never clears is what the
 * studio's "Apply it again" (retryAmendmentApply) is for.
 */
export const bookingAmendmentSigned = onDocumentWritten(
  { document: "bookingAmendments/{amendmentId}", retry: true },
  async (event) => {
    const after = event.data?.after;
    const before = event.data?.before;
    if (!after?.exists || after.get("status") !== "signed") return;
    if (before?.exists && before.get("status") === "signed") return;
    await applyAmendment(getFirestore(), after.id);
  },
);
