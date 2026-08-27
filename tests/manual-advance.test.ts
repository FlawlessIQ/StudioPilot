import assert from "node:assert/strict";
import { test } from "node:test";
import {
  gatedTransitionKeys,
  manualAdvanceFor,
  manualAdvanceKeys,
} from "@/features/projects/manual-advance";
import {
  allowedProjectTransitions,
  evidenceControlledProjectTransitions,
  transitionAuthority,
} from "@/features/projects/state-machine";
import type { ProjectState } from "@/features/projects/schema";

/**
 * The rule this file exists to hold: a studio owner is never stuck. Every
 * transition StudioCue refuses to make on their say-so must name the record
 * that would satisfy it and where to enter it.
 */

test("every evidence-controlled transition has a way through", () => {
  for (const key of gatedTransitionKeys()) {
    const [from, to] = key.split(":") as [ProjectState, ProjectState];
    const advance = manualAdvanceFor(from, to, "project-1");
    assert.ok(
      advance,
      `${key} is refused by transitionProject with nothing offered instead`,
    );
    assert.ok(advance.label.length > 3, `${key} needs a label`);
    assert.ok(
      advance.detail.length > 20,
      `${key} needs to say why, not just where`,
    );
    assert.match(advance.href, /^\/studio\//, `${key} needs somewhere to go`);
  }
});

test("the project id reaches the link", () => {
  const advance = manualAdvanceFor("CONTRACT_PENDING", "RETAINER_PENDING", "abc");
  assert.equal(advance?.href, "/studio/booking?project=abc");
});

test("a free transition offers no detour", () => {
  // These are the ordinary stage control's job; offering a second route would
  // be two answers to one question.
  for (const [from, to] of [
    ["LEAD", "CONSULTATION"],
    ["CONSULTATION", "PROPOSAL"],
    ["BOOKED", "PLANNING"],
    ["READY", "EVENT_COMPLETE"],
    ["EVENT_COMPLETE", "POST_PRODUCTION"],
    ["DELIVERED", "CLOSED"],
  ] as Array<[ProjectState, ProjectState]>) {
    assert.equal(transitionAuthority(from, to), null, `${from}→${to}`);
    assert.equal(manualAdvanceFor(from, to, "p"), null, `${from}→${to}`);
  }
});

test("no route describes a transition the state machine does not allow", () => {
  // A stale entry would put a link on a screen for a move that cannot happen.
  for (const key of manualAdvanceKeys()) {
    const [from, to] = key.split(":") as [ProjectState, ProjectState];
    assert.ok(
      allowedProjectTransitions[from].includes(to),
      `${key} is not a transition the state machine allows`,
    );
    assert.ok(
      evidenceControlledProjectTransitions.some(
        (transition) => transition.from === from && transition.to === to,
      ),
      `${key} is not gated, so it needs no manual route`,
    );
  }
});

test("every forward move out of every live state is reachable somehow", () => {
  /**
   * The whole brief in one assertion: walk every state a real job passes
   * through and confirm that its onward move is either free (the stage control
   * does it) or gated with a documented way through. A state whose only exits
   * are gated and undocumented is a job that cannot be finished.
   */
  const terminal = ["CLOSED", "CANCELLED", "ARCHIVED"];
  for (const [from, targets] of Object.entries(allowedProjectTransitions)) {
    if (terminal.includes(from)) continue;
    const forward = targets.filter(
      (target) => !["CANCELLED", "POSTPONED", "ARCHIVED"].includes(target),
    );
    if (forward.length === 0) continue;
    const reachable = forward.some(
      (target) =>
        transitionAuthority(from as ProjectState, target) === null ||
        manualAdvanceFor(from as ProjectState, target, "p") !== null,
    );
    assert.ok(reachable, `${from} has no forward move a studio can make`);
  }
});
