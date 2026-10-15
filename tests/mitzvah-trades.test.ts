import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { recommendedFor } from "@/features/questionnaires/recommended-templates";
import { planMitzvahNight } from "@/features/schedules/mitzvah-plan";
import { fillMcScript } from "@/features/schedules/mc-script";
import { djMomentsFor } from "@/features/schedules/night-plan";
import { parsePartyList } from "@/features/schedules/party-list";
import { checklistFor, checklistIsCustom } from "@/features/planning/planning-checklist";
import { mitzvahTermsBlocks } from "@/features/contracts/event-details";
import { resolveContractDocument } from "@/features/contracts/document";
import { sampleContractSources } from "@/features/contracts/sample";
import { journeyProfile, JOB_KINDS } from "@/features/job-kinds/job-kinds";

/**
 * A bar or bat mitzvah for every trade (docs/mitzvah-journey-plan-2026-10-14.md):
 * Phase 4, the DJ's, makeup artist's, hair stylist's and planner's own forms
 * and plans; Phase 5, the agreement's Schedule B.
 */

const WEDDING_WORDS = /\b(weddings?|couples?(?! of\b)|brides?|bridal|grooms?|bridesmaids?|ceremony|veil|marriage|officiant)\b/i;

test("every trade gets its own mitzvah form, and none of them reads like a wedding", () => {
  const own: Record<string, string[]> = {
    photographer: ["mitzvah-details", "mitzvah-final-schedule", "mitzvah-shot-list"],
    dj: ["mitzvah-music-planner"],
    makeup: ["mitzvah-makeup-party-list"],
    hair: ["mitzvah-hair-party-list"],
    planner: ["mitzvah-planner-final-details"],
  };
  for (const [trade, ids] of Object.entries(own)) {
    const forms = recommendedFor(trade, ["mitzvah"]);
    assert.deepEqual(forms.map((form) => form.id), ids, trade);
    for (const form of forms) {
      assert.equal(form.eventTypeId, "mitzvah", form.id);
      const match = WEDDING_WORDS.exec(JSON.stringify(form));
      assert.equal(match, null, `${form.id} says "${match?.[0]}"`);
    }
    // Signup is unchanged: a wedding's forms only.
    assert.ok(recommendedFor(trade).every((form) => form.eventTypeId === "wedding"), trade);
  }
  // The DJ's and the planner's read the party start the day plan anchors on.
  for (const id of ["mitzvah-music-planner", "mitzvah-planner-final-details"]) {
    const form = recommendedFor(id.includes("music") ? "dj" : "planner", ["mitzvah"])[0]!;
    const ids = form.sections.flatMap((section) => section.fields.map((field) => field.id));
    assert.ok(ids.includes("party-start-time") && ids.includes("party-location") && ids.includes("candle-lighting-list"), id);
  }
});

