import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildCombinedAgreement, sectionDocument, type CoverageInput } from "@/features/contracts/combined";
import {
  agreementDepositLabel,
  agreementScheduleLabel,
  contractMergeFields,
  contractMergeFieldsFor,
  convertImportedAgreement,
  DETAILS_SECTION,
  depositWordingClash,
  detailsSectionFor,
  newAgreementDepositLabel,
  resolveContractDocument,
  storedDepositLabel,
  termsTieRefundToRetainer,
  type ContractBlock,
  type ContractDocument,
  type ContractSources,
} from "@/features/contracts/document";
import { BEAUTY_STARTER_AGREEMENT, STARTER_AGREEMENT, sampleContractSources, starterAgreementFor } from "@/features/contracts/sample";
import { contractDocumentHash } from "@/server/contracts/document-hash";
import { newAgreementDepositLabel as functionsNewAgreementDepositLabel } from "../functions/src/contracts/document";
import { buildCombinedAgreement as functionsBuildCombinedAgreement } from "../functions/src/contracts/combined";

/**
 * A vendor's agreement says "Deposit" (Conor, 2026-10-12).
 *
 * A DJ's, makeup artist's or hair stylist's client read "deposit" everywhere
 * but the agreement they sign, whose payment schedule — Part 2's table, and
 * Part 1's when the studio's terms print {{payment.schedule}} — still said
 * "Retainer" (Jess Styles Bridal, prod, 2026-10-12). The table is inside the
 * document hash, so the word is decided once, when an agreement is written,
 * and kept on its record (`depositLabel`). Every agreement written before has
 * none and reads "Retainer" byte for byte, for every hash, signature, sealed
 * PDF and certificate that names it. A photographer's is untouched.
 */

const read = (path: string) => readFileSync(path, "utf8");
const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const VENDORS = ["dj", "makeup", "hair"] as const;
const RETAINER = /\bretainers?\b/i;
const REFUND = /refund|forfeit|non-?returnable/gi;

// Fixed inputs. The hashes below were taken from these inputs on main
// (80b14b6e) before this change, and must never move.
const terms: ContractDocument = {
  format: 1,
  title: "Services agreement",
  blocks: [
    { type: "paragraph", content: [{ text: "This agreement is between the Studio and the Client." }] },
    { type: "heading", level: 2, content: [{ text: "Cancellation" }] },
    { type: "paragraph", content: [{ text: "The retainer is non-refundable." }] },
  ],
};
const coverage: CoverageInput = {
  currency: "USD",
  lineItems: [
    { description: "Signature Collection", quantity: 1, totalCents: 499900, kind: "package", details: ["8 hours", "Online gallery"] },
    { description: "Engagement session", quantity: 1, totalCents: 45000, kind: "add_on" },
  ],
  discountCents: 10000,
  taxCents: 0,
  totalCents: 534900,
  paymentSchedule: [
    { label: "Retainer", amountCents: 150000, dueDate: null },
    { label: "Final balance", amountCents: 384900, dueDate: "2027-05-29" },
  ],
};
const template = {
  title: "Services agreement",
  body: [
    "Fees: the retainer is non-refundable. {{payment.schedule}} inline.",
    "",
    "- Retainer: {{price.retainer}}",
    "",
    "{{payment.schedule}}",
  ].join("\n"),
  customFields: [],
};

