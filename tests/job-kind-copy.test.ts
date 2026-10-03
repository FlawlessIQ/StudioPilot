import assert from "node:assert/strict";
import { globSync, readFileSync, writeFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

/**
 * Wedding words stay where they belong (docs/job-types-plan-2026-10-02.md).
 *
 * A family reading "your wedding" is the embarrassing failure of serving more
 * than one kind of work. Words that change with the kind come from
 * features/job-kinds (vocab(), clientRef()); what is left in the source is
 * wedding-only on purpose (the wedding forms, wedding moments) or not swept
 * yet.
 *
 * This counts wedding words — wedding, couple, bride, groom, ceremony — in
 * what a person can read: string literals, template text and JSX text, not
 * identifiers, comments or class names. Every file's count is pinned in
 * tests/job-kind-copy-allowlist.json, and the pin can only come down: a new
 * "the couple" in a screen fails here and asks for vocab() instead.
 *
 * Swept a file? Lower its number (or delete the line) by running
 *   JOB_KIND_COPY_WRITE=1 npx tsx --test tests/job-kind-copy.test.ts
 * which refuses to raise any pin.
 */
const ALLOWLIST = "tests/job-kind-copy-allowlist.json";
const WORDS = /\b(weddings?|couples?|brides?|grooms?|ceremony|ceremonies)\b/gi;
const files = globSync([
  "components/**/*.tsx",
  "components/**/*.ts",
  "app/**/*.tsx",
  "app/**/*.ts",
  "functions/src/communications/**/*.ts",
]).sort();

function visibleWordCount(file: string): number {
  const source = readFileSync(file, "utf8");
  const parsed = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  let count = 0;
  const countIn = (text: string) => {
    count += text.match(WORDS)?.length ?? 0;
  };
  const visit = (node: ts.Node) => {
    // Not read by anyone: module paths, class names, keys and ids.
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    // `videoId` and `screen` name a how-to video and a marketing still
    // (features/marketing/screens.json): ids, like `id`, never shown.
    if (
      ts.isJsxAttribute(node) &&
      ["className", "id", "key", "htmlFor", "name", "data-testid", "videoId", "screen"].includes(node.name.getText())
    )
      return;
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && ["id", "key", "kind", "type"].includes(node.name.text))
      return;
    // A comparison (`kind === "wedding"`) is a check, not copy.
    const comparison =
      ts.isBinaryExpression(node) &&
      [
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsEqualsToken,
        ts.SyntaxKind.EqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsToken,
      ].includes(node.operatorToken.kind);
    if (comparison || ts.isElementAccessExpression(node) || ts.isCaseClause(node)) {
      ts.forEachChild(node, (child) => {
        if (!ts.isStringLiteral(child)) visit(child);
      });
      return;
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) countIn(node.text);
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) countIn(node.text);
    else if (ts.isJsxText(node)) countIn(node.getText());
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return count;
}

test("wedding words only come down", () => {
  const pinned = JSON.parse(readFileSync(ALLOWLIST, "utf8")) as Record<string, number>;
  const counts = new Map(files.map((file) => [file, visibleWordCount(file)] as const));
  const over = [...counts]
    .filter(([file, count]) => count > (pinned[file] ?? 0))
    .map(([file, count]) => `${file}: ${count} (pinned ${pinned[file] ?? 0})`);
  if (process.env.JOB_KIND_COPY_WRITE === "1") {
    assert.deepEqual(over, [], "the pins only come down: these files gained wedding words");
    const next = Object.fromEntries([...counts].filter(([, count]) => count > 0));
    writeFileSync(ALLOWLIST, `${JSON.stringify(next, null, 2)}\n`);
    return;
  }
  assert.deepEqual(
    over,
    [],
    "Wedding words in copy a non-wedding client or studio may read. Use vocab()/clientRef() from " +
      "features/job-kinds, or neutral words (the client, the event). Wedding-only copy belongs behind " +
      "a wedding check.",
  );
});

test("the pins name real files", () => {
  const pinned = JSON.parse(readFileSync(ALLOWLIST, "utf8")) as Record<string, number>;
  const known = new Set(files);
  assert.deepEqual(
    Object.keys(pinned).filter((file) => !known.has(file)),
    [],
    "a pinned file was moved or deleted — drop its line",
  );
});
