import { z } from "zod";
import { consoleHandler, fail } from "../command-kit.js";
import { normalizeReferralCode } from "../../saas/referral-program.js";
import { codeTaken } from "./codes.js";

/**
 * Console → Grow → Referrals → Partners (docs/console.md, "Referral partners").
 *
 * A partner is a planner, DJ, hair or makeup artist who sends photographers
 * to StudioCue. Their code is a referral code like a studio's
 * (`saasReferralCodes/{CODE}` → `partnerId`), so it gives the photographer the
 * referral offer on whichever plan they pick (saas/stripe.ts). Referrals that
 * count are tallied by features/console/partner-payouts.ts and paid by hand;
 * a payout is recorded here so the Console knows what is still owed.
 */

// "team": our own codes, counted and never paid (features/console/partner-payouts.ts).
const PARTNER_TYPES = ["planner", "dj", "hair", "makeup", "other", "team"] as const;
const PAYOUT_METHODS = ["venmo", "zelle", "paypal", "check", "bank", "other"] as const;
const text = (max: number) => z.string().trim().max(max).nullable().optional();

const partnerFields = z.object({
  name: z.string().trim().min(2).max(120),
  business: text(160),
  email: z.string().trim().toLowerCase().email().max(200).nullable().optional(),
  phone: text(40),
  type: z.enum(PARTNER_TYPES),
  payoutHandle: text(160),
  notes: text(2000),
});

