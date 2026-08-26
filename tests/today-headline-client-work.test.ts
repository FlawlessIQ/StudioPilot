import assert from "node:assert/strict";
import { test } from "node:test";
import { todayHeadline, type TodayItem } from "@/features/today/inbox";

/**
 * The hero must be client work, never studio plumbing — a lapsed accounting
 * connector outranks a proposal in the queue and must not become the greeting
 * every morning.
 *
 * The original guard for that was `projectId !== null`, which also excluded a
 * setup gap blocking a named couple. On a two-job studio whose only item was
 * "Add your packages — blocking Amara & Ben Ito" the hero skipped it and promoted
 * a consultation twelve months out.
 */

const item = (over: Partial<TodayItem>): TodayItem =>
  ({
    id: "x",
    lane: "act",
    kind: null,
    title: "Something",
    detail: "",
    evidence: null,
    projectId: null,
    projectName: null,
    action: { kind: "link", label: "Open", href: "/studio" },
    jobHref: null,
    facts: [],
    band: "overdue",
    eventDate: null,
    score: 0,
    ...over,
  }) as TodayItem;

test("a blocking setup gap that names a client can headline", () => {
  const gap = item({
    id: "setup-packages",
    title: "Add your packages",
    projectName: "Amara & Ben Ito",
    score: 100,
  });
  const consultation = item({
    id: "journey-rosa",
    title: "Rosa & Theo Lang — schedule consultation",
    projectId: "rosa",
    projectName: "Rosa & Theo Lang",
    score: 10,
  });
  assert.equal(todayHeadline([gap, consultation], [])?.id, "setup-packages");
});

test("studio plumbing still never headlines over client work", () => {
  // Names no client, so it is not client work however highly it ranks.
  const connector = item({
    id: "connection-conn-1",
    title: "Reconnect QuickBooks",
    score: 1000,
  });
  const job = item({
    id: "journey-smith",
    title: "Smith Wedding — prepare proposal",
    projectId: "smith",
    projectName: "Smith Wedding",
    score: 5,
  });
  const headline = todayHeadline([connector, job], []);
  assert.equal(headline?.projectName, "Smith Wedding");
});

test("plumbing headlines when there is genuinely no client work", () => {
  const connector = item({
    id: "connection-conn-1",
    title: "Reconnect QuickBooks",
    score: 1000,
  });
  assert.equal(todayHeadline([connector], [])?.id, "connection-conn-1");
});

test("the highest-ranked client item wins among several", () => {
  const low = item({ id: "a", projectName: "A", score: 1 });
  const high = item({ id: "b", projectName: "B", score: 99 });
  assert.equal(todayHeadline([low, high], [])?.id, "b");
});

test("no items yields no headline", () => {
  assert.equal(todayHeadline([], []), null);
});
