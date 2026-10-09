import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { emailTemplateKeys, renderEmailTemplate } from "../functions/src/communications/email-templates";
import { previewEmail } from "../functions/src/communications/template-preview";

/**
 * Group A of the trade-words sweep (2026-10-09): every email a DJ, makeup
 * artist or hair stylist — or their client, or their crew — receives reads in
 * their own trade's words. A photographer's emails read exactly as before.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const brand = { studioName: "Glow by Ana", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: null };
const VENDORS = ["dj", "makeup", "hair"] as const;
const render = (key: string, values: Record<string, unknown>) =>
  renderEmailTemplate({ key, brand, recipientName: "Maya Brooks", projectName: "Maya & Theo", values });
const visible = (email: { subject: string; preheader: string; text: string }) =>
  `${email.subject}\n${email.preheader}\n${email.text}`;

const PHOTO_WORDS =
  /\b(photos?|photograph(?:s|y|ers?|ing)?|galler(?:y|ies)|shoots?|shooting|shot lists?|albums?|coverage|deliverables?|second shooters?|sneak peeks?|images?|editing|retouching|post-production)\b/i;

/**
 * Photographer-only, and never queued for a vendor: a delivery needs a
 * post-production record (post-event/release.ts), an album reminder needs an
 * album workflow (post-event/jobs.ts), a shot list request needs a trade with
 * a shot list (planning/shot-list-upload.ts, and "Ask now" checks the same).
 * Demo requests go to the StudioCue team.
 */
const PHOTOGRAPHER_ONLY = new Set([
  "delivery",
  "delivery_correction",
  "delivery_expiry_reminder",
  "album_selection_reminder",
  "shot_list_request",
  "platform_demo_requested",
]);

test("no email a vendor's studio, client or crew receives says photo words", () => {
  for (const trade of VENDORS) {
    for (const key of emailTemplateKeys) {
      if (PHOTOGRAPHER_ONLY.has(key)) continue;
      const email = previewEmail({ brandName: "Glow by Ana", timezone: "America/New_York", trade }, key, null);
      const text = `${email.subject}\n${email.html.replace(/<[^>]+>/g, " ")}`;
      // An insurance certificate's "Coverage:" is the insurer's word, not ours;
      // a makeup client's own "inspiration photos" are the prep guide's
      // (features/trades/trades.ts `prepGuide`), outside this sweep.
      const words = (key.startsWith("coi_") ? text.replace(/Coverage:/g, "") : text).replace(/inspiration photos/g, "");
      assert.doesNotMatch(words, PHOTO_WORDS, `${trade} ${key}`);
    }
  }
});

test("a makeup artist or hair stylist is never told about a consultation", () => {
  for (const trade of ["makeup", "hair"] as const) {
    for (const key of emailTemplateKeys) {
      if (PHOTOGRAPHER_ONLY.has(key)) continue;
      const email = previewEmail({ brandName: "Glow by Ana", timezone: "America/New_York", trade }, key, null);
      assert.doesNotMatch(`${email.subject}\n${email.html}`, /consultation/i, `${trade} ${key}`);
    }
    for (const key of ["consultation_invitation", "consultation_confirmation", "consultation_reminder", "consultation_cancelled"]) {
      const email = render(key, { trade, actionUrl: "https://studio-cue.com/x", startsAt: "2027-01-10T15:00:00.000Z" });
      assert.doesNotMatch(visible(email), /consultation/i, `${trade} ${key}`);
    }
    // A call they book anyway is a call; the trial is still the trial.
    assert.equal(
      render("consultation_invitation", { trade, actionUrl: "https://studio-cue.com/x" }).subject,
      "Choose a call time with Glow by Ana",
    );
    assert.match(
      render("consultation_confirmation", { trade, purpose: "trial", startsAt: "2027-01-10T15:00:00.000Z" }).text,
      new RegExp(`Your ${trade} trial is booked`),
    );
  }
  // A DJ's call is a vibe call; a photographer's, a consultation.
  assert.equal(render("consultation_invitation", { trade: "dj", actionUrl: "https://studio-cue.com/x" }).subject, "Choose a vibe call time with Glow by Ana");
  const photo = render("consultation_invitation", { actionUrl: "https://studio-cue.com/x" });
  assert.equal(photo.subject, "Choose a consultation time with Glow by Ana");
  assert.equal(photo.preheader, "Select a convenient time for your photography consultation.");
});

test("a quote is a quote, and a vendor books services", () => {
  for (const trade of ["makeup", "hair"] as const) {
    assert.match(render("contract_ready", { trade }).text, /written from the quote you accepted/);
    const combined = render("contract_ready", { trade, combined: true });
    assert.equal(combined.preheader, "Your services, your price and the terms — read them and sign in one go.");
    assert.match(combined.text, /Part 2 is your services, extras, total and payment schedule\. .*no separate step to accept the quote\./);
    const waiting = render("studio_contract_waiting", { trade, clientName: "Maya", reason: "review" });
    assert.match(waiting.text, /Maya accepted the quote for Maya & Theo/);
  }
  const options = render("package_follow_up", { trade: "dj", portalUrl: "https://studio-cue.com/client" });
  assert.match(options.text, /Let’s find the right package/);
  assert.match(options.text, /Review the available packages and send any questions/);
  // "Spin Theory DJs' terms", never "DJs's" (Riley Park, 2026-10-09).
  const plural = renderEmailTemplate({
    key: "contract_ready",
    brand: { ...brand, studioName: "Spin Theory DJs" },
    recipientName: "Riley Park",
    projectName: "Riley Park Wedding",
    values: { trade: "dj", combined: true },
  });
  assert.match(plural.text, /Part 1 is Spin Theory DJs’ terms/);
  assert.match(render("contract_ready", { trade: "dj", combined: true }).text, /Part 1 is Glow by Ana’s terms/);
});

