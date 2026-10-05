import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

/**
 * StudioCue speaks American English.
 *
 * On 2026-10-05 the reference studio read "Approving emails this to …
 * straight away" on the approval sheet and laughed: "In America we say right
 * away or immediately!" The phrase was in 22 places, beside "colour",
 * "organiser", "cheque", "fortnight", "in the diary" and "tick the box" — all
 * of it read by American studios and their clients. Everything was swept to
 * US English in one pass; this keeps it that way.
 *
 * It reads what a person can see — string literals, template text and JSX
 * text, not identifiers, comments or class names — and fails on a British
 * spelling or word. Stored values keep their spelling ("cancelled",
 * "inquiry_acknowledgement"): a bare lowercase token is an id, not prose, and
 * an all-caps one is a protocol word (STATUS:CANCELLED in a calendar file).
 *
 * Exempt: the versioned legal documents and the e-sign consent. People
 * accepted those exact words, so a spelling change is a new version for
 * counsel, not an edit.
 */
const BRITISH = new RegExp(
  "\\b(" +
    [
      "colour(s|ed|ful|ing)?",
      "favour(s|ed|ing|able|ite|ites)?",
      "behaviours?",
      "honour(s|ed)?",
      "centres?",
      "catalogues?",
      "fulfilment",
      "instalments?",
      "judgements?",
      "labell(ed|ing)",
      "licence",
      "acknowledgements?",
      "cancell(ed|ing)",
      "grey(ed)?",
      "cheques?",
      "enquir(y|ies|e|ed|ing)",
      "fortnights?",
      "diary",
      "(organ|recogn|author|summar|real|apolog|custom|personal|priorit|final|minim|maxim|special|categor|optim|standard|synchron|normal|util|critic|memor|item|capital|visual|emphas)is(e|ed|es|ing|er|ers|ation|ations)",
      "analys(e|ed|ing)",
      "practis(e|ed|ing)",
      "travell(ed|ing|er|ers)",
      "learnt",
      "spelt",
      "whilst",
      "amongst",
      "programmes?",
      "straight away",
      "(un)?tick(s|ed|ing)?",
    ].join("|") +
    ")\\b",
  "gi",
);

// functions/src/ai/language.ts names the British words it tells the model not to use.
const EXEMPT = /^(features\/legal\/|features\/contracts\/esign-consent\.ts$|functions\/src\/ai\/language\.ts$)/;
const files = globSync([
  "app/**/*.{ts,tsx}",
  "components/**/*.{ts,tsx}",
  "features/**/*.{ts,tsx}",
  "lib/**/*.{ts,tsx}",
  "server/**/*.{ts,tsx}",
  "functions/src/**/*.ts",
  "config/**/*.{ts,tsx}",
])
  .filter((file) => !/\.test\.|\/node_modules\//.test(file) && !EXEMPT.test(file))
  .sort();

function britishIn(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const parsed = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (
      ts.isJsxAttribute(node) &&
      ["className", "id", "key", "htmlFor", "name", "data-testid"].includes(node.name.getText())
    )
      return;
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      const text = node.text.trim();
      const prose = ts.isJsxText(node) || /\s/.test(text) || /^[A-Z]/.test(text);
      if (prose) {
        for (const match of text.matchAll(BRITISH)) {
          if (match[0] === match[0].toUpperCase()) continue;
          const line = parsed.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          found.push(`${file}:${line} "${match[0]}"`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return found;
}

test("what people read is American English", () => {
  const found = files.flatMap(britishIn);
  assert.deepEqual(found, [], `British English in the product:\n${found.join("\n")}`);
});

test("the guard catches what it was written for", () => {
  for (const phrase of ["sends it straight away", "Pick a colour", "Tick the box", "This fortnight", "the organiser", "Payment or cheque reference"]) {
    BRITISH.lastIndex = 0;
    assert.ok(BRITISH.test(phrase), phrase);
  }
  for (const phrase of ["sends it right away", "Pick a color", "Check the box", "your hours", "Our tour", "promise", "otherwise"]) {
    BRITISH.lastIndex = 0;
    assert.equal(BRITISH.test(phrase), false, phrase);
  }
});

test("every model prompt that writes prose asks for American English", () => {
  for (const file of [
    "functions/src/ai/communications.ts",
    "functions/src/ai/copilot.ts",
    "functions/src/ai/message-draft.ts",
    "functions/src/ai/schedule.ts",
    "functions/src/operations/ai-pdf.ts",
  ]) {
    assert.match(readFileSync(file, "utf8"), /US_ENGLISH_PART/, file);
  }
});
