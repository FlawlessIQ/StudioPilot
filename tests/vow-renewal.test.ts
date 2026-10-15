import assert from "node:assert/strict";
import { test } from "node:test";
import { renderEmailTemplate } from "../functions/src/communications/email-templates.ts";
import { clientAutomationEmailTypes } from "../functions/src/imports/existing-booking.ts";
import { editableEmailsFor } from "@/features/communications/email-catalog";
import { TRADES, tradeVocab } from "@/features/trades/trades";
import { JOB_KIND_LABELS, honoreeOf, jobKindOf, journeyProfile, variantFromLabel, vocab } from "@/features/job-kinds/job-kinds";
import { examplePackagesFor } from "@/features/job-kinds/example-packages";
import { recommendedFor } from "@/features/questionnaires/recommended-templates";
import { djMomentsFor } from "@/features/schedules/night-plan";
import { fillMcScript } from "@/features/schedules/mc-script";
import { checklistFor } from "@/features/planning/planning-checklist";
import { eventDetailsFrom } from "@/features/contracts/event-details";

/**
 * A vow renewal, or an anniversary party with no ceremony (a variant;
 * Conor, 2026-10-15) — docs/new-job-kinds-execution-plan-2026-10-15.md,
 * Phase 5. A couple, so "couple" is right; a wedding's own words are not.
 */
const WRONG_WORDS = /\b(weddings?|brides?|bridal|grooms?|bridesmaids?|fianc[eé]e?|marriage license|veil|mitzvah|quincea[ñn]era|Sweet 16|prom)\b/i;
const brand = { studioName: "Harbor Light Studio", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: null };

test("one kind, two shapes: the variant comes from the type they picked", () => {
  assert.equal(JOB_KIND_LABELS.vow_renewal, "Vow renewal & anniversary");
  assert.equal(jobKindOf({ eventType: "Vow renewal" }), "vow_renewal");
  assert.equal(jobKindOf({ eventType: "50th anniversary party" }), "vow_renewal");
  assert.equal(variantFromLabel("vow_renewal", "Vow renewal"), "vow_renewal");
  assert.equal(variantFromLabel("vow_renewal", "Anniversary party"), "anniversary");
  assert.equal(variantFromLabel("vow_renewal", "Vow renewal & anniversary"), null);
  assert.equal(honoreeOf({ eventKind: "vow_renewal", eventTypeLabel: "Anniversary party" }).variant, "anniversary");
  assert.equal(vocab("vow_renewal", { eventKind: "vow_renewal", eventTypeLabel: "Anniversary party" }).YourEvent, "Your anniversary party");
  assert.equal(vocab("vow_renewal", { eventKind: "vow_renewal", eventTypeLabel: "Vow renewal" }).yourEvent, "your vow renewal");
  assert.equal(vocab("vow_renewal").clientFallback, "the couple");
  const profile = journeyProfile("vow_renewal");
  assert.deepEqual([profile.partner, profile.honoree, profile.agreement, profile.payment], [true, false, true, "deposit_and_balance"]);
  for (const trade of ["photographer", "dj", "planner"]) assert.ok(examplePackagesFor(trade, "vow_renewal").length, trade);
});

test("every trade's own forms, with no wedding's words", () => {
  for (const trade of TRADES) {
    const forms = recommendedFor(trade, ["vow_renewal"]);
    assert.ok(forms.length >= 1, trade);
    for (const form of forms) {
      const text = JSON.stringify(form);
      const match = WRONG_WORDS.exec(text);
      assert.equal(match, null, `${form.id}: "${match?.[0]}" in …${match ? text.slice(Math.max(0, match.index - 60), match.index + 30) : ""}`);
    }
  }
  assert.equal(tradeVocab("dj", "vow_renewal").detailsForm, "Anniversary music & MC planner");
  assert.equal(tradeVocab("hair", "vow_renewal").trialHint, null);
});

test("no client email to a renewing couple calls it a wedding", () => {
  const keys = [...new Set([...clientAutomationEmailTypes, ...TRADES.flatMap((trade) => editableEmailsFor(trade).map((entry) => entry.key))])].sort();
  const found: string[] = [];
  for (const trade of TRADES) {
    for (const key of keys) {
      let email: ReturnType<typeof renderEmailTemplate>;
      try {
        email = renderEmailTemplate({
          key,
          brand,
          recipientName: "Linda",
          projectName: "Linda & Tom's vow renewal",
          values: { eventKind: "vow_renewal", eventTypeLabel: "Vow renewal", trade, actionUrl: "https://studio-cue.com/client", eventDate: "2027-06-05" },
        });
      } catch {
        continue;
      }
      const text = `${email.subject}\n${email.preheader}\n${email.body}`;
      const match = WRONG_WORDS.exec(text);
      if (match) found.push(`${trade} ${key}: "${match[0]}" in …${text.slice(Math.max(0, match.index - 40), match.index + 30).replace(/\s+/g, " ")}…`);
    }
  }
  assert.deepEqual(found, []);
});

test("the DJ's night, the planner's list with no marriage license, and an anniversary party's Schedule A with no vows", () => {
  const { items } = fillMcScript(djMomentsFor("vow_renewal").map((moment) => ({ title: moment.title })), {
    "entrance-names": "Celebrating 25 years, Linda and Tom!",
    "entrance-song": "Canon in D",
    "first-dance-song": "At Last",
    "toast-order": "Their daughter Sophie",
  });
  for (const title of ["Grand entrance", "Vow renewal", "Toasts", "Anniversary dance"]) {
    const line = items.find((item) => item.title === title)!;
    assert.ok(line.mc?.song || line.mc?.announcement, title);
  }
  const keys = checklistFor(undefined, "full", "vow_renewal").map((entry) => entry.key);
  assert.ok(!keys.includes("marriage_license"));
  assert.ok(keys.length > 10);
  const party = eventDetailsFrom({ date: "June 5, 2027", trade: "photographer", venue: "The Grange", answers: [], kindDetails: { parts: "vow_renewal", title: "Celebration details" } } as never);
  assert.ok(party.rows.some((row) => row.label === "Reception" && /Grange/.test(row.value)), JSON.stringify(party.rows));
  assert.ok(!party.rows.some((row) => /Vows/.test(row.label) && /To be confirmed/.test(row.value)));
});

test("what the walk found: the couple's own name, the form at booking, the person celebrating", async () => {
  const { readFileSync } = await import("node:fs");
  const convert = readFileSync("functions/src/intake/convert.ts", "utf8");
  assert.match(convert, /`\$\{couple\}'s \$\{coupleVariant\.toLowerCase\(\)\}`/);
  assert.match(readFileSync("functions/src/planning/planning-form-scheduler.ts", "utf8"), /!journeyProfile\(kind\)\.scheduleAParts\) return "not_wedding"/);
  const { parsePartyList } = await import("@/features/schedules/party-list");
  assert.deepEqual(parsePartyList("Linda Reyes — celebrating — makeup\nSophie — daughter — makeup", "makeup").map((person) => person.role), ["bride", "child"]);
  assert.doesNotMatch(vocab("vow_renewal").timesChanged, /ceremony/);
});
