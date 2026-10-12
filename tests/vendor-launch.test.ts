import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { vendorPlanCards } from "@/config/saas-plans";
import { tradeSchema, TradeLanding, VENDOR_TRADE_PAGES, vendorSignupHref } from "@/components/marketing/trade-landing";
import { explainer, explainersFor, EXPLAINERS } from "@/features/help/explainers";
import { helpForRoute } from "@/features/help/routes";
import { LIVE_TRADES, TRADES } from "@/features/trades/trades";
import { tradeInstruction } from "../functions/src/trades/trade-instruction";

/**
 * Vendor journeys, Phase 6: DJ, makeup and hair go live
 * (docs/vendor-journeys-plan.md). Each trade has a public page that signs up
 * on its trade at the vendor plan's real price, the site links to them, the
 * help covers each trade's own flows, Cue can answer how-tos about them, and
 * the Console can watch each trade's studios.
 */

const read = (path: string) => readFileSync(path, "utf8");
const VENDORS = ["dj", "makeup", "hair"] as const;
const [vendorPlan] = vendorPlanCards;
/** The page's own content: the site's shared nav and footer speak to every studio. */
const pageHtml = (trade: (typeof VENDORS)[number]) => {
  const html = renderToStaticMarkup(TradeLanding({ trade }));
  return html.slice(html.indexOf("<main>"), html.indexOf("</main>"));
};

test("every trade is live", () => {
  assert.deepEqual([...LIVE_TRADES], [...TRADES]);
  assert.equal(vendorPlan.monthly, "$75");
  assert.equal(vendorPlan.yearly, "$750");
});

for (const trade of VENDORS) {
  test(`/${trade} sells the ${trade} journey, signs up on its trade, and invents nothing`, () => {
    const page = read(`app/${trade}/page.tsx`);
    assert.match(page, new RegExp(`path: "/${trade}"`));
    assert.match(page, new RegExp(`og: "${trade}"`));
    assert.match(page, new RegExp(`<TradeLanding trade="${trade}" />`));
    assert.match(read(`app/${trade}/layout.tsx`), /import "@\/app\/app-styles";/);
    assert.equal(VENDOR_TRADE_PAGES[trade], `/${trade}`);

    const html = renderToStaticMarkup(TradeLanding({ trade }));
    const main = pageHtml(trade);
    const signups = [...html.matchAll(/href="(\/auth\/register[^"]*)"/g)].map((match) => match[1]!.replace(/&amp;/g, "&"));
    assert.ok(signups.length >= 2, "the hero and the plan card both sign up");
    for (const href of signups) assert.equal(href, vendorSignupHref(trade), href);
    assert.equal(vendorSignupHref(trade), `/auth/register?trade=${trade}&plan=vendor`);
    // The vendor plan's real price, and the trial as it is.
    assert.match(html, /\$75/);
    assert.match(html, /\$750\/year/);
    assert.match(html, /14-day trial/);
    // No testimonials, customer counts or logos until there are real ones.
    assert.doesNotMatch(main, /&ldquo;|“|<blockquote|\b\d[\d,]* (studios|DJs|artists|stylists|vendors|weddings)\b|trusted by|loved by/i);
    assert.doesNotMatch(main, /\b(photos?|photograph\w*|galler(?:y|ies)|shoots?|albums?)\b/i, "a vendor's page reads in their trade");
    // Structured data for the trade, at the plan's price.
    const schema = tradeSchema(trade);
    assert.equal(schema.offers.price, "75.00");
    assert.ok(schema.url.endsWith(`/${trade}`), schema.url);
    assert.match(html, /application\/ld\+json/);
  });
}

test("each page claims only what its trade has", () => {
  const html = pageHtml;
  assert.match(html("dj"), /Music &amp; moments planner/);
  assert.match(html("dj"), /MC script/);
  assert.match(html("dj"), /vibe call/i);
  assert.doesNotMatch(html("dj"), /(makeup|hair|the) trial|party list|extensions/i);
  for (const trade of ["makeup", "hair"] as const) {
    assert.match(html(trade), /party list/i);
    assert.match(html(trade), /trial/i);
    assert.match(html(trade), /per person/);
    // The page's own copy; the shared plan card lists "Proposals" for every vendor trade.
    const own = html(trade).split("mk-trade-price")[0]!;
    assert.doesNotMatch(own, /vibe call|consultation|proposal/i, "no sales call for beauty, and it's a quote");
  }
  assert.match(html("hair"), /extensions/i);
  assert.match(html("hair"), /veil/);
  assert.doesNotMatch(html("makeup"), /extensions|veil/i);
});

