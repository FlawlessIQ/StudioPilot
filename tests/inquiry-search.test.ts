import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { inquiryMatchesSearch, inquirySearchEmptyState, searchInquiries } from "@/features/inquiries/search";

/**
 * The Inquiries list's search, given the Clients fix (2026-10-06): tabs keep
 * the search, the box follows the URL, every word matches anywhere in the name
 * or email, and an empty tab says where the match is.
 */

const read = (path: string) => readFileSync(path, "utf8");
const rows = [
  { name: "Maya Brooks", email: "conor+walk1006@flawlessiq.com", stage: "proposal" as const },
  { name: "Link Check", email: "conor+linkcheck1006@flawlessiq.com", stage: "new" as const },
  { name: "Harper Lane", email: "conor+harper@flawlessiq.com", stage: "closed" as const },
];

test("a search matches every word in the name or email, an email with its + read as a space too", () => {
  assert.equal(inquiryMatchesSearch(rows[0]!, "walk1006"), true);
  assert.equal(inquiryMatchesSearch(rows[0]!, "brooks maya"), true);
  assert.equal(inquiryMatchesSearch(rows[0]!, "conor walk1006@flawlessiq.com"), true);
  assert.equal(inquiryMatchesSearch(rows[0]!, "harper"), false);
});

test("an empty tab says where the match is, with a link that keeps the search", () => {
  const open = searchInquiries(rows, "open", "harper");
  assert.equal(open.rows.length, 0);
  assert.deepEqual(open.elsewhere, [{ view: "closed", count: 1 }]);
  const empty = inquirySearchEmptyState("open", "harper", open.elsewhere)!;
  assert.equal(empty.state, "No open inquiries match “harper”");
  assert.equal(empty.detail, "1 closed inquiry matches.");
  assert.equal(empty.action?.href, "?view=closed&q=harper");
  // A stage tab points at Open (other stages) and Closed, never double-counting.
  assert.deepEqual(searchInquiries(rows, "new", "flawlessiq").elsewhere, [
    { view: "open", count: 1 },
    { view: "closed", count: 1 },
  ]);
  assert.equal(inquirySearchEmptyState("open", "", []), null);
});

test("the tabs keep the search and the box follows the URL", () => {
  const page = read("app/studio/leads/page.tsx");
  // The tabs moved into a client component, to be named in the studio's
  // trade (a makeup artist's "Quote"); they still carry the search.
  assert.match(page, /<InquiryTabs q=\{q\} view=\{view\} \/>/);
  assert.match(read("components/studio/inquiry-tabs.tsx"), /href=\{`\?\$\{new URLSearchParams\(q \? \{ view: value, q \} : \{ view: value \}\)\}`\}/);
  assert.match(page, /defaultValue=\{q\} key=\{q\} name="q"/);
  assert.match(read("components/inquiries/inquiry-pipeline.tsx"), /searchInquiries\(/);
});
