import { formatContractDate, formatMoney, undatedPaymentDue, type ContractBlock, type ContractDocument } from "./document";

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
  lineItems: ReadonlyArray<{ description: string; quantity: number; totalCents: number; kind?: string }>;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  paymentSchedule: ReadonlyArray<{ label: string; amountCents: number; dueDate: string | null }>;
};

export const COMBINED_SECTION_TITLES: Record<CombinedSectionKey, string> = {
  terms: "Part 1 — Terms and conditions",
  coverage: "Part 2 — Your coverage",
};

const text = (value: string) => [{ text: value }];

function coverageBlocks(coverage: CoverageInput): ContractBlock[] {
  const money = (cents: number) => formatMoney(cents, coverage.currency);
  const packages = coverage.lineItems.filter((line) => line.kind !== "add_on");
  const extras = coverage.lineItems.filter((line) => line.kind === "add_on");
  const lineText = (line: CoverageInput["lineItems"][number]) =>
    `${line.description}${line.quantity > 1 ? ` × ${line.quantity}` : ""} — ${money(line.totalCents)}`;
  const blocks: ContractBlock[] = [
    { type: "heading", level: 1, content: text(COMBINED_SECTION_TITLES.coverage) },
    {
      type: "paragraph",
      content: text("What you are booking, and what it costs. This part is signed on its own, after the terms."),
    },
  ];
  if (packages.length) {
    blocks.push({ type: "heading", level: 2, content: text(packages.length > 1 ? "Packages" : "Package") });
    blocks.push({ type: "list", items: packages.map((line) => ({ content: text(lineText(line)) })) });
  }
  if (extras.length) {
    blocks.push({ type: "heading", level: 2, content: text("Extras") });
    blocks.push({ type: "list", items: extras.map((line) => ({ content: text(lineText(line)) })) });
  }
  const totals: string[] = [];
  if (coverage.discountCents > 0) totals.push(`Discount: −${money(coverage.discountCents)}`);
  if (coverage.taxCents > 0) totals.push(`Tax: ${money(coverage.taxCents)}`);
  totals.push(`Total: ${money(coverage.totalCents)}`);
  blocks.push({ type: "list", items: totals.map((line) => ({ content: [{ text: line, bold: true as const }] })) });
  if (coverage.paymentSchedule.length) {
    blocks.push({ type: "heading", level: 2, content: text("Payment schedule") });
    blocks.push({
      type: "payment_schedule",
      rows: coverage.paymentSchedule.map((row) => ({
        label: row.label,
        amount: money(row.amountCents),
        // Dated as Part 1 dates it ("July 3, 2027"), never "2027-07-03".
        due: row.dueDate ? formatContractDate(row.dueDate) : undatedPaymentDue(row.label),
      })),
    });
  }
  return blocks;
}

/** The terms and the coverage as one document, and where each part lies. */
export function buildCombinedAgreement(
  terms: ContractDocument,
  coverage: CoverageInput,
): { document: ContractDocument; sections: CombinedSection[] } {
  const termsBlocks: ContractBlock[] = [
    { type: "heading", level: 1, content: text(COMBINED_SECTION_TITLES.terms) },
    ...terms.blocks,
  ];
  const coverageBlocksList = coverageBlocks(coverage);
  return {
    document: { format: terms.format, title: terms.title, blocks: [...termsBlocks, ...coverageBlocksList] },
    sections: [
      { key: "terms", title: COMBINED_SECTION_TITLES.terms, start: 0, end: termsBlocks.length },
      {
        key: "coverage",
        title: COMBINED_SECTION_TITLES.coverage,
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
