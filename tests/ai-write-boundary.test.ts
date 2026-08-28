import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

/**
 * AI is advisory. This is the test that makes that true.
 *
 * The claim appears three times in CLAUDE.md — "AI is advisory only", "AI
 * output **may never write** legal, payment, signature, permission, or
 * readiness-completion fields", "it produces drafts and flags discrepancies for
 * human decision" — and until now nothing anywhere asserted it. Eight files
 * under functions/src/ai plus the ai-pdf worker write to Firestore on every
 * run, and the only thing keeping them inside the boundary was that whoever
 * wrote each one remembered.
 *
 * The audit of 2026-08-28 walked all thirteen write sites and found the
 * boundary intact: every AI write lands either in a collection the AI owns, or
 * in an `ai`-prefixed field on a business record, or in the one deliberate
 * exception the architecture documents — a certificate of insurance moved to
 * `under_review` with `humanDecision: "pending"`, which is a request for a
 * decision rather than a decision. Approving an AI draft records that a
 * downstream command ran; the business change itself goes through that
 * command's own endpoint, with its own authorization and preconditions.
 *
 * So this test protects a property that currently holds. Its job is the next
 * capability someone adds.
 */

const AI_SOURCES = [
  ...readdirSync(`${process.cwd()}/functions/src/ai`)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => `functions/src/ai/${name}`),
  "functions/src/operations/ai-pdf.ts",
];

/**
 * Collections that exist to hold AI output. Anything may be written here: the
 * whole point of an `aiActions` document is to carry a proposal — prices,
 * dates, wording — that no human has agreed to yet.
 */
const AI_OWNED_COLLECTIONS = new Set([
  "aiActions",
  "aiInteractions",
  "actionReceipts",
  "auditEvents",
  "commandExecutions",
  "communicationDrafts",
  "automationApprovals",
  "productEvents",
  "emailJobs",
  "documents",
  "deliveryDrafts",
]);

/**
 * Fields an AI worker may set on a business record.
 *
 * Anything beginning with `ai` is namespaced by construction — `aiReview`,
 * `aiSummary`, `aiExtraction`, `aiReviewedAt` — and a reader has to opt in to
 * consulting it. The rest are enumerated one at a time, with the reason.
 */
const NAMESPACED = /^ai[A-Z]/;
const ALLOWED_ON_BUSINESS_RECORDS = new Set([
  // Bookkeeping, on every write in the codebase.
  "updatedAt",
  "updatedBy",
  // The state of a *rendering job*, not of the agreement being rendered.
  "pdfState",
  // Pointers to a rendered artifact. The PDF worker stamps the document it
  // produced onto the record it rendered; the agreement itself is untouched.
  "pdfDocumentId",
  "summaryDocumentId",
  // The COI extraction case the architecture documents. `extractedData` and
  // `discrepancies` are findings; `humanDecision: "pending"` is the gate that
  // makes them findings rather than conclusions; `status: "under_review"` is
  // not in the set the readiness engine accepts as a settled certificate.
  "extractedData",
  "discrepancies",
  "humanDecision",
  "status",
]);

/**
 * Fields that decide something. None of these may be written by an AI path on
 * a business record, under any circumstances, namespaced or not.
 */
const PROTECTED = [
  // Readiness and lifecycle completion
  "state",
  "stateVersion",
  "completedAt",
  "settledAt",
  "waivedAt",
  "readinessScore",
  // Signature
  "signedAt",
  "signedDocumentId",
  "signingUrl",
  "signers",
  "signatureStatus",
  // Payment
  "paidAt",
  "balanceCents",
  "amountCents",
  "totalCents",
  "retainerCents",
  "paymentSchedule",
  // Permission
  "role",
  "permissions",
  "projectIds",
  "platformAdmin",
  // Human approval
  "approvedBy",
  "approvedAt",
  "acceptedAt",
  "acceptanceAuthority",
];

