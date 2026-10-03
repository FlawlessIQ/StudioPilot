import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { NATIVE_SIGNING_GENERALLY_AVAILABLE } from "@/features/contracts/rollout";
import { isOfferedProvider } from "@/features/integrations/schema";

/**
 * What the public site says about the product, held to the code that decides
 * it (docs/marketing-video-onboarding-plan-2026-10-02.md §0).
 *
 * Each claim here was wrong on the site at some point: e-sign "coming soon"
 * after it shipped, SMS billed as an extra when no SMS exists, "Most popular"
 * on a plan with no customers, and every "See it in StudioCue" link opening a
 * static mock with the old navigation. When the mechanism changes, the test
 * that fails says which page to rewrite.
 */
const read = (path: string) => readFileSync(path, "utf8");
/** Strings and JSX text, roughly: the source without its comments. */
const copy = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const MARKETING = [
  "app/page.tsx",
  "app/pricing/page.tsx",
  "app/integrations/page.tsx",
  "app/features/page.tsx",
  "app/wedding-photographers/page.tsx",
  "app/corporate-photographers/page.tsx",
  "app/sports-photographers/page.tsx",
  "app/for-clients/page.tsx",
  "app/for-crew/page.tsx",
  "components/marketing/marketing-layout.tsx",
  "components/marketing/studio-proof.tsx",
];

test("signing online in StudioCue is claimed only while it is on for every studio", () => {
  const claims = MARKETING.filter((path) => /sign(?:ed)? online|Signing, built in/i.test(copy(path)));
  assert.ok(claims.length > 0, "nothing says agreements are signed online any more — drop this check");
  assert.equal(
    NATIVE_SIGNING_GENERALLY_AVAILABLE,
    true,
    `native signing is no longer on for everyone; rewrite the signing claims in ${claims.join(", ")}`,
  );
  const integrations = copy("app/integrations/page.tsx");
  assert.doesNotMatch(integrations, /title: "E-signature",\s*badge: "Coming soon"/, "e-sign is live, not coming soon");
});

test("no signing vendor or Stripe payments are offered on the site while the product hides them", () => {
  for (const [provider, name] of [
    ["docusign", /docusign/i],
    ["dropbox_sign", /dropbox sign/i],
    ["stripe", /\bstripe\b/i],
  ] as const) {
    if (isOfferedProvider(provider)) continue;
    for (const path of MARKETING)
      assert.doesNotMatch(
        copy(path),
        name,
        `${path} names ${provider}, which a studio cannot connect (features/integrations/schema.ts offeredProviders)`,
      );
  }
});

test("pricing bills nothing that does not exist", () => {
  // No SMS send path exists; the integrations page lists it as coming soon.
  for (const path of ["app/pricing/page.tsx", "app/page.tsx"]) assert.doesNotMatch(copy(path), /\bSMS\b/, path);
});

test("no plan is called popular before anyone has bought one", () => {
  for (const path of ["app/pricing/page.tsx", "app/page.tsx"]) {
    assert.doesNotMatch(copy(path), /Most popular|Best for teams/, path);
  }
});

test("the stale product mock is gone and nothing links to it", () => {
  assert.ok(!existsSync("app/studio-preview"), "app/studio-preview is back");
  assert.match(
    read("next.config.ts"),
    /source: "\/studio-preview", destination: "\/how-to\/wedding-journey", permanent: true/,
    "/studio-preview should redirect to the journey page",
  );
  for (const path of [...MARKETING, "app/sitemap.ts"])
    assert.doesNotMatch(read(path), /\/studio-preview|Product tour|Explore the live product/, path);
});

test("GR Productions is quoted only with the words Gabriel said", () => {
  const proof = copy("components/marketing/studio-proof.tsx");
  const quotes = proof.match(/&ldquo;([^&]+)&rdquo;/g) ?? [];
  assert.deepEqual(quotes, ["&ldquo;I review it and send it.&rdquo;"], "a new quote needs Gabriel's approval first");
});

