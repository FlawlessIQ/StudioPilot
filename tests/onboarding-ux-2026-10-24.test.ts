import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { clockTime, hoursSummary } from "@/features/setup/hours-summary";
import { inquiryFormForKinds, offeredKindsSummary, setupOfferedKinds } from "@/features/setup/work-kinds";
import { SETUP_ORDER, setupOrderFor, setupStepNeed } from "@/features/today/setup-gaps";
import { INQUIRY_FORM_LIMITS } from "@/features/leads/inquiry-form-config";
import { TRADES } from "@/features/trades/trades";

/**
 * The onboarding audit of 2026-10-24 (docs/onboarding-assessment-2026-10-24.md):
 * signup that never said how long it was, a check-your-email page with no
 * way forward, a plan picker of four equal buttons, a setup page where every
 * question shouted "do me first" and none said what it was needed for, and
 * two silent faults — kinds dropped from the inquiry form, and the signup
 * page's card disclosure turned grey on green by a CSS rule cut in half.
 */
const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");
/** Source without comments: history in a comment is not a claim. */
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

// ── Setup says what each question is needed for ──────────────────────────

test("every setup question says what it holds up, in the trade's words", () => {
  for (const trade of TRADES) {
    for (const key of setupOrderFor(trade)) {
      const need = setupStepNeed(key, trade);
      assert.ok(need.label.length > 0, `${trade}/${key}`);
      assert.equal(need.optional, key === "work" || key === "insurance", `${trade}/${key}`);
    }
  }
  assert.equal(setupStepNeed("packages", "photographer").label, "Needed for proposals");
  assert.equal(setupStepNeed("packages", "makeup").label, "Needed for quotes");
  assert.equal(setupStepNeed("availability", "photographer").label, "Needed for calls");
  assert.equal(setupStepNeed("availability", "makeup").label, "Needed for trials");
  assert.equal(setupStepNeed("agreement").label, "Needed to book");
  // Every key setup can ask has an answer.
  for (const key of SETUP_ORDER) assert.ok(setupStepNeed(key).label);
});

test("only the next question carries the dark button, and setup offers a way to start working", () => {
  const setup = code("components/setup/setup-conversation.tsx");
  assert.match(setup, /const nextKey = loading \? null : \(ordered\.find\(\(question\) => gapByKey\.has\(question\.key\)\)\?\.key \?\? null\);/);
  assert.match(setup, /answer\(question, gap, next\)/);
  assert.match(setup, /const buttonClass = \(primary: boolean\) => \(primary \? "button button-dark" : "button button-light"\);/);
  // No answer hard-codes the dark button any more.
  const answerBody = setup.slice(setup.indexOf("const answer = ("), setup.indexOf("function recordFormLinkShared"));
  assert.doesNotMatch(answerBody, /className="button button-dark"/);
  assert.match(setup, /setupStepNeed\(question\.key, workspace\.tenantTrade\)/);
  assert.match(setup, /href="\/studio\/projects\/new"/);
  assert.match(setup, /href="\/studio\/projects\/import"/);
});

test("a way in that is set up counts, and says it is waiting for its first inquiry", () => {
  const hook = code("components/setup/use-setup-state.ts");
  assert.match(hook, /const captureStepWaiting = text\(outsideSteps\.inquiry_capture\?\.state\) === "waiting";/);
  assert.match(hook, /hasInquiryCapture: captured \|\| captureStepWaiting,/);
  // Finishing a route's guide is what records it (lead-capture-setup.tsx)…
  assert.match(read("components/intake/lead-capture-setup.tsx"), /setOutsideStep\("inquiry_capture", "waiting", workspace\.tenantId\)/);
  // …and copying StudioCue's form link does too.
  assert.match(code("components/setup/setup-conversation.tsx"), /setOutsideStep\("inquiry_capture", "waiting", workspace\.tenantId\)/);
  // Today's card stops asking again once it is waiting.
  assert.match(code("components/today/today-inbox.tsx"), /<LeadCaptureStart waiting=\{setup\.inquiryWaiting\} \/>/);
});

