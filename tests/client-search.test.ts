import assert from "node:assert/strict";
import test from "node:test";
import {
  clientListEmptyState,
  clientListView,
  clientMatchesSearch,
  searchClientList,
} from "@/features/contacts/client-search";

/**
 * Production, 2026-10-06: searching "t14" on Clients said "No clients match"
 * while the Active tab listed Pick Test, conor+t14@flawlessiq.com. The list
 * only ever compared the query with the display name.
 */

const PICK = {
  id: "pick",
  displayName: "Pick Test",
  firstName: "Pick",
  lastName: "Test",
  email: "conor+t14@flawlessiq.com",
  phone: "+1 (212) 555-0187",
  company: "Northstar Events",
  contactTypes: ["client"],
  archivedAt: null,
};
const SMITH = {
  id: "smith",
  displayName: "Emma Smith",
  email: "emma@example.test",
  contactTypes: ["client"],
  archivedAt: null,
};
const CHEN = {
  id: "chen",
  displayName: "Lily Chen",
  email: "lily.chen@example.test",
  contactTypes: ["client"],
  archivedAt: "2026-09-01T00:00:00.000Z",
};
const RIVERA = {
  id: "rivera",
  displayName: "Ana Rivera",
  email: "ana@example.test",
  contactTypes: ["prospect"],
  archivedAt: null,
};
const ALL = [PICK, SMITH, CHEN, RIVERA];

test("an email matches on any part of it, the + included", () => {
  for (const query of ["t14", "T14", "conor+t14", "conor+t14@flawlessiq.com", "flawlessiq"])
    assert.ok(clientMatchesSearch(PICK, query), query);
  assert.equal(clientMatchesSearch(SMITH, "t14"), false);
});

test("an email pasted into the address bar still matches once + reads as a space", () => {
  // `?q=conor+t14@flawlessiq.com` arrives as "conor t14@flawlessiq.com".
  assert.ok(clientMatchesSearch(PICK, "conor t14@flawlessiq.com"));
});

test("name, display name, phone and company all match, in any case and order", () => {
  for (const query of ["pick", "PICK TEST", "test pick", "Northstar", "events", "  pick  "])
    assert.ok(clientMatchesSearch(PICK, query), query);
});

test("a phone number matches however it is typed", () => {
  for (const query of ["212-555-0187", "2125550187", "(212) 555", "555.0187", "+1 212"])
    assert.ok(clientMatchesSearch(PICK, query), query);
  assert.equal(clientMatchesSearch(PICK, "999-0000"), false);
});

test("a contact with no phone or email is still searchable by name", () => {
  assert.ok(clientMatchesSearch({ displayName: "Walk In" }, "walk"));
  assert.equal(clientMatchesSearch({ displayName: "Walk In" }, "555"), false);
});

test("the open tab lists its matches; no query lists the whole tab", () => {
  assert.deepEqual(
    searchClientList(ALL, "active", "t14").rows.map((row) => row.id),
    ["pick"],
  );
  assert.deepEqual(
    searchClientList(ALL, "active", "").rows.map((row) => row.id),
    ["pick", "smith"],
  );
  assert.deepEqual(searchClientList(ALL, "active", "").elsewhere, []);
  assert.deepEqual(
    searchClientList(ALL, "archived", "").rows.map((row) => row.id),
    ["chen"],
  );
});

test("matches in other tabs are counted, by tab", () => {
  assert.deepEqual(searchClientList(ALL, "active", "example.test").elsewhere, [
    { view: "prospects", count: 1 },
    { view: "archived", count: 1 },
  ]);
  assert.deepEqual(searchClientList(ALL, "archived", "t14").elsewhere, [
    { view: "active", count: 1 },
  ]);
});

test("an empty tab with matches elsewhere says where, and links there with the search", () => {
  const { elsewhere } = searchClientList(ALL, "active", "chen");
  assert.deepEqual(clientListEmptyState("active", "chen", elsewhere), {
    state: "No active clients match “chen”",
    detail: "1 archived client matches.",
    action: { href: "?view=archived&q=chen", label: "Show archived clients" },
  });
  const plus = searchClientList(ALL, "archived", "conor+t14");
  assert.equal(
    clientListEmptyState("archived", "conor+t14", plus.elsewhere).action?.href,
    "?view=active&q=conor%2Bt14",
  );
  const two = clientListEmptyState("archived", "ana", [
    { view: "active", count: 2 },
    { view: "prospects", count: 1 },
  ]);
  assert.equal(two.state, "No archived clients match “ana”");
  assert.equal(two.detail, "2 active clients and 1 prospect match.");
});

test("a search that finds nobody anywhere says so; an empty tab offers Add client", () => {
  assert.deepEqual(clientListEmptyState("active", "zzz", []), {
    state: "No clients match “zzz”",
    detail: "Try a name, email, phone number or company, or clear the search.",
  });
  assert.equal(clientListEmptyState("prospects", "", []).state, "No prospects yet");
  assert.equal(
    clientListEmptyState("archived", "", []).action?.label,
    "Add client",
  );
});

test("an unknown view is the Active tab", () => {
  assert.equal(clientListView(undefined), "active");
  assert.equal(clientListView("everything"), "active");
  assert.equal(clientListView("archived"), "archived");
});
