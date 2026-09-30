import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { detailsForLine, packageDetails, packageInclusionItems } from "@/features/packages/inclusions";

/**
 * GR Productions' proposal (2026-09-30): the text of only one package, as a
 * paragraph, under "Investment"; a $10 retainer that didn't survive a save;
 * a logo too small to read; and no way to edit a package's description.
 */
const source = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");

test("a paragraph becomes one bullet per sentence, without breaking 9.5 or 1–1.5", () => {
  assert.deepEqual(
    packageInclusionItems(
      'One photographer with up to 8 hours of coverage. Second photographer with up to 6 hours of coverage. A 9.5" x 13" graphistudio album with 40 pages. Edited footage of the ceremony and reception (about 1–1.5 hours). Digital copy delivered via Dropbox.',
    ),
    [
      "One photographer with up to 8 hours of coverage",
      "Second photographer with up to 6 hours of coverage",
      'A 9.5" x 13" graphistudio album with 40 pages',
      "Edited footage of the ceremony and reception (about 1–1.5 hours)",
      "Digital copy delivered via Dropbox",
    ],
  );
});

test("one item per line is kept as written, bullets and numbers stripped", () => {
  assert.deepEqual(packageInclusionItems("- Drone footage\n• Two videographers.\n3) Online gallery\n\n"), [
    "Drone footage",
    "Two videographers",
    "Online gallery",
  ]);
  assert.deepEqual(packageInclusionItems("Coverage each.. Drone included.."), ["Coverage each", "Drone included"]);
  assert.deepEqual(packageInclusionItems(""), []);
  assert.deepEqual(packageInclusionItems(undefined), []);
});

test("every package on the proposal gets its own bullets, matched by name", () => {
  const details = packageDetails([
    { id: "s1", data: { packageName: "Gold Photo Package", description: "Unlimited photography. Album included." } },
    { id: "s2", data: { packageName: "Silver Cinematic Package", description: "One videographer for 8 hours." } },
  ]);
  assert.deepEqual(detailsForLine(details, "Gold Photo Package"), ["Unlimited photography", "Album included"]);
  assert.deepEqual(detailsForLine(details, "Silver Cinematic Package"), ["One videographer for 8 hours"]);
  assert.deepEqual(detailsForLine(details, "Engagement session"), []);
  assert.deepEqual(detailsForLine(undefined, "Gold Photo Package"), []);
});

test("the functions copy of inclusions matches features/", () => {
  const body = (path: string) => source(path).slice(source(path).indexOf("export type PackageDetail"));
  assert.equal(body("functions/src/packages/inclusions.ts"), body("features/packages/inclusions.ts"));
});

