import { packageDetails } from "../packages/inclusions.js";
import { isCataloguePackage } from "../packages/one-off.js";
import { randomUUID } from "node:crypto";
import { getFirestore, type DocumentSnapshot, type Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import { mintClientInvitation } from "../client/invitation-mint.js";
import { preparePartnerSends, queuePartnerSends } from "../client/partner-invitations.js";
import { combineSnapshotPricing } from "../proposals/combined-pricing.js";
import { pricePackage } from "../pricing/package-price.js";
import {
  coverageFromPhotographerCount,
  legacyPhotographerCount,
  resolveCoverage,
  type CoverageItem,
  type CoverageRole,
} from "../packages/coverage.js";
import { isStandingInvoice } from "../booking/invoice-standing.js";
import {
  amendmentChangeLines,
  amendmentMoney,
  consultationLabel,
  consultationWhen,
  daysBetween,
  isAmendableState,
  ISO_DATE,
  rangesOverlap,
  shiftDate,
  shiftInZone,
} from "../booking/amendment-core.js";
import { getCalendarBusyIntervals } from "../operations/provider-runtime.js";
import {
  nativeSigningEnabled,
  requireOwnerOrAdmin,
  resolveDraft,
  stableId,
  STUDIO_SIGNING_CONSENT_VERSION,
  STUDIO_SIGNING_STATEMENT,
  type CommandContext,
} from "./commands.js";
import { contractDocumentSchema, type ContractBlock, type ContractDocument } from "./document.js";
import { contractDocumentHash, sha256Text } from "./document-hash.js";
import { applyAmendment } from "../booking/amendment-apply.js";
import { clientOutreachStop, mayContactClient } from "../post-event/client-outreach.js";
import { resendBlockedUntil } from "./resend.js";

/**
 * Changing a signed booking: the studio's commands.
 *
 * draftAmendment         the new packages and/or date, priced, with the
 *                        amended agreement written out for the studio to read
 * sendAmendment          the owner signs it for the studio; the couple is asked
 *                        to sign in their portal
 * recordAmendmentSigned  the couple signed outside StudioCue (paper, the
 *                        studio's own agreement), and the studio vouches for it
 * cancelAmendment        withdraw a change not yet signed (the couple is told
 *                        when they had been sent it)
 * resendAmendment        email the couple the change to sign again, now
 * retryAmendmentApply    run the apply again for a signed change it failed on
 *
 * Nothing here changes the job. The change is applied when it is signed —
 * functions/src/booking/amendment-apply.ts, a trigger on the amendment —
 * so every path to "signed" (the couple in the portal, the studio's
 * attestation) applies it the same way. See ../booking/amendment-core.ts.
 */

export const draftAmendmentInput = z.object({
  projectId: z.string().min(1),
  /** The new wedding date; null or the current one leaves it as it is. */
  eventDate: z.string().regex(ISO_DATE).nullable().default(null),
  /** Packages already on the job that stay. */
  keepPackageSnapshotIds: z.array(z.string().min(1)).max(4),
  /** Packages from the studio's catalogue to add, at today's price. */
  addPackageIds: z.array(z.string().min(1)).max(3).default([]),
  /** The studio covers two weddings that day on purpose. */
  allowDateClash: z.boolean().default(false),
  /** Upcoming consultations to move by the same number of days as the date. */
  moveConsultationIds: z.array(z.string().min(1)).max(10).default([]),
  note: z.string().trim().max(1000).nullable().default(null),
});

export const sendAmendmentInput = z.object({
  amendmentId: z.string().min(1),
  documentHash: z.string().regex(/^[a-f0-9]{64}$/),
  studioSignerName: z.string().trim().min(2).max(160),
  consent: z.literal(true),
});

export const recordAmendmentSignedInput = z.object({
  amendmentId: z.string().min(1),
  signerName: z.string().trim().min(2).max(160),
  signedAt: z.string().regex(ISO_DATE),
  method: z.string().trim().min(2).max(200),
  attestation: z.literal(true),
});

export const cancelAmendmentInput = z.object({
  amendmentId: z.string().min(1),
  reason: z.string().trim().max(500).nullable().default(null),
});

export const resendAmendmentInput = z.object({
  amendmentId: z.string().min(1),
});

export const retryAmendmentApplyInput = z.object({
  amendmentId: z.string().min(1),
});

/**
 * The "please sign" email for a change: the one sendAmendment queues, and the
 * one resendAmendment queues again. `awaitingAmendmentId` lets the email worker
 * drop it if the change is signed or withdrawn before it goes.
 */
function amendmentReadyEmail(input: {
  id: string;
  tenantId: string;
  projectId: string;
  contactId: string | null;
  recipient: string;
  recipientName: string | null;
  projectName: string;
  changes: string[];
  actionUrl: string;
  amendmentId: string;
  timestamp: string;
  again: boolean;
}) {
  return {
    id: input.id,
    tenantId: input.tenantId,
    projectId: input.projectId,
    contactId: input.contactId,
    recipient: input.recipient,
    recipientName: input.recipientName,
    projectName: input.projectName,
    type: "manual_message",
    customSubject: input.again
      ? "Reminder: a change to your booking is waiting for your signature"
      : "Please review and sign a change to your booking",
    customBody: [
      input.again
        ? "A quick reminder: the change to your booking is ready for you to sign. Here's what changes:"
        : "We've written up the change to your booking. Here's what changes:",
      ...input.changes.map((line) => `• ${line}`),
      "Everything else stays as you agreed. Please read it through and sign when you're happy — the original agreement stands until you do.",
    ].join("\n"),
    actionLabel: "Review and sign",
    actionUrl: input.actionUrl,
    category: "contract",
    awaitingAmendmentId: input.amendmentId,
    status: "queued",
    attempts: 0,
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
  };
}

/** "2026-09-29" → "September 29, 2026", as the couple reads a date. */
function longSignedDate(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })
    : value;
}

export type ConsultationMove = {
  consultationId: string;
  label: string;
  timezone: string;
  fromStartsAt: string;
  fromEndsAt: string;
  toStartsAt: string;
  toEndsAt: string;
  /** Why the new time may not work, for the studio to see before sending. */
  clash: string | null;
};

