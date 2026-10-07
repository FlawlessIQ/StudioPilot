import { randomBytes } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import { consoleHandler, fail } from "../command-kit.js";
import { STUDIOCUE_METADATA, fromUnix, productIdsForPlans, stripeMock, stripeRequest, unix } from "../stripe-admin.js";

/**
 * Discount codes (docs/console.md, "Discount codes").
 *
 * A code is a Stripe promotion code over a Stripe coupon. Studios type it at
 * Checkout (allow_promotion_codes), or arrive with it on a signup link and
 * have it applied for them. Every coupon is limited to StudioCue's products
 * and tagged `metadata[app]=studiocue`, because the Stripe account is shared
 * with AdHelm and ScoreOps and a code must never discount their products.
 *
 * `saasDiscounts/{promotionCodeId}` mirrors each code for the Console's table.
 * Stripe is the record; syncCodes refreshes redemption counts from it.
 */

const CODE = /^[A-Z0-9][A-Z0-9_-]{2,30}$/;

export const codeTerms = z
  .object({
    label: z.string().trim().max(80).nullable().optional(),
    percentOff: z.number().min(1).max(100).nullable().optional(),
    amountOffCents: z.number().int().min(100).max(1_000_000).nullable().optional(),
    duration: z.enum(["once", "repeating", "forever"]),
    durationMonths: z.number().int().min(1).max(36).nullable().optional(),
    plans: z.array(z.enum(["studio", "multi_brand"])).min(1).max(2),
    maxRedemptions: z.number().int().min(1).max(100_000).nullable().optional(),
    expiresAt: z.string().datetime().nullable().optional(),
    firstTimeOnly: z.boolean(),
  })
  .refine((terms) => Boolean(terms.percentOff) !== Boolean(terms.amountOffCents), { message: "ONE_DISCOUNT_KIND" })
  .refine((terms) => terms.duration !== "repeating" || Boolean(terms.durationMonths), { message: "MONTHS_REQUIRED" })
  .refine((terms) => !terms.expiresAt || Date.parse(terms.expiresAt) > Date.now() + 60_000, { message: "EXPIRY_MUST_BE_FUTURE" });

type CodeTerms = z.infer<typeof codeTerms>;

/** Describes the terms in words: "20% off for 3 months". Pure. */
export function describeTerms(terms: Pick<CodeTerms, "percentOff" | "amountOffCents" | "duration" | "durationMonths">): string {
  const amount = terms.percentOff ? `${terms.percentOff}% off` : `$${((terms.amountOffCents ?? 0) / 100).toFixed(2).replace(/\.00$/, "")} off`;
  if (terms.duration === "forever") return `${amount} forever`;
  if (terms.duration === "repeating") return `${amount} for ${terms.durationMonths} month${terms.durationMonths === 1 ? "" : "s"}`;
  return `${amount} the first payment`;
}

async function createCoupon(terms: CodeTerms, name: string, batchId: string | null): Promise<string> {
  if (stripeMock()) return `mock_coupon_${randomBytes(4).toString("hex")}`;
  const products = await productIdsForPlans(terms.plans);
  const params: Record<string, string | number | undefined | string[]> = {
    name: name.slice(0, 40),
    duration: terms.duration,
    duration_in_months: terms.duration === "repeating" ? (terms.durationMonths ?? undefined) : undefined,
    "applies_to[products]": products,
    "metadata[app]": STUDIOCUE_METADATA.app,
    "metadata[kind]": batchId ? "batch" : "code",
    ...(batchId ? { "metadata[batchId]": batchId } : {}),
  };
  if (terms.percentOff) params.percent_off = terms.percentOff;
  else {
    params.amount_off = terms.amountOffCents ?? undefined;
    params.currency = "usd";
  }
  const coupon = await stripeRequest<{ id: string }>("POST", "coupons", params);
  return coupon.id;
}

async function createPromotionCode(
  couponId: string,
  code: string,
  terms: CodeTerms,
  maxRedemptions: number | null,
  batchId: string | null,
): Promise<string> {
  if (stripeMock()) return `promo_mock_${randomBytes(5).toString("hex")}`;
  const promotion = await stripeRequest<{ id: string }>("POST", "promotion_codes", {
    coupon: couponId,
    code,
    max_redemptions: maxRedemptions ?? undefined,
    expires_at: terms.expiresAt ? unix(terms.expiresAt) : undefined,
    "restrictions[first_time_transaction]": terms.firstTimeOnly ? "true" : undefined,
    "metadata[app]": STUDIOCUE_METADATA.app,
    ...(terms.label ? { "metadata[label]": terms.label.slice(0, 80) } : {}),
    ...(batchId ? { "metadata[batchId]": batchId } : {}),
  });
  return promotion.id;
}

function mirror(id: string, couponId: string, code: string, terms: CodeTerms, uid: string, now: string, batchId: string | null, maxRedemptions: number | null) {
  return {
    id,
    kind: "promotion_code",
    code,
    couponId,
    label: terms.label ?? null,
    summary: describeTerms(terms),
    percentOff: terms.percentOff ?? null,
    amountOffCents: terms.amountOffCents ?? null,
    duration: terms.duration,
    durationMonths: terms.duration === "repeating" ? (terms.durationMonths ?? null) : null,
    plans: terms.plans,
    maxRedemptions,
    expiresAt: terms.expiresAt ?? null,
    firstTimeOnly: terms.firstTimeOnly,
    active: true,
    timesRedeemed: 0,
    batchId,
    createdAt: now,
    createdBy: uid,
    updatedAt: now,
    syncedAt: now,
  };
}

function randomSuffix(length = 6): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(length);
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
}

