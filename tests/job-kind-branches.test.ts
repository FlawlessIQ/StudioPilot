import assert from "node:assert/strict";
import { globSync, readFileSync, writeFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

/**
 * "Is it a wedding?" stays in the kinds table (docs/mitzvah-journey-plan-2026-10-14.md, Phase 0).
 *
 * A check like `kind === "wedding"` almost never means "a wedding". It means
 * "this job follows the studio's planning timeline", "gets the shot list",
 * or "uses the wedding's day plan", and a new kind that needs the same thing
 * silently falls onto the light path at every one of them. Those switches
 * live in features/job-kinds (journeyProfile(), vocab()), so adding a kind is
 * a row in a table, not a hunt.
 *
 * This counts comparisons with the string "wedding" (`===`, `!==`, `==`,
 * `!=`) outside features/job-kinds. What is left is a key, not a kind: the
 * studio's legacy wedding type id and its templates, and the wedding's own
 * day plan. Every file's count is pinned in tests/job-kind-branch-allowlist.json,
 * and the pin can only come down: a new check fails here and asks for a
 * profile switch instead.
 *
 * Removed one? Lower its pin by running
 *   JOB_KIND_BRANCH_WRITE=1 npx tsx --test tests/job-kind-branches.test.ts
 * which refuses to raise any.
 */
const ALLOWLIST = "tests/job-kind-branch-allowlist.json";
const files = globSync([
  "features/**/*.ts",
  "features/**/*.tsx",
  "lib/**/*.ts",
  "lib/**/*.tsx",
  "server/**/*.ts",
  "functions/src/**/*.ts",
  "components/**/*.ts",
  "components/**/*.tsx",
  "app/**/*.ts",
  "app/**/*.tsx",
])
  .filter((file) => !file.startsWith("features/job-kinds/") && !file.startsWith("functions/src/job-kinds/job-kinds.ts"))
  .sort();

const COMPARISONS = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
]);

const isWedding = (node: ts.Node) =>
  (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text === "wedding";

function weddingChecks(file: string): number {
  const source = readFileSync(file, "utf8");
  if (!source.includes('"wedding"')) return 0;
  const parsed = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  let count = 0;
  const visit = (node: ts.Node) => {
    if (
      ts.isBinaryExpression(node) &&
      COMPARISONS.has(node.operatorToken.kind) &&
      (isWedding(node.left) || isWedding(node.right))
    )
      count += 1;
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return count;
}

test("wedding checks only come down", () => {
  const pinned = JSON.parse(readFileSync(ALLOWLIST, "utf8")) as Record<string, number>;
  const counts = new Map(files.map((file) => [file, weddingChecks(file)] as const));
  const over = [...counts]
    .filter(([file, count]) => count > (pinned[file] ?? 0))
    .map(([file, count]) => `${file}: ${count} (pinned ${pinned[file] ?? 0})`);
  if (process.env.JOB_KIND_BRANCH_WRITE === "1") {
    assert.deepEqual(over, [], "the pins only come down: these files gained wedding checks");
    const next = Object.fromEntries([...counts].filter(([, count]) => count > 0));
    writeFileSync(ALLOWLIST, `${JSON.stringify(next, null, 2)}\n`);
    return;
  }
  assert.deepEqual(
    over,
    [],
    'A new `=== "wedding"` check. Say what it means as a switch in features/job-kinds ' +
      "(journeyProfile() for steps, vocab() for words), so the next kind that needs it gets it.",
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