async function plannedConsultationMoves(
  db: Firestore,
  tenantId: string,
  projectId: string,
  ids: string[],
  shift: number,
): Promise<ConsultationMove[]> {
  if (!ids.length || !shift) return [];
  const now = Date.now();
  const docs = await Promise.all([...new Set(ids)].map((id) => db.doc(`consultations/${id}`).get()));
  const moves: ConsultationMove[] = [];
  for (const consultation of docs) {
    if (
      !consultation.exists ||
      consultation.get("tenantId") !== tenantId ||
      consultation.get("projectId") !== projectId ||
      consultation.get("status") !== "scheduled"
    )
      throw new Error("CONSULTATION_NOT_RESCHEDULABLE");
    const fromStartsAt = text(consultation.get("startsAt"));
    const fromEndsAt = text(consultation.get("endsAt"));
    if (Date.parse(fromStartsAt) <= now) throw new Error("CONSULTATION_NOT_RESCHEDULABLE");
    const timezone = text(consultation.get("timezone"), "UTC");
    moves.push({
      consultationId: consultation.id,
      label: consultationLabel(consultation.get("mode")),
      timezone,
      fromStartsAt,
      fromEndsAt,
      toStartsAt: String(shiftInZone(fromStartsAt, shift, timezone)),
      toEndsAt: String(shiftInZone(fromEndsAt, shift, timezone)),
      clash: null,
    });
  }
  if (!moves.length) return moves;
  const windowStart = moves.map((move) => move.toStartsAt).sort()[0]!;
  const windowEnd = moves.map((move) => move.toEndsAt).sort().at(-1)!;
  const [busy, others] = await Promise.all([
    getCalendarBusyIntervals(tenantId, windowStart, windowEnd),
    db.collection("consultations").where("tenantId", "==", tenantId).where("status", "==", "scheduled").limit(300).get(),
  ]);
  for (const move of moves) {
    const other = others.docs.find(
      (candidate) =>
        !moves.some((each) => each.consultationId === candidate.id) &&
        rangesOverlap(move.toStartsAt, move.toEndsAt, text(candidate.get("startsAt")), text(candidate.get("endsAt"))),
    );
    if (other) move.clash = "Another consultation is booked at that time.";
    else if (busy.ok && busy.busy.some((interval) => rangesOverlap(move.toStartsAt, move.toEndsAt, interval.start, interval.end)))
      move.clash = "Your calendar is busy then.";
  }
  return moves;
}

const LIVE_AMENDMENT = new Set(["draft", "sent"]);
const DATE_HOLDING_STATES = new Set(["BOOKED", "PLANNING", "READY", "EVENT_COMPLETE"]);

const text = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const strings = (value: unknown) => (Array.isArray(value) ? value.map(String).filter(Boolean) : []);

function requireStudioRole(context: CommandContext) {
  if (!["studio_owner", "studio_admin", "studio_coordinator"].includes(String(context.membership.role)))
    throw new Error("FORBIDDEN");
}

function mayAccess(context: CommandContext, projectId: string) {
  const role = String(context.membership.role);
  if (role === "studio_owner" || role === "studio_admin") return true;
  return strings(context.membership.projectIds).includes(projectId);
}

function lineItems(data: Record<string, unknown>) {
  const basePriceCents = num(data.basePriceCents);
  const addOns = Array.isArray(data.addOns) ? data.addOns.map(obj) : [];
  return [
    {
      description: text(data.packageName, "Photography package"),
      quantity: 1,
      unitPriceCents: basePriceCents,
      totalCents: basePriceCents,
      kind: "package" as const,
      sourceId: text(data.packageId) || null,
    },
    ...addOns.map((item) => ({
      description: text(item.name, "Add-on"),
      quantity: Math.max(1, num(item.quantity)),
      unitPriceCents: num(item.unitPriceCents),
      totalCents: num(item.lineTotalCents),
      kind: "add_on" as const,
      sourceId: text(item.addOnId) || null,
    })),
  ];
}

function billedCrewCount(coverage: readonly CoverageItem[], billedRoles: readonly CoverageRole[] | undefined) {
  const roles = billedRoles?.length ? billedRoles : (["photographer"] as const);
  return Math.max(1, roles.reduce((sum, role) => sum + (coverage.find((item) => item.role === role)?.count ?? 0), 0));
}

/** A package from the catalogue, frozen at today's price — the same record selectPackage writes. */
function snapshotFromPackage(
  studioPackage: DocumentSnapshot,
  input: { tenantId: string; projectId: string; actorId: string; timestamp: string; amendmentId: string },
) {
  const data = studioPackage.data() as Record<string, unknown>;
  const retainerRule = obj(data.retainerRule) as
    | { type: "fixed"; amountCents: number }
    | { type: "percentage"; basisPoints: number }
    | { type: "per_crew_member"; amountPerCrewCents: number; billedRoles?: CoverageRole[] };
  const coverage = resolveCoverage(data as Parameters<typeof resolveCoverage>[0]);
  const priced = pricePackage({
    basePriceCents: num(data.basePriceCents),
    addOns: [],
    discount: { type: "none" },
    taxRateBasisPoints: num(data.taxRateBasisPoints),
    retainerRule,
    billedCrew:
      retainerRule.type === "per_crew_member" ? billedCrewCount(coverage, retainerRule.billedRoles) : 1,
  });
  const id = randomUUID();
  return {
    id,
    record: {
      id,
      tenantId: input.tenantId,
      projectId: input.projectId,
      packageId: studioPackage.id,
      packageVersion: num(data.version) || 1,
      packageName: text(data.name, "Package"),
      description: text(data.description),
      currency: text(data.currency, "USD"),
      basePriceCents: num(data.basePriceCents),
      addOns: [],
      discountCents: priced.discountCents,
      subtotalCents: priced.subtotalCents,
      taxCents: priced.taxCents,
      retainerCents: priced.retainerCents,
      totalCents: priced.totalCents,
      includedCoverageMinutes: num(data.includedCoverageMinutes),
      includedCoverage: coverage.map((item) => ({ ...item })),
      includedPhotographers: legacyPhotographerCount(coverage.length ? coverage : coverageFromPhotographerCount(1)),
      includedDeliverables: strings(data.includedDeliverables),
      ...(Array.isArray(data.deliverables) && data.deliverables.length ? { deliverables: data.deliverables } : {}),
      includedTravelArea: text(data.includedTravelArea),
      terms: text(data.terms),
      selectionDate: input.timestamp,
      selectedBy: input.actorId,
      // Chosen for a booking change; it becomes the job's when that is signed.
      amendmentId: input.amendmentId,
      immutable: true,
      createdAt: input.timestamp,
      createdBy: input.actorId,
    },
  };
}