export const partnerHandlers = {
  createPartner: consoleHandler({
    capability: "codes.write",
    input: partnerFields.extend({ code: z.string().trim().min(1).max(40) }),
    async run({ db, identity, now }, input) {
      const code = normalizeReferralCode(input.code);
      if (!code) fail("PARTNER_CODE_INVALID");
      // One namespace for every code a studio can type: a discount code or a
      // studio's own referral code of the same name would shadow this one.
      if (await codeTaken(db, code)) fail("CODE_TAKEN");
      const reference = db.collection("saasPartners").doc();
      const codeReference = db.doc(`saasReferralCodes/${code}`);
      await db.runTransaction(async (transaction) => {
        if ((await transaction.get(codeReference)).exists) fail("CODE_TAKEN");
        transaction.create(codeReference, { code, partnerId: reference.id, createdAt: now });
        transaction.create(reference, {
          id: reference.id,
          code,
          name: input.name,
          business: input.business ?? null,
          email: input.email ?? null,
          phone: input.phone ?? null,
          type: input.type,
          payoutHandle: input.payoutHandle ?? null,
          notes: input.notes ?? null,
          active: true,
          createdAt: now,
          createdBy: identity.uid,
          updatedAt: now,
        });
      });
      return {
        result: { partnerId: reference.id, code },
        audit: { tenantId: null, entityType: "referral_partner", entityId: reference.id, after: { code, name: input.name, type: input.type } },
      };
    },
  }),

  /**
   * Many at once, from a spreadsheet (features/console/partner-import.ts reads
   * it; the Console sends it in chunks). Each row stands alone: one taken code
   * or one existing partner never stops the rest. A code the Console made gets
   * a number on the end if it turns out to be taken; a code from the sheet is
   * the partner's choice, so it is refused instead.
   */
  createPartners: consoleHandler({
    capability: "codes.write",
    input: z.object({
      partners: z.array(partnerFields.extend({ code: z.string().trim().min(1).max(40), codeMade: z.boolean().default(false) })).min(1).max(100),
    }),
    async run({ db, identity, now }, input) {
      const existing = await db.collection("saasPartners").select("email", "code").get();
      const emails = new Map(existing.docs.filter((doc) => doc.get("email")).map((doc) => [String(doc.get("email")).toLowerCase(), String(doc.get("code"))]));
      const results: Array<{ index: number; partnerId?: string; code?: string; skipped?: string; error?: string }> = [];
      for (const [index, row] of input.partners.entries()) {
        const email = row.email ?? null;
        const known = email ? emails.get(email) : undefined;
        if (known) {
          results.push({ index, code: known, skipped: "ALREADY_PARTNER" });
          continue;
        }
        const stem = normalizeReferralCode(row.code);
        if (!stem) {
          results.push({ index, error: "PARTNER_CODE_INVALID" });
          continue;
        }
        try {
          const reference = db.collection("saasPartners").doc();
          let made: string | null = null;
          for (let attempt = 1; attempt <= (row.codeMade ? 20 : 1) && !made; attempt += 1) {
            const suffix = attempt === 1 ? "" : String(attempt);
            const code = `${stem.slice(0, 20 - suffix.length)}${suffix}`;
            if (await codeTaken(db, code)) continue;
            const codeReference = db.doc(`saasReferralCodes/${code}`);
            made = await db.runTransaction(async (transaction) => {
              if ((await transaction.get(codeReference)).exists) return null;
              transaction.create(codeReference, { code, partnerId: reference.id, createdAt: now });
              transaction.create(reference, {
                id: reference.id,
                code,
                name: row.name,
                business: row.business ?? null,
                email,
                phone: row.phone ?? null,
                type: row.type,
                payoutHandle: row.payoutHandle ?? null,
                notes: row.notes ?? null,
                active: true,
                createdAt: now,
                createdBy: identity.uid,
                updatedAt: now,
                importedAt: now,
              });
              return code;
            });
          }
          if (!made) {
            results.push({ index, error: "CODE_TAKEN" });
            continue;
          }
          if (email) emails.set(email, made);
          results.push({ index, partnerId: reference.id, code: made });
        } catch (caught) {
          results.push({ index, error: caught instanceof Error ? caught.message : "FAILED" });
        }
      }
      const created = results.filter((result) => result.partnerId);
      return {
        result: { results },
        audit: {
          tenantId: null,
          entityType: "referral_partner",
          entityId: "import",
          after: { created: created.length, skipped: results.filter((result) => result.skipped).length, failed: results.filter((result) => result.error).length, codes: created.map((result) => result.code) },
        },
      };
    },
  }),

  /** Their details, and whether the code still works. The code itself never changes: it's on links already sent. */
  updatePartner: consoleHandler({
    capability: "codes.write",
    input: partnerFields.extend({ partnerId: z.string().min(1).max(200), active: z.boolean() }),
    async run({ db, now }, input) {
      const reference = db.doc(`saasPartners/${input.partnerId}`);
      const partner = await reference.get();
      if (!partner.exists) fail("PARTNER_NOT_FOUND");
      const after = {
        name: input.name,
        business: input.business ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        type: input.type,
        payoutHandle: input.payoutHandle ?? null,
        notes: input.notes ?? null,
        active: input.active,
        updatedAt: now,
      };
      await reference.update(after);
      return {
        result: { partnerId: input.partnerId },
        audit: { tenantId: null, entityType: "referral_partner", entityId: input.partnerId, before: { active: partner.get("active") }, after: { active: input.active, name: input.name } },
      };
    },
  }),

  /** Money the team sent a partner, by hand. */
  recordPartnerPayout: consoleHandler({
    capability: "billing.write",
    input: z.object({
      partnerId: z.string().min(1).max(200),
      amountCents: z.number().int().min(100).max(10_000_000),
      paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      method: z.enum(PAYOUT_METHODS),
      reference: text(120),
      note: text(500),
    }),
    async run({ db, identity, now }, input) {
      const partner = await db.doc(`saasPartners/${input.partnerId}`).get();
      if (!partner.exists) fail("PARTNER_NOT_FOUND");
      const reference = db.collection("saasPartnerPayouts").doc();
      await reference.create({
        id: reference.id,
        partnerId: input.partnerId,
        amountCents: input.amountCents,
        paidOn: input.paidOn,
        method: input.method,
        reference: input.reference ?? null,
        note: input.note ?? null,
        recordedBy: identity.uid,
        createdAt: now,
      });
      return {
        result: { payoutId: reference.id },
        audit: { tenantId: null, entityType: "partner_payout", entityId: reference.id, after: { partnerId: input.partnerId, amountCents: input.amountCents, method: input.method } },
      };
    },
  }),

  /** A payout recorded by mistake. */
  deletePartnerPayout: consoleHandler({
    capability: "billing.write",
    input: z.object({ payoutId: z.string().min(1).max(200) }),
    async run({ db }, input) {
      const reference = db.doc(`saasPartnerPayouts/${input.payoutId}`);
      const payout = await reference.get();
      if (!payout.exists) fail("PAYOUT_NOT_FOUND");
      await reference.delete();
      return {
        result: { payoutId: input.payoutId },
        audit: { tenantId: null, entityType: "partner_payout", entityId: input.payoutId, before: { partnerId: payout.get("partnerId"), amountCents: payout.get("amountCents") }, after: null },
      };
    },
  }),
};