test("the planning form's request names the trade's own form", () => {
  const dj = render("questionnaire_request", { trade: "dj", actionUrl: "https://studio-cue.com/x" });
  assert.match(dj.text, /We're ready to collect your music & moments planner for Maya & Theo\./);
  assert.match(dj.text, /Complete your music & moments planner: https/);
  const makeup = render("questionnaire_reminder", { trade: "makeup", actionUrl: "https://studio-cue.com/x" });
  assert.match(makeup.text, /We're still waiting for your party list for Maya & Theo\./);
  assert.match(makeup.html, /Party list reminder/);
  assert.equal(makeup.preheader, "Complete your Party list.");
});

test("Cue's trial email lists only the routine messages the trade has", () => {
  const line = (trade?: string) =>
    render("trial_cue_without_asking", { trade, trustApprovals: 3 }).text.split("\n").find((row) => row.startsWith("Cue starts out asking"));
  assert.equal(line("makeup"), "Cue starts out asking. Its routine messages (the schedule confirmation and the final balance summary) each wait for your tap.");
  assert.equal(line("hair"), line("makeup"));
  assert.equal(
    line("dj"),
    "Cue starts out asking. Its routine messages (the schedule confirmation, the final balance summary, the day-before checklist and the note ahead of a vibe call) each wait for your tap.",
  );
});

test("a group-event receipt names the photos only for a photographer", () => {
  const values = { athleteName: "Sam", amountText: "$40.00", packageName: "Team package" };
  assert.match(render("participant_receipt", { ...values, trade: "dj" }).text, /received \$40\.00 for Sam \(Team package\)/);
  assert.match(render("participant_receipt", values).text, /received \$40\.00 for Sam's photos \(Team package\)/);
});

test("the template editor previews the studio's own trade", () => {
  const dj = previewEmail({ brandName: "Spin Theory", trade: "dj" }, "crew_invitation", null);
  assert.match(dj.html, /Role: DJ/);
  assert.match(dj.subject, /^DJ — DJ assignment from Spin Theory$/);
  const makeup = previewEmail({ brandName: "Glow by Ana", trade: "makeup" }, "crew_monthly_roundup", null);
  assert.match(makeup.html, /Makeup artist/);
  const photo = previewEmail({ brandName: "GR Productions" }, "crew_invitation", null);
  assert.match(photo.html, /Role: Second photographer/);
  assert.match(photo.subject, /^Second photographer — Photography assignment from GR Productions$/);
});

test("the reply and test-send fallbacks no longer say photography for everyone", () => {
  const commands = read("functions/src/communications/commands.ts");
  assert.match(commands, /tradeProfile\(\(await db\.doc\(`tenants\/\$\{command\.tenantId\}`\)\.get\(\)\)\.get\("trade"\)\)\.family === "photo"\s*\? "About your photography"\s*: "About your event"/);
  assert.match(commands, /projectName: "Sample project",/);
});

test("a photographer's emails read exactly as they did", () => {
  for (const trade of [undefined, "photographer"]) {
    const options = render("package_follow_up", { trade, portalUrl: "https://studio-cue.com/client" });
    assert.match(options.text, /Let’s find the right coverage/);
    assert.match(options.text, /Review the available coverage and send any questions before making a selection\./);
    assert.match(render("contract_ready", { trade }).text, /It's written from the proposal you accepted, so the package/);
    const combined = render("contract_ready", { trade, combined: true });
    assert.equal(combined.preheader, "Your coverage, your price and the terms — read them and sign in one go.");
    assert.match(combined.text, /Part 2 is your coverage, extras, total and payment schedule\. .*no separate step to accept the proposal\./);
    assert.match(render("studio_contract_waiting", { trade, clientName: "Maya" }).text, /Maya accepted the proposal for Maya & Theo, and StudioCue drafted/);
    const form = render("questionnaire_request", { trade, actionUrl: "https://studio-cue.com/x" });
    assert.equal(form.preheader, "Complete your photography project questionnaire.");
    assert.match(form.text, /We're ready to collect the planning information for Maya & Theo\. You can save/);
    assert.match(form.text, /Complete questionnaire: https/);
    assert.match(form.html, /Planning questionnaire/);
    assert.match(render("questionnaire_reminder", { trade }).html, /Questionnaire reminder/);
    assert.match(
      render("trial_cue_without_asking", { trade, trustApprovals: 3 }).text,
      /Cue starts out asking\. Its routine messages \(the schedule confirmation, the final balance summary, the day-before checklist and the note ahead of a consultation\) each wait for your tap\./,
    );
    assert.match(render("consultation_confirmation", { trade, startsAt: "2027-01-10T15:00:00.000Z" }).text, /Your consultation is booked/);
  }
});