/** Other live jobs on a day, archived ones excluded (they hold no date). */
async function dateHolders(db: Firestore, tenantId: string, projectId: string, eventDate: string) {
  const same = await db
    .collection("projects")
    .where("tenantId", "==", tenantId)
    .where("eventDate", "==", eventDate)
    .limit(20)
    .get();
  return same.docs.filter(
    (project) =>
      project.id !== projectId && !project.get("archivedAt") && DATE_HOLDING_STATES.has(text(project.get("state"))),
  );
}

async function latestAccepted(db: Firestore, tenantId: string, projectId: string) {
  const accepted = await db
    .collection("proposals")
    .where("tenantId", "==", tenantId)
    .where("projectId", "==", projectId)
    .where("status", "==", "accepted")
    .limit(10)
    .get();
  return accepted.docs.sort((a, b) => num(b.get("version")) - num(a.get("version")))[0] ?? null;
}

const paidOf = (invoice: DocumentSnapshot) => {
  const amount = num(invoice.get("amountCents"));
  const balance = typeof invoice.get("balanceCents") === "number" ? num(invoice.get("balanceCents")) : amount;
  return Math.max(0, amount - balance);
};

/** The change, written at the top of the agreement it restates. */
function amendedDocument(input: {
  base: ContractDocument;
  changes: string[];
  signedOn: string | null;
  note: string | null;
}): ContractDocument {
  const intro: ContractBlock[] = [
    { type: "heading", level: 1, content: [{ text: "What this changes" }] },
    {
      type: "paragraph",
      content: [
        {
          text: input.signedOn
            ? `This amends the agreement signed on ${longSignedDate(input.signedOn)}. It changes only what is listed here; the agreement below restates everything as it stands after the change, and replaces the earlier version once both parties sign.`
            : "This amends the earlier agreement. It changes only what is listed here; the agreement below restates everything as it stands after the change, and replaces the earlier version once both parties sign.",
        },
      ],
    },
    { type: "list", items: input.changes.map((line) => ({ content: [{ text: line }] })) },
    ...(input.note ? [{ type: "paragraph" as const, content: [{ text: input.note }] }] : []),
    { type: "heading", level: 1, content: [{ text: "The agreement as amended" }] },
  ];
  return {
    format: input.base.format,
    title: `Amendment: ${input.base.title}`.slice(0, 200),
    blocks: [...intro, ...input.base.blocks],
  };
}