test("every proposal write stores the bullets, and the PDF job fills in older ones", () => {
  const proposals = source("functions/src/booking/proposals.ts");
  assert.equal((proposals.match(/packageDetails: packageDetails\(/g) ?? []).length, 2, "create_draft and revise_packages");
  assert.match(source("functions/src/contracts/amendments.ts"), /packageDetails: packageDetails\(nextSnapshots\)/);
  const worker = source("functions/src/operations/ai-pdf.ts");
  assert.match(worker, /details:detailsForLine\(details,string\(line\.description\)\)/);
  assert.match(worker, /packageDetails:input\.packageDetails/);
});

test("a draft save that leaves the retainer out keeps it", () => {
  const proposals = source("functions/src/booking/proposals.ts");
  assert.match(
    proposals,
    /command\.input\.retainerOverrideCents === undefined\s*\? typeof storedOverride === "number"\s*\? storedOverride\s*: null\s*: command\.input\.retainerOverrideCents;/,
  );
  const page = source("components/proposals/studio-proposal-workspace.tsx");
  assert.match(page, /aria-label="Retainer amount"[\s\S]*onChange=\{\(eventValue\) => setDraftRetainer/);
  assert.match(page, /if \(draftRetainer !== null\) \{\s*input\.retainerOverrideCents =/);
  // Cue's draft save sends the schedule's dates, not fields that don't exist.
  const cue = source("components/ai/actions/booking-actions.tsx");
  assert.match(cue, /retainerDueDate: scheduleDue\(proposal\.paymentSchedule, 0\)/);
  assert.doesNotMatch(cue, /str\(proposal\.retainerDueDate\)/);
});

test("the proposal says Packages, lists bullets, and the package editor can change them", () => {
  const page = source("components/proposals/studio-proposal-workspace.tsx");
  assert.match(page, /<p className="eyebrow">Packages<\/p>/);
  assert.doesNotMatch(page, /<p className="eyebrow">Investment<\/p>/);
  assert.doesNotMatch(page, /setNotes\(cleanIntro\(/, "the intro isn't one package's description");
  assert.match(source("components/client/kit/client-proposal.tsx"), /detailsForLine\(proposal\.packageDetails, line\.description\)/);
  const pdf = source("cloud-run/pdf/main.py");
  assert.match(pdf, /Paragraph\("PACKAGES", styles\["Brand"\]\)/);
  assert.match(pdf, /Image\(io\.BytesIO\(_trimmed_logo\(raw\)\)\)/);
  const editor = source("components/crm/edit-package-form.tsx");
  assert.match(editor, /What&apos;s included/);
  assert.match(editor, /\.\.\.\(edits\.terms !== undefined \? \{ terms: terms\.trim\(\) \} : \{\}\)/);
  assert.match(source("functions/src/crm/commands.ts"), /terms: z\.string\(\)\.trim\(\)\.max\(6000\)\.optional\(\),/);
  assert.match(source("lib/branding/logo-upload.ts"), /const prepared = \(await trimmedLogo\(file\)\) \?\? file;/);
});

test("a dialog keeps focus in its fields while the reader types", () => {
  const sheet = source("components/ui/sheet-dialog.tsx");
  assert.match(sheet, /if \(event\.key === "Escape"\) closeRef\.current\(\);/);
  assert.match(sheet, /\}, \[open\]\);/, "the focus effect runs on open and close only");
  assert.doesNotMatch(sheet, /\}, \[open, onClose\]\);/);
});

test("the agreement lists every package's coverage and inclusions", () => {
  const sources = source("functions/src/contracts/sources.ts");
  assert.match(sources, /combineCoverage\(allSnapshots\.map\(\(data\) => resolveCoverage\(data\)\)\)/);
  assert.match(sources, /return items\.length \? \[`\$\{text\(data\.packageName\) \|\| "Package"\}:`, \.\.\.items\] : \[\];/);
});

test("QuickBooks matches a customer by name before creating one, and names a clash apart", () => {
  const runtime = source("functions/src/operations/provider-runtime.ts");
  assert.match(runtime, /select \* from Customer where DisplayName = /);
  assert.match(runtime, /\/already exists\/i\.test\(caught\.message\)/);
  assert.match(runtime, /create\(`\$\{displayName\} \(\$\{email\}\)`\.slice\(0,100\),"-2"\)/);
});

test("the agreement lists what the proposal lists: the package's What's included", () => {
  const sources = source("functions/src/contracts/sources.ts");
  assert.match(sources, /const written = packageInclusionItems\(data\.description\);\s*if \(written\.length\) return written;/);
  assert.match(source("components/proposals/proposal-packages-panel.tsx"), /<p className="eyebrow">Change packages<\/p>/);
});

test("Part 2 of the booking agreement lists each package with its bullets", async () => {
  const { buildCombinedAgreement } = await import("@/features/contracts/combined");
  const { document } = buildCombinedAgreement(
    { format: "structured", title: "Agreement", blocks: [{ type: "paragraph", content: [{ text: "Terms." }] }] } as never,
    {
      currency: "USD",
      lineItems: [
        { description: "Gold Photo Package", quantity: 1, totalCents: 499900, kind: "package", details: ["Unlimited photography", "Album"] },
        { description: "Silver Cinematic Package", quantity: 1, totalCents: 299900, kind: "package", details: ["One videographer for 8 hours"] },
      ],
      discountCents: 0,
      taxCents: 0,
      totalCents: 799800,
      paymentSchedule: [],
    },
  );
  const flat = JSON.stringify(document.blocks);
  for (const words of ["Gold Photo Package — $4,999.00", "Unlimited photography", "Silver Cinematic Package — $2,999.00", "One videographer for 8 hours"])
    assert.ok(flat.includes(words), words);
  assert.match(source("functions/src/contracts/combined-commands.ts"), /details: detailsForLine\(proposal\.get\("packageDetails"\), line\.description\)/);
});
