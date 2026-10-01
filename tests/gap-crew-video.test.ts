import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  itemCrewIds,
  itemIncludesCrew,
  sameItemCrew,
  withCrewIds,
} from "@/features/schedules/item-crew";
import { scheduleCrewOptions } from "@/features/schedules/crew-options";
import { scheduleItemSchema } from "@/features/schedules/schema";
import { detectScheduleIssues } from "@/server/services/schedule-service";
import { manualScheduleItem } from "@/features/planning/manual-run-of-show";
import { directOfferDefaults, offerResponsibilities } from "@/features/crew/direct-offer";
import { mockCrewSchedule } from "@/features/crew/mock-crew";
import {
  buildCrewBrief,
  criticalCrewQuestions,
  videoAwareLabel,
} from "@/features/questionnaires/crew-brief";
import { starterQuestionnaires } from "@/features/questionnaires/starter-templates";
import {
  crewIdAliases,
  normaliseDraftCrew,
  packagesIncludeVideo,
  scheduleCrewFacts,
  scheduleCrewInstruction,
} from "../functions/src/ai/schedule-crew.ts";
import { crewCalendarEventName } from "../functions/src/crew/calendar-ics.ts";

/**
 * A studio that sells photo and video, walked through crew (GR Productions).
 *
 * Run-of-show segments could only hold photographers, the editor could not
 * put anyone on a segment, crew views never said whose segment was whose, and
 * the crew flows opened on photography: "Second photographer" offers, a
 * "Photography event" calendar invite, and a brief asking who "must not be
 * photographed" of a videographer.
 */

const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");

const scheduleItem = (over: Record<string, unknown> = {}) => ({
  id: "speeches",
  startAt: "2026-10-10T22:00:00.000Z",
  endAt: "2026-10-10T22:30:00.000Z",
  title: "Speeches",
  description: "",
  location: "Ballroom",
  address: null,
  travelMinutes: 0,
  participants: [],
  vendorContactIds: [],
  equipment: [],
  notes: null,
  visibility: "shared",
  blockingIssues: [],
  sourceReferences: [],
  ...over,
});

// --- crewIds, with photographerIds still read -------------------------------

test("a segment's crew is crewIds, falling back to the legacy photographerIds", () => {
  assert.deepEqual(itemCrewIds({ crewIds: ["video-1", "photo-1"], photographerIds: ["photo-1"] }), ["video-1", "photo-1"]);
  assert.deepEqual(itemCrewIds({ photographerIds: ["photo-1", "photo-1"] }), ["photo-1"]);
  assert.deepEqual(itemCrewIds({}), []);
  // An empty crewIds is a decision ("nobody"), not a missing field.
  assert.deepEqual(itemCrewIds({ crewIds: [], photographerIds: ["photo-1"] }), []);
});

test("every write carries both fields, so an old reader still sees the crew", () => {
  const written = withCrewIds(scheduleItem({ photographerIds: ["photo-1"] }), ["photo-1", "video-1"]);
  assert.deepEqual(written.crewIds, ["photo-1", "video-1"]);
  assert.deepEqual(written.photographerIds, ["photo-1", "video-1"]);
  // With no list given it normalises what is there.
  assert.deepEqual(withCrewIds({ photographerIds: ["photo-1"] }).crewIds, ["photo-1"]);
});

test("republishing a pre-crewIds version is not a crew change", () => {
  const before = { photographerIds: ["photo-1", "video-1"] };
  const after = withCrewIds({ crewIds: ["video-1", "photo-1"] });
  assert.equal(sameItemCrew(before, after), true, "same people, different field and order");
  assert.equal(sameItemCrew(before, withCrewIds({ crewIds: ["photo-1"] })), false);
});

