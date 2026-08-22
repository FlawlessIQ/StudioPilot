import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  describePublishEffect,
  publishEffect,
  type PublishableTemplate,
} from "@/features/workflows/publication";

const template = (
  name: string,
  eventTypeId: string,
  status: string,
  version = 1,
): PublishableTemplate => ({ id: `${name}-v${version}`, name, eventTypeId, status, version });

test("the first template for an event type displaces nothing", () => {
  const effect = publishEffect({
    name: "Wedding Photography",
    eventTypeId: "wedding",
    status: "active",
    existing: [],
  });
  assert.equal(effect.version, 1);
  assert.deepEqual(effect.superseding, []);
  assert.equal(describePublishEffect(effect, "Wedding"), null);
});

test("republishing the same name is the next version and retires the last", () => {
  // This is what "edit a workflow" actually is.
  const effect = publishEffect({
    name: "Wedding Photography",
    eventTypeId: "wedding",
    status: "active",
    existing: [
      template("Wedding Photography", "wedding", "superseded", 1),
      template("Wedding Photography", "wedding", "active", 2),
    ],
  });
  assert.equal(effect.version, 3);
  assert.deepEqual(
    effect.superseding.map((entry) => entry.id),
    ["Wedding Photography-v2"],
  );
  assert.equal(effect.isNewVersionOf?.version, 2);
});

test("a differently-named template for the same event type is also retired", () => {
  // The reported hazard: supersession was scoped by name, selection by
  // event type, so both stayed active and the winner was arbitrary.
  const effect = publishEffect({
    name: "Elopement coverage",
    eventTypeId: "wedding",
    status: "active",
    existing: [template("Wedding Photography", "wedding", "active", 1)],
  });
  assert.deepEqual(
    effect.superseding.map((entry) => entry.name),
    ["Wedding Photography"],
  );
  // A new name starts its own history rather than inheriting a version.
  assert.equal(effect.version, 1);
  assert.equal(effect.isNewVersionOf, null);
  assert.match(
    describePublishEffect(effect, "Wedding") ?? "",
    /replaces “Wedding Photography” as the workflow for new wedding jobs/,
  );
});

test("other event types are untouched", () => {
  const effect = publishEffect({
    name: "Wedding Photography",
    eventTypeId: "wedding",
    status: "active",
    existing: [
      template("Corporate Photography", "corporate", "active", 1),
      template("Sports Photography", "sports", "active", 1),
    ],
  });
  assert.deepEqual(effect.superseding, []);
});

test("a draft supersedes nothing — it does not run, so it displaces nothing", () => {
  const effect = publishEffect({
    name: "Wedding Photography",
    eventTypeId: "wedding",
    status: "draft",
    existing: [template("Wedding Photography", "wedding", "active", 1)],
  });
  assert.deepEqual(effect.superseding, []);
  // It still takes the next version number, so publishing it later is v2.
  assert.equal(effect.version, 2);
});

test("already-superseded versions are not superseded again", () => {
  const effect = publishEffect({
    name: "Wedding Photography",
    eventTypeId: "wedding",
    status: "active",
    existing: [
      template("Wedding Photography", "wedding", "superseded", 1),
      template("Wedding Photography", "wedding", "superseded", 2),
      template("Wedding Photography", "wedding", "active", 3),
    ],
  });
  assert.equal(effect.superseding.length, 1);
  assert.equal(effect.version, 4);
});

test("naming is case- and whitespace-insensitive", () => {
  // Otherwise "Wedding Photography " starts a rival v1 that competes with
  // the real one — the exact hazard, reintroduced by a stray space.
  const effect = publishEffect({
    name: "  wedding photography  ",
    eventTypeId: "WEDDING",
    status: "active",
    existing: [template("Wedding Photography", "wedding", "active", 2)],
  });
  assert.equal(effect.version, 3);
  assert.equal(effect.superseding.length, 1);
});

test("two retired templates are listed readably", () => {
  const effect = publishEffect({
    name: "One workflow",
    eventTypeId: "wedding",
    status: "active",
    existing: [
      template("Wedding Photography", "wedding", "active", 1),
      template("Elopement coverage", "wedding", "active", 1),
    ],
  });
  assert.match(
    describePublishEffect(effect, "Wedding") ?? "",
    /“Wedding Photography” and “Elopement coverage”/,
  );
});

test("the command supersedes on the same two keys this module does", () => {
  // The rule that matters runs inside the Firestore transaction; this
  // module only lets the form promise the same thing. If the command stops
  // querying by eventTypeId, the form starts lying.
  const command = readFileSync("functions/src/workflow/commands.ts", "utf8");
  const block = /if \(command\.type === "createWorkflowTemplate"\) \{([\s\S]*?)const templateId/.exec(
    command,
  );
  assert.ok(block, "createWorkflowTemplate no longer opens the way it did");
  assert.match(block[1], /where\("name", "==", command\.input\.name\)/);
  assert.match(
    block[1],
    /where\("eventTypeId", "==", command\.input\.eventTypeId\)/,
  );
});
