import assert from "node:assert/strict";
import { test } from "node:test";
import { renderEmailTemplate } from "../functions/src/communications/email-templates.ts";
import { clientAutomationEmailTypes } from "../functions/src/imports/existing-booking.ts";
import { editableEmailsFor } from "@/features/communications/email-catalog";
import { TRADES } from "@/features/trades/trades";
import {
  JOB_KIND_LABELS,
  bookingGateNeeds,
  honoreeContext,
  honoreeOf,
  jobKindOf,
  journeyProfile,
  kindVariants,
  variantFieldFor,
  variantFromLabel,
  vocab,
} from "@/features/job-kinds/job-kinds";
import { examplePackagesFor } from "@/features/job-kinds/example-packages";
import { recommendedFor } from "@/features/questionnaires/recommended-templates";
import { KIND_STANDARD_MOMENTS } from "@/features/schedules/standard-moments";
import { parsePartyList } from "@/features/schedules/party-list";
import { groupEventWords } from "@/features/group-events/words";
import { normaliseInquiryFormConfig, prepareInquiryInput } from "@/features/leads/inquiry-form-config";
import { howToPay } from "../functions/src/group-events/signup.ts";

/**
 * A First Communion, a Confirmation or a Baptism (docs/new-job-kinds-execution-plan-2026-10-15.md,
 * Phase 3): one kind with three variants, the first stored as
 * `occasionVariant`. A family session's weight (Conor: no agreement, paid in
 * full); a whole class's First Communion is a group event.
 */
const WRONG_WORDS =
  /\b(weddings?|couples?(?! of\b)|brides?|bridal|grooms?|fianc[eé]e?|bridesmaids?|officiant|marriage|mitzvah|synagogue|quincea[ñn]era|Sweet 16|athletes?)\b/i;
const brand = { studioName: "Harbor Light Studio", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: null };

test("one kind, three variants, read and written through occasionVariant", () => {
  assert.equal(JOB_KIND_LABELS.sacrament, "Communion, confirmation & baptism");
  assert.deepEqual(kindVariants("sacrament").map((variant) => variant.id), ["first_communion", "confirmation", "baptism"]);
  assert.equal(variantFieldFor("sacrament"), "occasionVariant");
  assert.equal(jobKindOf({ eventType: "First Communion" }), "sacrament");
  assert.equal(jobKindOf({ eventType: "Christening" }), "sacrament");
  assert.equal(variantFromLabel("sacrament", "Baptism"), "baptism");
  assert.equal(variantFromLabel("sacrament", "Communion, confirmation & baptism"), null);
  const job = { eventKind: "sacrament", honoreeName: "Lily", occasionVariant: "first_communion" };
  assert.deepEqual(honoreeOf(job), { name: "Lily", variant: "first_communion" });
  assert.deepEqual(honoreeContext(job), { honoreeName: "Lily", occasionVariant: "first_communion" });
  assert.equal(vocab("sacrament", job).YourEvent, "Lily's first communion");
  assert.equal(vocab("sacrament", { ...job, occasionVariant: "baptism" }).YourEvent, "Lily's baptism");
  assert.equal(vocab("sacrament", { eventKind: "sacrament", honoreeName: "Lily" }).YourEvent, "Your celebration");
  // The inquiry keeps the variant only for a type that asks who it celebrates.
  const config = normaliseInquiryFormConfig({
    eventTypes: [
      { id: "communion", label: "First Communion", kind: "sacrament", eventDate: "required", city: "optional", venue: true, guests: false, coi: false },
      { id: "wedding", label: "Wedding", kind: "wedding", eventDate: "required", city: "required", venue: true, guests: true, coi: true },
    ],
  });
  const kept = prepareInquiryInput({ eventTypeKey: "communion", honoreeName: "Lily", occasionVariant: "first_communion" }, config) as Record<string, unknown>;
  assert.equal(kept.occasionVariant, "first_communion");
  const dropped = prepareInquiryInput({ eventTypeKey: "wedding", honoreeName: "Lily", occasionVariant: "first_communion" }, config) as Record<string, unknown>;
  assert.equal(dropped.occasionVariant, null);
});

test("a family session's weight: no agreement, paid in full, not an exclusive day", () => {
  const profile = journeyProfile("sacrament");
  assert.deepEqual(
    [profile.consultation, profile.agreement, profile.payment, profile.detailsFormDaysBefore, profile.exclusiveDay, profile.shotList, profile.agreementTerms, profile.scheduleAParts],
    [false, false, "paid_in_full", 14, false, true, null, null],
  );
  assert.deepEqual(bookingGateNeeds(profile), { agreement: false, payment: true });
  assert.ok(examplePackagesFor("photographer", "sacrament").length >= 2);
  assert.ok(KIND_STANDARD_MOMENTS.sacrament?.some((moment) => moment.title === "Service"));
});