test("publishing writes both fields and diffs crew through sameItemCrew", () => {
  const commands = read("functions/src/planning/commands.ts");
  assert.match(commands, /\.\.\.withCrewIds\(scheduleItem\)/);
  assert.match(commands, /if \(!sameItemCrew\(priorItem, scheduleItem\)\) changedFields\.push\("crew"\)/);
  // The raw JSON comparison read every legacy item as changed once crewIds
  // existed, which tells crew their day moved when it did not.
  assert.doesNotMatch(commands, /JSON\.stringify\(priorItem\.photographerIds/);
  // A browser on the old bundle still sends only photographerIds.
  assert.match(commands, /crewIds: z\.array\(z\.string\(\)\)\.optional\(\),\n\s+photographerIds: z\.array\(z\.string\(\)\)\.default\(\[\]\)/);
});

test("old and new schedule items both parse", () => {
  const legacy = scheduleItemSchema.parse(scheduleItem({ photographerIds: ["photo-1"] }));
  assert.deepEqual(itemCrewIds(legacy), ["photo-1"]);
  const current = scheduleItemSchema.parse(scheduleItem({ crewIds: ["video-1"] }));
  assert.deepEqual(itemCrewIds(current), ["video-1"]);
  assert.deepEqual(current.photographerIds, []);
});

test("a segment only a videographer is on is staffed", () => {
  const items = [scheduleItemSchema.parse(scheduleItem({ crewIds: ["video-1"] }))];
  assert.deepEqual(detectScheduleIssues(items, 600), []);
  const unstaffed = [scheduleItemSchema.parse(scheduleItem({ crewIds: [] }))];
  assert.deepEqual(detectScheduleIssues(unstaffed, 600), ["Speeches: crew unassigned"]);
});

test("a hand-started segment starts with an empty crew in both fields", () => {
  const item = manualScheduleItem("m1", "2026-10-10T18:00:00.000Z");
  assert.deepEqual(item.crewIds, []);
  assert.deepEqual(item.photographerIds, []);
});

test("the functions copy of item-crew matches features/", () => {
  const body = (path: string) => {
    const source = read(path);
    return source.slice(source.indexOf("export type CrewAssignable"));
  };
  assert.equal(
    body("functions/src/planning/item-crew.ts"),
    body("features/schedules/item-crew.ts"),
  );
});

// --- the editor's picker ------------------------------------------------------

test("the editor offers every booked crew member on the job, with their role", () => {
  const options = scheduleCrewOptions({
    projectId: "job-1",
    assignments: [
      { id: "a1", projectId: "job-1", status: "accepted", crewProfileId: "photo-1", role: "Second photographer" },
      { id: "a2", projectId: "job-1", status: "accepted", crewProfileId: "video-1", role: "Videographer" },
      { id: "a3", projectId: "job-1", status: "invited", crewProfileId: "video-2", role: "Videographer 2" },
      { id: "a4", projectId: "job-2", status: "accepted", crewProfileId: "photo-9", role: "Photographer" },
      { id: "a5", projectId: "job-1", status: "accepted", crewProfileId: "video-1", role: "Videographer" },
    ],
    profiles: [
      { id: "photo-1", name: "Jordan Reyes" },
      { id: "video-1", name: "Marco Silva" },
    ],
  });
  assert.deepEqual(options, [
    { id: "photo-1", name: "Jordan Reyes", role: "Second photographer", trade: "photographer" },
    { id: "video-1", name: "Marco Silva", role: "Videographer", trade: "videographer" },
  ]);
  const editor = read("components/planning/ai-schedule-generator.tsx");
  assert.match(editor, /scheduleCrewOptions\(/);
  assert.match(editor, /className="schedule-item-crew"/);
  // In start order since 2026-10-01 (tests/run-of-show-order.test.ts).
  assert.match(editor, /items: sortScheduleItems\(draft\.items\)\.map\(\(item\) => withCrewIds\(item\)\)/);
});

// --- the AI draft ---------------------------------------------------------------

test("the draft knows when the packages include video", () => {
  assert.equal(
    packagesIncludeVideo([
      { includedCoverage: [{ role: "photographer", count: 2 }] },
      { includedCoverage: [{ role: "videographer", count: 1 }] },
    ]),
    true,
  );
  assert.equal(packagesIncludeVideo([{ includedCoverage: [{ role: "photographer", count: 2 }] }]), false);
  assert.equal(packagesIncludeVideo([]), false);
});

test("crew facts carry each person's trade, and the model's ids resolve to profiles", () => {
  const facts = scheduleCrewFacts([
    { id: "assign-1", data: { status: "accepted", role: "Video lead", crewProfileId: "video-1" } },
    { id: "assign-2", data: { status: "accepted", role: "Second photographer", crewProfileId: "photo-1" } },
    { id: "assign-3", data: { status: "invited", role: "Videographer", crewProfileId: "video-2" } },
  ]);
  assert.deepEqual(
    facts.map((fact) => [fact.crewProfileId, fact.trade]),
    [["video-1", "videographer"], ["photo-1", "photographer"]],
  );
  const aliases = crewIdAliases(facts);
  // Profile id, assignment id, and a guess — the guess never reaches a crew view.
  const drafted = normaliseDraftCrew({ crewIds: ["video-1", "assign-2", "invented"] }, aliases);
  assert.deepEqual(drafted.crewIds, ["video-1", "photo-1"]);
  assert.deepEqual(drafted.photographerIds, ["video-1", "photo-1"]);
  // A reply in the old shape is still read.
  assert.deepEqual(normaliseDraftCrew({ photographerIds: ["photo-1"] }, aliases).crewIds, ["photo-1"]);
});

test("the model is asked for crewIds and told to put videographers on video moments", () => {
  assert.match(scheduleCrewInstruction, /crewIds/);
  assert.match(scheduleCrewInstruction, /videoCoverage/);
  assert.match(scheduleCrewInstruction, /videographer/);
  assert.match(scheduleCrewInstruction, /first look/);
  assert.match(scheduleCrewInstruction, /speeches/);
  const schedule = read("functions/src/ai/schedule.ts");
  assert.match(schedule, /crewIds: \{ type: "ARRAY", items: \{ type: "STRING" \} \}/);
  assert.match(schedule, /"travelMinutes",\n\s+"crewIds",/);
  assert.doesNotMatch(schedule, /photographerIds: \{ type: "ARRAY"/);
  assert.match(schedule, /videoCoverage,\n\s+crewFacts,/);
  assert.match(schedule, /normaliseDraftCrew\(item, crewAliases\)/);
});

// --- crew views -------------------------------------------------------------------

test("a crew member sees the segments they are on, by any id they hold", () => {
  const item = { crewIds: ["video-1"] };
  assert.equal(itemIncludesCrew(item, ["assign-2", "video-1", null]), true);
  assert.equal(itemIncludesCrew(item, ["photo-1", undefined]), false);
  // A seed-era segment named the user.
  assert.equal(itemIncludesCrew({ photographerIds: ["user-7"] }, ["assign-1", "user-7"]), true);
  const sheet = read("components/crew/kit/crew-day-sheet.tsx");
  assert.match(sheet, /itemIncludesCrew\(item, identities\)/);
  assert.match(sheet, /You&rsquo;re on this/);
  // Offline too: the saved copy keeps who is looking.
  assert.match(sheet, /crewIdentities: crewIdentities\(assignment, workspace\.userId\)/);
});

test("mock mode's day sheet marks the demo crew member's segments", () => {
  const items = (mockCrewSchedule(new Date("2026-10-01T12:00:00Z")).items as Array<Record<string, unknown>>);
  const mine = items.filter((item) => itemIncludesCrew(item, ["demo-upcoming"]));
  assert.ok(mine.length > 0 && mine.length < items.length);
});

// --- photo-only wording in crew flows -----------------------------------------------

test("a direct offer opens on the role the job is still short of", () => {
  const coverage = [
    { role: "photographer" as const, count: 1 },
    { role: "videographer" as const, count: 1 },
  ];
  // The studio shoots the photography; the open role is the videographer.
  const video = directOfferDefaults({ coverage, assignments: [], ownerCovers: true });
  assert.equal(video.role, "Videographer");
  assert.doesNotMatch(video.responsibilities, /photographer/i);
  // Once the videographer is booked nothing is open: a word naming no trade.
  const covered = directOfferDefaults({
    coverage,
    assignments: [{ status: "accepted", role: "Videographer" }],
    ownerCovers: true,
  });
  assert.equal(covered.role, "Crew");
  assert.doesNotMatch(covered.responsibilities, /Backup primary photographer/);
  // A typed role keeps its own trade's list.
  assert.match(offerResponsibilities("Second photographer"), /Cocktail-hour candids/);
  assert.match(offerResponsibilities("Video lead"), /Speeches and toasts/);
  const form = read("components/crew/direct-invite-form.tsx");
  assert.doesNotMatch(form, /"Second photographer"/);
  assert.match(form, /directOfferDefaults\(/);
  assert.doesNotMatch(read("components/crew/crew-cascade-workspace.tsx"), /useState\("Second photographer"\)/);
});

test("a crew calendar invite never calls the day a photography event", () => {
  assert.equal(crewCalendarEventName({ name: "Chen wedding" }), "Chen wedding");
  assert.equal(crewCalendarEventName({ name: "", eventType: "wedding" }), "Wedding");
  assert.equal(crewCalendarEventName({ eventTypeLabel: "Corporate event", eventType: "corporate" }), "Corporate event");
  assert.equal(crewCalendarEventName({}), "Wedding");
  assert.doesNotMatch(read("functions/src/operations/provider-runtime.ts"), /"Photography event"/);
});

test("on a job with video the brief asks about filming too", () => {
  const sections = [
    {
      fields: [
        { id: "no-photo-list", label: "Anyone who must not be photographed", type: "long_text" },
        { id: "minors-present", label: "Will anyone under 18 be photographed?", type: "radio" },
        { id: "restrictions", label: "Any photography restrictions at the venue?", type: "long_text" },
      ],
    },
  ];
  const answers = { "no-photo-list": "Uncle Mark", "minors-present": "Yes", restrictions: "No flash in the chapel" };
  const video = buildCrewBrief({ sections, answers, video: true });
  assert.deepEqual(
    video.beforeYouShoot.map((item) => item.label),
    [
      "Anyone who must not be photographed or filmed",
      "Under-18s will be photographed or filmed",
      "Any photography or filming restrictions at the venue?",
    ],
  );
  // Photo-only jobs read the question the couple answered, unchanged.
  const photo = buildCrewBrief({ sections, answers });
  assert.equal(photo.beforeYouShoot[0]?.label, "Anyone who must not be photographed");
  // Already neutral wording is not doubled.
  assert.equal(
    videoAwareLabel("Anyone who must not be photographed or filmed"),
    "Anyone who must not be photographed or filmed",
  );
});

test("the questions offered to studios, and the wedding starter, are worded for both cameras", () => {
  const noPhoto = criticalCrewQuestions.find((question) => question.id === "no-photo-list");
  assert.equal(noPhoto?.label, "Anyone who must not be photographed or filmed");
  for (const question of criticalCrewQuestions)
    assert.equal(videoAwareLabel(question.label), question.label, `${question.id} is still photo-only`);
  const wedding = starterQuestionnaires().find((template) => template.eventTypeId === "wedding");
  const labels = new Map(
    (wedding?.sections ?? []).flatMap((section) => section.fields.map((field) => [field.id, field.label])),
  );
  assert.equal(labels.get("no-photo-list"), "Anyone who must not be photographed or filmed");
  assert.equal(labels.get("restrictions"), "Any photography or filming restrictions at the venue?");
  assert.match(read("functions/src/planning/crew-brief-trigger.ts"), /video: await jobHasVideo\(/);
});
