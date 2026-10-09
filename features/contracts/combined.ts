import { formatContractDate, formatMoney, undatedPaymentDue, type ContractBlock, type ContractDocument } from "./document";
import { balanceWithSalesTax, readPricedSalesTax, salesTaxEstimateText, SALES_TAX_ESTIMATE_LABEL, totalWithSalesTax } from "../billing/sales-tax-pricing";
import type { PricedSalesTax } from "../pricing/package-price";
import { tradeVocab } from "../trades/trades";

/**
 * One send, two signatures (H2, docs/proposal-agreement-and-addons-plan-2026-09-28.md
 * Part B).
 *
 * The studio's terms and the couple's coverage, sent together. Part 1 is the
 * studio's own agreement, resolved as for any contract; Part 2 is what they
 * are booking — each package and extra, the total, and the payment schedule —
 * written from the proposal, so the price in the agreement is the proposal's
 * price by construction. Each part is signed on its own, terms first, and the
 * document hash over the whole binds the two so neither part can be swapped.
 *
 * Built from the existing block types, so the page that shows a contract and
 * the sealed PDF need nothing new to render it; `sections` records where each
 * part begins and ends.
 *
 * Mirrored below the marker in functions/src/contracts/combined.ts;
 * tests/combined-agreement.test.ts compares them.
 */
// ── mirrored below ──

export type CombinedSectionKey = "terms" | "coverage";

export type CombinedSection = {
  key: CombinedSectionKey;
  title: string;
  /** Index of the section's first block, and one past its last. */
  start: number;
  end: number;
};

export type CoverageInput = {
  currency: string;
  lineItems: ReadonlyArray<{
    description: string;
    quantity: number;
    totalCents: number;
    kind?: string;
    /** What the package includes, one bullet each (the proposal's packageDetails). */
    details?: readonly string[];
  }>;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  paymentSchedule: ReadonlyArray<{ label: string; amountCents: number; dueDate: string | null }>;
  /**
   * Pre-tax "plus sales tax": QuickBooks works the tax out on the final
   * invoice (../billing/sales-tax-pricing.ts). Absent for a booking priced the
   * old way, whose Part 2 reads exactly as before.
   */
  salesTax?: PricedSalesTax | null;
};

export const COMBINED_SECTION_TITLES: Record<CombinedSectionKey, string> = {
  terms: "Part 1 — Terms and conditions",
  coverage: "Part 2 — Your coverage",
};

/**
 * The two parts' titles for a studio of this trade: a photographer's client
 * books "coverage", a DJ's, makeup artist's or hair stylist's their "service"
 * (trades.ts `coverage`). Only a newly built agreement reads it; one already
 * sent keeps the titles stored in its sections, which its hashes are over.
 */
export function combinedSectionTitles(trade?: unknown): Record<CombinedSectionKey, string> {
  return { ...COMBINED_SECTION_TITLES, coverage: `Part 2 — Your ${tradeVocab(trade).coverage.toLowerCase()}` };
}

const text = (value: string) => [{ text: value }];

