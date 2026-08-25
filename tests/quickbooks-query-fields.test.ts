import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * QuickBooks only lets you filter on some properties, and it does not fail
 * quietly: a query on anything else returns 400 QueryValidationError, which
 * dead-letters the job that was trying to invoice somebody.
 *
 * That happened. A duplicate guard searched Invoice on PrivateNote, which
 * carries the StudioCue invoice id and reads perfectly well but cannot be
 * filtered. The guard 400'd and blocked the create it existed to protect,
 * so the retainer could not be raised at all.
 *
 * The allowlist below is from Intuit's entity reference — the "filterable"
 * column. Adding a field here should mean checking the docs, not guessing,
 * which is the step that was skipped.
 */
const QUERYABLE: Record<string, Set<string>> = {
  Invoice: new Set([
    "Id",
    "DocNumber",
    "TxnDate",
    "DueDate",
    "Balance",
    "TotalAmt",
    "CustomerRef",
    "MetaData.CreateTime",
    "MetaData.LastUpdatedTime",
  ]),
  Customer: new Set([
    "Id",
    "DisplayName",
    "GivenName",
    "FamilyName",
    "CompanyName",
    "PrimaryEmailAddr",
    "Active",
    "MetaData.CreateTime",
    "MetaData.LastUpdatedTime",
  ]),
  Item: new Set([
    "Id",
    "Name",
    "Type",
    "Active",
    "MetaData.CreateTime",
    "MetaData.LastUpdatedTime",
  ]),
  Account: new Set([
    "Id",
    "Name",
    "AccountType",
    "AccountSubType",
    "Active",
    "MetaData.CreateTime",
    "MetaData.LastUpdatedTime",
  ]),
};

test("every QuickBooks query filters on a property QuickBooks will filter on", () => {
  const source = readFileSync(
    "functions/src/operations/provider-runtime.ts",
    "utf8",
  );
  // The queries are built as template literals inside encodeURIComponent.
  const queries = [...source.matchAll(/select [^`]*? from (\w+)([^`]*)/gi)];
  assert.ok(queries.length > 0, "found no QuickBooks queries to check");

  for (const [, entity, remainder] of queries) {
    const allowed = QUERYABLE[entity];
    assert.ok(allowed, `no queryable-field list recorded for ${entity}`);
    // Every `where X` / `and X` comparison in the tail of the query.
    const fields = [
      ...remainder.matchAll(/(?:where|and)\s+([A-Za-z][\w.]*)\s*(?:=|!=|<|>|like|in)/gi),
    ].map((match) => match[1]!);
    assert.ok(
      fields.length > 0,
      `${entity} query has no parsed filter — check the regex, not the query`,
    );
    for (const field of fields) {
      assert.ok(
        allowed.has(field),
        `${entity}.${field} is not filterable in QuickBooks — the query will 400 with QueryValidationError`,
      );
    }
  }
});
