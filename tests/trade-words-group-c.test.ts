import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildCombinedAgreement,
  combinedSectionTitles,
  COMBINED_SECTION_TITLES,
} from "@/features/contracts/combined";
import {
  contractMergeFields,
  contractMergeFieldsFor,
  convertImportedAgreement,
  DETAILS_SECTION,
  detailsSectionFor,
  type ContractDocument,
} from "@/features/contracts/document";
import { eventDetailsFrom } from "@/features/contracts/event-details";
import { sampleContractSources, starterAgreementFor } from "@/features/contracts/sample";
import {
  newPackageIntro,
  packagesPageDescription,
  packagesShelfDescription,
} from "@/components/crm/package-copy";
import { combinedSectionTitles as serverSectionTitles } from "../functions/src/contracts/combined";
import { contractMergeFieldsFor as serverMergeFieldsFor } from "../functions/src/contracts/document";
import { eventDetailsFrom as serverEventDetailsFrom } from "../functions/src/contracts/event-details";
import { voidedContractNextAction } from "../functions/src/contracts/commands";

/**
 * Packages, proposals, the Library, the agreement editor and imports in each
 * trade's words (docs/vendor-journeys-plan.md, 2026-10-09).
 *
 * A hair studio's agreement editor offered "Coverage" and "Deliverables
 * (list)", its preview read "Coverage: 2 hair stylists", and the agreement its
 * client signs carried the same row in Schedule A. Its Packages page promised
 * "coverage, deliverables", and its quotes were "Proposals". A photographer's
 * words stay exactly as they were.
 */
const read = (path: string) => readFileSync(path, "utf8");
const VENDORS = ["dj", "makeup", "hair"] as const;
const PHOTO_WORDS = /\b(photo(s|graph\w*)?|galler(y|ies)|shoot(s|ing)?|shot lists?|albums?|coverage|deliverables?)\b/i;

test("Schedule A's people-and-hours row is the trade's own word, a photographer's still Coverage", () => {
  const input = {
    eventType: "Wedding",
    eventKind: "wedding",
    date: "June 12, 2027",
    venue: "The Lodge",
    coverage: "2 hair stylists",
    answers: [],
    lockDaysBefore: 30,
  };
  for (const build of [eventDetailsFrom, serverEventDetailsFrom]) {
    for (const trade of VENDORS) {
      const rows = build({ ...input, trade }).rows;
      assert.ok(rows.some((row) => row.label === "Service" && row.value === "2 hair stylists"), trade);
      assert.ok(!rows.some((row) => row.label === "Coverage"), trade);
    }
    for (const trade of ["photographer", null, undefined, "Photographer", "florist"]) {
      assert.ok(build({ ...input, trade }).rows.some((row) => row.label === "Coverage"), String(trade));
    }
  }
  // The editor's preview is the same rows.
  const hair = sampleContractSources("Crown & Pin", "2026-10-09", "hair");
  assert.deepEqual(
    hair.eventDetails?.rows.find((row) => row.value === "2 hair stylists"),
    { label: "Service", value: "2 hair stylists" },
  );
  assert.ok(sampleContractSources("Studio", "2026-10-09").eventDetails?.rows.some((row) => row.label === "Coverage"));
});

test("the agreement editor's fields read Service and What's included for a vendor", () => {
  assert.equal(contractMergeFieldsFor("photographer"), contractMergeFields);
  assert.equal(contractMergeFieldsFor(undefined), contractMergeFields);
  for (const fieldsFor of [contractMergeFieldsFor, serverMergeFieldsFor]) {
    for (const trade of VENDORS) {
      const fields = fieldsFor(trade);
      const byKey = Object.fromEntries(fields.map((field) => [field.key, field]));
      assert.equal(byKey["package.coverage"]?.label, "Service", trade);
      assert.equal(byKey["package.deliverables"]?.label, "What's included (list)", trade);
      // The same keys, in the same order: only what the studio reads changes.
      assert.deepEqual(fields.map((field) => field.key), contractMergeFields.map((field) => field.key));
      for (const field of fields) {
        assert.doesNotMatch(`${field.label} ${field.example}`, /photograph|gallery|album|coverage|deliverable/i, `${trade} ${field.key}`);
      }
    }
  }
  const editor = read("components/contracts/agreement-editor.tsx");
  assert.match(editor, /contractMergeFieldsFor\(workspace\.tenantTrade\)\.map/);
  assert.doesNotMatch(editor, /contractMergeFields\.map/);
  // "When a quote is accepted" for a makeup artist or hair stylist.
  assert.match(editor, /\{`When a \$\{offer\} is accepted`\}/);
  assert.doesNotMatch(editor, /When a proposal is accepted/);
});

