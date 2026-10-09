import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { tradeAllows } from "../features/trades/trades";
import { tradeAllows as serverTradeAllows } from "../functions/src/trades/trades";
import { editableEmailsFor, emailGroupLabel, EDITABLE_EMAILS } from "../features/communications/email-catalog";
import { DEFAULT_PROPOSAL_TERMS, defaultTermsInTradeWords, proposalTermsForJob } from "../features/booking/autopilot";
import { defaultTermsInTradeWords as serverDefaultTerms, proposalTermsFor } from "../functions/src/proposals/default-terms";
import { importedCoverage } from "../features/imports/existing-booking";
import { oneOffCoverage } from "../functions/src/packages/one-off";
import { validatePreparedAction } from "../functions/src/ai/action-catalog";
import { buildClientPortalExperience } from "../server/client/portal-experience";

/**
 * The terminology and layout sweep of 2026-10-09: Jess Styles Bridal's Today
 * offered "a wedding, inquiry to album" under a card whose heading had
 * wrapped one word per line. What the seven-part sweep left to the joins
 * between its parts is held here; each part has its own tests/trade-words-*.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("a trade that delivers nothing never goes to post-production or delivered — on either side", () => {
  for (const allows of [tradeAllows, serverTradeAllows]) {
    for (const trade of ["dj", "makeup", "hair"]) {
      assert.equal(allows(trade, "POST_PRODUCTION"), false, trade);
      assert.equal(allows(trade, "DELIVERED"), false, trade);
      assert.equal(allows(trade, "REVIEW_REQUESTED"), true, trade);
    }
    assert.equal(allows("photographer", "POST_PRODUCTION"), true);
    assert.equal(allows(undefined, "DELIVERED"), true);
  }
  const commands = read("functions/src/crm/commands.ts");
  assert.match(commands, /\]\.filter\(\(target\) => tradeAllows\(tenantSnapshot\.get\("trade"\), target\)\);/);
  assert.match(commands, /if \(!tradeAllows\(reopenTenant\.get\("trade"\), to\)\) throw new Error/);
  assert.match(read("components/ai/actions/job-actions.tsx"), /tradeAllows\(trade, to\) &&/);
});

test("a vendor's email editor lists no delivery emails and times its calls in its own words", () => {
  const keys = (trade: string) => editableEmailsFor(trade).map((email) => email.key);
  for (const trade of ["dj", "makeup", "hair"]) {
    assert.ok(!keys(trade).some((key) => ["delivery", "delivery_correction", "album_selection_reminder", "delivery_expiry_reminder"].includes(key)), trade);
    assert.doesNotMatch(editableEmailsFor(trade).map((email) => `${email.label} ${email.when}`).join(" "), /photo|gallery|album|coverage/i, trade);
  }
  const hair = editableEmailsFor("hair");
  assert.equal(hair.find((email) => email.key === "proposal_sent")?.label, "Quote");
  // What the editor shows: each label and when it goes (keys are ids).
  assert.doesNotMatch(hair.map((email) => `${email.label} ${email.when}`).join(" "), /consultation/i);
  assert.equal(emailGroupLabel("Inquiry & consultation", "hair"), "Inquiry & calls");
  assert.equal(emailGroupLabel("Inquiry & consultation", "dj"), "Inquiry & vibe call");
  // A photographer's list is the list it always was.
  assert.equal(editableEmailsFor("photographer"), EDITABLE_EMAILS);
  assert.equal(emailGroupLabel("Inquiry & consultation", undefined), "Inquiry & consultation");
  assert.match(read("components/communications/email-template-designer.tsx"), /editableEmailsFor\(workspace\.tenantTrade\)/);
});

test("default terms speak the studio's trade; terms a studio wrote are its own", () => {
  const makeup = defaultTermsInTradeWords(DEFAULT_PROPOSAL_TERMS, "makeup");
  assert.equal(makeup, "What's included and payment dates are as set out in this quote. The signed agreement holds the full terms.");
  assert.equal(serverDefaultTerms(DEFAULT_PROPOSAL_TERMS, "makeup"), makeup);
  assert.equal(proposalTermsFor("", "hair"), "What's included and payment dates are as set out in this quote. The signed agreement holds the full terms.");
  assert.equal(proposalTermsFor(""), DEFAULT_PROPOSAL_TERMS);
  assert.equal(defaultTermsInTradeWords(DEFAULT_PROPOSAL_TERMS, "photographer"), DEFAULT_PROPOSAL_TERMS);
  assert.equal(defaultTermsInTradeWords("Our own terms, as written.", "dj"), "Our own terms, as written.");
  // No agreement and no photographer: neither promise.
  assert.equal(
    proposalTermsForJob([], { agreement: false, payment: true }, "dj"),
    "What's included and payment dates are as set out in this proposal. Accepting it and paying books the date.",
  );
  assert.doesNotMatch(read("functions/src/ai/copilot.ts"), /Write proposal copy for a photography studio/);
});

test("a vendor's imported or one-off crew is the studio's own role, never photographers", () => {
  assert.deepEqual(importedCoverage({ photographers: 2, videographers: 1 }, "hair_stylist"), [{ role: "hair_stylist", count: 2 }]);
  assert.deepEqual(importedCoverage({ photographers: 0, videographers: 0 }, "dj"), [{ role: "dj", count: 1 }]);
  assert.deepEqual(importedCoverage({ photographers: 1, videographers: 1 }), [
    { role: "photographer", count: 1 },
    { role: "videographer", count: 1 },
  ]);
  assert.deepEqual(oneOffCoverage(undefined, "makeup_artist"), [{ role: "makeup_artist", count: 1 }]);
  assert.deepEqual(oneOffCoverage(undefined), [{ role: "photographer", count: 1 }]);
  assert.equal(read("features/imports/existing-booking.ts"), read("functions/src/imports/existing-booking.ts"));
});

test("Cue offers a vendor no gallery, editing or album card", () => {
  const context = { allowedProjectIds: new Set(["p1"]), archivedProjectIds: new Set<string>(), scopedProjectId: "p1", ownerOrAdmin: true };
  for (const action of ["record_delivery", "complete_editing_step", "update_album", "replace_gallery_link"]) {
    assert.equal(validatePreparedAction({ action }, { ...context, delivers: false }).ok, false, action);
    assert.equal(validatePreparedAction({ action }, context).ok, true, action);
  }
  assert.equal(validatePreparedAction({ action: "close_job" }, { ...context, delivers: false }).ok, validatePreparedAction({ action: "close_job" }, context).ok);
});

test("a vendor's client never grows a photos entry by reaching the review", () => {
  const makeup = buildClientPortalExperience({ state: "REVIEW_REQUESTED", availability: {}, checkpoints: [], trade: "makeup" });
  assert.equal(makeup.navigation.delivery, false);
  assert.equal(buildClientPortalExperience({ state: "REVIEW_REQUESTED", availability: {}, checkpoints: [] }).navigation.delivery, true);
});

test("the wedding film is a photo studio's, wherever it is offered", () => {
  const film = read("components/help/journey-film.tsx");
  assert.match(film, /return shootsWeddings && tradeProfile\(tenantTrade\)\.family === "photo";/);
  for (const file of ["components/help/journey-today-card.tsx", "components/help/help-center.tsx", "components/setup/setup-conversation.tsx"]) {
    assert.match(read(file), /useOffersWeddingFilm\(\)/, file);
    assert.doesNotMatch(read(file), /useStudioJobTypes\(\)\.some/, file);
  }
  assert.match(read("app/studio/help/journey/page.tsx"), /<PhotoStudioOnly>/);
});

test("Today's inquiries card wraps rather than squeezes, and the layout guard runs in CI", () => {
  const css = read("app/globals.css");
  const card = css.slice(css.indexOf(".capture-start {"), css.indexOf(".capture-start-icon {"));
  assert.match(card, /display: flex;\s*flex-wrap: wrap;/);
  assert.doesNotMatch(css, /grid-template-columns: auto minmax\(0, 1fr\) auto;\s*\}\s*\.capture-start-routes/);
  assert.match(css.slice(css.indexOf(".capture-start-copy {")), /^\.capture-start-copy \{[^}]*flex: 1 1 240px;/);
  // Every page, at a laptop, a desk and a phone.
  const spec = read("e2e/layout-integrity.spec.ts");
  assert.match(spec, /globSync\("app\/\*\*\/page\.tsx"\)/);
  assert.match(spec, /const widths = \[1024, 1280, 1536, 390\];/);
  assert.match(read(".github/workflows/ci.yml"), /npx playwright test e2e\/layout-integrity\.spec\.ts --project=desktop-chromium/);
  assert.match(read("CLAUDE.md"), /## UI layout \(read before writing CSS\)/);
});
