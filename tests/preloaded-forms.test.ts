import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { recommendedQuestionnaires } from "@/features/questionnaires/recommended-templates";
import { recommendedQuestionnaires as functionsRecommended } from "../functions/src/planning/recommended-templates.ts";

/**
 * GR ran for weeks with no shot list: the recommended one was a card to copy
 * and a setting to find, and the shot list only rode the automatic planning
 * form (GR, 2026-10-08: "Definitely need a shot list form for the wedding
 * options too"). A new studio now starts with the wedding set switched on.
 */

const read = (path: string) => readFileSync(path, "utf8");

test("the recommended forms the server seeds are the ones the app shows", () => {
  assert.deepEqual(functionsRecommended(), recommendedQuestionnaires());
  const strip = (text: string) => text.replace(/import type \{ SuggestedFrom \} from "\.\/field-extras(\.js)?";/, "");
  assert.equal(
    strip(read("functions/src/planning/recommended-templates.ts")),
    strip(read("features/questionnaires/recommended-templates.ts")),
  );
  assert.deepEqual(
    recommendedQuestionnaires().map((form) => form.id),
    ["wedding-event-details", "wedding-final-schedule", "wedding-shot-list"],
  );
});

test("a new studio starts with the wedding set, switched on", () => {
  const onboarding = read("functions/src/saas/onboarding.ts");
  // A photographer gets all three; another trade only the event details form.
  assert.match(onboarding, /recommendedQuestionnaires\(\)\.filter\(\s*\(form\) => photographer \|\| form\.id === "wedding-event-details",\s*\)/);
  assert.match(onboarding, /for \(const form of recommended\)/);
  assert.match(onboarding, /recommendedId: form\.id,/);
  // The event details form on the inquiry link…
  assert.match(onboarding, /inquiryEventForm: \{\s+templateId: eventDetailsId,/);
  // …the final schedule as the planning form, the shot list with it…
  assert.match(onboarding, /formTemplateId: preloaded\["wedding-final-schedule"\] \?\? preloaded\["wedding-event-details"\] \?\? null,/);
  assert.match(onboarding, /shotListTemplateId: preloaded\["wedding-shot-list"\] \?\? null,/);
  // …and no second, generic wedding questionnaire beside them.
  assert.match(onboarding, /if \(starter\.eventTypeId === "wedding"\) continue;/);
});

test("the planning form sent by hand takes the shot list with it", () => {
  assert.match(read("functions/src/planning/commands.ts"), /await sendShotListWithForm\(db, project, template, now\)/);
  assert.match(read("functions/src/planning/planning-form-scheduler.ts"), /export async function sendShotListWithForm\(/);
});

test("an existing studio adds the shot list in one tap", () => {
  const settings = read("components/planning/planning-timeline-settings.tsx");
  assert.match(settings, /Use StudioCue&rsquo;s shot list/);
  assert.match(settings, /recommendedId: form\.id,/);
  assert.match(settings, /shotListTemplateId: templateId,/);
});
