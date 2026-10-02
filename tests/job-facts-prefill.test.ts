import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clockTime,
  factForField,
  jobFactSheet,
  prefillFromFacts,
  unmatchedFields,
  valueForField,
} from "../functions/src/planning/job-facts.ts";
import { acceptedMappings } from "../functions/src/planning/questionnaire-fact-map.ts";
import { starterQuestionnaires } from "../functions/src/planning/starter-questionnaires.ts";

/**
 * A couple's form arrives with what the job already knows filled in. The
 * studio writes its own questions, so the job's facts are matched to them by
 * wording and type — and anything that could mean two things stays blank.
 */

const job = (overrides: Partial<Parameters<typeof jobFactSheet>[0]> = {}) =>
  jobFactSheet({
    projectId: "p1",
    project: {
      eventDate: "2027-06-12",
      eventType: "Wedding",
      venueName: "The Barn at Hudson",
      venue: { formatted: "12 Mill Rd, Hudson, NY 12534", city: "Hudson" },
      city: "Hudson",
    },
    leadId: "l1",
    lead: { estimatedGuestCount: 120, ceremonyTime: "4pm", referralSource: "Instagram", budgetRange: "$5–7k" },
    contacts: [
      { id: "c1", data: { firstName: "Priya", lastName: "Shah", email: "priya@example.com", phone: "555 0100" } },
      { id: "c2", data: { firstName: "Jordan", lastName: "Lee", email: "jordan@example.com", phone: "555 0101" } },
    ],
    vendors: [{ id: "v1", data: { type: "planner", company: "Gather & Grace", contactName: "Maya Lin", phone: "555 0199" } }],
    schedule: {
      id: "s1",
      data: { timezone: "America/New_York", items: [{ title: "Ceremony", startAt: "2027-06-12T20:30:00.000Z" }] },
    },
    responses: [],
    ...overrides,
  });

test("the shipped wedding form arrives with what the job knows, and nothing it doesn't", () => {
  const wedding = starterQuestionnaires().find((form) => form.eventTypeId === "wedding")!;
  const { answers, answerProvenance } = prefillFromFacts({ sheet: job(), sections: wedding.sections });
  assert.deepEqual(answers, {
    "partner-one": "Priya Shah",
    "partner-two": "Jordan Lee",
    "preferred-email": "priya@example.com",
    "ceremony-address": "12 Mill Rd, Hudson, NY 12534",
    planner: "Gather & Grace — Maya Lin, 555 0199",
    "ceremony-time": "16:30",
    "guest-count": "120",
  });
  // Couples are told where each came from.
  assert.equal((answerProvenance["ceremony-time"] as { label: string }).label, "your timeline");
  assert.equal((answerProvenance["guest-count"] as { label: string; verified: boolean }).label, "your inquiry");
  assert.equal((answerProvenance["guest-count"] as { verified: boolean }).verified, false, "the couple's word, not the studio's record");
  assert.equal((answerProvenance["partner-one"] as { sourceType: string }).sourceType, "project_fact");
});

test("which fact a question asks for — and the questions that stay the couple's", () => {
  const cases: Array<[string, string, string | null]> = [
    ["Wedding date", "date", "event_date"],
    ["Date of your big day", "date", "event_date"],
    ["Date", "text", "event_date"],
    ["Engagement session date", "date", null],
    ["Where are you getting married?", "text", "venue_name"],
    ["Venue", "text", "venue_name"],
    ["Venue address", "address", "venue_address"],
    ["Ceremony location", "text", "venue_name"],
    ["What time does the ceremony start?", "time", "ceremony_time"],
    ["Reception venue", "text", null],
    ["Ceremony and reception venue", "text", "venue_name"],
    ["Reception address", "address", null],
    ["Where are you getting ready?", "long_text", null],
    ["How many guests are you expecting?", "text", "guest_count"],
    ["First partner's full name", "text", "partner_one_name"],
    ["Your partner's name", "text", "partner_two_name"],
    ["Bride's name", "text", null],
    ["Groom's phone", "phone", null],
    ["Your phone number", "phone", "client_phone"],
    ["Phone number on the day", "phone", null],
    ["Best email for the gallery", "email", "client_email"],
    ["Venue coordinator", "text", "venue_contact"],
    ["Videographer", "text", "videographer"],
    ["How did you hear about us?", "text", "referral_source"],
    ["Mailing address", "address", "billing_address"],
    ["Any photography or filming restrictions at the venue?", "long_text", null],
    ["Accessibility needs for our team to know about", "long_text", null],
    ["Who should we call on the day?", "contact", null],
    ["Family groups", "repeating_group", null],
    ["Wedding date", "file", null],
    // GR Productions' own forms (2026-10-02).
    ["Photo/Video Start and End Time", "text", null],
    ["# of Invited Guests", "dropdown", "guest_count"],
    ["Ceremony Times", "text", "ceremony_time"],
    ["Florist Name and Number", "text", "florist"],
    ["Hair Name and Number", "text", "hair_makeup"],
    ["Bride Email", "email", null],
    ["Groom Phone", "phone", null],
    ["Reception Times", "text", null],
  ];
  for (const [label, type, expected] of cases)
    assert.equal(factForField({ label, type }), expected, `${label} (${type})`);
});