/** The balanced `{...}` starting at `open`. */
function objectLiteral(source: string, open: number): string {
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

/**
 * The *top-level* keys of an object literal.
 *
 * Nesting is the whole distinction being tested: `aiReview: { status: "ready" }`
 * is namespaced advisory output, and `status: "completed"` is a decision. A
 * scanner that flattened them would report the first as a violation, which is
 * exactly the mistake the audit made on its first pass.
 */
function topLevelKeys(literal: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  let index = 0;
  let inString: string | null = null;
  while (index < literal.length) {
    const character = literal[index]!;
    if (inString) {
      if (character === "\\") index += 1;
      else if (character === inString) inString = null;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      inString = character;
      index += 1;
      continue;
    }
    if (character === "{" || character === "[" || character === "(") depth += 1;
    else if (character === "}" || character === "]" || character === ")") depth -= 1;
    else if (depth === 1) {
      const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(literal.slice(index));
      if (match && /[{,\s]/.test(literal[index - 1] ?? "{")) {
        keys.push(match[1]!);
        index += match[0].length;
        continue;
      }
    }
    index += 1;
  }
  return keys;
}

type Write = { file: string; op: string; collection: string; keys: string[] };

const isUnresolved = (write: Write) => write.collection.startsWith("unresolved:");

function writesIn(file: string): Write[] {
  const source = readFileSync(`${process.cwd()}/${file}`, "utf8");
  const collectionOf = new Map<string, string>();
  const remember = (pattern: RegExp, variable: number, collection: number) => {
    for (const match of source.matchAll(pattern)) {
      collectionOf.set(match[variable]!, match[collection]!);
    }
  };
  remember(
    /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:db|firestore|getFirestore\(\))\.(?:doc|collection)\(\s*[`"']([A-Za-z]+)/g,
    1,
    2,
  );
  for (const match of source.matchAll(
    /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(\w+)\.(?:doc|collection|ref)\b/g,
  )) {
    const parent = collectionOf.get(match[2]!);
    if (parent) collectionOf.set(match[1]!, parent);
  }

  const writes: Write[] = [];
  const push = (op: string, target: string, literalStart: number) => {
    const literal = objectLiteral(source, literalStart);
    const base = /^(\w+)/.exec(target)?.[1];
    const inline = /\.doc\(\s*[`"']([A-Za-z]+)\//.exec(target)?.[1];
    const collection = inline ?? (base ? collectionOf.get(base) : undefined);
    writes.push({
      file,
      op,
      collection: collection ?? `unresolved:${target.slice(0, 40)}`,
      keys: topLevelKeys(literal),
    });
  };

  for (const match of source.matchAll(
    /(?:batch|transaction)\.(set|update|create)\(\s*([^,]+?),\s*\{/g,
  )) {
    push(match[1]!, match[2]!.trim(), source.indexOf("{", match.index! + match[0].length - 1));
  }
  for (const match of source.matchAll(
    /(\.doc\(\s*[`"'][A-Za-z]+\/[^)]*\)|\w+(?:\.ref)?)\.(set|update|create)\(\s*\{/g,
  )) {
    if (/^(createHash|hash)\b/.test(match[1]!)) continue;
    push(match[2]!, match[1]!.trim(), source.indexOf("{", match.index! + match[0].length - 1));
  }
  return writes;
}

const ALL_WRITES = AI_SOURCES.flatMap(writesIn);

test("the AI paths are still where we think they are", () => {
  // If this drops to nothing the rest of the file silently passes.
  assert.ok(AI_SOURCES.length >= 8, `only found ${AI_SOURCES.length} AI sources`);
  assert.ok(ALL_WRITES.length >= 10, `only found ${ALL_WRITES.length} AI writes`);
});

test("a write this scanner cannot place is judged strictly, not skipped", () => {
  /**
   * `ai-pdf.ts` writes through `input.entity.ref`, a reference handed in by the
   * caller — a proposal, a schedule, or a closeout depending on the job. There
   * is no way to resolve that statically, and a blind spot that silently passes
   * is worse than one that fails. Unresolved targets are treated as business
   * records, which is the strict reading; the two tests below cover them.
   */
  const unresolved = ALL_WRITES.filter((write) => isUnresolved(write));
  for (const write of unresolved) {
    assert.ok(
      !AI_OWNED_COLLECTIONS.has(write.collection),
      "an unresolved target must never be treated as AI-owned",
    );
  }
  // And the parser has not quietly stopped recognising the known ones.
  const resolved = ALL_WRITES.filter((write) => !isUnresolved(write));
  assert.ok(
    resolved.length >= 10,
    `only ${resolved.length} of ${ALL_WRITES.length} AI writes could be placed; ` +
      "the scanner has probably drifted from the source",
  );
});

test("a computed field name is still inside the boundary", () => {
  // `batch.update(input.entity.ref, { [field]: documentId, ... })` — a dynamic
  // key the key parser cannot see. The values it can take are pinned here.
  const source = readFileSync(
    `${process.cwd()}/functions/src/operations/ai-pdf.ts`,
    "utf8",
  );
  const computed = [...source.matchAll(/\[\s*field\s*\]\s*:/g)];
  assert.ok(computed.length > 0, "the computed pdf field write is gone");
  const assignment = source.slice(
    source.indexOf("const field="),
    source.indexOf("const field=") + 200,
  );
  // Only the ternary's *results* — a quoted string straight after ? or : —
  // not the strings it reads along the way, like job.get("type").
  for (const candidate of [...assignment.matchAll(/[?:]\s*"([a-zA-Z]+)"/g)]) {
    assert.ok(
      ALLOWED_ON_BUSINESS_RECORDS.has(candidate[1]!),
      `the pdf worker can write "${candidate[1]}" on a business record`,
    );
  }
});

test("an AI path never writes a deciding field on a business record", () => {
  for (const write of ALL_WRITES) {
    if (AI_OWNED_COLLECTIONS.has(write.collection)) continue;
    for (const key of write.keys) {
      assert.ok(
        !PROTECTED.includes(key),
        `${write.file} writes the protected field "${key}" on ${write.collection}. ` +
          `AI output may never decide legal, payment, signature, permission or ` +
          `readiness-completion state — draft it into aiActions instead and let a ` +
          `human approve it through that domain's own command.`,
      );
    }
  }
});

test("an AI path writes only namespaced fields on a business record", () => {
  for (const write of ALL_WRITES) {
    if (AI_OWNED_COLLECTIONS.has(write.collection)) continue;
    for (const key of write.keys) {
      assert.ok(
        NAMESPACED.test(key) || ALLOWED_ON_BUSINESS_RECORDS.has(key),
        `${write.file} writes "${key}" on ${write.collection}. A field an AI ` +
          `worker sets on a business record has to be namespaced (aiSummary, ` +
          `aiReview, aiExtractedAt) so every reader opts in to consulting it — ` +
          `or be added to ALLOWED_ON_BUSINESS_RECORDS with the reason.`,
      );
    }
  }
});

test("the insurance exception stays a request for a decision", () => {
  /**
   * The one place an AI worker sets `status` on a business record. It is
   * allowed because `under_review` is not a settled certificate and because
   * `humanDecision: "pending"` accompanies it. Both halves are load-bearing.
   */
  const source = readFileSync(
    `${process.cwd()}/functions/src/operations/ai-pdf.ts`,
    "utf8",
  );
  const write = /insurance\.ref\.update\(\{([^}]*)\}\)/.exec(source)?.[1] ?? "";
  assert.match(write, /status:\s*"under_review"/);
  assert.match(write, /humanDecision:\s*"pending"/);
  assert.doesNotMatch(write, /status:\s*"(approved|sent_to_venue|venue_acknowledged|waived)"/);

  // And the readiness engine must not accept `under_review` as settled.
  const journey = readFileSync(
    `${process.cwd()}/features/journey/steps.ts`,
    "utf8",
  );
  const coi = journey.slice(journey.indexOf("const coiDone"), journey.indexOf("const coiWaiting"));
  assert.doesNotMatch(coi, /under_review/);
});

test("approving an AI draft does not apply the business change itself", () => {
  /**
   * The execute path records that a downstream command ran and writes a
   * receipt. If it ever started writing the business record directly, the
   * human approval would become the AI's write by another name — and every
   * check above would still pass, because it would happen in a different file.
   */
  const source = readFileSync(`${process.cwd()}/functions/src/ai/actions.ts`, "utf8");
  const writes = writesIn("functions/src/ai/actions.ts");
  for (const write of writes) {
    assert.ok(
      AI_OWNED_COLLECTIONS.has(write.collection),
      `functions/src/ai/actions.ts writes to ${write.collection}. The approval ` +
        `endpoint may only touch AI-owned records; the business change belongs ` +
        `to that domain's own command.`,
    );
  }
  assert.match(source, /downstreamCommand/);
});

test("a human's uid is what lands on an approval, not the worker's", () => {
  const source = readFileSync(`${process.cwd()}/functions/src/ai/actions.ts`, "utf8");
  const approvals = [...source.matchAll(/approvedBy:\s*([^,\n]+)/g)].map(
    (match) => match[1]!.trim(),
  );
  assert.ok(approvals.length > 0, "no approvedBy write found to check");
  for (const value of approvals) {
    assert.match(
      value,
      /identity\.uid/,
      `approvedBy is set to ${value}; it has to be the reviewing human`,
    );
    assert.doesNotMatch(value, /vertex-ai-worker|"ai"/);
  }
});
