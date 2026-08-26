import assert from "node:assert/strict";
import { test } from "node:test";
import {
  filterThreadHistory,
  threadHistoryFacets,
  threadHistorySummary,
  type ThreadEntry,
} from "@/features/journey/thread";

/**
 * The job page used to render the whole history inline, between the next move
 * and the outstanding/prepared/copilot sections below it. On a job with a few
 * months of activity that was eight screens of scroll to reach the things a
 * photographer actually acts on, so the history moved behind a button.
 *
 * The summary is what stops that from also hiding whether anything happened.
 * These tests pin what the row is allowed to say.
 */

const entry = (over: Partial<ThreadEntry> & { id: string; at: string }): ThreadEntry => ({
  actor: "studio",
  artifact: null,
  detail: null,
  kind: "system",
  title: "Something happened",
  ...over,
});

test("the summary names the newest entry, which is the last one", () => {
  const summary = threadHistorySummary([
    entry({ id: "a", at: "2026-07-28T09:00:00Z", title: "You started this job" }),
    entry({ id: "b", at: "2026-08-26T09:00:00Z", title: "John replied" }),
  ]);
  assert.equal(summary.count, 2);
  assert.equal(summary.latest?.title, "John replied");
  assert.equal(summary.latest?.at, "2026-08-26T09:00:00Z");
});

test("an empty history reports no latest entry rather than a placeholder", () => {
  const summary = threadHistorySummary([]);
  assert.equal(summary.count, 0);
  assert.equal(summary.latest, null);
});

const HISTORY: ThreadEntry[] = [
  entry({ id: "1", at: "2026-07-28T09:00:00Z", title: "You started this job" }),
  entry({
    id: "2",
    at: "2026-08-01T09:00:00Z",
    actor: "client",
    kind: "message",
    title: "John replied",
  }),
  entry({
    id: "3",
    at: "2026-08-02T09:00:00Z",
    kind: "artifact",
    title: "Proposal v1",
    artifact: { facts: [], href: null, status: "accepted", type: "proposal" },
  }),
  entry({
    id: "4",
    at: "2026-08-03T09:00:00Z",
    kind: "artifact",
    title: "Retainer invoice",
    artifact: { facts: [], href: null, status: "sent", type: "invoice" },
  }),
];

test("an invoice is money, and is not filed under documents", () => {
  assert.deepEqual(
    filterThreadHistory(HISTORY, "money").map((item) => item.id),
    ["4"],
  );
  assert.deepEqual(
    filterThreadHistory(HISTORY, "documents").map((item) => item.id),
    ["3"],
  );
});

test("facets a job cannot answer for are not offered", () => {
  // A week-old job has no documents and no payments. A filter that returns
  // nothing is a control that does nothing.
  const young = threadHistoryFacets([HISTORY[0], HISTORY[1]]);
  assert.deepEqual(
    young.map((option) => option.facet),
    ["all", "client", "messages"],
  );
  assert.deepEqual(
    young.map((option) => option.count),
    [2, 1, 1],
  );
});

test("every facet is offered once the job has one of each", () => {
  assert.deepEqual(
    threadHistoryFacets(HISTORY).map((option) => option.facet),
    ["all", "client", "messages", "documents", "money"],
  );
});
