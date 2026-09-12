import assert from "node:assert/strict";
import test from "node:test";
import {
  draftVendorShareMessage,
  scheduleShareSchema,
  shareLinkPath,
  shareStale,
  vendorVisibleItems,
} from "../features/schedules/vendor-share";
import type { ScheduleItem } from "../features/schedules/schema";

const item = (over: Partial<ScheduleItem>): ScheduleItem => ({
  id: over.id ?? "i1",
  startAt: "2026-08-15T14:00:00.000Z",
  endAt: "2026-08-15T15:00:00.000Z",
  title: over.title ?? "Segment",
  description: "",
  location: null,
  address: null,
  travelMinutes: 0,
  photographerIds: [],
  participants: [],
  vendorContactIds: over.vendorContactIds ?? [],
  equipment: [],
  notes: null,
  visibility: over.visibility ?? "shared",
  blockingIssues: [],
  sourceReferences: [],
});

test("a vendor never sees a studio-only row, whatever the scope", () => {
  const items = [
    item({ id: "a", visibility: "studio", vendorContactIds: ["v1"] }),
    item({ id: "b", visibility: "shared" }),
  ];
  assert.deepEqual(
    vendorVisibleItems(items, "v1", "vendor").map((i) => i.id),
    ["b"],
    "the studio-only row is hidden even though this vendor is tagged on it",
  );
  assert.deepEqual(
    vendorVisibleItems(items, "v1", "full").map((i) => i.id),
    ["b"],
    "full scope still excludes studio-only rows",
  );
});

test("vendor scope narrows to the vendor's own segments plus shared ones", () => {
  const items = [
    item({ id: "hair", visibility: "crew", vendorContactIds: ["hair-1"] }),
    item({ id: "dj", visibility: "crew", vendorContactIds: ["dj-1"] }),
    item({ id: "everyone", visibility: "shared", vendorContactIds: [] }),
  ];
  assert.deepEqual(
    vendorVisibleItems(items, "dj-1", "vendor").map((i) => i.id),
    ["dj", "everyone"],
    "the DJ sees their own segment and the shared one, not the hair segment",
  );
  assert.deepEqual(
    vendorVisibleItems(items, "dj-1", "full").map((i) => i.id),
    ["hair", "dj", "everyone"],
    "full scope hands over the whole non-studio timeline",
  );
});

test("a share is stale exactly when a newer version has been published", () => {
  assert.equal(shareStale({ sharedVersion: 2 }, 3), true);
  assert.equal(shareStale({ sharedVersion: 3 }, 3), false);
  assert.equal(shareStale({ sharedVersion: 3 }, 2), false);
});

test("the drafted message names the couple, date and a vendor-specific focus", () => {
  const dj = draftVendorShareMessage({
    vendorType: "dj",
    vendorContactName: "Sam",
    coupleNames: "Maya & Theo",
    eventDate: "August 15, 2026",
    venue: "The Foundry",
  });
  assert.match(dj, /Hi Sam,/);
  assert.match(dj, /Maya & Theo/);
  assert.match(dj, /August 15, 2026/);
  assert.match(dj, /The Foundry/);
  assert.match(dj, /reception flow/, "the DJ draft speaks to the reception");

  const hair = draftVendorShareMessage({
    vendorType: "hair_makeup",
    vendorContactName: "",
    coupleNames: "Maya & Theo",
    eventDate: "August 15, 2026",
    venue: null,
  });
  assert.match(hair, /^Hi,/, "a missing contact name degrades to a bare greeting");
  assert.doesNotMatch(hair, /2026 at/, "no venue means no dangling 'date at' clause");
  assert.match(hair, /per person/, "the hair draft asks the timing question");

  const unknown = draftVendorShareMessage({
    vendorType: "officiant",
    vendorContactName: "Pat",
    coupleNames: "A & B",
    eventDate: "May 1",
    venue: null,
  });
  assert.match(unknown, /confirm it works/, "an untyped vendor still gets a usable ask");

  // The studio can draft from the vendor row before a couple/date is in hand.
  const generic = draftVendorShareMessage({
    vendorType: "dj",
    vendorContactName: "Sam",
    });
  assert.match(generic, /run of show for the wedding/, "generic opener when no couple/date");
  assert.doesNotMatch(generic, /undefined|the wedding day/, "no placeholder leakage");
  assert.match(generic, /reception flow/, "still vendor-type specific");
});

test("shareLinkPath puts the raw token in the path", () => {
  assert.equal(shareLinkPath("abc123"), "/share/abc123");
});

test("the share schema round-trips a complete record", () => {
  const now = "2026-08-01T12:00:00.000Z";
  const parsed = scheduleShareSchema.parse({
    id: "ros_share_deadbeef",
    tenantId: "t1",
    projectId: "p1",
    scheduleId: "sched_9",
    sharedVersion: 2,
    vendorContactId: "v1",
    vendorCompany: "Spin City DJs",
    vendorType: "dj",
    scope: "vendor",
    message: "Hi Sam, ...",
    tokenHash: "f".repeat(64),
    status: "viewed",
    sentAt: now,
    viewedAt: now,
    viewedVersion: 2,
    acknowledgedAt: null,
    acknowledgedVersion: null,
    revokedAt: null,
    expiresAt: "2026-09-01T12:00:00.000Z",
    sendCount: 1,
    createdAt: now,
    updatedAt: now,
    createdBy: "u1",
    updatedBy: "u1",
  });
  assert.equal(parsed.status, "viewed");
  assert.equal(parsed.sharedVersion, 2);
});
