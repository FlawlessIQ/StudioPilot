import assert from "node:assert/strict";
import test from "node:test";
import { projectJourney } from "@/features/journey/steps";
import { todayInbox, type TodayJourneyPosition } from "@/features/today/inbox";

/**
 * One voice for "what next".
 *
 * Before Phase 2 a single job page named four different next steps in four
 * panels, and the Jobs table kept a fifth opinion of its own. The surfaces
 * now all read the same journey engine, so this pins the property that made
 * that possible: whatever the engine says the current step is, every surface
 * derived from it says the same thing.
 *
 * The UI mapping under test is the one both `useTodayInbox` (Today, and the
 * Jobs table through it) and the job page's next-move card perform.
 */

const TODAY = "2026-08-21";

const journeyFor = (state: string) =>
  projectJourney({
    projectId: "job-1",
    state,
    eventDate: "2026-09-12",
    today: TODAY,
    lead: null,
    hasConsultation: true,
    proposalStatus: "accepted",
    contractStatus: "completed",
    retainerInvoiceStatus: "paid",
    finalInvoiceStatus: "sent",
    questionnaireStatus: "submitted",
    scheduleStatus: "approved",
    crewAccepted: 0,
    crewCascadeActive: false,
    coiStatus: null,
    dayBeforeDraftStatus: null,
    hasDelivery: false,
    albumOrReviewDone: false,
  });

/** Exactly what components/today/use-today-inbox.ts builds. */
const positionFrom = (
  current: ReturnType<typeof projectJourney>["current"],
  state: string,
): TodayJourneyPosition => ({
  projectId: "job-1",
  projectName: "Okafor Wedding",
  eventDate: "2026-09-12",
  state,
  stepTitle: current?.title ?? "In motion",
  stepDetail: current?.detail ?? "Nothing is due from you right now.",
  owner: current ? (current.owner ?? "studio") : "provider",
  actionLabel: current?.action?.kind === "link" ? current.action.label : null,
  actionHref: current?.action?.kind === "link" ? current.action.href : null,
  updatedAt: null,
});

/** What the job page's next-move card renders as its heading. */
const nextMoveHeading = (
  current: ReturnType<typeof projectJourney>["current"],
) => (current?.action?.kind === "link" ? current.action.label : current?.title);

for (const state of ["PLANNING", "CONSULTATION", "POST_PRODUCTION"]) {
  test(`Today, the Jobs row and the job page name the same next step in ${state}`, () => {
    const { current } = journeyFor(state);
    const position = positionFrom(current, state);

    const inbox = todayInbox({
      now: `${TODAY}T12:00:00.000Z`,
      journeys: [position],
    });

    const heading = nextMoveHeading(current);
    // The Jobs table shows actionLabel, falling back to the step title.
    const jobsRow = position.actionLabel ?? position.stepTitle;

    if (position.owner === "studio") {
      const card = inbox.act.find((item) => item.id === "journey-job-1");
      assert.ok(card, `no Today card for a step owned by the studio (${state})`);
      // Today's card title is "<job> — <action>", lower-cased.
      assert.equal(card?.title, `Okafor Wedding — ${jobsRow?.toLowerCase()}`);
      assert.equal(heading, jobsRow);
    } else {
      // Owned by someone else: it is in motion, and nowhere claims otherwise.
      assert.equal(inbox.act.length, 0);
      assert.equal(inbox.inMotion, 1);
    }
  });
}

test("the current step is the only instruction the engine offers", () => {
  const { steps, current } = journeyFor("PLANNING");
  // Exactly one step is current — the invariant every surface leans on.
  assert.equal(steps.filter((step) => step.status === "current").length, 1);
  assert.equal(current?.status, "current");
});
