import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { eventDetailCategory, eventDetailsBlocks, eventDetailsFrom } from "@/features/contracts/event-details";
import { resolveContractDocument, contractMergeFields } from "@/features/contracts/document";
import { sampleContractSources } from "@/features/contracts/sample";

/**
 * Schedule A — the wedding details in every agreement, so a couple can't keep
 * changing them (GR Productions, 2026-10-02). At booking: getting ready,
 * ceremony, reception and the general times.
 */

const read = (path: string) => readFileSync(path, "utf8");

test("the functions copy of event-details is identical", () => {
  const strip = (source: string) => source.replace(/\n \* Pure\.[\s\S]*?drift\.\n/, "\n");
  assert.equal(strip(read("functions/src/contracts/event-details.ts")), strip(read("features/contracts/event-details.ts")));
});

test("each question sorted into its part of the day — Gabe's own wording and the starter form's", () => {
  const cases: Array<[string, string | null]> = [
    ["Bride Getting Ready Address", "getting_ready"],
    ["Groom Getting Ready Addres", "getting_ready"],
    ["Where are you getting ready?", "getting_ready"],
    ["Ceremony Location", "ceremony"],
    ["Ceremony address", "ceremony"],
    ["Reception Location:", "reception"],
    ["Reception address", "reception"],
    ["Ceremony Times", "times"],
    ["Reception Times", "times"],
    ["Photo/Video Start and End Time", "times"],
    ["Ceremony start time", "times"],
    ["When does coverage end?", "times"],
    ["Photo locations on the way to the hotel", "photo_locations"],
    ["# of Invited Guests", "guests"],
    ["Planner or coordinator Name and Number", "contacts"],
    ["Event Date", null],
    ["Any photography restrictions at the venue?", null],
    ["Bride Name", null],
  ];
  for (const [question, expected] of cases) assert.equal(eventDetailCategory(question), expected, question);
});

test("the schedule: records first, then the couple's answers by part; what's missing says so", () => {
  const details = eventDetailsFrom({
    eventType: "Wedding",
    date: "June 12, 2027",
    venue: "Harbor View Estate",
    coverage: "2 photographers, 8 hours",
    answers: [
      { question: "Bride Getting Ready Address", answer: "The Lodge, 14 Mill Lane" },
      { question: "Groom Getting Ready Address", answer: "Hotel Mira" },
      { question: "Ceremony Location", answer: "St Mary's Church" },
      { question: "Ceremony Times", answer: "3:00 PM" },
      { question: "# of Invited Guests", answer: "140" },
      { question: "Bride Name", answer: "Avery" },
    ],
  });
  assert.equal(details.title, "Wedding details");
  assert.deepEqual(details.rows, [
    { label: "Date", value: "June 12, 2027" },
    { label: "Coverage", value: "2 photographers, 8 hours" },
    { label: "Bride Getting Ready Address", value: "The Lodge, 14 Mill Lane" },
    { label: "Groom Getting Ready Address", value: "Hotel Mira" },
    { label: "Ceremony", value: "St Mary's Church" },
    { label: "Reception", value: "To be confirmed" },
    { label: "Times", value: "3:00 PM" },
    { label: "Guests", value: "140" },
  ]);
  assert.deepEqual(details.missing, ["Reception"]);
  // One venue for the day: the ceremony is there.
  const single = eventDetailsFrom({ eventType: "Wedding", date: null, venue: "The Barn", coverage: null, answers: [] });
  assert.deepEqual(single.rows.find((row) => row.label === "Ceremony"), { label: "Ceremony", value: "The Barn" });
  assert.deepEqual(single.missing, ["Getting ready", "Reception", "Times"]);
  // Not a wedding: nothing is demanded of it.
  assert.deepEqual(eventDetailsFrom({ eventType: "Corporate", date: null, venue: null, coverage: null, answers: [] }).missing, []);
});

test("every agreement carries it at the end, or where the template places it", () => {
  const sources = sampleContractSources("Alder & Muse", "2026-10-02");
  const template = { title: "Agreement", body: "# Agreement\n\nThe fee is {{price.total}}.\n\n## Terms\n\nBe on time.", customFields: [] };
  const atEnd = resolveContractDocument({ template, sources, overrides: {} });
  const headings = atEnd.document.blocks.filter((block) => block.type === "heading").map((block) => (block as { content: Array<{ text: string }> }).content[0]!.text);
  assert.equal(headings.at(-1), "Schedule A — Wedding details");
  assert.ok(!atEnd.unresolved.includes("event.details"), "the schedule never blocks sending");

  const placed = resolveContractDocument({ template: { ...template, body: "# Agreement\n\n{{event.details}}\n\n## Terms\n\nBe on time." }, sources, overrides: {} });
  const order = placed.document.blocks.map((block) => (block.type === "heading" ? (block as { content: Array<{ text: string }> }).content[0]!.text : block.type));
  assert.deepEqual(order.slice(0, 3), ["Agreement", "Schedule A — Wedding details", "paragraph"]);
  assert.equal(order.filter((entry) => entry === "Schedule A — Wedding details").length, 1, "once, not twice");
  assert.ok(contractMergeFields.some((field) => field.key === "event.details"));

  // Written mid-sentence: one line.
  const inline = resolveContractDocument({ template: { ...template, body: "Details: {{event.details}}" }, sources, overrides: {} });
  assert.match(JSON.stringify(inline.document), /Ceremony: St Mary's Church/);

  // An agreement resolved with no schedule (older callers) is unchanged.
  const none = resolveContractDocument({ template, sources: { ...sources, eventDetails: null }, overrides: {} });
  assert.ok(!JSON.stringify(none.document).includes("Schedule A"));
});

test("the schedule's words: what it means, then the details", () => {
  const blocks = eventDetailsBlocks({ title: "Wedding details", rows: [{ label: "Reception", value: "To be confirmed" }], missing: ["Reception"] });
  assert.equal(blocks.length, 3);
  assert.match(JSON.stringify(blocks[1]), /form part of this agreement[\s\S]*four weeks before/);
  assert.deepEqual(eventDetailsBlocks({ title: "Wedding details", rows: [], missing: [] }), []);
});

test("wired: sources fill it, drafts carry what's missing, the studio is told before sending", () => {
  assert.match(read("functions/src/contracts/sources.ts"), /eventDetails = eventDetailsFrom\(/);
  assert.match(read("functions/src/contracts/commands.ts"), /detailsMissing: loaded\.sources\.eventDetails\?\.missing/);
  assert.match(read("components/contracts/native-contract-step.tsx"), /Wedding details not given yet/);
});
