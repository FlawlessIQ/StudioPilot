import assert from "node:assert/strict";
import { test } from "node:test";
import { HEARD_OPTIONS, touchFrom } from "../features/growth/attribution";
import { SOURCE_CHANNELS, channelOfTouch, classifyStudio, funnelBy, funnelStage, rate } from "../features/console/sources";
import type { ConsoleStudio } from "../features/console/model";
import { HEARD_VALUES, SOURCE_CHANNELS as FUNCTION_CHANNELS, attributionSchema } from "../functions/src/saas/attribution-schema";

const AT = "2026-10-07T12:00:00.000Z";

test("a link records campaign tags, an outside referrer and a code, and nothing else counts", () => {
  const touch = touchFrom("https://studio-cue.com/pricing?utm_source=Instagram&utm_medium=social&utm_campaign=Fall&code=gersh50", "https://l.instagram.com/", AT);
  assert.deepEqual(touch, { source: "instagram", medium: "social", campaign: "fall", content: null, referrer: "l.instagram.com", landing: "/pricing", code: "GERSH50", at: AT });
  assert.equal(touchFrom("https://studio-cue.com/", "https://studio-cue.com/about", AT), null, "our own pages are not a source");
  assert.equal(touchFrom("https://studio-cue.com/", "", AT), null);
  assert.equal(touchFrom("https://studio-cue.com/", "https://www.google.com/", AT)?.referrer, "google.com");
});

test("a link alone says which channel", () => {
  const base = { source: null, medium: null, campaign: null, content: null, referrer: null, landing: "/", code: null, at: AT };
  assert.equal(channelOfTouch({ ...base, referrer: "l.instagram.com" })?.channel, "instagram");
  assert.equal(channelOfTouch({ ...base, source: "fb" })?.channel, "facebook");
  assert.equal(channelOfTouch({ ...base, source: "google", medium: "cpc" })?.channel, "ads");
  assert.equal(channelOfTouch({ ...base, referrer: "google.com" })?.channel, "search");
  assert.equal(channelOfTouch({ ...base, medium: "email", campaign: "launch" })?.detail, "launch");
  assert.deepEqual(channelOfTouch({ ...base, referrer: "theknot.com" }), { channel: "website", detail: "theknot.com" });
  assert.equal(channelOfTouch({ ...base, code: "BETA" }), null);
});

test("one channel per studio: by hand, then a partner, then what they said, then the link", () => {
  const partners = [{ id: "p1", name: "Albert", kind: "dj", code: "GERSH50" }];
  const first = { source: "instagram", medium: null, campaign: null, content: null, referrer: null, landing: "/", code: null, at: AT };
  const told = { id: "t", heard: "photographer" as const, heardDetail: "Gabe", first, last: first, promotionCode: null };
  assert.equal(classifyStudio({ tenantId: "t", attribution: told, referral: null, partners }).channel, "photographer");
  const linkOnly = classifyStudio({ tenantId: "t", attribution: { ...told, heard: null }, referral: null, partners });
  assert.equal(linkOnly.channel, "instagram");
  assert.equal(linkOnly.basis, "link");
  const coded = classifyStudio({ tenantId: "t", attribution: { ...told, promotionCode: "GERSH50" }, referral: null, partners });
  assert.deepEqual([coded.channel, coded.detail, coded.partnerKind], ["partner", "Albert", "dj"]);
  assert.equal(classifyStudio({ tenantId: "t", attribution: null, referral: { tenantId: "t", partnerId: "p1" }, partners }).channel, "partner");
  const filed = classifyStudio({ tenantId: "t", attribution: { ...told, promotionCode: "GERSH50", manual: { channel: "event", detail: "WPPI" } }, referral: null, partners });
  assert.deepEqual([filed.channel, filed.basis, filed.linkChannel], ["event", "manual", "instagram"]);
  assert.equal(classifyStudio({ tenantId: "t", attribution: { id: "t" }, referral: null, partners }).channel, "direct");
  assert.equal(classifyStudio({ tenantId: "t", attribution: null, referral: null, partners }).channel, "unknown");
});

test("the funnel leaves comped studios out and counts card and paying", () => {
  const studio = (status: string | null, comped = false, mrrCents = 0) => ({ studio: { subscriptionStatus: status, comped, mrrCents } as ConsoleStudio, key: "x" });
  const rows = funnelBy([studio("incomplete"), studio("trialing"), studio("active", false, 12_500), studio("active", true, 0), studio("cancelled")], () => ({ key: "a", label: "A" }));
  assert.deepEqual(rows, [{ key: "a", label: "A", studios: 4, carded: 3, paying: 1, mrrCents: 12_500 }]);
  assert.equal(funnelStage({ subscriptionStatus: "past_due", comped: false }), "paying");
  assert.equal(rate(1, 4), "25%");
  assert.equal(rate(0, 0), "—");
});

test("the app and functions agree on channels and answers, and the server accepts what the browser sends", () => {
  assert.deepEqual([...SOURCE_CHANNELS], [...FUNCTION_CHANNELS]);
  assert.deepEqual(HEARD_OPTIONS.map((option) => option.value), [...HEARD_VALUES]);
  const touch = touchFrom("https://studio-cue.com/?utm_source=tiktok&ref=chuck50", "", AT);
  const parsed = attributionSchema.safeParse({ heard: "vendor", heardDetail: "Chuck", first: touch, last: touch, promotionCode: "CHUCK50" });
  assert.equal(parsed.success, true);
  assert.equal(attributionSchema.safeParse({ heard: "carrier pigeon", heardDetail: null, first: null, last: null, promotionCode: null }).success, false);
});
