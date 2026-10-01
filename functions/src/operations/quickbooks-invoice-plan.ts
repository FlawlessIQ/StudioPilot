import type { DocumentSnapshot, Firestore } from "firebase-admin/firestore";
import { loadAcceptedProposal, loadJobPackageSnapshots } from "../packages/job-package-facts.js";
import { describeCoverage, resolveCoverage } from "../packages/coverage.js";
import { packageInclusionItems } from "../packages/inclusions.js";
import { normaliseBillingSettings, salesTaxApplies } from "../billing/sales-tax-settings.js";
import { gatedFinalLines, quickBooksHoldReason, type HoldReason } from "./quickbooks-final-tax.js";
import {
  billedCrewCount,
  coverageHours,
  quickBooksRetainerLines,
  type InvoiceLine,
  type JobPackageItem,
  type RetainerPart,
} from "./quickbooks-invoice-lines.js";

/**
 * The lines a QuickBooks invoice carries, read from the job's own records.
 *
 * The rules live in quickbooks-invoice-lines.ts (pure, tested); this only
 * gathers what they need — the accepted proposal's lines, each package's
 * snapshot for its coverage and extras, and the studio's package for how it
 * bills the retainer. A record that cannot be read never blocks an invoice:
 * the plan falls back to one line of the amount, which is what StudioCue
 * sent before any of this existed.
 */

type Row = Record<string, unknown>;

export type QuickBooksInvoicePlan = {
  lines: InvoiceLine[];
  /** Sales tax this invoice charges (final invoices only). */
  taxCents: number;
  /** False when a single stand-in line carries the amount. */
  itemised: boolean;
  /**
   * Set for a studio switched on to itemised invoices: QuickBooks is the
   * sales-tax authority (quickbooks-final-tax.ts), the lines are pre-tax and
   * `taxCents` is 0 — QuickBooks works the tax out, and the worker takes the
   * gated path (quickbooks-held-invoice.ts). Absent: today's invoice.
   */
  gated?: GatedTaxContext;
};

export type GatedTaxContext = {
  /** Sales tax is charged on this invoice (never on a retainer). */
  taxApplies: boolean;
  /** Held for the studio before it goes, and why; null sends as before. */
  holdReason: HoldReason | null;
  /** The studio's estimate, used only when QuickBooks cannot work the tax out. */
  estimateRateBasisPoints: number | null;
};

const record = (value: unknown): Row =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Row) : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const cents = (value: unknown): number => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.round(number) : 0;
};

function summaryOf(data: Row): string | null {
  const parts = [describeCoverage(resolveCoverage(data)), coverageHours(data.includedCoverageMinutes)].filter(
    (part): part is string => Boolean(part),
  );
  return parts.length ? parts.join(", ") : null;
}

function inclusionsOf(accepted: Row | null, snapshot: { id: string; data: Row } | undefined, name: string): string[] {
  const details = list(accepted?.packageDetails).map(record);
  const match =
    details.find((entry) => snapshot && entry.snapshotId === snapshot.id) ??
    details.find((entry) => entry.packageName === name);
  const agreed = list(match?.items).map(String).filter(Boolean);
  if (agreed.length) return agreed;
  return snapshot ? packageInclusionItems(snapshot.data.description) : [];
}

