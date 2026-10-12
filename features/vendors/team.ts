import { z } from "zod";
import { auditFieldsSchema } from "@/features/tenants/schema";
import { clockOf, spokenClock, wallClockToIso } from "@/features/schedules/day-clock";
import { sortScheduleItems } from "@/features/schedules/run-of-show-order";
import { VENDOR_TYPES, type VendorType } from "@/features/vendors/schema";

/**
 * A wedding's vendor team: who the couple has (or still needs) for each part
 * of the day, and where each one stands (docs/planner-journey-plan.md, N1).
 *
 * A vendor record (`vendors`) is the studio's directory — the planner's
 * preferred-vendor list — and it only ever knew which jobs a vendor was on
 * (`projectIds`), with nothing about the job itself: booked or not, when they
 * arrive, what the couple still owes them, whether their contract and
 * certificate are in. A team entry (`projectVendors`) is that per-job state.
 * One entry per (job, vendor), and an entry can stand for a category before
 * anyone is chosen ("Florist — needed").
 *
 * Framework-neutral and deterministic: the job panel, the run-of-show editor
 * and (Phase 2) the journey and readiness all read it. Writes are the
 * server's (functions/src/planning/vendor-team.ts); the browser never writes
 * a team entry.
 */

export const vendorTeamStatusSchema = z.enum(["needed", "considering", "booked", "declined"]);
export type VendorTeamStatus = z.infer<typeof vendorTeamStatusSchema>;

export const VENDOR_TEAM_STATUS_LABELS: Record<VendorTeamStatus, string> = {
  needed: "Needed",
  considering: "Considering",
  booked: "Booked",
  declined: "Not going ahead",
};

/** What each kind of vendor is called on the team, in the studio's words. */
export const VENDOR_CATEGORY_LABELS: Record<VendorType, string> = {
  venue: "Venue",
  planner: "Planner",
  photographer: "Photographer",
  videographer: "Videographer",
  florist: "Florist",
  dj: "DJ",
  band: "Band",
  hair_makeup: "Hair and makeup",
  caterer: "Caterer",
  bakery: "Cake",
  officiant: "Officiant",
  rentals: "Rentals",
  transportation: "Transportation",
  insurance_agent: "Insurance agent",
  corporate_contact: "Corporate contact",
  sports_organizer: "Sports organizer",
  other: "Other",
};

/** The categories offered when adding to a team, most-asked first. Directory-only kinds are left off. */
export const VENDOR_TEAM_CATEGORIES: readonly VendorType[] = [
  "venue",
  "planner",
  "photographer",
  "videographer",
  "florist",
  "dj",
  "band",
  "hair_makeup",
  "caterer",
  "bakery",
  "officiant",
  "rentals",
  "transportation",
  "other",
];

export function vendorCategoryLabel(category: unknown): string {
  return VENDOR_CATEGORY_LABELS[category as VendorType] ?? "Vendor";
}

/** "HH:MM" on the event day, or nothing. */
const clockField = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .nullable();

export const projectVendorSchema = auditFieldsSchema.extend({
  /** `${projectId}_${entryId}`. */
  id: z.string(),
  entryId: z.string(),
  tenantId: z.string(),
  projectId: z.string(),
  /** Null while the category is only needed — nobody chosen yet. */
  vendorId: z.string().nullable(),
  category: z.enum(VENDOR_TYPES),
  /** "Ceremony musicians", where the category alone doesn't say. */
  roleLabel: z.string().nullable(),
  status: vendorTeamStatusSchema,
  arrivalTime: clockField,
  loadInTime: clockField,
  strikeTime: clockField,
  contractReceived: z.boolean(),
  coiReceived: z.boolean(),
  /** Their total, what the couple pays them. */
  costCents: z.number().int().nonnegative().nullable(),
  /** What the couple still owes them, and when. */
  balanceDueCents: z.number().int().nonnegative().nullable(),
  balanceDueDate: z.string().date().nullable(),
  tipCents: z.number().int().nonnegative().nullable(),
  notes: z.string().nullable(),
  /**
   * The vendor's directory details as of the last write, so a coordinator
   * (who may not read the whole directory) and the printed sheet see who
   * they are. Refreshed whenever the vendor record changes.
   */
  company: z.string().nullable(),
  contactName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  archivedAt: z.string().datetime().nullable(),
  /**
   * Who put it there: the studio (absent on entries from before the couple
   * could), or the couple from their portal (couple-team.ts). A couple's
   * entry is theirs to change; the studio can change any.
   */
  source: z.enum(["studio", "couple"]).optional(),
});
export type ProjectVendor = z.infer<typeof projectVendorSchema>;