export async function draftAmendment(context: CommandContext, input: z.infer<typeof draftAmendmentInput>) {
  requireStudioRole(context);
  if (!mayAccess(context, input.projectId)) throw new Error("FORBIDDEN");
  const db = getFirestore();
  const project = await db.doc(`projects/${input.projectId}`).get();
  if (!project.exists || project.get("tenantId") !== context.tenantId) throw new Error("PROJECT_NOT_FOUND");
  if (project.get("archivedAt")) throw new Error("PROJECT_ARCHIVED");
  if (!isAmendableState(project.get("state"))) throw new Error("AMENDMENT_NOT_AVAILABLE");

  const pendingId = text(project.get("pendingAmendmentId"));
  const pending = pendingId ? await db.doc(`bookingAmendments/${pendingId}`).get() : null;
  if (pending?.exists && pending.get("status") === "sent") throw new Error("AMENDMENT_ALREADY_SENT");
  const amendmentId =
    pending?.exists && pending.get("status") === "draft"
      ? pending.id
      : stableId("amendment", context.tenantId, context.idempotencyKey);

  const base = await latestAccepted(db, context.tenantId, input.projectId);
  if (!base) throw new Error("AMENDMENT_NEEDS_ACCEPTED_PROPOSAL");

  const currentIds = [text(project.get("packageSnapshotId")), ...strings(project.get("additionalPackageSnapshotIds"))].filter(
    Boolean,
  );
  const keep = input.keepPackageSnapshotIds.filter((id, index, all) => all.indexOf(id) === index);
  if (keep.some((id) => !currentIds.includes(id))) throw new Error("PACKAGE_NOT_ON_JOB");
  if (!keep.length && !input.addPackageIds.length) throw new Error("LAST_PACKAGE_ON_JOB");
  if (keep.length + input.addPackageIds.length > 4) throw new Error("PACKAGE_LIMIT_REACHED");

  const [currentSnapshots, addPackages, invoices, contracts] = await Promise.all([
    Promise.all(currentIds.map((id) => db.doc(`packageSnapshots/${id}`).get())),
    Promise.all(input.addPackageIds.map((id) => db.doc(`packages/${id}`).get())),
    db.collection("invoiceReferences").where("tenantId", "==", context.tenantId).where("projectId", "==", input.projectId).limit(40).get(),
    db.collection("contracts").where("tenantId", "==", context.tenantId).where("projectId", "==", input.projectId).limit(25).get(),
  ]);
  for (const studioPackage of addPackages)
    if (
      !studioPackage.exists ||
      studioPackage.get("tenantId") !== context.tenantId ||
      studioPackage.get("active") !== true ||
      // Another couple's one-off is not this booking's to take.
      !isCataloguePackage(studioPackage.data(), { projectId: input.projectId })
    )
      throw new Error("PACKAGE_NOT_FOUND");
  const onJobPackageIds = new Set(currentSnapshots.filter((snapshot) => keep.includes(snapshot.id)).map((snapshot) => text(snapshot.get("packageId"))));
  if (addPackages.some((studioPackage) => onJobPackageIds.has(studioPackage.id))) throw new Error("PACKAGE_ALREADY_ON_JOB");

  // The date.
  const previousDate = text(project.get("eventDate"));
  const newDate = input.eventDate && input.eventDate !== previousDate ? input.eventDate : previousDate;
  const dateChanged = newDate !== previousDate;
  let clashes: string[] = [];
  if (dateChanged) {
    clashes = (await dateHolders(db, context.tenantId, input.projectId, newDate)).map((other) => text(other.get("name"), "another job"));
    if (clashes.length && !input.allowDateClash) {
      const error = new Error(`DATE_TAKEN:${clashes.join(", ")}`);
      throw error;
    }
  }

  const removed = currentSnapshots.filter((snapshot) => !keep.includes(snapshot.id));
  if (!dateChanged && !removed.length && !input.addPackageIds.length) throw new Error("NOTHING_TO_CHANGE");

  // New snapshots for added packages; kept ones keep the price agreed.
  const created = addPackages.map((studioPackage) =>
    snapshotFromPackage(studioPackage, {
      tenantId: context.tenantId,
      projectId: input.projectId,
      actorId: context.actorId,
      timestamp: context.timestamp,
      amendmentId,
    }),
  );
  const keptSnapshots = keep.map((id) => currentSnapshots.find((snapshot) => snapshot.id === id)!);
  const nextSnapshots: Array<{ id: string; data: Record<string, unknown> }> = [
    ...keptSnapshots.map((snapshot) => ({ id: snapshot.id, data: snapshot.data() as Record<string, unknown> })),
    ...created.map((entry) => ({ id: entry.id, data: entry.record as Record<string, unknown> })),
  ];
  const pricing = combineSnapshotPricing(
    nextSnapshots.map(({ data }) => ({
      packageName: text(data.packageName, "Coverage package"),
      currency: text(data.currency, "USD"),
      subtotalCents: num(data.subtotalCents),
      discountCents: num(data.discountCents),
      taxCents: num(data.taxCents),
      retainerCents: num(data.retainerCents),
      totalCents: num(data.totalCents),
      lineItems: lineItems(data),
    })),
  );

  // Money: the retainer stays as agreed; what has been paid is kept.
  const baseSchedule = Array.isArray(base.get("paymentSchedule")) ? (base.get("paymentSchedule") as Array<Record<string, unknown>>) : [];
  const agreedRetainerCents = num(baseSchedule[0]?.amountCents) || num(obj(base.get("pricingSnapshot")).retainerCents);
  const previousTotalCents = num(obj(base.get("pricingSnapshot")).totalCents);
  const paidCents = invoices.docs.filter((invoice) => isStandingInvoice(invoice.get("status"))).reduce((sum, invoice) => sum + paidOf(invoice), 0);
  const money = amendmentMoney({
    previousTotalCents,
    newTotalCents: pricing.totalCents,
    agreedRetainerCents,
    paidCents,
  });
  const shift = daysBetween(previousDate, newDate);
  const balanceDue = text(baseSchedule[1]?.dueDate);
  const schedule = [
    { label: "Retainer", amountCents: money.retainerCents, dueDate: baseSchedule[0]?.dueDate ?? null },
    {
      label: "Final balance",
      amountCents: money.finalBalanceCents,
      // A balance due before the wedding moves with it.
      dueDate: balanceDue ? (dateChanged ? shiftDate(balanceDue, shift) : balanceDue) : null,
    },
  ];

  // Calls the studio chose to move with the date: same time of day, the same
  // number of days on. Checked against the studio's calendar and its other
  // consultations; a clash is shown, not refused — the studio decides.
  const consultationMoves = dateChanged
    ? await plannedConsultationMoves(db, context.tenantId, input.projectId, input.moveConsultationIds, shift)
    : [];

  const changes = amendmentChangeLines({
    movedCalls: consultationMoves.map((move) => ({
      label: move.label,
      from: consultationWhen(move.fromStartsAt, move.timezone),
      to: consultationWhen(move.toStartsAt, move.timezone),
    })),
    previousDate,
    newDate,
    keptPackages: keptSnapshots.map((snapshot) => text(snapshot.get("packageName"), "Package")),
    addedPackages: created.map((entry) => entry.record.packageName),
    removedPackages: removed.map((snapshot) => text(snapshot.get("packageName"), "Package")),
    money,
    currency: pricing.currency,
  });

  // The proposal the change becomes when signed. Held in its own collection
  // until then, so no reader of `proposals` takes it for the current one;
  // amendment-apply.ts files it as the accepted proposal.
  const proposalId = `amend_${amendmentId}`;
  const baseData = base.data() as Record<string, unknown>;
  const eventSnapshot = { ...obj(baseData.eventSnapshot), eventDate: newDate };
  const proposalRecord: Record<string, unknown> = {
    ...baseData,
    id: proposalId,
    version: num(baseData.version) + 1,
    status: "amendment_pending",
    amendmentId,
    supersedesProposalId: base.id,
    packageSnapshotId: nextSnapshots[0]!.id,
    additionalPackageSnapshotIds: nextSnapshots.slice(1).map((entry) => entry.id),
    pricingSnapshot: pricing,
    packageDetails: packageDetails(nextSnapshots),
    paymentSchedule: schedule,
    eventSnapshot,
    retainerOverrideCents: money.retainerCents,
    draftRevision: 1,
    submittedAt: null,
    approvedAt: null,
    approvedBy: null,
    sentAt: null,
    viewedAt: null,
    acceptedAt: null,
    acceptedBy: null,
    acceptanceAuthority: null,
    acceptanceEvidence: null,
    declinedAt: null,
    declineReason: null,
    combinedContractId: null,
    acceptedWithContractId: null,
    emailDeliveryStatus: "not_sent",
    emailMessageId: null,
    emailJobId: null,
    pdfDocumentId: null,
    pdfState: "not_requested",
    createdAt: context.timestamp,
    createdBy: context.actorId,
    updatedAt: context.timestamp,
    updatedBy: context.actorId,
  };

  const batch = db.batch();
  for (const entry of created) batch.create(db.doc(`packageSnapshots/${entry.id}`), entry.record);
  batch.set(db.doc(`amendmentProposals/${proposalId}`), proposalRecord);
  await batch.commit();

  // The amended agreement, where StudioCue writes the studio's agreements.
  const signedContract = contracts.docs
    .filter((contract) => contract.get("status") === "completed")
    .sort((a, b) => text(b.get("completedAt") ?? b.get("updatedAt")).localeCompare(text(a.get("completedAt") ?? a.get("updatedAt"))))[0];
  const native = await nativeSigningEnabled(db, context.tenantId);
  let document: ContractDocument | null = null;
  let documentHash: string | null = null;
  let unresolved: string[] = [];
  let clientName = "";
  let clientEmail: string | null = null;
  if (native) {
    try {
      const draft = await resolveDraft(db, {
        tenantId: context.tenantId,
        projectId: input.projectId,
        proposalId,
        templateVersionId: text(signedContract?.get("templateVersionId")) || null,
        overrides: (obj(signedContract?.get("mergeOverrides")) as Record<string, string>) ?? {},
        today: context.timestamp.slice(0, 10),
      });
      document = contractDocumentSchema.parse(
        amendedDocument({
          base: draft.resolved.document as ContractDocument,
          changes,
          signedOn: text(signedContract?.get("completedAt")).slice(0, 10) || null,
          note: input.note,
        }),
      );
      documentHash = contractDocumentHash(document);
      unresolved = draft.resolved.unresolved;
      clientName = draft.clientName;
      clientEmail = draft.clientEmail;
    } catch (caught) {
      // No agreement to write it from: the studio records the signature instead.
      if (!(caught instanceof Error) || caught.message !== "AGREEMENT_TEMPLATE_REQUIRED") throw caught;
    }
  }
  if (!clientEmail) {
    const contactId = strings(project.get("clientContactIds"))[0];
    const contact = contactId ? await db.doc(`contacts/${contactId}`).get() : null;
    clientEmail = text(contact?.get("email")) || null;
    clientName = clientName || text(contact?.get("displayName")) || text(contact?.get("firstName"), "The couple");
  }

  const amendmentReference = db.doc(`bookingAmendments/${amendmentId}`);
  const amendment = {
    id: amendmentId,
    tenantId: context.tenantId,
    projectId: input.projectId,
    status: "draft",
    signingMode: document ? "studiocue" : "record",
    base: {
      proposalId: base.id,
      contractId: signedContract?.id ?? null,
      eventDate: previousDate,
      packageSnapshotIds: currentIds,
      totalCents: previousTotalCents,
    },
    next: {
      eventDate: newDate,
      packageSnapshotIds: nextSnapshots.map((entry) => entry.id),
      totalCents: pricing.totalCents,
      paymentSchedule: schedule,
    },
    dateChanged,
    dateShiftDays: shift,
    dateClashes: clashes,
    consultationMoves,
    addedPackageSnapshotIds: created.map((entry) => entry.id),
    removedPackageSnapshotIds: removed.map((snapshot) => snapshot.id),
    money,
    currency: pricing.currency,
    changes,
    note: input.note,
    proposalId,
    document,
    documentHash,
    unresolvedFields: unresolved,
    clientName,
    clientEmail,
    studioSignature: null,
    clientSignature: null,
    sentAt: null,
    signedAt: null,
    appliedAt: null,
    cancelledAt: null,
    createdAt: pending?.exists ? pending.get("createdAt") : context.timestamp,
    createdBy: pending?.exists ? pending.get("createdBy") : context.actorId,
    updatedAt: context.timestamp,
    updatedBy: context.actorId,
  };
  const finish = db.batch();
  finish.set(amendmentReference, amendment);
  finish.update(project.ref, {
    pendingAmendmentId: amendmentId,
    updatedAt: context.timestamp,
    updatedBy: context.actorId,
  });
  const auditId = stableId("audit_amendment_drafted", context.tenantId, context.idempotencyKey);
  finish.set(db.doc(`auditEvents/${auditId}`), {
    id: auditId,
    tenantId: context.tenantId,
    projectId: input.projectId,
    actorId: context.actorId,
    actorType: "user",
    action: "booking.amendment_drafted",
    entityType: "bookingAmendment",
    entityId: amendmentId,
    timestamp: context.timestamp,
    before: { eventDate: previousDate, packageSnapshotIds: currentIds, totalCents: previousTotalCents },
    after: { eventDate: newDate, packageSnapshotIds: amendment.next.packageSnapshotIds, totalCents: pricing.totalCents },
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    correlationId: context.idempotencyKey,
    automationRunId: null,
    providerEventId: null,
  });
  await finish.commit();
  return {
    amendmentId,
    signingMode: amendment.signingMode,
    changes,
    money,
    dateClashes: clashes,
    documentHash,
    unresolved,
  };
}