const GOLDEN = {
  /** A photographer's combined agreement, and each part's hash. */
  photoCombined: "f94079eb6d27ef3899ad5b27560fe5e234d7b0f4d183dfb4edb7c8025e999205",
  photoTerms: "e9d308fbeeaef17682394b5eb447e48d93e1ed85ba36af5093340fcadc882d8a",
  photoCoverage: "435143cc38bdfeabbd9371f833d7a6eb2d3265e00ac2dbfc6617e16607460072",
  /** A photographer's starter, resolved against the editor's sample job. */
  photoStarterResolved: "7265288669d0bc7cdcace750ef2bc5268e9886297b36cc5a9119c065388782cc",
  /** A photographer's own template with the schedule in it twice. */
  photoTemplateResolved: "eca48acb97636072fb56b8592936d213feecf601a6e9cc7962f9333dc493f159",
  photoStarterBody: "663979aa80ab554ff5420f41864d0201105fb4c9ac52fe336bd71efbcf42228d",
  photoStarterTitle: "c6b0d974cf64a63d9b13f1a4ecd78555664fb8be8bf940e914450ad6b0f464b9",
  photoImport: "06ea2fa88ab1b8a9a2106fa95a5a13704ff01d71a32e033026aa7f7ddfb9c906",
  /** A vendor's combined agreement as written before 2026-10-12: Part 2 says "Retainer". */
  vendorCombinedBefore: "38a00a38d6ce8fd257b63841e3dcefa6f65ab0fd64bac1af5f69cc104667de61",
  vendorCoverageBefore: "a64c5112364efd6887c6f2a1f3ae3f988ff066a2b932257d8ba8ec8cafa48706",
  /** The template above, resolved for each vendor's sample job before 2026-10-12. */
  vendorTemplateBefore: {
    dj: "3b555c69d1011b956a2fc43c88363b522a48d349ad9758a47e607e2a7d3d1102",
    makeup: "9dcb0b97c8fae601b689fc9ba0cc4ef74980100c03eb6a75bc7c55c9a530d204",
    hair: "538a22cde6ddc6fce2b63f5efea8e12d3aaa5bd744b6e606601844df318ee2a9",
  },
} as const;

const hashes = (built: ReturnType<typeof buildCombinedAgreement>) => ({
  document: contractDocumentHash(built.document),
  sections: built.sections.map((section) => contractDocumentHash(sectionDocument(built.document, section))),
});

const scheduleRows = (blocks: readonly ContractBlock[]) =>
  blocks.flatMap((block) => (block.type === "payment_schedule" ? block.rows : []));

/** Every piece of text StudioCue filled into a studio's terms: merge-field values and tables. */
function generatedText(document: ContractDocument): string {
  const out: string[] = [];
  for (const block of document.blocks) {
    if (block.type === "payment_schedule") out.push(...block.rows.flatMap((row) => [row.label, row.amount, row.due]));
    else if (block.type === "list")
      out.push(...block.items.flatMap((item) => item.content.filter((piece) => piece.field).map((piece) => piece.text)));
    else out.push(...block.content.filter((piece) => piece.field).map((piece) => piece.text));
  }
  return out.join("\n");
}

/**
 * A hair studio's agreement as saved from StudioCue's starter before
 * 2026-10-12 — the starter's own text, with the studio's cancellation term
 * written in (Jess Styles Bridal's section 7, prod 2026-10-12). Its fees
 * sentence says "A retainer of": that is now the studio's saved text.
 */
const SAVED_FROM_OLD_STARTER = `This agreement is between {{studio.legal_name}} ("the Studio") and {{client.names}} ("the Client") for {{event.type}} services on {{event.date}} at {{event.venue}}.

## 1. Services
The Studio will provide the {{package.name}}: {{package.coverage}}. Included:
{{package.deliverables}}

## 2. Fees and payment
The total fee is {{price.total}}. A retainer of {{price.retainer}} reserves the date, and the balance of {{price.balance}} is due as follows:
{{payment.schedule}}

## 3. Minimum and party size
[Replace with your booking minimum (a number of people, or a total), and how the party size works: people can be added after the final headcount, but not taken off.]

## 7. No-shows and cancellation
The deposit is non-refundable.

This agreement was prepared on {{contract.date}}.
`;

const vendorSources = (trade: string, depositLabel?: string | null): ContractSources => ({
  ...sampleContractSources("Crown & Pin", "2026-10-12", trade),
  depositLabel,
});