/** The deterministic document id for an entry. */
export const projectVendorDocId = (projectId: string, entryId: string) => `${projectId}_${entryId}`;

// ─── Where a vendor stands with the timeline ────────────────────────────────

/** The fields of a `scheduleShares` record this reads. */
export type TimelineShareLike = {
  [key: string]: unknown;
  vendorContactId?: unknown;
  status?: unknown;
  revokedAt?: unknown;
  sharedVersion?: unknown;
  acknowledgedVersion?: unknown;
};

export type VendorTimelineState = "not_sent" | "sent" | "viewed" | "confirmed" | "older";

export const VENDOR_TIMELINE_LABELS: Record<VendorTimelineState, string> = {
  not_sent: "Timeline not sent",
  sent: "Timeline sent",
  viewed: "Timeline opened",
  confirmed: "Confirmed",
  older: "Has an older version",
};

const live = (share: TimelineShareLike | null | undefined): share is TimelineShareLike =>
  Boolean(share) && String(share?.status ?? "") !== "revoked" && !share?.revokedAt;

/**
 * One vendor's timeline, against the current published version (null when
 * none is published). A link pinned to an earlier version is "older" whatever
 * they did with it: confirming the old day is not confirming this one.
 */
export function timelineStateFor(
  share: TimelineShareLike | null | undefined,
  currentVersion: number | null,
): VendorTimelineState {
  if (!live(share)) return "not_sent";
  const shared = Number(share.sharedVersion ?? 0);
  if (currentVersion !== null && shared < currentVersion) return "older";
  if (String(share.status) === "acknowledged") return "confirmed";
  if (String(share.status) === "viewed") return "viewed";
  return "sent";
}

/** The live share for each vendor on this job, by vendor id. */
export function sharesByVendor<T extends TimelineShareLike>(shares: readonly T[]): Map<string, T> {
  const byVendor = new Map<string, T>();
  for (const share of shares) {
    if (!live(share)) continue;
    const vendorId = String(share.vendorContactId ?? "");
    if (vendorId) byVendor.set(vendorId, share);
  }
  return byVendor;
}

// ─── Progress ───────────────────────────────────────────────────────────────

/** The fields of a team entry progress reads. */
export type TeamEntryLike = {
  [key: string]: unknown;
  vendorId?: unknown;
  status?: unknown;
  costCents?: unknown;
  balanceDueCents?: unknown;
  tipCents?: unknown;
  archivedAt?: unknown;
};

export type VendorTeamProgress = {
  /** Entries on the team, declined ones left out. */
  total: number;
  needed: number;
  considering: number;
  booked: number;
  declined: number;
  /** Booked vendors' totals, what the light budget compares. */
  bookedCostCents: number;
  /** What the couple still owes booked vendors, and the tips to hand out. */
  balanceDueCents: number;
  tipCents: number;
  timeline: {
    /** Booked vendors holding a live link, any version. */
    sent: number;
    /** …who confirmed the current version. */
    confirmed: number;
    /** …whose link shows an earlier version. */
    older: number;
    /** Booked vendors with nobody chosen or no link yet. */
    notSent: number;
  };
  /** Nothing left to find: no category still needed or being considered, and someone booked. */
  teamComplete: boolean;
  /** Every booked vendor has confirmed the current version. */
  allConfirmed: boolean;
};

const cents = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;

/**
 * Where the team stands, for the job panel now and for the planner's
 * "Vendor team" and "Vendors confirmed" journey steps and readiness checks
 * (Phase 2). Deterministic: the same records always give the same answer.
 */
