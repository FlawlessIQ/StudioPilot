import { z } from "zod";
import { clientOutreachStop } from "@/features/post-event/client-outreach";
import { jobKindOf, journeyProfile } from "@/features/job-kinds/job-kinds";
import { detailsLockOn, planningFormOpensOn, type PlanningTimeline } from "@/features/planning/planning-timeline";
import { tradeOf, tradeProfile, type Trade } from "@/features/trades/trades";
import { VENDOR_TYPES, type VendorType } from "@/features/vendors/schema";
import { VENDOR_CATEGORY_LABELS } from "@/features/vendors/team";

/**
 * The couple's vendor team: the other vendors working their day, listed by
 * the couple in their portal (docs/vendor-network-plan-2026-10-12.md,
 * Phase 1).
 *
 * Why the couple: they hired every one of them, and they are the only person
 * who knows the whole list. Why they'd bother: everyone working the day gets
 * the same schedule and can reach each other — the contact sheet on the
 * final schedule is built from this. The studio gets a complete vendor team
 * without typing it, and StudioCue learns who works weddings (Phase 4).
 *
 * The list lands in the job's vendor team (`projectVendors`, team.ts) as
 * entries with `source: "couple"`; the answer itself — listed, or "no other
 * vendors" — is `clientVendorTeams/{projectId}`, which Today reads until the
 * studio opens it and the final details sign-off reads on lock day
 * (Phase 2).
 *
 * Asked of weddings only, booked and ahead, never a quiet job. It opens with
 * the planning form (`planningFormOpensOn`) and is due the day the details
 * lock (`detailsLockOn`). Pure; the portal route writes
 * (server/vendors/couple-team.ts).
 */

/** The kinds a couple can pick, in the order they think of them. */
export const COUPLE_VENDOR_KINDS: readonly VendorType[] = [
  "planner",
  "venue",
  "photographer",
  "videographer",
  "dj",
  "band",
  "hair_makeup",
  "florist",
  "caterer",
  "bakery",
  "officiant",
  "rentals",
  "entertainment",
  "choreographer",
  "transportation",
  "other",
];

/**
 * The studio's own kind, left off its couple's list: a DJ's couple isn't
 * asked who their DJ is. Hair and makeup stay for a beauty studio, because a
 * hair stylist's couple may well have a separate makeup artist.
 */
const OWN_KIND: Readonly<Record<Trade, VendorType | null>> = {
  photographer: "photographer",
  dj: "dj",
  makeup: null,
  hair: null,
  planner: "planner",
};

export function coupleVendorKinds(trade: unknown): VendorType[] {
  const own = OWN_KIND[tradeOf(trade)];
  return COUPLE_VENDOR_KINDS.filter((kind) => kind !== own);
}

/** What a kind is called to a couple. The venue's contact is who they'd name. */
export function coupleVendorKindLabel(kind: unknown): string {
  if (kind === "venue") return "Venue coordinator";
  if (kind === "planner") return "Planner or coordinator";
  return VENDOR_CATEGORY_LABELS[kind as VendorType] ?? "Other";
}

export const COUPLE_VENDOR_MAX = 25;

const trimmed = (max: number) => z.string().trim().max(max);
const blankToNull = (value: unknown) => (typeof value === "string" && !value.trim() ? null : value);

/** One row as the couple sends it. Email or phone: a vendor nobody can reach is no use on a contact sheet. */
export const coupleVendorRowSchema = z
  .object({
    /** An entry already on the team, when the row is one the couple added before. */
    entryId: z.string().trim().min(1).max(120).nullable().default(null),
    category: z.enum(VENDOR_TYPES),
    company: trimmed(200).min(1),
    contactName: trimmed(160).default(""),
    email: z.preprocess(blankToNull, z.string().trim().max(254).email().nullable()).default(null),
    phone: z.preprocess(blankToNull, z.string().trim().max(40).nullable()).default(null),
  })
  .refine((row) => Boolean(row.email || row.phone), { message: "VENDOR_CONTACT_REQUIRED", path: ["email"] });
export type CoupleVendorRow = z.infer<typeof coupleVendorRowSchema>;