// ── "What do you shoot?" keeps every kind it offers ─────────────────────

test("every kind setup offers, once ticked, is on the inquiry form it saves", () => {
  for (const trade of TRADES) {
    const offered = setupOfferedKinds(trade);
    const config = inquiryFormForKinds(trade, offered);
    const kinds = new Set(config.eventTypes.map((type) => type.kind));
    for (const kind of offered) assert.ok(kinds.has(kind), `${trade}: ticked ${kind} was dropped`);
    assert.ok(kinds.has("general"), `${trade}: the general question is kept`);
    assert.ok(config.eventTypes.length <= INQUIRY_FORM_LIMITS.eventTypes, `${trade}: over the limit`);
    const ids = config.eventTypes.map((type) => type.id);
    assert.equal(new Set(ids).size, ids.length, `${trade}: ids are unique`);
  }
});

test("a kind not ticked is left off, and a trade's own types keep their names", () => {
  const photographer = inquiryFormForKinds("photographer", ["wedding", "quince"]);
  assert.deepEqual(
    photographer.eventTypes.map((type) => type.kind),
    ["wedding", "quince", "general"],
  );
  assert.equal(photographer.eventTypes.find((type) => type.kind === "quince")?.label, "Quinceañera");
  // A quinceañera asks for the venue and the guest count, as a wedding does.
  assert.equal(photographer.eventTypes.find((type) => type.kind === "quince")?.venue, true);
  const dj = inquiryFormForKinds("dj", ["wedding", "other"]);
  assert.equal(dj.eventTypes.find((type) => type.kind === "other")?.label, "Party");
});

test("an answered question shows what was answered", () => {
  assert.equal(
    offeredKindsSummary([
      { kind: "wedding", label: "Wedding" },
      { kind: "portraits", label: "Portraits" },
      { kind: "general", label: "General question" },
    ]),
    "Wedding and Portraits",
  );
  assert.equal(offeredKindsSummary([{ kind: "general", label: "General question" }]), null);
  assert.equal(offeredKindsSummary(undefined), null);

  const weekdays = (["mon", "tue", "wed", "thu", "fri"] as const).map((day) => ({ day, startMinute: 540, endMinute: 1020 }));
  assert.equal(hoursSummary(weekdays), "Mon–Fri, 9 AM–5 PM");
  assert.equal(
    hoursSummary([...weekdays.slice(0, 3), { day: "sat", startMinute: 600, endMinute: 840 }]),
    "Mon–Wed, Sat, hours vary by day",
  );
  assert.equal(
    hoursSummary([
      { day: "tue", startMinute: 540, endMinute: 720 },
      { day: "tue", startMinute: 780, endMinute: 1020 },
    ]),
    "Tue, 9 AM–12 PM and 1 PM–5 PM",
  );
  assert.equal(hoursSummary([]), null);
  assert.equal(clockTime(1050), "5:30 PM");
  assert.equal(clockTime(720), "12 PM");
  assert.equal(clockTime(1440), "midnight");
});

// ── Signup says how long it is, and never strands anyone ────────────────

test("signup names its three steps on every screen of it", () => {
  assert.match(code("app/auth/register/page.tsx"), /isClientInvite \? null : <SignupSteps current=\{1\} \/>/);
  assert.match(code("features/auth/onboarding-form.tsx"), /<SignupSteps current=\{2\} \/>/);
  assert.match(code("components/saas/live-subscription.tsx"), /preTrial \? <SignupSteps current=\{3\} \/> : null/);
});