test("the booking agreement's Part 2 is the client's service, a photographer's their coverage", () => {
  assert.equal(combinedSectionTitles().coverage, COMBINED_SECTION_TITLES.coverage);
  assert.equal(combinedSectionTitles("photographer").coverage, "Part 2 — Your coverage");
  for (const titles of [combinedSectionTitles, serverSectionTitles])
    for (const trade of VENDORS) assert.equal(titles(trade).coverage, "Part 2 — Your service", trade);
  const terms: ContractDocument = {
    format: 1,
    title: "Hair Services Agreement",
    blocks: [{ type: "paragraph", content: [{ text: "This agreement is between the Studio and the Client." }] }],
  };
  const coverage = {
    currency: "USD",
    lineItems: [{ description: "Bridal hair with trial", quantity: 1, totalCents: 104_000 }],
    discountCents: 0,
    taxCents: 0,
    totalCents: 104_000,
    paymentSchedule: [{ label: "Retainer", amountCents: 26_000, dueDate: null }],
  };
  const hair = buildCombinedAgreement(terms, coverage, "hair");
  assert.equal(hair.sections[1]?.title, "Part 2 — Your service");
  assert.doesNotMatch(JSON.stringify(hair.document), /coverage/i);
  // A photographer's, with or without the trade, is the document it always was.
  assert.deepEqual(buildCombinedAgreement(terms, coverage, "photographer"), buildCombinedAgreement(terms, coverage));
  assert.equal(buildCombinedAgreement(terms, coverage).sections[1]?.title, "Part 2 — Your coverage");
  assert.match(read("functions/src/contracts/combined-commands.ts"), /tenantTrade\(db, context\.tenantId\)/);
});

test("an imported agreement and a DJ's starter are for services, not coverage", () => {
  assert.equal(detailsSectionFor("photographer"), DETAILS_SECTION);
  assert.equal(detailsSectionFor(undefined), DETAILS_SECTION);
  for (const trade of VENDORS) {
    assert.match(detailsSectionFor(trade), /\{\{event\.type\}\} services on/);
    assert.doesNotMatch(detailsSectionFor(trade), /coverage/);
    assert.match(convertImportedAgreement("Cancellation: the retainer is non-refundable.", trade).body, /services on/);
  }
  assert.match(convertImportedAgreement("Cancellation: the retainer is non-refundable.").body, /coverage on/);
  assert.match(starterAgreementFor("dj").body, /\{\{event\.type\}\} services on/);
  // Its {{package.coverage}} field is a key, the same for every trade; the words around it are a DJ's.
  assert.doesNotMatch(starterAgreementFor("dj").body.replace(/\{\{[^}]+\}\}/g, ""), /coverage|image|copyright|photograph/i);
  assert.match(starterAgreementFor("photographer").body, /\{\{event\.type\}\} coverage on/);
  assert.match(read("functions/src/contracts/commands.ts"), /convertImportedAgreement\(text, await tenantTrade\(db, context\.tenantId\)\)/);
});

