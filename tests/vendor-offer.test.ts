import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as app from "../features/subscriptions/vendor-offer";
import * as server from "../functions/src/saas/vendor-offer";
import { VENDOR_TYPES } from "../features/vendors/schema";
import { normalizeReferralCode } from "../functions/src/saas/referral-program";
import { renderEmailTemplate, vendorOfferCopy } from "../functions/src/communications/email-templates";
import { classifyStudio } from "../features/console/sources";
import { SOURCE_CHANNELS as APP_CHANNELS } from "../features/console/sources";
import { SOURCE_CHANNELS as SERVER_CHANNELS } from "../functions/src/saas/attribution-schema";

/**
 * The vendor offer (docs/vendor-network-plan-2026-10-12.md, Phase 3; D1, D2):
 * a vendor who worked a StudioCue studio's wedding gets the vendor plan at
 * $50/month for a year or $500 for the first year, with a code of their own,
 * once by email and every time they open their schedule link.
 */

const read = (path: string) => readFileSync(path, "utf8");
const brand = { studioName: "GR Productions", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: null };

test("the app's copy of the offer and the server's agree", () => {
  assert.equal(app.VENDOR_OFFER_MONTHLY_CENTS, server.VENDOR_OFFER_MONTHLY_CENTS);
  assert.equal(app.VENDOR_OFFER_YEARLY_CENTS, server.VENDOR_OFFER_YEARLY_CENTS);
  assert.equal(app.VENDOR_OFFER_MONTHS, server.VENDOR_OFFER_MONTHS);
  assert.equal(app.VENDOR_OFFER_SUMMARY, server.VENDOR_OFFER_SUMMARY);
  assert.equal(app.VENDOR_OFFER_SUMMARY_THEIRS, server.VENDOR_OFFER_SUMMARY_THEIRS);
  for (const type of VENDOR_TYPES) {
    assert.equal(app.vendorOfferAudience(type), server.vendorOfferAudience(type), type);
    assert.equal(
      app.vendorOfferLink({ vendorType: type, code: "VOABCD2345", medium: "share" }),
      server.vendorOfferLink({ vendorType: type, code: "VOABCD2345", medium: "share" }),
    );
  }
  assert.deepEqual([...APP_CHANNELS], [...SERVER_CHANNELS]);
});

test("D1: a third off the vendor plan's first year", () => {
  assert.equal(server.VENDOR_OFFER_MONTHLY_CENTS, 5_000);
  assert.equal(server.VENDOR_OFFER_YEARLY_CENTS, 50_000);
  assert.equal(server.VENDOR_OFFER_MONTHS, 12);
});

test("who is offered what: vendor-plan trades the offer, a videographer the Studio referral, the rest nothing yet", () => {
  for (const type of ["dj", "hair_makeup", "planner"]) assert.equal(server.vendorOfferAudience(type), "vendor", type);
  assert.equal(server.vendorOfferAudience("videographer"), "studio");
  for (const type of ["florist", "caterer", "venue", "bakery", "officiant", "insurance_agent", "other", undefined])
    assert.equal(server.vendorOfferAudience(type), null, String(type));
});

