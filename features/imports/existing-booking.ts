import { z } from "zod";

/**
 * Bringing a booking a studio already has into StudioCue.
 *
 * A studio adopting StudioCue has a year of weddings it booked somewhere else:
 * contract signed, retainer paid. The product had no way to hold one. A
 * project could only start as a lead, and the only route to "booked" was the
 * live booking path — which, walked for an old booking, emails the couple
 * "You're booked", raises a fresh retainer invoice in QuickBooks, and dates the
 * workflow from today. It also could not be walked at all for most of them:
 * it prices from the studio's current package and refuses a $0 retainer.
 *
 * So an imported booking is its own kind of evidence, stated plainly:
 * `completionAuthority: "imported"` — "this booking predates StudioCue, and
 * this studio member vouched for it on this date". It is never dressed up as a
 * provider signature, and never replayed through the manual-attestation
 * commands whose side effects exist for live bookings. See
 * docs/adr/0005-imported-booking-evidence.md.
 *
 * And it arrives quiet. `clientAutomationsPausedAt` holds back everything that
 * would otherwise reach a couple the studio booked months ago, until the
 * studio chooses to bring them in.
 *
 * Pure and deterministic. Duplicated at functions/src/imports/existing-booking.ts;
 * tests/existing-booking-import.test.ts keeps the copies identical.
 */

/** The only states an import may land in. Earlier work has no evidence to import; later work needs its own records. */
export const importableBookingStates = ["BOOKED", "PLANNING"] as const;
export type ImportableBookingState = (typeof importableBookingStates)[number];

/** Authorities that mean "a studio member vouched for this", not a provider. */
export const studioVouchedAuthorities: readonly string[] = [
  "manual_attested",
  "imported",
];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const existingBookingSchema = z.object({
  clients: z
    .array(
      z.object({
        firstName: z.string().trim().min(1).max(80),
        lastName: z.string().trim().min(1).max(80),
        email: z.string().trim().toLowerCase().email().max(254).nullable(),
        phone: z.string().trim().max(30).nullable(),
      }),
    )
    .min(1)
    .max(2),
  /** Null means "name it from the couple". */
  projectName: z.string().trim().min(2).max(160).nullable(),
  eventTypeId: z.string().trim().min(1).max(40),
  eventType: z.string().trim().min(2).max(80),
  eventDate: isoDate,
  timezone: z.string().trim().min(1).max(80),
  venueName: z.string().trim().max(160).nullable(),
  city: z.string().trim().max(120).nullable(),
  state: z.enum(importableBookingStates),
  /** What the contract called it — not a package in the studio's catalogue. */
  packageName: z.string().trim().min(1).max(160),
  /**
   * What the contract covers. These are not decoration: the crew counts drive
   * the additional-crew check and how many crew get offered the job, and the
   * couple's portal shows them.
   *
   * `videographers` is optional because a booking imported before the studio
   * could count them sent none, and those imports are still correct.
   */
  coverageMinutes: z.number().int().positive().max(24 * 60),
  photographers: z.number().int().nonnegative().max(10),
  videographers: z.number().int().nonnegative().max(10).optional(),
  currency: z.string().trim().toUpperCase().length(3),
  /** The contract total, tax included, in cents. */
  totalCents: z.number().int().nonnegative().max(100_000_000),
  taxCents: z.number().int().nonnegative().max(100_000_000),
  signedOn: isoDate,
  signerName: z.string().trim().min(1).max(160),
  /**
   * Whether the studio has the signed copy to attach. The file itself is filed
   * after the import, because a contract lives in its project's folder and the
   * project does not exist until the import creates it.
   */
  hasSignedCopy: z.boolean(),
  /** Everything the couple has paid before StudioCue. */
  payments: z
    .array(
      z.object({
        amountCents: z.number().int().positive().max(100_000_000),
        paidOn: isoDate,
        method: z.string().trim().min(1).max(120),
      }),
    )
    .max(20),
  notes: z.string().trim().max(2000).nullable(),
});
export type ExistingBooking = z.infer<typeof existingBookingSchema>;

