import assert from "node:assert/strict";
import test from "node:test";
import { journeyFor, journeyProfile } from "../features/job-kinds/job-kinds";
import { journeyFor as serverJourneyFor, journeyProfile as serverJourneyProfile } from "../functions/src/job-kinds/job-kinds";
import { clientAsks } from "../features/journey/burden";
import { projectJourney, type JourneyInput } from "../features/journey/steps";
import { setupOrderFor } from "../features/today/setup-gaps";
import { starterTemplates } from "../features/workflows/starter-templates";
import { starterTemplates as serverStarterTemplates } from "../functions/src/workflow/starter-templates";
import { tradeProfile } from "../features/trades/trades";
import { tradeProfile as serverTradeProfile } from "../functions/src/trades/trades";

/**
 * The vendor burden budget (simpler vendor journeys, 2026-10-09).
 *
 * Conor: "the vendor journey is less complicated than the photographer
 * journey and should be easier and less burdensome. i would be disappointed
 * if we made it more complex because we built it off the photographer
 * journey." Built from the photographer's, each vendor trade had 14 journey
 * steps to its 15, about ten asks of the client, all twelve readiness checks
 * and the same seven setup questions.
 *
 * The budget: a vendor's wedding has at most 8 steps, asks the client at
 * most 5 things, carries 4 checks and asks the studio 4 setup questions. A
 * photographer's numbers are pinned where they are. A change that adds
 * burden to a vendor fails here; raise a number only with Conor's say-so.
 */

const VENDORS = ["dj", "makeup", "hair"] as const;
const BUDGET = { steps: 8, asks: 5, checks: 4, setup: 4 };

/** A wedding's journey at each moment a studio would look at it. */
function stepCounts(trade: string): number[] {
  const shape = tradeProfile(trade);
  const base: JourneyInput = {
    projectId: "p1",
    state: "LEAD",
    eventDate: "2027-06-12",
    today: "2026-10-09",
    lead: { id: "l1", status: "new" },
    hasConsultation: false,
    proposalStatus: null,
    contractStatus: null,
    retainerInvoiceStatus: null,
    finalInvoiceStatus: null,
    questionnaireStatus: null,
    questionnaireHasAnswers: false,
    scheduleStatus: null,
    scheduleHasUsableItems: false,
    crewAccepted: 0,
    crewRequired: 0,
    crewCascadeActive: false,
    coiStatus: null,
    insuranceRequired: "unknown",
    dayBeforeDraftStatus: null,
    hasDelivery: false,
    albumOrReviewDone: false,
    profile: journeyProfile("wedding"),
    trade,
    trial: shape.trial ? { state: "not_booked", startsAt: null } : null,
    finalCall: shape.planning ? { state: "not_yet", lockOn: "2027-05-13", startsAt: null } : undefined,
  };
  const at = (overrides: Partial<JourneyInput>) => projectJourney({ ...base, ...overrides }).steps.length;
  return [
    at({}),
    at({ state: "PROPOSAL", proposalStatus: "sent" }),
    at({ state: "BOOKED", proposalStatus: "accepted", contractStatus: "completed", retainerInvoiceStatus: "paid" }),
    at({ state: "PLANNING", proposalStatus: "accepted", contractStatus: "completed", retainerInvoiceStatus: "paid", questionnaireStatus: "submitted", questionnaireHasAnswers: true, today: "2027-06-10" }),
  ];
}

const checks = (trade: string) =>
  starterTemplates(tradeProfile(trade).journey.readiness).find((template) => template.eventTypeId === "wedding")!.checkpointTemplates.length;

test("a vendor's wedding is held to the budget: steps, client asks, checks, setup", () => {
  for (const trade of VENDORS) {
    assert.ok(Math.max(...stepCounts(trade)) <= BUDGET.steps, `${trade} steps: ${stepCounts(trade).join(", ")}`);
    const asks = clientAsks("wedding", trade);
    assert.ok(asks.length <= BUDGET.asks, `${trade} asks: ${asks.map((ask) => ask.key).join(", ")}`);
    assert.equal(checks(trade), BUDGET.checks, `${trade} checks`);
    assert.equal(setupOrderFor(trade).length, BUDGET.setup, `${trade} setup`);
  }
});

test("a vendor is never asked more than a photographer, on any measure", () => {
  const photo = {
    steps: Math.max(...stepCounts("photographer")),
    asks: clientAsks("wedding", "photographer").length,
    checks: checks("photographer"),
    setup: setupOrderFor("photographer").length,
  };
  for (const trade of VENDORS) {
    assert.ok(Math.max(...stepCounts(trade)) < photo.steps, trade);
    assert.ok(clientAsks("wedding", trade).length < photo.asks, trade);
    assert.ok(checks(trade) < photo.checks, trade);
    assert.ok(setupOrderFor(trade).length < photo.setup, trade);
  }
});

test("a photographer's journey does not move", () => {
  assert.deepEqual(stepCounts("photographer"), [15, 15, 15, 15]);
  assert.deepEqual(
    clientAsks("wedding", "photographer").map((ask) => ask.key),
    ["call", "accept", "sign", "deposit", "form", "schedule", "final_details", "balance", "billing_address"],
  );
  assert.equal(checks("photographer"), 12);
  assert.equal(setupOrderFor("photographer").length, 7);
  assert.equal(setupOrderFor(undefined).length, 7);
});

test("what each vendor's client is asked, by name", () => {
  assert.deepEqual(clientAsks("wedding", "makeup").map((ask) => ask.key), ["accept_sign", "deposit", "trial", "form", "headcount"]);
  assert.deepEqual(clientAsks("wedding", "hair").map((ask) => ask.key), ["accept_sign", "deposit", "trial", "form", "headcount"]);
  assert.deepEqual(clientAsks("wedding", "dj").map((ask) => ask.key), ["accept_sign", "deposit", "form", "final_call", "balance"]);
});

test("one profile, the same on both sides of the wire", () => {
  for (const trade of ["photographer", ...VENDORS]) {
    for (const kind of ["wedding", "portraits", "corporate", "sports", "other"] as const) {
      assert.deepEqual(
        journeyFor(journeyProfile(kind), tradeProfile(trade)),
        serverJourneyFor(serverJourneyProfile(kind), serverTradeProfile(trade)),
        `${trade}/${kind}`,
      );
    }
    assert.deepEqual(
      starterTemplates(tradeProfile(trade).journey.readiness),
      serverStarterTemplates(serverTradeProfile(trade).journey.readiness),
      trade,
    );
  }
  // A venue that asks for insurance turns the vendor's check back on.
  assert.equal(journeyFor(journeyProfile("wedding"), tradeProfile("dj")).coi, false);
  assert.equal(journeyFor(journeyProfile("wedding"), tradeProfile("dj"), { insuranceRequired: "required" }).coi, true);
  assert.equal(journeyFor(journeyProfile("wedding"), tradeProfile("photographer")).coi, true);
});