test("every link to a stage of the journey page names a real stage", async () => {
  const { EXPECTED_TIMELINE } = await import("@/features/journey/expected-timeline");
  const ids = new Set(EXPECTED_TIMELINE.map((stage) => stage.id));
  const linked = [...MARKETING, "app/how-to/page.tsx"].flatMap((path) =>
    [...read(path).matchAll(/journeyStageHref\("([^"]+)"\)|#stage-([a-z-]+)/g)].map((match) => ({
      path,
      id: match[1] ?? match[2],
    })),
  );
  assert.ok(linked.length > 0, "no stage links left — drop this check");
  for (const { path, id } of linked) assert.ok(ids.has(id), `${path} links to #stage-${id}, which the page doesn't have`);
});

// ── The homepage rebuild and the clips (plan §4, phase 2) ────────────────

const HOME_PARTS = [
  "app/page.tsx",
  "components/marketing/home-faq.tsx",
  "components/marketing/home-journey.tsx",
  "components/marketing/three-people.tsx",
  "components/marketing/payment-track.tsx",
  "components/marketing/cue-does-cue-never.tsx",
  "components/marketing/trial-teaser.tsx",
];

test("the new marketing pieces offer no Stripe payments, SMS, or popularity", () => {
  // The public journey page reads its words from expected-timeline.ts; it
  // said "QuickBooks or Stripe" for client invoices, which no studio can use.
  for (const path of [...HOME_PARTS, "features/journey/expected-timeline.ts"]) {
    if (!isOfferedProvider("stripe")) assert.doesNotMatch(copy(path), /\bstripe\b/i, path);
    assert.doesNotMatch(copy(path), /\bSMS\b|Most popular/, path);
  }
  assert.doesNotMatch(copy("components/saas/live-subscription.tsx"), /Most popular/);
});

test("FAQ: couples need nothing installed — the portal is a web link with an emailed sign-in", async () => {
  const { HOME_FAQ } = await import("@/components/marketing/home-faq");
  const answer = HOME_FAQ.find((item) => /download/i.test(item.question))?.answer ?? "";
  assert.match(answer, /web page/);
  assert.match(answer, /no password/);
  assert.match(read("features/auth/email-link-action.tsx"), /signInWithEmailLink\(auth, address, window\.location\.href\)/);
  for (const path of HOME_PARTS) assert.doesNotMatch(copy(path), /App Store|Google Play/, path);
});

test("FAQ: imports exist for booked weddings and for the studio's own documents, and arrive quiet", async () => {
  const { HOME_FAQ } = await import("@/components/marketing/home-faq");
  const faq = HOME_FAQ.map((item) => `${item.question} ${item.answer}`).join(" ");
  // Booked clients: the CSV import names these tools; anything else is "a spreadsheet".
  const sheet = read("features/imports/spreadsheet.ts");
  for (const tool of ["HoneyBook", "Dubsado", "17hats", "Studio Ninja", "Táve", "Tave"]) {
    if (faq.includes(tool)) assert.ok(sheet.includes(tool), `the FAQ names ${tool}, which the import never claims to read`);
  }
  // Documents: agreement, packages, questionnaires, email templates.
  const studio = read("components/ai/template-import-studio.tsx");
  for (const kind of ['"Email journey": {', "Contract: {", "Questionnaire: {", "Package: {"]) assert.ok(studio.includes(kind), kind);
  // Quiet: an imported booking pauses every automated client email.
  assert.match(read("features/imports/existing-booking.ts"), /clientAutomationsPausedAt: now,/);
  assert.match(faq, /arrive quietly/);
});

