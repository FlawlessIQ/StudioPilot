import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  starterTemplates,
  weddingCheckpointDefinitions,
} from "@/features/workflows/starter-templates";
import { checkpointTemplateSchema } from "@/features/workflows/schema";

test("a new studio gets one published workflow per event type", () => {
  // autoInstantiateWorkflow resolves by event type, so one each is the
  // correct shape — two for one type would compete.
  const starters = starterTemplates();
  const types = starters.map((template) => template.eventTypeId);
  assert.deepEqual(types.sort(), ["corporate", "sports", "wedding"]);
  assert.equal(new Set(types).size, types.length);
});

test("every starter checkpoint satisfies the engine's schema", () => {
  // These are written into Firestore by the onboarding transaction and read
  // back by autoInstantiateWorkflow, which parses them with this schema and
  // skips the whole workflow on a mismatch — silently, at booking time.
  for (const template of starterTemplates()) {
    for (const checkpoint of template.checkpointTemplates) {
      const parsed = checkpointTemplateSchema.safeParse(checkpoint);
      assert.equal(
        parsed.success,
        true,
        `${template.name} / ${checkpoint.key}: ${parsed.success ? "" : JSON.stringify(parsed.error.issues)}`,
      );
    }
  }
});

test("the wedding starter runs in date order", () => {
  // A rail that jumps backwards in time reads as broken.
  const wedding = starterTemplates().find(
    (template) => template.eventTypeId === "wedding",
  );
  const offsets = (wedding?.checkpointTemplates ?? []).map(
    (checkpoint) => checkpoint.dueDateRule.offsetDays,
  );
  assert.deepEqual(
    offsets,
    [...offsets].sort((left, right) => left - right),
    "a later checkpoint is dated earlier than one before it",
  );
  assert.equal(offsets.length, weddingCheckpointDefinitions.length);
});

test("the narrower starters drop their dependencies", () => {
  // Corporate and sports are filtered subsets of the wedding chain. Keeping
  // the original dependencies would point at checkpoints that no longer
  // exist in that template.
  for (const template of starterTemplates()) {
    if (template.eventTypeId === "wedding") continue;
    const keys = new Set(
      template.checkpointTemplates.map((checkpoint) => checkpoint.key),
    );
    for (const checkpoint of template.checkpointTemplates) {
      for (const dependency of checkpoint.dependencies) {
        assert.ok(
          keys.has(dependency),
          `${template.name} / ${checkpoint.key} depends on missing ${dependency}`,
        );
      }
    }
  }
});

test("client-owned steps are visible to the client", () => {
  // A checkpoint the couple is responsible for, hidden from the couple,
  // is a checkpoint that never completes.
  for (const template of starterTemplates()) {
    for (const checkpoint of template.checkpointTemplates) {
      if (checkpoint.ownerType === "client") {
        assert.equal(checkpoint.visibility, "shared", checkpoint.key);
      }
      if (checkpoint.ownerType === "subcontractor") {
        assert.equal(checkpoint.visibility, "crew", checkpoint.key);
      }
    }
  }
});

test("the functions copy of the starters has not drifted", () => {
  // functions/ cannot import from features/, so onboarding uses a
  // duplicate. A drift means new studios get different workflows from the
  // ones tested here.
  const root = readFileSync(
    "features/workflows/starter-templates.ts",
    "utf8",
  );
  const copy = readFileSync(
    "functions/src/workflow/starter-templates.ts",
    "utf8",
  );
  // Compare the code below the doc comment; the copy's header differs on
  // purpose, to say which file is the source of truth.
  const body = (source: string) =>
    source.slice(source.indexOf("/** key, name, stage"));
  assert.equal(
    body(copy),
    body(root),
    "features/ and functions/ starter templates disagree",
  );
});

test("onboarding actually publishes them", () => {
  // The templates are worthless if the transaction that creates a tenant
  // does not write them, and that wiring is one import away from being
  // dropped by a refactor.
  const onboarding = readFileSync("functions/src/saas/onboarding.ts", "utf8");
  assert.match(onboarding, /starterTemplates\(\)/);
  assert.match(onboarding, /workflowTemplates\/\$\{templateId\}/);
  assert.match(onboarding, /status: "active"/);
});

test("wedding checkpoints are not chained in template order", () => {
  /**
   * The chain that made this necessary.
   *
   * Every wedding checkpoint depended on whichever one preceded it in
   * `weddingCheckpointDefinitions`, all twelve `blocking`, and
   * `resolveCheckpoint` refuses a completion whose dependency is outstanding.
   * So the studio could not confirm the venue until the couple returned their
   * details form, and could not record a second shooter accepting until the
   * final balance was paid a fortnight before the day — four studio-owned
   * judgements queued behind client actions, in the order someone happened to
   * type the array.
   *
   * This asserts the property rather than the current list, so re-introducing
   * adjacency fails here even if the definitions are reordered.
   */
  const wedding = starterTemplates().find(
    (template) => template.eventTypeId === "wedding",
  );
  assert.ok(wedding);
  const order = weddingCheckpointDefinitions.map(([key]) => key);
  for (const checkpoint of wedding.checkpointTemplates) {
    const index = order.indexOf(checkpoint.key);
    const previous = order[index - 1];
    if (!previous) continue;
    assert.ok(
      !checkpoint.dependencies.includes(previous) ||
        checkpoint.key === "crew-acknowledged",
      `${checkpoint.key} depends on its predecessor ${previous}`,
    );
  }
});

test("a studio judgement never waits on a client action", () => {
  const wedding = starterTemplates().find(
    (template) => template.eventTypeId === "wedding",
  );
  assert.ok(wedding);
  const ownerOf = new Map(
    wedding.checkpointTemplates.map((checkpoint) => [
      checkpoint.key,
      checkpoint.ownerType,
    ]),
  );
  for (const checkpoint of wedding.checkpointTemplates) {
    if (checkpoint.ownerType !== "studio") continue;
    for (const dependency of checkpoint.dependencies) {
      assert.notEqual(
        ownerOf.get(dependency),
        "client",
        `${checkpoint.key} (studio) waits on ${dependency} (client)`,
      );
    }
  }
});

test("the one real prerequisite survives, and resolves inside the template", () => {
  // Crew acknowledge a schedule, so there has to be one. And a dependency on
  // a checkpoint the template omits would throw INVALID_CHECKPOINT_DEPENDENCY
  // at instantiation, so every declared key must be present in its own set.
  for (const template of starterTemplates()) {
    const keys = new Set(
      template.checkpointTemplates.map((checkpoint) => checkpoint.key),
    );
    for (const checkpoint of template.checkpointTemplates)
      for (const dependency of checkpoint.dependencies)
        assert.ok(
          keys.has(dependency),
          `${template.eventTypeId}: ${checkpoint.key} depends on absent ${dependency}`,
        );
  }
  const wedding = starterTemplates().find(
    (template) => template.eventTypeId === "wedding",
  );
  assert.deepEqual(
    wedding?.checkpointTemplates.find(
      (checkpoint) => checkpoint.key === "crew-acknowledged",
    )?.dependencies,
    ["schedule-approved"],
  );
});
