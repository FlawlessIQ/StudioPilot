import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  ONE_OFF_FALLBACK_COVERAGE_MINUTES,
  ONE_OFF_FALLBACK_RETAINER,
  isCataloguePackage,
  isOneOffPackage,
  oneOffCoverage,
  oneOffCoverageMinutes,
  oneOffDescription,
  oneOffInclusionLines,
  oneOffProjectId,
  oneOffRetainerRule,
  oneOffTaxRate,
  oneOffTerms,
} from "@/features/packages/one-off";
import { dollarsToCents, parseOneOffForm, type OneOffFormValues } from "@/features/packages/one-off-form";
import { packageInclusionItems } from "@/features/packages/inclusions";
import { DEFAULT_PROPOSAL_TERMS } from "@/features/booking/autopilot";
import { oneOffReplaceConfirmText } from "@/features/proposals/workspace-guards";
import { friendlyError } from "@/lib/ai/friendly-error";

/**
 * GR Productions, 2026-10-01: "No ability for creating custom package." A
 * studio quotes one-off packages for a single couple all the time; the
 * proposal only offered the library. A one-off is now a real package flagged
 * for its job, made and locked in one command, and left out of every list of
 * the studio's catalogue.
 */
const source = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");

const library = { id: "gold", active: true, retainerRule: { type: "fixed", amountCents: 200000 }, taxRateBasisPoints: 0 };
const oneOffForSmith = { id: "smith-elopement", active: true, oneOff: { projectId: "smith" } };

test("the catalogue filter keeps the library and a job's own one-off, and nothing else", () => {
  assert.equal(isCataloguePackage(library), true);
  assert.equal(isCataloguePackage(library, { projectId: "chen" }), true);
  // Another couple's one-off is in no list.
  assert.equal(isCataloguePackage(oneOffForSmith), false);
  assert.equal(isCataloguePackage(oneOffForSmith, { projectId: "chen" }), false);
  // Its own job may see it again (swapped off and back on).
  assert.equal(isCataloguePackage(oneOffForSmith, { projectId: "smith" }), true);
  // A malformed flag still hides it; a null one does not.
  assert.equal(isCataloguePackage({ oneOff: {} }, { projectId: "smith" }), false);
  assert.equal(isCataloguePackage({ oneOff: null }), true);
  assert.equal(isCataloguePackage(null), false);
  assert.equal(isOneOffPackage(oneOffForSmith), true);
  assert.equal(oneOffProjectId(oneOffForSmith), "smith");
  assert.equal(oneOffProjectId(library), null);
});

test("retainer: replacing takes the main package's rule; added alongside takes its share", () => {
  const mainSnapshot = { totalCents: 800000, retainerCents: 200000 };
  assert.deepEqual(
    oneOffRetainerRule({ mode: "replace", mainPackage: library, mainSnapshot, catalogue: [] }),
    { type: "fixed", amountCents: 200000 },
  );
  // A fixed $2,000 deposit is not asked for again on a $500 extra: 25% of it.
  assert.deepEqual(
    oneOffRetainerRule({ mode: "add", mainPackage: library, mainSnapshot, catalogue: [] }),
    { type: "percentage", basisPoints: 2500 },
  );
  const percentage = { retainerRule: { type: "percentage", basisPoints: 3000 } };
  assert.deepEqual(
    oneOffRetainerRule({ mode: "add", mainPackage: percentage, mainSnapshot, catalogue: [] }),
    { type: "percentage", basisPoints: 3000 },
  );
  // An imported booking's package resolves to nothing; its snapshot still says the share.
  assert.deepEqual(
    oneOffRetainerRule({ mode: "add", mainPackage: null, mainSnapshot: { totalCents: 400000, retainerCents: 100000 }, catalogue: [] }),
    { type: "percentage", basisPoints: 2500 },
  );
});

