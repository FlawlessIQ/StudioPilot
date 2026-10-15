import assert from "node:assert/strict";
import { test } from "node:test";
import { renderEmailTemplate } from "../functions/src/communications/email-templates.ts";
import { renderLifecycleDraft } from "../functions/src/communications/lifecycle-core.ts";
import { clientAutomationEmailTypes } from "../functions/src/imports/existing-booking.ts";
import { inquiryLinkLine } from "../functions/src/intake/inquiry-link.ts";
import { editableEmailsFor } from "@/features/communications/email-catalog";
import { TRADES, tradeVocab } from "@/features/trades/trades";
import { JOB_KIND_LABELS, jobKindOf, journeyProfile, vocab } from "@/features/job-kinds/job-kinds";
import { examplePackagesFor } from "@/features/job-kinds/example-packages";
import { recommendedFor } from "@/features/questionnaires/recommended-templates";
import { planBuiltDay, planBuiltNight } from "@/features/schedules/built-day";
import { djMomentsFor } from "@/features/schedules/night-plan";
import { fillMcScript } from "@/features/schedules/mc-script";
import { parsePartyList } from "@/features/schedules/party-list";
import { checklistFor } from "@/features/planning/planning-checklist";
import { eventDetailsFrom, kindTermsBlocks } from "@/features/contracts/event-details";

/**
 * A Sweet 16 for every trade (docs/new-job-kinds-execution-plan-2026-10-15.md,
 * Phase 2): its own kind (Conor, 2026-10-15). The parents book; the party is
 * the day; no service, no wedding's words, and none of the quinceañera's or
 * the mitzvah's either.
 */
const WRONG_WORDS =
  /\b(weddings?|couples?(?! of\b)|brides?|bridal|grooms?|ceremony|fianc[eé]e?|veil|bridesmaids?|officiant|marriage|mitzvah|synagogue|hora|quincea[ñn]era|damas?|chambel[aá]n(?:es)?|padrinos?|Mass)\b/i;

const brand = { studioName: "Harbor Light Studio", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: null };
const values = {
  eventKind: "sweet16",
  honoreeName: "Emma",
  coupleName: "Lisa Carter",
  eventDate: "2027-04-10",
  venueName: "The Loft",
  actionUrl: "https://studio-cue.com/client",
  portalUrl: "https://studio-cue.com/client",
  shareUrl: "https://studio-cue.com/share/x",
  dueDate: "2027-03-10",
};

test("the kind: a Sweet 16, for the parents, naming the birthday girl", () => {
  assert.equal(JOB_KIND_LABELS.sweet16, "Sweet 16");
  assert.equal(jobKindOf({ eventType: "Sweet 16" }), "sweet16");
  assert.equal(jobKindOf({ eventType: "Sweet sixteen party" }), "sweet16");
  const profile = journeyProfile("sweet16");
  assert.deepEqual(
    [profile.agreement, profile.payment, profile.honoree, profile.dayPlan, profile.scheduleAParts, profile.agreementTerms],
    [true, "deposit_and_balance", true, "sweet16", "sweet16", "sweet16"],
  );
  assert.equal(vocab("sweet16", { eventKind: "sweet16", honoreeName: "Emma" }).YourEvent, "Emma's Sweet 16");
  for (const trade of TRADES) assert.ok(examplePackagesFor(trade, "sweet16").length, trade);
});