test("the functions copies are the same modules", () => {
  const withoutJs = (text: string) => text.replace(/(from "\.{1,2}\/[^"]+)\.js"/g, '$1"');
  assert.equal(withoutJs(read("functions/src/contracts/document.ts")), read("features/contracts/document.ts"));
  const MARKER = "// ── mirrored below ──";
  const body = (path: string) => read(path).slice(read(path).indexOf(MARKER));
  assert.equal(body("functions/src/contracts/combined.ts"), body("features/contracts/combined.ts"));
  for (const trade of VENDORS) {
    assert.equal(functionsNewAgreementDepositLabel(trade, ""), "Deposit");
    assert.deepEqual(
      functionsBuildCombinedAgreement(terms, { ...coverage, depositLabel: "Deposit" }, trade),
      buildCombinedAgreement(terms, { ...coverage, depositLabel: "Deposit" }, trade),
    );
  }
});

test("a vendor's new agreement says Deposit in both schedules, and StudioCue's words never say retainer", () => {
  for (const trade of VENDORS) {
    const word = newAgreementDepositLabel(trade, starterAgreementFor(trade).body);
    assert.equal(word, "Deposit", trade);
    // Part 2, written by StudioCue from the proposal.
    const built = buildCombinedAgreement(terms, { ...coverage, depositLabel: word }, trade);
    const part2 = sectionDocument(built.document, built.sections[1]!);
    assert.deepEqual(
      scheduleRows(part2.blocks).map((row) => [row.label, row.due]),
      [["Deposit", "On signing"], ["Final balance", "May 29, 2027"]],
      trade,
    );
    // All of Part 2 is StudioCue's.
    assert.doesNotMatch(JSON.stringify(part2), RETAINER, trade);
    // Part 1: the merge fields in a studio's own terms — the table and the
    // inline schedule — print the same word. Here, Jess Styles Bridal's
    // agreement as saved from the hair starter before 2026-10-12.
    const saved = SAVED_FROM_OLD_STARTER;
    const part1 = resolveContractDocument({
      template: { title: "Hair Services Agreement", body: saved, customFields: [] },
      sources: vendorSources(trade, newAgreementDepositLabel(trade, saved)),
      overrides: {},
    }).document;
    assert.deepEqual(scheduleRows(part1.blocks).map((row) => row.label), ["Deposit", "Final balance"], trade);
    assert.doesNotMatch(generatedText(part1), RETAINER, trade);
  }
});

test("the studio's own words are never rewritten, even where they say retainer", () => {
  // The fees sentence's "retainer" is the studio's saved text — copied from
  // the old starter — not a merge field; only "$260.00" is filled in.
  const saved = SAVED_FROM_OLD_STARTER;
  const part1 = resolveContractDocument({
    template: { title: "Hair Services Agreement", body: saved, customFields: [] },
    sources: vendorSources("hair", "Deposit"),
    overrides: {},
  }).document;
  const fees = part1.blocks.find(
    (block) => block.type === "paragraph" && block.content.some((piece) => piece.text.includes("reserves the date")),
  );
  assert.ok(fees && fees.type === "paragraph");
  assert.deepEqual(
    fees.content.map((piece) => [piece.text, piece.field ?? null]).slice(2, 5),
    [[". A retainer of ", null], ["$260.00", "price.retainer"], [" reserves the date, and the balance of ", null]],
  );
  // And Part 1 of a combined agreement is the terms exactly as given.
  const built = buildCombinedAgreement(terms, { ...coverage, depositLabel: "Deposit" }, "hair");
  assert.deepEqual(sectionDocument(built.document, built.sections[0]!).blocks.slice(1), terms.blocks);
});