test("retainer with no package on the job: the studio's most common rule, else 25%", () => {
  const catalogue = [
    { active: true, retainerRule: { type: "percentage", basisPoints: 3000 } },
    { active: true, retainerRule: { type: "fixed", amountCents: 100000 } },
    { active: true, retainerRule: { type: "fixed", amountCents: 100000 } },
    // Not counted: inactive, or someone's one-off.
    { active: false, retainerRule: { type: "percentage", basisPoints: 5000 } },
    { active: true, oneOff: { projectId: "x" }, retainerRule: { type: "percentage", basisPoints: 5000 } },
    { active: true, oneOff: { projectId: "y" }, retainerRule: { type: "percentage", basisPoints: 5000 } },
  ];
  assert.deepEqual(
    oneOffRetainerRule({ mode: "replace", mainPackage: null, mainSnapshot: null, catalogue }),
    { type: "fixed", amountCents: 100000 },
  );
  assert.deepEqual(
    oneOffRetainerRule({ mode: "add", mainPackage: null, mainSnapshot: null, catalogue: [] }),
    ONE_OFF_FALLBACK_RETAINER,
  );
  assert.deepEqual(ONE_OFF_FALLBACK_RETAINER, { type: "percentage", basisPoints: 2500 });
  // A per-crew rule keeps the roles it bills.
  assert.deepEqual(
    oneOffRetainerRule({
      mode: "replace",
      mainPackage: { retainerRule: { type: "per_crew_member", amountPerCrewCents: 100000, billedRoles: ["videographer"] } },
      mainSnapshot: {},
      catalogue: [],
    }),
    { type: "per_crew_member", amountPerCrewCents: 100000, billedRoles: ["videographer"] },
  );
});

test("tax: the main package's rate, else the rate the catalogue shares, else none", () => {
  assert.equal(oneOffTaxRate({ mainPackage: { taxRateBasisPoints: 825 }, catalogue: [] }), 825);
  const shared = [
    { active: true, taxRateBasisPoints: 700 },
    { active: true, taxRateBasisPoints: 700 },
    { active: true, oneOff: { projectId: "x" }, taxRateBasisPoints: 0 },
  ];
  assert.equal(oneOffTaxRate({ mainPackage: null, catalogue: shared }), 700);
  assert.equal(
    oneOffTaxRate({ mainPackage: null, catalogue: [...shared, { active: true, taxRateBasisPoints: 0 }] }),
    0,
  );
  assert.equal(oneOffTaxRate({ mainPackage: null, catalogue: [] }), 0);
});

test("terms: replacing keeps the studio's written terms; otherwise the default wording", () => {
  const written = "Retainer is non-refundable. Balance due 14 days before the wedding.";
  assert.equal(oneOffTerms({ mode: "replace", mainTerms: written }), written);
  assert.equal(oneOffTerms({ mode: "add", mainTerms: written }), DEFAULT_PROPOSAL_TERMS);
  assert.equal(oneOffTerms({ mode: "replace", mainTerms: "" }), DEFAULT_PROPOSAL_TERMS);
});

test("coverage left blank: one photographer, and the main package's hours or a wedding day", () => {
  assert.deepEqual(oneOffCoverage(undefined), [{ role: "photographer", count: 1 }]);
  assert.deepEqual(
    oneOffCoverage([
      { role: "videographer", count: 1 },
      { role: "photographer", count: 2 },
    ]),
    [
      { role: "photographer", count: 2 },
      { role: "videographer", count: 1 },
    ],
  );
  assert.equal(oneOffCoverageMinutes(240, 600), 240);
  assert.equal(oneOffCoverageMinutes(undefined, 600), 600);
  assert.equal(oneOffCoverageMinutes(null, undefined), ONE_OFF_FALLBACK_COVERAGE_MINUTES);
  assert.equal(ONE_OFF_FALLBACK_COVERAGE_MINUTES, 480);
});

test("what's included, one per line, becomes the same bullets on the proposal", () => {
  const lines = oneOffInclusionLines("- 4 hours of coverage\n\n• Online gallery\r\n3) 150 edited photos  \n");
  assert.deepEqual(lines, ["4 hours of coverage", "Online gallery", "150 edited photos"]);
  // The description is those lines, and the proposal reads them back unchanged.
  assert.deepEqual(packageInclusionItems(oneOffDescription(lines)), lines);
  assert.equal(oneOffInclusionLines(Array.from({ length: 60 }, (_, index) => `Item ${index}`)).length, 40);
});

test("dollars as typed become integer cents", () => {
  assert.equal(dollarsToCents("2500"), 250000);
  assert.equal(dollarsToCents("$2,500.50"), 250050);
  assert.equal(dollarsToCents("19.99"), 1999);
  assert.equal(dollarsToCents("0"), 0);
  assert.equal(dollarsToCents(".5"), 50);
  assert.equal(dollarsToCents(""), null);
  assert.equal(dollarsToCents("-10"), null);
  assert.equal(dollarsToCents("ten"), null);
  assert.equal(dollarsToCents("1.234"), null);
});