export async function codeTaken(db: Firestore, code: string): Promise<boolean> {
  const mirrorHit = await db.collection("saasDiscounts").where("code", "==", code).limit(1).get();
  if (!mirrorHit.empty) return true;
  if (stripeMock()) return false;
  const list = await stripeRequest<{ data?: unknown[] }>("GET", "promotion_codes", { code, limit: 1 });
  return Boolean(list.data?.length);
}

export const codeHandlers = {
  createDiscountCode: consoleHandler({
    capability: "codes.write",
    input: z.object({ code: z.string().trim().toUpperCase().regex(CODE), terms: codeTerms }),
    async run({ db, identity, now }, input) {
      if (await codeTaken(db, input.code)) fail("CODE_TAKEN");
      const couponId = await createCoupon(input.terms, input.terms.label || input.code, null);
      const id = await createPromotionCode(couponId, input.code, input.terms, input.terms.maxRedemptions ?? null, null);
      await db.doc(`saasDiscounts/${id}`).create(mirror(id, couponId, input.code, input.terms, identity.uid, now, null, input.terms.maxRedemptions ?? null));
      return {
        result: { id, code: input.code, couponId, summary: describeTerms(input.terms) },
        audit: { tenantId: null, entityType: "discount_code", entityId: id, after: { code: input.code, summary: describeTerms(input.terms) } },
      };
    },
  }),

  /**
   * Many single-use codes over one coupon, for a show or a mailing: each
   * studio gets its own and none can be passed around.
   */
  generateCodeBatch: consoleHandler({
    capability: "codes.write",
    input: z.object({
      prefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,12}$/),
      count: z.number().int().min(2).max(200),
      terms: codeTerms,
    }),
    async run({ db, identity, now }, input) {
      const batchId = `batch_${randomBytes(5).toString("hex")}`;
      const couponId = await createCoupon(input.terms, input.terms.label || `${input.prefix} batch`, batchId);
      const codes: string[] = [];
      const seen = new Set<string>();
      let writer = db.batch();
      let pending = 0;
      while (codes.length < input.count) {
        const code = `${input.prefix}-${randomSuffix()}`;
        if (seen.has(code)) continue;
        seen.add(code);
        const id = await createPromotionCode(couponId, code, input.terms, 1, batchId);
        writer.create(db.doc(`saasDiscounts/${id}`), mirror(id, couponId, code, input.terms, identity.uid, now, batchId, 1));
        codes.push(code);
        pending += 1;
        if (pending === 400) {
          await writer.commit();
          writer = db.batch();
          pending = 0;
        }
      }
      writer.create(db.doc(`saasDiscounts/${batchId}`), {
        id: batchId,
        kind: "batch",
        prefix: input.prefix,
        couponId,
        label: input.terms.label ?? null,
        summary: describeTerms(input.terms),
        count: codes.length,
        plans: input.terms.plans,
        expiresAt: input.terms.expiresAt ?? null,
        createdAt: now,
        createdBy: identity.uid,
      });
      await writer.commit();
      return {
        result: { batchId, couponId, count: codes.length, codes },
        audit: { tenantId: null, entityType: "discount_batch", entityId: batchId, after: { prefix: input.prefix, count: codes.length, summary: describeTerms(input.terms) } },
      };
    },
  }),

  /** Stops a code being redeemed. Studios already on it keep their discount. */
  deactivateCode: consoleHandler({
    capability: "codes.write",
    input: z.object({ ids: z.array(z.string().min(1).max(200)).min(1).max(200) }),
    async run({ db, now }, input) {
      for (const id of input.ids) {
        const reference = db.doc(`saasDiscounts/${id}`);
        const code = await reference.get();
        if (!code.exists || code.get("kind") !== "promotion_code") fail("CODE_NOT_FOUND");
        if (!stripeMock()) await stripeRequest("POST", `promotion_codes/${encodeURIComponent(id)}`, { active: "false" });
        await reference.update({ active: false, deactivatedAt: now, updatedAt: now });
      }
      return { result: { deactivated: input.ids.length }, audit: { tenantId: null, entityType: "discount_code", entityId: input.ids.join(",").slice(0, 400), after: { active: false } } };
    },
  }),

  syncCodes: consoleHandler({
    capability: "console.read",
    input: z.object({}).optional(),
    async run({ db }) {
      const updated = await syncCodesFromStripe(db);
      return { result: { updated }, audit: { tenantId: null, entityType: "discount_code", entityId: "sync", after: { updated } } };
    },
  }),
};

/** Redemption counts and active flags, from Stripe onto the mirror. */
export async function syncCodesFromStripe(db: Firestore): Promise<number> {
  if (stripeMock() || !process.env.STRIPE_SECRET_KEY) return 0;
  const now = new Date().toISOString();
  let updated = 0;
  let startingAfter: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const list = await stripeRequest<{ data: Array<Record<string, unknown>>; has_more: boolean }>("GET", "promotion_codes", {
      limit: 100,
      starting_after: startingAfter,
    });
    const ours = list.data.filter((item) => (item.metadata as Record<string, string> | undefined)?.app === STUDIOCUE_METADATA.app);
    const writer = db.batch();
    for (const item of ours) {
      writer.set(
        db.doc(`saasDiscounts/${String(item.id)}`),
        {
          id: item.id,
          kind: "promotion_code",
          code: item.code,
          active: item.active === true,
          timesRedeemed: Number(item.times_redeemed ?? 0),
          maxRedemptions: typeof item.max_redemptions === "number" ? item.max_redemptions : null,
          expiresAt: fromUnix(item.expires_at),
          syncedAt: now,
        },
        { merge: true },
      );
      updated += 1;
    }
    if (ours.length) await writer.commit();
    if (!list.has_more || !list.data.length) break;
    startingAfter = String(list.data.at(-1)?.id);
  }
  return updated;
}