export type ExistingBookingIssueCode =
  | "INVALID_DATE"
  | "PRIMARY_EMAIL_REQUIRED"
  | "DUPLICATE_CLIENT_EMAIL"
  | "EVENT_ALREADY_HAPPENED"
  | "SIGNED_IN_FUTURE"
  | "SIGNED_AFTER_EVENT"
  | "PAYMENT_IN_FUTURE"
  | "PAID_MORE_THAN_TOTAL"
  | "TAX_EXCEEDS_TOTAL"
  | "NO_PAYMENTS_RECORDED"
  | "NO_SIGNED_COPY";

export type ExistingBookingIssue = {
  code: ExistingBookingIssueCode;
  severity: "error" | "warning";
  message: string;
};

function realDate(value: string): boolean {
  const parsed = new Date(`${value}T12:00:00.000Z`);
  return (
    !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
  );
}

export function paidToDateCents(booking: Pick<ExistingBooking, "payments">): number {
  return booking.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
}

export function balanceOwedCents(
  booking: Pick<ExistingBooking, "payments" | "totalCents">,
): number {
  return Math.max(0, booking.totalCents - paidToDateCents(booking));
}

/**
 * What stops an import, and what only deserves a second look.
 *
 * Errors are things the product would otherwise hold as fact and get wrong: a
 * couple who paid more than the contract, a signature dated after the wedding,
 * a booking with nobody to reach. Warnings are gaps a studio may knowingly
 * have — no signed copy to hand, nothing paid yet.
 */
export function assessExistingBooking(
  booking: ExistingBooking,
  today: string,
): ExistingBookingIssue[] {
  const issues: ExistingBookingIssue[] = [];
  const error = (code: ExistingBookingIssueCode, message: string) =>
    issues.push({ code, severity: "error", message });
  const warning = (code: ExistingBookingIssueCode, message: string) =>
    issues.push({ code, severity: "warning", message });

  const dates = [
    booking.eventDate,
    booking.signedOn,
    ...booking.payments.map((payment) => payment.paidOn),
  ];
  if (dates.some((value) => !realDate(value))) {
    error("INVALID_DATE", "One of the dates isn't a real calendar date.");
    return issues;
  }

  const primary = booking.clients[0]!;
  if (!primary.email)
    error(
      "PRIMARY_EMAIL_REQUIRED",
      `Add an email for ${primary.firstName}. It's how they'll reach their portal when you bring them in.`,
    );
  const second = booking.clients[1];
  if (primary.email && second?.email && primary.email === second.email)
    error(
      "DUPLICATE_CLIENT_EMAIL",
      "Both clients have the same email. Give the second one their own, or leave it blank.",
    );

  if (booking.eventDate < today)
    error(
      "EVENT_ALREADY_HAPPENED",
      `The event was on ${booking.eventDate}. Only upcoming weddings can be imported for now.`,
    );
  if (booking.signedOn > today)
    error(
      "SIGNED_IN_FUTURE",
      `The contract is dated ${booking.signedOn}, which hasn't happened yet.`,
    );
  if (booking.signedOn > booking.eventDate)
    error(
      "SIGNED_AFTER_EVENT",
      "The contract is dated after the event. Check the signing date.",
    );
  if (booking.payments.some((payment) => payment.paidOn > today))
    error(
      "PAYMENT_IN_FUTURE",
      "A payment is dated in the future. Only record money already received.",
    );
  if (paidToDateCents(booking) > booking.totalCents)
    error(
      "PAID_MORE_THAN_TOTAL",
      "The payments add up to more than the contract total. Check the amounts.",
    );
  if (booking.taxCents > booking.totalCents)
    error(
      "TAX_EXCEEDS_TOTAL",
      "The tax is more than the contract total. The total should include tax.",
    );

  if (booking.payments.length === 0)
    warning(
      "NO_PAYMENTS_RECORDED",
      "No payments recorded, so the whole contract total will show as owed.",
    );
  if (!booking.hasSignedCopy)
    warning(
      "NO_SIGNED_COPY",
      "No signed copy attached. You can still import it; keep the signed contract somewhere safe.",
    );
  return issues;
}

export function importBlocked(issues: readonly ExistingBookingIssue[]): boolean {
  return issues.some((issue) => issue.severity === "error");
}

/** "Maya & Theo Johnson", "Maya Johnson & Theo Reed", or "Maya Johnson". */
export function defaultBookingName(
  clients: ExistingBooking["clients"],
): string {
  const [first, second] = clients;
  if (!second) return `${first!.firstName} ${first!.lastName}`;
  if (first!.lastName.toLowerCase() === second.lastName.toLowerCase())
    return `${first!.firstName} & ${second.firstName} ${second.lastName}`;
  return `${first!.firstName} ${first!.lastName} & ${second.firstName} ${second.lastName}`;
}