test("FAQ: the AI only drafts, and the write boundary that makes it so is in the suite", async () => {
  const { HOME_FAQ } = await import("@/components/marketing/home-faq");
  const answer = HOME_FAQ.find((item) => /AI/.test(item.question))?.answer ?? "";
  assert.match(answer, /never records a payment, a signature or a permission/);
  assert.ok(existsSync("tests/ai-write-boundary.test.ts"));
  assert.match(read("package.json"), /tests\/ai-write-boundary\.test\.ts/, "the AI boundary test must run in npm test");
});

test("FAQ and hero: the trial is 14 days and the card isn't charged during it", async () => {
  const { HOME_FAQ } = await import("@/components/marketing/home-faq");
  assert.match(read("functions/src/saas/stripe-checkout.ts"), /export const STRIPE_TRIAL_PERIOD_DAYS = 14;/);
  const answer = HOME_FAQ.find((item) => /trial/.test(item.question))?.answer ?? "";
  assert.match(answer, /nothing is charged for 14 days/);
});

test("Getting paid: through QuickBooks, with QuickBooks Payments autopay, and no cut", async () => {
  const { QUICKBOOKS_PAYMENTS_SCOPE } = await import("@/features/billing/autopay");
  assert.equal(QUICKBOOKS_PAYMENTS_SCOPE, "com.intuit.quickbooks.payment");
  assert.ok(isOfferedProvider("quickbooks"));
  const home = copy("app/page.tsx");
  assert.match(home, /never takes a cut of client payments/);
  assert.match(home, /<PaymentTrack \/>/);
  // The track on the homepage: QuickBooks only, and the final balance timing
  // read from the schedule, not typed in.
  const track = copy("components/marketing/payment-track.tsx");
  assert.match(track, /QuickBooks Payments/);
  assert.match(track, /SCHEDULE\.finalInvoiceRaisedDaysBefore \/ 7/);
  assert.match(track, /SCHEDULE\.finalInvoiceDueDaysBefore \/ 7/);
});

test("Getting paid: the track's numbers are the Harts' — the ones on Ella's payment screen", () => {
  const track = read("components/marketing/payment-track.tsx");
  const cents = (name: string) => Number(new RegExp(`${name} = ([\\d_]+);`).exec(track)?.[1]?.replace(/_/g, ""));
  const total = cents("HARTS_TOTAL_CENTS");
  const retainer = cents("HARTS_RETAINER_CENTS");
  assert.equal(total, 650_000, "the Harts' proposal is $6,500 (public/marketing/portal-proposal.webp)");
  assert.equal(retainer, 195_000, "the Harts' retainer is $1,950 (public/marketing/portal-payment.webp)");
  assert.match(track, /HARTS_FINAL_CENTS = HARTS_TOTAL_CENTS - HARTS_RETAINER_CENTS/, "the balance is what's left: $4,550");
  const screens = read("features/marketing/screens.json");
  assert.match(screens, /the final balance, its due date, and the retainer already paid/, "portal-payment still shows the balance and the retainer");
});

test("Cue never: the boundary the site states is the one the code keeps", () => {
  const cue = copy("components/marketing/cue-does-cue-never.tsx");
  for (const never of [/Records a payment/, /Signs anything/, /Changes who can see what/, /Marks a job ready/, /Sends without your yes/])
    assert.match(cue, never);
  // Routine reminders can auto-send once switched on, so the column says so.
  assert.match(read("features/messaging/trust-dial.ts"), /Money, signatures and model-written drafts stay on\s+\* approval/);
  assert.match(cue, /Routine reminders can send on their own, but only the ones you switch on in Settings/);
  assert.match(read("package.json"), /tests\/ai-write-boundary\.test\.ts/, "the AI boundary test must run in npm test");
});

