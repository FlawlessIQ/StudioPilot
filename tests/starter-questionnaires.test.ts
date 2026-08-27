import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { starterQuestionnaires } from "@/features/questionnaires/starter-templates";
import { questionnaireTemplateSchema } from "@/features/questionnaires/schema";
import { starterTemplates } from "@/features/workflows/starter-templates";

/**
 * A new tenant had no questionnaire at all, so "Questionnaire complete" — a
 * blocking readiness checkpoint on the starter wedding workflow — could only
 * ever be waived.
 */

test("one questionnaire per event type the workflows cover", () => {
  // `assignQuestionnaire` and `autoInstantiateWorkflow` both resolve by event
  // type, so a workflow for an event type with no questionnaire is the gap
  // this closes.
  const questionnaireTypes = starterQuestionnaires().map((q) => q.eventTypeId);
  for (const workflow of starterTemplates()) {
    assert.ok(
      questionnaireTypes.includes(workflow.eventTypeId),
      `${workflow.eventTypeId} has a starter workflow but no starter questionnaire`,
    );
  }
  assert.equal(new Set(questionnaireTypes).size, questionnaireTypes.length);
});

test("every starter template satisfies the stored schema", () => {
  // The seed once wrote six section *names* against a schema wanting
  // `{id, title, fields[]}`, and the library rendered it as "0 fields · draft".
  const now = new Date().toISOString();
  for (const starter of starterQuestionnaires()) {
    const parsed = questionnaireTemplateSchema.safeParse({
      id: "t1",
      tenantId: "tenant-1",
      name: starter.name,
      eventTypeId: starter.eventTypeId,
      version: 1,
      status: "active",
      sections: starter.sections,
      dueDaysBeforeEvent: starter.dueDaysBeforeEvent,
      reminderDaysBeforeDue: starter.reminderDaysBeforeDue,
      createdAt: now,
      updatedAt: now,
      createdBy: "u1",
      updatedBy: "u1",
      archivedAt: null,
    });
    assert.ok(
      parsed.success,
      `${starter.name}: ${JSON.stringify(parsed.error?.issues?.[0])}`,
    );
  }
});

test("each questionnaire actually asks something, with unique field ids", () => {
  for (const starter of starterQuestionnaires()) {
    const fields = starter.sections.flatMap((s) => s.fields);
    assert.ok(fields.length >= 10, `${starter.name} has only ${fields.length}`);
    assert.ok(
      fields.some((f) => f.required),
      `${starter.name} asks nothing required`,
    );
    const ids = fields.map((f) => f.id);
    assert.equal(
      new Set(ids).size,
      ids.length,
      `${starter.name} repeats a field id, which would collide in answers`,
    );
    // Choice fields must offer choices, or the couple sees an empty dropdown.
    for (const f of fields) {
      if (["dropdown", "radio", "multi_select"].includes(f.type)) {
        assert.ok(f.options.length > 1, `${starter.name}/${f.id} has no options`);
      }
    }
  }
});

test("the ones about people ask about consent", () => {
  // Corporate and sports photograph people who did not hire the studio.
  for (const id of ["corporate", "sports"]) {
    const starter = starterQuestionnaires().find((q) => q.eventTypeId === id);
    const fields = starter?.sections.flatMap((s) => s.fields) ?? [];
    assert.ok(
      fields.some((f) => /consent/i.test(f.id) && f.required),
      `${id} must ask about consent`,
    );
  }
});

test("the functions copy has not drifted", () => {
  const strip = (source: string) =>
    source.replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim();
  assert.equal(
    strip(readFileSync("features/questionnaires/starter-templates.ts", "utf8")),
    strip(
      readFileSync("functions/src/planning/starter-questionnaires.ts", "utf8"),
    ),
  );
});