function coverageBlocks(coverage: CoverageInput, title: string): ContractBlock[] {
  const money = (cents: number) => formatMoney(cents, coverage.currency);
  const packages = coverage.lineItems.filter((line) => line.kind !== "add_on");
  const extras = coverage.lineItems.filter((line) => line.kind === "add_on");
  const lineText = (line: CoverageInput["lineItems"][number]) =>
    `${line.description}${line.quantity > 1 ? ` × ${line.quantity}` : ""} — ${money(line.totalCents)}`;
  const blocks: ContractBlock[] = [
    { type: "heading", level: 1, content: text(title) },
    {
      type: "paragraph",
      content: text("What you are booking, and what it costs. This part is signed on its own, after the terms."),
    },
  ];
  if (packages.length) {
    blocks.push({ type: "heading", level: 2, content: text(packages.length > 1 ? "Packages" : "Package") });
    if (packages.some((line) => line.details?.length)) {
      // Each package with what it includes beneath it, as the proposal shows
      // it: the couple signs the same list they were offered (GR, 2026-09-30).
      for (const line of packages) {
        blocks.push({ type: "paragraph", content: [{ text: lineText(line), bold: true as const }] });
        if (line.details?.length)
          blocks.push({ type: "list", items: line.details.map((item) => ({ content: text(item) })) });
      }
    } else {
      blocks.push({ type: "list", items: packages.map((line) => ({ content: text(lineText(line)) })) });
    }
  }
  if (extras.length) {
    blocks.push({ type: "heading", level: 2, content: text("Extras") });
    blocks.push({ type: "list", items: extras.map((line) => ({ content: text(lineText(line)) })) });
  }
  const salesTax = readPricedSalesTax(coverage.salesTax);
  const totals: string[] = [];
  if (coverage.discountCents > 0) totals.push(`Discount: −${money(coverage.discountCents)}`);
  if (coverage.taxCents > 0) totals.push(`Tax: ${money(coverage.taxCents)}`);
  totals.push(`Total: ${totalWithSalesTax(money(coverage.totalCents), salesTax, coverage.currency)}`);
  blocks.push({ type: "list", items: totals.map((line) => ({ content: [{ text: line, bold: true as const }] })) });
  // The estimate, under the total and not in it.
  const estimate = salesTaxEstimateText(salesTax, coverage.currency);
  if (estimate)
    blocks.push({
      type: "paragraph",
      content: text(`${SALES_TAX_ESTIMATE_LABEL}: ${estimate}. Not included in the total above.`),
    });
  if (coverage.paymentSchedule.length) {
    blocks.push({ type: "heading", level: 2, content: text("Payment schedule") });
    blocks.push({
      type: "payment_schedule",
      rows: coverage.paymentSchedule.map((row, index) => ({
        label: row.label,
        // The last payment is the one the sales tax is added to.
        amount:
          index === coverage.paymentSchedule.length - 1
            ? balanceWithSalesTax(money(row.amountCents), salesTax)
            : money(row.amountCents),
        // Dated as Part 1 dates it ("July 3, 2027"), never "2027-07-03".
        due: row.dueDate ? formatContractDate(row.dueDate) : undatedPaymentDue(row.label),
      })),
    });
  }
  return blocks;
}

/**
 * The terms and the coverage as one document, and where each part lies.
 * `trade` is the studio's (trades.ts): it names Part 2; a photographer's, or
 * none, reads exactly as before.
 */
export function buildCombinedAgreement(
  terms: ContractDocument,
  coverage: CoverageInput,
  trade?: unknown,
): { document: ContractDocument; sections: CombinedSection[] } {
  const titles = combinedSectionTitles(trade);
  const termsBlocks: ContractBlock[] = [
    { type: "heading", level: 1, content: text(titles.terms) },
    ...terms.blocks,
  ];
  const coverageBlocksList = coverageBlocks(coverage, titles.coverage);
  return {
    document: { format: terms.format, title: terms.title, blocks: [...termsBlocks, ...coverageBlocksList] },
    sections: [
      { key: "terms", title: titles.terms, start: 0, end: termsBlocks.length },
      {
        key: "coverage",
        title: titles.coverage,
        start: termsBlocks.length,
        end: termsBlocks.length + coverageBlocksList.length,
      },
    ],
  };
}

/**
 * One part of the agreement, as a document of its own — what that part's
 * signature is over. Hashed with the same canonical hash as the whole.
 */
export function sectionDocument(document: ContractDocument, section: CombinedSection): ContractDocument {
  return { format: document.format, title: section.title, blocks: document.blocks.slice(section.start, section.end) };
}

/** Sections that tile the document exactly, terms first: anything else is refused. */
export function sectionsValid(document: ContractDocument, sections: readonly CombinedSection[]): boolean {
  return (
    sections.length === 2 &&
    sections[0]!.key === "terms" &&
    sections[1]!.key === "coverage" &&
    sections[0]!.start === 0 &&
    sections[0]!.end === sections[1]!.start &&
    sections[1]!.end === document.blocks.length &&
    sections.every((section) => section.end > section.start)
  );
}
