import assert from "node:assert/strict";
import test from "node:test";
import { resolveInvoiceSchedule } from "@/server/services/invoice-scheduling";

test("default wedding final invoice dates are resolved from the event date", () => {
  assert.deepEqual(resolveInvoiceSchedule("2026-09-19", {
    finalInvoiceDaysBeforeEvent: 28,
    finalPaymentDaysBeforeEvent: 14,
  }), {
    createOn: "2026-08-22",
    dueOn: "2026-09-05",
    reviewOn: "2026-09-06",
  });
});

test("invoice creation cannot be configured after its due date", () => {
  assert.throws(() => resolveInvoiceSchedule("2026-09-19", {
    finalInvoiceDaysBeforeEvent: 7,
    finalPaymentDaysBeforeEvent: 14,
  }), /on or before/);
});
