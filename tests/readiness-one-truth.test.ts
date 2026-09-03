import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  checkpointIsRequired,
  checkpointIsSatisfied,
  readinessScore,
} from "@/features/readiness/score";
import { noReadinessEvidence } from "@/features/readiness/checkpoint-evidence";
import { readinessSummary } from "@/features/projects/readiness-summary";

/**
 * The rule this file exists to hold: a quantity has one definition.
 *
 * Readiness had three. `readinessSummary` scored it for the job page,
 * `calculateReadiness` in features/readiness/engine.ts scored it for the
 * assessment record, and `calculateReadiness` in
 * functions/src/workflow/commands.ts scored it for `project.readinessScore` —
 * the field the Jobs list, the calendar, the dashboard and the reports all
 * display. The walk of 2026-09-02 met the result twice in one viewport: an
 * Overview reading 50% beside a context bar reading 42%, and a header counting
 * eight blockers above a panel listing twelve.
 *
 * The part worth remembering is that a guard already existed.
 * tests/readiness-summary.test.ts says it "pins it against calculateReadiness
 * so the two can never drift" — and pins the two *app-side* implementations
 * against each other, leaving the server's, the authoritative writer,
 * unchecked. A test naming the right rule can still watch the wrong pair, so
 * this one asserts what it covers rather than assuming it.
 *
 * Collapsing them found drift nobody had reported: the overdue and at-risk
 * lists tested the stored status alone and so ignored evidence, meaning a
 * checkpoint proven by the project's own records was overdue in the app and
 * satisfied on the server, for the same job at the same moment.
 */

const SCORE_SOURCE = "features/readiness/score.ts";
const SCORE_MIRROR = "functions/src/workflow/readiness-score.ts";
/** Where the shared body starts in both copies; the headers differ on purpose. */
const SHARED_MARKER = "/**\n * The fields scoring reads.";

test("the functions copy of the score has not drifted", () => {
  /**
   * functions/ cannot import from features/, so the definition is duplicated
   * the way checkpoint-evidence.ts and starter-templates.ts are. A drift here
   * means the number written to every project disagrees with the number the
   * job page derives — silently, and only visible to someone holding both
   * screens at once.
   */
  const source = readFileSync(SCORE_SOURCE, "utf8");
  const mirror = readFileSync(SCORE_MIRROR, "utf8");
  assert.ok(
    source.includes(SHARED_MARKER) && mirror.includes(SHARED_MARKER),
    `Both copies must keep the marker ${JSON.stringify(SHARED_MARKER)} so the shared body can be compared. If the file was restructured, update SHARED_MARKER here.`,
  );
  assert.equal(
    mirror.slice(mirror.indexOf(SHARED_MARKER)),
    source.slice(source.indexOf(SHARED_MARKER)),
    `${SCORE_MIRROR} has drifted from ${SCORE_SOURCE}. Edit the source, then copy everything from the marker down.`,
  );
});

test("nobody scores readiness except the shared definition", () => {
  /**
   * The formula, as a shape rather than a string: a percentage built by
   * dividing a satisfied count by a required count. Three files had their own;
   * a fourth would be free to appear at any time, and would look perfectly
   * reasonable in review.
   *
   * Deliberately a source scan. There is no runtime hook that could notice a
   * new implementation, and the previous guard's failure was precisely that it
   * tested behaviour it had chosen and not the field a studio reads.
   */
  const offenders: string[] = [];
  const allowed = new Set([SCORE_SOURCE, SCORE_MIRROR]);
  const pattern = /Math\.round\(\s*\(?\s*[A-Za-z.]*satisfied\w*[.\w]*\s*(?:\.length)?\s*\/\s*[A-Za-z.]*required\w*[.\w]*/i;

  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const relative = full.slice(process.cwd().length + 1);
      if (allowed.has(relative)) continue;
      if (relative.startsWith("tests/")) continue;
      if (pattern.test(readFileSync(full, "utf8"))) offenders.push(relative);
    }
  };
  for (const root of ["features", "components", "app", "lib", "server"]) {
    walk(join(process.cwd(), root));
  }
  walk(join(process.cwd(), "functions", "src"));

  assert.deepEqual(
    offenders,
    [],
    `A second readiness formula. Call \`readinessScore\` from ${SCORE_SOURCE} (or its functions mirror) instead — the last time three of these existed, one screen said 50% and another said 42%:\n${offenders.map((file) => `  ${file}`).join("\n")}`,
  );
});

/** Checkpoint shapes worth crossing: status, blocking, waiver, method. */
const STATUSES = [
  "not_started",
  "ready",
  "in_progress",
  "complete",
  "waived",
  "failed",
] as const;
const WAIVERS = [null, "2026-01-01", "2099-01-01T00:00:00.000Z"] as const;
const METHODS = ["manual", "contract_completed", "invoice_paid"] as const;

const NOW = "2026-09-02T12:00:00.000Z";

function* checkpointSets() {
  for (const status of STATUSES) {
    for (const waiverExpiresAt of WAIVERS) {
      for (const completionMethod of METHODS) {
        for (const blocking of [true, false]) {
          yield [
            {
              id: "c1",
              name: "Contract completed",
              status,
              blocking,
              waiverExpiresAt,
              completionMethod,
              templateKey: "contract-completed",
              resolvedDueDate: "2027-05-01",
            },
            {
              id: "c2",
              name: "Venue confirmed",
              status: "not_started",
              blocking: true,
              waiverExpiresAt: null,
              completionMethod: "manual",
              templateKey: "venue-confirmed",
              resolvedDueDate: "2027-05-13",
            },
          ];
        }
      }
    }
  }
}

