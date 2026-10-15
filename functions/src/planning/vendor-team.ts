import { createHash } from "node:crypto";
import { FieldValue, type DocumentData, type Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import { tradeProfile } from "../trades/trades.js";
import { mintRunOfShowShare, shareIdFor } from "./share-mint.js";
import { clientOutreachStop } from "../post-event/client-outreach.js";
import { companyKey, parseVendorSection, vendorsToImport } from "./vendor-section.js";
import { creditLineText, vendorCredits } from "./vendor-credits.js";
import { jobKindOf, journeyProfile } from "../job-kinds/job-kinds.js";

/**
 * A wedding's vendor team, written (docs/planner-journey-plan.md, N1 + N2).
 *
 * `projectVendors/{projectId}_{entryId}`: one entry per vendor on a job — or
 * per category still needed — with its status, the vendor's arrival, load-in
 * and strike times, whether their contract and certificate are in, their
 * total, what the couple still owes them and the tip. The browser reads it
 * (features/vendors/team.ts) and never writes it; every change comes through
 * planningCommand, here.
 *
 * And the one press a planner's whole complaint is about: the timeline to
 * every booked vendor, each through their own link (the run-of-show share),
 * each version once.
 */

/** The vendor directory's kinds (features/vendors/schema.ts VENDOR_TYPES — tests/vendor-team.test.ts keeps them equal). */
export const VENDOR_TEAM_CATEGORIES = [
  "venue",
  "planner",
  "florist",
  "dj",
  "band",
  "videographer",
  "hair_makeup",
  "caterer",
  "transportation",
  "insurance_agent",
  "corporate_contact",
  "sports_organizer",
  "photographer",
  "officiant",
  "bakery",
  "rentals",
  "entertainment",
  "choreographer",
  "other",
] as const;
/** What each kind is called on a printed contact sheet (features/vendors/team.ts VENDOR_CATEGORY_LABELS). */
const CATEGORY_LABELS: Record<(typeof VENDOR_TEAM_CATEGORIES)[number], string> = {
  venue: "Venue",
  planner: "Planner",
  florist: "Florist",
  dj: "DJ",
  band: "Band",
  videographer: "Videographer",
  hair_makeup: "Hair and makeup",
  caterer: "Caterer",
  transportation: "Transportation",
  insurance_agent: "Insurance agent",
  corporate_contact: "Corporate contact",
  sports_organizer: "Sports organizer",
  photographer: "Photographer",
  officiant: "Officiant",
  bakery: "Cake",
  rentals: "Rentals",
  entertainment: "Entertainment",
  choreographer: "Choreographer",
  other: "Other",
};
export function vendorTeamCategoryLabel(category: unknown): string {
  return CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS] ?? "Vendor";
}

export const VENDOR_TEAM_STATUSES = ["needed", "considering", "booked", "declined"] as const;

const clock = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .nullable()
  .default(null);
// Integer cents, at most $1,000,000 a line.
const cents = z.number().int().nonnegative().max(100_000_000).nullable().default(null);

const newVendor = z.object({
  company: z.string().trim().min(1).max(200),
  contactName: z.string().trim().max(160).default(""),
  email: z.string().trim().email().nullable().default(null),
  phone: z.string().trim().max(40).nullable().default(null),
});

/** The vendor's own details, changed from the team: written to the directory. */
const vendorDetails = newVendor;

const entryFields = {
  category: z.enum(VENDOR_TEAM_CATEGORIES),
  roleLabel: z.string().trim().max(80).nullable().default(null),
  status: z.enum(VENDOR_TEAM_STATUSES),
  arrivalTime: clock,
  loadInTime: clock,
  strikeTime: clock,
  contractReceived: z.boolean().default(false),
  coiReceived: z.boolean().default(false),
  costCents: cents,
  balanceDueCents: cents,
  balanceDueDate: z.string().date().nullable().default(null),
  tipCents: cents,
  notes: z.string().trim().max(2000).nullable().default(null),
};