test("an agreement written before 2026-10-12 is written again byte for byte, with Retainer", () => {
  for (const trade of VENDORS) {
    for (const depositLabel of [undefined, null, "", "  "]) {
      const old = buildCombinedAgreement(terms, { ...coverage, depositLabel }, trade);
      assert.deepEqual(hashes(old), {
        document: GOLDEN.vendorCombinedBefore,
        sections: [GOLDEN.photoTerms, GOLDEN.vendorCoverageBefore],
      }, `${trade} ${JSON.stringify(depositLabel)}`);
      assert.equal(scheduleRows(old.document.blocks)[0]?.label, "Retainer");
      const resolved = resolveContractDocument({ template, sources: vendorSources(trade, depositLabel), overrides: {} });
      assert.equal(contractDocumentHash(resolved.document), GOLDEN.vendorTemplateBefore[trade], trade);
    }
  }
  // What a record holds decides: nothing stored is "Retainer".
  assert.equal(storedDepositLabel(undefined), null);
  assert.equal(storedDepositLabel(null), null);
  assert.equal(storedDepositLabel(""), null);
  assert.equal(storedDepositLabel(" Deposit "), "Deposit");
  assert.equal(agreementScheduleLabel("Retainer", null), "Retainer");
  assert.equal(agreementScheduleLabel("Retainer", "Deposit"), "Deposit");
  for (const label of ["Final balance", "Payment in full", "Payment on the day", "Invoice after the event", "Booking fee"])
    assert.equal(agreementScheduleLabel(label, "Deposit"), label);
});

test("a photographer's agreements are byte-identical, now and for new ones", () => {
  for (const trade of [undefined, "photographer", "Photographer", "florist"]) {
    const word = newAgreementDepositLabel(trade, template.body);
    assert.equal(word, "Retainer");
    assert.equal(agreementDepositLabel(trade), "Retainer");
    for (const depositLabel of [undefined, null, word]) {
      assert.deepEqual(hashes(buildCombinedAgreement(terms, { ...coverage, depositLabel }, trade)), {
        document: GOLDEN.photoCombined,
        sections: [GOLDEN.photoTerms, GOLDEN.photoCoverage],
      });
      const sources = { ...sampleContractSources("Hart Light", "2026-10-12", trade), depositLabel };
      assert.equal(
        contractDocumentHash(resolveContractDocument({ template, sources, overrides: {} }).document),
        GOLDEN.photoTemplateResolved,
      );
      const starter = starterAgreementFor(trade);
      assert.equal(
        contractDocumentHash(
          resolveContractDocument({ template: { ...starter, customFields: [] }, sources, overrides: {} }).document,
        ),
        GOLDEN.photoStarterResolved,
      );
    }
    assert.equal(sha(starterAgreementFor(trade).body), GOLDEN.photoStarterBody);
    assert.equal(sha(starterAgreementFor(trade).title), GOLDEN.photoStarterTitle);
    assert.equal(sha(convertImportedAgreement("Cancellation: the retainer is non-refundable.", trade).body), GOLDEN.photoImport);
    assert.equal(detailsSectionFor(trade), DETAILS_SECTION);
    assert.equal(contractMergeFieldsFor(trade), contractMergeFields);
  }
  assert.equal(sha(STARTER_AGREEMENT), GOLDEN.photoStarterBody);
});

