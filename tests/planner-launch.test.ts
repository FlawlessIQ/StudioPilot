import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { vendorPlanCards } from "@/config/saas-plans";
import {
  tradeSchema,
  TradeLanding,
  VENDOR_TRADE_PAGES,
  vendorPageLinkText,
  vendorSignupHref,
} from "@/components/marketing/trade-landing";
import { explainer, explainersFor, EXPLAINERS } from "@/features/help/explainers";
import { helpForRoute } from "@/features/help/routes";
import { LIVE_TRADES, TRADE_LABELS, TRADES, VENDOR_TYPE_TRADES, vendorTypeLiveTrades } from "@/features/trades/trades";
import { renderEmailTemplate, vendorInvitePitch } from "../functions/src/communications/email-templates";
import { LAUNCHED_TRADES, launchedTradesFrom, launchedVendorTypes, sweepCandidates, sweepCounts, type SweepJob, type SweepVendor } from "../functions/src/saas/vendor-invite-sweep";
import { vendorInviteLink } from "../functions/src/saas/vendor-invites";
import { tradeInstruction } from "../functions/src/trades/trade-instruction";
import * as serverTrades from "../functions/src/trades/trades";

/**
 * The wedding planner's launch (docs/planner-journey-plan.md, Phase 5, N10),
 * as the DJ, makeup and hair launch was (tests/vendor-launch.test.ts): a
 * public page claiming only what the planner's journey has shipped, a live
 * signup, planners on photographers' jobs invited in their own words, the
 * launch sweep covering them, help for their own flows, and the Console's
 * trade filter. Photographers, DJs, makeup and hair are unchanged
 * (tests/vendor-burden.test.ts and tests/fixtures/journey-before-planner.json).
 */

const read = (file: string) => readFileSync(file, "utf8");
const [vendorPlan] = vendorPlanCards;
const html = () => renderToStaticMarkup(TradeLanding({ trade: "planner" }));
/** The page's own content: the shared nav and footer speak to every studio. */
const main = () => {
  const page = html();
  return page.slice(page.indexOf("<main>"), page.indexOf("</main>"));
};

test("the planner is live, offered at signup and invited, in both copies", () => {
  assert.ok(LIVE_TRADES.includes("planner"));
  assert.deepEqual([...serverTrades.LIVE_TRADES], [...LIVE_TRADES]);
  assert.deepEqual([...VENDOR_TYPE_TRADES.planner!], ["planner"]);
  assert.deepEqual([...serverTrades.VENDOR_TYPE_TRADES.planner!], ["planner"]);
  assert.deepEqual([...vendorTypeLiveTrades("planner")], ["planner"]);
  // Still not invited: the trades with no StudioCue journey.
  for (const type of ["florist", "caterer", "band", "venue", "photographer", "officiant"])
    assert.deepEqual([...vendorTypeLiveTrades(type)], [], type);
});

test("/planner sells the planner journey, signs up on its trade, and invents nothing", () => {
  const page = read("app/planner/page.tsx");
  assert.match(page, /path: "\/planner"/);
  assert.match(page, /og: "planner"/);
  assert.match(page, /<TradeLanding trade="planner" \/>/);
  assert.match(read("app/planner/layout.tsx"), /import "@\/app\/app-styles";/);
  assert.equal(VENDOR_TRADE_PAGES.planner, "/planner");
  assert.equal(vendorPageLinkText("planner"), "StudioCue for wedding planners");
  assert.equal(vendorPageLinkText("dj"), "StudioCue for DJs");

  const signups = [...html().matchAll(/href="(\/auth\/register[^"]*)"/g)].map((match) => match[1]!.replace(/&amp;/g, "&"));
  assert.ok(signups.length >= 2, "the hero and the plan card both sign up");
  for (const href of signups) assert.equal(href, "/auth/register?trade=planner&plan=vendor");
  assert.equal(vendorSignupHref("planner"), "/auth/register?trade=planner&plan=vendor");
  assert.equal(vendorPlan.monthly, "$75");
  assert.match(html(), /\$75/);
  assert.match(html(), /\$750\/year/);
  assert.match(html(), /14-day trial/);
  // No testimonials, customer counts or logos until there are real ones.
  assert.doesNotMatch(main(), /<blockquote|\b\d[\d,]* (studios|planners|vendors|weddings|couples)\b|trusted by|loved by/i);
  assert.doesNotMatch(main(), /\b(photos?|photograph\w*|galler(?:y|ies)|shoots?|albums?)\b/i, "a planner's page reads in their trade");
  const schema = tradeSchema("planner");
  assert.equal(schema.name, "StudioCue for Wedding planners");
  assert.equal(schema.offers.price, "75.00");
  assert.ok(schema.url.endsWith("/planner"), schema.url);
  assert.match(html(), /application\/ld\+json/);
});