export const vendorTeamCommands = [
  z.object({
    /**
     * Put a vendor on a job's team: one from the directory, someone new (who
     * joins the directory), or nobody yet — a category the wedding needs.
     */
    type: z.literal("addVendorTeamEntry"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string().min(1),
      vendorId: z.string().min(1).nullable().default(null),
      newVendor: newVendor.nullable().default(null),
      ...entryFields,
    }),
  }),
  z.object({
    /** Change an entry: its vendor, status, times, money and notes, and the vendor's own details. */
    type: z.literal("updateVendorTeamEntry"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string().min(1),
      entryId: z.string().min(1),
      vendorId: z.string().min(1).nullable().default(null),
      newVendor: newVendor.nullable().default(null),
      vendorDetails: vendorDetails.nullable().default(null),
      ...entryFields,
    }),
  }),
  z.object({
    /** Take an entry off the job. The vendor stays in the directory; their link to this job stops opening. */
    type: z.literal("removeVendorTeamEntry"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string().min(1),
      entryId: z.string().min(1),
    }),
  }),
  z.object({
    /** The couple's budget for the light budget line (decision 4). Null clears it. */
    type: z.literal("setProjectBudget"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string().min(1),
      budgetCents: z.number().int().nonnegative().max(10_000_000_00).nullable(),
    }),
  }),
  z.object({
    /**
     * After the day, the couple's vendor credits: every booked vendor's
     * category, name and website, the studio first (vendor-credits.ts).
     * Once per job; the studio presses it, nothing sends it on its own.
     */
    type: z.literal("sendVendorCredits"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string().min(1),
    }),
  }),
  z.object({
    /**
     * The timeline to every booked vendor with an email address: a link of
     * their own each, the update to anyone holding an older version, nothing
     * to anyone who already has this one.
     */
    type: z.literal("sendTimelineToVendorTeam"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string().min(1),
      message: z.string().max(4000).default(""),
    }),
  }),
  z.object({
    /** The studio has seen the couple's list of their vendors: off Today (clientVendorTeams). */
    type: z.literal("markCoupleVendorsSeen"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({ projectId: z.string().min(1) }),
  }),
  z.object({
    /**
     * The planner runs this wedding's vendors: the couple isn't asked to
     * list them (features/vendors/couple-team.ts). False asks them again.
     */
    type: z.literal("setVendorTeamByPlanner"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({ projectId: z.string().min(1), byPlanner: z.boolean() }),
  }),
] as const;

export type VendorTeamCommand = z.infer<(typeof vendorTeamCommands)[number]>;

const TYPES: ReadonlySet<string> = new Set(vendorTeamCommands.map((schema) => schema.shape.type.value));
export function isVendorTeamCommand(parsed: { type: string }): parsed is VendorTeamCommand {
  return TYPES.has(parsed.type);
}

// ─── Pure decisions (tests/vendor-team.test.ts) ──────────────────────────────

/**
 * A budget the couple wrote, as cents — only when it says one amount.
 *
 * "$35,000", "35k", "about $35,000" read; a range ("$30,000–$40,000"), an
 * open end ("$12,000+", "under 20k") or anything else is ambiguous, and an
 * ambiguous budget is left for the studio to set rather than guessed.
 */
export function parseBudgetCents(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase();
  if (!text || text.length > 80) return null;
  if (/[+<>–—]|\bto\b|\bunder\b|\bover\b|\bless\b|\bmore\b|\bup\b|\bbelow\b|\babove\b|\bbetween\b|\bor\b|\d\s*-\s*\$?\d/.test(text))
    return null;
  const numbers = [...text.matchAll(/\$?\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k|thousand)?\b/g)];
  if (numbers.length !== 1) return null;
  const [, digits, thousands] = numbers[0]!;
  const amount = Number(digits!.replace(/,/g, "")) * (thousands ? 1000 : 1);
  if (!Number.isFinite(amount) || amount < 100 || amount > 10_000_000) return null;
  return Math.round(amount * 100);
}

/**
 * The budget a job starts with, from its inquiry.
 *
 * Only for a trade whose inquiry asks the couple's whole budget — the one
 * that runs the vendor team by default (the planner, Phase 2). Every trade
 * today asks for its own: "Photographer budget", "DJ budget" (the inquiry
 * form's budget legend), and $5,000–$8,000 for photos is not the wedding's
 * budget. Read as one, it would print "$18,400 of $8,000 booked".
 */
export function budgetPrefillCents(trade: unknown, budgetRange: unknown): number | null {
  if (tradeProfile(trade).vendorTeam !== "default") return null;
  return parseBudgetCents(budgetRange);
}

/** A planner or a videographer needs the whole day; everyone else their part of it. */
export function teamShareScope(category: unknown): "vendor" | "full" {
  return category === "planner" || category === "videographer" ? "full" : "vendor";
}

export type TimelineSendAction = "new" | "update" | "current" | "no_email" | "unavailable";

export type TimelineSendPlanEntry = {
  entryId: string;
  vendorId: string;
  company: string;
  action: TimelineSendAction;
  scope: "vendor" | "full";
};

type PlanEntry = { entryId: string; vendorId: string | null; status: string; category: string; archivedAt?: unknown };
type PlanVendor = { exists: boolean; archived: boolean; email: string | null; company: string };
type PlanShare = { status: string; revokedAt: unknown; scheduleId: string | null; scope: string | null };

/**
 * Who gets what when the studio sends the timeline to every vendor.
 *
 * Only booked entries with a vendor. Per vendor: nothing new to anyone whose
 * link already shows this version ("current" — pressing twice sends nothing
 * twice), the update to anyone holding an earlier one, a first link to the
 * rest. A vendor with no email address is said, not skipped silently; an
 * archived or missing vendor is not sent anything.
 */
export function planVendorTimelineSends(input: {
  entries: readonly PlanEntry[];
  vendors: ReadonlyMap<string, PlanVendor>;
  shares: ReadonlyMap<string, PlanShare>;
  currentScheduleId: string;
}): TimelineSendPlanEntry[] {
  const seen = new Set<string>();
  const plan: TimelineSendPlanEntry[] = [];
  for (const entry of input.entries) {
    if (entry.archivedAt || entry.status !== "booked" || !entry.vendorId || seen.has(entry.vendorId)) continue;
    seen.add(entry.vendorId);
    const vendor = input.vendors.get(entry.vendorId);
    const share = input.shares.get(entry.vendorId);
    const liveShare = share && share.status !== "revoked" && !share.revokedAt ? share : null;
    const scope =
      liveShare && (liveShare.scope === "full" || liveShare.scope === "vendor") ? liveShare.scope : teamShareScope(entry.category);
    const company = vendor?.company ?? "";
    const action: TimelineSendAction =
      !vendor || !vendor.exists || vendor.archived
        ? "unavailable"
        : !vendor.email || !vendor.email.includes("@")
          ? "no_email"
          : liveShare && liveShare.scheduleId === input.currentScheduleId
            ? "current"
            : liveShare
              ? "update"
              : "new";
    plan.push({ entryId: entry.entryId, vendorId: entry.vendorId, company, action, scope });
  }
  return plan;
}

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
 * What the crew may know about the job's vendors: who, how to reach them,
 * and when they arrive. Never the money — what the couple pays the florist
 * is not the second shooter's business — so the crew read this projection
 * (`crewVendorContacts/{projectId}`), not the team itself.
 */