test("refund terms keep naming the payment the schedule asks for", () => {
  // The studio's own terms tie a refund to "the retainer": the line stays
  // Retainer, so "non-refundable" still covers the payment that books the date.
  const tied = [
    "## Cancellation\nThe retainer is non-refundable.",
    "## Fees\nA retainer of {{price.retainer}} reserves the date. It is non-refundable.",
    "Retainers are nonrefundable once the date is held.",
    "## Payment\nThe retainer is forfeited if the Client cancels.",
    "**Booking Fee:** The retainer is non-returnable.",
    // Common US forfeiture wording that never says "refund" (review, 2026-10-12).
    "## Cancellation\nIf the Client cancels, the Studio keeps the retainer.",
    "## Cancellation\nThe retainer will not be returned if the Client cancels.",
    "## Fees\nThe retainer is earned upon receipt and secures the date.",
    "## Cancellation\nThe retainer is not returnable.",
    "## Cancellation\nThe retainer is retained by the Studio on cancellation.",
    "## Cancellation\nThe retainer will not be given back.",
    "## Payment\nThe retainer is not reimbursable.",
    "## Payment\nThe retainer secures the date and will not be repaid.",
    "## Changes\nIf the date is postponed, the retainer moves to the new date.",
    "## Cancellation\nThe retainer is kept as liquidated damages.",
    "## 7. Cancellation\nIf the Client ends this agreement, the retainer stays with the Studio.",
  ];
  for (const body of tied) {
    assert.ok(termsTieRefundToRetainer(body), body);
    for (const trade of VENDORS) assert.equal(newAgreementDepositLabel(trade, body), "Retainer", `${trade}: ${body}`);
  }
  // Not tied: the words are in different sections, a merge field says it, or
  // the refund term names the deposit (Jess's section 7).
  const free = [
    SAVED_FROM_OLD_STARTER,
    "## Fees\nA retainer of {{price.retainer}} reserves the date.\n\n## Cancellation\nPayments are non-refundable.",
    "{{payment.schedule}} is non-refundable.",
    "The deposit is non-refundable.",
    // The verb "retain" is not the noun, and a retainer that only books the date ties nothing.
    "The Studio retains the deposit if the Client cancels.",
    "## Fees\nThe retainer secures the date.",
    "## Fees\nA retainer of {{price.retainer}} reserves the date, and the balance is due as follows:\n{{payment.schedule}}",
    "",
  ];
  for (const body of free) {
    assert.equal(termsTieRefundToRetainer(body), false, body);
    for (const trade of VENDORS) assert.equal(newAgreementDepositLabel(trade, body), "Deposit", `${trade}: ${body}`);
  }
  // StudioCue adds and removes no refund words: the studio's sentence is
  // carried over exactly, and the generated parts say nothing about refunds,
  // before and after.
  for (const trade of VENDORS) {
    const before = buildCombinedAgreement(terms, coverage, trade);
    const after = buildCombinedAgreement(terms, { ...coverage, depositLabel: "Deposit" }, trade);
    const refunds = (document: ContractDocument) => JSON.stringify(document).match(REFUND) ?? [];
    assert.deepEqual(refunds(after.document), refunds(before.document));
    assert.match(JSON.stringify(after.document), /"The retainer is non-refundable\."/);
    assert.doesNotMatch(JSON.stringify(sectionDocument(after.document, after.sections[1]!)), REFUND);
    assert.doesNotMatch(starterAgreementFor(trade).body, REFUND);
    assert.doesNotMatch(detailsSectionFor(trade), REFUND);
  }
});

test("a vendor's starting agreement, imported details and editor fields say deposit — new copies only", () => {
  for (const trade of VENDORS) {
    const starter = starterAgreementFor(trade).body;
    assert.match(starter, /A deposit of \{\{price\.retainer\}\} reserves the date/, trade);
    // Its {{price.retainer}} field is a key, the same for every trade.
    assert.doesNotMatch(starter.replace(/\{\{[^}]+\}\}/g, ""), RETAINER, trade);
    assert.match(detailsSectionFor(trade), /^- Deposit: \{\{price\.retainer\}\}$/m, trade);
    assert.doesNotMatch(detailsSectionFor(trade).replace(/\{\{[^}]+\}\}/g, ""), RETAINER, trade);
    const fields = Object.fromEntries(contractMergeFieldsFor(trade).map((field) => [field.key, field]));
    assert.equal(fields["price.retainer"]?.label, "Deposit");
    assert.equal(fields["price.balance"]?.label, "Balance after deposit");
    assert.equal(fields["payment.schedule"]?.example, "Deposit $1,600.00 …");
    // The editor's preview prints what a real agreement from that text would.
    const preview = resolveContractDocument({
      template: { title: "Agreement", body: starter, customFields: [] },
      sources: sampleContractSources("Crown & Pin", "2026-10-12", trade),
      overrides: {},
    }).document;
    assert.equal(scheduleRows(preview.blocks)[0]?.label, "Deposit");
  }
  const editor = read("components/contracts/agreement-editor.tsx");
  assert.match(editor, /depositLabel: newAgreementDepositLabel\(workspace\.tenantTrade, body\),/);
  // The starter is shown only to a studio with no saved agreement; a saved one loads as saved.
  assert.match(editor, /\.\.\.starterAgreementFor\(workspace\.tenantTrade\),/);
  assert.match(editor, /body: String\(version\.get\("body"\) \?\? ""\),/);
});

