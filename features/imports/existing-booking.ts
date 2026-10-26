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

/**
 * The states an import may land in. Earlier work has no evidence to import.
 *
 * Past and in-progress jobs too, since 2026-10-26 (Conor: a studio moving
 * mid-season has weddings in editing and galleries out, and the move is never
 * complete while those stay behind). Each later state writes the records its
 * screens and closeout read, marked as done before StudioCue: see
 * `planImportedBooking` and docs/adr/0005-imported-booking-evidence.md.
 */
export const importableBookingStates = ["BOOKED", "PLANNING", "EVENT_COMPLETE", "POST_PRODUCTION", "DELIVERED", "CLOSED"] as const;
export type ImportableBookingState = (typeof importableBookingStates)[number];

/** Before the event: the date must be today or later. */
export const upcomingImportStates: readonly ImportableBookingState[] = ["BOOKED", "PLANNING"];
/** After it: the date must have passed. */
export const pastImportStates: readonly ImportableBookingState[] = ["EVENT_COMPLETE", "POST_PRODUCTION", "DELIVERED", "CLOSED"];
/** Editing and delivery: only a studio that delivers something after the event. */
export const deliveryImportStates: readonly ImportableBookingState[] = ["POST_PRODUCTION", "DELIVERED"];

/** Where a job is, in a studio's words. */
export const importStateLabels: Record<ImportableBookingState, string> = {
  BOOKED: "Booked",
  PLANNING: "Planning",
  EVENT_COMPLETE: "Event done",
  POST_PRODUCTION: "In editing",
  DELIVERED: "Delivered",
  CLOSED: "Finished",
};

/**
 * The crew a job can name, each trade's assistant beside its lead
 * (features/packages/coverage.ts, written out here: this module is duplicated
 * into functions/, which has no "@/features" path).
 */
export const importedCrewRoles = [
  "photographer",
  "videographer",
  "photo_assistant",
  "dj",
  "dj_assistant",
  "makeup_artist",
  "makeup_assistant",
  "hair_stylist",
  "hair_assistant",
  "coordinator",
] as const;
export type ImportedCoverageRole = (typeof importedCrewRoles)[number];

/** "Hair assistant": a role as a crew line says it. */
export const importedCrewRoleLabels: Record<ImportedCoverageRole, string> = {
  photographer: "Photographer",
  videographer: "Videographer",
  photo_assistant: "Photo assistant",
  dj: "DJ",
  dj_assistant: "DJ assistant",
  makeup_artist: "Makeup artist",
  makeup_assistant: "Makeup assistant",
  hair_stylist: "Hair stylist",
  hair_assistant: "Hair assistant",
  coordinator: "Coordinator",
};

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
        // Optional for the first client too, since 2026-10-26: beauty and DJ
        // clients are often a phone number. Their portal waits for an email.
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
  /**
   * Who the studio sends, line by line: a role, how many, and who when the
   * studio says (2026-10-26). When present it is the job's crew, and the two
   * counts above are only what an older caller sent. A hair studio's three
   * assistants on one wedding and two different ones on the next are two
   * lines on two jobs; named people are matched to the roster, or added to it
   * quietly, and booked on the job with nothing sent.
   */
  crew: z
    .array(
      z.object({
        role: z.enum(importedCrewRoles),
        count: z.number().int().positive().max(50),
        names: z.array(z.string().trim().min(1).max(120)).max(50),
      }),
    )
    .max(12)
    .optional(),
  /** When the day starts, "HH:MM", as the studio's sheet or contract says. */
  startTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  /** Fields the reader filled in because the source didn't say ("coverageMinutes"). */
  assumed: z.array(z.string().max(40)).max(20).optional(),
  /** A delivered or finished job's gallery, so the client's portal can open it. */
  galleryUrl: z.string().trim().url().max(2000).nullable().optional(),
  /** When a delivered or finished job's gallery went out. */
  deliveredOn: isoDate.nullable().optional(),
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
  notes: z.string().trim().max(4000).nullable(),
});
export type ExistingBooking = z.infer<typeof existingBookingSchema>;