test("the page claims what the planner has shipped, and nothing still to come", () => {
  const own = main().split("mk-trade-price")[0]!;
  for (const claim of [
    /discovery call/i,
    /Full and partial planning/,
    /month-of/i,
    /Final details form eight weeks out/,
    /vendor team/i,
    /arrive, load in and strike/,
    /tip/,
    /One press sends every vendor a link to their own part/,
    /7 of 9 confirmed/,
    /older version/,
    /venue walkthrough/i,
    /payments and tips to hand out, in the order vendors arrive/,
    /contact sheet/i,
    /emergency kit/i,
    /name and website, yours first/,
    /30 days before/,
  ])
    assert.match(own, claim);
  // Phase 3 (the planning checklist) and Phase 4 (payment plans) are not on
  // this branch: the page says nothing about them until they ship.
  assert.doesNotMatch(own, /checklist|installment|payment plan|guest list|seating|floor plan/i);
  // Every vendor page links to the others, the planner's included.
  for (const trade of ["dj", "makeup", "hair"] as const) {
    const page = renderToStaticMarkup(TradeLanding({ trade }));
    assert.match(page, /href="\/planner"/, trade);
  }
});

test("the site links to /planner: footer, homepage band, pricing, sitemap, llms.txt, social card", () => {
  assert.match(read("components/marketing/marketing-layout.tsx"), /<Link href="\/planner">For wedding planners<\/Link>/);
  const home = read("app/page.tsx");
  assert.match(home, /href: VENDOR_TRADE_PAGES\.planner/);
  assert.match(home, /DJs, makeup artists, hair stylists and planners run on StudioCue too\./);
  assert.match(home, /className="mk-other-grid mk-vendor-grid"/);
  // Four cards size by their container, never the viewport (CLAUDE.md, UI layout).
  assert.match(read("app/marketing.css"), /\.mk-other-grid\.mk-vendor-grid \{\n  grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 230px\), 1fr\)\);/);
  const pricing = read("app/pricing/page.tsx");
  assert.match(pricing, /For DJs, makeup artists, hair stylists and planners/);
  assert.match(pricing, /hair stylists and planners, with unlimited/);
  assert.match(pricing, /<VendorTradeLinks \/>/);
  assert.match(read("app/sitemap.ts"), /path: "\/planner"/);
  assert.match(read("public/llms.txt"), /\[For wedding planners\]\(https:\/\/studio-cue\.com\/planner\)/);
  assert.match(read("scripts/marketing/og-images.ts"), /planner: \{ at: \d+, kicker: "For wedding planners"/);
  assert.match(read("scripts/audit/sweep.mjs"), /"\/planner",/);
});

test("signup names a planning business at the vendor price", () => {
  const register = read("app/auth/register/page.tsx");
  // A live trade other than photography gets its own line; the planner's label is "Planning".
  assert.match(register, /trade && trade !== "photographer" && LIVE_TRADES\.includes\(trade as Trade\)/);
  assert.match(register, /TRADE_LABELS\[vendorTrade\]\.toLowerCase\(\)/);
  assert.match(register, /set up your \$\{vendorWord\} business\. \$\{vendorPlanCards\[0\]!\.monthly\} a month after the 14-day trial\./);
  assert.equal(TRADE_LABELS.planner.toLowerCase(), "planning");
});

