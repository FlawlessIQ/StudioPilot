/**
 * Retainer attestation planning — mirror.
 *
 * `functions/` is a separate package and cannot import from `features/`, so this
 * mirrors features/booking/retainer-attestation.ts. That copy holds the tests
 * and is the source of truth; change both together.
 */

export type RetainerInvoiceRow = {
  id: string;
  status: string;
  balanceCents: number;
};

export type RetainerAttestationPlan =
  | { action: "create" }
  | { action: "settle"; invoiceId: string }
  | { action: "already_paid"; invoiceId: string };

const NOT_STANDING = new Set(["failed", "superseded", "voided"]);

export function isStandingRetainer(status: unknown): boolean {
  return !NOT_STANDING.has(String(status));
}

const settled = (invoice: RetainerInvoiceRow): boolean =>
  invoice.status === "paid" && Number(invoice.balanceCents ?? 0) === 0;

export function planRetainerAttestation(
  invoices: readonly RetainerInvoiceRow[],
): RetainerAttestationPlan {
  const standing = invoices.filter((invoice) =>
    isStandingRetainer(invoice.status),
  );
  const paid = standing.find(settled);
  if (paid) return { action: "already_paid", invoiceId: paid.id };
  const outstanding = standing[0];
  if (outstanding) return { action: "settle", invoiceId: outstanding.id };
  return { action: "create" };
}
