import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  clientOutreachStop,
  mayContactClient,
} from "../features/post-event/client-outreach";

/**
 * A scheduled client email checks the job before it sends.
 *
 * Review requests and album reminders are queued days ahead — day 3 and day 10
 * for the review ask, day 7 and day 14 for the album. Neither scheduler read
 * the project, so nothing that happened to the job in between could stop them.
 *
 * Found on production, before it fired: the Iris & Theo wedding was delivered,
 * closed and archived on 2026-09-18 and its two album reminders sat `scheduled`
 * for 2026-09-25 and 2026-10-02. A week after the studio filed the job away,
 * StudioCue would have asked the couple to choose their album photographs.
 */

test("an archived job stops outreach, by state or by field", () => {
  assert.equal(clientOutreachStop({ state: "ARCHIVED" }), "put_away");
  assert.equal(
    clientOutreachStop({ state: "CLOSED", archivedAt: "2026-09-18T00:00:00Z" }),
    "put_away",
  );
});

test("a quieted job stops outreach", () => {
  // The guard imported bookings rely on (ADR 0005). dueLifecycleMessages has
  // honoured it all along; these two schedulers bypassed it, so an imported
  // couple could be reached by the album reminder and nothing else.
  assert.equal(
    clientOutreachStop({
      state: "DELIVERED",
      clientAutomationsPausedAt: "2026-09-01T00:00:00Z",
    }),
    "automations_paused",
  );
});

test("a cancelled wedding stops outreach", () => {
  assert.equal(clientOutreachStop({ state: "CANCELLED" }), "cancelled");
});

test("a live job is still reachable", () => {
  for (const state of ["DELIVERED", "REVIEW_REQUESTED", "POST_PRODUCTION"]) {
    assert.equal(clientOutreachStop({ state, archivedAt: null }), null, state);
    assert.equal(mayContactClient({ state, archivedAt: null }), true, state);
  }
});

/**
 * CLOSED alone is deliberately not a stop. Closeout settles the album and
 * review requirements, but a studio that closed without archiving has not said
 * the couple should hear nothing, and an album genuinely outstanding is worth
 * one more ask. Pinned so the choice is visible if anyone changes it.
 */
test("closed but not archived is still reachable", () => {
  assert.equal(clientOutreachStop({ state: "CLOSED", archivedAt: null }), null);
});

test("a project that cannot be read is never written to", () => {
  assert.equal(mayContactClient(null), false);
  assert.equal(mayContactClient(undefined), false);
});

/** Both schedulers consult it, and consult it before they write. */
test("both post-event schedulers check the project", () => {
  const source = readFileSync(
    `${process.cwd()}/functions/src/post-event/jobs.ts`,
    "utf8",
  );
  const schedulers = [
    "export const reviewRequestScheduler",
    "export const albumReminderScheduler",
  ];
  for (const scheduler of schedulers) {
    const body = source.slice(
      source.indexOf(scheduler),
      source.indexOf(scheduler) + 4000,
    );
    assert.match(
      body,
      /clientOutreachStop\(project\.data\(\)\)/,
      `${scheduler} sends client email and must check the job first`,
    );
    // A project it cannot read is treated as put away, never as reachable.
    assert.match(body, /: "put_away";/, scheduler);
    assert.match(body, /status: "skipped",/, scheduler);
  }
});

/**
 * functions/ is a separate package with no "@/features" path, so the rule is
 * duplicated. Compare the two copies below their headers.
 */
test("the functions copy of the outreach guard matches features/", () => {
  const body = (path: string) => {
    const source = readFileSync(`${process.cwd()}/${path}`, "utf8");
    return source.slice(source.indexOf("export type ClientOutreachStop"));
  };
  assert.equal(
    body("functions/src/post-event/client-outreach.ts"),
    body("features/post-event/client-outreach.ts"),
  );
});
