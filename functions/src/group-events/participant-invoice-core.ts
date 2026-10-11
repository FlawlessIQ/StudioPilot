/**
 * A QuickBooks invoice for each parent at a group event — the pure part
 * (docs/group-event-signup-plan-2026-10-10.md, Phase 4b).
 *
 * The invoice lives on the parent's own record (`eventParticipants/{id}`,
 * field `qbInvoice`), never in `invoiceReferences`. Some twenty readers sum
 * a job's invoices — the client portal, the final balance, Today's overdue
 * cards, the booking gate's "existing bills" — and on a group event the
 * job's client is the organiser: a parent's bill there would have shown as
 * the organiser's balance, in the organiser's portal.
 *
 * No I/O here (a hash for a job id aside); participant-invoices.ts does
 * the QuickBooks calls.
 */

import { createHash } from "node:crypto";

import type { ParticipantInvoiceState } from "./signup.js";

export {
  CREATE_PARTICIPANT_INVOICE_JOB,
  participantInvoiceJobId,
  participantInvoiceOpen,
  participantInvoiceRequestId,
  participantInvoiceSendable,
  type ParticipantInvoiceState,
} from "./signup.js";
export const RECONCILE_PARTICIPANT_INVOICE_JOB = "reconcile_quickbooks_participant_invoice";
export const VOID_PARTICIPANT_INVOICE_JOB = "void_quickbooks_participant_invoice";

export type ParticipantInvoice = {
  state: ParticipantInvoiceState;
  jobId: string;
  /** Bumped each time the studio sends a new one, so its QuickBooks request is new too. */
  attempt: number;
  providerInvoiceId: string | null;
  providerCustomerId: string | null;
  docNumber: string | null;
  hostedUrl: string | null;
  totalCents: number | null;
  balanceCents: number | null;
  /** "studiocue": our email with the pay link. "quickbooks": no link, so QuickBooks sent it. */
  deliveredBy: "studiocue" | "quickbooks" | "mock" | null;
  error: { code: string; message: string } | null;
  requestedAt: string;
  updatedAt: string;
};


/**
 * The job that withdraws a parent's invoice in QuickBooks: once per invoice,
 * so paying in cash and then being cancelled asks for one void, not two.
 */
export function participantInvoiceVoidJob(input: {
  participantId: string;
  tenantId: string;
  projectId: string | null;
  providerInvoiceId: string;
  now: string;
}): { id: string; data: Record<string, unknown> } {
  const id = `participant_invoice_void_${createHash("sha256").update(`${input.participantId}:${input.providerInvoiceId}`).digest("hex").slice(0, 32)}`;
  return {
    id,
    data: {
      id,
      tenantId: input.tenantId,
      projectId: input.projectId,
      participantId: input.participantId,
      providerInvoiceId: input.providerInvoiceId,
      type: VOID_PARTICIPANT_INVOICE_JOB,
      idempotencyKey: id,
      status: "queued",
      attempts: 0,
      createdAt: input.now,
      updatedAt: input.now,
    },
  };
}

/**
 * The one line on a parent's invoice. No tax: event prices are what parents
 * pay (Conor, 2026-10-10). A company that charges sales tax gets the line
 * marked non-taxable, so QuickBooks' automated sales tax adds nothing.
 */
export function participantInvoiceLines(input: {
  amountCents: number;
  athleteName: string;
  packageName: string | null;
  eventName: string | null;
  itemRef: { value: string; name?: string };
  taxable: "none" | "codes";
}): Array<Record<string, unknown>> {
  const amount = Math.round(input.amountCents) / 100;
  const description = [
    `${input.athleteName}${input.packageName ? ` — ${input.packageName}` : ""}`,
    input.eventName ? `(${input.eventName})` : "",
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 4000);
  return [
    {
      Amount: amount,
      DetailType: "SalesItemLineDetail",
      Description: description,
      SalesItemLineDetail: {
        ItemRef: input.itemRef,
        Qty: 1,
        UnitPrice: amount,
        ...(input.taxable === "codes" ? { TaxCodeRef: { value: "NON" } } : {}),
      },
    },
  ];
}

/**
 * What QuickBooks reports, as the parent's invoice state. A deleted or
 * voided invoice is withdrawn whatever its amounts; otherwise the balance
 * decides.
 */
export function participantInvoiceStanding(input: {
  operation?: string | null;
  totalCents: number;
  balanceCents: number;
}): "paid" | "partially_paid" | "open" | "voided" {
  const operation = String(input.operation ?? "").toLowerCase();
  if (["delete", "deleted", "void", "voided"].includes(operation)) return "voided";
  // A voided QuickBooks invoice keeps its lines at zero: total and balance 0.
  if (input.totalCents === 0 && input.balanceCents === 0) return "voided";
  if (input.balanceCents <= 0) return "paid";
  if (input.balanceCents < input.totalCents) return "partially_paid";
  return "open";
}

/**
 * The parent as a QuickBooks customer: their name, or — when another
 * customer already has that name — their name and email, since QuickBooks
 * names are unique across customers, vendors and employees.
 */
export function participantCustomerNames(parentName: string, email: string): [string, string] {
  const name = parentName.replace(/\s+/g, " ").trim().slice(0, 100) || email;
  return [name, `${name} (${email})`.slice(0, 100)];
}

/** "Dana Reyes" → given/family for the customer record; one word is a given name. */
export function participantCustomerBody(input: { displayName: string; parentName: string; email: string; phone: string | null }): Record<string, unknown> {
  const parts = input.parentName.trim().split(/\s+/).filter(Boolean);
  const given = parts[0] ?? "";
  const family = parts.length > 1 ? parts.slice(1).join(" ") : "";
  return {
    DisplayName: input.displayName,
    ...(given ? { GivenName: given.slice(0, 100) } : {}),
    ...(family ? { FamilyName: family.slice(0, 100) } : {}),
    PrimaryEmailAddr: { Address: input.email },
    ...(input.phone ? { PrimaryPhone: { FreeFormNumber: input.phone.slice(0, 30) } } : {}),
  };
}