async function liveAmendment(db: Firestore, context: CommandContext, amendmentId: string) {
  const amendment = await db.doc(`bookingAmendments/${amendmentId}`).get();
  if (!amendment.exists || amendment.get("tenantId") !== context.tenantId) throw new Error("AMENDMENT_NOT_FOUND");
  if (!mayAccess(context, text(amendment.get("projectId")))) throw new Error("FORBIDDEN");
  return amendment;
}

/** Why a change that is not a draft can't be signed and sent, by what it is now. */
function notDraftRefusal(status: unknown) {
  if (status === "draft") return;
  if (status === "cancelled") throw new Error("AMENDMENT_WITHDRAWN");
  if (status === "signed" || status === "applied") throw new Error("AMENDMENT_ALREADY_SIGNED");
  throw new Error("AMENDMENT_NOT_DRAFT");
}

/** The base the change was written against must still be the job's. */
async function requireStillCurrent(db: Firestore, amendment: DocumentSnapshot) {
  const project = await db.doc(`projects/${text(amendment.get("projectId"))}`).get();
  const base = obj(amendment.get("base"));
  const currentIds = [text(project.get("packageSnapshotId")), ...strings(project.get("additionalPackageSnapshotIds"))].filter(Boolean);
  const baseProposal = await db.doc(`proposals/${text(base.proposalId)}`).get();
  if (
    !project.exists ||
    project.get("pendingAmendmentId") !== amendment.id ||
    text(project.get("eventDate")) !== text(base.eventDate) ||
    currentIds.join(",") !== strings(base.packageSnapshotIds).join(",") ||
    baseProposal.get("status") !== "accepted"
  )
    throw new Error("AMENDMENT_STALE");
  return project;
}

