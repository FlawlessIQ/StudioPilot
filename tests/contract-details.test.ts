import assert from "node:assert/strict";
import { test } from "node:test";
import {
  contractDetailRows,
  contractQuestions,
  contractRowsFromAnswers,
  matchContractToJob,
  mergeContractRows,
  scheduleAContractAnswers,
} from "../functions/src/planning/contract-details.ts";
import { jobFactSheet, prefillFromFacts } from "../functions/src/planning/job-facts.ts";
import { requiredAnswered } from "../functions/src/planning/job-prefill.ts";
import { eventDetailsFrom } from "../features/contracts/event-details.ts";

/**
 * An imported job's signed contract fills in the client's forms and Schedule
 * A (GR Productions, 2026-10-27): the Final schedule of an imported wedding
 * showed the date and the venue, and every name, place and time in the
 * contract as "Not answered yet". Made-up people throughout.
 */

const finalSchedule = [
  {
    title: "The bride",
    fields: [
      { id: "bride-name", label: "Bride's name", type: "text", required: true },
      { id: "bride-email", label: "Bride's email", type: "email" },
      { id: "bride-prep", label: "Bridal prep location", type: "text", required: true },
      { id: "bride-prep-start", label: "Bridal prep start time", type: "time" },
    ],
  },
  {
    title: "Ceremony and reception",
    fields: [
      { id: "ceremony-location", label: "Ceremony location", type: "text", required: true },
      { id: "ceremony-start", label: "Ceremony start time", type: "time", required: true },
      { id: "reception-location", label: "Reception location", type: "text" },
      { id: "guests", label: "Number of invited guests", type: "dropdown", options: ["Under 100", "100–150", "150+"] },
      { id: "notes", label: "Studio notes", type: "long_text", internalOnly: true },
      { id: "upload", label: "Inspiration photos", type: "file" },
    ],
  },
];

const read = () => {
  const questions = contractQuestions([{ sections: finalSchedule }]);
  const id = (label: string) => questions.find((question) => question.label === label)!.id;
  return {
    questions,
    rows: contractRowsFromAnswers(questions, [
      { id: id("Bride's name"), answer: "Nora Vale" },
      { id: id("Bridal prep location"), answer: "The Linden Hotel, Suite 4" },
      { id: id("Bridal prep start time"), answer: "11:30 AM" },
      { id: id("Ceremony location"), answer: "St. Brendan's Church" },
      { id: id("Ceremony start time"), answer: "3:30 PM" },
      { id: id("Reception location"), answer: "Willowmere Estate" },
      { id: id("Number of invited guests"), answer: "100–150" },
    ]),
  };
};

test("a contract is asked the studio's own questions, each once, and only ones a page can answer", () => {
  const questions = contractQuestions([
    { sections: finalSchedule },
    // The same question on another form is asked once, by its wording.
    { sections: [{ title: "Event details", fields: [{ id: "x", label: "Ceremony Location", type: "text" }] }] },
  ]);
  assert.deepEqual(
    questions.map((question) => question.label),
    [
      "Bride's name",
      "Bride's email",
      "Bridal prep location",
      "Bridal prep start time",
      "Ceremony location",
      "Ceremony start time",
      "Reception location",
      "Number of invited guests",
    ],
  );
  assert.deepEqual(questions.map((question) => question.id).slice(0, 3), ["q1", "q2", "q3"]);
  assert.equal(questions[0]!.section, "The bride");
});

test("what was read is shaped for each question, and what doesn't fit is dropped", () => {
  const { questions, rows } = read();
  const byLabel = new Map(rows.map((row) => [row.label, row.value]));
  assert.equal(byLabel.get("Bridal prep start time"), "11:30", "a time field takes HH:MM");
  assert.equal(byLabel.get("Ceremony start time"), "15:30");
  assert.equal(byLabel.get("Number of invited guests"), "100–150", "a choice only from its own options");
  const shaped = contractRowsFromAnswers(questions, [
    { id: "q99", answer: "not a question" },
    { id: questions.find((question) => question.label === "Number of invited guests")!.id, answer: "about 200" },
    { id: questions.find((question) => question.label === "Bride's email")!.id, answer: "not an email" },
  ]);
  assert.deepEqual(shaped, [], "an unknown question, a choice it doesn't offer and a bad email are all left blank");
});

