/**
 * What a booking change on an imported job is written against
 * (contracts/amendments.ts `draftAmendment`).
 *
 * A change restates the accepted proposal: its packages, its price, its
 * payment schedule. A booking imported from before StudioCue has none — it
 * was agreed on paper — so "Change the booking" refused every imported job
 * with "no accepted proposal to change" (prod walk, 2026-10-27), and the date
 * of a wedding the studio had brought over could not be moved at all, since
 * Edit job sends a booked job's date here.
 *
 * The import recorded what was agreed, and that is the base: the job's
 * package snapshots (the contract total, and the retainer as paid plus owed),
 * its date and venue, and its client. The change, once signed, files as the
 * job's first accepted proposal (booking/amendment-apply.ts), so the next
 * change is written against that like any other booking's.
 *
 * Pure: amendments.ts reads the records and wraps this as the base.
 */

type Row = Record<string, unknown>;
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/** The id the stand-in base goes by. It is never a document in `proposals`. */
export const importedBaseProposalId = (projectId: string) => `imported_base_${projectId}`;

export function importedAmendmentBase(input: {
  projectId: string;
  project: Row;
  /** The job's package snapshots, the main one first, as the project lists them. */
  snapshots: ReadonlyArray<{ id: string; data: Row }>;
  /** Combined pricing over `snapshots` (proposals/combined-pricing.ts). */
  pricing: Row;
  /** Each snapshot's "what's included", as a proposal carries it. */
  packageDetails: unknown;
  /** The job's retainer invoices, paid and owed. */
  retainers: ReadonlyArray<Row>;
  client: { displayName: string; email: string };
}): Row {
  const project = input.project;
  const retainerCents = num(input.pricing.retainerCents);
  const totalCents = num(input.pricing.totalCents);
  // When the retainer was paid, as the import recorded it; owed, when it's due.
  const retainerDue =
    input.retainers
      .map((invoice) => text(invoice.dueDate))
      .filter(Boolean)
      .sort()[0] ?? null;
  return {
    id: importedBaseProposalId(input.projectId),
    tenantId: text(project.tenantId),
    projectId: input.projectId,
    version: 0,
    status: "accepted",
    /** Read back by the staleness check: there is no proposal document to re-read. */
    importedBase: true,
    packageSnapshotId: input.snapshots[0]?.id ?? "",
    additionalPackageSnapshotIds: input.snapshots.slice(1).map((snapshot) => snapshot.id),
    clientSnapshot: { displayName: input.client.displayName, email: input.client.email.toLowerCase() },
    eventSnapshot: {
      name: text(project.name) || "Photography project",
      eventType: text(project.eventType) || "Photography",
      eventDate: text(project.eventDate),
      timezone: text(project.timezone) || "UTC",
      venue: project.venueName ?? null,
    },
    pricingSnapshot: input.pricing,
    packageDetails: input.packageDetails,
    paymentSchedule: [
      { label: "Retainer", amountCents: retainerCents, dueDate: retainerDue },
      { label: "Final balance", amountCents: Math.max(0, totalCents - retainerCents), dueDate: null },
    ],
    hasPaymentPlan: false,
    retainerOverrideCents: retainerCents,
    expiresAt: null,
    notes: null,
    termsSummary: null,
  };
}