export async function sendAmendment(context: CommandContext, input: z.infer<typeof sendAmendmentInput>) {
  requireOwnerOrAdmin(context.membership, "CONTRACT_SIGNING_PERMISSION_REQUIRED");
  const db = getFirestore();
  const amendment = await liveAmendment(db, context, input.amendmentId);
  // One code per cause: these used to share the contract's codes, whose copy
  // ("prepare it again", "reissue the proposal") named steps a booking change
  // does not have.
  notDraftRefusal(amendment.get("status"));
  if (amendment.get("signingMode") !== "studiocue" || !amendment.get("document")) throw new Error("AMENDMENT_RECORD_ONLY");
  if (amendment.get("documentHash") !== input.documentHash) throw new Error("AMENDMENT_CHANGED");
  const document = contractDocumentSchema.parse(amendment.get("document"));
  if (contractDocumentHash(document) !== input.documentHash) throw new Error("AMENDMENT_CHANGED");
  if ((amendment.get("unresolvedFields") as unknown[] | undefined)?.length) throw new Error("AMENDMENT_FIELDS_MISSING");
  const clientEmail = text(amendment.get("clientEmail"));
  if (!clientEmail) throw new Error("AMENDMENT_CLIENT_EMAIL_REQUIRED");
  const project = await requireStillCurrent(db, amendment);
  const projectId = project.id;
  const clientContactId = strings(project.get("clientContactIds"))[0] ?? "";
  const contact = clientContactId ? await db.doc(`contacts/${clientContactId}`).get() : null;
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://studio-cue.com").replace(/\/$/, "");
  const path = "/client/contract";
  const invitation =
    !contact?.get("portalUserId") && clientContactId
      ? mintClientInvitation({ tenantId: context.tenantId, projectId, email: clientEmail, appUrl, next: path })
      : null;
  const signatureId = `${amendment.id}_studio`;
  const changes = strings(amendment.get("changes"));
  const batch = db.batch();
  batch.create(db.doc(`contractSignatures/${signatureId}`), {
    id: signatureId,
    tenantId: context.tenantId,
    projectId,
    amendmentId: amendment.id,
    contractId: null,
    role: "studio",
    signerUid: context.actorId,
    signerEmail: context.actorEmail,
    typedName: input.studioSignerName,
    documentHash: input.documentHash,
    consentVersion: STUDIO_SIGNING_CONSENT_VERSION,
    consentTextHash: sha256Text(STUDIO_SIGNING_STATEMENT),
    authMethod: context.authMethod,
    emailVerified: context.emailVerified,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    signedAt: context.timestamp,
    createdAt: context.timestamp,
  });
  batch.update(amendment.ref, {
    status: "sent",
    sentAt: context.timestamp,
    studioSignature: {
      id: signatureId,
      typedName: input.studioSignerName,
      signedAt: context.timestamp,
      email: context.actorEmail,
    },
    updatedAt: context.timestamp,
    updatedBy: context.actorId,
  });
  batch.update(project.ref, {
    nextAction: "Waiting for the couple to sign the booking change",
    updatedAt: context.timestamp,
    updatedBy: context.actorId,
  });
  const emailJobId = `amendment_ready_${amendment.id}`;
  // The partner gets their own copy, with their own link
  // (client/partner-invitations.ts).
  const partnerSends = await preparePartnerSends(db, (reference) => reference.get(), {
    tenantId: context.tenantId,
    projectId,
    clientContactIds: project.get("clientContactIds"),
    primaryContactId: clientContactId,
    primaryEmail: clientEmail,
    primaryNeedsInvite: invitation !== null,
    primaryEmailJobId: emailJobId,
    appUrl,
    path,
    actorId: context.actorId,
    now: context.timestamp,
  });
  const readyEmail = {
    ...amendmentReadyEmail({
      id: emailJobId,
      tenantId: context.tenantId,
      projectId,
      contactId: clientContactId || null,
      recipient: clientEmail,
      recipientName: text(amendment.get("clientName")) || null,
      projectName: text(project.get("name")),
      changes,
      actionUrl: invitation ? invitation.inviteUrl : `${appUrl}${path}`,
      amendmentId: amendment.id,
      timestamp: context.timestamp,
      again: false,
    }),
    soleRecipient: partnerSends.length > 0,
  };
  batch.set(db.doc(`emailJobs/${emailJobId}`), readyEmail);
  queuePartnerSends(db, batch, readyEmail, partnerSends);
  if (invitation && clientContactId) {
    batch.set(
      db.doc(`clientInvitations/${invitation.invitationId}`),
      {
        id: invitation.invitationId,
        tenantId: context.tenantId,
        projectId,
        contactId: clientContactId,
        email: invitation.email,
        normalizedEmail: invitation.email,
        status: "pending",
        tokenHash: invitation.tokenHash,
        expiresAt: invitation.expiresAt,
        acceptedAt: null,
        acceptedBy: null,
        revokedAt: null,
        lastSentAt: context.timestamp,
        latestEmailJobId: emailJobId,
        sendCount: 1,
        createdAt: context.timestamp,
        updatedAt: context.timestamp,
        createdBy: context.actorId,
        updatedBy: context.actorId,
        archivedAt: null,
      },
      { merge: true },
    );
  }
  const auditId = stableId("audit_amendment_sent", context.tenantId, context.idempotencyKey);
  batch.set(db.doc(`auditEvents/${auditId}`), {
    id: auditId,
    tenantId: context.tenantId,
    projectId,
    actorId: context.actorId,
    actorType: "user",
    action: "booking.amendment_signed_by_studio_and_sent",
    entityType: "bookingAmendment",
    entityId: amendment.id,
    timestamp: context.timestamp,
    before: { status: "draft" },
    after: { status: "sent", documentHash: input.documentHash, studioSignerName: input.studioSignerName },
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    correlationId: context.idempotencyKey,
    automationRunId: null,
    providerEventId: null,
  });
  await batch.commit();
  return { amendmentId: amendment.id, status: "sent" };
}