export function vendorTeamProgress(
  entries: readonly TeamEntryLike[],
  shares: readonly TimelineShareLike[],
  currentVersion: number | null,
): VendorTeamProgress {
  const current = entries.filter((entry) => !entry.archivedAt);
  const status = (entry: TeamEntryLike) => vendorTeamStatusSchema.safeParse(entry.status).data ?? "needed";
  const booked = current.filter((entry) => status(entry) === "booked");
  const byVendor = sharesByVendor(shares);
  const timeline = { sent: 0, confirmed: 0, older: 0, notSent: 0 };
  for (const entry of booked) {
    const vendorId = typeof entry.vendorId === "string" ? entry.vendorId : "";
    const state = timelineStateFor(vendorId ? byVendor.get(vendorId) : null, currentVersion);
    if (state === "not_sent") {
      timeline.notSent += 1;
      continue;
    }
    timeline.sent += 1;
    if (state === "confirmed") timeline.confirmed += 1;
    if (state === "older") timeline.older += 1;
  }
  const count = (wanted: VendorTeamStatus) => current.filter((entry) => status(entry) === wanted).length;
  return {
    total: current.length - count("declined"),
    needed: count("needed"),
    considering: count("considering"),
    booked: booked.length,
    declined: count("declined"),
    bookedCostCents: booked.reduce((sum, entry) => sum + cents(entry.costCents), 0),
    balanceDueCents: booked.reduce((sum, entry) => sum + cents(entry.balanceDueCents), 0),
    tipCents: booked.reduce((sum, entry) => sum + cents(entry.tipCents), 0),
    timeline,
    teamComplete: booked.length > 0 && count("needed") === 0 && count("considering") === 0,
    allConfirmed: booked.length > 0 && timeline.confirmed === booked.length,
  };
}

/**
 * The version vendors' links are read against: the job's newest schedule,
 * when it is published; null before one is (use-vendor-team.ts reads it the
 * same way).
 */
export function publishedTimelineVersion(schedules: readonly { [key: string]: unknown; version?: unknown; status?: unknown }[]): number | null {
  const latest = [...schedules].sort((left, right) => Number(right.version ?? 0) - Number(left.version ?? 0))[0];
  return latest && latest.status === "published" ? Number(latest.version) || null : null;
}

const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const money = (amount: number) => dollars.format(Math.round(amount) / 100);

/**
 * The light budget (Conor's decision 4, 2026-10-12): booked vendors' totals
 * against the couple's budget, and nothing more — no categories, no
 * allocations. "$18,400 of $35,000 booked"; without a budget, "$18,400 booked".
 */
export function budgetLine(bookedCostCents: number, budgetCents: number | null | undefined): string {
  const budget = typeof budgetCents === "number" && budgetCents > 0 ? budgetCents : null;
  if (budget === null) return bookedCostCents > 0 ? `${money(bookedCostCents)} booked` : "No costs booked yet";
  return `${money(bookedCostCents)} of ${money(budget)} booked`;
}

/** "Sent to 6 · 4 confirmed · 1 has an older version", or null before anything went out. */
export function timelineSummary(progress: VendorTeamProgress): string | null {
  const { sent, confirmed, older } = progress.timeline;
  if (!sent) return null;
  return [
    `Sent to ${sent}`,
    `${confirmed} confirmed`,
    ...(older ? [`${older} ${older === 1 ? "has" : "have"} an older version`] : []),
  ].join(" · ");
}

// ─── Where the team shows on a job ──────────────────────────────────────────

/** Job states before a booking, and after the work is done. */
const BEFORE_BOOKING = new Set(["LEAD", "CONSULTATION", "PROPOSAL", "CONTRACT_PENDING", "RETAINER_PENDING", "LOST"]);
const AFTER_THE_DAY = new Set([
  "EVENT_COMPLETE",
  "POST_PRODUCTION",
  "DELIVERED",
  "REVIEW_REQUESTED",
  "CLOSED",
  "ARCHIVED",
  "CANCELLED",
]);

/**
 * What the job page shows of the team.
 *
 * A trade that runs the team by default (the planner, Phase 2) always sees
 * the panel. Every other trade sees it once a vendor is on the job, and until
 * then only a small "Add a vendor" — and only while the job is booked and the
 * day is ahead, so an inquiry or a closed job looks exactly as it did.
 */
