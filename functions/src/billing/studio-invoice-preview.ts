import type { Firestore } from "firebase-admin/firestore";
import { renderPdfService } from "../operations/ai-pdf.js";
import { formatInvoiceNumber, nextInvoiceSequence } from "./invoice-number.js";
import { studioInvoicePdfPayload, type StudioInvoiceSource } from "./studio-invoice-document.js";
import { normaliseStudioInvoiceSettings, studioInvoiceTaxCents } from "./studio-invoice-settings.js";

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/**
 * Settings → Invoices and payments → "Preview a sample invoice".
 *
 * The studio's own details, instructions, tax and footer on a made-up job,
 * numbered with the number its next real invoice will take — rendered by the
 * same service and the same payload builder as a real one, so what the studio
 * sees is what its clients get. Nothing is stored and the counter doesn't move.
 */
export function sampleStudioInvoice(input: {
  number: string;
  rateBasisPoints: number | null;
  today: string;
}): StudioInvoiceSource {
  const lines = [
    { description: "Your package", quantity: 1, unitAmountCents: 250_000, amountCents: 250_000 },
    { description: "An extra", quantity: 2, unitAmountCents: 15_000, amountCents: 30_000 },
  ];
  const subtotal = lines.reduce((sum, line) => sum + line.amountCents, 0);
  const taxCents = studioInvoiceTaxCents(subtotal, { tax: { rateBasisPoints: input.rateBasisPoints, label: null } });
  const amountCents = subtotal + taxCents;
  const due = new Date(`${input.today}T00:00:00Z`);
  due.setUTCDate(due.getUTCDate() + 14);
  return {
    id: "sample",
    projectId: "sample",
    kind: "final",
    number: input.number,
    status: "sent",
    currency: "USD",
    amountCents,
    balanceCents: amountCents - 50_000,
    taxCents,
    issuedAt: input.today,
    dueDate: due.toISOString().slice(0, 10),
    paidInFull: false,
    payLinkUrl: null,
    lines,
    payments: [{ amountCents: 50_000, paidAt: input.today, method: "Deposit" }],
  };
}

export async function previewStudioInvoice(db: Firestore, tenantId: string): Promise<Buffer> {
  const [tenant, settingsDoc, counter] = await Promise.all([
    db.doc(`tenants/${tenantId}`).get(),
    db.doc(`billingSettings/${tenantId}`).get(),
    db.doc(`invoiceCounters/${tenantId}`).get(),
  ]);
  const settings = normaliseStudioInvoiceSettings(
    settingsDoc.exists && settingsDoc.get("tenantId") === tenantId ? settingsDoc.data() : null,
  );
  const today = new Date().toISOString().slice(0, 10);
  const eventDate = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
  const payload = studioInvoicePdfPayload({
    invoice: sampleStudioInvoice({
      number: formatInvoiceNumber(
        nextInvoiceSequence(counter.exists && counter.get("tenantId") === tenantId ? counter.data() : null),
      ),
      rateBasisPoints: settings.tax.rateBasisPoints,
      today,
    }),
    studio: {
      name: text(tenant.get("brandName")) || text(tenant.get("businessName")) || "Studio",
      logoUrl: text(record(tenant.get("emailBranding")).logoUrl) || text(tenant.get("logoUrl")) || null,
      settings,
    },
    client: { name: "Sample Client", email: "client@example.com", addressLines: ["123 Main Street", "Anytown, NY 10001"] },
    job: { name: "Sample job", eventDate },
    generatedAt: new Date().toISOString(),
  });
  return renderPdfService("invoices", payload);
}
