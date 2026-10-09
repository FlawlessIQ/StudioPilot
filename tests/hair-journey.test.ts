import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { glossaryFor } from "../features/help/glossary";
import { projectJourney, type JourneyInput } from "../features/journey/steps";
import { recommendedFor } from "../features/questionnaires/recommended-templates";
import {
  EXTENSIONS_ORDER_DAYS_BEFORE,
  extensionTasksFor,
  extensionsOrderTaskId,
  extensionsReturnTaskId,
  extensionsState,
  shiftDay,
} from "../features/trades/extensions";
import { tradeProfile, tradeVocab } from "../features/trades/trades";
import { renderEmailTemplate } from "../functions/src/communications/email-templates";
import { tradeInstruction } from "../functions/src/trades/trade-instruction";

/**
 * Phase 5 of the vendor journeys (docs/vendor-journeys-plan.md): the hair
 * journey — extensions ordered eight weeks out and rentals collected after,
 * the color match from the trial, the veil before the trial, the blow-dry
 * rule, and the bride's hair on the Party list. A makeup artist and a
 * photographer get none of it.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the functions copy of the extensions plan matches features/", () => {
  const body = (source: string) => source.slice(source.indexOf("// ── mirrored below ──"));
  assert.equal(body(read("functions/src/trades/extensions.ts")), body(read("features/trades/extensions.ts")));
});

test("extensions to buy are ordered eight weeks out; a rental is also collected after", () => {
  const base = { projectId: "p1", eventDate: "2027-06-12", colorMatch: "#6/8 balayage", clientName: "Maya Brooks Wedding", today: "2027-01-10" };
  const buy = extensionTasksFor({ ...base, plan: "buy" });
  assert.deepEqual(buy.map((task) => [task.id, task.dueDate]), [[extensionsOrderTaskId("p1"), "2027-04-17"]]);
  assert.equal(shiftDay("2027-06-12", -EXTENSIONS_ORDER_DAYS_BEFORE), "2027-04-17");
  assert.equal(buy[0]!.title, "Order extensions — Maya Brooks Wedding");
  assert.match(buy[0]!.description, /Color match: #6\/8 balayage\./);
  const rent = extensionTasksFor({ ...base, plan: "rent" });
  assert.deepEqual(rent.map((task) => [task.id, task.dueDate]), [
    [extensionsOrderTaskId("p1"), "2027-04-17"],
    [extensionsReturnTaskId("p1"), "2027-06-16"],
  ]);
  assert.equal(rent[0]!.title, "Book the rental extensions — Maya Brooks Wedding");
  // Booked late: the order is due today, not in the past.
  assert.equal(extensionTasksFor({ ...base, plan: "buy", today: "2027-05-20" })[0]!.dueDate, "2027-05-20");
  // Their own, none, or not decided: nothing to order.
  for (const plan of ["own", "none", null, "anything"]) assert.deepEqual(extensionTasksFor({ ...base, plan }), [], String(plan));
  assert.match(extensionTasksFor({ ...base, colorMatch: null, plan: "buy" })[0]!.description, /No color match noted yet/);
});

const ready: JourneyInput = {
  projectId: "p1",
  state: "PLANNING",
  eventDate: "2027-06-12",
  today: "2027-04-20",
  lead: null,
  hasConsultation: true,
  proposalStatus: "accepted",
  contractStatus: "completed",
  retainerInvoiceStatus: "paid",
  finalInvoiceStatus: null,
  questionnaireStatus: "submitted",
  questionnaireHasAnswers: true,
  scheduleStatus: "approved",
  scheduleHasUsableItems: true,
  crewAccepted: 0,
  crewRequired: 0,
  crewCascadeActive: false,
  coiStatus: null,
  insuranceRequired: "not_required",
  dayBeforeDraftStatus: null,
  hasDelivery: false,
  albumOrReviewDone: false,
};

test("the journey's Extensions ordered step reads the order task", () => {
  const notes = { extensions: "rent", colorMatch: "#6/8 balayage" };
  const open = extensionsState({ projectId: "p1", trialNotes: notes, eventDate: "2027-06-12", tasks: [{ id: extensionsOrderTaskId("p1"), status: "not_started" }] });
  assert.deepEqual(open, { plan: "rent", colorMatch: "#6/8 balayage", ordered: false, orderBy: "2027-04-17" });
  const step = projectJourney({ ...ready, trade: "hair", extensions: open }).steps.find((candidate) => candidate.key === "extensions");
  assert.equal(step?.title, "Extensions ordered");
  assert.equal(step?.status, "current");
  assert.equal(step?.detail, "Rental, #6/8 balayage — order by 2027-04-17");
  assert.equal(step?.action?.label, "Open the task");
  assert.equal(step?.action?.kind === "link" ? step.action.href : null, "/studio/tasks?project=p1");
  // Before eight weeks out it waits, with no button.
  const early = projectJourney({ ...ready, trade: "hair", today: "2027-03-01", extensions: open }).steps.find((candidate) => candidate.key === "extensions");
  assert.equal(early?.status, "upcoming");
  assert.equal(early?.action ?? null, null);
  // Ordered once the task is done.
  const done = extensionsState({ projectId: "p1", trialNotes: notes, eventDate: "2027-06-12", tasks: [{ id: extensionsOrderTaskId("p1"), status: "completed" }] });
  assert.equal(projectJourney({ ...ready, trade: "hair", extensions: done }).steps.find((candidate) => candidate.key === "extensions")?.status, "complete");
  // Their own extensions, or none: no step.
  assert.equal(extensionsState({ projectId: "p1", trialNotes: { extensions: "own" }, eventDate: "2027-06-12", tasks: [] }), null);
  assert.ok(!projectJourney({ ...ready, trade: "hair" }).steps.some((candidate) => candidate.key === "extensions"));
  // Only a hair studio's journey asks for it.
  assert.equal(tradeProfile("hair").extensions, true);
  for (const trade of ["makeup", "dj", "photographer"]) assert.equal(tradeProfile(trade).extensions, false, trade);
  assert.match(read("components/projects/use-project-journey.ts"), /extensions: tradeProfile\(tenantTrade\)\.extensions\s*\? extensionsState\(/);
});

test("the trial notes save the plan and color match, and keep exactly two tasks", () => {
  const source = read("functions/src/crew/commands.ts");
  assert.match(source, /extensions: z\.enum\(EXTENSION_PLANS\)\.nullable\(\)\.default\(null\),/);
  // Fixed ids, so saving again moves the tasks rather than adding more.
  assert.match(source, /const taskIds = \[extensionsOrderTaskId\(parsed\.input\.projectId\), extensionsReturnTaskId\(parsed\.input\.projectId\)\];/);
  assert.match(source, /source: "trial_extensions",/);
  // A plan changed to none cancels an open task; a done order stays done.
  assert.match(source, /batch\.update\(snapshot\.ref, \{ status: "cancelled", cancelledAt: now/);
  assert.match(source, /\} else if \(task && status !== "complete" && status !== "completed"\) \{/);
  // The crew's brief says what extensions, in what color.
  assert.match(source, /fieldId: "trial-extensions", label: "Extensions", text: extensionLine/);
  // The card asks only a hair stylist.
  assert.match(read("components/projects/live-project-detail.tsx"), /extensions=\{tradeProfile\(workspace\.tenantTrade\)\.extensions\}/);
  assert.match(read("components/crew/trial-notes.tsx"), /\.\.\.\(extensions \? \{ extensions: plan \|\| null, colorMatch \} : \{\}\)/);
});

test("a hair trial waits for the veil, on the journey, the card and the invitation", () => {
  assert.match(tradeVocab("hair").trialHint ?? "", /once the veil is chosen/);
  assert.equal(tradeVocab("makeup").trialHint, null);
  const hair = projectJourney({ ...ready, trade: "hair", trial: { state: "not_booked", startsAt: null } });
  assert.match(String(hair.steps.find((step) => step.key === "trial")?.detail), /veil is chosen/);
  const makeup = projectJourney({ ...ready, trade: "makeup", trial: { state: "not_booked", startsAt: null } });
  assert.match(String(makeup.steps.find((step) => step.key === "trial")?.detail), /whenever suits/);
  assert.match(read("components/projects/live-project-detail.tsx"), /className="trial-hint"/);
  const brand = { studioName: "Jess Styles Bridal", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: null };
  const invite = (trade: string) =>
    renderEmailTemplate({ key: "consultation_invitation", brand, values: { trade, purpose: "trial", actionUrl: "https://studio-cue.com/x" } }).text;
  assert.match(invite("hair"), /If you haven't chosen your veil yet, book once you have/);
  assert.doesNotMatch(invite("makeup"), /chosen your veil/);
});

test("the hair prep guide asks for clean, dry hair or a blow-dry fee", () => {
  const brand = { studioName: "Jess Styles Bridal", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: null };
  const guide = renderEmailTemplate({
    key: "event_reminder",
    brand,
    recipientName: "Maya",
    values: { trade: "hair", eventKind: "wedding", eventDate: "2027-06-12", portalUrl: "https://studio-cue.com/client" },
  }).text;
  assert.match(guide, /completely dry hair — washed the night before, with no oils or products — or there's a blow-dry fee/);
  assert.match(guide, /veil and hair accessories/);
});

test("the hair Party list asks about length, texture, style, extensions and the veil; makeup's doesn't", () => {
  const hair = recommendedFor("hair").find((form) => form.id === "hair-party-list")!;
  const section = hair.sections.find((candidate) => candidate.id === "your-hair");
  assert.deepEqual(section?.fields.map((field) => field.id), ["hair-length", "hair-texture", "hair-style", "extensions", "veil", "accessories"]);
  assert.ok(section!.fields.find((field) => field.id === "extensions")!.options.includes("I'd like to rent them"));
  const makeup = recommendedFor("makeup").find((form) => form.id === "makeup-party-list")!;
  assert.ok(!makeup.sections.some((candidate) => candidate.id === "your-hair"));
  // The morning and the party, which the chair schedule reads, stay first.
  assert.deepEqual(hair.sections.map((candidate) => candidate.id), ["the-morning", "your-party", "your-hair", "good-to-know"]);
});

test("help and Cue know about extensions, for a hair studio only", () => {
  assert.ok(glossaryFor("studio", "hair").some((term) => term.id === "extensions-ordered"));
  assert.ok(!glossaryFor("studio", "makeup").some((term) => term.id === "extensions-ordered"));
  assert.match(tradeInstruction("hair"), /ordered about eight weeks before the day/);
  assert.doesNotMatch(tradeInstruction("makeup"), /extensions/i);
});
