import assert from "node:assert/strict";
import { test } from "node:test";
import {
  describeProviderFailure,
  groupProviderFailures,
} from "@/features/today/provider-failure";

/**
 * The production walk found the studio's whole "Already late" band was three
 * cards reading "A provider step could not finish" — two of them the same step
 * retried, all three exposing the internal job type.
 */

test("a known step is described by what did not happen", () => {
  assert.equal(
    describeProviderFailure("create_dropbox_sign_request").title,
    "The agreement didn't go out for signature",
  );
  assert.equal(
    describeProviderFailure("create_dropbox_sign_request").provider,
    "Dropbox Sign",
  );
  assert.equal(
    describeProviderFailure("create_quickbooks_invoice").title,
    "The invoice wasn't created",
  );
});

test("no description leaks the internal job type", () => {
  const types = [
    "create_docusign_envelope",
    "create_dropbox_sign_request",
    "create_quickbooks_invoice",
    "reconcile_quickbooks_invoice",
    "create_stripe_invoice",
    "create_consultation_resources",
    "capture_zoom_meeting_summary",
    "upload_dropbox_document",
    "add_crew_calendar_invite",
    "complete_booking_side_effects",
    "some_future_unmapped_type",
  ];
  for (const type of types) {
    const { title } = describeProviderFailure(type);
    assert.doesNotMatch(title, /_/, `${type} leaked an identifier`);
    assert.doesNotMatch(
      title.toLowerCase(),
      /\bcreate\b|\breconcile\b|\bcapture\b/,
      `${type} reads as a function name`,
    );
  }
});

test("an unmapped type falls back to plain language, never the raw type", () => {
  const { title, provider } = describeProviderFailure("create_widget_thing");
  assert.match(title, /didn't finish/);
  assert.doesNotMatch(title, /widget/);
  assert.equal(provider, null);
});

test("a missing or odd type does not throw", () => {
  for (const type of [null, undefined, 0, {}, ""]) {
    assert.ok(describeProviderFailure(type).title.length > 0);
  }
});

test("retries of the same step collapse to one entry with a count", () => {
  // The exact production shape: the same step failed twice, plus a second step.
  const jobs = [
    { id: "a", projectId: "smith", type: "create_dropbox_sign_request", createdAt: "2026-08-24T10:00:00Z" },
    { id: "b", projectId: "smith", type: "create_dropbox_sign_request", createdAt: "2026-08-25T10:00:00Z" },
    { id: "c", projectId: "smith", type: "create_quickbooks_invoice", createdAt: "2026-08-25T11:00:00Z" },
  ];
  const grouped = groupProviderFailures(jobs);
  assert.equal(grouped.length, 2);
  const sign = grouped.find((g) => g.job.type === "create_dropbox_sign_request");
  assert.equal(sign?.attempts, 2);
  // The oldest attempt represents the group, so "waiting N days" stays truthful.
  assert.equal(sign?.job.id, "a");
  assert.equal(
    grouped.find((g) => g.job.type === "create_quickbooks_invoice")?.attempts,
    1,
  );
});

test("the same step on different projects stays separate", () => {
  const grouped = groupProviderFailures([
    { id: "a", projectId: "smith", type: "create_quickbooks_invoice", createdAt: "2026-08-24T10:00:00Z" },
    { id: "b", projectId: "chen", type: "create_quickbooks_invoice", createdAt: "2026-08-24T10:00:00Z" },
  ]);
  assert.equal(grouped.length, 2);
});

test("the oldest attempt wins regardless of input order", () => {
  const newestFirst = groupProviderFailures([
    { id: "new", projectId: "p", type: "t", createdAt: "2026-08-26T10:00:00Z" },
    { id: "old", projectId: "p", type: "t", createdAt: "2026-08-20T10:00:00Z" },
  ]);
  assert.equal(newestFirst[0]?.job.id, "old");
  assert.equal(newestFirst[0]?.attempts, 2);
});

test("an empty list yields nothing", () => {
  assert.deepEqual(groupProviderFailures([]), []);
});
