import assert from "node:assert/strict";
import test from "node:test";
import { searchStudio, studioSearchDestinations } from "../features/search/studio-search";
import { todayInbox } from "../features/today/inbox";
import { groupProviderFailures } from "../features/today/provider-failure";
import { assertQuickBooksCheckRetry } from "../functions/src/integrations/retry-quickbooks-check";

test("a studio without records can find how to add packages", () => {
  const destinations = studioSearchDestinations("studio_owner");
  for (const query of ["Add packages", "how do I add a package", "adding packages", "packages add"]) {
    assert.equal(searchStudio(destinations, query)[0]?.href, "/studio/packages/new", query);
  }
  assert.ok(searchStudio(destinations, "quickbooks").some((result) => result.href === "/studio/integrations"));
  assert.ok(searchStudio(destinations, "email branding").some((result) => result.href === "/studio/settings/email-branding"));
  assert.ok(searchStudio(destinations, "proposal").some((result) => result.kind === "Help"));
  assert.equal(searchStudio(destinations, "unfindablexyz").length, 0);
});

test("search matches names, raw dates, and words in any order", () => {
  const values = [{ id: "job", kind: "Project" as const, label: "Zoë & José", detail: "Wedding · June 12, 2027", href: "/studio/projects/job", searchText: "2027-06-12" }];
  for (const query of ["jose zoe", "2027-06-12", "wedding jose"]) assert.equal(searchStudio(values, query).length, 1);
  assert.equal(searchStudio([{ id: "an", kind: "Client", label: "An", detail: "", href: "/studio/clients" }], "An")[0]?.id, "an");
  assert.equal(searchStudio([{ id: "lin", kind: "Client", label: "林明", detail: "", href: "/studio/clients" }], "林明")[0]?.id, "lin");
});

test("staff search does not offer owner setup actions", () => {
  for (const role of ["staff_photographer", "studio_coordinator"] as const) {
    const destinations = studioSearchDestinations(role);
    assert.ok(!destinations.some((result) => result.href === "/studio/packages/new"));
    assert.ok(!destinations.some((result) => result.href === "/studio/integrations"));
    assert.ok(!destinations.some((result) => result.href === "/studio/subscription"));
  }
});

const job = { id: "qb-check", tenantId: "gr", type: "reconcile_quickbooks_money_event", status: "dead_letter", realmId: "company", error: { code: "QUICKBOOKS_NOT_CONNECTED" }, createdAt: "2026-10-05T13:11:30Z" };
const connection = { id: "gr_quickbooks", tenantId: "gr", provider: "quickbooks", providerAccountId: "company", status: "connected", archivedAt: null };

test("a failed check offers retry after reconnecting, including when it headlines Today", () => {
  const input = { now: "2026-10-16T16:00:00Z", providerJobs: [job], integrationConnections: [connection] };
  const item = todayInbox(input).act.find((item) => item.id === "provider-qb-check");
  assert.deepEqual(item?.action, { kind: "quickbooks_check", label: "Retry check", jobId: job.id, connected: true });
  const disconnected = todayInbox({ ...input, integrationConnections: [] }).act[0];
  assert.equal(disconnected?.action.label, "Reconnect QuickBooks");
  assert.equal(todayInbox({ ...input, providerJobs: [{ ...job, dismissedAt: "2026-10-16" }] }).act.length, 0);
  assert.equal(todayInbox({ ...input, providerJobs: [{ ...job, status: "succeeded" }] }).act.length, 0);
});

test("separate money events remain separate checks", () => {
  assert.equal(groupProviderFailures([job, { ...job, id: "another" }]).length, 2);
});

test("retry accepts only the tenant's failed read-only check for the connected company", () => {
  assert.doesNotThrow(() => assertQuickBooksCheckRetry({ tenantId: "gr", job, connection }));
  for (const other of [
    { ...job, tenantId: "other" }, { ...job, type: "create_quickbooks_invoice" },
    { ...job, type: "record_quickbooks_payment" }, { ...job, status: "succeeded" },
    { ...job, status: "processing" }, { ...job, realmId: "different-company" },
  ]) assert.throws(() => assertQuickBooksCheckRetry({ tenantId: "gr", job: other, connection }));
  for (const other of [{}, { ...connection, status: "disconnected" }, { ...connection, tenantId: "other" }, { ...connection, archivedAt: "2026-10-16" }]) {
    assert.throws(() => assertQuickBooksCheckRetry({ tenantId: "gr", job, connection: other }));
  }
});