/** The packages and extras as the couple agreed them, and the discount. */
export function jobPackageItems(
  snapshots: readonly { id: string; data: Row }[],
  accepted: Row | null,
): { items: JobPackageItem[]; discountCents: number } {
  const pricing = record(accepted?.pricingSnapshot);
  const proposalLines = list(pricing.lineItems).map(record);
  const addOns = snapshots.flatMap((snapshot) => list(snapshot.data.addOns).map(record));
  if (proposalLines.length) {
    const items = proposalLines.map((entry): JobPackageItem => {
      const kind = entry.kind === "add_on" ? "add_on" : "package";
      const name = text(entry.description) || (kind === "add_on" ? "Extra" : "Package");
      const sourceId = text(entry.sourceId);
      const snapshot =
        kind === "package"
          ? (snapshots.find((candidate) => sourceId && candidate.data.packageId === sourceId) ??
            snapshots.find((candidate) => candidate.data.packageName === name))
          : undefined;
      const addOn = kind === "add_on" ? addOns.find((candidate) => sourceId && candidate.addOnId === sourceId) : undefined;
      return {
        kind,
        name,
        summary: snapshot ? summaryOf(snapshot.data) : null,
        inclusions: kind === "package" ? inclusionsOf(accepted, snapshot, name) : [],
        quantity: Math.max(1, cents(entry.quantity)),
        unitPriceCents: cents(entry.unitPriceCents),
        amountCents: cents(entry.totalCents),
        // The package is always taxable; an extra only when it says so.
        taxable: kind === "package" ? true : addOn ? addOn.taxable !== false : true,
      };
    });
    return { items, discountCents: cents(pricing.discountCents) };
  }
  const items = snapshots.flatMap(({ id, data }): JobPackageItem[] => {
    const name = text(data.packageName) || "Package";
    return [
      {
        kind: "package",
        name,
        summary: summaryOf(data),
        inclusions: inclusionsOf(accepted, { id, data }, name),
        quantity: 1,
        unitPriceCents: cents(data.basePriceCents),
        amountCents: cents(data.basePriceCents),
        taxable: true,
      },
      ...list(data.addOns)
        .map(record)
        .map(
          (addOn): JobPackageItem => ({
            kind: "add_on",
            name: text(addOn.name) || "Extra",
            summary: null,
            inclusions: [],
            quantity: Math.max(1, cents(addOn.quantity)),
            unitPriceCents: cents(addOn.unitPriceCents),
            amountCents: cents(addOn.lineTotalCents),
            taxable: addOn.taxable !== false,
          }),
        ),
    ];
  });
  return { items, discountCents: snapshots.reduce((sum, snapshot) => sum + cents(snapshot.data.discountCents), 0) };
}

/** Each package's retainer, and whether it is billed per crew member. */
async function retainerParts(
  db: Firestore,
  tenantId: string,
  snapshots: readonly { id: string; data: Row }[],
): Promise<RetainerPart[]> {
  return Promise.all(
    snapshots.map(async ({ data }): Promise<RetainerPart> => {
      const packageId = text(data.packageId);
      const studioPackage = packageId ? await db.doc(`packages/${packageId}`).get() : null;
      const rule =
        studioPackage?.exists && studioPackage.get("tenantId") === tenantId
          ? record(studioPackage.get("retainerRule"))
          : {};
      const perCrewCents = cents(rule.amountPerCrewCents);
      const crew =
        rule.type === "per_crew_member"
          ? billedCrewCount(resolveCoverage(data), list(rule.billedRoles).map(String))
          : 0;
      return {
        packageName: text(data.packageName) || "Package",
        retainerCents: cents(data.retainerCents),
        perCrew: rule.type === "per_crew_member" && perCrewCents > 0 ? { amountPerCrewCents: perCrewCents, crew } : null,
      };
    }),
  );
}

/** The tax an invoice's own calculation recorded, for invoices raised before `taxCents` was. */
function calculationTax(calculation: Row): number {
  if (typeof calculation.taxCents === "number") return cents(calculation.taxCents);
  const line = list(calculation.lines)
    .map(record)
    .find((entry) => entry.label === "Approved tax");
  return line ? cents(line.amountCents) : 0;
}

/** `tenantFeatures/{tenantId}.quickbooksItemisedInvoices` — set by a platform admin. */
export const QUICKBOOKS_ITEMISED_FLAG = "quickbooksItemisedInvoices";