export function crewVendorContactsFrom(entries: readonly DocumentData[]): CrewVendorContact[] {
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

/** "Maya Brooks" from "Maya Brooks Wedding", the way the studio's create form names a job. */
export function coupleNameOf(projectName: unknown): string {
  const name = typeof projectName === "string" ? projectName.trim() : "";
  return name.replace(/\s+wedding$/i, "").trim() || name;
}

/** Job states with the day ahead and the couple booked: when the vendor ask runs. */
const ASK_STATES = new Set(["BOOKED", "PLANNING", "READY"]);

/**
 * Whether the couple still owes their vendor list (features/vendors/couple-team.ts
 * `coupleVendorAsk`, the same rule from the functions side): a booked wedding
 * with the day ahead, not quiet, not run by a planner, at a studio that isn't
 * a planner, and not yet answered. The planning form's request and reminders
 * carry one line about it when it is — no email series of its own
 * (docs/vendor-network-plan-2026-10-12.md, Phase 1).
 */
export function vendorAskOwed(input: { project: DocumentData; trade: unknown; answered: boolean; today: string }): boolean {
  const { project } = input;
  if (input.answered || project.importedAt || project.vendorTeamByPlanner === true) return false;
  if (!journeyProfile(jobKindOf(project)).vendorTeam || !ASK_STATES.has(str(project.state))) return false;
  if (tradeProfile(input.trade).vendorTeam === "default" || clientOutreachStop(project) !== null) return false;
  const eventDate = str(project.eventDate).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(eventDate) && input.today < eventDate;
}

/** `vendorAskOwed` for one job, read as the email goes. */
export async function vendorAskOwedFor(db: Firestore, tenantId: string, projectId: string): Promise<boolean> {
  if (!tenantId || !projectId) return false;
  const [project, tenant, answer] = await Promise.all([
    db.doc(`projects/${projectId}`).get(),
    db.doc(`tenants/${tenantId}`).get(),
    db.doc(`clientVendorTeams/${projectId}`).get(),
  ]);
  if (!project.exists || project.get("tenantId") !== tenantId) return false;
  return vendorAskOwed({
    project: project.data() ?? {},
    trade: tenant.get("trade"),
    answered: answer.exists && answer.get("tenantId") === tenantId && ["listed", "none"].includes(str(answer.get("answer"))),
    today: new Date().toISOString().slice(0, 10),
  });
}

// ─── Writes ──────────────────────────────────────────────────────────────────

export type VendorTeamContext = {
  actorId: string;
  now: string;
  userAgent: string | null;
  appUrl: string;
};

const hash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 32);
const stableId = (scope: string, tenantId: string, key: string) => `${scope}_${hash(`${tenantId}:${key}`)}`;
const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");

function auditEvent(input: {
  id: string;
  tenantId: string;
  projectId: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  now: string;
  before: unknown;
  after: unknown;
  userAgent: string | null;
  correlationId: string;
}) {
  return {
    id: input.id,
    tenantId: input.tenantId,
    projectId: input.projectId,
    actorId: input.actorId,
    actorType: "user",
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    timestamp: input.now,
    before: input.before,
    after: input.after,
    ipAddress: null,
    userAgent: input.userAgent,
    correlationId: input.correlationId,
    automationRunId: null,
    providerEventId: null,
  };
}

/** The vendor's directory details as an entry carries them. */
function vendorSnapshot(vendor: DocumentData | undefined | null) {
  return {
    company: str(vendor?.company) || null,
    contactName: str(vendor?.contactName) || null,
    email: str(vendor?.email) || null,
    phone: str(vendor?.phone) || null,
  };
}

type EntryInput = Pick<z.infer<(typeof vendorTeamCommands)[0]>["input"], keyof typeof entryFields>;

function entryValues(input: EntryInput) {
  return {
    category: input.category,
    roleLabel: input.roleLabel || null,
    status: input.status,
    arrivalTime: input.arrivalTime,
    loadInTime: input.loadInTime,
    strikeTime: input.strikeTime,
    contractReceived: input.contractReceived,
    coiReceived: input.coiReceived,
    costCents: input.costCents,
    balanceDueCents: input.balanceDueCents,
    balanceDueDate: input.balanceDueDate,
    tipCents: input.tipCents,
    notes: input.notes || null,
  };
}

/** Rewrite the crew's view of the job's vendors from the team as it now stands. */
export async function rebuildCrewVendorContacts(db: Firestore, tenantId: string, projectId: string, now: string) {
  const entries = await db
    .collection("projectVendors")
    .where("tenantId", "==", tenantId)
    .where("projectId", "==", projectId)
    .get();
  await db.doc(`crewVendorContacts/${projectId}`).set({
    id: projectId,
    tenantId,
    projectId,
    vendors: crewVendorContactsFrom(entries.docs.map((entry) => entry.data())),
    updatedAt: now,
  });
}

/**
 * A vendor's directory details changed (here, or on the Vendors page): every
 * team entry naming them, and the crew's view of each of those jobs, follow.
 */
export async function refreshVendorOnTeams(db: Firestore, tenantId: string, vendorId: string, now: string) {
  const [vendor, entries] = await Promise.all([
    db.doc(`vendors/${vendorId}`).get(),
    db.collection("projectVendors").where("tenantId", "==", tenantId).where("vendorId", "==", vendorId).get(),
  ]);
  if (!vendor.exists || vendor.get("tenantId") !== tenantId || entries.empty) return;
  const batch = db.batch();
  for (const entry of entries.docs) batch.update(entry.ref, { ...vendorSnapshot(vendor.data()), updatedAt: now });
  await batch.commit();
  const projects = new Set(entries.docs.map((entry) => String(entry.get("projectId") ?? "")).filter(Boolean));
  for (const projectId of projects) await rebuildCrewVendorContacts(db, tenantId, projectId, now);
}