export type ExistingBookingIssueCode =
  | "INVALID_DATE"
  | "PRIMARY_EMAIL_REQUIRED"
  | "CONTACT_REQUIRED"
  | "NO_CLIENT_EMAIL"
  | "EVENT_NOT_YET"
  | "STATE_NOT_FOR_TRADE"
  | "DELIVERED_BEFORE_EVENT"
  | "BALANCE_OWED_ON_FINISHED_JOB"
  | "CREW_UNNAMED"
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
  /** Whether the studio delivers anything after the event (trades.ts `delivery`). */
  context: { delivers?: boolean } = {},
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
    ...(booking.deliveredOn ? [booking.deliveredOn] : []),
  ];
  if (dates.some((value) => !realDate(value))) {
    error("INVALID_DATE", "One of the dates isn't a real calendar date.");
    return issues;
  }

  const primary = booking.clients[0]!;
  if (!primary.email && !primary.phone)
    error(
      "CONTACT_REQUIRED",
      `Add an email or a phone number for ${primary.firstName}, so you can reach them.`,
    );
  else if (!primary.email)
    warning(
      "NO_CLIENT_EMAIL",
      `No email for ${primary.firstName}, so they can't be invited to their portal until you add one.`,
    );
  const second = booking.clients[1];
  if (primary.email && second?.email && primary.email === second.email)
    error(
      "DUPLICATE_CLIENT_EMAIL",
      "Both clients have the same email. Give the second one their own, or leave it blank.",
    );

  const past = pastImportStates.includes(booking.state);
  if (!past && booking.eventDate < today)
    error(
      "EVENT_ALREADY_HAPPENED",
      `The event was on ${booking.eventDate}. Choose where the job is now: event done, in editing, delivered or finished.`,
    );
  if (past && booking.eventDate > today)
    error(
      "EVENT_NOT_YET",
      `The event is on ${booking.eventDate}, which hasn't happened yet. Import it as booked or planning.`,
    );
  if (context.delivers === false && deliveryImportStates.includes(booking.state))
    error(
      "STATE_NOT_FOR_TRADE",
      "Your studio doesn't deliver a gallery after the event. Import it as event done or finished.",
    );
  if (booking.deliveredOn && booking.deliveredOn < booking.eventDate)
    error("DELIVERED_BEFORE_EVENT", "The delivery date is before the event. Check the date.");
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

  if (booking.state === "CLOSED" && paidToDateCents(booking) < booking.totalCents)
    warning(
      "BALANCE_OWED_ON_FINISHED_JOB",
      "This finished job still shows money owed. Record every payment, or it will show a balance due.",
    );
  const unnamed = (booking.crew ?? []).filter((line) => line.names.length < line.count);
  if (booking.crew?.length && unnamed.length && pastImportStates.includes(booking.state))
    warning(
      "CREW_UNNAMED",
      "Some crew aren't named, so they won't be on the job's record. Add names if you know them.",
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
  const client = booking.clients[0];
  const email = client?.email?.trim().toLowerCase() ?? "";
  // A client with no email (2026-10-26) is known by phone, then by name.
  const phone = (client?.phone ?? "").replace(/\D/g, "");
  const name = `${client?.firstName ?? ""} ${client?.lastName ?? ""}`.trim().toLowerCase();
  return `${email || (phone ? `tel:${phone}` : `name:${name}`)}|${booking.eventDate}`;
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
  // The couple's own shot list, a month out (planning/shot-list-upload.ts).
  "shot_list_request",
  // A reminder to sign a StudioCue contract. Never due on an imported booking
  // (it is already signed), but held here like every other automated nudge.
  "contract_reminder",
  // The day-before note to each parent or family at a group event
  // (group-events/participant-reminders.ts).
  "group_event_reminder",
  // And the nudge after it, to anyone who still owes.
  "group_event_balance",
  // Each parent's one review ask, days after their own delivery
  // (group-events/participant-delivery.ts). Their delivery itself is the
  // studio's own act and is not on this list.
  "group_review_request",
  // Two weeks before a gallery closes; nothing for a quiet couple.
  "delivery_expiry_reminder",
  // After the event, now that past jobs import (2026-10-26). Their
  // schedulers check the pause already; this is the sender's last line.
  "review_request",
  "album_selection_reminder",
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
  /** The people the job names, to match to the roster and book with nothing sent. */
  namedCrew: { role: ImportedCoverageRole; label: string; name: string }[];
  /** A delivered or finished job's editing checklist, every step done before StudioCue. */
  postProductionRecord: Record<string, unknown> | null;
  /** Its gallery, when the studio gave the link. */
  deliveryRecord: Record<string, unknown> | null;
  /** A finished job's closeout, so it can be archived like any other. */
  closeout: Record<string, unknown> | null;
};

