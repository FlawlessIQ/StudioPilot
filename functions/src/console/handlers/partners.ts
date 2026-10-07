import { randomBytes } from "node:crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import { consoleHandler, fail } from "../command-kit.js";
import { STUDIOCUE_METADATA, productIdsForPlans, stripeMock, stripeRequest } from "../stripe-admin.js";
import { codeTaken } from "./codes.js";

/**
 * Partners: the vendors who sell StudioCue to the studios they work with
 * (docs/console.md, "Partners").
 *
 * Conor and GR Productions, 2026-10-07: Gabe's network of DJs, hair and
 * makeup artists and planners each get their own code. A studio signing up
 * with it gets its first year on the annual plan at $900: sold as half the
 * $1,800 list price (12 x $150), billed as 40% off the $1,500 annual plan;
 * the partner earns $100 for each studio once that first annual payment
 * clears, and at ten every one of them is worth $200 (features/console/
 * partners.ts). Later the same program runs the other way, with photographers
 * selling to DJs and hair and makeup once those journeys exist.
 *
 * Every partner code is a Stripe promotion code over one shared coupon,
 * tagged `kind=partner` so Checkout puts the studio on the yearly price
 * (saas/stripe-checkout.ts, `annualOnly`) and the webhook can credit the
 * partner (saas/partner-referrals.ts). Each is mirrored into `saasDiscounts`
 * so the Discount codes page lists it and can deactivate it like any other.
 */

const CODE = /^[A-Z0-9][A-Z0-9_-]{2,30}$/;

/** Year 1 for $900: 40% off the $1,500 annual plan, which is 50% off the $1,800 list price. */
export const PARTNER_PERCENT_OFF = 40;
/** Long enough to cover a 14-day trial and the first annual invoice, and no renewal. */
export const PARTNER_DISCOUNT_MONTHS = 12;

export const PARTNER_KINDS = ["dj", "hair", "makeup", "hair_makeup", "planner", "venue", "florist", "photographer", "videographer", "other"] as const;

const PROGRAM = "saasSettings/partnerProgram";

/** The one coupon every partner code points at, made on first use. */
async function partnerCoupon(db: Firestore): Promise<string> {
  const program = await db.doc(PROGRAM).get();
  const existing = program.get("couponId");
  if (typeof existing === "string" && existing) return existing;
  const couponId = stripeMock()
    ? `mock_partner_coupon_${randomBytes(4).toString("hex")}`
    : (
        await stripeRequest<{ id: string }>("POST", "coupons", {
          name: "Partner offer: 50% off the $1,800 list price",
          percent_off: PARTNER_PERCENT_OFF,
          duration: "repeating",
          duration_in_months: PARTNER_DISCOUNT_MONTHS,
          "applies_to[products]": await productIdsForPlans(["studio", "multi_brand"]),
          "metadata[app]": STUDIOCUE_METADATA.app,
          "metadata[kind]": "partner",
        })
      ).id;
  await db.doc(PROGRAM).set({ couponId, percentOff: PARTNER_PERCENT_OFF, months: PARTNER_DISCOUNT_MONTHS, createdAt: new Date().toISOString() }, { merge: true });
  return couponId;
}