async function addOrUpdateEntry(
  db: Firestore,
  parsed: Extract<VendorTeamCommand, { type: "addVendorTeamEntry" | "updateVendorTeamEntry" }>,
  context: VendorTeamContext,
): Promise<Record<string, unknown>> {
  const { tenantId, idempotencyKey } = parsed;
  const input = parsed.input;
  const adding = parsed.type === "addVendorTeamEntry";
  if (input.vendorId && input.newVendor) throw new Error("VENDOR_CHOICE_AMBIGUOUS");
  const entryId = parsed.type === "updateVendorTeamEntry" ? parsed.input.entryId : stableId("pv", tenantId, idempotencyKey);
  const reference = db.doc(`projectVendors/${input.projectId}_${entryId}`);
  const projectReference = db.doc(`projects/${input.projectId}`);
  const newVendorId = input.newVendor ? stableId("vendor", tenantId, `team:${idempotencyKey}`) : null;
  const details = parsed.type === "updateVendorTeamEntry" ? parsed.input.vendorDetails : null;

  const outcome = await db.runTransaction(async (transaction) => {
    const [project, current, team, tenant] = await Promise.all([
      transaction.get(projectReference),
      transaction.get(reference),
      transaction.get(
        db.collection("projectVendors").where("tenantId", "==", tenantId).where("projectId", "==", input.projectId),
      ),
      transaction.get(db.doc(`tenants/${tenantId}`)),
    ]);
    if (!project.exists || project.get("tenantId") !== tenantId) throw new Error("PROJECT_NOT_FOUND");
    if (adding && current.exists) throw new Error("VENDOR_TEAM_ENTRY_EXISTS");
    if (!adding && (!current.exists || current.get("tenantId") !== tenantId || current.get("projectId") !== input.projectId))
      throw new Error("VENDOR_TEAM_ENTRY_NOT_FOUND");
    // Who the entry is: the one chosen, someone new, or nobody yet. An edit
    // sends whoever it is now, changed or not.
    const priorVendorId = current.exists ? (str(current.get("vendorId")) || null) : null;
    const vendorId = newVendorId ?? input.vendorId;
    if (input.status === "booked" && !vendorId) throw new Error("VENDOR_REQUIRED_TO_BOOK");
    // Every read before the first write (a Firestore transaction's rule).
    const leadId = adding && project.get("budgetCents") === undefined ? str(project.get("leadId")) : "";
    const [vendor, lead] = await Promise.all([
      vendorId && !newVendorId ? transaction.get(db.doc(`vendors/${vendorId}`)) : Promise.resolve(null),
      leadId ? transaction.get(db.doc(`leads/${leadId}`)) : Promise.resolve(null),
    ]);
    if (vendor && (!vendor.exists || vendor.get("tenantId") !== tenantId || (vendor.get("archivedAt") && vendorId !== priorVendorId)))
      throw new Error("VENDOR_NOT_FOUND");
    // One entry per vendor on a job. The read of the project above and the
    // write to it below make two adds of the same vendor take turns.
    if (vendorId && team.docs.some((entry) => entry.id !== reference.id && entry.get("vendorId") === vendorId && !entry.get("archivedAt")))
      throw new Error("VENDOR_ALREADY_ON_TEAM");

    const directory = newVendorId
      ? {
          company: input.newVendor!.company,
          contactName: input.newVendor!.contactName,
          email: input.newVendor!.email,
          phone: input.newVendor!.phone,
        }
      : details && vendorId
        ? { company: details.company, contactName: details.contactName, email: details.email, phone: details.phone }
        : null;
    const snapshot = directory
      ? vendorSnapshot(directory)
      : vendor?.exists
        ? vendorSnapshot(vendor.data())
        : vendorId
          ? {
              company: (current.get("company") as string | null) ?? null,
              contactName: (current.get("contactName") as string | null) ?? null,
              email: (current.get("email") as string | null) ?? null,
              phone: (current.get("phone") as string | null) ?? null,
            }
          : { company: null, contactName: null, email: null, phone: null };

    if (newVendorId) {
      transaction.create(db.doc(`vendors/${newVendorId}`), {
        id: newVendorId,
        tenantId,
        projectId: input.projectId,
        projectIds: input.status === "declined" ? [] : [input.projectId],
        company: input.newVendor!.company,
        contactName: input.newVendor!.contactName,
        email: input.newVendor!.email,
        phone: input.newVendor!.phone,
        type: input.category,
        website: null,
        address: null,
        notes: null,
        createdAt: context.now,
        updatedAt: context.now,
        createdBy: context.actorId,
        updatedBy: context.actorId,
        archivedAt: null,
      });
    } else if (vendorId) {
      // On the job while they are on its team (job facts and invites read
      // `projectIds`); a vendor the couple passed on is not.
      transaction.update(db.doc(`vendors/${vendorId}`), {
        projectIds: input.status === "declined" ? FieldValue.arrayRemove(input.projectId) : FieldValue.arrayUnion(input.projectId),
        ...(directory ? { ...directory } : {}),
        updatedAt: context.now,
        updatedBy: context.actorId,
      });
    }
    if (!adding && priorVendorId && priorVendorId !== vendorId) {
      transaction.update(db.doc(`vendors/${priorVendorId}`), {
        projectIds: FieldValue.arrayRemove(input.projectId),
        updatedAt: context.now,
        updatedBy: context.actorId,
      });
    }

    const values = { ...entryValues(input), vendorId, ...snapshot };
    if (adding) {
      transaction.create(reference, {
        id: reference.id,
        entryId,
        tenantId,
        projectId: input.projectId,
        ...values,
        createdAt: context.now,
        updatedAt: context.now,
        createdBy: context.actorId,
        updatedBy: context.actorId,
        archivedAt: null,
        // The couple adds theirs from the portal (server/vendors/couple-team.ts).
        source: "studio",
      });
    } else {
      transaction.update(reference, { ...values, updatedAt: context.now, updatedBy: context.actorId });
    }
    // The first time a team is started, the couple's budget from their
    // inquiry, once (budgetPrefillCents says when that is safe to read).
    let budgetPrefilled: number | null = null;
    const projectWrite: Record<string, unknown> = { vendorTeamUpdatedAt: context.now };
    if (adding && project.get("budgetCents") === undefined) {
      budgetPrefilled =
        lead?.exists && lead.get("tenantId") === tenantId ? budgetPrefillCents(tenant.get("trade"), lead.get("budgetRange")) : null;
      if (budgetPrefilled !== null) Object.assign(projectWrite, { budgetCents: budgetPrefilled, budgetSource: "inquiry", budgetSetAt: context.now });
    }
    transaction.update(projectReference, projectWrite);
    transaction.set(
      db.doc(`auditEvents/${stableId("audit_vendor_team", tenantId, idempotencyKey)}`),
      auditEvent({
        id: stableId("audit_vendor_team", tenantId, idempotencyKey),
        tenantId,
        projectId: input.projectId,
        actorId: context.actorId,
        action: adding ? "vendor_team.entry_added" : "vendor_team.entry_updated",
        entityType: "project_vendor",
        entityId: reference.id,
        now: context.now,
        before: current.exists ? { ...current.data() } : null,
        after: values,
        userAgent: context.userAgent,
        correlationId: idempotencyKey,
      }),
    );
    return { vendorId, vendorChanged: Boolean(directory && vendorId && !newVendorId), budgetPrefilled };
  });

  if (outcome.vendorChanged && outcome.vendorId) await refreshVendorOnTeams(db, tenantId, outcome.vendorId, context.now);
  else await rebuildCrewVendorContacts(db, tenantId, input.projectId, context.now);
  return {
    entryId,
    vendorId: outcome.vendorId,
    createdVendorId: newVendorId,
    budgetPrefilledCents: outcome.budgetPrefilled,
  };
}