test("the display summary reports exactly what the shared definition scores", () => {
  const evidence = { ...noReadinessEvidence, contractCompleted: true };
  for (const checkpoints of checkpointSets()) {
    for (const withEvidence of [noReadinessEvidence, evidence]) {
      const shared = readinessScore(checkpoints, NOW, withEvidence);
      const summary = readinessSummary(
        checkpoints,
        new Date(NOW),
        withEvidence,
      );
      assert.equal(
        summary.tracked,
        shared.tracked,
        `tracked disagrees for ${JSON.stringify(checkpoints[0])}`,
      );
      assert.equal(
        summary.percent,
        shared.tracked ? shared.percent : 0,
        `percent disagrees for ${JSON.stringify(checkpoints[0])}`,
      );
      // The blocker list and the denominator must describe the same set.
      const unsatisfiedRequired = checkpoints.filter(
        (checkpoint) =>
          checkpointIsRequired(checkpoint) &&
          !checkpointIsSatisfied(checkpoint, NOW, withEvidence),
      ).length;
      assert.equal(
        summary.blocking.length,
        shared.tracked ? unsatisfiedRequired : 0,
        `blocker count disagrees with the score for ${JSON.stringify(checkpoints[0])}`,
      );
    }
  }
});

test("no required checkpoints is untracked, never zero per cent", () => {
  /**
   * The distinction the stored field cannot carry, and the reason "0 · 0%
   * ready" sat on the header of a job progressing perfectly well through
   * booking: before the workflow is instantiated there are no checkpoints, so
   * there is no readiness — which is not the same as failing all of it.
   */
  const none = readinessScore([], NOW);
  assert.equal(none.tracked, false);
  assert.equal(none.totalRequired, 0);

  const nonBlocking = readinessScore(
    [{ status: "not_started", blocking: false, completionMethod: "manual" }],
    NOW,
  );
  assert.equal(nonBlocking.tracked, false);
});

test("a waiver is judged by when it expires, not by how it is written", () => {
  /**
   * One side compared `new Date(expires) > now`, the other compared the ISO
   * strings lexically. Those agree only while every expiry is a full UTC
   * timestamp, and date-only expiries are written in practice.
   */
  const waived = (waiverExpiresAt: string | null) => [
    { status: "waived", blocking: true, waiverExpiresAt, completionMethod: "manual" },
  ];
  assert.equal(readinessScore(waived(null), NOW).percent, 100);
  assert.equal(readinessScore(waived("2099-01-01"), NOW).percent, 100);
  assert.equal(readinessScore(waived("2026-01-01"), NOW).percent, 0);
  assert.equal(
    readinessScore(waived("2099-01-01T00:00:00.000Z"), NOW).percent,
    100,
  );
  // Unreadable is not "still valid".
  assert.equal(readinessScore(waived("whenever"), NOW).percent, 0);
});

test("a single job's readiness is derived, not read from the stored field", () => {
  /**
   * `project.readinessScore` is a cache written by the reconciler, and reading
   * it is correct for a *list* — deriving would mean loading every
   * checkpoint of every project to render a column.
   *
   * It is not correct for a single job, where the checkpoints that explain the
   * number are already loaded. The context bar read the stored field on every
   * project route, including the ones showing a derived figure beside it, and
   * so reported 42% against the Overview's 50%. The gap was the certificate
   * marked not required: evidence knows, a number written before the decision
   * does not.
   *
   * Entries listed here are lists or aggregates. Anything else must derive — including the job
   * page, which is deliberately absent: it mentions the field in a comment and
   * assigns it while building mock data, and neither is a read.
   */
  const LIST_VIEWS = new Set([
    "components/live/tenant-records.tsx",
    "components/reporting/live-reports.tsx",
    "components/booking/studio-calendar.tsx",
    "components/dashboard/studio-dashboard.tsx",
    "components/dashboard/priority-signals.tsx",
    // Aggregate metrics across every project, not one job's number.
    "features/dashboard/home-metrics.ts",
  ]);

  const offenders: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const relative = full.slice(process.cwd().length + 1);
      if (LIST_VIEWS.has(relative)) continue;
      /**
       * A *read of the stored field*, which is `something.readinessScore`.
       *
       * Three things must not trip it, and the first draft tripped on all
       * three: the shared function is also called `readinessScore` (my naming
       * collision), so its import and its call sites matched; the write
       * `readinessScore: projection.score` matched; and the prose in doc
       * comments explaining this very defect matched. Requiring a leading dot
       * excludes the first two, and stripping comments excludes the third.
       */
      const source = readFileSync(full, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");
      if (/\.readinessScore\b/.test(source)) offenders.push(relative);
    }
  };
  /**
   * `features`, `lib` and `server` too, not just the screens.
   *
   * The first version of this test scanned only components/ and app/, and so
   * missed `features/projects/lifecycle-projection.ts` reading the stored score
   * to populate a `readiness` field — which nothing displayed, making it a trap
   * for whoever used it next rather than a visible bug. Found by doing the next
   * task, not by this test, which is the second time a guard here has needed
   * widening after it passed.
   */
  for (const root of ["components", "app", "features", "lib", "server"]) {
    walk(join(process.cwd(), root));
  }
  walk(join(process.cwd(), "functions", "src"));

  assert.deepEqual(
    offenders,
    [],
    `These read the stored \`readinessScore\` outside a list view. Derive it with \`readinessSummary\` from the checkpoints, which are already loaded on a single-job screen — the stored value is a cache and goes stale against the evidence:\n${offenders.map((file) => `  ${file}`).join("\n")}`,
  );
});