/**
 * The same booking, however many times it is imported.
 *
 * A spreadsheet re-uploaded after a fix, or a row imported by form and then
 * again in bulk, must not become a second wedding.
 */
export function bookingImportKey(
  booking: Pick<ExistingBooking, "clients" | "eventDate">,
): string {
  const email = booking.clients[0]?.email?.trim().toLowerCase() ?? "";
  return `${email}|${booking.eventDate}`;
}

/**
 * Email that goes out on the studio's behalf without anyone pressing send.
 *
 * Held for a quiet couple even if something queues it, as the last line after
 * the schedulers that should never have queued it. A message a studio member
 * sends deliberately is not on this list: choosing to write to a couple is the
 * studio deciding, which is the whole point of holding the rest back.
 */
export const clientAutomationEmailTypes: readonly string[] = [
  "booking_confirmation",
  "retainer_invoice",
  "final_invoice",
  "final_payment_reminder",
  "schedule_review",
  "event_reminder",
  "questionnaire_reminder",
  // A reminder to sign a StudioCue contract. Never due on an imported booking
  // (it is already signed), but held here like every other automated nudge.
  "contract_reminder",
];

/** Whether automations that reach this couple are being held back. */
export function clientAutomationsPaused(
  project: { clientAutomationsPausedAt?: unknown } | null | undefined,
): boolean {
  return typeof project?.clientAutomationsPausedAt === "string";
}

export type ImportedBookingRecords = {
  targetState: ImportableBookingState;
  project: Record<string, unknown>;
  packageSnapshot: Record<string, unknown>;
  contract: Record<string, unknown>;
  /** Null when nothing has been paid yet. */
  paidInvoice: Record<string, unknown> | null;
};

/**
 * Coverage as the contract states it, in the {role, count} shape
 * `features/packages/coverage.ts` defines.
 *
 * Written out here rather than imported: this module is duplicated into
 * `functions/`, which has no "@/features" path, and the two copies are
 * asserted identical.
 *
 * A contract that records nobody imports as one photographer — the same
 * assumption the import has always made — and the snapshot's legacy
 * `includedPhotographers` is derived from the result rather than from the raw
 * number, so the pair can never disagree.
 */
export function importedCoverage(
  booking: Pick<ExistingBooking, "photographers" | "videographers">,
): { role: "photographer" | "videographer"; count: number }[] {
  const coverage: { role: "photographer" | "videographer"; count: number }[] = [];
  if (booking.photographers > 0)
    coverage.push({ role: "photographer", count: booking.photographers });
  if ((booking.videographers ?? 0) > 0)
    coverage.push({ role: "videographer", count: booking.videographers ?? 0 });
  return coverage.length ? coverage : [{ role: "photographer", count: 1 }];
}

/**
 * The documents an import writes, and — as importantly — how they are shaped
 * so nothing downstream mistakes them for a live booking.
 *
 * - The project is written as BOOKED even when PLANNING was asked for. PLANNING
 *   is entered afterwards, once its checkpoints exist, because entering
 *   PLANNING with none makes readiness wave it straight through to READY.
 * - It carries no `bookingProviderState` and no booking orchestration exists,
 *   so the booking side-effects job and the payment triggers leave it alone.
 * - Money already paid is one paid retainer record whose evidence itemises each
 *   payment. The final balance is the contract total less paid retainers, so
 *   it comes out right with nothing downstream changed.
 * - `providerCustomerId` is null, so the final-invoice scheduler never raises a
 *   second invoice for something the studio already bills elsewhere.
 */