test("the word is decided when an agreement is written, kept on it, and reused when it is written again", () => {
  const commands = read("functions/src/contracts/commands.ts");
  // New: the trade and the studio's own refund terms decide.
  // The studio's typed field values count too (an imported [CANCELLATION POLICY]).
  assert.match(commands, /input\.depositLabel === undefined\s*\? newAgreementDepositLabel\(loaded\.trade, template\.template\.body, input\.overrides\)\s*: storedDepositLabel\(input\.depositLabel\)/);
  // Kept on both drafts (the studio's prepare and the acceptance trigger) and on the sent contract.
  assert.equal((commands.match(/depositLabel: draft\.depositLabel,/g) ?? []).length, 2);
  assert.match(commands, /depositLabel: recheck\.depositLabel,/);
  // Send writes the draft again in the draft's own word; a draft from before reads Retainer.
  assert.match(commands, /depositLabel: storedDepositLabel\(draftSnapshot\.get\("depositLabel"\)\),/);
  // The combined agreement: Part 1 and Part 2 in the one word, kept on the contract.
  const combined = read("functions/src/contracts/combined-commands.ts");
  assert.match(combined, /const depositLabel = draft\.depositLabel;/);
  assert.match(combined, /paymentSchedule: schedule\.map[\s\S]*?\}\)\),\s*depositLabel,/);
  assert.match(combined, /depositLabel: resolved\.depositLabel,/);
  // A change restates the signed agreement in the word it was signed with.
  const amendments = read("functions/src/contracts/amendments.ts");
  assert.match(amendments, /\.\.\.amendedDepositLabel\(signedContract\),/);
  assert.match(amendments, /if \(!signedContract\?\.get\("document"\)\) return \{\};\s*return \{ depositLabel: storedDepositLabel\(signedContract\.get\("depositLabel"\)\) \};/);
  assert.match(amendments, /depositLabel = draft\.depositLabel;/);
  assert.match(read("functions/src/booking/amendment-apply.ts"), /depositLabel: amendment\.get\("depositLabel"\) \?\? null,/);
  // Signing, sealing and the certificate read the stored document and its
  // hash; none of them writes an agreement again.
  for (const path of ["server/contracts/combined-signing.ts", "server/contracts/client-signing.ts", "server/contracts/amendment-signing.ts", "functions/src/contracts/seal.ts"]) {
    const source = read(path);
    assert.match(source, /contractDocumentHash\(document\)/, path);
    assert.doesNotMatch(source, /buildCombinedAgreement|resolveContractDocument|resolveDraft/, path);
  }
  // And the combined builder never looks the word up itself.
  assert.doesNotMatch(read("features/contracts/combined.ts"), /scheduleLineLabel|agreementDepositLabel\(|tradeVocab\(trade\)\.deposit/);
});