test("a planner on a photographer's job is invited in a planner's words, at the vendor price", () => {
  const link = new URL(vendorInviteLink("planner", "GRPRODUCTIONS"), "https://studio-cue.com");
  assert.equal(link.pathname, "/auth/register");
  assert.equal(link.searchParams.get("trade"), "planner");
  assert.equal(link.searchParams.get("plan"), "vendor");
  assert.equal(link.searchParams.get("code"), null, "the vendor plan has no referral offer");
  const pitch = vendorInvitePitch(["planner"]);
  assert.equal(pitch?.headline, "StudioCue runs your planning business");
  const text = renderEmailTemplate({
    key: "platform_vendor_invite",
    brand: { studioName: "StudioCue", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: null },
    recipientName: "Rosa Lane",
    projectName: null,
    values: {
      studioName: "GR Productions",
      code: "GRPRODUCTIONS",
      inviteTrades: ["planner"],
      actionUrl: "https://studio-cue.com/auth/register?trade=planner&plan=vendor",
      unsubscribeUrl: "https://studio-cue.com/api/public/unsubscribe?e=x&t=y",
    },
  }).text;
  assert.match(text, /StudioCue runs your planning business: discovery calls/);
  assert.match(text, /full planning, partial planning or month-of coordination/);
  assert.match(text, /the vendor team on every job, with arrival times, balances and tips/);
  assert.match(text, /sends every vendor their own timeline and tracks who has confirmed/);
  assert.match(text, /\$75 a month, or \$750 a year/);
  assert.doesNotMatch(text, /half|\$150|Your code|GRPRODUCTIONS/);
  assert.doesNotMatch(text, /photo|galler/i);
  // The other trades read as they did.
  assert.equal(vendorInvitePitch(["dj"])?.headline, "StudioCue runs your DJ bookings");
  assert.equal(vendorInvitePitch(["makeup", "hair"])?.headline, "StudioCue runs hair and makeup bookings");
});

const job = (id: string, overrides: Partial<SweepJob> = {}): SweepJob => ({
  id,
  tenantId: "t1",
  state: "BOOKED",
  eventDate: "2027-06-12",
  archived: false,
  quiet: false,
  ...overrides,
});
const vendor = (id: string, overrides: Partial<SweepVendor> = {}): SweepVendor => ({
  id,
  tenantId: "t1",
  type: "planner",
  email: `${id}@plans.studio`,
  archived: false,
  projectIds: ["p1"],
  ...overrides,
});