async function removeEntry(
  db: Firestore,
  parsed: Extract<VendorTeamCommand, { type: "removeVendorTeamEntry" }>,
  context: VendorTeamContext,
): Promise<Record<string, unknown>> {
  const { tenantId, idempotencyKey } = parsed;
  const reference = db.doc(`projectVendors/${parsed.input.projectId}_${parsed.input.entryId}`);
  const removed = await db.runTransaction(async (transaction) => {
    const current = await transaction.get(reference);
    if (!current.exists || current.get("tenantId") !== tenantId || current.get("projectId") !== parsed.input.projectId)
      throw new Error("VENDOR_TEAM_ENTRY_NOT_FOUND");
    const vendorId = str(current.get("vendorId")) || null;
    const share = vendorId ? await transaction.get(db.doc(`scheduleShares/${shareIdFor(tenantId, parsed.input.projectId, vendorId)}`)) : null;
    transaction.delete(reference);
    if (vendorId) {
      transaction.update(db.doc(`vendors/${vendorId}`), {
        projectIds: FieldValue.arrayRemove(parsed.input.projectId),
        updatedAt: context.now,
        updatedBy: context.actorId,
      });
    }
    // Off the wedding, so their link to its timeline stops opening — the
    // same rule as archiving a vendor (planning/commands.ts archiveVendor).
    let revoked = false;
    if (share?.exists && share.get("tenantId") === tenantId && share.get("status") !== "revoked") {
      transaction.update(share.ref, {
        status: "revoked",
        revokedAt: context.now,
        revokedReason: "removed_from_vendor_team",
        updatedAt: context.now,
        updatedBy: context.actorId,
      });
      revoked = true;
    }
    transaction.update(db.doc(`projects/${parsed.input.projectId}`), { vendorTeamUpdatedAt: context.now });
    const auditId = stableId("audit_vendor_team", tenantId, idempotencyKey);
    transaction.set(
      db.doc(`auditEvents/${auditId}`),
      auditEvent({
        id: auditId,
        tenantId,
        projectId: parsed.input.projectId,
        actorId: context.actorId,
        action: "vendor_team.entry_removed",
        entityType: "project_vendor",
        entityId: reference.id,
        now: context.now,
        before: { ...current.data() },
        after: null,
        userAgent: context.userAgent,
        correlationId: idempotencyKey,
      }),
    );
    return { vendorId, revoked };
  });
  await rebuildCrewVendorContacts(db, tenantId, parsed.input.projectId, context.now);
  return { entryId: parsed.input.entryId, removed: true, revokedShare: removed.revoked };
}

async function setBudget(
  db: Firestore,
  parsed: Extract<VendorTeamCommand, { type: "setProjectBudget" }>,
  context: VendorTeamContext,
): Promise<Record<string, unknown>> {
  const { tenantId, idempotencyKey } = parsed;
  const projectReference = db.doc(`projects/${parsed.input.projectId}`);
  const project = await projectReference.get();
  if (!project.exists || project.get("tenantId") !== tenantId) throw new Error("PROJECT_NOT_FOUND");
  const auditId = stableId("audit_project_budget", tenantId, idempotencyKey);
  const batch = db.batch();
  batch.update(projectReference, {
    budgetCents: parsed.input.budgetCents,
    budgetSource: "studio",
    budgetSetAt: context.now,
    updatedAt: context.now,
    updatedBy: context.actorId,
  });
  batch.set(
    db.doc(`auditEvents/${auditId}`),
    auditEvent({
      id: auditId,
      tenantId,
      projectId: parsed.input.projectId,
      actorId: context.actorId,
      action: "project.budget_set",
      entityType: "project",
      entityId: parsed.input.projectId,
      now: context.now,
      before: { budgetCents: project.get("budgetCents") ?? null },
      after: { budgetCents: parsed.input.budgetCents },
      userAgent: context.userAgent,
      correlationId: idempotencyKey,
    }),
  );
  await batch.commit();
  return { projectId: parsed.input.projectId, budgetCents: parsed.input.budgetCents };
}

