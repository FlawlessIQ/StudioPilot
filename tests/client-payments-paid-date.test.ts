import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * A paid invoice says the day it was paid, never its due date (Priya Shah,
 * Jess Styles Bridal, 2026-10-12: "INV-0001 · Paid · October 24, 2026" for a
 * deposit paid October 10).
 */
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the client portal sends the paid date with an invoice", () => {
  const route = read("app/api/client/portal/route.ts");
  const fields = route.slice(route.indexOf("invoiceReferences: ["), route.indexOf("questionnaireResponses: ["));
  assert.match(fields, /"paidAt"/);
});

test("a paid row prints when it was paid, not when it was due", () => {
  const page = read("components/client/kit/client-payments.tsx");
  assert.doesNotMatch(page, /`Paid · \$\{date\(invoice\.dueDate\)\}`/);
  assert.match(page, /`Paid \$\{date\(paidOn\(invoice\.paidAt\)\)\}`/);
  assert.match(page, /: "Paid",/);
});

test("a hand-recorded paid date is a calendar day; a provider's is an instant", async () => {
  const source = read("components/client/kit/client-payments.tsx");
  const body = source.slice(source.indexOf("export function paidOn"), source.indexOf("export function ClientPayments"));
  const paidOn = new Function(
    "value",
    body.slice(body.indexOf("{") + 1, body.lastIndexOf("}")).replace(/: unknown|: string \| null/g, ""),
  ) as (value: unknown) => string | null;
  assert.equal(paidOn("2026-10-10T00:00:00.000Z"), "2026-10-10");
  assert.equal(paidOn("2026-10-10T00:00:00Z"), "2026-10-10");
  assert.equal(paidOn("2026-10-10T23:30:00.000Z"), "2026-10-10T23:30:00.000Z");
  assert.equal(paidOn(null), null);
  assert.equal(paidOn(""), null);
});