export function planImportedBooking(
  booking: ExistingBooking,
  context: {
    tenantId: string;
    projectId: string;
    packageSnapshotId: string;
    contractId: string;
    invoiceId: string;
    contactIds: string[];
    actorId: string;
    now: string;
    source: "form" | "cue" | "spreadsheet";
    batchId: string | null;
  },
): ImportedBookingRecords {
  const { now, actorId } = context;
  const name = booking.projectName ?? defaultBookingName(booking.clients);
  const paid = paidToDateCents(booking);
  const includedCoverage = importedCoverage(booking);
  const evidence = {
    kind: "imported_booking",
    source: context.source,
    batchId: context.batchId,
    importedBy: actorId,
    importedAt: now,
  };

  const project = {
    id: context.projectId,
    projectId: context.projectId,
    tenantId: context.tenantId,
    name,
    eventTypeId: booking.eventTypeId,
    eventType: booking.eventType,
    eventDate: booking.eventDate,
    timezone: booking.timezone,
    clientContactIds: context.contactIds,
    leadPhotographerId: null,
    leadId: null,
    venueName: booking.venueName,
    city: booking.city,
    venue: null,
    state: "BOOKED",
    stateVersion: 1,
    packageSnapshotId: context.packageSnapshotId,
    readinessScore: 0,
    nextAction: "Bring this couple into StudioCue when you're ready",
    bookingCompletedAt: `${booking.signedOn}T00:00:00.000Z`,
    clientPortalActive: false,
    importedAt: now,
    importedBy: actorId,
    importSource: context.source,
    importBatchId: context.batchId,
    importNotes: booking.notes,
    clientAutomationsPausedAt: now,
    createdAt: now,
    updatedAt: now,
    createdBy: actorId,
    updatedBy: actorId,
    archivedAt: null,
  };

  const packageSnapshot = {
    id: context.packageSnapshotId,
    tenantId: context.tenantId,
    projectId: context.projectId,
    // Not a package in the catalogue: the contract as signed.
    packageId: "imported",
    packageVersion: 1,
    packageName: booking.packageName,
    description: "Imported from the signed contract",
    currency: booking.currency,
    basePriceCents: booking.totalCents - booking.taxCents,
    addOns: [],
    discountCents: 0,
    subtotalCents: booking.totalCents - booking.taxCents,
    taxCents: booking.taxCents,
    // What was actually collected before StudioCue, so the balance is right.
    retainerCents: paid,
    totalCents: booking.totalCents,
    includedCoverageMinutes: booking.coverageMinutes,
    includedCoverage,
    includedPhotographers:
      includedCoverage.find((item) => item.role === "photographer")?.count ?? 0,
    includedDeliverables: [],
    includedTravelArea: "",
    terms: "",
    selectionDate: `${booking.signedOn}T00:00:00.000Z`,
    selectedBy: actorId,
    immutable: true,
    source: "imported",
    createdAt: now,
    createdBy: actorId,
  };

  const contract = {
    id: context.contractId,
    tenantId: context.tenantId,
    projectId: context.projectId,
    proposalId: null,
    status: "completed",
    provider: null,
    completionAuthority: "imported",
    providerEnvelopeId: null,
    templateId: null,
    signers: [
      {
        name: booking.signerName,
        email: booking.clients[0]!.email,
        role: "Client",
        order: 1,
        status: "completed",
      },
    ],
    completedAt: `${booking.signedOn}T00:00:00.000Z`,
    // Filed by attachImportedSignedCopy once the project's folder exists.
    signedDocumentId: null,
    completionEvidence: {
      ...evidence,
      signerName: booking.signerName,
      signedOn: booking.signedOn,
    },
    providerState: "not_applicable",
    createdAt: now,
    updatedAt: now,
    createdBy: actorId,
    updatedBy: actorId,
    archivedAt: null,
  };

  const lastPaidOn = booking.payments
    .map((payment) => payment.paidOn)
    .sort()
    .at(-1);
  const paidInvoice =
    paid > 0
      ? {
          id: context.invoiceId,
          tenantId: context.tenantId,
          projectId: context.projectId,
          kind: "retainer",
          provider: null,
          completionAuthority: "imported",
          providerInvoiceId: null,
          providerCustomerId: null,
          status: "paid",
          currency: booking.currency,
          amountCents: paid,
          balanceCents: 0,
          dueDate: lastPaidOn,
          paidAt: `${lastPaidOn}T00:00:00.000Z`,
          completionEvidence: {
            ...evidence,
            payments: booking.payments,
            amountCents: paid,
          },
          providerState: "not_applicable",
          createdAt: now,
          updatedAt: now,
          createdBy: actorId,
          updatedBy: actorId,
          archivedAt: null,
        }
      : null;

  return {
    targetState: booking.state,
    project,
    packageSnapshot,
    contract,
    paidInvoice,
  };
}