test("the homepage names only integrations a studio can connect today", () => {
  const home = copy("app/page.tsx");
  const enabledOAuth = (/NEXT_PUBLIC_ENABLED_OAUTH_PROVIDERS[\s\S]*?value: ([^\n]+)/.exec(read("apphosting.yaml"))?.[1] ?? "")
    .split(",")
    .map((provider) => provider.trim());
  const names = [
    ["QuickBooks", "quickbooks", true],
    ["Google Calendar", "google_calendar", true],
    ["Zoom", "zoom", true],
    ["Dropbox", "dropbox", true],
    ["Outlook", "outlook_calendar", true],
    // iCloud has no OAuth; it connects with an app-specific password.
    ["Apple Calendar", "apple_calendar", false],
  ] as const;
  for (const [name, provider, oauth] of names) {
    if (!home.includes(`"${name}"`)) continue;
    assert.ok(isOfferedProvider(provider), `${name} is on the homepage but not offered`);
    if (oauth) assert.ok(enabledOAuth.includes(provider), `${name} can't start its OAuth flow in production`);
  }
  assert.ok(home.includes('"Apple Calendar"'));
});

test("Not just weddings: each kind's line matches how that kind books", async () => {
  const { journeyProfile } = await import("@/features/job-kinds/job-kinds");
  const home = copy("app/page.tsx");
  const portraits = journeyProfile("portraits");
  assert.equal(portraits.agreement, false);
  assert.equal(portraits.payment, "paid_in_full");
  assert.equal(portraits.detailsFormDaysBefore, 14);
  assert.match(home, /Paid in full to book, no agreement unless you add one, and a short details form two weeks out/);
  const sports = journeyProfile("sports");
  assert.equal(sports.payment, "on_the_day");
  assert.ok(sports.runOfShow && sports.crew);
  assert.match(home, /Paid on the day, a game-day plan/);
  const corporate = journeyProfile("corporate");
  assert.ok(corporate.runOfShow && corporate.crew);
});

test("the website's clips are named as the cutting pipeline uploads them, and never show a broken box", async () => {
  const { MARKETING_MEDIA } = await import("@/features/marketing/media");
  for (const [id, entry] of Object.entries(MARKETING_MEDIA)) {
    assert.match(entry.file, /^mk-[a-z-]+\.v\d+\.mp4$/, id);
    assert.equal(entry.poster, entry.file.replace(/\.mp4$/, ".jpg"), id);
  }
  assert.deepEqual(
    Object.values(MARKETING_MEDIA).map((entry) => entry.file.replace(/\.v\d+\.mp4$/, "")),
    ["mk-hero-loop", "mk-loop-today", "mk-loop-proposal", "mk-loop-sign", "mk-loop-crew", "mk-loop-timeline", "mk-loop-gallery", "mk-teaser"],
  );
  // Each player gives up quietly when its file is missing.
  for (const path of ["components/marketing/loop-video.tsx", "components/marketing/trial-teaser.tsx"]) {
    const source = read(path);
    assert.ok((source.match(/onError=/g) ?? []).length >= 2, `${path} handles a missing poster and video`);
    assert.match(source, /complete && element\.naturalWidth === 0/, `${path} catches a poster that failed before hydration`);
  }
});

test("every marketing page has its own 1200×630 social card under 300 KB", async () => {
  const { OG_IMAGES } = await import("@/features/marketing/metadata");
  for (const name of OG_IMAGES) {
    const file = `public/og/${name}.png`;
    assert.ok(existsSync(file), `${file} is missing: run npx tsx scripts/marketing/og-images.ts ${name}`);
    const png = readFileSync(file);
    assert.equal(png.readUInt32BE(16), 1200, `${file} width`);
    assert.equal(png.readUInt32BE(20), 630, `${file} height`);
    assert.ok(png.length < 300_000, `${file} is ${png.length} bytes`);
  }
  const used = [...MARKETING, "app/how-to/page.tsx", "app/how-to/wedding-journey/page.tsx", "app/page.tsx"]
    .filter((path, index, all) => path.startsWith("app/") && all.indexOf(path) === index)
    .map((path) => /og: "([a-z-]+)"/.exec(read(path))?.[1]);
  assert.deepEqual([...used].sort(), [...OG_IMAGES].sort(), "each page names its own card, and each card is used once");
});