/**
 * Coverage as the contract states it, in the {role, count} shape
 * `features/packages/coverage.ts` defines.
 *
 * From the crew lines when there are any (2026-10-26): one entry per role,
 * the lines for a role added together, and never fewer people than are named.
 * Otherwise from the two counts an older caller sends. A contract that
 * records nobody imports as one of the studio's own role — the same
 * assumption the import has always made — and the snapshot's legacy
 * `includedPhotographers` is derived from the result rather than from the raw
 * number, so the pair can never disagree.
 */
export function importedCoverage(
  booking: Pick<ExistingBooking, "photographers" | "videographers" | "crew">,
  /**
   * The studio's own crew role (trades.ts `coverageRoles[0]`). A hair
   * studio's form asks for "Hair stylists" into the same count, and they were
   * saved as photographers (2026-10-09). Only a photographer has video.
   */
  primaryRole: ImportedCoverageRole = "photographer",
): { role: ImportedCoverageRole; count: number }[] {
  if (booking.crew?.length) {
    const totals = new Map<ImportedCoverageRole, number>();
    for (const line of booking.crew)
      totals.set(line.role, (totals.get(line.role) ?? 0) + Math.max(line.count, line.names.length));
    const fromLines = importedCrewRoles
      .filter((role) => (totals.get(role) ?? 0) > 0)
      .map((role) => ({ role, count: Math.min(50, totals.get(role)!) }));
    if (fromLines.length) return fromLines;
  }
  const coverage: { role: ImportedCoverageRole; count: number }[] = [];
  if (booking.photographers > 0)
    coverage.push({ role: primaryRole, count: booking.photographers });
  if (primaryRole === "photographer" && (booking.videographers ?? 0) > 0)
    coverage.push({ role: "videographer", count: booking.videographers ?? 0 });
  return coverage.length ? coverage : [{ role: primaryRole, count: 1 }];
}