test("a vendor's code is a referral code, random, with no look-alike letters", () => {
  const seen = new Set<string>();
  for (let index = 0; index < 200; index += 1) {
    const code = server.newVendorOfferCode();
    assert.match(code, /^VO[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
    assert.equal(normalizeReferralCode(code), code);
    seen.add(code);
  }
  assert.ok(seen.size > 190);
});

test("the offer link opens the vendor signup with the trade, the plan and the code", () => {
  const link = new URL(server.vendorOfferLink({ vendorType: "dj", code: "VOABCD2345", medium: "email" }), "https://studio-cue.com");
  assert.equal(link.pathname, "/auth/register");
  assert.equal(link.searchParams.get("trade"), "dj");
  assert.equal(link.searchParams.get("plan"), "vendor");
  assert.equal(link.searchParams.get("code"), "VOABCD2345");
  assert.equal(link.searchParams.get("utm_source"), "vendor_offer");
  // Hair and makeup could be either: "What do you do?" asks.
  assert.equal(new URL(server.vendorOfferLink({ vendorType: "hair_makeup", code: "VOABCD2345", medium: "share" }), "https://x.test").searchParams.get("trade"), null);
});

const offer = {
  audience: "vendor",
  code: "VOABCD2345",
  actionUrl: "https://studio-cue.com/auth/register?trade=dj&plan=vendor&code=VOABCD2345",
  unsubscribeUrl: "https://studio-cue.com/api/public/unsubscribe?e=abc&t=def",
  studioName: "GR Productions",
  trades: ["dj"],
  firstContact: true,
};

test("the timeline email carries the offer under the timeline, never instead of it", () => {
  const values = { shareUrl: "https://studio-cue.com/share/token", coupleName: "Maya Brooks", eventDate: "2027-06-12" };
  const plain = renderEmailTemplate({ key: "vendor_timeline", brand, recipientName: "Dee", projectName: "Maya Brooks Wedding", values } as Parameters<typeof renderEmailTemplate>[0]);
  assert.doesNotMatch(plain.text, /VOABCD2345|From StudioCue/);
  const offered = renderEmailTemplate({
    key: "vendor_timeline",
    brand,
    recipientName: "Dee",
    projectName: "Maya Brooks Wedding",
    values: { ...values, vendorOffer: offer },
  } as Parameters<typeof renderEmailTemplate>[0]);
  // The schedule is still the button.
  assert.match(offered.html, /View and confirm/);
  assert.match(offered.text, /VOABCD2345/);
  assert.match(offered.text, /\$50\/month for your first 12 months, or \$500 for your first year/);
  assert.match(offered.text, /StudioCue runs your DJ bookings, too/);
  assert.match(offered.text, /opt out of offers/);
  // A wedding reads as one; any other kind of job, as its own (job-kinds.ts vocab).
  assert.match(offered.text, /You'll still get this (wedding|event)'s timeline/);
  assert.equal(vendorOfferCopy(null, "GR"), null);
  assert.equal(vendorOfferCopy({ ...offer, actionUrl: "javascript:alert(1)" }, "GR"), null);
  // A videographer: the Studio plan's referral price.
  assert.match(vendorOfferCopy({ ...offer, audience: "studio", trades: ["photographer"] }, "GR")?.details[0]?.value ?? "", /\$75\/month billed yearly/);
});

test("a swept vendor-plan invite carries the offer and its code", () => {
  const values = { studioName: "GR Productions", inviteTrades: ["hair"], offerCode: "VOABCD2345", actionUrl: "https://studio-cue.com/auth/register?plan=vendor" };
  const rendered = renderEmailTemplate({ key: "platform_vendor_invite", brand, recipientName: "Jess", projectName: null, values } as Parameters<typeof renderEmailTemplate>[0]);
  assert.match(rendered.text, /\$50 a month for your first 12 months, or \$500 for your first year/);
  assert.match(rendered.text, /VOABCD2345/);
  const without = renderEmailTemplate({ key: "platform_vendor_invite", brand, recipientName: "Jess", projectName: null, values: { ...values, offerCode: null } } as Parameters<typeof renderEmailTemplate>[0]);
  assert.doesNotMatch(without.text, /\$50 a month/);
});

test("Sources files a vendor who signed up through the offer under its own channel, naming the studio", () => {
  const source = classifyStudio({
    tenantId: "vendor_t",
    attribution: null,
    referral: { tenantId: "vendor_t", referrerTenantId: "gr", referrerName: "GR Productions", via: "vendor_offer" },
  });
  assert.equal(source.channel, "vendor_offer");
  assert.equal(source.detail, "GR Productions");
  const studio = classifyStudio({ tenantId: "s2", attribution: null, referral: { tenantId: "s2", referrerTenantId: "gr", referrerName: "GR Productions", via: "code" } });
  assert.equal(studio.channel, "referral");
});

// ─── ensureVendorOffer against a small in-memory Firestore ──────────────────

type Doc = Record<string, unknown>;
function fakeDb(seed: Record<string, Doc>) {
  const docs = new Map<string, Doc>(Object.entries(seed));
  const snapshot = (path: string) => {
    const data = docs.get(path);
    return { id: path.split("/").pop()!, exists: data !== undefined, data: () => data, get: (field: string) => data?.[field], ref: { path } };
  };
  const reference = (path: string) => ({ path, get: async () => snapshot(path) });
  const query = (collection: string, filters: Array<[string, unknown]> = []) => ({
    where: (field: string, _op: string, value: unknown) => query(collection, [...filters, [field, value]]),
    limit: () => query(collection, filters),
    get: async () => {
      const matches = [...docs.entries()]
        .filter(([path]) => path.startsWith(`${collection}/`) && path.split("/").length === 2)
        .filter(([, data]) => filters.every(([field, value]) => data[field] === value))
        .map(([path]) => snapshot(path));
      return { empty: matches.length === 0, docs: matches, size: matches.length };
    },
  });
  const db = {
    docs,
    doc: reference,
    collection: (name: string) => query(name),
    runTransaction: async <T>(work: (transaction: unknown) => Promise<T>) => {
      const writes: Array<() => void> = [];
      const transaction = {
        get: async (ref: { path: string }) => snapshot(ref.path),
        create: (ref: { path: string }, data: Doc) => {
          if (docs.has(ref.path)) throw Object.assign(new Error("ALREADY_EXISTS"), { code: 6 });
          writes.push(() => docs.set(ref.path, data));
        },
        update: (ref: { path: string }, data: Doc) => writes.push(() => docs.set(ref.path, { ...docs.get(ref.path), ...data })),
      };
      const result = await work(transaction);
      for (const write of writes) write();
      return result;
    },
  };
  return db;
}

const studio = {
  "tenants/gr": { brandName: "GR Productions" },
  "subscriptions/gr": { status: "active" },
};
const input = (overrides: Partial<server.VendorOfferInput> = {}): server.VendorOfferInput => ({
  tenantId: "gr",
  projectId: "p1",
  vendorId: "v1",
  vendorType: "dj",
  email: "Dee@SoundsGood.com",
  source: "vendor_timeline",
  emailJobId: "job1",
  now: "2026-10-13T12:00:00.000Z",
  subscriber: async () => false,
  ...overrides,
});

test("the first timeline makes the vendor's record and code; later ones reuse them and pitch nothing", async () => {
  const db = fakeDb({ ...studio });
  const first = await server.ensureVendorOffer(db as never, input());
  assert.ok(first);
  assert.equal(first.audience, "vendor");
  assert.equal(first.firstContact, true);
  assert.match(first.actionUrl, /plan=vendor/);
  const codeRecord = db.docs.get(`saasReferralCodes/${first.code}`);
  assert.equal(codeRecord?.kind, "vendor_offer");
  assert.equal(codeRecord?.tenantId, "gr");
  const hashes = [...db.docs.keys()].filter((path) => path.startsWith("vendorInvites/"));
  assert.equal(hashes.length, 1);
  assert.equal(db.docs.get(hashes[0]!)?.offerCode, first.code);

  // A retry of the same send is still the first contact.
  const retry = await server.ensureVendorOffer(db as never, input());
  assert.equal(retry?.firstContact, true);
  assert.equal(retry?.code, first.code);
  // The next version's email: same code, no second pitch.
  const later = await server.ensureVendorOffer(db as never, input({ emailJobId: "job2" }));
  assert.equal(later?.firstContact, false);
  assert.equal(later?.code, first.code);
  assert.equal([...db.docs.keys()].filter((path) => path.startsWith("saasReferralCodes/")).length, 1);
});

test("no offer to a subscriber, an opt-out, a test address, a florist, or a studio that turned invites off or isn't paying", async () => {
  assert.equal(await server.ensureVendorOffer(fakeDb({ ...studio }) as never, input({ subscriber: async () => true })), null);
  assert.equal(await server.ensureVendorOffer(fakeDb({ ...studio }) as never, input({ vendorType: "florist" })), null);
  assert.equal(await server.ensureVendorOffer(fakeDb({ ...studio }) as never, input({ email: "dj@example.com" })), null);
  assert.equal(await server.ensureVendorOffer(fakeDb({ ...studio, "tenants/gr": { brandName: "GR", vendorInvitesEnabled: false } }) as never, input()), null);
  assert.equal(await server.ensureVendorOffer(fakeDb({ ...studio, "subscriptions/gr": { status: "cancelled" } }) as never, input()), null);
  const { emailHash } = await import("../functions/src/communications/email-hash");
  assert.equal(
    await server.ensureVendorOffer(fakeDb({ ...studio, [`emailSuppressions/${emailHash("dee@soundsgood.com")}`]: { reason: "unsubscribe" } }) as never, input()),
    null,
  );
  // The studio's own client under a vendor record.
  assert.equal(
    await server.ensureVendorOffer(fakeDb({ ...studio, "contacts/c1": { tenantId: "gr", email: "dee@soundsgood.com" } }) as never, input()),
    null,
  );
});

test("a vendor invited before the offer existed gets it on their record, without a second pitch", async () => {
  const { emailHash } = await import("../functions/src/communications/email-hash");
  const hash = emailHash("dee@soundsgood.com");
  const db = fakeDb({ ...studio, [`vendorInvites/${hash}`]: { id: hash, tenantId: "gr", unsubscribeToken: "tok_existing_0001", emailJobId: "vendor_invite_x" } });
  const offered = await server.ensureVendorOffer(db as never, input());
  assert.equal(offered?.firstContact, false);
  assert.equal(db.docs.get(`vendorInvites/${hash}`)?.offerCode, offered?.code);
  assert.match(offered?.unsubscribeUrl ?? "", /t=tok_existing_0001/);
});

test("wired: checkout, the sender, the sweep, the share page and the Subscription page", () => {
  const stripe = read("functions/src/saas/stripe.ts");
  assert.match(stripe, /firstCheckout && parsed\.plan === "vendor"\s*\? await vendorOfferBy/);
  assert.match(stripe, /discounts\[0\]\[coupon\]", await vendorOfferCoupon\(db, parsed\.cadence\)/);
  assert.match(stripe, /referralVia\]", vendorOffer\.via/);
  // One studio claims a code; it doesn't go round.
  assert.match(stripe, /offerClaimedTenantId/);
  const offerSource = read("functions/src/saas/vendor-offer.ts");
  assert.match(offerSource, /duration: "repeating"/);
  assert.doesNotMatch(offerSource, /duration: "once"/);
  assert.match(read("functions/src/operations/jobs.ts"), /vendorTimelineOffer\(getFirestore\(\), document/);
  assert.match(read("functions/src/saas/vendor-invites.ts"), /vendorOfferAudience\(invite\.vendorType\) === "vendor" \? newVendorOfferCode\(\)/);
  assert.match(read("app/share/[token]/page.tsx"), /shareOfferFor\(adminFirestore/);
  assert.match(read("components/saas/live-subscription.tsx"), /referredBy\.plan === "vendor"/);
});

test("review fixes: a vendor code is never a Studio referral; an abandoned checkout doesn't lock it; signed up waits for the subscription", () => {
  const stripe = read("functions/src/saas/stripe.ts");
  assert.match(stripe, /if \(referral\.kind === "vendor_offer"\) return null;/);
  assert.match(stripe, /if \(holderLive \|\| invite\.get\("signedUpTenantId"\)\) return false;/);
  assert.match(stripe, /referralVia === "vendor_offer" && !deleted[\s\S]{0,120}markVendorOfferSignedUp/);
  assert.match(stripe, /takenElsewhere/);
  assert.match(read("server/vendors/vendor-offer.ts"), /invite\.get\("signedUpTenantId"\)/);
  assert.match(read("functions/src/planning/final-details.ts"), /vendorAskOwedFor\(db, tenantId, project\.id\)/);
});

test("a vendor's offer code on a trade with no vendor plan promises nothing on the subscription page", () => {
  // Checkout refuses it on the Studio plan (referredBy); the page used to say
  // "Because you worked an event with …, you get $50/month" anyway.
  const page = readFileSync("components/saas/live-subscription.tsx", "utf8");
  assert.match(page, /result\.plan === "vendor" && !vendorPlanOffered\) setCodeNotForPlan\(true\)/);
  assert.match(page, /codeNotForPlan\s*\n?\s*\? ` The code \$\{promotionCode\} is a vendor's offer/);
});

test("a form request names the form it asks for", () => {
  // UAT 2026-10-13 F1: two forms both read "Details needed by FlawlessIQ".
  const ask = (values: Record<string, unknown>) =>
    renderEmailTemplate({ key: "questionnaire_request", brand, recipientName: "Stacey", projectName: "Stacey Spags Wedding", values } as Parameters<typeof renderEmailTemplate>[0]);
  const named = ask({ formName: "Final schedule", actionUrl: "https://studio-cue.com/client" });
  assert.equal(named.subject, `Your final schedule for ${brand.studioName}`);
  assert.match(named.text, /your final schedule/);
  assert.match(ask({ actionUrl: "https://studio-cue.com/client" }).subject, /^Details needed by /);
});

test("the signup page names a live vendor offer, and only a live one", async () => {
  // UAT 2026-10-13: emailed "$50/month for your first 12 months", the link landed on "$75 a month".
  const { signupOfferFor } = await import("../server/vendors/vendor-offer");
  const docs: Record<string, Record<string, unknown> | undefined> = {
    "saasReferralCodes/VOKATV9Y4F": { kind: "vendor_offer", offerFor: "h1", tenantId: "t1" },
    "saasReferralCodes/VOTAKEN234": { kind: "vendor_offer", offerFor: "h2", tenantId: "t1" },
    "saasReferralCodes/VONOTVO234": { kind: "studio" },
    "vendorInvites/h1": {},
    "vendorInvites/h2": { signedUpTenantId: "t9" },
    "tenants/t1": { brandName: "FlawlessIQ" },
  };
  const db = {
    doc: (path: string) => ({
      get: async () => ({ exists: Boolean(docs[path]), get: (field: string) => docs[path]?.[field] }),
    }),
  } as unknown as Parameters<typeof signupOfferFor>[0];
  const live = await signupOfferFor(db, "vokatv9y4f");
  assert.equal(live?.studioName, "FlawlessIQ");
  assert.match(live?.summary ?? "", /\$50\/month for your first 12 months/);
  assert.equal(await signupOfferFor(db, "VOTAKEN234"), null);
  assert.equal(await signupOfferFor(db, "VONOTVO234"), null);
  assert.equal(await signupOfferFor(db, "FLAWLESSIQ"), null);
  assert.match(readFileSync("app/auth/register/page.tsx", "utf8"), /vendorWord && offer\s*\n?\s*\? `Verify your work email/);
});

test("Sources counts vendor-offer signups among studios from vendor invites", () => {
  const page = readFileSync("components/console/pages/sources-page.tsx", "utf8");
  assert.match(page, /row\.source\.channel === "vendor_offer" \|\|/);
  assert.match(page, /Vendor offer \(vendor plan\)/);
});
