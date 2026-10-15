import assert from "node:assert/strict";
import { test } from "node:test";
import { renderEmailTemplate } from "../functions/src/communications/email-templates.ts";
import { renderLifecycleDraft } from "../functions/src/communications/lifecycle-core.ts";
import { clientAutomationEmailTypes } from "../functions/src/imports/existing-booking.ts";
import { inquiryLinkLine } from "../functions/src/intake/inquiry-link.ts";
import { editableEmailsFor } from "@/features/communications/email-catalog";
import { TRADES, tradeVocab } from "@/features/trades/trades";
import { JOB_KIND_LABELS, jobKindOf, journeyProfile, namesHonoree, vocab } from "@/features/job-kinds/job-kinds";
import { examplePackagesFor } from "@/features/job-kinds/example-packages";
import { recommendedFor } from "@/features/questionnaires/recommended-templates";
import { planBuiltDay, planBuiltNight } from "@/features/schedules/built-day";
import { massRulesLine } from "@/features/schedules/quince-plan";
import { djMomentsFor } from "@/features/schedules/night-plan";
import { fillMcScript } from "@/features/schedules/mc-script";
import { parsePartyList } from "@/features/schedules/party-list";
import { checklistFor } from "@/features/planning/planning-checklist";
import { eventDetailsFrom, kindTermsBlocks } from "@/features/contracts/event-details";
import { VENDOR_TYPES } from "@/features/vendors/schema";
import { VENDOR_CATEGORY_LABELS } from "@/features/vendors/team";

/**
 * A quinceañera for every trade (docs/new-job-kinds-execution-plan-2026-10-15.md,
 * Phase 1). The parents are the client and their daughter the honoree; the
 * Mass and the reception, the court and the traditions. A quince has a dress,
 * so only a wedding's own words are out.
 */
// "a couple of minutes" is not a couple.
const WEDDING_WORDS = /\b(weddings?|couples?(?! of\b)|brides?|bridal|grooms?|ceremony|fianc[eé]e?|veil|bridesmaids?|officiant|marriage)\b/i;

const brand = { studioName: "Harbor Light Studio", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: null };
const values = {
  eventKind: "quince",
  honoreeName: "Sofia",
  coupleName: "Maria Garcia",
  eventDate: "2027-06-19",
  venueName: "St. Anne's",
  actionUrl: "https://studio-cue.com/client",
  portalUrl: "https://studio-cue.com/client",
  shareUrl: "https://studio-cue.com/share/x",
  dueDate: "2027-05-19",
};

test("the kind: a quinceañera at a mitzvah's weight, for the parents, naming their daughter", () => {
  assert.equal(JOB_KIND_LABELS.quince, "Quinceañera");
  assert.equal(jobKindOf({ eventType: "Quinceañera" }), "quince");
  assert.equal(jobKindOf({ eventType: "Quince años" }), "quince");
  const profile = journeyProfile("quince");
  assert.deepEqual(
    [profile.agreement, profile.payment, profile.detailsFormDaysBefore, profile.honoree, profile.dayPlan, profile.scheduleAParts, profile.agreementTerms],
    [true, "deposit_and_balance", 90, true, "quince", "quince", "quince"],
  );
  const job = { eventKind: "quince", honoreeName: "Sofia" };
  assert.equal(vocab("quince", job).YourEvent, "Sofia's quinceañera");
  assert.equal(namesHonoree(job), true);
  assert.equal(vocab("quince").clientFallback, "the family");
  for (const trade of TRADES) assert.ok(examplePackagesFor(trade, "quince").length, trade);
});