export const coupleVendorSubmissionSchema = z.discriminatedUnion("answer", [
  z.object({ answer: z.literal("listed"), vendors: z.array(coupleVendorRowSchema).min(1).max(COUPLE_VENDOR_MAX) }),
  z.object({ answer: z.literal("none"), vendors: z.array(coupleVendorRowSchema).max(0).default([]) }),
]);
export type CoupleVendorSubmission = z.infer<typeof coupleVendorSubmissionSchema>;

/** Digits only, the US country code dropped: "(555) 010-0199" and "+1 555 010 0199" are one number. */
export function normalizePhone(value: unknown): string {
  const digits = typeof value === "string" ? value.replace(/\D/g, "") : "";
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

export function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * Who a row is, for matching: their email, else their phone, else the
 * business by kind. Two rows with the same key are one vendor.
 */
export function coupleVendorKey(row: Pick<CoupleVendorRow, "category" | "company" | "email" | "phone">): string {
  const email = normalizeEmail(row.email);
  if (email) return `email:${email}`;
  const phone = normalizePhone(row.phone);
  if (phone.length >= 7) return `phone:${phone}`;
  return `name:${row.category}:${row.company.trim().toLowerCase().replace(/\s+/g, " ")}`;
}

/**
 * The rows, one per vendor: a later row for the same vendor fills what the
 * earlier one left blank rather than adding a second entry.
 */
export function dedupeCoupleVendors<T extends CoupleVendorRow>(rows: readonly T[]): T[] {
  const byKey = new Map<string, T>();
  for (const row of rows) {
    const key = coupleVendorKey(row);
    const earlier = byKey.get(key);
    if (!earlier) {
      byKey.set(key, { ...row, email: row.email ? normalizeEmail(row.email) : null });
      continue;
    }
    byKey.set(key, {
      ...earlier,
      entryId: earlier.entryId ?? row.entryId,
      contactName: earlier.contactName || row.contactName,
      email: earlier.email || (row.email ? normalizeEmail(row.email) : null),
      phone: earlier.phone || row.phone,
    });
  }
  return [...byKey.values()];
}

// ─── When it's asked ─────────────────────────────────────────────────────────

const BOOKED_STATES = new Set(["BOOKED", "PLANNING", "READY"]);
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export type CoupleVendorAsk = {
  /** Whether this job's couple is asked at all. */
  available: boolean;
  /** Asked now: the planning form's day has come (or it has gone out early). */
  open: boolean;
  opensOn: string | null;
  /** The lock day, while it's ahead. */
  dueDate: string | null;
};

export function coupleVendorAsk(input: {
  project: Record<string, unknown>;
  timeline: PlanningTimeline;
  today: string;
  /** The planning form has already gone out, whatever the date. */
  planningFormSent?: boolean;
  /** The studio's trade: a planner builds the team itself, so its couple is never asked. */
  trade?: unknown;
}): CoupleVendorAsk {
  const { project, timeline, today } = input;
  const eventDate = text(project.eventDate).slice(0, 10);
  const closed: CoupleVendorAsk = { available: false, open: false, opensOn: null, dueDate: null };
  if (!journeyProfile(jobKindOf(project)).vendorTeam || project.importedAt) return closed;
  if (!BOOKED_STATES.has(text(project.state)) || clientOutreachStop(project) !== null) return closed;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate) || today >= eventDate) return closed;
  // The studio said the planner runs the vendors (Phase 1: "The planner handles vendors").
  if (project.vendorTeamByPlanner === true) return closed;
  // A planning studio runs the team (trades.ts vendorTeam "default"); a
  // month-of couple hands theirs over on the Final details form instead.
  if (input.trade !== undefined && tradeProfile(input.trade).vendorTeam === "default") return closed;
  const opensOn = planningFormOpensOn(eventDate, timeline);
  const lockOn = detailsLockOn(eventDate, timeline);
  return {
    available: true,
    open: Boolean(input.planningFormSent) || !opensOn || today >= opensOn,
    opensOn,
    dueDate: lockOn && lockOn > today ? lockOn : null,
  };
}

// ─── The answer ──────────────────────────────────────────────────────────────

/** `clientVendorTeams/{projectId}`, as both sides read it. */
export type CoupleVendorTeamRecord = {
  id?: string;
  tenantId?: string;
  projectId?: string;
  answer?: string;
  count?: number;
  receivedAt?: string | null;
  studioSeenAt?: string | null;
};