export function vendorTeamVisibility(input: {
  mode: "default" | "quiet";
  entryCount: number;
  state: string;
}): "panel" | "quiet" | "hidden" {
  if (input.entryCount > 0 || input.mode === "default") return "panel";
  if (BEFORE_BOOKING.has(input.state) || AFTER_THE_DAY.has(input.state)) return "hidden";
  return "quiet";
}

// ─── Vendor arrivals on the run of show (N2) ────────────────────────────────

/** Every arrival line's id starts with this, so a second run updates rather than duplicates. */
export const VENDOR_ARRIVAL_PREFIX = "vendor_arrival_";

export const vendorArrivalLineId = (entryId: string) => `${VENDOR_ARRIVAL_PREFIX}${entryId}`;

/** A line "Add vendor arrivals" made: it marks a moment and never ends another block. */
export function isVendorArrivalLine(item: { id?: unknown }): boolean {
  return typeof item.id === "string" && item.id.startsWith(VENDOR_ARRIVAL_PREFIX);
}

/** The run-of-show line shape the editor and publishSchedule share. */
export type ArrivalScheduleItem = {
  id: string;
  startAt: string;
  endAt: string;
  title: string;
  description: string;
  location: string | null;
  address: string | null;
  travelMinutes: number;
  crewIds: string[];
  photographerIds: string[];
  participants: string[];
  vendorContactIds: string[];
  equipment: string[];
  notes: string | null;
  visibility: "studio" | "client" | "crew" | "shared";
  blockingIssues: string[];
  sourceReferences: Array<{ type: "project_fact"; sourceId: string; label: string }>;
};

export type ArrivalEntry = {
  [key: string]: unknown;
  entryId?: unknown;
  vendorId?: unknown;
  status?: unknown;
  category?: unknown;
  roleLabel?: unknown;
  company?: unknown;
  arrivalTime?: unknown;
  loadInTime?: unknown;
  archivedAt?: unknown;
};

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** The words on a vendor's arrival line: "Florist arrives — Petal & Stem". */
export function arrivalTitle(entry: ArrivalEntry, loadInOnly: boolean): string {
  const who = text(entry.roleLabel) || vendorCategoryLabel(entry.category);
  const company = text(entry.company);
  return `${who} ${loadInOnly ? "loads in" : "arrives"}${company ? ` — ${company}` : ""}`;
}

/**
 * One run-of-show line per booked vendor with an arrival or load-in time,
 * tagged to that vendor so their own link shows it.
 *
 * Idempotent: each line's id comes from its team entry, so running it again
 * moves and renames the line it made before rather than adding a second; a
 * vendor no longer booked, or with no time any more, loses the line it had.
 * Lines the studio wrote are never touched. Visibility is "crew": the crew
 * see when each vendor turns up, the vendor sees their own line through
 * their link, and the couple's view of the day stays the day.
 */
