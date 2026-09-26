import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

/**
 * The compiler eats the space between text and a {value}.
 *
 * SWC trims the first and last lines of a multi-line JSX text chunk, so
 * `{count} booking` that wraps to the next line ships as "3 bookingsarein
 * StudioCue". It only happens in the build, never in the source, which is why
 * it survived: the code reads correctly and the page does not. Live examples
 * found in one afternoon: "3 bookings arein StudioCue" and "Send the forma
 * previous attempt failed".
 *
 * The fix is an explicit {" "}. This test is the scanner that found them.
 */
const files = globSync(["components/**/*.tsx", "app/**/*.tsx", "features/**/*.tsx"]);

test("no JSX text loses its space against an adjacent expression", () => {
  const offenders: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
        node.children.forEach((child, index) => {
          if (!ts.isJsxText(child)) return;
          const raw = child.getFullText();
          if (!raw.trim()) return;
          // An explicit {" "} is the fix, not an offence.
          const spacer = (sibling: ts.JsxChild | undefined) =>
            sibling !== undefined &&
            ts.isJsxExpression(sibling) &&
            sibling.expression !== undefined &&
            ts.isStringLiteral(sibling.expression) &&
            sibling.expression.text === " ";
          const before = spacer(node.children[index - 1]) ? undefined : node.children[index - 1];
          const after = spacer(node.children[index + 1]) ? undefined : node.children[index + 1];
          // An element (a link, <strong>) loses the space exactly as an
          // expression does: "Connect Google Calendarand times" shipped on the
          // Calendar page, 2026-09-26, and this scanner only looked at {value}.
          // Only words that sit inline with the text — a link, bold, code.
          // An icon beside a label or an input after one needs no space.
          const INLINE = new Set(["a", "Link", "strong", "em", "b", "i", "code"]);
          const inline = (sibling: ts.JsxChild) =>
            ts.isJsxExpression(sibling) ||
            (ts.isJsxElement(sibling) && INLINE.has(sibling.openingElement.tagName.getText()));
          const line = parsed.getLineAndCharacterOfPosition(child.getStart()).line + 1;
          const where = `${file}:${line} — ${raw.trim().replace(/\s+/g, " ").slice(0, 48)}`;
          // A leading space after an expression, in a chunk that wraps.
          if (before && inline(before) && /^[ \t]+[A-Za-z]/.test(raw) && raw.includes("\n"))
            offenders.push(where);
          // A trailing space before an expression, swallowed with the newline.
          if (after && inline(after) && /[A-Za-z0-9,.:;)]\s*\n\s*$/.test(raw))
            offenders.push(where);
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(parsed);
  }
  assert.deepEqual(
    offenders,
    [],
    `These will ship without a space — add {" "}:\n${offenders.join("\n")}`,
  );
});
