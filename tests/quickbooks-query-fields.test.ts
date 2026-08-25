import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { studioCueDocNumber } from "../functions/src/operations/provider-runtime.ts";

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

test("the invoice reference we send QuickBooks is short, stable and legible", () => {
  // Only reached on a company that numbers nothing itself. QuickBooks caps
  // DocNumber at 21 characters, and a reference a studio cannot read off a
  // bank statement is no use to anyone.
  for (const id of [
    "invoice_86bd6256a3d2b4d8b81aae783f99b14d",
    "invoice_attested_74af81e250c379acfe6255958b91dd38",
    "invoice_59ce054cbc9735c7333bdd6cc41739a5",
  ]) {
    const value = studioCueDocNumber(id);
    assert.ok(value.length <= 21, `${value} exceeds QuickBooks' 21 characters`);
    assert.match(value, /^SC-[0-9A-F]{8}$/);
  }
  // Two invoices must never collide into one reference — that would put two
  // jobs' money under a single number in a studio's books.
  assert.notEqual(
    studioCueDocNumber("invoice_86bd6256a3d2b4d8b81aae783f99b14d"),
    studioCueDocNumber("invoice_59ce054cbc9735c7333bdd6cc41739a5"),
  );
  // The attested prefix is stripped, so an attested invoice is numbered from
  // its own id rather than from the word "attested".
  assert.equal(studioCueDocNumber("invoice_attested_abcdef12ff"), "SC-ABCDEF12");
});