export async function planQuickBooksInvoiceLines(db: Firestore, invoice: DocumentSnapshot): Promise<QuickBooksInvoicePlan> {
  const amountCents = cents(invoice.get("amountCents"));
  const kind = text(invoice.get("kind"));
  const single: QuickBooksInvoicePlan = {
    lines: [
      {
        kind: kind === "retainer" ? "retainer" : "amount",
        title: kind === "retainer" ? "Retainer" : kind === "final" ? "Final balance" : "Amount due",
        description: kind === "retainer" ? "Retainer" : kind === "final" ? "Final balance" : kind || "Amount due",
        quantity: 1,
        unitPriceCents: amountCents,
        amountCents,
        taxable: false,
      },
    ],
    taxCents: 0,
    itemised: false,
  };
  if (kind !== "retainer" && kind !== "final") return single;
  // Once the switch reads as on, a failure further down still takes the gated
  // path — and a final is still held for the studio. Falling back to today's
  // path would send a bill whose tax nobody had checked.
  let gated: GatedTaxContext | undefined;
  try {
    const tenantId = text(invoice.get("tenantId"));
    // Itemised invoices are switched on per studio until they've been proven
    // against a real QuickBooks company (tax override, negative lines, the
    // pay link). Off, the invoice is the single line StudioCue always sent.
    const features = await db.doc(`tenantFeatures/${tenantId}`).get();
    if (features.get(QUICKBOOKS_ITEMISED_FLAG) !== true) return single;
    gated = {
      taxApplies: false,
      holdReason: quickBooksHoldReason({ kind, gated: true, holdRetainerForReview: false }),
      estimateRateBasisPoints: null,
    };
    const projectId = text(invoice.get("projectId"));
    const [project, billing] = await Promise.all([
      db.doc(`projects/${projectId}`).get(),
      db.doc(`billingSettings/${tenantId}`).get(),
    ]);
    if (!project.exists || project.get("tenantId") !== tenantId) return { ...single, gated };
    const settings = normaliseBillingSettings(billing.exists ? billing.data() : null, tenantId);
    gated = {
      // Retainers never carry tax (owner decision, 2026-10-01).
      taxApplies: kind === "final" && salesTaxApplies(settings, project.data() ?? {}),
      holdReason: quickBooksHoldReason({ kind, gated: true, holdRetainerForReview: settings.holdRetainerForReview }),
      estimateRateBasisPoints: settings.salesTax.estimateRateBasisPoints,
    };
    const [snapshots, accepted] = await Promise.all([
      loadJobPackageSnapshots(db, tenantId, project.data() ?? {}),
      loadAcceptedProposal(db, tenantId, projectId),
    ]);
    const { items, discountCents } = jobPackageItems(snapshots, accepted);
    if (kind === "retainer") {
      // Never taxed: the $0 package lines are non-taxable too.
      const lines = quickBooksRetainerLines({
        amountCents,
        items,
        parts: await retainerParts(db, tenantId, snapshots),
        taxApplies: false,
      });
      return { lines, taxCents: 0, itemised: lines.length > 1 || lines[0]?.quantity !== 1, gated };
    }
    const calculation = record(invoice.get("calculation"));
    const packageTotalCents = cents(calculation.packageTotalCents);
    if (packageTotalCents <= 0) return { ...single, gated };
    const retainerPaid = calculation.retainerPaidCents;
    // Pre-tax lines; QuickBooks adds the tax. A final raised before the switch
    // (its total and amount include StudioCue's own tax) has that tax taken
    // out of both, so it is never counted twice. One raised since has
    // calculation.taxCents 0 (final-invoice.ts, quickBooksTaxAuthority).
    const agreedTax = calculationTax(calculation);
    const result = gatedFinalLines({
      amountCents: amountCents - agreedTax,
      preTaxTotalCents: packageTotalCents - agreedTax,
      discountCents,
      items,
      retainerPaidCents: typeof retainerPaid === "number" ? retainerPaid : null,
      taxApplies: gated.taxApplies,
    });
    return { ...result, gated };
  } catch (caught) {
    console.warn(
      JSON.stringify({
        severity: "WARNING",
        event: "quickbooks.invoice_lines_fallback",
        invoiceId: invoice.id,
        reason: caught instanceof Error ? caught.message : String(caught),
      }),
    );
    return gated ? { ...single, gated } : single;
  }
}