export function vendorArrivalLines<T extends { id: string; startAt: string }>(
  items: readonly T[],
  entries: readonly ArrivalEntry[],
  context: { eventDate: string; timeZone: string },
): { items: Array<T | ArrivalScheduleItem>; added: number; updated: number; removed: number } {
  const wanted = new Map<string, ArrivalScheduleItem>();
  for (const entry of entries) {
    const entryId = text(entry.entryId);
    const vendorId = text(entry.vendorId);
    if (!entryId || !vendorId || entry.archivedAt || entry.status !== "booked") continue;
    const arrival = clockOf(entry.arrivalTime);
    const loadIn = clockOf(entry.loadInTime);
    const clock = arrival && loadIn ? (arrival <= loadIn ? arrival : loadIn) : (arrival ?? loadIn);
    if (!clock) continue;
    const startAt = wallClockToIso(context.eventDate, clock, context.timeZone);
    if (!startAt) continue;
    const id = vendorArrivalLineId(entryId);
    wanted.set(id, {
      id,
      startAt,
      endAt: new Date(Date.parse(startAt) + 30 * 60_000).toISOString(),
      title: arrivalTitle(entry, !arrival),
      description: arrival && loadIn && arrival !== loadIn ? `Load-in ${spokenClock(loadIn)}` : "",
      location: null,
      address: null,
      travelMinutes: 0,
      crewIds: [],
      photographerIds: [],
      participants: [],
      vendorContactIds: [vendorId],
      equipment: [],
      notes: null,
      visibility: "crew",
      blockingIssues: [],
      sourceReferences: [{ type: "project_fact", sourceId: `projectVendors/${entryId}`, label: "From the vendor team" }],
    });
  }
  let added = 0;
  let updated = 0;
  let removed = 0;
  const kept: Array<T | ArrivalScheduleItem> = [];
  for (const item of items) {
    if (!isVendorArrivalLine(item)) {
      kept.push(item);
      continue;
    }
    const next = wanted.get(item.id);
    if (!next) {
      removed += 1;
      continue;
    }
    wanted.delete(item.id);
    const prior = item as unknown as Partial<ArrivalScheduleItem>;
    const changed = prior.startAt !== next.startAt || prior.title !== next.title || prior.description !== next.description;
    if (changed) updated += 1;
    // The studio's own edits to the line (where, notes) stay; the time, words and tag follow the team.
    kept.push(changed ? { ...item, startAt: next.startAt, endAt: next.endAt, title: next.title, description: next.description, vendorContactIds: next.vendorContactIds } : item);
  }
  for (const line of wanted.values()) {
    kept.push(line);
    added += 1;
  }
  return { items: sortScheduleItems(kept), added, updated, removed };
}

// ─── The crew's view ─────────────────────────────────────────────────────────

export type CrewVendorContact = {
  entryId: string;
  category: string;
  roleLabel: string | null;
  company: string;
  contactName: string;
  phone: string;
  arrivalTime: string | null;
  loadInTime: string | null;
};

/**
 * What the crew may know about the job's vendors (`crewVendorContacts`):
 * who, how to reach them, when they arrive — never the money. The same rule
 * as functions/src/planning/vendor-team.ts, for the portal's writes
 * (server/vendors/couple-team.ts); tests/couple-vendor-team.test.ts keeps
 * the two equal.
 */
export function crewVendorContactsFrom(entries: ReadonlyArray<Record<string, unknown>>): CrewVendorContact[] {
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  return entries
    .filter((entry) => !entry.archivedAt && entry.status === "booked" && text(entry.company))
    .map((entry) => ({
      entryId: text(entry.entryId),
      category: text(entry.category) || "other",
      roleLabel: text(entry.roleLabel) || null,
      company: text(entry.company),
      contactName: text(entry.contactName),
      phone: text(entry.phone),
      arrivalTime: text(entry.arrivalTime) || null,
      loadInTime: text(entry.loadInTime) || null,
    }))
    .sort(
      (left, right) =>
        (left.arrivalTime ?? left.loadInTime ?? "99:99").localeCompare(right.arrivalTime ?? right.loadInTime ?? "99:99") ||
        left.company.localeCompare(right.company),
    );
}

// ─── Who's working the day ───────────────────────────────────────────────────

export type ContactSheetRow = {
  vendorId: string | null;
  category: string;
  company: string;
  contactName: string;
  phone: string;
  email: string;
  arrival: string | null;
};

/**
 * The contact sheet every vendor's schedule link carries
 * (docs/vendor-network-plan-2026-10-12.md, Phase 2): each booked vendor, how
 * to reach them, when they arrive — the reason the couple listed them. Never
 * the money, never a vendor still being considered.
 */
export function vendorContactSheet(entries: ReadonlyArray<Record<string, unknown>>): ContactSheetRow[] {
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  return entries
    .filter((entry) => !entry.archivedAt && entry.status === "booked" && text(entry.company) && (text(entry.phone) || text(entry.email)))
    .map((entry) => ({
      vendorId: text(entry.vendorId) || null,
      category: vendorCategoryLabel(entry.category),
      company: text(entry.company),
      contactName: text(entry.contactName),
      phone: text(entry.phone),
      email: text(entry.email),
      arrival: text(entry.arrivalTime) || text(entry.loadInTime) || null,
    }))
    .sort((left, right) => left.category.localeCompare(right.category) || left.company.localeCompare(right.company));
}