test("an imported agreement's added details name the payment as its own refund term does", () => {
  for (const trade of VENDORS) {
    // The studio's text ties a refund to "the retainer": the details line
    // StudioCue adds above it says Retainer, as the schedule will — never a
    // "Deposit" bullet beside a non-refundable retainer.
    const tied = convertImportedAgreement("Cancellation: the retainer is non-refundable.", trade).body;
    assert.equal(tied, `${detailsSectionFor(trade, "Cancellation: the retainer is non-refundable.")}\n\n## Terms\nCancellation: the retainer is non-refundable.`);
    assert.match(tied, /^- Retainer: \{\{price\.retainer\}\}$/m, trade);
    assert.doesNotMatch(tied, /Deposit/, trade);
    assert.equal(newAgreementDepositLabel(trade, tied), "Retainer", "the saved template prints Retainer too");
    // Otherwise the details say Deposit, and so will the schedule.
    const untied = convertImportedAgreement("Cancellation: the deposit is non-refundable.", trade).body;
    assert.match(untied, /^- Deposit: \{\{price\.retainer\}\}$/m, trade);
    assert.equal(newAgreementDepositLabel(trade, untied), "Deposit");
    // The studio's sentence is carried over word for word either way.
    assert.ok(tied.endsWith("Cancellation: the retainer is non-refundable."));
    assert.ok(untied.endsWith("Cancellation: the deposit is non-refundable."));
  }
  // A photographer's import is the one it always was, whatever its text says.
  assert.equal(detailsSectionFor("photographer", "The retainer is non-refundable."), DETAILS_SECTION);
});

test("what the studio typed into a field for this agreement counts as its own terms", () => {
  // An imported agreement's [CANCELLATION POLICY] is a field the studio fills
  // in on each contract; resolveDraft passes those values (review, 2026-10-12).
  const imported = convertImportedAgreement("Cancellation: [CANCELLATION POLICY]", "hair");
  const field = imported.customFields[0]?.key;
  assert.ok(field && imported.body.includes(`{{${field}}}`), imported.body);
  for (const trade of VENDORS) {
    assert.equal(newAgreementDepositLabel(trade, imported.body), "Deposit", trade);
    assert.equal(
      newAgreementDepositLabel(trade, imported.body, { [field]: "The retainer is non-refundable." }),
      "Retainer",
      trade,
    );
    assert.equal(newAgreementDepositLabel(trade, imported.body, { [field]: "The deposit is non-refundable." }), "Deposit");
    // The section's own words and the typed value are read together.
    const body = "## Fees\nThe retainer secures the date. {{custom.cancellation}}";
    assert.equal(newAgreementDepositLabel(trade, body), "Deposit");
    assert.equal(newAgreementDepositLabel(trade, body, { "custom.cancellation": "It is not refundable." }), "Retainer");
    // A spelling the studio typed in the token still finds its value.
    assert.equal(
      newAgreementDepositLabel(trade, "{{ Cancellation Policy }}", { "custom.cancellation_policy": "No refunds of the retainer." }),
      "Retainer",
    );
  }
  // Record-only fields are StudioCue's: a typed value for one is never shown, so never read.
  assert.equal(
    termsTieRefundToRetainer("{{price.retainer}} {{payment.schedule}}", {
      "price.retainer": "non-refundable retainer",
      "payment.schedule": "retainer kept",
    }),
    false,
  );
  // Only the field's value is read, and only where its token is.
  assert.equal(
    termsTieRefundToRetainer("## Fees\nThe retainer books the date.\n\n## Cancellation\n{{custom.cancellation}}", {
      "custom.cancellation": "No refunds.",
    }),
    false,
  );
  assert.equal(
    termsTieRefundToRetainer("## Fees\nThe retainer books the date.", { "custom.unused": "The retainer is non-refundable." }),
    false,
  );
  // A photographer's is "Retainer" whatever was typed.
  assert.equal(newAgreementDepositLabel("photographer", imported.body, { [field]: "The deposit is refundable." }), "Retainer");
});