test("the site links to the three pages, and they are in the sitemap", () => {
  const footer = read("components/marketing/marketing-layout.tsx");
  for (const trade of VENDORS) assert.match(footer, new RegExp(`<Link href="/${trade}">`));
  const home = read("app/page.tsx");
  assert.match(home, /href: VENDOR_TRADE_PAGES\.dj/);
  assert.match(home, /href: VENDOR_TRADE_PAGES\.makeup/);
  assert.match(home, /href: VENDOR_TRADE_PAGES\.hair/);
  const pricing = read("app/pricing/page.tsx");
  assert.match(pricing, /<VendorPlanCard featured=\{false\} \/>/);
  assert.match(pricing, /<VendorTradeLinks \/>/);
  const sitemap = read("app/sitemap.ts");
  for (const trade of VENDORS) assert.match(sitemap, new RegExp(`path: "/${trade}"`));
  assert.match(read("public/llms.txt"), /studio-cue\.com\/dj\)[\s\S]*studio-cue\.com\/makeup\)[\s\S]*studio-cue\.com\/hair\)/);
});

test("each trade's own flows have a How-to guide, which a photographer never sees", () => {
  assert.equal(explainer("music-planner", "dj")?.title, "Plan the night with your client");
  assert.equal(explainer("trial", "makeup")?.title, "Run the makeup trial");
  assert.equal(explainer("trial", "hair")?.title, "Run the hair trial");
  assert.match(explainer("trial", "hair")!.steps.join(" "), /\*\*Extensions\*\*[\s\S]*eight weeks/);
  assert.match(explainer("trial", "hair")!.steps.join(" "), /veil/);
  assert.doesNotMatch(JSON.stringify(explainer("trial", "makeup")), /Extensions|veil/);
  for (const trade of ["makeup", "hair"]) assert.equal(explainer("party-list", trade)?.title, "From the party list to the morning");
  assert.equal(explainer("music-planner", "makeup"), undefined);
  assert.equal(explainer("trial", "dj"), undefined);
  assert.equal(explainer("party-list", "dj"), undefined);
  for (const id of ["music-planner", "trial", "party-list"]) {
    assert.equal(explainer(id, "photographer"), undefined, id);
    assert.ok(!EXPLAINERS.some((guide) => guide.id === id), `${id} stays off the public /how-to`);
  }
  // Offered on the job page beside its main guide.
  const related = (trade: string) => helpForRoute("/studio/projects/abc", "studio", trade).related.map((guide) => guide.id);
  assert.ok(related("dj").includes("music-planner"));
  assert.ok(related("hair").includes("trial") && related("hair").includes("party-list"));
  assert.ok(!related("photographer").includes("trial"));
  for (const trade of VENDORS) assert.ok(explainersFor(trade).length > EXPLAINERS.length - 3, trade);
});

test("Cue can answer how-tos about each trade's own flows; a photographer's prompt is unchanged", () => {
  assert.equal(tradeInstruction("photographer"), "");
  const dj = tradeInstruction("dj");
  assert.match(dj, /How-to facts for this studio: the Music & moments planner goes to the couple when they book and locks 10 days before/);
  assert.match(dj, /"Lay out the night"/);
  assert.match(dj, /how to say the names \(the MC script\)/);
  assert.doesNotMatch(dj, /quote|party list|trial/i);
  const makeup = tradeInstruction("makeup");
  assert.match(makeup, /the job's makeup trial card invites the client to book the trial/);
  assert.match(makeup, /the Party list goes to the client when they book, one person per line, and locks 30 days before/);
  assert.match(makeup, /"Lay out the morning"/);
  assert.match(makeup, /the kit checklist goes in the crew's reminder the day before/);
  assert.match(makeup, /the balance is due the morning of the event/);
  assert.doesNotMatch(makeup, /extensions/i);
  assert.match(tradeInstruction("hair"), /hair trial card/);
});

test("the Console's Studios page filters by trade, counts and all", () => {
  const page = read("components/console/pages/studios-page.tsx");
  assert.match(page, /<ChipSelect label="Trade"/);
  assert.match(page, /const filtered = Boolean\(plan \|\| trade \|\|/);
  assert.match(page, /params\.get\("trade"\)/);
  // The tabs' counts and the stats follow the trade.
  assert.match(page, /everyStudio && trade \? everyStudio\.filter\(\(studio\) => tradeOf\(studio\.trade\) === trade\)/);
});

test("signup always asks what you do, starting on the trade you came for", () => {
  const form = read("features/auth/onboarding-form.tsx");
  assert.match(form, /tradeChoices\.length > 1 \?/);
  assert.match(form, /const pickedTrade: Trade = trade \|\| arrivedWith \|\| "photographer";/);
  assert.doesNotMatch(form, /I&rsquo;m a photographer/);
});