async function sendTimeline(
  db: Firestore,
  parsed: Extract<VendorTeamCommand, { type: "sendTimelineToVendorTeam" }>,
  context: VendorTeamContext,
): Promise<Record<string, unknown>> {
  const { tenantId, idempotencyKey } = parsed;
  const projectId = parsed.input.projectId;
  const message = parsed.input.message.trim();
  return db.runTransaction(async (transaction) => {
    const [project, schedules, team, shares] = await Promise.all([
      transaction.get(db.doc(`projects/${projectId}`)),
      transaction.get(
        db
          .collection("schedules")
          .where("tenantId", "==", tenantId)
          .where("projectId", "==", projectId)
          .orderBy("version", "desc")
          .limit(1),
      ),
      transaction.get(db.collection("projectVendors").where("tenantId", "==", tenantId).where("projectId", "==", projectId)),
      transaction.get(db.collection("scheduleShares").where("tenantId", "==", tenantId).where("projectId", "==", projectId)),
    ]);
    if (!project.exists || project.get("tenantId") !== tenantId) throw new Error("PROJECT_NOT_FOUND");
    const current = schedules.docs[0];
    if (!current || current.get("status") !== "published") throw new Error("NO_PUBLISHED_RUN_OF_SHOW");
    const version = Number(current.get("version"));
    const entries = team.docs.map((entry) => ({
      entryId: str(entry.get("entryId")) || entry.id,
      vendorId: str(entry.get("vendorId")) || null,
      status: str(entry.get("status")),
      category: str(entry.get("category")),
      archivedAt: entry.get("archivedAt"),
    }));
    const vendorIds = [...new Set(entries.filter((entry) => entry.status === "booked" && entry.vendorId).map((entry) => entry.vendorId!))];
    const vendorDocs = vendorIds.length ? await transaction.getAll(...vendorIds.map((id) => db.doc(`vendors/${id}`))) : [];
    const vendors = new Map(
      vendorDocs.map((vendor) => [
        vendor.id,
        {
          exists: vendor.exists && vendor.get("tenantId") === tenantId,
          archived: Boolean(vendor.get("archivedAt")),
          email: str(vendor.get("email")) || null,
          company: str(vendor.get("company")),
          contactName: str(vendor.get("contactName")),
          type: str(vendor.get("type")),
        },
      ]),
    );
    const shareDocs = new Map(shares.docs.map((share) => [str(share.get("vendorContactId")), share]));
    const plan = planVendorTimelineSends({
      entries,
      vendors,
      shares: new Map(
        [...shareDocs].map(([vendorId, share]) => [
          vendorId,
          {
            status: str(share.get("status")),
            revokedAt: share.get("revokedAt") ?? null,
            scheduleId: str(share.get("scheduleId")) || null,
            scope: str(share.get("scope")) || null,
          },
        ]),
      ),
      currentScheduleId: current.id,
    });
    const sending = plan.filter((item) => item.action === "new" || item.action === "update");
    // The email for each (vendor, version) once: a job already queued for
    // this version means this version already went.
    const jobIds = sending.map((item) => `vendor_timeline_${shareIdFor(tenantId, projectId, item.vendorId)}_v${version}`);
    const existingJobs = jobIds.length ? await transaction.getAll(...jobIds.map((id) => db.doc(`emailJobs/${id}`))) : [];

    const projectName = str(project.get("name"));
    const sent: Array<Record<string, unknown>> = [];
    for (const [index, item] of sending.entries()) {
      if (existingJobs[index]?.exists) {
        item.action = "current";
        continue;
      }
      const vendor = vendors.get(item.vendorId)!;
      const minted = mintRunOfShowShare({ tenantId, projectId, vendorContactId: item.vendorId, appUrl: context.appUrl });
      const prior = shareDocs.get(item.vendorId);
      const update = item.action === "update";
      transaction.set(db.doc(`scheduleShares/${minted.shareId}`), {
        id: minted.shareId,
        tenantId,
        projectId,
        scheduleId: current.id,
        sharedVersion: version,
        vendorContactId: item.vendorId,
        vendorCompany: vendor.company,
        vendorType: vendor.type || "other",
        scope: item.scope,
        message: message || (prior ? str(prior.get("message")) : ""),
        tokenHash: minted.tokenHash,
        // A new version is a new question: "does this work for you?"
        status: "sent",
        sentAt: context.now,
        viewedAt: null,
        viewedVersion: null,
        acknowledgedAt: null,
        acknowledgedVersion: null,
        revokedAt: null,
        expiresAt: minted.expiresAt,
        sendCount: Number(prior?.get("sendCount") ?? 0) + 1,
        createdAt: prior?.get("createdAt") ?? context.now,
        updatedAt: context.now,
        createdBy: prior?.get("createdBy") ?? context.actorId,
        updatedBy: context.actorId,
        archivedAt: null,
      });
      const jobId = jobIds[index]!;
      transaction.create(db.doc(`emailJobs/${jobId}`), {
        id: jobId,
        tenantId,
        projectId,
        type: "vendor_timeline",
        // A vendor's copy: never the couple's mail, even at the same address,
        // and never copied to anyone else on the job.
        audience: "vendor",
        soleRecipient: true,
        recipient: vendor.email,
        recipientName: vendor.contactName || vendor.company || null,
        projectName,
        coupleName: coupleNameOf(projectName),
        eventDate: str(project.get("eventDate")).slice(0, 10) || null,
        venueName: str(project.get("venueName")) || null,
        shareUrl: minted.shareUrl,
        shareScope: item.scope,
        timelineUpdate: update,
        scheduleVersion: version,
        studioNote: message || null,
        vendorShareId: minted.shareId,
        vendorCompany: vendor.company,
        status: "queued",
        attempts: 0,
        createdAt: context.now,
        updatedAt: context.now,
      });
      sent.push({ vendorId: item.vendorId, company: vendor.company, update });
    }
    const auditId = stableId("audit_vendor_timeline", tenantId, idempotencyKey);
    transaction.set(
      db.doc(`auditEvents/${auditId}`),
      auditEvent({
        id: auditId,
        tenantId,
        projectId,
        actorId: context.actorId,
        action: "vendor_team.timeline_sent",
        entityType: "schedule",
        entityId: current.id,
        now: context.now,
        before: null,
        after: { version, sent: sent.map((item) => item.vendorId) },
        userAgent: context.userAgent,
        correlationId: idempotencyKey,
      }),
    );
    const named = (action: TimelineSendAction) => plan.filter((item) => item.action === action).map((item) => item.company || "A vendor");
    return {
      scheduleId: current.id,
      version,
      sentCount: sent.filter((item) => !item.update).length,
      updatedCount: sent.filter((item) => item.update).length,
      sent,
      alreadyCurrent: named("current"),
      noEmail: named("no_email"),
      unavailable: named("unavailable"),
    };
  });
}

