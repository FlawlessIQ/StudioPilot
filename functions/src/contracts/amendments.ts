import { randomUUID } from "node:crypto";
import { getFirestore, type DocumentSnapshot, type Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import { mintClientInvitation } from "../client/invitation-mint.js";
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
  daysBetween,
  isAmendableState,
  ISO_DATE,
  shiftDate,
} from "../booking/amendment-core.js";
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

/**
 * Changing a signed booking: the studio's commands.
 *
 * draftAmendment         the new packages and/or date, priced, with the
 *                        amended agreement written out for the studio to read
 * sendAmendment          the owner signs it for the studio; the couple is asked
 *                        to sign in their portal
 * recordAmendmentSigned  the couple signed outside StudioCue (paper, the
 *                        studio's own agreement), and the studio vouches for it
 * cancelAmendment        withdraw a change not yet signed
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

/** "2026-09-29" → "September 29, 2026", as the couple reads a date. */
function longSignedDate(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })
    : value;
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
    if (!studioPackage.exists || studioPackage.get("tenantId") !== context.tenantId || studioPackage.get("active") !== true)
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

  const changes = amendmentChangeLines({
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
  if (amendment.get("status") !== "draft") throw new Error("AMENDMENT_NOT_DRAFT");
  if (amendment.get("signingMode") !== "studiocue" || !amendment.get("document")) throw new Error("AMENDMENT_RECORD_ONLY");
  if (amendment.get("documentHash") !== input.documentHash) throw new Error("CONTRACT_CHANGED");
  const document = contractDocumentSchema.parse(amendment.get("document"));
  if (contractDocumentHash(document) !== input.documentHash) throw new Error("CONTRACT_CHANGED");
  if ((amendment.get("unresolvedFields") as unknown[] | undefined)?.length) throw new Error("CONTRACT_FIELDS_MISSING");
  const clientEmail = text(amendment.get("clientEmail"));
  if (!clientEmail) throw new Error("CLIENT_EMAIL_REQUIRED");
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
  batch.set(db.doc(`emailJobs/${emailJobId}`), {
    id: emailJobId,
    tenantId: context.tenantId,
    projectId,
    contactId: clientContactId || null,
    recipient: clientEmail,
    recipientName: text(amendment.get("clientName")) || null,
    projectName: text(project.get("name")),
    type: "manual_message",
    customSubject: "Please review and sign a change to your booking",
    customBody: [
      "We've written up the change to your booking. Here's what changes:",
      ...changes.map((line) => `• ${line}`),
      "Everything else stays as you agreed. Please read it through and sign when you're happy — the original agreement stands until you do.",
    ].join("\n"),
    actionLabel: "Review and sign",
    actionUrl: invitation ? invitation.inviteUrl : `${appUrl}${path}`,
    category: "contract",
    status: "queued",
    attempts: 0,
    createdAt: context.timestamp,
    updatedAt: context.timestamp,
  });
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
  if (!LIVE_AMENDMENT.has(text(amendment.get("status")))) throw new Error("AMENDMENT_NOT_DRAFT");
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
  await db.runTransaction(async (transaction) => {
    const [current, project] = await Promise.all([transaction.get(amendment.ref), transaction.get(projectReference)]);
    if (!LIVE_AMENDMENT.has(text(current.get("status")))) throw new Error("AMENDMENT_ALREADY_SIGNED");
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
      after: { status: "cancelled", reason: input.reason },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      correlationId: context.idempotencyKey,
      automationRunId: null,
      providerEventId: null,
    });
  });
  return { amendmentId: amendment.id, status: "cancelled" };
}