test("the editor says when a vendor's own words name the payment both ways", () => {
  // The new starter, with a cancellation term about "the retainer" — as the
  // vendor walk used to fill it in: the schedule stays Retainer, the fees clause says deposit.
  const beautyTied = BEAUTY_STARTER_AGREEMENT.replace(
    /\[Replace with your cancellation terms[^\]]*\]/,
    "The retainer is non-refundable. Anyone booked who does not sit is charged in full.",
  );
  const djTied = starterAgreementFor("dj").body.replace(
    /\[Replace with your own cancellation[^\]]*\]/,
    "The retainer is non-refundable. A new date within a year can be arranged once.",
  );
  for (const [trade, body] of [["makeup", beautyTied], ["hair", beautyTied], ["dj", djTied]] as const) {
    assert.notEqual(body, starterAgreementFor(trade).body, "the placeholder is still in the starter");
    assert.equal(newAgreementDepositLabel(trade, body), "Retainer", trade);
    const clash = depositWordingClash(trade, body);
    assert.ok(clash, trade);
    assert.equal(clash.printed, "Retainer");
    assert.equal(clash.other, "deposit");
    assert.deepEqual(
      clash.lines.map((entry) => entry.text),
      [
        "The total fee is {{price.total}}. A deposit of {{price.retainer}} reserves the date, and the balance of {{price.balance}} is due as follows:",
      ],
      trade,
    );
    assert.equal(body.split("\n")[clash.lines[0]!.line - 1]!.trim(), clash.lines[0]!.text);
    // Worded one way, nothing to say: the starter as given, or with a deposit term.
    assert.equal(depositWordingClash(trade, starterAgreementFor(trade).body), null, trade);
    assert.equal(
      depositWordingClash(trade, body.replace("The retainer is non-refundable.", "The deposit is non-refundable.")),
      null,
      trade,
    );
  }
  // Saved from the old starter: the schedule says Deposit, the studio's fees sentence says retainer.
  const old = depositWordingClash("hair", SAVED_FROM_OLD_STARTER);
  assert.ok(old);
  assert.equal(old.printed, "Deposit");
  assert.equal(old.other, "retainer");
  assert.deepEqual(old.lines.map((entry) => entry.line), [8]);
  assert.match(old.lines[0]!.text, /^The total fee is \{\{price\.total\}\}\. A retainer of \{\{price\.retainer\}\} reserves the date/);
  // Never for a photographer, whose schedule prints Retainer as it always has.
  for (const trade of [undefined, "photographer"]) {
    assert.equal(depositWordingClash(trade, beautyTied), null);
    assert.equal(depositWordingClash(trade, SAVED_FROM_OLD_STARTER), null);
  }
  // The editor shows it; it never changes the studio's text.
  const editor = read("components/contracts/agreement-editor.tsx");
  assert.match(editor, /const wordingClash = depositWordingClash\(workspace\.tenantTrade, body\);/);
  assert.match(editor, /\{wordingClash \? \(\s*<section className="agreement-price-clauses" role="note">/);
  assert.doesNotMatch(editor, /setBody\([^)]*wordingClash/);
});

test("the vendor walk writes its refund terms about the deposit, and checks the schedule says Deposit", () => {
  const walk = read("scripts/uat/vendor-journeys-walk.mts");
  assert.doesNotMatch(walk, /The retainer is non-refundable/);
  assert.equal((walk.match(/"The deposit is non-refundable\. /g) ?? []).length, 2);
  assert.match(
    walk,
    /record\(\s*"the agreement's payment schedule says Deposit",\s*scheduleRow\?\.label === "Deposit" && contract\?\.depositLabel === "Deposit",/,
  );
  // So the agreements it walks are worded one way and print Deposit.
  const beauty = BEAUTY_STARTER_AGREEMENT.replace(
    /\[Replace with your cancellation terms[^\]]*\]/,
    "The deposit is non-refundable. Anyone booked who does not sit is charged in full.",
  );
  const dj = starterAgreementFor("dj").body.replace(
    /\[Replace with your own cancellation[^\]]*\]/,
    "The deposit is non-refundable. A new date within a year can be arranged once.",
  );
  for (const [trade, body] of [["makeup", beauty], ["hair", beauty], ["dj", dj]] as const) {
    assert.equal(newAgreementDepositLabel(trade, body), "Deposit", trade);
    assert.equal(depositWordingClash(trade, body), null, trade);
  }
});
