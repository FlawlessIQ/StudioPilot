import assert from "node:assert/strict";
import test from "node:test";
import {
  groupThreadByDay,
  projectThread,
  type ThreadInput,
} from "@/features/journey/thread";

const base: ThreadInput = {
  projectId: "project-1",
  projectName: "Chen Wedding",
  projectCreatedAt: "2026-08-12T10:00:00.000Z",
  clientName: "Ava",
};

test("a thread reads oldest first, so the newest sits by the composer", () => {
  const entries = projectThread({
    ...base,
    lead: {
      id: "lead-1",
      createdAt: "2026-08-12T09:00:00.000Z",
      message: "We're getting married in October!",
    },
    proposals: [
      {
        id: "p-1",
        createdAt: "2026-08-20T10:00:00.000Z",
        version: 1,
        status: "sent",
        sentAt: "2026-08-20T11:00:00.000Z",
        pricingSnapshot: { totalCents: 650000, packageName: "Heirloom" },
      },
    ],
  });
  const times = entries.map((entry) => entry.at);
  assert.deepEqual(times, [...times].sort());
  assert.equal(entries[0]?.id, "lead-lead-1");
  assert.equal(entries.at(-1)?.title, "Proposal sent to the client");
});

test("the inquiry opens the thread in the client's voice", () => {
  const [first] = projectThread({
    ...base,
    lead: {
      id: "lead-1",
      createdAt: "2026-08-12T09:00:00.000Z",
      message: "We love documentary coverage.",
    },
  });
  assert.equal(first?.actor, "client");
  assert.equal(first?.title, "Ava got in touch");
  assert.equal(first?.detail, "We love documentary coverage.");
});

test("a job with no lead still opens honestly", () => {
  const [first] = projectThread(base);
  assert.equal(first?.actor, "studio");
  assert.equal(first?.title, "You started this job");
});

test("artifact entries carry live facts so the card can be operated", () => {
  const entries = projectThread({
    ...base,
    proposals: [
      {
        id: "p-1",
        createdAt: "2026-08-20T10:00:00.000Z",
        version: 2,
        status: "accepted",
        expiresAt: "2026-09-03T00:00:00.000Z",
        pricingSnapshot: {
          totalCents: 650000,
          currency: "USD",
          packageName: "The Heirloom Collection",
        },
      },
    ],
  });
  const card = entries.find((entry) => entry.artifact?.type === "proposal");
  assert.equal(card?.title, "Proposal v2 — The Heirloom Collection");
  assert.deepEqual(card?.artifact?.facts, [
    "$6,500",
    "Accepted",
    "expires 2026-09-03",
  ]);
  assert.equal(card?.artifact?.href, "/studio/proposals/p-1");
});

test("provider-verified moments are attributed to the provider, not the studio", () => {
  const entries = projectThread({
    ...base,
    contracts: [
      {
        id: "c-1",
        sentAt: "2026-08-21T10:00:00.000Z",
        completedAt: "2026-08-22T10:00:00.000Z",
        status: "completed",
        provider: "docusign",
      },
    ],
  });
  const signed = entries.find((entry) => entry.id === "contract-signed-c-1");
  assert.equal(signed?.actor, "provider");
  assert.equal(signed?.title, "Agreement fully signed");
});

test("a payment is the client's action; the engine's follow-through is StudioCue's", () => {
  const entries = projectThread({
    ...base,
    invoices: [
      {
        id: "i-1",
        kind: "retainer",
        createdAt: "2026-08-22T10:00:00.000Z",
        paidAt: "2026-08-23T10:00:00.000Z",
        amountCents: 195000,
        status: "paid",
      },
    ],
    actionReceipts: [
      {
        id: "r-1",
        status: "completed",
        completedAt: "2026-08-23T10:05:00.000Z",
        title: "Booking completed automatically",
      },
    ],
  });
  assert.equal(
    entries.find((entry) => entry.id === "invoice-paid-i-1")?.actor,
    "client",
  );
  assert.equal(
    entries.find((entry) => entry.id === "receipt-r-1")?.actor,
    "studiocue",
  );
});

test("records without a usable timestamp are dropped, never dated to now", () => {
  const entries = projectThread({
    ...base,
    projectCreatedAt: null,
    proposals: [{ id: "p-1", status: "draft", version: 1 }],
  });
  assert.deepEqual(entries, []);
});

test("entries group into day buckets in order", () => {
  const days = groupThreadByDay(
    projectThread({
      ...base,
      lead: { id: "l-1", createdAt: "2026-08-12T09:00:00.000Z" },
      invoices: [
        {
          id: "i-1",
          kind: "retainer",
          createdAt: "2026-08-14T09:00:00.000Z",
          amountCents: 100,
          status: "sent",
        },
      ],
    }),
  );
  assert.deepEqual(
    days.map((bucket) => bucket.day),
    ["2026-08-12", "2026-08-14"],
  );
});