/** Each named person, once, with the role they're booked as. */
export function importedNamedCrew(
  booking: Pick<ExistingBooking, "crew">,
): { role: ImportedCoverageRole; label: string; name: string }[] {
  const seen = new Set<string>();
  return (booking.crew ?? []).flatMap((line) =>
    line.names.flatMap((name) => {
      const key = `${line.role}|${name.trim().toLowerCase()}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ role: line.role, label: importedCrewRoleLabels[line.role], name: name.trim() }];
    }),
  );
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
    /** The studio's own crew role; omitted, a photographer. */
    primaryRole?: ImportedCoverageRole;
    /** A finished or delivered job's gallery record id and its view token. */
    deliveryRecordId?: string;
    viewToken?: string;
  },
): ImportedBookingRecords {
  const { now, actorId } = context;
  const name = booking.projectName ?? defaultBookingName(booking.clients);
  const paid = paidToDateCents(booking);
  const includedCoverage = importedCoverage(booking, context.primaryRole);
  const past = pastImportStates.includes(booking.state);
  const delivered = booking.state === "DELIVERED" || booking.state === "CLOSED";
  const deliveredOn = booking.deliveredOn ?? null;
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
    // A job after its event lands where it is; one before it lands BOOKED and
    // enters PLANNING once its checkpoints exist (below).
    state: past ? booking.state : "BOOKED",
    stateVersion: 1,
    packageSnapshotId: context.packageSnapshotId,
    // Readiness is about the run-up to the day; a past job has nothing left of it.
    readinessScore: past ? 100 : 0,
    nextAction: importedNextAction(booking.state),
    eventStartTime: booking.startTime ?? null,
    importAssumed: booking.assumed ?? [],
    ...(delivered
      ? {
          deliveredAt: `${deliveredOn ?? booking.eventDate}T00:00:00.000Z`,
          // Delivered before StudioCue: no review asks were scheduled here,
          // and closeout doesn't wait for them (release.ts reviewAsksSkipped).
          reviewRequestsSkippedAt: now,
          reviewRequestsSkippedBy: actorId,
          reviewRequestsSkippedReason: "imported_past_job",
        }
      : {}),
    ...(booking.state === "CLOSED" ? { closedAt: now } : {}),
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
          // Closeout's final-balance check reads this: a job paid in full
          // before StudioCue is settled, with no final invoice to wait for.
          paidInFull: paid >= booking.totalCents,
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

  const doneBefore = {
    complete: true,
    completedAt: now,
    completedBy: actorId,
    evidenceId: "imported_booking",
    notes: "Done before StudioCue.",
  };
  const notYet = { complete: false, completedAt: null, completedBy: null, evidenceId: null, notes: null };
  const steps = ["backup_complete", "cull_complete", "editing_started", "editing_complete", "gallery_ready", "album_proof_ready", "delivery_sent", "client_downloaded", "project_archived"];
  const throughDelivery = new Set(["backup_complete", "cull_complete", "editing_started", "editing_complete", "gallery_ready", "delivery_sent"]);
  // In editing, the post-production trigger opens the checklist as for any
  // job moved to Editing. Delivered or finished, it is written here, done.
  const postProductionRecord = delivered
    ? {
        id: context.projectId,
        tenantId: context.tenantId,
        projectId: context.projectId,
        steps: Object.fromEntries(
          steps.map((key) => [key, booking.state === "CLOSED" || throughDelivery.has(key) ? doneBefore : notYet]),
        ),
        currentStep: booking.state === "CLOSED" ? "project_archived" : "client_downloaded",
        targetDeliveryDate: null,
        importedAt: now,
        createdAt: now,
        updatedAt: now,
        createdBy: actorId,
        updatedBy: actorId,
        archivedAt: null,
      }
    : null;
  const deliveryRecord =
    delivered && booking.galleryUrl && context.deliveryRecordId && context.viewToken
      ? {
          id: context.deliveryRecordId,
          tenantId: context.tenantId,
          projectId: context.projectId,
          releaseId: null,
          provider: "manual",
          mediaType: "photo",
          kind: "gallery",
          label: "Photo gallery",
          final: true,
          galleryUrl: booking.galleryUrl,
          viewToken: context.viewToken,
          accessCode: null,
          expirationDate: null,
          deliveryDate: deliveredOn ?? booking.eventDate,
          notes: "Delivered before StudioCue.",
          status: "sent",
          sentAt: `${deliveredOn ?? booking.eventDate}T00:00:00.000Z`,
          viewedAt: null,
          downloadedAt: null,
          providerDeliveryId: null,
          deliveryDraftId: null,
          completionAuthority: "imported",
          createdAt: now,
          updatedAt: now,
          createdBy: actorId,
          updatedBy: actorId,
          archivedAt: null,
        }
      : null;
  const closeout =
    booking.state === "CLOSED"
      ? {
          id: `closeout_${context.projectId}`,
          tenantId: context.tenantId,
          projectId: context.projectId,
          status: "completed",
          completedAt: now,
          completionAuthority: "imported",
          // Finished before StudioCue: nothing here to reconcile.
          requirements: [],
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
    namedCrew: importedNamedCrew(booking),
    postProductionRecord,
    deliveryRecord,
    closeout,
  };
}

/** What a job asks for next, by where it was imported. */
function importedNextAction(state: ImportableBookingState): string {
  switch (state) {
    case "EVENT_COMPLETE":
      return "Close the job, or move it to editing";
    case "POST_PRODUCTION":
      return "Finish editing, then record the delivery";
    case "DELIVERED":
      return "Close the job when the follow-ups are done";
    case "CLOSED":
      return "Finished before StudioCue";
    default:
      return "Bring this couple into StudioCue when you're ready";
  }
}
