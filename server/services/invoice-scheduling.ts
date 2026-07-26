import { addDays, formatISO, parseISO, subDays } from "date-fns";

export type InvoiceScheduleRules = {
  finalInvoiceDaysBeforeEvent: number;
  finalPaymentDaysBeforeEvent: number;
};

export function resolveInvoiceSchedule(eventDate: string, rules: InvoiceScheduleRules) {
  if (rules.finalInvoiceDaysBeforeEvent < rules.finalPaymentDaysBeforeEvent) {
    throw new Error("Final invoice must be created on or before its payment due date.");
  }
  const event = parseISO(eventDate);
  if (!Number.isFinite(event.valueOf())) throw new Error("Invalid event date.");
  return {
    createOn: formatISO(subDays(event, rules.finalInvoiceDaysBeforeEvent), { representation: "date" }),
    dueOn: formatISO(subDays(event, rules.finalPaymentDaysBeforeEvent), { representation: "date" }),
    reviewOn: formatISO(addDays(subDays(event, rules.finalPaymentDaysBeforeEvent), 1), { representation: "date" }),
  };
}
