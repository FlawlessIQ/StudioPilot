/**
 * What an invoice StudioCue issues for a studio says, line for line — the
 * payload the PDF service draws (cloud-run/pdf/invoice.py, /v1/invoices/pdf).
 *
 * Every word and figure is decided here, from the stored invoice and the
 * studio's invoice settings (features/billing/studio-invoice-settings.ts),
 * so the PDF service only lays it out and a test can read exactly what the
 * client will see. Money is integer cents until the last step.
 *
 * functions/src/billing/studio-invoice-document.ts is a copy of everything
 * below the marker; tests/studio-invoice-document.test.ts fails on a drift.
 */

// --- shared with functions/src/billing/studio-invoice-document.ts ---
export type StudioInvoicePdfLine = {
  description: string;
  quantity: string;
  unit_amount: string;
  amount: string;
};

export type StudioInvoicePdfRow = { label: string; amount: string };

export type StudioInvoicePdfPayload = {
  invoice_id: string;
  project_id: string;
  invoice_number: string;
  /** "Deposit", "Final balance" … under the INVOICE heading. */
  kind_label: string;
  /** "PAID", "VOID" or "" — stamped across the totals. */
  stamp: string;
  issued_on: string;
  due_on: string;
  studio: {
    name: string;
    address_lines: string[];
    email: string;
    phone: string;
    logo_url: string;
  };
  bill_to: { name: string; email: string; address_lines: string[] };
  /** "Maya & Theo Johnson · Saturday, June 12, 2027". */
  job_line: string;
  lines: StudioInvoicePdfLine[];
  /** Subtotal, tax, total — in order, the last one is the total. */
  totals: StudioInvoicePdfRow[];
  /** Each payment already received, then "Balance due". */
  payments: StudioInvoicePdfRow[];
  balance_due: string;
  payment_instructions: string;
  pay_link: string;
  footer: string;
  generated_at: string;
};

export type StudioInvoiceSource = {
  id: string;
  projectId: string;
  kind: string;
  number: string;
  status: string;
  currency: string;
  amountCents: number;
  balanceCents: number;
  taxCents: number;
  issuedAt: string | null;
  dueDate: string | null;
  paidInFull: boolean;
  payLinkUrl: string | null;
  lines: Array<{ description: string; quantity: number; unitAmountCents: number; amountCents: number }>;
  payments: Array<{ amountCents: number; paidAt: string | null; method: string | null }>;
};

export type StudioInvoiceStudio = {
  name: string;
  logoUrl: string | null;
  settings: {
    businessName: string | null;
    businessAddress: string | null;
    businessEmail: string | null;
    businessPhone: string | null;
    paymentInstructions: string | null;
    payLinkUrl: string | null;
    tax: { rateBasisPoints: number | null; label: string | null };
    footer: string | null;
  };
};

export type StudioInvoiceClient = {
  name: string | null;
  email: string | null;
  addressLines: string[];
};

export type StudioInvoiceJob = {
  name: string | null;
  eventDate: string | null;
};

const MAX_LINES = 40;

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const textOf = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const cents = (value: unknown): number => {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.round(number) : 0;
};

const clip = (value: string, limit: number) => (value.length > limit ? `${value.slice(0, limit - 1)}…` : value);

/** 120000 → "$1,200.00". Negative amounts read "−$50.00". */
export function invoiceMoney(amountCents: number, currency = "USD"): string {
  const value = Math.round(amountCents) / 100;
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: /^[A-Z]{3}$/.test(currency) ? currency : "USD",
  }).format(Math.abs(value));
  return value < 0 ? `−${formatted}` : formatted;
}

/** "2026-10-23" → "October 23, 2026". Anything else is returned as given. */
export function invoiceDate(value: string | null | undefined): string {
  const day = textOf(value).slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return textOf(value);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}

