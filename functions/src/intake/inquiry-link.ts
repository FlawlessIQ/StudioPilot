import { createHash, randomBytes } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { getConsultationSettings } from "../booking/availability.js";
import { convertInquiryToJob } from "./convert.js";

/**
 * The couple's own link: tell us about your day, then pick a time to talk.
 *
 * One link per inquiry, carried by the studio's first reply and every reply
 * after it until they book a call (docs/lead-management-plan-2026-09-28.md,
 * phase 4). It replaces two round trips — "send us your details", then "here
 * is how to book" — with one page.
 *
 * Keyed by the lead, not the job, because an inquiry without a date has no
 * job yet: the details step is where the date arrives, and the job is made
 * the moment it does. The token is random; its hash is what a request is
 * matched on. The raw token is kept (server-only collection) so every later
 * reply can carry the same link.
 */

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "https://studiohub.app").replace(/\/$/, "");
}

/** The link for this inquiry, made the first time it is asked for. */
export async function inquiryLinkFor(
  db: Firestore,
  input: { tenantId: string; leadId: string; now: string },
): Promise<string> {
  const reference = db.doc(`inquiryLinks/${input.leadId}`);
  const token = await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(reference);
    const known = text(existing.get("token"));
    if (existing.exists && existing.get("tenantId") === input.tenantId && known) return known;
    const fresh = randomBytes(32).toString("base64url");
    transaction.set(reference, {
      id: input.leadId,
      tenantId: input.tenantId,
      leadId: input.leadId,
      token: fresh,
      tokenHash: hash(fresh),
      createdAt: input.now,
      updatedAt: input.now,
    });
    return fresh;
  });
  return `${appUrl()}/i/${token}`;
}

/**
 * Whether a reply can carry the link: the studio has said when couples can
 * book. Without hours the page would offer no times, so the reply goes
 * without it and Today says why (features/today/setup-gaps.ts).
 */
export async function studioTakesBookings(db: Firestore, tenantId: string): Promise<boolean> {
  const settings = await db.doc(`consultationSettings/${tenantId}`).get();
  return settings.exists;
}

/** The link's closing line on a drafted reply, or the reply unchanged. */
export async function withInquiryLink(
  db: Firestore,
  input: { tenantId: string; leadId: string; body: string; now: string },
): Promise<{ body: string; linked: boolean }> {
  if (!input.body.trim() || !(await studioTakesBookings(db, input.tenantId))) {
    return { body: input.body, linked: false };
  }
  const url = await inquiryLinkFor(db, input);
  if (input.body.includes(url)) return { body: input.body, linked: true };
  const line = `Tell us a little more about your day and pick a time to talk — it takes two minutes: ${url}`;
  // Before the sign-off when there is one, so the link isn't the last thing
  // after "Warmly,".
  const signOff = /\n\n((?:warmly|best|thanks|thank you|kind regards|regards|cheers|all the best)[^\n]*,?\s*(?:\n[^\n]*)?)$/i.exec(
    input.body.trimEnd(),
  );
  const body = signOff
    ? `${input.body.trimEnd().slice(0, signOff.index)}\n\n${line}\n\n${signOff[1]}`
    : `${input.body.trimEnd()}\n\n${line}`;
  return { body, linked: true };
}

export type InquiryLinkContext = {
  link: FirebaseFirestore.DocumentSnapshot;
  tenantId: string;
  lead: FirebaseFirestore.DocumentSnapshot;
  project: FirebaseFirestore.DocumentSnapshot | null;
};

/** The inquiry behind a token, or an error the page can show. */
export async function resolveInquiryLink(db: Firestore, token: string): Promise<InquiryLinkContext> {
  const matches = await db.collection("inquiryLinks").where("tokenHash", "==", hash(token)).limit(1).get();
  const link = matches.docs[0];
  if (!link) throw new Error("INQUIRY_LINK_NOT_FOUND");
  const tenantId = text(link.get("tenantId"));
  const lead = await db.doc(`leads/${text(link.get("leadId"))}`).get();
  if (!lead.exists || lead.get("tenantId") !== tenantId) throw new Error("INQUIRY_LINK_NOT_FOUND");
  // A closed inquiry's link stops working: "not an inquiry", or closed by the
  // studio. Booked is fine — the couple may still need to move their call.
  if (lead.get("notInquiry") === true) throw new Error("INQUIRY_LINK_NOT_FOUND");
  const projectId = text(lead.get("projectId"));
  const project = projectId ? await db.doc(`projects/${projectId}`).get() : null;
  if (project && (!project.exists || project.get("tenantId") !== tenantId)) {
    throw new Error("INQUIRY_LINK_NOT_FOUND");
  }
  if (project?.get("state") === "LOST" || project?.get("archivedAt")) {
    throw new Error("INQUIRY_LINK_CLOSED");
  }
  return { link, tenantId, lead, project: project ?? null };
}