export async function recordAmendmentSigned(
  context: CommandContext,
  input: z.infer<typeof recordAmendmentSignedInput>,
) {
  requireOwnerOrAdmin(context.membership, "SIGNATURE_ATTESTATION_PERMISSION_REQUIRED");
  const db = getFirestore();
  const amendment = await liveAmendment(db, context, input.amendmentId);
  if (amendment.get("status") === "signed" || amendment.get("status") === "applied")
    return { amendmentId: amendment.id, status: String(amendment.get("status")), alreadySigned: true };
  // Signed and applied returned above, so the only other status is withdrawn.
  if (!LIVE_AMENDMENT.has(text(amendment.get("status")))) throw new Error("AMENDMENT_WITHDRAWN");
  const project = await requireStillCurrent(db, amendment);
  const batch = db.batch();
  batch.update(amendment.ref, {
    status: "signed",
    signedAt: `${input.signedAt}T12:00:00.000Z`,
    clientSignature: {
      kind: "manual_attested",
      typedName: input.signerName,
      signedOn: input.signedAt,
      method: input.method,
      attestedBy: context.actorId,
      attestedAt: context.timestamp,
    },
    updatedAt: context.timestamp,
    updatedBy: context.actorId,
  });
  const auditId = stableId("audit_amendment_attested", context.tenantId, context.idempotencyKey);
  batch.set(db.doc(`auditEvents/${auditId}`), {
    id: auditId,
    tenantId: context.tenantId,
    projectId: project.id,
    actorId: context.actorId,
    actorType: "user",
    action: "booking.amendment_signature_attested",
    entityType: "bookingAmendment",
    entityId: amendment.id,
    timestamp: context.timestamp,
    before: { status: amendment.get("status") },
    after: { status: "signed", signerName: input.signerName, signedAt: input.signedAt, method: input.method },
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    correlationId: context.idempotencyKey,
    automationRunId: null,
    providerEventId: null,
  });
  await batch.commit();
  return { amendmentId: amendment.id, status: "signed" };
}

export async function cancelAmendment(context: CommandContext, input: z.infer<typeof cancelAmendmentInput>) {
  requireStudioRole(context);
  const db = getFirestore();
  const amendment = await liveAmendment(db, context, input.amendmentId);
  if (amendment.get("status") === "cancelled") return { amendmentId: amendment.id, status: "cancelled" };
  if (!LIVE_AMENDMENT.has(text(amendment.get("status")))) throw new Error("AMENDMENT_ALREADY_SIGNED");
  const projectReference = db.doc(`projects/${text(amendment.get("projectId"))}`);
  let coupleTold = false;
  await db.runTransaction(async (transaction) => {
    const [current, project] = await Promise.all([transaction.get(amendment.ref), transaction.get(projectReference)]);
    if (!LIVE_AMENDMENT.has(text(current.get("status")))) throw new Error("AMENDMENT_ALREADY_SIGNED");
    // A change the couple was sent sat in their inbox and portal asking for a
    // signature; withdrawing it used to make it vanish with no word, so they
    // were left wondering whether their booking had changed. It has not: say
    // so. A draft they never saw needs no email.
    const clientEmail = text(current.get("clientEmail"));
    coupleTold = current.get("status") === "sent" && Boolean(clientEmail);
    if (coupleTold)
      transaction.set(db.doc(`emailJobs/amendment_withdrawn_${amendment.id}`), {
        id: `amendment_withdrawn_${amendment.id}`,
        tenantId: context.tenantId,
        projectId: projectReference.id,
        contactId: strings(project.get("clientContactIds"))[0] ?? null,
        recipient: clientEmail,
        recipientName: text(current.get("clientName")) || null,
        projectName: text(project.get("name")) || null,
        type: "amendment_withdrawn",
        amendmentId: amendment.id,
        changes: strings(current.get("changes")),
        status: "queued",
        attempts: 0,
        createdAt: context.timestamp,
        updatedAt: context.timestamp,
      });
    transaction.update(amendment.ref, {
      status: "cancelled",
      cancelledAt: context.timestamp,
      cancelReason: input.reason,
      updatedAt: context.timestamp,
      updatedBy: context.actorId,
    });
    transaction.set(
      db.doc(`amendmentProposals/${text(amendment.get("proposalId"))}`),
      { status: "withdrawn", updatedAt: context.timestamp, updatedBy: context.actorId },
      { merge: true },
    );
    if (project.get("pendingAmendmentId") === amendment.id)
      transaction.update(projectReference, {
        pendingAmendmentId: null,
        ...(current.get("status") === "sent" ? { nextAction: null } : {}),
        updatedAt: context.timestamp,
        updatedBy: context.actorId,
      });
    const auditId = stableId("audit_amendment_cancelled", context.tenantId, context.idempotencyKey);
    transaction.set(db.doc(`auditEvents/${auditId}`), {
      id: auditId,
      tenantId: context.tenantId,
      projectId: projectReference.id,
      actorId: context.actorId,
      actorType: "user",
      action: "booking.amendment_cancelled",
      entityType: "bookingAmendment",
      entityId: amendment.id,
      timestamp: context.timestamp,
      before: { status: current.get("status") },
      after: { status: "cancelled", reason: input.reason, coupleTold },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      correlationId: context.idempotencyKey,
      automationRunId: null,
      providerEventId: null,
    });
  });
  return { amendmentId: amendment.id, status: "cancelled", coupleTold };
}

/**
 * Email the couple the change to sign again, now.
 *
 * The 3- and 7-day reminders cover contracts only; a booking change had no
 * way to reach the couple a second time at all. Owner/admin, as sending it
 * was; at most once an hour (./resend.ts).
 */