test("no client email to a Sweet 16 family reads like a wedding, a mitzvah or a quinceañera", () => {
  const keys = [...new Set([...clientAutomationEmailTypes, ...TRADES.flatMap((trade) => editableEmailsFor(trade).map((entry) => entry.key))])].sort();
  const found: string[] = [];
  for (const trade of TRADES) {
    for (const key of keys) {
      let email: ReturnType<typeof renderEmailTemplate>;
      try {
        email = renderEmailTemplate({ key, brand, recipientName: "Lisa", projectName: "Emma Carter's Sweet 16", values: { ...values, trade } });
      } catch {
        continue;
      }
      const text = `${email.subject}\n${email.preheader}\n${email.body}`;
      const match = WRONG_WORDS.exec(text);
      if (match) found.push(`${trade} ${key}: "${match[0]}" in …${text.slice(Math.max(0, match.index - 40), match.index + 30).replace(/\s+/g, " ")}…`);
    }
  }
  assert.deepEqual(found, []);
  const dayBefore = renderLifecycleDraft("day_before_checklist", {
    studioName: "Harbor Light Studio",
    projectName: "Emma Carter's Sweet 16",
    eventDate: "April 10, 2027",
    venueName: "The Loft",
    packageTotalCents: 300000,
    retainerPaidCents: 100000,
    balanceDueCents: 200000,
    packageNames: ["Sweet 16 party"],
    paymentsOnRecord: true,
    scheduleUrl: null,
    eventKind: "sweet16",
    honoreeName: "Emma",
    trade: "photographer",
    recipientEmail: "lisa@example.com",
    recipientName: "Lisa",
  });
  assert.doesNotMatch(`${dayBefore.subject}\n${dayBefore.body}`, WRONG_WORDS);
  assert.ok(dayBefore.highlights.includes("For Emma's Sweet 16"));
  assert.match(inquiryLinkLine("https://studio-cue.com/i/x", false, "sweet16", "photographer", { honoreeName: "Emma" }), /Emma's Sweet 16/);
});

test("every trade gets its own Sweet 16 form, none borrowing another kind's words", () => {
  const own: Record<string, string[]> = {
    photographer: ["sweet16-details", "sweet16-final-schedule", "sweet16-shot-list"],
    dj: ["sweet16-music-planner"],
    makeup: ["sweet16-makeup-party-list"],
    hair: ["sweet16-hair-party-list"],
    planner: ["sweet16-planner-final-details"],
  };
  for (const trade of TRADES) {
    const forms = recommendedFor(trade, ["sweet16"]);
    assert.deepEqual(forms.map((form) => form.id).sort(), [...own[trade]!].sort(), trade);
    for (const form of forms) {
      const text = JSON.stringify(form);
      const match = WRONG_WORDS.exec(text);
      assert.equal(match, null, `${form.id}: "${match?.[0]}" in …${match ? text.slice(Math.max(0, match.index - 40), match.index + 30) : ""}`);
    }
  }
  assert.equal(tradeVocab("dj", "sweet16").detailsForm, "Sweet 16 music & MC planner");
  assert.equal(tradeVocab("hair", "sweet16").trialHint, null);
});

test("the day runs from the party: the entrance, the candles, the parent dance, the toast", () => {
  const answers = { "party-start-time": "19:00", "party-location": "The Loft" };
  const day = planBuiltDay("sweet16", { answers, coverageMinutes: 300, venue: null } as never);
  const order = ["Portraits with family and friends", "Guests arrive", "Grand entrance", "Candle lighting", "Parent dance", "The toast", "Dinner", "Dancing and games"];
  assert.deepEqual(day.rows.map((row) => row.title).filter((title) => order.includes(title)), order);
  assert.equal(day.rows.find((row) => row.title === "Grand entrance")?.time, "19:45");
  assert.ok(!day.rows.some((row) => /Mass|Service/.test(row.title)));
  const night = planBuiltNight("sweet16", { answers, coverageMinutes: 300, venue: null } as never);
  assert.ok(!night.rows.some((row) => /Portraits|Photo and video arrive/.test(row.title)));
  assert.ok(djMomentsFor("sweet16").some((moment) => moment.title === "Candle lighting"));
  const { items } = fillMcScript(
    ["Grand entrance", "Candle lighting", "Parent dance", "The toast", "Dancing and games"].map((title) => ({ title })),
    {
      "entrance-names": "And our birthday girl, Emma!",
      "candle-lighting-list": "Mom and Dad — 'My Girl'",
      "parent-dance-songs": "Isn't She Lovely",
      "toast-order": "Dad, then Grandma Rose",
      games: "Trivia about Emma",
    },
  );
  assert.ok(items.every((line) => line.mc?.song || line.mc?.announcement), JSON.stringify(items));
});

test("the birthday girl sits where a bride does; the planner's list has the candles; the agreement is the party's", () => {
  const party = parsePartyList("Emma — the birthday girl — full glam\nLisa Carter — mom — makeup\nZoe — friend — light makeup", "makeup");
  assert.deepEqual(party.map((person) => person.role), ["bride", "mother", "party"]);
  const keys = checklistFor(undefined, "full", "sweet16").map((entry) => entry.key);
  for (const key of ["venue", "theme", "candle_lighting"]) assert.ok(keys.includes(key), key);
  assert.ok(!keys.some((key) => /marriage|officiant|church|synagogue/.test(key)));
  const details = eventDetailsFrom({
    date: "April 10, 2027",
    trade: "photographer",
    venue: "The Loft",
    answers: [],
    kindDetails: { parts: "sweet16", title: "Sweet 16 details" },
  } as never);
  assert.ok(details.rows.some((row) => row.label === "Party" && /Loft/.test(row.value)), JSON.stringify(details.rows));
  for (const trade of TRADES) {
    const text = JSON.stringify(kindTermsBlocks("sweet16", trade));
    assert.match(text, /Schedule B — Sweet 16 terms/, trade);
    assert.match(text, /Minors/, trade);
    assert.doesNotMatch(text, /parish|synagogue|church|house of worship/i, trade);
  }
});

test("a form named for a Sweet 16 keeps its capital mid-sentence, and doesn't name the job twice", async () => {
  const { formNameInSentence } = await import("@/features/trades/trades");
  assert.equal(formNameInSentence("Sweet 16 party list"), "Sweet 16 party list");
  assert.equal(formNameInSentence("Mitzvah music & MC planner"), "mitzvah music & MC planner");
  const email = renderEmailTemplate({
    key: "questionnaire_request",
    brand,
    recipientName: "Lisa",
    projectName: "Emma Carter's Sweet 16",
    values: { ...values, trade: "hair", formName: "Sweet 16 party list" },
  });
  assert.match(email.subject, /Your Sweet 16 party list for Harbor Light Studio/);
  assert.match(email.body, /your Sweet 16 party list\./);
  assert.doesNotMatch(email.body, /party list for Emma Carter's Sweet 16/);
});
