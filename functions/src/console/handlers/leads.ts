import type { Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import { consoleHandler, fail } from "../command-kit.js";
import { SOURCE_CHANNELS } from "../../saas/attribution-schema.js";

/**
 * Console → Pipeline (docs/console.md, "Pipeline"): photographers who might
 * become studios. Mirrors features/console/pipeline.ts, which explains the
 * stages. A lead linked to a studio follows the studio, so only the stages a
 * person sets can be written here.
 */

export const MANUAL_LEAD_STAGES = ["new", "contacted", "demo_booked", "lost"] as const;

const text = (max: number) => z.string().trim().max(max).nullable().optional();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();

const leadFields = z.object({
  name: z.string().trim().min(2).max(120),
  studioName: text(160),
  email: z.string().trim().toLowerCase().email().max(200).nullable().optional(),
  phone: text(40),
  website: text(200),
  instagram: text(80),
  location: text(120),
  source: z.enum(SOURCE_CHANNELS).nullable().optional(),
  sourceDetail: text(120),
  partnerId: z.string().max(80).nullable().optional(),
  ownerUid: z.string().max(200).nullable().optional(),
  nextStep: text(200),
  nextStepAt: day,
});

async function ownerEmail(db: Firestore, uid: string | null | undefined): Promise<string | null> {
  if (!uid) return null;
  const admin = await db.doc(`platformAdmins/${uid}`).get();
  if (!admin.exists || admin.get("active") === false) fail("OWNER_NOT_ADMIN");
  return (admin.get("email") as string | undefined) ?? null;
}

export const leadHandlers = {
  createLead: consoleHandler({
    capability: "crm.write",
    input: leadFields.extend({ stage: z.enum(MANUAL_LEAD_STAGES).optional(), message: text(4000) }),
    async run({ db, identity, now }, input) {
      if (input.email) {
        const existing = await db.collection("saasLeads").where("email", "==", input.email).limit(1).get();
        if (!existing.empty) fail("LEAD_EXISTS");
      }
      const reference = db.collection("saasLeads").doc();
      const ownerUid = input.ownerUid ?? identity.uid;
      const record = {
        id: reference.id,
        name: input.name,
        studioName: input.studioName ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        website: input.website ?? null,
        instagram: input.instagram ?? null,
        location: input.location ?? null,
        stage: input.stage ?? "new",
        source: input.source ?? null,
        sourceDetail: input.sourceDetail ?? null,
        partnerId: input.partnerId ?? null,
        ownerUid,
        ownerEmail: ownerUid === identity.uid ? identity.email ?? null : await ownerEmail(db, ownerUid),
        nextStep: input.nextStep ?? null,
        nextStepAt: input.nextStepAt ?? null,
        lostReason: null,
        message: input.message ?? null,
        preferredTimes: null,
        tenantId: null,
        origin: "manual",
        createdBy: identity.uid,
        createdAt: now,
        updatedAt: now,
        stageChangedAt: now,
      };
      await reference.create(record);
      return { result: { leadId: reference.id }, audit: { tenantId: null, entityType: "saas_lead", entityId: reference.id, after: { name: input.name, stage: record.stage } } };
    },
  }),

  updateLead: consoleHandler({
    capability: "crm.write",
    input: leadFields.partial().extend({
      leadId: z.string().min(1).max(80),
      stage: z.enum(MANUAL_LEAD_STAGES).optional(),
      lostReason: text(300),
    }),
    async run({ db, now }, input) {
      const reference = db.doc(`saasLeads/${input.leadId}`);
      const lead = await reference.get();
      if (!lead.exists) fail("LEAD_NOT_FOUND");
      const { leadId, ...fields } = input;
      if (fields.stage && lead.get("tenantId")) fail("LEAD_FOLLOWS_STUDIO");
      if (fields.email && fields.email !== lead.get("email")) {
        const existing = await db.collection("saasLeads").where("email", "==", fields.email).limit(1).get();
        if (existing.docs.some((doc) => doc.id !== leadId)) fail("LEAD_EXISTS");
      }
      const update: Record<string, unknown> = { ...fields, updatedAt: now };
      if (fields.ownerUid !== undefined) update.ownerEmail = await ownerEmail(db, fields.ownerUid);
      if (fields.stage && fields.stage !== lead.get("stage")) update.stageChangedAt = now;
      if (fields.stage && fields.stage !== "lost") update.lostReason = null;
      for (const key of Object.keys(update)) if (update[key] === undefined) delete update[key];
      await reference.update(update);
      const before = Object.fromEntries(Object.keys(fields).map((key) => [key, lead.get(key) ?? null]));
      return { result: { leadId }, audit: { tenantId: null, entityType: "saas_lead", entityId: leadId, before, after: fields } };
    },
  }),

  deleteLead: consoleHandler({
    capability: "crm.write",
    input: z.object({ leadId: z.string().min(1).max(80) }),
    async run({ db }, input) {
      const reference = db.doc(`saasLeads/${input.leadId}`);
      const lead = await reference.get();
      if (!lead.exists) fail("LEAD_NOT_FOUND");
      await reference.delete();
      return { result: { leadId: input.leadId }, audit: { tenantId: null, entityType: "saas_lead", entityId: input.leadId, before: { name: lead.get("name"), email: lead.get("email") } } };
    },
  }),

  /** "Book a demo" settings: where a request goes, and the calendar link offered after it. */
  setGrowthSettings: consoleHandler({
    capability: "settings.write",
    input: z.object({
      demoNotifyEmail: z.string().trim().toLowerCase().email().max(200).nullable(),
      demoBookingUrl: z.string().trim().url().max(500).refine((url) => url.startsWith("https://"), "https only").nullable(),
    }),
    async run({ db, identity, now }, input) {
      const reference = db.doc("consoleSettings/growth");
      const before = (await reference.get()).data() ?? null;
      await reference.set({ ...input, updatedAt: now, updatedBy: identity.uid }, { merge: true });
      return { result: input, audit: { tenantId: null, entityType: "console_settings", entityId: "growth", before, after: input } };
    },
  }),
};