const partnerInput = z.object({
  name: z.string().trim().min(2).max(120),
  kind: z.enum(PARTNER_KINDS),
  business: z.string().trim().max(160).nullable().optional(),
  email: z.string().trim().email().max(200).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export const partnerHandlers = {
  createPartner: consoleHandler({
    capability: "partners.write",
    input: partnerInput.extend({ code: z.string().trim().toUpperCase().regex(CODE) }),
    async run({ db, identity, now }, input) {
      if (await codeTaken(db, input.code)) fail("CODE_TAKEN");
      const partnerId = `partner_${randomBytes(6).toString("hex")}`;
      const couponId = await partnerCoupon(db);
      const promotionCodeId = stripeMock()
        ? `promo_mock_${randomBytes(5).toString("hex")}`
        : (
            await stripeRequest<{ id: string }>("POST", "promotion_codes", {
              coupon: couponId,
              code: input.code,
              "restrictions[first_time_transaction]": "true",
              "metadata[app]": STUDIOCUE_METADATA.app,
              "metadata[kind]": "partner",
              "metadata[partnerId]": partnerId,
              "metadata[label]": `Partner: ${input.name}`.slice(0, 80),
            })
          ).id;
      const batch = db.batch();
      batch.create(db.doc(`saasPartners/${partnerId}`), {
        id: partnerId,
        name: input.name,
        kind: input.kind,
        business: input.business ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        notes: input.notes ?? null,
        code: input.code,
        promotionCodeId,
        couponId,
        active: true,
        paidOutCents: 0,
        createdAt: now,
        createdBy: identity.uid,
        updatedAt: now,
      });
      // Listed on Discount codes too, where it can be deactivated.
      batch.create(db.doc(`saasDiscounts/${promotionCodeId}`), {
        id: promotionCodeId,
        kind: "promotion_code",
        code: input.code,
        couponId,
        label: `Partner: ${input.name}`,
        summary: "Year 1 for $900 (50% off the $1,800 list price), annual plan",
        percentOff: PARTNER_PERCENT_OFF,
        amountOffCents: null,
        duration: "repeating",
        durationMonths: PARTNER_DISCOUNT_MONTHS,
        plans: ["studio", "multi_brand"],
        maxRedemptions: null,
        expiresAt: null,
        firstTimeOnly: true,
        active: true,
        timesRedeemed: 0,
        batchId: null,
        partnerId,
        createdAt: now,
        createdBy: identity.uid,
        updatedAt: now,
        syncedAt: now,
      });
      await batch.commit();
      return {
        result: { partnerId, code: input.code, promotionCodeId },
        audit: { tenantId: null, entityType: "partner", entityId: partnerId, after: { name: input.name, kind: input.kind, code: input.code } },
      };
    },
  }),

  updatePartner: consoleHandler({
    capability: "partners.write",
    input: partnerInput.extend({ partnerId: z.string().min(1) }),
    async run({ db, now }, input) {
      const reference = db.doc(`saasPartners/${input.partnerId}`);
      const partner = await reference.get();
      if (!partner.exists) fail("PARTNER_NOT_FOUND");
      const after = {
        name: input.name,
        kind: input.kind,
        business: input.business ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        notes: input.notes ?? null,
      };
      await reference.update({ ...after, updatedAt: now });
      return { result: { partnerId: input.partnerId }, audit: { tenantId: null, entityType: "partner", entityId: input.partnerId, before: partner.data(), after } };
    },
  }),

  /** Money paid to a partner, so "owed" stays true. Recorded, never sent from here. */
  recordPartnerPayout: consoleHandler({
    capability: "partners.write",
    input: z.object({
      partnerId: z.string().min(1),
      amountCents: z.number().int().min(100).max(10_000_000),
      paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      note: z.string().trim().max(500).nullable().optional(),
    }),
    async run({ db, identity, now }, input) {
      const reference = db.doc(`saasPartners/${input.partnerId}`);
      const partner = await reference.get();
      if (!partner.exists) fail("PARTNER_NOT_FOUND");
      const payoutId = `payout_${randomBytes(6).toString("hex")}`;
      const batch = db.batch();
      batch.create(db.doc(`saasPartnerPayouts/${payoutId}`), {
        id: payoutId,
        partnerId: input.partnerId,
        amountCents: input.amountCents,
        paidOn: input.paidOn,
        note: input.note ?? null,
        createdAt: now,
        createdBy: identity.uid,
      });
      batch.update(reference, { paidOutCents: FieldValue.increment(input.amountCents), updatedAt: now });
      await batch.commit();
      return {
        result: { payoutId },
        audit: { tenantId: null, entityType: "partner", entityId: input.partnerId, after: { payoutCents: input.amountCents, paidOn: input.paidOn } },
      };
    },
  }),
};