test("the photographer's and the hair stylist's forms, and no one else's", () => {
  const own: Record<string, string[]> = {
    photographer: ["sacrament-details", "sacrament-shot-list"],
    dj: [],
    makeup: [],
    hair: ["sacrament-hair-party-list"],
    planner: [],
  };
  for (const trade of TRADES) {
    const forms = recommendedFor(trade, ["sacrament"]);
    assert.deepEqual(forms.map((form) => form.id).sort(), [...own[trade]!].sort(), trade);
    for (const form of forms) assert.doesNotMatch(JSON.stringify(form), WRONG_WORDS, form.id);
  }
  // The communicant takes the middle chair, as a bride would.
  const party = parsePartyList("Lily — first communion — curls, with her veil\nMaria Lopez — mom — blowout", "hair");
  assert.deepEqual(party.map((person) => person.role), ["bride", "mother"]);
});

test("no client email to a communion family says wedding, couple, bride or groom", () => {
  const keys = [...new Set([...clientAutomationEmailTypes, ...TRADES.flatMap((trade) => editableEmailsFor(trade).map((entry) => entry.key))])].sort();
  const found: string[] = [];
  for (const trade of ["photographer", "hair"]) {
    for (const key of keys) {
      let email: ReturnType<typeof renderEmailTemplate>;
      try {
        email = renderEmailTemplate({
          key,
          brand,
          recipientName: "Maria",
          projectName: "Lily Lopez's first communion",
          values: { eventKind: "sacrament", honoreeName: "Lily", occasionVariant: "first_communion", trade, actionUrl: "https://studio-cue.com/client", eventDate: "2027-05-02" },
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

test("a class's First Communion signs up in its own words: children, parents, a class", () => {
  const words = groupEventWords("sacrament");
  assert.deepEqual([words.person, words.payer, words.teamLabel, words.act], ["child", "parent", "Class", "Sign up"]);
  assert.doesNotMatch(Object.values(words).join(" "), /athlete|team/i);
  // How to pay never assumes an athlete.
  for (const method of ["venmo", "zelle"] as const) {
    assert.doesNotMatch(howToPay(method, { venmoHandle: "GR", zelleTo: "GR", checkPayableTo: null }, "GR"), /athlete/i);
  }
});

test("what the emulator walk found: paid in full is paid in full, and nothing asks for a signature", async () => {
  const { readFileSync } = await import("node:fs");
  // The bill a no-agreement booking raises is the whole price for a paid-in-full kind.
  assert.match(readFileSync("functions/src/booking/orchestration.ts", "utf8"), /journeyProfile\(kind\)\.payment === "paid_in_full"/);
  // The booking confirmation says only what the job took.
  const email = renderEmailTemplate({
    key: "booking_confirmation",
    brand,
    recipientName: "Maria",
    projectName: "Lily Lopez's first communion",
    values: { eventKind: "sacrament", trade: "hair", portalUrl: "https://studio-cue.com/client" },
  });
  assert.doesNotMatch(email.body, /agreement|deposit|retainer/i);
  assert.match(email.body, /Your payment is in/);
  const wedding = renderEmailTemplate({ key: "booking_confirmation", brand, recipientName: "Emma", projectName: "Smith Wedding", values: { eventKind: "wedding", trade: "photographer" } });
  assert.match(wedding.body, /Your signed agreement and retainer are both in/);
  // The portal's booking step, too.
  const { buildClientMilestones } = await import("../server/client/portal-experience.ts");
  const booking = (needs?: { agreement: boolean; payment: boolean; paidInFull?: boolean }) =>
    buildClientMilestones("PROPOSAL_SENT", { trade: "hair", bookingNeeds: needs }).find((milestone) => milestone.id === "booking")!.description;
  assert.equal(booking({ agreement: false, payment: true, paidInFull: true }), "Accept your quote and pay to book your date.");
  assert.equal(booking(), "Accept your quote, sign, and pay the deposit to book your date.");
  // A communion's own form goes at booking, like a mitzvah's.
  assert.match(readFileSync("functions/src/planning/planning-form-scheduler.ts", "utf8"), /!journeyProfile\(kind\)\.honoree\) return "not_wedding"/);
});
