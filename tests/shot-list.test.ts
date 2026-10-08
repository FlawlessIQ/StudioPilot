import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildCrewBrief } from "@/features/questionnaires/crew-brief";
import { recommendedQuestionnaires } from "@/features/questionnaires/recommended-templates";
import { resolvePlanningTimeline } from "@/features/planning/planning-timeline";
import { buildCrewBrief as functionsBuildCrewBrief } from "../functions/src/planning/crew-brief";
import { resolvePlanningTimeline as functionsResolvePlanningTimeline } from "../functions/src/planning/planning-timeline";

/**
 * GR Productions (2026-10-05): the shot list ("must take photos") is its own
 * form, due four weeks out, and the crew must have it. Built 2026-10-06 ahead
 * of Gabe's sample.
 */

const read = (path: string) => readFileSync(path, "utf8");
const shotList = recommendedQuestionnaires().find((form) => form.id === "wedding-shot-list")!;

test("a recommended Shot list, due a week before the day", () => {
  // Gabe (GR, 2026-10-08): "Shot-list should be due one week prior."
  assert.equal(shotList.name, "Shot list");
  assert.equal(shotList.dueDaysBeforeEvent, 7);
  assert.deepEqual(shotList.reminderDaysBeforeDue, [14, 3]);
  const ids = shotList.sections.flatMap((section) => section.fields.map((field) => field.id));
  assert.deepEqual(ids, ["must-have-groups", "must-have-shots", "people-to-capture", "details-to-capture", "no-photo-list", "sensitivities"]);
});

test("every answer reaches the crew's day sheet, and anyone to avoid comes first", () => {
  const answers = {
    "must-have-groups": "Us with both sets of parents\nGrandparents",
    "must-have-shots": "Dad seeing the dress",
    "people-to-capture": "Grandma Rose, blue dress, front row",
    "details-to-capture": "Grandmother's ring",
    "no-photo-list": "Uncle Jim",
    sensitivities: "Parents are separated",
  };
  for (const build of [buildCrewBrief, functionsBuildCrewBrief]) {
    const brief = build({ sections: shotList.sections, answers, video: false });
    assert.deepEqual(brief.beforeYouShoot.map((item) => item.fieldId).sort(), ["no-photo-list", "sensitivities"]);
    assert.deepEqual(
      brief.onTheDay.map((item) => item.fieldId).sort(),
      ["details-to-capture", "must-have-groups", "must-have-shots", "people-to-capture"],
    );
  }
});

test("the planning timeline carries the studio's shot list, off by default", () => {
  for (const resolve of [resolvePlanningTimeline, functionsResolvePlanningTimeline]) {
    assert.equal(resolve(undefined).shotListTemplateId, null);
    assert.equal(resolve({ shotListTemplateId: " t9 " }).shotListTemplateId, "t9");
    assert.equal(resolve({ shotListTemplateId: "" }).shotListTemplateId, null);
  }
});

test("it goes out with the planning form, once, and never after the lock", () => {
  const scheduler = read("functions/src/planning/planning-form-scheduler.ts");
  assert.match(scheduler, /if \(outcome !== "not_due"\) await sendShotList\(db, project, studio, today, now\);/);
  assert.match(scheduler, /if \(detailsLocked\(text\(data\.eventDate\)\.slice\(0, 10\), today, studio\.timeline\)\) return;/);
  assert.match(scheduler, /idempotencyKey: `shot_list_\$\{project\.id\}_\$\{template\.id\}`/);
  assert.match(scheduler, /jobKindOf\(data\) !== "wedding"/);
  const commands = read("functions/src/planning/commands.ts");
  assert.match(commands, /shotListTemplateId: z\.string\(\)\.min\(1\)\.max\(200\)\.nullable\(\)\.optional\(\)/);
  assert.match(commands, /for \(const templateId of \[parsed\.input\.formTemplateId, parsed\.input\.shotListTemplateId\]\)/);
  assert.match(read("components/planning/planning-timeline-settings.tsx"), /shotListTemplateId: effectiveShotList/);
});

test("booked inside the planning window, the shot list goes at booking with the form", () => {
  const scheduler = read("functions/src/planning/planning-form-scheduler.ts");
  const atBooking = scheduler.slice(scheduler.indexOf("export async function sendPlanningFormAtBooking"));
  assert.match(atBooking, /if \(planningFormDue\(data, studio\.timeline, today\)\) await sendShotList\(db, project, studio, today, now\);/);
  assert.match(atBooking, /return withShotList\("sent"\);/);
});

test("the shot list the scheduler sends is due a week before, whatever the studio's copy says", () => {
  const scheduler = read("functions/src/planning/planning-form-scheduler.ts");
  assert.match(scheduler, /export const SHOT_LIST_DUE_DAYS_BEFORE = 7;/);
  assert.match(scheduler, /dueDaysBeforeEvent: SHOT_LIST_DUE_DAYS_BEFORE,/);
  assert.match(
    read("functions/src/planning/send-questionnaire.ts"),
    /dueDaysBeforeEvent: input\.dueDaysBeforeEvent \?\? template\.get\("dueDaysBeforeEvent"\)/,
  );
});