test("checking your email has a resend, a way back from a typo, and the real subject", () => {
  const form = code("features/auth/register-form.tsx");
  assert.match(form, /Send it again/);
  assert.match(form, /Wrong address\? Start again/);
  // The subject it tells the owner to look for is the one the email has.
  const subject = /case "email_verification":\s*return \{\s*subject: "([^"]+)"/.exec(
    read("functions/src/communications/email-templates.ts"),
  )?.[1];
  assert.ok(subject, "the verification email's subject moved");
  assert.ok(form.includes(`Look for &ldquo;${subject}&rdquo;`), `the page should name "${subject}"`);
  // The server's one-a-minute cooldown is what the button waits out.
  assert.match(read("functions/src/auth/emails.ts"), /withinCooldown\(cooldownKey, fingerprint\)/);
  assert.match(form, /const RESEND_WAIT_MS = 60_000;/);
});

test("a verification link applied twice, or opened after it was used, isn't called a failure", () => {
  const page = code("features/auth/verify-email-action.tsx");
  assert.match(page, /if \(applied\.current === oobCode\) return;/);
  assert.match(page, /if \(user\.emailVerified\) \{\s*setState\("complete"\);/);
  assert.doesNotMatch(page, /no longer valid/);
});

test("the studio form asks for a name, and an owner who already has a studio is sent to it", () => {
  const form = code("features/auth/onboarding-form.tsx");
  assert.match(form, /type="radio"/);
  assert.doesNotMatch(form, /<select name="trade"/);
  assert.match(form, /setPhase\("has_studio"\)/);
  assert.match(form, /loadMembershipDocuments\(firestore, userId, \{ force: true \}\)/);
  // It makes the studio; the trial starts at the card.
  assert.doesNotMatch(form, /"Start 14-day trial"/);
});

test("the plan picker is one decision: a plan, with monthly or yearly chosen once", () => {
  const picker = code("components/saas/live-subscription.tsx");
  assert.match(picker, /const \[cadence, setCadence\] = useState<"monthly" \| "yearly">\("monthly"\);/);
  assert.match(picker, /label="Start free trial"/);
  assert.match(picker, /tone=\{card\.key === leading \? "dark" : "light"\}/);
  // The trial-started moment, before setup opens.
  assert.match(picker, /Your trial has started/);
  assert.match(picker, /assign\("\/studio\/setup"\)/);
  // The button says it's working while Checkout is made.
  assert.match(code("components/saas/billing-actions.tsx"), /Opening secure checkout…/);
});

test("before the trial starts, the shell is signup's last step, not a locked workspace", () => {
  const shell = code("components/layout/app-shell.tsx");
  assert.match(shell, /const signupFocus = billingAccess !== null && billingAccess\.level === "closed" && awaitingTrial;/);
  assert.match(shell, /\(signupFocus \? \[\] : visibleSections\)\.map/);
  assert.match(shell, /className="ds-tabbar" hidden=\{signupFocus\}/);
  // Search, "New job" and the bell give way to the one thing still useful:
  // signing out, which on a phone otherwise lives behind the hidden tab bar.
  assert.match(shell, /\{signupFocus \? \(\s*<SignOutButton className="[^"]*ds-topbar-signout" \/>\s*\) : \(\s*<>\s*<GlobalSearch \/>/);
});

// ── Two silent faults ─────────────────────────────────────────────────────

test("the 'Secondary / metadata / body text' group is one rule again", () => {
  // A rule added into the middle of this list on 2026-09-30 split it: the
  // selectors before it took the new rule's grey, margin and size — the
  // signup page's card disclosure went grey on its dark green panel.
  const css = read("app/legacy-bridge.css");
  const start = css.indexOf("/* Secondary / metadata / body text");
  assert.ok(start > 0, "the group moved");
  const brace = css.indexOf("{", start);
  const selectors = css.slice(start, brace);
  for (const selector of [".ds-root .auth-trust", ".ds-root .auth-back", ".ds-root .back-link", ".ds-root .workflow-template-grid > a > p:not(.eyebrow)"])
    assert.ok(selectors.includes(selector), `${selector} is outside the group's rule`);
  assert.match(css.slice(brace, css.indexOf("}", brace)), /^\{\s*font-size: 12\.5px;\s*$/);
});

test("signup's selects are full width, and an import draft's lists say what they add", () => {
  assert.match(read("app/legacy-bridge.css"), /\.ds-root \.auth-form-wrap \.sign-in-form select \{\s*padding-right: 40px;\s*width: 100%;/);
  // The grid forms' top-align for an address field shrank signup's fields
  // to their own content; the one-column form stretches them back.
  assert.match(
    read("app/globals.css"),
    /\.sign-in-form:has\(> \.address-field\) > label,\s*\.sign-in-form:has\(> \.address-field\) > \.address-field \{\s*align-self: stretch;/,
  );
  const fields = code("components/ai/structured-content-fields.tsx");
  assert.doesNotMatch(fields, /\{" "\} item/);
  assert.match(fields, /lineItems: "Add a pricing item"/);
});

// ── Setup's price review ─────────────────────────────────────────────────

test("a package card says the price, what holds the date and what's covered, in the trade's words", async () => {
  const { coverageLabel, depositLabel, priceLabel } = await import("@/features/setup/package-preview");
  assert.equal(priceLabel(320000), "$3,200");
  assert.equal(priceLabel(12550), "$125.50");
  assert.equal(priceLabel(150000, "GBP"), "£1,500");
  assert.equal(depositLabel({ type: "percentage", basisPoints: 3000 }, 320000, "USD", "photographer"), "Retainer: 30% ($960)");
  assert.equal(depositLabel({ type: "fixed", amountCents: 50000 }, 320000, "USD", "makeup"), "Deposit: $500");
  // Unstated is not "$0 to book": the package form asks for it then.
  assert.equal(depositLabel({ type: "fixed", amountCents: 0 }, 320000, "USD"), null);
  assert.equal(coverageLabel(480, [{ role: "photographer", count: 2 }]), "8 hours · 2 photographers");
  assert.equal(coverageLabel(0, [{ role: "hair_stylist", count: 1 }]), "1 hair stylist");
});

test("the review shows exactly what activation creates, under the id activation gives it", () => {
  const review = code("functions/src/studio-import/review.ts");
  const previews = review.slice(review.indexOf("async function packagePreviews("));
  assert.match(previews, /importedStudioPackage\(\{/);
  assert.match(previews, /packageId: `imported_package_\$\{assetId\}`/);
  assert.match(review, /const packageId = `imported_package_\$\{assetId\}`;/);
  assert.match(review, /packagePreviews: await packagePreviews\(db, tenantId, sessionId, versions, items\),/);
});

test("setup's price import ends in the plain review, and its one button approves and activates", () => {
  assert.match(code("app/studio/import/page.tsx"), /fromSetup=\{from === "setup"\}/);
  const studio = code("components/ai/template-import-studio.tsx");
  assert.match(studio, /const setupPrices = fromSetup && initialKind === "Package";/);
  assert.match(studio, /<SetupPackageReview onAdded=\{\(\) => setPricesAdded\(true\)\} onDetailed=\{\(\) => setDetailed\(true\)\} review=\{review\} \/>/);
  // The paste box goes once the packages are in: drafting again would import the list twice.
  assert.match(studio, /\{plainReview && pricesAdded \? null : \(/);
  const card = code("components/ai/setup-package-review.tsx");
  assert.match(card, /action: "approve",\s*confirmClassification: true,/);
  assert.match(card, /await activateStudioImport\(review\.session\.id\);/);
  assert.match(card, /refreshTenantRecords\("packages"\)/);
  // Every added package can be checked on its own page, which leads back.
  assert.match(card, /href=\{`\/studio\/packages\/\$\{encodeURIComponent\(preview\.packageId\)\}\?from=setup`\}/);
  assert.match(code("app/studio/packages/[id]/page.tsx"), /<BackToSetup /);
  // The full workspace is still one press away.
  assert.match(card, /Review every detail instead/);
});

test("a photographer's list keeps its stated retainer and its add-ons, and no price in what's included", async () => {
  const { importedStudioPackage } = await import("../functions/src/studio-import/native-assets");
  // The list pasted on studio-cue.com on 2026-10-24, and the draft the AI
  // made of its first package.
  const list = [
    "2027 Wedding Collections",
    "",
    "Essential - $3,200",
    "6 hours of coverage, one photographer, online gallery with high-resolution downloads.",
    "",
    "Add-ons",
    "Extra hour of coverage - $400",
    "Second photographer - $600",
    "",
    "A 30% retainer reserves your date. The balance is due 30 days before the wedding.",
  ].join("\n");
  const essential = importedStudioPackage({
    name: "Essential",
    structuredContent: {
      lineItems: [{ name: "Essential", price: "3,200", description: "6 hours of coverage, one photographer, online gallery with high-resolution downloads." }],
      currency: "USD",
    },
    displayOrder: 0,
    trade: "photographer",
    sourceText: list,
    sharedAddOnIdPrefix: "imported_addon_session",
  });
  assert.equal(essential.basePriceCents, 320000);
  assert.deepEqual(essential.retainerRule, { type: "percentage", basisPoints: 3000 });
  assert.deepEqual(
    essential.addOns.map((addOn) => [addOn.name, addOn.unitPriceCents]),
    [["Extra hour of coverage", 40000], ["Second photographer", 60000]],
  );
  assert.deepEqual(essential.includedDeliverables, [
    "6 hours of coverage, one photographer, online gallery with high-resolution downloads.",
  ]);
  assert.equal(essential.includedCoverageMinutes, 360);
  // Each package of the list shares one library entry per extra.
  assert.ok(essential.addOns.every((addOn) => addOn.id.startsWith("imported_addon_session_")));
});

test("a package the AI drafted without its price takes it from its own line in the list", async () => {
  const { headingPriceCents, importedStudioPackage } = await import("../functions/src/studio-import/native-assets");
  const list = [
    "Essential - $3,200",
    "6 hours of coverage, one photographer.",
    "Essentials add-on - $90",
    "Signature Collection — $4,800",
    "A 30% retainer reserves your date.",
  ].join("\n");
  assert.equal(headingPriceCents(list, "Essential"), 320000);
  assert.equal(headingPriceCents(list, "Signature Collection"), 480000);
  assert.equal(headingPriceCents(list, "Heirloom"), null);
  // The second draft production's AI made of the same list (2026-10-24):
  // the inclusions as unpriced line items, the price nowhere.
  const essential = importedStudioPackage({
    name: "Essential",
    structuredContent: {
      lineItems: [{ name: "6 hours of coverage" }, { name: "one photographer" }],
      options: [],
      exclusions: [],
      currency: "USD",
    },
    displayOrder: 0,
    trade: "photographer",
    sourceText: list,
  });
  assert.equal(essential.basePriceCents, 320000);
  assert.deepEqual(essential.retainerRule, { type: "percentage", basisPoints: 3000 });
});

test("a price hung on a package's first inclusion is neither included nor counted as crew", async () => {
  const { importedStudioPackage } = await import("../functions/src/studio-import/native-assets");
  // The third draft production's AI made of the list (2026-10-24).
  const essential = importedStudioPackage({
    name: "Essential",
    structuredContent: {
      lineItems: [
        { name: "6 hours of coverage", price: "$3,200" },
        { name: "one photographer" },
        { name: "online gallery with high-resolution downloads" },
      ],
      currency: "USD",
    },
    displayOrder: 0,
    trade: "photographer",
    sourceText: "Essential - $3,200\n6 hours of coverage, one photographer.\nA 30% retainer reserves your date.",
  });
  assert.equal(essential.basePriceCents, 320000);
  assert.deepEqual(essential.includedCoverage, [{ role: "photographer", count: 1 }]);
  assert.deepEqual(essential.includedDeliverables, [
    "6 hours of coverage",
    "one photographer",
    "online gallery with high-resolution downloads",
  ]);
  assert.equal(essential.includedCoverageMinutes, 360);
});
