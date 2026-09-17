import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * The retainer is due when the couple agreed it was due.
 *
 * Found by walking a real booking: the proposal said "Retainer due October 1,
 * 2026" and the couple's portal still said so, while the studio page and the
 * QuickBooks invoice raised against it said September 24 — today plus seven,
 * from whenever the studio happened to click. Of the two, the invoice is the
 * one with money attached.
 */
const source = readFileSync(
  `${process.cwd()}/components/booking/project-booking-workspace.tsx`,
  "utf8",
);

test("the due date comes from the accepted proposal's payment schedule", () => {
  assert.match(source, /const agreedRetainerDueDate = useMemo\(/);
  assert.match(source, /proposal\?\.paymentSchedule/);
  assert.match(source, /toLowerCase\(\)\.includes\("retainer"\)/);
});

test("today plus seven is only the fallback", () => {
  assert.match(
    source,
    /agreedRetainerDueDate \?\? addCalendarDays\(todayLocalIso\(\), 7\)/,
  );
  // And that fallback still goes through the calendar helpers, not toISOString.
  assert.doesNotMatch(source, /setDate\([^)]*\)[\s\S]{0,80}toISOString\(\)\.slice\(0, 10\)/);
});

test("the date raised on the invoice is the date shown to the studio", () => {
  const invoiceCall = source.slice(
    source.indexOf('type: "createRetainerInvoice"'),
    source.indexOf('type: "createRetainerInvoice"') + 400,
  );
  assert.match(invoiceCall, /\n\s+dueDate,/);
});