/** The details a couple is asked for, in the order the page shows them. */
export const DETAIL_FIELDS = [
  "eventDate",
  "partnerName",
  "venue",
  "city",
  "ceremonyTime",
  "estimatedGuestCount",
  "phone",
] as const;
export type DetailField = (typeof DETAIL_FIELDS)[number];

/** What the studio already knows, and what it still needs. */
export function detailsOf(lead: FirebaseFirestore.DocumentSnapshot): {
  known: Partial<Record<DetailField, string | number>>;
  missing: DetailField[];
} {
  const known: Partial<Record<DetailField, string | number>> = {};
  const missing: DetailField[] = [];
  for (const field of DETAIL_FIELDS) {
    const value = lead.get(field);
    if ((typeof value === "string" && value.trim()) || (typeof value === "number" && value > 0)) {
      known[field] = value;
    } else {
      missing.push(field);
    }
  }
  return { known, missing };
}

/**
 * The couple's answers, onto their inquiry: only into fields still empty, so
 * nothing the studio corrected is overwritten, and each marked as the
 * couple's own. A date turns the inquiry into a job.
 */
export async function saveCoupleDetails(
  db: Firestore,
  context: InquiryLinkContext,
  details: Partial<Record<DetailField | "notes", string | number | null>>,
  now: string,
): Promise<{ saved: DetailField[]; projectId: string | null }> {
  const { missing } = detailsOf(context.lead);
  const changes: Record<string, unknown> = {};
  const provenance: Record<string, { source: "couple"; label: null }> = {};
  const provenanceKey: Partial<Record<DetailField, string>> = { estimatedGuestCount: "guestCount" };
  for (const field of missing) {
    const value = details[field];
    if (value === undefined || value === null || value === "") continue;
    if (field === "eventDate" && !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) continue;
    if (field === "estimatedGuestCount") {
      const count = Math.round(Number(value));
      if (!Number.isFinite(count) || count < 1 || count > 100000) continue;
      changes[field] = count;
    } else {
      changes[field] = String(value).trim().slice(0, 200);
    }
    provenance[provenanceKey[field] ?? field] = { source: "couple", label: null };
  }
  const notes = text(details.notes).slice(0, 2000);
  if (notes) changes.coupleNotes = notes;
  if (!Object.keys(changes).length) {
    return { saved: [], projectId: context.project?.id ?? null };
  }
  const next = { ...context.lead.data(), ...changes } as Record<string, unknown>;
  if ("partnerName" in changes) {
    const name = [next.firstName, next.lastName].filter((part) => typeof part === "string" && part).join(" ");
    if (name) changes.displayName = `${name} & ${String(changes.partnerName)}`;
  }
  if ("eventDate" in changes) {
    const clash = await db
      .collection("projects")
      .where("tenantId", "==", context.tenantId)
      .where("eventDate", "==", changes.eventDate)
      .where("state", "in", ["CONSULTATION", "PROPOSAL", "CONTRACT_PENDING", "RETAINER_PENDING", "BOOKED", "PLANNING", "READY"])
      .limit(1)
      .get();
    changes.availabilityStatus = clash.empty ? "available" : "conflict";
  }
  changes.missingInformation = [
    ...(next.email || next.phone ? [] : ["how to reach them"]),
    ...(next.eventDate ? [] : ["event date"]),
    ...(next.venue ? [] : ["venue"]),
    ...(next.estimatedGuestCount ? [] : ["guest count"]),
  ];
  changes.fieldProvenance = {
    ...((context.lead.get("fieldProvenance") as Record<string, unknown>) ?? {}),
    ...provenance,
  };
  await context.lead.ref.update({
    ...changes,
    detailsSubmittedAt: now,
    updatedAt: now,
    updatedBy: "couple",
  });
  if (context.project) {
    const projectChanges: Record<string, unknown> = {};
    if (changes.venue && !text(context.project.get("venueName"))) projectChanges.venueName = changes.venue;
    if (changes.city && !text(context.project.get("city"))) projectChanges.city = changes.city;
    if (Object.keys(projectChanges).length) {
      await context.project.ref.update({ ...projectChanges, updatedAt: now, updatedBy: "couple" });
    }
  }
  let projectId = context.project?.id ?? null;
  if (!projectId) {
    const converted = await convertInquiryToJob(db, {
      tenantId: context.tenantId,
      leadId: context.lead.id,
      now,
      actor: "couple",
    });
    projectId = converted.converted ? converted.projectId : null;
  }
  return { saved: Object.keys(provenance) as DetailField[], projectId };
}

/** How the couple can meet, from what the studio offers. */
export async function meetingOptions(db: Firestore, tenantId: string) {
  const settings = await getConsultationSettings(db, tenantId);
  return {
    formats: settings.meetingFormats,
    inPersonLocation: settings.inPersonLocation,
    durationMinutes: settings.durationMinutes,
  };
}