test("a fact goes in only in the shape its field takes", () => {
  assert.equal(valueForField({ type: "date" }, "2027-06-12"), "2027-06-12");
  assert.equal(valueForField({ type: "date" }, "June 12"), undefined);
  assert.equal(valueForField({ type: "time" }, "4:30 PM"), "16:30");
  assert.equal(valueForField({ type: "email" }, "not an email"), undefined);
  assert.equal(valueForField({ type: "radio", options: ["Wedding", "Elopement"] }, "wedding"), "Wedding");
  assert.equal(valueForField({ type: "dropdown", options: ["Under 50", "50–100", "100–150", "150+"] }, "120"), "100–150");
  assert.equal(valueForField({ type: "dropdown", options: ["Under 50", "50–100", "100–150", "150+"] }, "200"), "150+");
  assert.equal(valueForField({ type: "radio", options: ["Yes", "No"] }, "120"), undefined);
  assert.equal(valueForField({ type: "text" }, "16:30", "ceremony_time"), "4:30 PM", "a time in a text box reads as one");
  assert.equal(valueForField({ type: "time" }, "16:30", "ceremony_time"), "16:30");
  assert.equal(clockTime("4pm"), "16:00");
  assert.equal(clockTime("12am"), "00:00");
  assert.equal(clockTime("16:30"), "16:30");
  assert.equal(clockTime("4"), "", "an hour alone is not a time");
  assert.equal(clockTime("sunset"), "");
});

test("the same question on an earlier form is answered as the couple answered it", () => {
  const sheet = job({
    responses: [
      {
        id: "inquiry-form",
        data: {
          status: "submitted",
          templateSnapshot: { sections: [{ fields: [{ id: "g", label: "Guest count", type: "text" }, { id: "v", label: "Venue", type: "text" }] }] },
          answers: { g: "140", v: "The Barn at Hudson" },
          // "Venue" there was itself a prefill: never carried on as the couple's word.
          answerProvenance: { g: { sourceType: "client_answer" }, v: { sourceType: "project_fact" } },
        },
      },
    ],
  });
  const { answers, answerProvenance } = prefillFromFacts({
    sheet,
    sections: [{ fields: [{ id: "count", label: "Guest count", type: "text" }, { id: "venue", label: "Venue", type: "text" }] }],
  });
  assert.equal(answers.count, "140", "their later answer, over the inquiry's 120");
  assert.equal((answerProvenance.count as { sourceType: string; label: string }).label, "your earlier answers");
  assert.equal((answerProvenance.venue as { sourceType: string }).sourceType, "project_fact", "the venue from the booking itself");
});

test("only blanks nobody touched: a cleared answer stays cleared", () => {
  const sections = [{ fields: [{ id: "date", label: "Wedding date", type: "date" }, { id: "venue", label: "Venue", type: "text" }, { id: "x", label: "Venue", type: "text", internalOnly: true }] }];
  const { answers } = prefillFromFacts({
    sheet: job(),
    sections,
    existing: { date: "2027-07-01" },
    touched: new Set(["venue"]),
  });
  assert.deepEqual(answers, {}, "their date stands, their cleared venue stays clear, internal questions are the studio's");
});

test("one person's email answers one question: a second, unlabelled one is somebody else's", () => {
  const { answers } = prefillFromFacts({
    sheet: job(),
    sections: [
      {
        fields: [
          { id: "q2", label: "Question 2", type: "email" },
          { id: "q7", label: "Question 7", type: "email" },
          { id: "hair", label: "Hair Name and Number", type: "text" },
          { id: "makeup", label: "Makeup Name and Number", type: "text" },
        ],
      },
    ],
  });
  assert.equal(answers.q2, "priya@example.com");
  assert.equal(answers.q7, undefined);
});

test("a couple filed as one contact is not one person's name", () => {
  const sheet = job({ contacts: [{ id: "c1", data: { displayName: "Priya & Jordan", email: "us@example.com" } }], lead: {} });
  const { answers } = prefillFromFacts({
    sheet,
    sections: [{ fields: [{ id: "n", label: "First partner's full name", type: "text" }, { id: "e", label: "Email", type: "email" }] }],
  });
  assert.deepEqual(answers, { e: "us@example.com" });
});

test("the AI map only names a real fact, for a question it was asked about, in a shape that fits", () => {
  const fields = [
    { id: "party", label: "Where's the party?", type: "text" },
    { id: "day", label: "The big day", type: "date" },
    { id: "bride", label: "The bride's full name", type: "text" },
    { id: "when", label: "Kick-off", type: "time" },
  ];
  const map = acceptedMappings(fields, {
    mappings: [
      { fieldId: "party", fact: "venue_name" },
      { fieldId: "day", fact: "venue_name" },
      { fieldId: "bride", fact: "partner_one_name" },
      { fieldId: "when", fact: "ceremony_time" },
      { fieldId: "invented", fact: "event_date" },
      { fieldId: "party", fact: "favourite_colour" },
    ],
  });
  assert.deepEqual(map, { party: "venue_name", when: "ceremony_time" });
  assert.deepEqual(acceptedMappings(fields, "not json"), {});
  // Only questions the rules can't place are ever asked about.
  assert.deepEqual(
    unmatchedFields([{ fields: [{ id: "a", label: "Wedding date", type: "date" }, { id: "b", label: "Where's the party?", type: "text" }, { id: "c", label: "Upload", type: "file" }] }]).map((field) => field.id),
    ["b"],
  );
  // And a mapped question is filled from the records.
  const { answers } = prefillFromFacts({ sheet: job(), sections: [{ fields: [{ id: "party", label: "Where's the party?", type: "text" }] }], factMap: map });
  assert.equal(answers.party, "The Barn at Hudson");
});
