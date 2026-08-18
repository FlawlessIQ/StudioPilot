import assert from "node:assert/strict";
import test from "node:test";
import { analyseFunnel } from "../features/operations/funnel.ts";

// The demo tenant's real shape: the drop is proposals -> contracts.
const demoStages = [
  { label: "Inquiries", value: 3 },
  { label: "Consultations", value: 3 },
  { label: "Proposals sent", value: 3 },
  { label: "Contracts complete", value: 1 },
  { label: "Booked projects", value: 3 },
];

test("conversion is computed step to step and against the start", () => {
  const { steps } = analyseFunnel(demoStages);
  assert.equal(steps[0].conversionFromPrevious, null, "stage one has no predecessor");
  assert.equal(steps[0].shareOfStart, null);
  assert.equal(steps[2].conversionFromPrevious, 100);
  assert.equal(steps[3].conversionFromPrevious, 33);
  assert.equal(steps[3].shareOfStart, 33);
});

test("the largest leak is named rather than left to be spotted", () => {
  const { biggestLeak } = analyseFunnel(demoStages);
  assert.ok(biggestLeak);
  assert.equal(biggestLeak.fromLabel, "Proposals sent");
  assert.equal(biggestLeak.toLabel, "Contracts complete");
  assert.equal(biggestLeak.lost, 2);
  assert.equal(biggestLeak.conversion, 33);
});

test("a stage that grows is not a loss and claims no conversion rate", () => {
  // Booked projects (3) exceeds contracts complete (1) — projects can be booked
  // outside this funnel. Reporting that as "300% conversion" reads as a bug.
  const { steps } = analyseFunnel(demoStages);
  assert.equal(steps[4].lostFromPrevious, 0);
  assert.equal(steps[4].exceedsPrevious, true);
  assert.equal(steps[4].conversionFromPrevious, null);
});

test("bar width never exceeds the track", () => {
  const { steps } = analyseFunnel([
    { label: "Start", value: 1 },
    { label: "Grew", value: 9 },
  ]);
  assert.equal(steps[1].shareOfStart, 100, "capped for display");
});

test("a clean funnel reports no leak", () => {
  const { biggestLeak } = analyseFunnel([
    { label: "Inquiries", value: 4 },
    { label: "Consultations", value: 4 },
    { label: "Booked", value: 4 },
  ]);
  assert.equal(biggestLeak, null);
});

test("an empty funnel does not divide by zero", () => {
  const { steps, biggestLeak } = analyseFunnel([
    { label: "Inquiries", value: 0 },
    { label: "Consultations", value: 0 },
  ]);
  assert.equal(steps[1].conversionFromPrevious, null);
  assert.equal(steps[1].shareOfStart, null);
  assert.equal(biggestLeak, null);
});

test("the biggest leak wins on absolute loss, not on rate", () => {
  const { biggestLeak } = analyseFunnel([
    { label: "A", value: 100 },
    { label: "B", value: 60 },   // lost 40, 60% conversion
    { label: "C", value: 3 },    // lost 57, 5% conversion
  ]);
  assert.ok(biggestLeak);
  assert.equal(biggestLeak.fromLabel, "B");
  assert.equal(biggestLeak.lost, 57);
});

test("no stages at all is handled", () => {
  const { steps, biggestLeak } = analyseFunnel([]);
  assert.deepEqual(steps, []);
  assert.equal(biggestLeak, null);
});
