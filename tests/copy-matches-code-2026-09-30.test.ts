import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Screens whose words said one thing while the code did another, found while
 * writing the how-to guides (2026-09-30). Each check pins the words to the
 * behaviour they describe.
 */
const read = (file: string) => readFileSync(file, "utf8");

test("the Delivery header names the one step that gates a release", () => {
  const checklist = read("features/post-production/checklist.ts");
  assert.match(checklist, /DELIVERY_GATE_STEPS: readonly PostProductionStepKey\[\] = \["backup_complete"\]/);
  const page = read("app/studio/delivery/page.tsx");
  assert.doesNotMatch(page, /editing is finished and the gallery is ready\./);
  assert.match(page, /The one\s+step StudioCue requires/);
});

test("a hidden package is described by what hiding it does", () => {
  const form = read("components/crm/edit-package-form.tsx");
  assert.doesNotMatch(form, /stays out of quotes/);
  assert.match(form, /You can still put it in a\s+proposal yourself/);
});

test("AI usage says when it actually resets", () => {
  assert.match(read("functions/src/saas/usage.ts"), /const period=now\.slice\(0,7\)/);
  const page = read("components/saas/live-subscription.tsx");
  assert.doesNotMatch(page, /Resets each billing month/);
  assert.match(page, /Resets on the 1st of each month/);
});

test("setup says 'set up' only when every question is answered", () => {
  const setup = read("components/setup/setup-conversation.tsx");
  assert.match(setup, /const allAnswered = !loading && gaps\.length === 0;/);
  assert.match(setup, /allAnswered\s*\?\s*"Your studio is set up\."/);
  assert.match(read("components/settings/settings-shell.tsx"), /Inquiries, hours, packages, agreement, details form and insurance/);
});

test("a direct crew offer asks for what the studio's crew settings ask for", () => {
  const form = read("components/crew/direct-invite-form.tsx");
  assert.doesNotMatch(form, /name: "Liability insurance"/);
  assert.match(form, /requirements: crewRequirementsFor\(crewSettings\)/);
});

test("a published run of show isn't called approved", () => {
  const steps = read("features/journey/steps.ts");
  // Approved only once the couple said so (scheduleApprovalState, 2026-10-01).
  assert.match(steps, /scheduleApprovedByCouple\s*\?\s*`Approved by \$\{who\}`\s*:\s*`Shared with your crew and \$\{who\}`/);
  assert.match(steps, /input\.scheduleApprovalState === "client_approved"/);
});

test("editing a questionnaire keeps its Show-after conditions", () => {
  const editor = read("components/planning/questionnaire-template-editor.tsx");
  assert.doesNotMatch(editor, /conditionalOn: null,\n\s*\}\)\),/);
  // A condition is kept, and cleared only when the question it reads is gone
  // or below it (features/questionnaires/template-rules.ts).
  assert.match(editor, /conditionalOn: field\.conditionalOn \?\? null/);
  assert.match(editor, /repairTemplateLinks<EditableField, EditableSection>\(kept\)/);
  assert.match(read("components/planning/questionnaire-builder.tsx"), /conditionalOn: conditionOf\(f\.conditionalOn\)/);
});

test("Help & guides lights its own menu item", () => {
  assert.match(read("components/layout/app-shell.tsx"), /"Help & guides": \["Help & guides"\]/);
});