test("Packages and the Library describe a vendor's packages without coverage or deliverables", () => {
  assert.equal(
    packagesPageDescription("photographer"),
    "Build reusable offers with pricing, coverage, deliverables, and add-ons. Existing project prices never change.",
  );
  assert.equal(newPackageIntro(undefined), "Define the price, coverage, retainer, and deliverables clients can choose.");
  assert.equal(packagesShelfDescription("photographer"), "Build reusable offers, pricing, coverage, and add-ons.");
  for (const trade of VENDORS) {
    for (const copy of [packagesPageDescription(trade), newPackageIntro(trade), packagesShelfDescription(trade)]) {
      assert.doesNotMatch(copy, PHOTO_WORDS, `${trade}: ${copy}`);
      assert.match(copy, /what's included/, trade);
    }
  }
  assert.match(read("app/studio/packages/page.tsx"), /<PackagesDomainPage /);
  assert.match(read("app/studio/packages/new/page.tsx"), /<NewPackageIntro \/>/);
  assert.match(read("components/library/library-shelves.tsx"), /packagesShelfDescription\(trade\)/);
});

test("the proposals list, composer and page say quote for a makeup artist or hair stylist", () => {
  const page = read("components/proposals/studio-proposal-workspace.tsx");
  // One source for the offer's words, read in all three screens.
  assert.match(page, /const Offer = tradeVocab\(trade\)\.proposal;/);
  assert.equal((page.match(/offerWords\(workspace\.tenantTrade\)/g) ?? []).length, 3);
  for (const was of [
    "<h1>Proposals</h1>",
    "<Plus /> New proposal",
    "Create a proposal\n",
    "Back to proposals\n",
    "<span>Proposal expires</span>",
    "<dt>Base coverage</dt>",
    // As fallbacks for a job or package with no name.
    ', "Photography project")',
    ', "Photography package")',
    ', "Photography proposal")',
    ', "Photography coverage")',
    "Proposals start from a project at the consultation or",
  ])
    assert.ok(!page.includes(was), was);
  // The words themselves: a photographer's and a DJ's proposal, a makeup
  // artist's or hair stylist's quote, and no consultation without a call.
  assert.match(page, /\$\{words\.Offers\} start from a project at the \$\{\s*tradeProfile\(workspace\.tenantTrade\)\.consultation \? vocab\.consultation\.toLowerCase\(\) : "inquiry"/);
  assert.match(page, /<dt>\{`Base \$\{vocab\.coverage\.toLowerCase\(\)\}`\}<\/dt>/);
  assert.match(page, /photo\s+\? " — add another package beside what's there \(photo and video, say\), "/);
  assert.match(read("components/proposals/live-proposal-preview.tsx"), /<strong>\{Offer\}<\/strong>/);
});

test("the package forms and the one-off say each trade's hours, people and inclusions", () => {
  const create = read("components/crm/create-package-form.tsx");
  assert.match(create, /\{words\.hoursLabel\}/);
  assert.match(create, /\{`\$\{words\.includedLabel\} \(comma separated\)`\}/);
  // The glossary's "Coverage" names photographers; a vendor's hint is its own.
  assert.match(create, /\{photoStudio \? \(\s*<InfoHint term="coverage" \/>/);
  const oneOff = read("components/proposals/one-off-package-form.tsx");
  assert.match(oneOff, /<span>\{roleHeading\(firstRole\)\}<\/span>/);
  assert.match(oneOff, /\{roles\[1\] \? \(/);
  assert.match(oneOff, /Left blank: one \$\{coverageRoleLabel\(firstRole, 1\)\} for \$\{hours\} hours\./);
  // A vendor's count is its own role, never a photographer, on the wire too.
  assert.match(oneOff, /role: item\.role === "videographer" \? roles\[1\] : firstRole/);
  assert.match(read("components/proposals/proposal-packages-panel.tsx"), /record=\{oneOffPackage\}/);
  assert.match(read("components/crm/edit-package-form.tsx"), /`Saved\. New \$\{offer\}s use these numbers;/);
});

test("importing a booking asks a hair studio for hours on site and hair stylists", () => {
  const form = read("components/imports/existing-booking-form.tsx");
  assert.match(form, /\{tradeVocab\(trade\)\.hoursLabel\}/);
  assert.match(form, /\{importCountHeading\(trade, 0\)\}/);
  assert.match(form, /\{importCountHeading\(trade, 1\) \? \(/);
  assert.doesNotMatch(form, /^\s+(Coverage hours|Photographers|Videographers)$/m);
  assert.match(form, /photo \? "Wedding photography" : `\$\{values\.eventType\} \$\{tradeVocab\(trade\)\.service\}`/);
});

test("the inquiry form asks about the studio's own trade", () => {
  const form = read("components/crm/lead-intake-form.tsx");
  assert.match(form, /legend=\{`\$\{TRADE_LABELS\[tradeOf\(trade\)\]\} budget`\}/);
  assert.match(form, /if \(family === "music"\) return "How many hours of music/);
  assert.match(form, /if \(family === "beauty"\) return "How many people, which services, a trial/);
});

test("a withdrawn booking agreement asks a makeup artist to correct the quote", () => {
  assert.equal(voidedContractNextAction("combined"), "Correct the proposal, or send a new booking agreement");
  assert.equal(voidedContractNextAction("combined", "photographer"), "Correct the proposal, or send a new booking agreement");
  assert.equal(voidedContractNextAction("combined", "dj"), "Correct the proposal, or send a new booking agreement");
  assert.equal(voidedContractNextAction("combined", "makeup"), "Correct the quote, or send a new booking agreement");
  assert.equal(voidedContractNextAction("combined", "hair"), "Correct the quote, or send a new booking agreement");
  assert.equal(voidedContractNextAction(undefined, "hair"), "Prepare a new contract and send it");
  // The sealed certificate's trail, in the studio's words.
  const seal = read("functions/src/contracts/seal.ts");
  assert.match(seal, /and the \$\{offer\}'s \$\{words\.coverage\.toLowerCase\(\)\} and price \(Part 2\)/);
});