/** Job states after the day: the credits are for a wedding that happened. */
const AFTER_THE_DAY = new Set(["EVENT_COMPLETE", "POST_PRODUCTION", "DELIVERED", "REVIEW_REQUESTED", "CLOSED"]);

export const vendorCreditsJobId = (tenantId: string, projectId: string) => `vendor_credits_${tenantId}_${projectId}`;

async function sendCredits(
  db: Firestore,
  parsed: Extract<VendorTeamCommand, { type: "sendVendorCredits" }>,
  context: VendorTeamContext,
): Promise<Record<string, unknown>> {
  const { tenantId, idempotencyKey } = parsed;
  const projectId = parsed.input.projectId;
  const jobId = vendorCreditsJobId(tenantId, projectId);
  return db.runTransaction(async (transaction) => {
    const [project, tenant, team, existing] = await Promise.all([
      transaction.get(db.doc(`projects/${projectId}`)),
      transaction.get(db.doc(`tenants/${tenantId}`)),
      transaction.get(db.collection("projectVendors").where("tenantId", "==", tenantId).where("projectId", "==", projectId)),
      transaction.get(db.doc(`emailJobs/${jobId}`)),
    ]);
    if (!project.exists || project.get("tenantId") !== tenantId) throw new Error("PROJECT_NOT_FOUND");
    // Sent once: a second press says so rather than mailing the couple again.
    if (existing.exists) return { emailJobId: jobId, alreadySent: true, count: Number(existing.get("creditCount") ?? 0) };
    if (!AFTER_THE_DAY.has(str(project.get("state")))) throw new Error("VENDOR_CREDITS_AFTER_THE_DAY");
    // Quiet by default: an imported, paused, put-away or canceled job's
    // couple is never written to (client-outreach.ts, ADR 0005).
    if (project.get("importedAt") || clientOutreachStop(project.data()) !== null) throw new Error("CLIENT_OUTREACH_PAUSED");
    const entries = team.docs.map((entry) => entry.data());
    const vendorIds = [...new Set(entries.filter((entry) => entry.status === "booked").map((entry) => str(entry.vendorId)).filter(Boolean))];
    const vendorDocs = vendorIds.length ? await transaction.getAll(...vendorIds.map((id) => db.doc(`vendors/${id}`))) : [];
    const vendors = new Map(
      vendorDocs
        .filter((vendor) => vendor.exists && vendor.get("tenantId") === tenantId)
        .map((vendor) => [vendor.id, { website: vendor.get("website"), company: vendor.get("company") }]),
    );
    const credits = vendorCredits({
      entries,
      vendors,
      studio: {
        name: str(tenant.get("brandName")) || str(tenant.get("businessName")),
        website: record(tenant.get("emailBranding")).websiteUrl,
        category: "Planning",
      },
    });
    // The studio alone is no list: someone has to be booked.
    if (credits.length < 2) throw new Error("VENDOR_CREDITS_EMPTY");
    const projectName = str(project.get("name"));
    transaction.create(db.doc(`emailJobs/${jobId}`), {
      id: jobId,
      tenantId,
      projectId,
      type: "vendor_credits",
      projectName,
      coupleName: coupleNameOf(projectName),
      credits: credits.map(creditLineText),
      creditCount: credits.length,
      clientOutreachGuard: true,
      status: "queued",
      attempts: 0,
      createdAt: context.now,
      updatedAt: context.now,
    });
    transaction.update(project.ref, { vendorCreditsSentAt: context.now });
    const auditId = stableId("audit_vendor_credits", tenantId, idempotencyKey);
    transaction.set(
      db.doc(`auditEvents/${auditId}`),
      auditEvent({
        id: auditId,
        tenantId,
        projectId,
        actorId: context.actorId,
        action: "vendor_team.credits_sent",
        entityType: "project",
        entityId: projectId,
        now: context.now,
        before: null,
        after: { credits: credits.length },
        userAgent: context.userAgent,
        correlationId: idempotencyKey,
      }),
    );
    return { emailJobId: jobId, alreadySent: false, count: credits.length };
  });
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/**
 * The vendors a couple listed in their Final details vendor section
 * (vendor-section.ts), onto the job's team: each one not already on it joins
 * the studio's directory and the team, booked — the couple booked them. Run
 * when the couple sends the form back, and again when they change the
 * section after; ids come from the job and the company, so a vendor is
 * added once however often it runs. Returns who was added.
 */
export async function importVendorsFromForm(
  db: Firestore,
  input: { tenantId: string; projectId: string; text: unknown; actorId: string; now: string },
): Promise<{ added: string[] }> {
  const { tenantId, projectId } = input;
  const section = parseVendorSection(input.text);
  if (!section.length) return { added: [] };
  const added = await db.runTransaction(async (transaction) => {
    const [project, team] = await Promise.all([
      transaction.get(db.doc(`projects/${projectId}`)),
      transaction.get(db.collection("projectVendors").where("tenantId", "==", tenantId).where("projectId", "==", projectId)),
    ]);
    if (!project.exists || project.get("tenantId") !== tenantId) return [];
    const fresh = vendorsToImport(section, team.docs.map((entry) => entry.data())).slice(0, 30);
    if (!fresh.length) return [];
    const ids = fresh.map((vendor) => {
      const key = `form:${projectId}:${companyKey(vendor.company)}`;
      return { entryId: stableId("pv", tenantId, key), vendorId: stableId("vendor", tenantId, key) };
    });
    const [entryDocs, vendorDocs] = await Promise.all([
      transaction.getAll(...ids.map((id) => db.doc(`projectVendors/${projectId}_${id.entryId}`))),
      transaction.getAll(...ids.map((id) => db.doc(`vendors/${id.vendorId}`))),
    ]);
    const names: string[] = [];
    fresh.forEach((vendor, index) => {
      const { entryId, vendorId } = ids[index]!;
      // Removed from the team by the studio after an earlier send: the
      // studio's call stands, the couple's line does not bring them back.
      if (entryDocs[index]?.exists || vendorDocs[index]?.exists) return;
      transaction.create(db.doc(`vendors/${vendorId}`), {
        id: vendorId,
        tenantId,
        projectId,
        projectIds: [projectId],
        company: vendor.company,
        contactName: vendor.contactName,
        email: vendor.email,
        phone: vendor.phone,
        type: vendor.category,
        website: null,
        address: null,
        notes: "Listed by the couple on their final details.",
        createdAt: input.now,
        updatedAt: input.now,
        createdBy: input.actorId,
        updatedBy: input.actorId,
        archivedAt: null,
      });
      transaction.create(db.doc(`projectVendors/${projectId}_${entryId}`), {
        id: `${projectId}_${entryId}`,
        entryId,
        tenantId,
        projectId,
        vendorId,
        category: vendor.category,
        roleLabel: null,
        status: "booked",
        arrivalTime: vendor.arrivalTime,
        loadInTime: null,
        strikeTime: null,
        contractReceived: false,
        coiReceived: false,
        costCents: null,
        balanceDueCents: null,
        balanceDueDate: null,
        tipCents: null,
        notes: "From the couple's final details.",
        company: vendor.company,
        contactName: vendor.contactName || null,
        email: vendor.email,
        phone: vendor.phone,
        source: "client_form",
        createdAt: input.now,
        updatedAt: input.now,
        createdBy: input.actorId,
        updatedBy: input.actorId,
        archivedAt: null,
      });
      names.push(vendor.company);
    });
    if (!names.length) return [];
    transaction.update(project.ref, { vendorTeamUpdatedAt: input.now });
    const auditId = stableId("audit_vendor_team_form", tenantId, `${projectId}:${input.now}`);
    transaction.set(
      db.doc(`auditEvents/${auditId}`),
      auditEvent({
        id: auditId,
        tenantId,
        projectId,
        actorId: input.actorId,
        action: "vendor_team.imported_from_form",
        entityType: "project",
        entityId: projectId,
        now: input.now,
        before: null,
        after: { added: names },
        userAgent: null,
        correlationId: auditId,
      }),
    );
    return names;
  });
  if (added.length) await rebuildCrewVendorContacts(db, tenantId, projectId, input.now);
  return { added };
}

/** Run one vendor-team command. The caller has checked the member, their role and the job. */
export async function runVendorTeamCommand(
  db: Firestore,
  parsed: VendorTeamCommand,
  context: VendorTeamContext,
): Promise<Record<string, unknown>> {
  switch (parsed.type) {
    case "addVendorTeamEntry":
    case "updateVendorTeamEntry":
      return addOrUpdateEntry(db, parsed, context);
    case "removeVendorTeamEntry":
      return removeEntry(db, parsed, context);
    case "setProjectBudget":
      return setBudget(db, parsed, context);
    case "sendTimelineToVendorTeam":
      return sendTimeline(db, parsed, context);
    case "sendVendorCredits":
      return sendCredits(db, parsed, context);
    case "markCoupleVendorsSeen": {
      const reference = db.doc(`clientVendorTeams/${parsed.input.projectId}`);
      const current = await reference.get();
      if (!current.exists || current.get("tenantId") !== parsed.tenantId) throw new Error("VENDOR_TEAM_ANSWER_NOT_FOUND");
      await reference.update({ studioSeenAt: context.now, studioSeenBy: context.actorId, updatedAt: context.now });
      return { projectId: parsed.input.projectId, seen: true };
    }
    case "setVendorTeamByPlanner": {
      const reference = db.doc(`projects/${parsed.input.projectId}`);
      const project = await reference.get();
      if (!project.exists || project.get("tenantId") !== parsed.tenantId) throw new Error("PROJECT_NOT_FOUND");
      const auditId = stableId("audit_vendor_team", parsed.tenantId, parsed.idempotencyKey);
      const batch = db.batch();
      batch.update(reference, { vendorTeamByPlanner: parsed.input.byPlanner, updatedAt: context.now, updatedBy: context.actorId });
      batch.set(
        db.doc(`auditEvents/${auditId}`),
        auditEvent({
          id: auditId,
          tenantId: parsed.tenantId,
          projectId: parsed.input.projectId,
          actorId: context.actorId,
          action: "vendor_team.planner_handles_set",
          entityType: "project",
          entityId: parsed.input.projectId,
          now: context.now,
          before: { vendorTeamByPlanner: project.get("vendorTeamByPlanner") ?? false },
          after: { vendorTeamByPlanner: parsed.input.byPlanner },
          userAgent: context.userAgent,
          correlationId: parsed.idempotencyKey,
        }),
      );
      await batch.commit();
      return { projectId: parsed.input.projectId, vendorTeamByPlanner: parsed.input.byPlanner };
    }
  }
}

/** A phone number as people read it — the functions copy of features/vendors/team.ts displayPhone. */
export function displayPhone(value: unknown): string {
  const typed = typeof value === "string" ? value.trim() : "";
  const digits = typed.replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (local.length !== 10 || /[^\d\s().+-]/.test(typed)) return typed;
  return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
}