export async function resendAmendment(context: CommandContext, input: z.infer<typeof resendAmendmentInput>) {
  requireOwnerOrAdmin(context.membership, "CONTRACT_SIGNING_PERMISSION_REQUIRED");
  const db = getFirestore();
  const amendment = await liveAmendment(db, context, input.amendmentId);
  const status = text(amendment.get("status"));
  if (status === "cancelled") throw new Error("AMENDMENT_WITHDRAWN");
  if (status === "signed" || status === "applied") throw new Error("AMENDMENT_ALREADY_SIGNED");
  if (status !== "sent") throw new Error("AMENDMENT_NOT_SENT");
  const clientEmail = text(amendment.get("clientEmail"));
  if (!clientEmail) throw new Error("AMENDMENT_CLIENT_EMAIL_REQUIRED");
  const project = await db.doc(`projects/${text(amendment.get("projectId"))}`).get();
  const projectData = project.exists && project.get("tenantId") === context.tenantId ? project.data() : null;
  if (!mayContactClient(projectData))
    throw new Error(`CLIENT_OUTREACH_STOPPED:${clientOutreachStop(projectData) ?? "job_missing"}`);
  const clientContactId = strings(project.get("clientContactIds"))[0] ?? "";
  const contact = clientContactId ? await db.doc(`contacts/${clientContactId}`).get() : null;
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://studio-cue.com").replace(/\/$/, "");
  const path = "/client/contract";
  const result = await db.runTransaction(async (transaction) => {
    const current = await transaction.get(amendment.ref);
    if (current.get("status") !== "sent") throw new Error("AMENDMENT_NOT_SENT");
    const blockedUntil = resendBlockedUntil(
      [current.get("sentAt"), current.get("lastResentAt")],
      Date.parse(context.timestamp),
    );
    if (blockedUntil) throw new Error(`RESEND_TOO_SOON:${blockedUntil}`);
    const count = num(current.get("resendCount")) + 1;
    // A couple still without a portal account gets a fresh invitation link;
    // the id is theirs for this job, so it replaces the last one's token.
    const invitation =
      !contact?.get("portalUserId") && clientContactId
        ? mintClientInvitation({ tenantId: context.tenantId, projectId: project.id, email: clientEmail, appUrl, next: path })
        : null;
    const emailJobId = `amendment_ready_${amendment.id}_again_${count}`;
    const partnerSends = await preparePartnerSends(db, (reference) => transaction.get(reference), {
      tenantId: context.tenantId,
      projectId: project.id,
      clientContactIds: project.get("clientContactIds"),
      primaryContactId: clientContactId,
      primaryEmail: clientEmail,
      primaryNeedsInvite: invitation !== null,
      primaryEmailJobId: emailJobId,
      appUrl,
      path,
      actorId: context.actorId,
      now: context.timestamp,
    });
    const readyEmail = {
      ...amendmentReadyEmail({
        id: emailJobId,
        tenantId: context.tenantId,
        projectId: project.id,
        contactId: clientContactId || null,
        recipient: clientEmail,
        recipientName: text(current.get("clientName")) || null,
        projectName: text(project.get("name")),
        changes: strings(current.get("changes")),
        actionUrl: invitation ? invitation.inviteUrl : `${appUrl}${path}`,
        amendmentId: amendment.id,
        timestamp: context.timestamp,
        again: true,
      }),
      soleRecipient: partnerSends.length > 0,
    };
    transaction.create(db.doc(`emailJobs/${emailJobId}`), readyEmail);
    queuePartnerSends(db, transaction, readyEmail, partnerSends);
    if (invitation)
      transaction.set(
        db.doc(`clientInvitations/${invitation.invitationId}`),
        {
          id: invitation.invitationId,
          tenantId: context.tenantId,
          projectId: project.id,
          contactId: clientContactId,
          email: invitation.email,
          normalizedEmail: invitation.email,
          status: "pending",
          tokenHash: invitation.tokenHash,
          expiresAt: invitation.expiresAt,
          revokedAt: null,
          lastSentAt: context.timestamp,
          latestEmailJobId: emailJobId,
          updatedAt: context.timestamp,
          updatedBy: context.actorId,
        },
        { merge: true },
      );
    transaction.update(amendment.ref, { lastResentAt: context.timestamp, resendCount: count });
    const auditId = stableId("audit_amendment_resent", context.tenantId, context.idempotencyKey);
    transaction.set(db.doc(`auditEvents/${auditId}`), {
      id: auditId,
      tenantId: context.tenantId,
      projectId: project.id,
      actorId: context.actorId,
      actorType: "user",
      action: "booking.amendment_resent",
      entityType: "bookingAmendment",
      entityId: amendment.id,
      timestamp: context.timestamp,
      before: { resendCount: count - 1 },
      after: { resendCount: count, emailJobId },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      correlationId: context.idempotencyKey,
      automationRunId: null,
      providerEventId: null,
    });
    return { amendmentId: amendment.id, emailJobId, resendCount: count };
  });
  return result;
}

/**
 * The couple signed, and the change did not go through.
 *
 * The apply runs in a trigger (../booking/amendment-apply.ts). When it failed,
 * the change sat at "signed" for good: the booking kept the old date and
 * packages, and Withdraw refused because it was signed. This runs the same
 * apply again, as the studio. It is idempotent — `appliedAt` is set once — so
 * pressing it on a change that has meanwhile gone through does nothing.
 */
export async function retryAmendmentApply(context: CommandContext, input: z.infer<typeof retryAmendmentApplyInput>) {
  requireOwnerOrAdmin(context.membership, "CONTRACT_SIGNING_PERMISSION_REQUIRED");
  const db = getFirestore();
  const amendment = await liveAmendment(db, context, input.amendmentId);
  const status = text(amendment.get("status"));
  if (status === "applied" || amendment.get("appliedAt")) return { amendmentId: amendment.id, status: "applied", applied: true };
  if (status !== "signed") throw new Error("AMENDMENT_NOT_SIGNED");
  const auditId = stableId("audit_amendment_apply_retried", context.tenantId, context.idempotencyKey);
  await db.doc(`auditEvents/${auditId}`).set({
    id: auditId,
    tenantId: context.tenantId,
    projectId: text(amendment.get("projectId")),
    actorId: context.actorId,
    actorType: "user",
    action: "booking.amendment_apply_retried",
    entityType: "bookingAmendment",
    entityId: amendment.id,
    timestamp: context.timestamp,
    before: { status },
    after: null,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    correlationId: context.idempotencyKey,
    automationRunId: null,
    providerEventId: null,
  });
  let outcome: { applied: boolean };
  try {
    outcome = await applyAmendment(db, amendment.id);
  } catch (caught: unknown) {
    console.error("amendment apply retry failed", amendment.id, caught);
    throw new Error("AMENDMENT_APPLY_FAILED");
  }
  const after = await amendment.ref.get();
  // Nothing thrown and still not applied: a record the change depends on is
  // gone (applyAmendment returns rather than guesses). Say so, not "done".
  if (!outcome.applied && after.get("status") !== "applied") throw new Error("AMENDMENT_APPLY_FAILED");
  return { amendmentId: amendment.id, status: "applied", applied: true };
}
