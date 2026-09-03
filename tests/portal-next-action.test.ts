import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildClientPortalExperience,
  clientProjectStates,
} from "@/server/client/portal-experience";

/**
 * The rule this file holds: the couple's next action is always something they
 * can do, about a day that has not already happened.
 *
 * The client portal derived everything from the stage the studio maintained and
 * never from the calendar or the records. Walked nineteen days after a wedding
 * still marked PLANNING, it said "Your next action — Continue planning your
 * event", asked for the ceremony time of a day already shot, and pointed at a
 * questionnaire the couple had submitted — while the one decision genuinely
 * waiting on them, a revised run of show at `client_review`, was reachable only
 * by typing the URL. The builder could not have known: it was never given the
 * date or the schedule.
 *
 * Sibling to tests/journey-preconditions.test.ts, which holds the same rule
 * for the studio's next move. That guard drives `projectJourney`; this one
 * drives `buildClientPortalExperience`; neither knew the other workspace
 * existed, which is how a class fixed for the studio stayed live for the couple.
 */

const STATES = clientProjectStates;
const EVENT = "2026-08-15";
const DAYS = [
  { today: "2026-07-01", passed: false },
  { today: "2026-08-15", passed: false },
  { today: "2026-09-03", passed: true },
] as const;
const SCHEDULES = [
  null,
  { status: "draft", version: 1 },
  { status: "client_review", version: 4 },
  { status: "approved", version: 4 },
  { status: "published", version: 4 },
] as const;
const FORMS = [null, "assigned", "in_progress", "submitted", "locked"] as const;
const CHECKPOINTS = [
  [],
  [
    {
      name: "Questionnaire complete",
      description: null,
      status: "not_started",
      dueDate: null,
      ownerType: "client",
    },
  ],
  [
    {
      name: "Venue confirmed",
      description: null,
      status: "not_started",
      dueDate: null,
      ownerType: "studio",
    },
  ],
] as const;

const CLIENT_PAGES = new Set([
  "/client",
  "/client/project",
  "/client/proposal",
  "/client/package",
  "/client/contract",
  "/client/payments",
  "/client/questionnaire",
  "/client/schedule",
  "/client/documents",
  "/client/delivery",
  "/client/reviews",
  "/client/messages",
]);

function* experiences() {
  for (const state of STATES) {
    for (const day of DAYS) {
      for (const currentSchedule of SCHEDULES) {
        for (const questionnaireStatus of FORMS) {
          for (const checkpoints of CHECKPOINTS) {
            const input = {
              state,
              availability: { schedule: Boolean(currentSchedule) },
              checkpoints: [...checkpoints],
              eventDate: EVENT,
              today: day.today,
              currentSchedule,
              questionnaireStatus,
            };
            yield {
              input,
              day,
              experience: buildClientPortalExperience(input),
            };
          }
        }
      }
    }
  }
}

const describe = (input: Record<string, unknown>) =>
  `state=${input.state} today=${input.today} schedule=${JSON.stringify(input.currentSchedule)} form=${input.questionnaireStatus} checkpoints=${(input.checkpoints as unknown[]).length}`;

const SHOWN = 6;

test("a schedule awaiting the couple is their next action", () => {
  /**
   * CP3. Once any version is approved `schedule-approved` completes for ever,
   * so the checkpoint path never sees a later revision. The record does.
   */
  const failures: string[] = [];
  for (const { input, experience } of experiences()) {
    if (input.currentSchedule?.status !== "client_review") continue;
    if (experience.nextClientAction.href !== "/client/schedule") {
      failures.push(
        `${describe(input)} → ${experience.nextClientAction.href} "${experience.nextClientAction.name}"`,
      );
    }
  }
  assert.deepEqual(
    failures.slice(0, SHOWN),
    [],
    `A run of show at client_review was not the next action. The one decision waiting on the couple must be the thing the portal points at.\n${failures.length} failing${failures.length > SHOWN ? `, first ${SHOWN}` : ""}:\n${failures.slice(0, SHOWN).map((l) => `  ${l}`).join("\n")}`,
  );
});

test("past the day, the couple is never asked to plan it", () => {
  /**
   * CP1. "Continue planning your event" nineteen days after the wedding. The
   * portal printed the days-since counter from this same date and used it
   * for nothing else.
   */
  const failures: string[] = [];
  for (const { input, day, experience } of experiences()) {
    if (!day.passed) continue;
    const action = experience.nextClientAction;
    if (
      action.responsibility === "client" &&
      action.href === "/client/questionnaire"
    ) {
      failures.push(`${describe(input)} → "${action.name}"`);
    }
  }
  assert.deepEqual(
    failures.slice(0, SHOWN),
    [],
    `The portal asked the couple to keep planning a day that has already happened.\n${failures.length} failing${failures.length > SHOWN ? `, first ${SHOWN}` : ""}:\n${failures.slice(0, SHOWN).map((l) => `  ${l}`).join("\n")}`,
  );
});

test("a submitted form is never the next action", () => {
  const failures: string[] = [];
  for (const { input, experience } of experiences()) {
    if (!["submitted", "locked"].includes(String(input.questionnaireStatus))) continue;
    // A checkpoint that names the questionnaire is the studio saying it still
    // wants answers, which is a different thing from the state fallback.
    if (input.checkpoints.length) continue;
    if (experience.nextClientAction.href === "/client/questionnaire") {
      failures.push(`${describe(input)} → "${experience.nextClientAction.name}"`);
    }
  }
  assert.deepEqual(
    failures.slice(0, SHOWN),
    [],
    `The next action pointed at a questionnaire the couple has already submitted, whose every field and button is disabled.\n${failures.slice(0, SHOWN).map((l) => `  ${l}`).join("\n")}`,
  );
});

test("the next action always points at a page the portal has", () => {
  const failures: string[] = [];
  for (const { input, experience } of experiences()) {
    if (!CLIENT_PAGES.has(experience.nextClientAction.href)) {
      failures.push(`${describe(input)} → ${experience.nextClientAction.href}`);
    }
  }
  assert.deepEqual(failures.slice(0, SHOWN), []);
});

test("the schedule does not outrank money that is overdue", () => {
  // The one thing that beats a waiting schedule — the existing rule, kept.
  const experience = buildClientPortalExperience({
    state: "PLANNING",
    availability: { schedule: true },
    checkpoints: [],
    currentSchedule: { status: "client_review", version: 4 },
    outstandingBalance: {
      amountLabel: "$6,265.00",
      dueDate: "2026-08-01",
      dueDateLabel: "August 1, 2026",
      overdue: true,
    },
  });
  assert.equal(experience.nextClientAction.href, "/client/payments");
});