const form = (overrides: Partial<OneOffFormValues> = {}): OneOffFormValues => ({
  name: "Elopement",
  price: "2,500",
  included: "4 hours of coverage\nOnline gallery",
  photographers: "",
  videographers: "",
  hours: "",
  mode: "add",
  saveToLibrary: false,
  ...overrides,
});

test("the form reads into the command, leaving blanks to the server's defaults", () => {
  const parsed = parseOneOffForm(form());
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.input, {
    name: "Elopement",
    basePriceCents: 250000,
    included: ["4 hours of coverage", "Online gallery"],
    mode: "add",
    saveToLibrary: false,
  });
  const full = parseOneOffForm(form({ photographers: "2", videographers: "1", hours: "7.5", mode: "replace", saveToLibrary: true }));
  assert.equal(full.ok, true);
  if (!full.ok) return;
  assert.deepEqual(full.input.includedCoverage, [
    { role: "photographer", count: 2 },
    { role: "videographer", count: 1 },
  ]);
  assert.equal(full.input.includedCoverageMinutes, 450);
  assert.equal(full.input.saveToLibrary, true);
});

test("the form refuses what the server would, in plain words", () => {
  const message = (values: Partial<OneOffFormValues>) => {
    const parsed = parseOneOffForm(form(values));
    return parsed.ok ? null : parsed.message;
  };
  assert.equal(message({ name: " " }), "Give the package a name.");
  assert.match(message({ price: "" }) ?? "", /Give it a price/);
  assert.match(message({ included: "\n \n" }) ?? "", /what's included/);
  assert.match(message({ included: "Photos" }) ?? "", /a little more/);
  assert.match(message({ photographers: "0", videographers: "0" }) ?? "", /at least one/);
  assert.match(message({ photographers: "two" }) ?? "", /whole numbers/);
  assert.match(message({ hours: "30" }) ?? "", /between 0 and 24/);
});

test("replacing names only what comes off", () => {
  assert.equal(
    oneOffReplaceConfirmText("Elopement", [{ name: "Gold" }]),
    "This takes Gold off the job, with any extras and discount on it, and puts Elopement in its place.",
  );
  assert.equal(
    oneOffReplaceConfirmText("Elopement", [{ name: "Gold" }, { name: "Video" }]),
    "This takes Gold and Video off the job, with any extras and discount on them, and puts Elopement in their place.",
  );
  assert.equal(oneOffReplaceConfirmText("Elopement", []), null);
});

test("the functions copy of the one-off helpers matches features/", () => {
  const body = (path: string) => source(path).slice(source(path).indexOf("// ── mirrored below ──"));
  assert.equal(body("functions/src/packages/one-off.ts"), body("features/packages/one-off.ts"));
});

const crm = source("functions/src/crm/commands.ts");
const handler = crm.slice(
  crm.indexOf('if (command.type === "createOneOffPackage")'),
  crm.indexOf('command.type === "', crm.indexOf('if (command.type === "createOneOffPackage")') + 20),
);

test("the command checks role, tenant and assignment before it writes", () => {
  assert.match(crm, /type: z\.literal\("createOneOffPackage"\)/);
  assert.ok(handler.length > 1000, "createOneOffPackage handler not found");
  const firstWrite = handler.indexOf("transaction.create(");
  for (const guard of [
    /managerRoles\.includes\(membershipData\.role\)[\s\S]*ONE_OFF_PACKAGE_NEEDS_OWNER/,
    /projectDocument\.get\("tenantId"\) !== command\.tenantId/,
    /hasProjectAccess\(membershipData, command\.input\.projectId\)/,
    /assertPackagesEditable\(transaction/,
    /PACKAGE_ALREADY_SELECTED/,
    /PACKAGE_LIMIT_REACHED/,
  ]) {
    const match = guard.exec(handler);
    assert.ok(match, `missing ${guard}`);
    assert.ok(match.index < firstWrite, `${guard} comes after a write`);
  }
  // Read inside the studio, written with the studio's id.
  assert.match(handler, /where\("tenantId", "==", command\.tenantId\)/);
  assert.match(handler, /tenantId: command\.tenantId,\s+name: command\.input\.name/);
  // One price, as every other package (H2), and a receipt for retries.
  assert.match(handler, /pricePackage\(\{/);
  assert.match(handler, /transaction\.create\(commandReference/);
  // Flagged unless saved to the Library, and hidden from couples either way.
  assert.match(handler, /oneOff \? \{ oneOff: \{ projectId: command\.input\.projectId/);
  assert.match(handler, /publicVisible: false/);
});

test("selectPackage and an amendment refuse another couple's one-off", () => {
  const select = crm.slice(crm.indexOf('if (command.type === "selectPackage")'));
  assert.match(select.slice(0, 8000), /isCataloguePackage\(studioPackage, \{ projectId: command\.input\.projectId \}\)/);
  assert.match(
    source("functions/src/contracts/amendments.ts"),
    /isCataloguePackage\(studioPackage\.data\(\), \{ projectId: input\.projectId \}\)/,
  );
});

/**
 * Every reader that lists the studio's catalogue, and the filter it applies.
 * A new list of packages to choose from belongs here too.
 */
const CATALOGUE_READERS: Array<[string, RegExp]> = [
  ["components/proposals/proposal-packages-panel.tsx", /isCataloguePackage\(record, \{ projectId \}\)/],
  ["components/proposals/studio-proposal-workspace.tsx", /isCataloguePackage\(item, \{ projectId: packagePickerFor\?\.id \?\? null \}\)/],
  ["components/booking/booking-autopilot-workspace.tsx", /isCataloguePackage\(item\.data\(\), \{ projectId \}\)/],
  ["components/booking/booking-amendment.tsx", /isCataloguePackage\(item, \{ projectId \}\)/],
  ["components/ai/flow-runner.tsx", /isCataloguePackage\(p, \{ projectId \}\)/],
  ["components/ai/actions/studio-actions.tsx", /useRecords\("packages"\)\?\.filter\(\(item\) => isCataloguePackage\(item\)\)/],
  ["components/library/library-shelves.tsx", /counts: \(record\) => isCataloguePackage\(record\)/],
  ["components/studio/live-domain-view.tsx", /config\.collection === "packages"\s+\? records\.filter\(\(record\) => isCataloguePackage\(record\)\)/],
  ["components/setup/use-setup-state.ts", /item\.active === true && isCataloguePackage\(item\)/],
  ["app/api/client/portal/route.ts", /\.filter\(\(document\) => isCataloguePackage\(document\.data\(\)\)\)/],
  ["functions/src/operations/ai-pdf.ts", /isCataloguePackage\(document\.data\(\),\{projectId\}\)/],
  ["functions/src/ai/message-draft.ts", /isCataloguePackage\(item\.data\(\)\)/],
  ["server/repositories/package-repository.ts", /isCataloguePackage\(document\.data\(\)\)/],
];

test("every list of the studio's catalogue leaves out other couples' one-offs", () => {
  for (const [path, filter] of CATALOGUE_READERS) assert.match(source(path), filter, `${path} lists one-offs`);
  // The couple's own request path is refused as well as the list.
  assert.match(source("app/api/client/portal/route.ts"), /!isCataloguePackage\(studioPackage\.data\(\)\) \|\|/);
});

test("the panel and the composer offer it, and the job's list tags it", () => {
  const panel = source("components/proposals/proposal-packages-panel.tsx");
  const composer = source("components/proposals/studio-proposal-workspace.tsx");
  for (const surface of [panel, composer]) {
    assert.match(surface, /Write a one-off package/);
    assert.match(surface, /runCrmCommand\(\s*"createOneOffPackage"/);
    assert.match(surface, /\{ idempotencyKey \}/);
    assert.match(surface, /oneOffReplaceConfirmText\(/);
    assert.match(surface, /className="one-off-tag">One-off</);
  }
  // The panel re-prices the proposal the way every package change there does.
  assert.match(panel, /const writeOneOff[\s\S]*?return change\(/);
  assert.match(panel, /runProposalCommand\("revise_packages"/);
});

test("its refusals read as sentences", () => {
  for (const code of ["ONE_OFF_PACKAGE_NEEDS_OWNER", "ONE_OFF_PACKAGE_NEEDS_DETAIL"]) {
    assert.match(crm, new RegExp(`throw new Error\\("${code}"\\)`));
    assert.notEqual(friendlyError(new Error(code), "fallback"), "fallback", code);
  }
});