/** "Saturday, June 12, 2027" for the job line. */
function eventDay(value: string | null): string {
  const day = textOf(value).slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** The client's word for a bill: never "retainer_invoice" or "final". */
export function invoiceKindLabel(kind: string, paidInFull: boolean): string {
  if (paidInFull) return "Payment in full";
  if (kind === "retainer") return "Deposit";
  if (kind === "final") return "Final balance";
  if (kind === "adjustment") return "Booking change";
  return "Invoice";
}

/**
 * A stored `invoiceReferences` document, as the invoice source — or null when
 * it isn't one StudioCue issues (a QuickBooks bill, a payment recorded with
 * no bill behind it), which never gets a StudioCue PDF.
 */
export function studioInvoiceSource(id: string, raw: unknown): StudioInvoiceSource | null {
  const invoice = record(raw);
  if (invoice.billedBy !== "studio" || invoice.provider) return null;
  const number = textOf(invoice.number);
  if (!number) return null;
  const lines = (Array.isArray(invoice.lines) ? invoice.lines : []).slice(0, MAX_LINES).map((value) => {
    const line = record(value);
    const quantity = Math.max(1, cents(line.quantity));
    const amountCents = cents(line.amountCents);
    return {
      description: textOf(line.description) || "Services",
      quantity,
      unitAmountCents: line.unitAmountCents === undefined ? Math.round(amountCents / quantity) : cents(line.unitAmountCents),
      amountCents,
    };
  });
  const payments = (Array.isArray(invoice.studioPayments) ? invoice.studioPayments : [])
    .map(record)
    .filter((payment) => cents(payment.amountCents) > 0)
    .map((payment) => ({
      amountCents: cents(payment.amountCents),
      paidAt: textOf(payment.paidAt) || null,
      method: textOf(payment.method) || null,
    }));
  return {
    id,
    projectId: textOf(invoice.projectId),
    kind: textOf(invoice.kind),
    number,
    status: textOf(invoice.status),
    currency: textOf(invoice.currency) || "USD",
    amountCents: cents(invoice.amountCents),
    balanceCents: Math.max(0, cents(invoice.balanceCents)),
    taxCents: Math.max(0, cents(invoice.taxCents)),
    issuedAt: textOf(invoice.issuedAt) || textOf(invoice.createdAt) || null,
    dueDate: textOf(invoice.dueDate) || null,
    paidInFull: invoice.paidInFull === true,
    payLinkUrl: textOf(invoice.payLinkUrl) || null,
    lines,
    payments,
  };
}

/**
 * The printed invoice.
 *
 * The lines add up to the subtotal; tax is the stored `taxCents` (worked out
 * when the bill was issued, never re-derived from today's rate); the total is
 * the bill's `amountCents`. Payments received are listed with their dates and
 * the balance due is the stored balance, so the PDF can't disagree with the
 * portal or Today.
 */
export function studioInvoicePdfPayload(input: {
  invoice: StudioInvoiceSource;
  studio: StudioInvoiceStudio;
  client: StudioInvoiceClient;
  job: StudioInvoiceJob;
  generatedAt: string;
}): StudioInvoicePdfPayload {
  const { invoice, studio, client, job } = input;
  const currency = invoice.currency;
  const settings = studio.settings;
  const taxCents = invoice.taxCents;
  const subtotalCents = invoice.amountCents - taxCents;
  const lines = invoice.lines.length
    ? invoice.lines
    : [
        {
          description: invoiceKindLabel(invoice.kind, invoice.paidInFull),
          quantity: 1,
          unitAmountCents: subtotalCents,
          amountCents: subtotalCents,
        },
      ];
  const totals: StudioInvoicePdfRow[] = [];
  if (taxCents > 0) {
    totals.push({ label: "Subtotal", amount: invoiceMoney(subtotalCents, currency) });
    const rate = settings.tax.rateBasisPoints;
    const label = settings.tax.label ?? "Sales tax";
    totals.push({
      label: rate !== null ? `${label} (${(rate / 100).toFixed(rate % 100 === 0 ? 0 : 2).replace(/\.?0+$/, "")}%)` : label,
      amount: invoiceMoney(taxCents, currency),
    });
  }
  totals.push({ label: "Total", amount: invoiceMoney(invoice.amountCents, currency) });
  // Each payment received, when they account for exactly what's been paid.
  // A correction, or a whole bill recorded paid with no entries, can leave
  // them out of step with the balance — then one "Paid to date" line, so the
  // printed arithmetic always holds.
  const paidCents = Math.max(0, invoice.amountCents - invoice.balanceCents);
  const listed = invoice.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
  const payments: StudioInvoicePdfRow[] =
    paidCents === 0
      ? []
      : listed === paidCents
        ? invoice.payments.map((payment) => ({
            label: ["Paid", payment.paidAt ? invoiceDate(payment.paidAt) : "", payment.method ? `\u00b7 ${clip(payment.method, 40)}` : ""]
              .filter(Boolean)
              .join(" "),
            amount: invoiceMoney(-payment.amountCents, currency),
          }))
        : [{ label: "Paid to date", amount: invoiceMoney(-paidCents, currency) }];
  const voided = invoice.status === "voided";
  const paid = !voided && invoice.balanceCents === 0 && invoice.amountCents > 0;
  const addressLines = (settings.businessAddress ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6);
  const dueOn = paid
    ? "Paid"
    : invoice.dueDate && invoice.issuedAt && invoice.dueDate.slice(0, 10) <= invoice.issuedAt.slice(0, 10)
      ? "Due on receipt"
      : invoice.dueDate
        ? invoiceDate(invoice.dueDate)
        : "Due on receipt";
  const jobDay = eventDay(job.eventDate);
  return {
    invoice_id: invoice.id,
    project_id: invoice.projectId,
    invoice_number: invoice.number,
    kind_label: invoiceKindLabel(invoice.kind, invoice.paidInFull),
    stamp: voided ? "VOID" : paid ? "PAID" : "",
    issued_on: invoiceDate(invoice.issuedAt),
    due_on: dueOn,
    studio: {
      name: clip(settings.businessName ?? studio.name, 120),
      address_lines: addressLines.map((line) => clip(line, 120)),
      email: clip(settings.businessEmail ?? "", 200),
      phone: clip(settings.businessPhone ?? "", 40),
      logo_url: studio.logoUrl ?? "",
    },
    bill_to: {
      name: clip(textOf(client.name) || "Client", 200),
      email: clip(textOf(client.email), 200),
      address_lines: client.addressLines.map((line) => clip(line.trim(), 120)).filter(Boolean).slice(0, 6),
    },
    job_line: clip([textOf(job.name), jobDay].filter(Boolean).join(" · "), 300),
    lines: lines.slice(0, MAX_LINES).map((line) => ({
      description: clip(line.description, 240),
      quantity: String(line.quantity),
      unit_amount: invoiceMoney(line.unitAmountCents, currency),
      amount: invoiceMoney(line.amountCents, currency),
    })),
    totals,
    payments,
    balance_due: invoiceMoney(voided ? 0 : invoice.balanceCents, currency),
    // Instructions and a link are only for a bill still owed.
    payment_instructions: paid || voided ? "" : clip(settings.paymentInstructions ?? "", 1000),
    pay_link: paid || voided ? "" : (invoice.payLinkUrl ?? settings.payLinkUrl ?? ""),
    footer: clip(settings.footer ?? "", 500),
    generated_at: input.generatedAt,
  };
}

/** "inv-0042-maya-theo-johnson.pdf": the name the client saves it under. */
export function studioInvoiceFileName(number: string, jobName: string | null): string {
  const slug = `${number}-${jobName ?? ""}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return `${slug || "invoice"}.pdf`;
}