test("the launch sweep covers planners, and --trade planner sweeps only them", () => {
  assert.deepEqual([...LAUNCHED_TRADES], ["dj", "makeup", "hair", "planner"]);
  assert.deepEqual(launchedTradesFrom([]), ["dj", "makeup", "hair", "planner"]);
  assert.deepEqual(launchedTradesFrom(["planner"]), ["planner"]);
  assert.deepEqual(launchedTradesFrom([" Planner ", "dj"]), ["dj", "planner"]);
  assert.throws(() => launchedTradesFrom(["photographer"]), /Not a launched trade: photographer/);
  assert.throws(() => launchedTradesFrom(["planer"]), /Not a launched trade: planer/);
  assert.deepEqual(launchedVendorTypes(["planner"]), ["planner"]);

  const jobs = new Map([job("p1"), job("past", { eventDate: "2026-01-01" }), job("lead", { state: "LEAD" })].map((entry) => [entry.id, entry]));
  const vendors = [
    vendor("rosa"),
    vendor("old", { projectIds: ["past"] }),
    vendor("inquiry", { projectIds: ["lead"] }),
    vendor("spin", { type: "dj" }),
    vendor("bloom", { type: "florist" }),
  ];
  const all = sweepCandidates(vendors, jobs, "2026-10-13");
  assert.deepEqual(all.map((candidate) => candidate.vendorId), ["rosa", "spin"]);
  const planners = sweepCandidates(vendors, jobs, "2026-10-13", launchedTradesFrom(["planner"]));
  assert.deepEqual(planners.map((candidate) => [candidate.vendorId, candidate.projectId]), [["rosa", "p1"]]);
  assert.deepEqual(sweepCounts(planners).byTrade, { Planning: 1 });

  const script = read("scripts/sweep-vendor-invites.mts");
  assert.match(script, /npx tsx scripts\/sweep-vendor-invites\.mts --trade planner/);
  // Still a dry run unless --send, and production only by name.
  assert.match(script, /const send = args\.includes\("--send"\);/);
  assert.match(script, /if \(!emulator && !prod\) \{/);
});

test("a planner's own flows have How-to guides, which no other trade sees", () => {
  const ids = ["vendor-team", "vendor-timeline", "planning-tiers", "venue-walkthrough"];
  assert.equal(explainer("vendor-team", "planner")?.title, "Build the vendor team");
  assert.equal(explainer("vendor-timeline", "planner")?.title, "Send every vendor their timeline");
  assert.equal(explainer("planning-tiers", "planner")?.title, "Full, partial and month-of");
  assert.equal(explainer("venue-walkthrough", "planner")?.title, "Book the venue walkthrough");
  for (const id of ids) {
    for (const trade of ["photographer", "dj", "makeup", "hair"]) assert.equal(explainer(id, trade), undefined, `${id} for ${trade}`);
    assert.ok(!EXPLAINERS.some((guide) => guide.id === id), `${id} stays off the public /how-to`);
  }
  const related = (trade: string, route: string) => helpForRoute(route, "studio", trade).related.map((guide) => guide.id);
  for (const id of ["vendor-team", "vendor-timeline", "venue-walkthrough"]) assert.ok(related("planner", "/studio/projects/abc").includes(id), id);
  assert.ok(related("planner", "/studio/packages").includes("planning-tiers"));
  assert.ok(!related("photographer", "/studio/projects/abc").includes("vendor-team"));
  // The planner gets the DJ-, beauty- and photographer-only guides no more than they get its.
  assert.equal(explainer("music-planner", "planner"), undefined);
  assert.equal(explainer("party-list", "planner"), undefined);
});

/** The help-content checks for guides the photographer's EXPLAINERS never includes. */
function walk(dir: string, match: (file: string) => boolean, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, match, out);
    else if (match(full)) out.push(full);
  }
  return out;
}
const normalise = (text: string) =>
  text
    .replace(/&amp;/g, "&")
    .replace(/&apos;|&rsquo;|&#39;|’/g, "'")
    .replace(/&ldquo;|&rdquo;|“|”/g, '"')
    .replace(/&hellip;|…/g, "…");

test("the planner's guides name real buttons, and are guides, not essays", () => {
  const source = normalise(
    [...walk("components", (file) => /\.tsx?$/.test(file)), ...walk("app", (file) => /\.tsx?$/.test(file))]
      .map((file) => readFileSync(file, "utf8"))
      .join("\n"),
  );
  const own = explainersFor("planner").filter((guide) => ["vendor-team", "vendor-timeline", "planning-tiers", "venue-walkthrough"].includes(guide.id));
  assert.equal(own.length, 4);
  for (const guide of own) {
    const text = [guide.purpose, ...guide.steps, guide.next ?? "", ...(guide.goodToKnow ?? [])];
    for (const line of text)
      for (const [, label] of line.matchAll(/\*\*([^*]+)\*\*/g)) assert.ok(source.includes(normalise(label!)), `${guide.id}: **${label}**`);
    const words = text.join(" ").replace(/\*\*/g, "").split(/\s+/).length;
    assert.ok(words >= 80 && words <= 260, `${guide.id}: ${words} words`);
    assert.ok(guide.steps.length >= 3 && guide.steps.length <= 7, `${guide.id}: ${guide.steps.length} steps`);
    assert.ok((guide.goodToKnow ?? []).length <= 3);
    assert.doesNotMatch(text.join(" "), /\b(photos?|photograph\w*|galler(?:y|ies)|shoots?)\b/i, guide.id);
  }
});

test("Cue has a planner's how-to facts; the other trades' prompts are as they were", () => {
  const planner = tradeInstruction("planner");
  assert.match(planner, /full planning, partial planning or month-of coordination/);
  assert.match(planner, /"Add vendor arrivals"/);
  assert.match(planner, /one press on the vendor team sends every booked vendor their part/);
  assert.match(planner, /walkthrough card invites the couple to book the venue walkthrough/);
  assert.match(planner, /"Send vendor credits"/);
  assert.equal(tradeInstruction("photographer"), "");
  for (const trade of ["dj", "makeup", "hair"]) assert.doesNotMatch(tradeInstruction(trade), /vendor team|walkthrough/i, trade);
});

test("the Console's Studios filter and trade column include planners", () => {
  assert.ok(TRADES.includes("planner"));
  const page = read("components/console/pages/studios-page.tsx");
  assert.match(page, /<ChipSelect label="Trade" onChange=\{setTrade\} options=\{TRADES\.map\(\(value\) => \(\{ value, label: TRADE_LABELS\[value\] \}\)\)\}/);
  assert.match(page, /accessorFn: \(studio\) => TRADE_LABELS\[tradeOf\(studio\.trade\)\]/);
  assert.match(read("functions/src/console/summary.ts"), /trade: tradeOf\(tenant\.trade\)/);
  assert.equal(serverTrades.tradeOf({ trade: "planner" }), "planner");
  assert.equal(TRADE_LABELS.planner, "Planning");
});