export type CoupleVendorAnswer = "unanswered" | "listed" | "none";

export function coupleVendorAnswer(record: CoupleVendorTeamRecord | null | undefined): CoupleVendorAnswer {
  if (!record?.receivedAt) return "unanswered";
  return record.answer === "none" ? "none" : record.answer === "listed" ? "listed" : "unanswered";
}

/** New on Today until the studio opens it; a later change puts it back. */
export function coupleVendorsNeedStudio(record: CoupleVendorTeamRecord | null | undefined): boolean {
  if (coupleVendorAnswer(record) !== "listed" || !record?.receivedAt) return false;
  return !record.studioSeenAt || record.studioSeenAt < record.receivedAt;
}

/** A row as the couple sees it (server/vendors/couple-team.ts). Never the money. */
export type CoupleVendorView = {
  entryId: string;
  category: VendorType;
  company: string;
  contactName: string;
  email: string | null;
  phone: string | null;
  /** The couple added it, so they can change or remove it; the studio's own rows are theirs. */
  addedByCouple: boolean;
};

export type CoupleVendorTeamView = {
  ask: CoupleVendorAsk;
  answer: CoupleVendorAnswer;
  receivedAt: string | null;
  vendors: CoupleVendorView[];
  /** Businesses they've already named in a form, offered as a start. */
  suggestions: Array<{ category: VendorType; company: string }>;
  /** The kinds offered (the studio's own left off). */
  kinds: VendorType[];
};

/**
 * Vendors a couple already named in a planning form — the starter form's
 * "Other vendors" section asks "Planner or coordinator", "Videographer",
 * "Florist" as free text — offered as rows to finish rather than typed again.
 * Only answers that look like a name: "no", "n/a", "TBD" and "not yet" are not
 * vendors.
 */
const SUGGESTION_FIELDS: ReadonlyArray<[RegExp, VendorType]> = [
  [/\bplanner|coordinator\b/i, "planner"],
  [/\bvideograph/i, "videographer"],
  [/\bflorist|flowers\b/i, "florist"],
  [/\bdj\b|disc jockey/i, "dj"],
  [/\bband\b/i, "band"],
  [/\bcaterer|catering\b/i, "caterer"],
  [/\bhair|makeup|make-up\b/i, "hair_makeup"],
  [/\bcake|bakery\b/i, "bakery"],
  [/\bofficiant\b/i, "officiant"],
];
const NOT_A_NAME = /^(no|none|n\/?a|na|tbd|tba|not yet|not sure|unsure|undecided|-+|\?+|no one|nobody|yes)\.?$/i;

