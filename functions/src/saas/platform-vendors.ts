import { createHash } from "node:crypto";
import { getFirestore, type DocumentData, type Firestore } from "firebase-admin/firestore";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { emailHash } from "../communications/email-hash.js";
import { isReservedTestAddress } from "../communications/test-address.js";
import { vendorOfferAudience } from "./vendor-offer.js";

/**
 * StudioCue's vendor database (docs/vendor-network-plan-2026-10-12.md, Phase 4).
 *
 * `platformVendors/{sha256(email)}`: every vendor booked on any studio's job
 * with an email address, once across all studios — the same key as their
 * `vendorInvites` and `emailSuppressions` records, so the Console joins the
 * offer and the opt-out without a second copy. Business contact only: kind,
 * company, contact name, email, phone, website, the region the jobs were in
 * (state and city from the venue), when first and last seen, and how many
 * jobs and studios. **Never the couple, the date or the venue**: a job and a
 * studio are counted by a one-way key, so the record can't be read back into
 * whose wedding it was.
 *
 * Written here, by a trigger on the vendor team (`projectVendors`), so a
 * vendor entered by the studio, listed by the couple, or imported from a
 * form all count the same. Idempotent: a job or studio already counted is
 * not counted twice, however often an entry is saved. No browser reads it
 * (firestore.rules); the Console reads it through its handlers.
 */

export const PLATFORM_VENDORS = "platformVendors";

/** A one-way key for a job or a studio: counted, never named. */
export const sightingKey = (value: string) => createHash("sha256").update(`platform-vendor:${value}`).digest("hex").slice(0, 20);

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export type VendorSighting = {
  hash: string;
  email: string;
  kind: string;
  company: string | null;
  contactName: string | null;
  phone: string | null;
  website: string | null;
  /** couple | studio | client_form | planner: who put them on the job. */
  source: string;
  projectKey: string;
  tenantKey: string;
  region: string | null;
  city: string | null;
  at: string;
};

/**
 * What one booked team entry says about its vendor, or null when it says
 * nothing StudioCue keeps: not booked, no real address, a test address, or
 * taken off the job.
 */
export function sightingFrom(input: {
  entry: DocumentData;
  project: DocumentData | null;
  vendor: DocumentData | null;
  plannerTrade: boolean;
  at: string;
}): VendorSighting | null {
  const { entry } = input;
  if (entry.archivedAt || entry.status !== "booked") return null;
  const email = text(entry.email || input.vendor?.email).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || isReservedTestAddress(email)) return null;
  const tenantId = text(entry.tenantId);
  const projectId = text(entry.projectId);
  if (!tenantId || !projectId) return null;
  const venue = (input.project?.venue ?? null) as { region?: unknown; city?: unknown } | null;
  const declared = text(entry.source);
  return {
    hash: emailHash(email),
    email,
    kind: text(entry.category) || text(input.vendor?.type) || "other",
    company: text(entry.company || input.vendor?.company) || null,
    contactName: text(entry.contactName || input.vendor?.contactName) || null,
    phone: text(entry.phone || input.vendor?.phone) || null,
    website: text(input.vendor?.website) || null,
    source: declared === "couple" || declared === "client_form" ? declared : input.plannerTrade ? "planner" : "studio",
    projectKey: sightingKey(`${tenantId}:${projectId}`),
    tenantKey: sightingKey(tenantId),
    region: text(venue?.region) || null,
    city: text(venue?.city) || text(input.project?.city) || null,
    at: input.at,
  };
}

const union = (existing: unknown, value: string | null): string[] => {
  const list = Array.isArray(existing) ? existing.map(String) : [];
  return value && !list.includes(value) ? [...list, value] : list;
};

/**
 * The record after one more sighting. Pure: the newest non-empty details
 * win, every list only grows, and a job or studio already counted leaves the
 * counts as they were.
 */
