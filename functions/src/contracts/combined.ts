import { formatMoney, undatedPaymentDue, type ContractBlock, type ContractDocument } from "./document.js";

/**
 * The mirror of features/contracts/combined.ts — the studio's terms and the
 * couple's coverage as one agreement with two signatures (H2). functions/
 * cannot import from features/, so the body below the marker is identical;
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
        due: row.dueDate ?? undatedPaymentDue(row.label),
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