test("no client email to a quinceañera family says wedding, couple, bride, groom or ceremony", () => {
  const keys = [...new Set([...clientAutomationEmailTypes, ...TRADES.flatMap((trade) => editableEmailsFor(trade).map((entry) => entry.key))])].sort();
  assert.ok(keys.length > 10);
  const found: string[] = [];
  for (const trade of TRADES) {
    for (const key of keys) {
      let email: ReturnType<typeof renderEmailTemplate>;
      try {
        email = renderEmailTemplate({ key, brand, recipientName: "Maria", projectName: "Sofia Garcia's quinceañera", values: { ...values, trade } });
      } catch {
        continue;
      }
      const text = `${email.subject}\n${email.preheader}\n${email.body}`;
      const match = WEDDING_WORDS.exec(text);
      if (match) found.push(`${trade} ${key}: "${match[0]}" in …${text.slice(Math.max(0, match.index - 40), match.index + 30).replace(/\s+/g, " ")}…`);
    }
  }
  assert.deepEqual(found, [], "a quinceañera family read a wedding's words");
  const dayBefore = renderLifecycleDraft("day_before_checklist", {
    studioName: "Harbor Light Studio",
    projectName: "Sofia Garcia's quinceañera",
    eventDate: "June 19, 2027",
    venueName: "St. Anne's",
    packageTotalCents: 500000,
    retainerPaidCents: 150000,
    balanceDueCents: 350000,
    packageNames: ["Mass and reception"],
    paymentsOnRecord: true,
    scheduleUrl: null,
    eventKind: "quince",
    honoreeName: "Sofia",
    trade: "photographer",
    recipientEmail: "maria@example.com",
    recipientName: "Maria",
  });
  assert.doesNotMatch(`${dayBefore.subject}\n${dayBefore.body}`, WEDDING_WORDS);
  assert.match(dayBefore.body, /court's entrance order/i);
  assert.ok(dayBefore.highlights.includes("For Sofia's quinceañera"));
  assert.match(inquiryLinkLine("https://studio-cue.com/i/x", false, "quince", "photographer", { honoreeName: "Sofia" }), /Sofia's quinceañera/);
});

test("every trade gets its own quinceañera form, and none reads like a wedding", () => {
  const own: Record<string, string[]> = {
    photographer: ["quince-details", "quince-final-schedule", "quince-shot-list"],
    dj: ["quince-music-planner"],
    makeup: ["quince-makeup-party-list"],
    hair: ["quince-hair-party-list"],
    planner: ["quince-planner-final-details"],
  };
  for (const trade of TRADES) {
    const forms = recommendedFor(trade, ["quince"]);
    assert.deepEqual(forms.map((form) => form.id).sort(), [...own[trade]!].sort(), trade);
    for (const form of forms) {
      const text = JSON.stringify(form);
      const match = WEDDING_WORDS.exec(text);
      assert.equal(match, null, `${form.id}: "${match?.[0]}" in …${match ? text.slice(Math.max(0, match.index - 40), match.index + 30) : ""}`);
    }
  }
  // The DJ's and beauty forms are named as the family gets them.
  assert.equal(tradeVocab("dj", "quince").detailsForm, "Quinceañera music & MC planner");
  assert.equal(tradeVocab("makeup", "quince").detailsForm, "Quinceañera party list");
  assert.match(String(tradeVocab("hair", "quince").trialHint), /tiara/);
  assert.doesNotMatch(JSON.stringify(tradeVocab("hair", "quince")), /veil/);
});

test("the day runs from the reception, in the traditions' order, and the Mass keeps the parish's rules", () => {
  const answers = {
    "reception-start-time": "18:00",
    "mass-time": "14:00",
    "mass-photo-rules": "From the back, no flash",
    church: "St. Anne's, 12 Elm St",
    "reception-location": "The Grand Ballroom",
  };
  const day = planBuiltDay("quince", { answers, coverageMinutes: 480, venue: null } as never);
  const titles = day.rows.map((row) => row.title);
  const order = ["Mass", "Portraits with the court and family", "Cocktail hour", "Grand entrance of the court", "Changing of the shoes", "Crowning", "The last doll", "The waltz", "The court's waltz", "The toast", "Dinner", "Surprise dance"];
  assert.deepEqual(titles.filter((title) => order.includes(title)), order);
  assert.equal(day.rows.find((row) => row.title === "Grand entrance of the court")?.time, "19:00");
  assert.ok(day.notes.some((note) => /parish/.test(note)));
  assert.match(String(massRulesLine(answers)), /no flash/);
  // The DJ's night: no crew, no portraits, no Mass.
  const night = planBuiltNight("quince", { answers, coverageMinutes: 360, venue: null } as never);
  assert.ok(!night.rows.some((row) => /Mass|Portraits|arrive/.test(row.title)));
  assert.ok(night.rows.some((row) => row.title === "The waltz"));
  // A DJ's moments, and the MC script's songs for each tradition.
  assert.ok(djMomentsFor("quince").some((moment) => moment.title === "Surprise dance"));
  const { items: lines } = fillMcScript(
    ["Changing of the shoes", "Crowning", "The last doll", "The waltz", "The court's waltz", "Surprise dance", "Grand entrance of the court"].map((title) => ({ title })),
    {
      "shoes-song": "Tacones Rojos",
      "crowning-song": "Quinceañera — Thalía",
      "last-doll-song": "Tiempo de Vals",
      "waltz-song": "Tiempo de Vals — Chayanne",
      "court-waltz-song": "Vals de las Flores",
      "surprise-dance": "The choreographer's mix, 6 minutes",
      "entrance-names": "Dama Ana Ruiz and Chambelán Diego Ortiz\nAnd our quinceañera, Sofia!",
    },
  );
  assert.deepEqual(
    lines.map((line) => Boolean(line.mc?.song || line.mc?.announcement)),
    [true, true, true, true, true, true, true],
  );
  assert.equal(lines[4]!.mc?.song, "Vals de las Flores");
});

test("the quinceañera sits where a bride does, the damas are her party, and the planner's list has her traditions", () => {
  const party = parsePartyList("Sofia — the quinceañera — full glam\nMaria Garcia — mom of the quinceañera — makeup\nAna Ruiz — dama — makeup", "makeup");
  assert.deepEqual(party.map((person) => person.role), ["bride", "mother", "party"]);
  const keys = checklistFor(undefined, "full", "quince").map((entry) => entry.key);
  for (const key of ["church_date", "court", "choreographer", "padrinos", "traditions", "surprise_dance"]) assert.ok(keys.includes(key), key);
  assert.ok(!keys.some((key) => /marriage|officiant|license/.test(key)));
  assert.ok(VENDOR_TYPES.includes("choreographer" as never));
  assert.equal(VENDOR_CATEGORY_LABELS.choreographer, "Choreographer");
});

test("the agreement: the Mass and the reception in Schedule A, the church and the court's minors in Schedule B", () => {
  const details = eventDetailsFrom({
    date: "June 19, 2027",
    coverage: "1 DJ, 6 hours",
    trade: "dj",
    answers: [
      { question: "Mass start time", answer: "2:00 PM" },
      { question: "Church", answer: "St. Anne's" },
      { question: "Reception location", answer: "The Grand Ballroom" },
    ],
    kindDetails: { parts: "quince", title: "Quinceañera details" },
  } as never);
  const labels = details.rows.map((row) => row.label);
  assert.ok(labels.includes("Booked"));
  // The job's venue is the reception's, never the Mass's.
  const withVenue = eventDetailsFrom({ date: "June 19, 2027", trade: "photographer", venue: "Salón Las Palmas", answers: [], kindDetails: { parts: "quince", title: "Quinceañera details" } } as never);
  assert.ok(!withVenue.rows.some((row) => row.label === "Mass" && /Palmas/.test(row.value)), JSON.stringify(withVenue.rows));
  assert.ok(withVenue.rows.some((row) => /Palmas/.test(row.value)));
  assert.ok(!labels.includes("Service"));
  for (const trade of TRADES) {
    const blocks = kindTermsBlocks("quince", trade);
    const text = JSON.stringify(blocks);
    assert.match(text, /Schedule B — Quinceañera terms/, trade);
    assert.match(text, /parish/, trade);
    assert.doesNotMatch(text, WEDDING_WORDS, trade);
  }
});

test("the form request names the form once, initials kept, without naming the job twice", () => {
  const email = renderEmailTemplate({
    key: "questionnaire_request",
    brand,
    recipientName: "Maria",
    projectName: "Sofia Garcia's quinceañera",
    values: { ...values, trade: "dj", formName: "Quinceañera music & MC planner" },
  });
  assert.match(email.body, /your quinceañera music & MC planner\./);
  assert.doesNotMatch(email.body, /planner for Sofia Garcia's quinceañera/);
  // A form that doesn't name the kind still names the job.
  const wedding = renderEmailTemplate({
    key: "questionnaire_request",
    brand,
    recipientName: "Emma",
    projectName: "Smith Wedding",
    values: { trade: "dj", eventKind: "wedding", formName: "Music & moments planner" },
  });
  assert.match(wedding.body, /your music & moments planner for Smith Wedding/);
});
