import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * A submit handler may not touch `event.currentTarget` after an await.
 *
 * React nulls it once the handler returns, so the access throws — and in
 * every instance of this the codebase had, the success notice was set
 * first, so the catch overwrote it and told the user their request had
 * failed when it had actually succeeded. On the crew form that reads as
 * "Cannot read properties of null (reading 'reset')" under a button that
 * did in fact create the record, which invites a duplicate retry.
 *
 * Capturing the element before the await is the whole fix. This makes the
 * mistake impossible to reintroduce quietly, which matters because two of
 * the four instances lived in single-line minified components where the
 * pattern was invisible on review.
 */
function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      found.push(...sourceFiles(full));
    } else if (entry.endsWith(".tsx")) {
      found.push(full);
    }
  }
  return found;
}

/**
 * The body of the function starting at `open`, by brace matching.
 *
 * A fixed character window is not good enough: it runs past the closing
 * brace into the next function, so a safe pre-await capture in one handler
 * pairs with an await in its neighbour and reports a bug that is not there.
 * A detector with false positives gets switched off.
 */
function functionBody(source: string, open: number): string {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  return source.slice(open);
}

test("no handler reads event.currentTarget after awaiting", () => {
  const offences: string[] = [];
  for (const path of ["app", "components"].flatMap(sourceFiles)) {
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(
      /async\s+(?:function\s+\w+\s*)?\([^)]*\)\s*(?::[^{]+)?\{/g,
    )) {
      const open = source.indexOf("{", (match.index ?? 0) + match[0].length - 1);
      if (open < 0) continue;
      const body = functionBody(source, open);
      const awaitAt = body.indexOf("await ");
      if (awaitAt < 0) continue;
      // `.form` on a click target is a different, safe pattern: that read
      // happens synchronously before anything is awaited.
      const hit = /event\.currentTarget(?!\.form)/.exec(body.slice(awaitAt));
      if (!hit) continue;
      const line = source.slice(0, open + awaitAt + hit.index).split("\n").length;
      offences.push(`${path}:${line}`);
    }
  }
  assert.deepEqual(
    offences,
    [],
    offences.length
      ? `Capture the element before the await:\n  ${offences.join("\n  ")}`
      : "",
  );
});