test("a fact asked in two wordings fills both, when they are the same field", () => {
  // Prod walk, 2026-10-27: the contract said 140 guests; the reader answered
  // the studio's "Expected guest count" and the Final schedule's "Number of
  // invited guests" stayed blank.
  const questions = contractQuestions([
    { sections: [{ title: "Access and consent", fields: [{ id: "guest-count", label: "Expected guest count", type: "text" }] }] },
    {
      sections: [
        {
          title: "Ceremony and reception",
          fields: [
            { id: "guest-count", label: "Number of invited guests", type: "text" },
            { id: "kids-count", label: "How many of them are kids", type: "text" },
          ],
        },
      ],
    },
    // Same id, another type: not the same question.
    { sections: [{ title: "Other", fields: [{ id: "guest-count", label: "Guest count range", type: "dropdown", options: ["Under 100", "100+"] }] }] },
  ]);
  const id = (label: string) => questions.find((question) => question.label === label)!.id;
  const rows = contractRowsFromAnswers(questions, [{ id: id("Expected guest count"), answer: "140" }]);
  assert.deepEqual(
    rows.map((row) => [row.label, row.value]),
    [
      ["Expected guest count", "140"],
      ["Number of invited guests", "140"],
    ],
  );

  // Both answered, differently: each keeps what the reader said for it.
  const both = contractRowsFromAnswers(questions, [
    { id: id("Expected guest count"), answer: "about 140" },
    { id: id("Number of invited guests"), answer: "140" },
  ]);
  assert.equal(both.find((row) => row.label === "Number of invited guests")?.value, "140");

  // A field with no id is only ever its own question.
  const unnamed = contractQuestions([
    { sections: [{ fields: [{ label: "Expected guest count", type: "text" }, { label: "Number of invited guests", type: "text" }] }] },
  ]);
  assert.equal(contractRowsFromAnswers(unnamed, [{ id: "q1", answer: "140" }]).length, 1);
});

test("the client's form fills from the contract, saying so — and their own answer still wins", () => {
  const { rows } = read();
  const sheet = (responses: Parameters<typeof jobFactSheet>[0]["responses"] = []) =>
    jobFactSheet({
      projectId: "p1",
      project: { eventDate: "2027-02-06", venueName: "St. Brendan's Church", contractDetails: { rows, updatedAt: "2026-10-27T12:00:00.000Z" } },
      leadId: null,
      lead: null,
      contacts: [],
      vendors: [],
      schedule: null,
      responses,
    });
  const { answers, answerProvenance } = prefillFromFacts({ sheet: sheet(), sections: finalSchedule });
  // "Bride's name" is a question no rule can fill (it doesn't say which
  // client): the contract that names the bride can.
  assert.equal(answers["bride-name"], "Nora Vale");
  assert.equal(answers["bride-prep"], "The Linden Hotel, Suite 4");
  assert.equal(answers["ceremony-start"], "15:30");
  assert.equal(answers["guests"], "100–150");
  assert.equal(answers["notes"], undefined, "a studio-only field is never filled");
  assert.deepEqual(answerProvenance["bride-name"], {
    sourceType: "contract_fact",
    sourceId: "p1",
    sourceCollection: "projects",
    sourceField: "contractDetails",
    label: "your signed contract",
    verified: true,
  });

  // An answer already on the form stays.
  const kept = prefillFromFacts({ sheet: sheet(), sections: finalSchedule, existing: { "bride-prep": "Her parents' house" } });
  assert.equal(kept.answers["bride-prep"], undefined);

  // The client said otherwise on another form: they are believed.
  const theirs = prefillFromFacts({
    sheet: sheet([
      {
        id: "r1",
        data: {
          status: "submitted",
          templateSnapshot: { sections: [{ fields: [{ id: "prep", label: "Bridal prep location", type: "text" }] }] },
          answers: { prep: "Her parents' house" },
          answerProvenance: { prep: { sourceType: "client_answer", changedAt: "2026-11-01T10:00:00.000Z" } },
        },
      },
    ]),
    sections: finalSchedule,
  });
  assert.equal(theirs.answers["bride-prep"], "Her parents' house");
});