export function mergeSighting(existing: DocumentData | null, sighting: VendorSighting): DocumentData {
  const projectKeys = union(existing?.projectKeys, sighting.projectKey);
  const tenantKeys = union(existing?.tenantKeys, sighting.tenantKey);
  const kinds = union(existing?.kinds, sighting.kind);
  const newer = !existing || text(existing.lastSeenAt) <= sighting.at;
  const pick = (field: "company" | "contactName" | "phone" | "website" | "region" | "city") =>
    (newer ? sighting[field] || existing?.[field] : existing?.[field] || sighting[field]) ?? null;
  return {
    id: sighting.hash,
    email: sighting.email,
    kind: newer ? sighting.kind : (existing?.kind ?? sighting.kind),
    kinds,
    company: pick("company"),
    contactName: pick("contactName"),
    phone: pick("phone"),
    website: pick("website"),
    region: pick("region"),
    city: pick("city"),
    regions: union(existing?.regions, sighting.region),
    sources: union(existing?.sources, sighting.source),
    projectKeys,
    tenantKeys,
    jobsSeen: projectKeys.length,
    studiosSeen: tenantKeys.length,
    // Who StudioCue might sell to: a vendor-plan trade, a photographer or
    // videographer (the Studio plan), or a kind with no journey yet.
    prospect: prospectFor(kinds),
    firstSeenAt: existing?.firstSeenAt && text(existing.firstSeenAt) < sighting.at ? existing.firstSeenAt : sighting.at,
    lastSeenAt: newer ? sighting.at : existing?.lastSeenAt,
    updatedAt: sighting.at,
  };
}

/** "vendor_plan" | "studio_plan" | "held", from every kind they've been seen as. */
export function prospectFor(kinds: readonly string[]): "vendor_plan" | "studio_plan" | "held" {
  const audiences = kinds.map((kind) => (kind === "photographer" ? "studio" : vendorOfferAudience(kind)));
  if (audiences.includes("vendor")) return "vendor_plan";
  if (audiences.includes("studio")) return "studio_plan";
  return "held";
}

/** Record one sighting, in a transaction so two saves at once count once. */
export async function recordSighting(db: Firestore, sighting: VendorSighting): Promise<void> {
  const reference = db.doc(`${PLATFORM_VENDORS}/${sighting.hash}`);
  await db.runTransaction(async (transaction) => {
    const current = await transaction.get(reference);
    transaction.set(reference, mergeSighting(current.exists ? (current.data() ?? null) : null, sighting));
  });
}

/** Read what a team entry needs and record it. Shared by the trigger and the backfill. */
export async function recordTeamEntry(db: Firestore, entry: DocumentData, at: string): Promise<boolean> {
  const tenantId = text(entry.tenantId);
  const projectId = text(entry.projectId);
  const vendorId = text(entry.vendorId);
  if (!tenantId || !projectId || entry.status !== "booked" || entry.archivedAt) return false;
  const [project, vendor, tenant] = await Promise.all([
    db.doc(`projects/${projectId}`).get(),
    vendorId ? db.doc(`vendors/${vendorId}`).get() : Promise.resolve(null),
    db.doc(`tenants/${tenantId}`).get(),
  ]);
  if (!project.exists || project.get("tenantId") !== tenantId) return false;
  const sighting = sightingFrom({
    entry,
    project: project.data() ?? null,
    vendor: vendor?.exists && vendor.get("tenantId") === tenantId ? (vendor.data() ?? null) : null,
    plannerTrade: tenant.get("trade") === "planner",
    at,
  });
  if (!sighting) return false;
  await recordSighting(db, sighting);
  return true;
}

/** A team entry booked, or changed while booked: its vendor joins (or refreshes in) the database. */
export const platformVendorOnTeamWritten = onDocumentWritten(
  { document: "projectVendors/{entryId}", region: "us-east4" },
  async (event) => {
    const after = event.data?.after?.data();
    if (!after) return;
    const before = event.data?.before?.data();
    // Only what the database keeps: nothing to do for a change to a time, a balance or a tip.
    const keep = ["status", "email", "company", "contactName", "phone", "category", "archivedAt"];
    if (before && keep.every((field) => before[field] === after[field])) return;
    await recordTeamEntry(getFirestore(), after, text(after.updatedAt) || new Date().toISOString());
  },
);
