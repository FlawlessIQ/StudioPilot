import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { renderEmailTemplate } from "../functions/src/communications/email-templates.ts";
import { clientAutomationEmailTypes } from "../functions/src/imports/existing-booking.ts";
import { editableEmailsFor } from "@/features/communications/email-catalog";
import { TRADES, tradeVocab } from "@/features/trades/trades";
import { JOB_KIND_LABELS, bookingGateNeeds, jobKindOf, journeyProfile, kindVariants, vocab } from "@/features/job-kinds/job-kinds";
import { examplePackagesFor } from "@/features/job-kinds/example-packages";
import { recommendedFor } from "@/features/questionnaires/recommended-templates";
import { KIND_STANDARD_MOMENTS } from "@/features/schedules/standard-moments";
import { parsePartyList } from "@/features/schedules/party-list";
import { groupEventWords } from "@/features/group-events/words";

/**
 * Getting ready for prom (docs/new-job-kinds-execution-plan-2026-10-15.md,
 * Phase 4): a family books hair, makeup and pre-prom photos for a student or
 * a group of friends (Conor, 2026-10-15). No agreement, paid in full by default.
 */
const WRONG_WORDS =
  /\b(weddings?|couples?(?! of\b)|brides?|bridal|grooms?|fianc[eé]e?|bridesmaids?|officiant|marriage|ceremony|veil|mitzvah|synagogue|quincea[ñn]era|Sweet 16|athletes?|communion)\b/i;
const brand = { studioName: "Glow by Ana", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: null };

test("the kind: prom night, for the parent, naming the student", () => {
  assert.equal(JOB_KIND_LABELS.prom, "Prom");
  assert.equal(jobKindOf({ eventType: "Prom" }), "prom");
  assert.equal(jobKindOf({ eventType: "Homecoming" }), "prom");
  assert.equal(kindVariants("prom").length, 0);
  assert.equal(vocab("prom", { eventKind: "prom", honoreeName: "Ava" }).YourEvent, "Ava's prom");
  assert.equal(vocab("prom").YourEvent, "Prom night");
  assert.equal(vocab("prom").inquiryDateLabel, "Prom date");
  assert.equal(vocab("prom").honoreeQuestion, "Who's going to prom?");
  const profile = journeyProfile("prom");
  assert.deepEqual(bookingGateNeeds(profile), { agreement: false, payment: true });
  assert.deepEqual([profile.payment, profile.consultation, profile.exclusiveDay, profile.agreementTerms], ["paid_in_full", false, false, null]);
  for (const trade of ["photographer", "makeup", "hair"]) assert.ok(examplePackagesFor(trade, "prom").length, trade);
  assert.ok(KIND_STANDARD_MOMENTS.prom?.some((moment) => moment.title === "Leave for prom"));
  // The inquiry form asks in prom's words.
  const form = readFileSync("components/crm/lead-intake-form.tsx", "utf8");
  assert.match(form, /vocab\(chosenType\.kind\)\.inquiryDateLabel/);
  assert.match(form, /vocab\(chosenType\.kind\)\.honoreeQuestion/);
});

test("makeup, hair and the photographer get prom forms; none of them reads like a wedding", () => {
  const own: Record<string, string[]> = {
    photographer: ["prom-details", "prom-shot-list"],
    dj: [],
    makeup: ["prom-makeup-party-list"],
    hair: ["prom-hair-party-list"],
    planner: [],
  };
  for (const trade of TRADES) {
    const forms = recommendedFor(trade, ["prom"]);
    assert.deepEqual(forms.map((form) => form.id).sort(), [...own[trade]!].sort(), trade);
    for (const form of forms) {
      const text = JSON.stringify(form);
      const match = WRONG_WORDS.exec(text);
      assert.equal(match, null, `${form.id}: "${match?.[0]}" in …${match ? text.slice(Math.max(0, match.index - 60), match.index + 30) : ""}`);
    }
  }
  assert.equal(tradeVocab("makeup", "prom").detailsForm, "Prom party list");
  assert.equal(tradeVocab("hair", "prom").trialHint, null);
  assert.doesNotMatch(JSON.stringify(tradeVocab("makeup", "prom").kitChecklist), WRONG_WORDS);
  const party = parsePartyList("Ava — the student — soft glam — lashes\nMia — friend — natural makeup", "makeup");
  assert.deepEqual(party.map((person) => person.role), ["bride", "party"]);
});

test("no client email to a prom family reads like a wedding, and the booking asks for nothing to sign", () => {
  const keys = [...new Set([...clientAutomationEmailTypes, ...TRADES.flatMap((trade) => editableEmailsFor(trade).map((entry) => entry.key))])].sort();
  const found: string[] = [];
  for (const trade of ["photographer", "makeup", "hair"]) {
    for (const key of keys) {
      let email: ReturnType<typeof renderEmailTemplate>;
      try {
        email = renderEmailTemplate({
          key,
          brand,
          recipientName: "Kim",
          projectName: "Ava Park's prom",
          values: { eventKind: "prom", honoreeName: "Ava", trade, actionUrl: "https://studio-cue.com/client", eventDate: "2027-05-14" },
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
  const booked = renderEmailTemplate({ key: "booking_confirmation", brand, recipientName: "Kim", projectName: "Ava Park's prom", values: { eventKind: "prom", trade: "makeup" } });
  assert.doesNotMatch(booked.body, /agreement|deposit/i);
});

test("a group of friends books in prom's words: students, parents, a group", () => {
  const words = groupEventWords("prom");
  assert.deepEqual([words.person, words.payer, words.teamLabel, words.act], ["student", "parent", "Group", "Book"]);
  const invite = renderEmailTemplate({
    key: "group_event_invite",
    brand,
    recipientName: "Kim",
    projectName: "Westfield High prom",
    values: { eventKind: "prom", trade: "makeup", actionUrl: "https://studio-cue.com/e/x" },
  });
  assert.match(invite.body, /two students\?/);
});

test("the honoree is never last in the chair, even with one friend", async () => {
  const { planChairs } = await import("@/features/schedules/chair-plan");
  const people = parsePartyList("Ava — the student — soft glam\nMia — friend — natural makeup", "makeup");
  const plan = planChairs({ people, readyBy: "17:00", artists: 1, service: "makeup" } as never) as unknown as { chairs?: Array<Array<{ person: { name: string } }>>; rows?: Array<{ title: string }> };
  const text = JSON.stringify(plan);
  assert.ok(text.indexOf("Ava") < text.indexOf("Mia"), text.slice(0, 400));
  // Every kit list says so, never "last".
  const { tradeVocab: words } = await import("@/features/trades/trades");
  for (const kind of ["quince", "sweet16", "prom", "sacrament"]) {
    for (const trade of ["makeup", "hair"]) {
      assert.doesNotMatch(JSON.stringify(words(trade, kind).kitChecklist ?? {}), /\blast, /, `${trade} ${kind}`);
    }
  }
});