test("Schedule A prints the contract's answers where no returned form has, and stops saying 'To be confirmed'", () => {
  const { rows } = read();
  const fromContract = scheduleAContractAnswers(rows, new Set(["reception location"]));
  assert.ok(!fromContract.some((row) => row.question === "Reception location"), "a returned form's answer wins");
  assert.equal(fromContract.find((row) => row.question === "Ceremony start time")?.answer, "3:30 PM", "times print as people read them");

  const details = eventDetailsFrom({
    eventType: "Wedding",
    eventKind: "wedding",
    date: "Saturday, February 6, 2027",
    venue: "St. Brendan's Church",
    coverage: null,
    answers: scheduleAContractAnswers(rows, new Set()).map(({ question, answer }) => ({ question, answer })),
  });
  assert.deepEqual(details.missing, []);
  assert.ok(details.rows.some((row) => row.value === "The Linden Hotel, Suite 4"));
  assert.ok(details.rows.some((row) => row.value === "Willowmere Estate"));
});

test("a later contract reading replaces the same question's answer and keeps the rest", () => {
  const prior = contractDetailRows([
    { key: "ceremony location", label: "Ceremony location", type: "text", value: "St. Brendan's Church" },
    { key: "reception location", label: "Reception location", type: "text", value: "Willowmere Estate" },
  ]);
  const merged = mergeContractRows(prior, contractDetailRows([{ label: "Ceremony Location", type: "text", value: "Chapel of the Pines" }]));
  assert.deepEqual(
    merged.map((row) => [row.label, row.value]),
    [
      ["Ceremony Location", "Chapel of the Pines"],
      ["Reception location", "Willowmere Estate"],
    ],
  );
  assert.deepEqual(contractDetailRows([{ label: "", value: "x" }, { label: "Blank", value: "" }, "junk"]), []);
  // Unticked this time: taken out, not left from the earlier reading.
  assert.deepEqual(
    mergeContractRows(prior, [], ["Reception Location"]).map((row) => row.label),
    ["Ceremony location"],
  );
});

test("a contract finds its job by date and a shared surname, or the studio picks", () => {
  const jobs = [
    { projectId: "a", name: "Nora Vale & Theo Marsh", eventDate: "2027-02-06", clientNames: ["Nora Vale", "Theo Marsh"] },
    { projectId: "b", name: "Ivy Chen & Sam Ortiz", eventDate: "2027-02-06", clientNames: ["Ivy Chen"] },
    { projectId: "c", name: "Ruth Vale", eventDate: "2027-05-01", clientNames: ["Ruth Vale"] },
  ];
  assert.equal(matchContractToJob({ clientNames: ["Theodore Marsh", "Nora Vale"], eventDate: "2027-02-06" }, jobs)?.projectId, "a");
  assert.equal(matchContractToJob({ clientNames: ["Nora Vale"], eventDate: "2027-03-01" }, jobs), null, "another date is another wedding");
  assert.equal(matchContractToJob({ clientNames: [], eventDate: "2027-02-06" }, jobs), null, "no names read, no guess");
  assert.equal(
    matchContractToJob({ clientNames: ["Nora Vale", "Ivy Chen"], eventDate: "2027-02-06" }, jobs),
    null,
    "two jobs that day share a name with it: the studio picks",
  );
});

test("a filled-in form's 'Answered' counts its required questions", () => {
  assert.equal(requiredAnswered(finalSchedule, { "bride-name": "Nora Vale" }), 25);
  assert.equal(requiredAnswered(finalSchedule, { "bride-name": "Nora Vale", "bride-prep": "x", "ceremony-location": "y", "ceremony-start": "15:30" }), 100);
  assert.equal(requiredAnswered([{ fields: [{ id: "a", type: "text" }] }], {}), 0);
});