test("a DJ's mitzvah night: the party in order, each line with its song and announcement", () => {
  const answers = {
    "party-start-time": "18:00",
    "grand-entrance-song": "Can't Stop the Feeling",
    "entrance-names": "The Cohen family\nAnd our bar mitzvah, Sam!",
    "hora-songs": "Hava Nagila",
    "chair-lift": "Sam, then Rachel and David",
    blessings: "Grandpa Mel — the challah\nAunt Dana — the wine",
    "toast-order": "Rachel and David",
    "candle-lighting-list": "In memory — Grandpa Saul — 'Over the Rainbow'",
    "montage-file": "Dropbox link from Rachel, 6 minutes",
    "parent-dance-songs": "should never reach a mitzvah line",
  };
  const night = planMitzvahNight({ answers, coverageMinutes: 300 });
  const titles = night.rows.map((row) => row.title);
  assert.ok(!titles.some((title) => /arrive|portrait|service|kids' room/i.test(title)), titles.join(", "));
  assert.deepEqual(titles.slice(0, 6), ["Cocktail hour", "Grand entrance", "Hora", "Blessings over the challah and wine", "Parents' speech and toast", "Dinner"]);
  const { items } = fillMcScript(night.rows.map((row) => ({ title: row.title, mc: null })), answers);
  const mc = (title: string) => items.find((item) => item.title === title)?.mc;
  assert.equal(mc("Hora")?.song, "Hava Nagila");
  assert.equal(mc("Hora")?.announcement, "Sam, then Rachel and David");
  assert.match(String(mc("Blessings over the challah and wine")?.announcement), /Grandpa Mel/);
  // The parents' speech is the toast order, never the parent dances.
  assert.equal(mc("Parents' speech and toast")?.announcement, "Rachel and David");
  assert.equal(mc("Parents' speech and toast")?.song ?? null, null);
  assert.match(String(mc("Candle lighting")?.announcement), /Grandpa Saul/);
  assert.match(String(mc("Montage")?.announcement), /Dropbox/);
  assert.match(String(mc("Grand entrance")?.announcement), /bar mitzvah, Sam/);
  // Its "Add a moment" chips are the party's.
  assert.ok(djMomentsFor("mitzvah").some((moment) => moment.title === "Candle lighting"));
  assert.ok(!djMomentsFor("mitzvah").some((moment) => /bouquet|garter|first dance/i.test(moment.title)));
  assert.ok(djMomentsFor("wedding").some((moment) => moment.title === "First dance"));
});

test("a family's party list seats the mom, the grandmother and the child", () => {
  const people = parsePartyList(
    "Rachel Cohen — mom — makeup — lashes\nLily — the bat mitzvah — light makeup\nGrandma Ruth — grandmother — makeup",
    "makeup",
  );
  assert.deepEqual(people.map((person) => person.role), ["mother", "bride", "mother"]); // the child sits where a bride does
});

test("a mitzvah planner's checklist: the synagogue, the candles, the montage — no license, no officiant", () => {
  const full = checklistFor(undefined, "full", "mitzvah");
  const keys = full.map((entry) => entry.key);
  for (const key of ["synagogue_date", "candle_lighting", "montage", "tallit_kippot"]) assert.ok(keys.includes(key), key);
  assert.ok(!keys.some((key) => /marriage|officiant/.test(key)));
  assert.ok(new Set(keys).size === keys.length, "keys are unique: the task id is built from them");
  // A studio's own wedding list stays the wedding's.
  const stored = { full: { items: [{ key: "x", title: "Their own", amount: 3, unit: "months" }] } };
  assert.deepEqual(checklistFor(stored, "full", "mitzvah").map((entry) => entry.key), keys);
  assert.deepEqual(checklistFor(stored, "full").map((entry) => entry.key), ["x"]);
  assert.equal(checklistIsCustom(stored, "full", "mitzvah"), false);
  // Its own mitzvah list wins for a mitzvah.
  const own = { "mitzvah:full": { items: [{ key: "y", title: "Mitzvah own", amount: 2, unit: "months" }] } };
  assert.deepEqual(checklistFor(own, "full", "mitzvah").map((entry) => entry.key), ["y"]);
  assert.equal(checklistIsCustom(own, "full", "mitzvah"), true);
  // The sync passes the job's kind.
  assert.match(readFileSync("functions/src/planning/planning-checklist-sync.ts", "utf8"), /checklistFor\(stored, scope, jobKindOf\(data\)\)/);
});

test("Schedule B: the congregation's rules and children, in each trade's words, on a mitzvah only", () => {
  assert.equal(journeyProfile("mitzvah").agreementTerms, "mitzvah");
  for (const kind of JOB_KINDS.filter((kind) => kind !== "mitzvah")) assert.equal(journeyProfile(kind).agreementTerms, null, kind);

  const text = (trade: string) => JSON.stringify(mitzvahTermsBlocks(trade));
  assert.match(text("photographer"), /cameras out of the service/);
  assert.match(text("photographer"), /will not use images of the honoree/);
  assert.match(text("dj"), /music, sound and announcements/);
  assert.match(text("makeup"), /parent or guardian present/);
  assert.match(text("planner"), /does not provide childcare/);

  const sources = sampleContractSources("Harbor Light Studio", "2026-10-14");
  const template = { title: "Agreement", body: "# Agreement\n\nThe fee is {{price.total}}.", customFields: [] };
  const headings = (blocks: ReadonlyArray<{ type: string }>) =>
    blocks.filter((block) => block.type === "heading").map((block) => (block as { content: Array<{ text: string }> }).content[0]!.text);
  const plain = resolveContractDocument({ template, sources, overrides: {} });
  const mitzvah = resolveContractDocument({ template, sources: { ...sources, kindTerms: mitzvahTermsBlocks("photographer") }, overrides: {} });
  assert.ok(!headings(plain.document.blocks).some((heading) => heading.startsWith("Schedule B")));
  assert.equal(headings(mitzvah.document.blocks).at(-1), "Schedule B — Bar and bat mitzvah terms");
  // Last, after Schedule A.
  assert.equal(headings(mitzvah.document.blocks).at(-2)?.startsWith("Schedule A"), true);

  const sourcesCode = readFileSync("functions/src/contracts/sources.ts", "utf8");
  assert.match(sourcesCode, /agreementTerms === "mitzvah"\s*\? \{ kindTerms: mitzvahTermsBlocks\(/);
});

test("what the prod walk of 2026-10-14 found stays fixed", async () => {
  const read = (path: string) => readFileSync(path, "utf8");
  // The job made when the inquiry arrives keeps who it celebrates, and names which mitzvah.
  const convert = read("functions/src/intake/convert.ts");
  assert.match(convert, /\.\.\.\(mitzvah \? \{ honoreeName: mitzvah\.honoree, mitzvahType: mitzvah\.type \} : \{\}\)/);
  assert.match(convert, /: `\$\{displayName\} \$\{jobWord\}`;/);
  assert.match(convert, /name: jobName\.trim\(\)/);
  // A taken date gets no "pick a time to talk" under a reply that declines it.
  assert.match(read("functions/src/intake/inquiry-link.ts"), /availabilityStatus"\) === "conflict"\) return \{ body: input\.body, linked: false \}/);
  // The studio's alert says who and which.
  const { formInquiryDetails } = await import("../functions/src/intake/new-inquiry-alert.ts");
  const rows = formInquiryDetails({
    email: "rachel@example.com", phone: null, partnerName: null, eventTypeLabel: "Bar or bat mitzvah",
    honoreeName: "Sam", mitzvahType: "bar", venue: null, city: null, estimatedGuestCount: null,
    servicesRequested: [], budgetRange: null, referralSource: null, coiRequired: null,
    venueContactName: null, venueContactEmail: null, answers: [],
  });
  assert.deepEqual(rows.filter((row) => row.label === "Event" || row.label === "Celebrating"), [
    { label: "Event", value: "Bar mitzvah" },
    { label: "Celebrating", value: "Sam" },
  ]);
  // Schedule B wins over a studio's own image-use term, in the agreement's defined words.
  const terms = JSON.stringify(mitzvahTermsBlocks("photographer"));
  assert.match(terms, /Where they differ from the terms above, these apply/);
  assert.match(terms, /The Studio will not use images/);
  assert.doesNotMatch(terms, /Most guests/);
  // The proposal draft never offers the service.
  assert.match(read("functions/src/ai/copilot.ts"), /never offer to photograph or film the service itself/);
  // The contract names which mitzvah, not the studio's type label.
  assert.match(read("functions/src/contracts/sources.ts"), /MITZVAH_TYPE_LABELS\[mitzvahOf\(project\.data\(\)\)\.type!\]/);
});

test("a mitzvah inquiry gets its own form; a wedding inquiry the wedding one", async () => {
  const { inquiryFormChoiceFor } = await import("../functions/src/intake/inquiry-form.ts");
  const settings = {
    inquiryEventForm: { templateId: "wedding-form", eventTypes: ["wedding"] },
    inquiryEventFormByKind: { mitzvah: { templateId: "mitzvah-form" } },
  };
  const mitzvah = { eventKind: "mitzvah", eventTypeId: "new_type", eventTypeLabel: "Bar or bat mitzvah" };
  const wedding = { eventKind: "wedding", eventTypeId: "wedding", eventTypeLabel: "Wedding" };
  const portraits = { eventKind: "portraits", eventTypeId: "portraits", eventTypeLabel: "Portraits" };
  assert.equal(inquiryFormChoiceFor(settings, mitzvah), "mitzvah-form");
  assert.equal(inquiryFormChoiceFor(settings, wedding), "wedding-form");
  assert.equal(inquiryFormChoiceFor(settings, portraits), null);
  // No mitzvah form chosen: a mitzvah inquiry is never sent the wedding's.
  assert.equal(inquiryFormChoiceFor({ inquiryEventForm: settings.inquiryEventForm }, mitzvah), null);
  assert.equal(inquiryFormChoiceFor({ ...settings, inquiryEventFormByKind: { mitzvah: null } }, mitzvah), null);
  assert.equal(inquiryFormChoiceFor(undefined, wedding), null);
  // The command saves it beside the wedding setting, and offering the kind sets it to the copied details form.
  const read = (path: string) => readFileSync(path, "utf8");
  assert.match(read("functions/src/planning/commands.ts"), /inquiryEventFormByKind: \{\s*\[kind\]:/);
  assert.match(read("functions/src/crm/commands.ts"), /form\.id === `\$\{kindOfForm\}-details` && byKind\[kindOfForm\] === undefined/);
  assert.match(read("app/studio/questionnaires/page.tsx"), /<InquiryEventFormSetting kind="mitzvah" \/>/);
});

test("a planner edits the mitzvah checklist apart from the wedding's; vendors can be entertainment", async () => {
  const { checklistStorageKey } = await import("../features/planning/planning-checklist.ts");
  assert.equal(checklistStorageKey("full"), "full");
  assert.equal(checklistStorageKey("full", "mitzvah"), "mitzvah:full");
  assert.equal(checklistStorageKey("partial", "wedding"), "partial");
  const commands = readFileSync("functions/src/planning/commands.ts", "utf8");
  assert.match(commands, /kind: z\.enum\(CHECKLIST_KINDS\)\.optional\(\)/);
  assert.match(commands, /planningChecklists: \{ \[storageKey\]: saved \}/);
  assert.match(readFileSync("components/planning/planning-checklist-settings.tsx", "utf8"), /aria-label="Which kind of job"/);
  // Decision 5: dancers, game hosts and photo booths are a vendor type, never invited (no trade).
  const { VENDOR_TYPES } = await import("../features/vendors/schema.ts");
  const { VENDOR_CATEGORY_LABELS, VENDOR_TEAM_CATEGORIES } = await import("../features/vendors/team.ts");
  assert.ok((VENDOR_TYPES as readonly string[]).includes("entertainment"));
  assert.equal(VENDOR_CATEGORY_LABELS.entertainment, "Entertainment");
  assert.ok(VENDOR_TEAM_CATEGORIES.includes("entertainment"));
  const { vendorTypeIsLive } = await import("../features/trades/trades.ts");
  assert.equal(vendorTypeIsLive("entertainment"), false);
});

test("what the emulator walk of 2026-10-14 found stays fixed", async () => {
  const { mitzvahTypeFromLabel, vocab } = await import("@/features/job-kinds/job-kinds");
  // The type label names both: it is neither, so the portal never says "the bat mitzvah" for Sam.
  assert.equal(mitzvahTypeFromLabel("Bar or bat mitzvah"), null);
  assert.equal(mitzvahTypeFromLabel("Bat Mitzvah"), "bat");
  const portal = readFileSync("app/api/client/portal/route.ts", "utf8");
  assert.match(portal, /honoreeName: safeString\(projectSnapshot\.get\("honoreeName"\)\)/);
  assert.match(portal, /mitzvahType: safeString\(projectSnapshot\.get\("mitzvahType"\)\)/);
  assert.doesNotMatch(vocab("mitzvah", { eventType: "Bar or bat mitzvah" }).event, /bat mitzvah/i);

  // The child sits where a bride does; their mother stays a mother.
  const party = parsePartyList("Rachel Cohen — mom of the bat mitzvah — makeup\nLily — the bat mitzvah — light makeup", "makeup");
  assert.deepEqual(party.map((member) => member.role), ["mother", "bride"]);

  // A DJ, makeup artist or hair stylist booked for a mitzvah gets their form at booking.
  const scheduler = readFileSync("functions/src/planning/planning-form-scheduler.ts", "utf8");
  assert.match(scheduler, /if \(!onTimeline && !journeyProfile\(kind\)\.dayPlan\) return "not_wedding";/);

  // A planner's agreement is for planning services, not wedding planning services.
  const { starterAgreementFor } = await import("@/features/contracts/sample");
  assert.doesNotMatch(starterAgreementFor("planner").body, /wedding planning services/);

  // Initials stay in a form's email subject: "music & MC planner".
  const { renderEmailTemplate } = await import("../functions/src/communications/email-templates.ts");
  const email = renderEmailTemplate({
    key: "questionnaire_request",
    brand: { studioName: "Spin Theory", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: null },
    recipientName: "Rachel",
    projectName: "Cohen Bar Mitzvah",
    values: { trade: "dj", eventKind: "mitzvah", formName: "Mitzvah music & MC planner", actionUrl: "https://studio-cue.com/client" },
  });
  assert.equal(email.subject, "Your mitzvah music & MC planner for Spin Theory");
});

test("what the DJ's prod walk of 2026-10-14 found stays fixed", async () => {
  const { tradeVocab } = await import("@/features/trades/trades");
  // The family's form is named as they get it, on the journey and in Questionnaires.
  assert.equal(tradeVocab("dj", "mitzvah").detailsForm, "Mitzvah music & MC planner");
  assert.equal(tradeVocab("dj").detailsForm, "Music & moments planner");
  assert.match(readFileSync("features/journey/steps.ts", "utf8"), /const tradeWords = tradeVocab\(input\.trade, input\.profile\?\.kind\);/);
  assert.match(readFileSync("components/planning/inquiry-event-form-setting.tsx", "utf8"), /tradeVocab\(workspace\.tenantTrade, kind\)\.detailsForm/);
  // Schedule A: one "Service" on a mitzvah, the synagogue's; the DJ's row is what was booked.
  const { eventDetailsFrom } = await import("@/features/contracts/event-details");
  const rows = eventDetailsFrom({ date: "June 12, 2027", coverage: "1 DJ, 6 hours", trade: "dj", answers: [], kindDetails: { parts: "mitzvah", title: "Mitzvah details" } } as never);
  const labels = (rows as unknown as { rows?: Array<{ label: string }> }).rows ?? (rows as unknown as Array<{ label: string }>);
  assert.ok(Array.isArray(labels) && labels.some((row) => row.label === "Booked"), JSON.stringify(rows));
  assert.ok(!labels.some((row) => row.label === "Service" && /DJ/.test(String((row as { value?: unknown }).value))));
});

test("a form's name keeps its initials mid-sentence, and the family's portal names their own form", async () => {
  const { formNameInSentence } = await import("@/features/trades/trades");
  assert.equal(formNameInSentence("Mitzvah music & MC planner"), "mitzvah music & MC planner");
  assert.equal(formNameInSentence("Party list"), "party list");
  const { clientFormWords } = await import("@/features/client/form-words");
  assert.equal(clientFormWords("Mitzvah music & MC planner").emptyTitle, "Your mitzvah music & MC planner");
  for (const file of ["components/client/kit/client-plan.tsx", "components/client/kit/client-questionnaire.tsx"]) {
    assert.match(readFileSync(file, "utf8"), /tradeVocab\(workspace\.tenantTrade, project \? jobKindOf\(project\) : undefined\)/, file);
  }
});

test("a client's email never explains the studio's own screens, or asks how they heard of the studio", async () => {
  const { tradeInstruction } = await import("../functions/src/trades/trade-instruction.ts");
  for (const trade of ["makeup", "hair", "dj", "planner"]) {
    assert.match(tradeInstruction(trade), /How-to facts/, trade);
    assert.doesNotMatch(tradeInstruction(trade, { forClient: true }), /How-to facts|Lay out the morning|crew's brief/, trade);
  }
  const { messageDraftSystemInstruction } = await import("../functions/src/ai/message-draft.ts");
  const prompt = messageDraftSystemInstruction({ trigger: "inquiry_received", trade: "makeup" });
  assert.doesNotMatch(prompt, /Lay out the morning|How-to facts/);
  assert.match(prompt, /Never ask the client how they heard about the studio/);
  assert.match(readFileSync("functions/src/ai/communications.ts", "utf8"), /tradeInstruction\(input\.trade, \{ forClient: true \}\)/);
});

test("a hair trial on a mitzvah never waits for a veil", async () => {
  const { tradeVocab } = await import("@/features/trades/trades");
  assert.equal(tradeVocab("hair", "mitzvah").trialHint, null);
  assert.match(String(tradeVocab("hair").trialHint), /veil/);
  assert.match(readFileSync("components/projects/live-project-detail.tsx", "utf8"), /tradeVocab\(workspace\.tenantTrade, jobKindOf\(project\)\)\.trialHint/);
  assert.match(readFileSync("features/today/inbox.ts", "utf8"), /tradeVocab\(input\.tenantTrade, jobKindOf\(job\)\)\.trialHint/);
});
