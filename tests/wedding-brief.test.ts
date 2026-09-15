import assert from "node:assert/strict";
import { test } from "node:test";
import type { JourneyStep } from "@/features/journey/steps";
import {
  answerText,
  briefFacts,
  briefStatus,
  snapshotFields,
} from "@/features/planning/wedding-brief";

const step = (partial: Partial<JourneyStep> & Pick<JourneyStep, "key" | "status">): JourneyStep => ({
  title: partial.key,
  detail: "",
  action: null,
  record: null,
  owner: null,
  unlock: null,
  advance: null,
  explain: false,
  ...partial,
});

test("the brief splits planning into what needs the studio and what is out with others", () => {
  const status = briefStatus([
    step({ key: "proposal", status: "complete" }),
    step({ key: "schedule_form", status: "complete" }),
    step({
      key: "run_of_show",
      status: "current",
      title: "Run of show published",
      action: { kind: "link", label: "Draft the run of show", href: "/studio/schedules/new?project=p1" },
    }),
    step({ key: "coi", status: "waiting_other", title: "Insurance certificate", record: { label: "Open", href: "/studio/insurance?project=p1" } }),
    step({ key: "crew", status: "upcoming" }),
  ]);
  assert.equal(status.needsYou.length, 1);
  assert.equal(status.needsYou[0]?.title, "Draft the run of show");
  assert.equal(status.needsYou[0]?.href, "/studio/schedules/new?project=p1");
  assert.equal(status.waiting[0]?.key, "coi");
  assert.equal(status.done, 1);
  // Only planning steps count — the proposal is not part of the brief.
  assert.equal(status.total, 4);
});

test("answers read as lines a photographer can scan", () => {
  assert.equal(answerText(["Grandma Rose", "Uncle Ben"]), "Grandma Rose, Uncle Ben");
  assert.equal(answerText({ name: "Maya", relationship: "Planner", phone: "555" }), "Maya (Planner, 555)");
  assert.equal(answerText(true), "Yes");
  assert.equal(answerText(""), "");
});

test("the couple's answers are grouped, and internal notes stay out", () => {
  const fields = snapshotFields({
    sections: [
      {
        fields: [
          { id: "family", label: "Family formal groupings", type: "long_text" },
          { id: "planner", label: "Planner contact", type: "contact" },
          { id: "ceremony", label: "Ceremony start time", type: "time" },
          { id: "studio_note", label: "Studio note", type: "text", internalOnly: true },
          { id: "info", label: "Please read", type: "information" },
        ],
      },
    ],
  });
  const facts = briefFacts({
    responseId: "r1",
    fields,
    answers: {
      family: "Couple + both sets of parents",
      planner: { name: "Maya", phone: "555" },
      ceremony: "16:30",
      studio_note: "VIP client",
      info: "x",
    },
  });
  assert.equal(facts.family_formals[0]?.value, "Couple + both sets of parents");
  assert.equal(facts.vendors[0]?.value, "Maya (555)");
  assert.equal(facts.schedule[0]?.value, "16:30");
  const everything = Object.values(facts).flat().map((fact) => fact.value);
  assert.ok(!everything.includes("VIP client"));
  assert.ok(!everything.includes("x"));
});
