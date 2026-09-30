import assert from "node:assert/strict";
import { test } from "node:test";
import { todayInbox } from "@/features/today/inbox";

/**
 * An archived job asks for nothing (walked on production, 2026-09-30).
 *
 * Archiving keeps a job's last state, so "Questionnaire Flow Test", archived
 * while BOOKED, still read as open: Today asked to "Release the gallery" and to
 * "draft the schedule" for a job the Jobs list had filed away.
 */
test("an archived job's prepared work and journey step stay off Today", () => {
  const base = {
    now: "2026-09-30T12:00:00Z",
    deliveryDrafts: [{ id: "d1", projectId: "p1", status: "review_required", label: "Gallery" }],
    journeys: [
      {
        stepKey: "run_of_show",
        projectId: "p1",
        projectName: "Questionnaire Flow Test",
        eventDate: "2027-12-05",
        state: "BOOKED",
        stepTitle: "Run of show",
        stepDetail: "Draft the schedule",
        owner: "studio" as const,
        actionLabel: "Draft the schedule",
        actionHref: "/studio/schedules/new?project=p1",
        updatedAt: null,
      },
    ],
  };
  const open = todayInbox({ ...base, projects: [{ id: "p1", name: "Questionnaire Flow Test", state: "BOOKED", archivedAt: null }] });
  assert.ok(open.approve.some((item) => item.id === "delivery-d1"));
  assert.ok(open.act.some((item) => item.id === "journey-p1"));
  const archived = todayInbox({
    ...base,
    projects: [{ id: "p1", name: "Questionnaire Flow Test", state: "BOOKED", archivedAt: "2026-09-09T20:41:59Z" }],
  });
  assert.ok(!archived.approve.some((item) => item.projectId === "p1"), "no prepared work");
  assert.ok(!archived.act.some((item) => item.projectId === "p1"), "no journey step");
});

test("a gallery mailed to an archived job's inbox is dropped, not drafted", async () => {
  const { readFileSync } = await import("node:fs");
  const inbound = readFileSync("functions/src/post-event/inbound.ts", "utf8");
  assert.match(inbound, /if \(!inboxProject\.exists \|\| inboxProject\.get\("archivedAt"\)\) \{\s*response\.status\(204\)\.send\(\);/);
});