export function vendorSuggestionsFromAnswers(
  answers: ReadonlyArray<{ label: string; value: unknown }>,
  existing: ReadonlyArray<{ category: string; company: string }>,
): Array<{ category: VendorType; company: string }> {
  const taken = new Set(existing.map((row) => `${row.category}:${row.company.trim().toLowerCase()}`));
  const takenKinds = new Set(existing.map((row) => row.category));
  const out: Array<{ category: VendorType; company: string }> = [];
  for (const answer of answers) {
    const value = typeof answer.value === "string" ? answer.value.trim() : "";
    if (!value || value.length > 120 || NOT_A_NAME.test(value)) continue;
    const match = SUGGESTION_FIELDS.find(([pattern]) => pattern.test(answer.label));
    if (!match) continue;
    const category = match[1];
    // The first line, before any contact details they typed after it.
    const company = value.split(/\n|,|\s[-–—]\s|\(/)[0]!.trim();
    if (!company || takenKinds.has(category) || taken.has(`${category}:${company.toLowerCase()}`)) continue;
    taken.add(`${category}:${company.toLowerCase()}`);
    takenKinds.add(category);
    out.push({ category, company });
  }
  return out;
}

/** What the couple is told the list is for — the reason they'd fill it in. */
export const COUPLE_VENDOR_WHY =
  "Everyone working your day gets the same schedule, with each other's names and numbers on it — so the day runs smoothly and nobody has to chase anyone.";

// ─── When the couple takes a vendor off their list ──────────────────────────

/**
 * What only the studio writes on a team entry. The couple's portal creates
 * every one of these empty (server/vendors/couple-team.ts) and never sets
 * them, so any of them set means the studio worked on the entry.
 */
export const STUDIO_ONLY_ENTRY_FIELDS = [
  "roleLabel",
  "arrivalTime",
  "loadInTime",
  "strikeTime",
  "contractReceived",
  "coiReceived",
  "costCents",
  "balanceDueCents",
  "balanceDueDate",
  "tipCents",
  "notes",
] as const;

function fieldSet(value: unknown): boolean {
  if (typeof value === "string") return value.trim() !== "";
  if (typeof value === "number") return Number.isFinite(value);
  return value === true;
}

/**
 * Why a couple-listed entry is the studio's work too, or nothing when it is
 * still exactly what the couple sent: a studio-only field set (its cost, the
 * balance due, the contract or certificate in, its times, notes), a save by
 * someone at the studio (`studioTouchedAt`, or `updatedByStudio` — the last
 * writer is a studio member, for entries from before the stamp), a status
 * the studio changed, or a live timeline link the studio sent them.
 */
export function studioWorkOnCoupleEntry(
  entry: Record<string, unknown>,
  context: { updatedByStudio?: boolean; liveShare?: boolean } = {},
): string[] {
  const reasons: string[] = STUDIO_ONLY_ENTRY_FIELDS.filter((field) => fieldSet(entry[field]));
  if (entry.status !== undefined && entry.status !== "booked") reasons.push("status");
  if (fieldSet(entry.studioTouchedAt) || context.updatedByStudio) reasons.push("studio_edit");
  if (context.liveShare) reasons.push("timeline_link");
  return reasons;
}

export type CoupleRemoval = "delete" | "mark" | "already_marked";

/**
 * A couple-listed vendor no longer on the couple's list. Untouched, it comes
 * off the team as before. Touched by the studio, it is never deleted: it is
 * marked `removedByClientAt` and kept, so the cost, the balance, the
 * contract and certificate flags and the notes stay where the studio left
 * them, and the studio decides — keep them on, or take them off. Already
 * marked, it is left as it was (the first removal's date stands).
 */
export function coupleRemovalFor(
  entry: Record<string, unknown>,
  context: { updatedByStudio?: boolean; liveShare?: boolean } = {},
): CoupleRemoval {
  if (fieldSet(entry.removedByClientAt)) return "already_marked";
  return studioWorkOnCoupleEntry(entry, context).length ? "mark" : "delete";
}

const companyWords = (value: unknown) =>
  typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, " ") : "";
const stringOrNull = (value: unknown) => (typeof value === "string" ? value : null);

/**
 * The entry a row brings back: a couple-listed vendor the couple took off
 * (kept for the studio, `removedByClientAt`) and has now listed again — the
 * same email, the same phone, the same key, or the same business by kind. Re-adding clears
 * the mark on that entry rather than adding the vendor a second time.
 */
export function removedCoupleEntryFor<T extends { id: string; data: Record<string, unknown> }>(
  row: Pick<CoupleVendorRow, "category" | "company" | "email" | "phone">,
  entries: readonly T[],
): T | null {
  const email = normalizeEmail(row.email);
  const key = coupleVendorKey(row);
  const company = companyWords(row.company);
  const removed = entries.filter(
    (entry) => entry.data.source === "couple" && fieldSet(entry.data.removedByClientAt) && !entry.data.archivedAt,
  );
  const keyOf = (data: Record<string, unknown>) =>
    coupleVendorKey({
      category: (VENDOR_TYPES as readonly string[]).includes(String(data.category)) ? (data.category as VendorType) : "other",
      company: stringOrNull(data.company) ?? "",
      email: stringOrNull(data.email),
      phone: stringOrNull(data.phone),
    });
  const phone = normalizePhone(row.phone);
  return (
    removed.find((entry) => email !== "" && normalizeEmail(entry.data.email) === email) ??
    removed.find((entry) => phone.length >= 7 && normalizePhone(entry.data.phone) === phone) ??
    removed.find((entry) => keyOf(entry.data) === key) ??
    removed.find((entry) => company !== "" && entry.data.category === row.category && companyWords(entry.data.company) === company) ??
    null
  );
}
