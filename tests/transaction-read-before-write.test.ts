import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

/**
 * Firestore requires every read in a transaction before every write.
 *
 * Both signing webhooks broke this rule in identical code: they created the
 * `webhookEvents` record and *then* read the project. The transaction threw
 * "Firestore transactions require all reads to be executed before all writes"
 * and the handler answered 500 — not on an edge case, but on the only case that
 * matters, a completed envelope that matches a contract. Docusign retries a
 * non-2xx, gets another 500 and gives up, so a signed agreement never reached
 * `completed`, the project never left CONTRACT_PENDING, and the booking gate
 * could never open.
 *
 * It survived every audit because the failure sits behind two earlier ones:
 * with no connected account the handler answers 404, and with no matching
 * contract it never enters the branch. scripts/certify-providers.ts found it by
 * seeding both, which is what "certification with real payloads" is for.
 *
 * This test is deliberately conservative. It reports a read that follows a
 * write **at the same brace depth**, where both are unconditionally on the same
 * path. Branchy transactions — crmCommand dispatches eight command types from
 * one transaction, each self-contained — are not flagged, because there the
 * write and the read belong to different branches and never run together.
 */

const functionSources = (): string[] => {
  const out: string[] = [];
  const walk = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const next = `${path}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else if (entry.name.endsWith(".ts")) out.push(next);
    }
  };
  walk(`${process.cwd()}/functions/src`);
  return out;
};

/** The balanced `{...}` beginning at `open`. */
function block(source: string, open: number): string {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  return source.slice(open);
}

/** Offsets of `pattern` that sit at exactly `wanted` braces deep in `body`. */
function atDepth(body: string, pattern: RegExp, wanted: number): number[] {
  const found: number[] = [];
  for (const match of body.matchAll(pattern)) {
    let depth = 0;
    for (let index = 0; index < match.index!; index += 1) {
      if (body[index] === "{") depth += 1;
      else if (body[index] === "}") depth -= 1;
    }
    if (depth === wanted) found.push(match.index!);
  }
  return found;
}

type Offender = { file: string; line: number };

function offenders(): Offender[] {
  const found: Offender[] = [];
  for (const file of functionSources()) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(
      /runTransaction\(async \(([A-Za-z]+)\)\s*=>\s*\{/g,
    )) {
      const handle = match[1]!;
      const body = block(source, source.indexOf("{", match.index! + match[0].length - 1));
      // Depth 1 is the transaction callback's own body: statements that always
      // run, in order, whenever the transaction runs.
      const writes = atDepth(
        body,
        new RegExp(`${handle}\\.(create|set|update|delete)\\(`, "g"),
        1,
      );
      const reads = atDepth(body, new RegExp(`${handle}\\.get(All)?\\(`, "g"), 1);
      if (!writes.length || !reads.length) continue;
      const firstWrite = Math.min(...writes);
      if (reads.some((read) => read > firstWrite)) {
        found.push({
          file: file.replace(`${process.cwd()}/`, ""),
          line: source.slice(0, match.index!).split("\n").length,
        });
      }
    }
  }
  return found;
}

test("no transaction reads after it has written", () => {
  assert.deepEqual(
    offenders().map((offender) => `${offender.file}:${offender.line}`),
    [],
    "a Firestore transaction reads after writing, which throws at runtime and " +
      "returns 500 — hoist every transaction.get above the first write",
  );
});

test("the detector still recognises the shape it was written for", () => {
  // Guards the guard: a rewrite of the scanner that silently matches nothing
  // would make the test above pass forever.
  const sample = `
    await firestore.runTransaction(async (transaction) => {
      transaction.create(a, {});
      const b = await transaction.get(c);
      return b;
    });
  `;
  const body = block(sample, sample.indexOf("{", sample.indexOf("=>")));
  const writes = atDepth(body, /transaction\.(create|set|update|delete)\(/g, 1);
  const reads = atDepth(body, /transaction\.get(All)?\(/g, 1);
  assert.ok(writes.length === 1 && reads.length === 1);
  assert.ok(reads[0]! > writes[0]!, "the detector no longer sees a late read");
});
