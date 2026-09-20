import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  orderPurgeLines,
  purgeConfirmationMatches,
  purgeLineLabel,
  purgeMaySweep,
  purgeTotal,
  PURGE_DEFERRED_COLLECTIONS,
  PURGE_KEEPS,
  PURGE_PROTECTED_COLLECTIONS,
  PURGE_REFUSALS,
} from "@/features/projects/purge-policy";
import { errorCodeHasCopy } from "@/lib/ai/friendly-error";

/**
 * Permanently erasing a job.
 *
 * The only destructive operation in the product, so the tests are mostly about
 * what it must *not* destroy, and about the gates being real rather than
 * decorative.
 */

// --- what the sweep may never touch --------------------------------------

/**
 * The sweep is driven by `projectId`, which is the right handle for this one
 * wedding and the wrong handle for anything shared. These are the collections
 * that must survive even if one of them starts carrying the field.
 */
test("the idempotency ledgers are out of reach", () => {
  // Delete a commandExecutions row and its command runs twice on the next
  // retry; delete a webhookEvents row and a replayed provider event is
  // processed as new.
  for (const protectedName of ["commandExecutions", "webhookEvents"])
    assert.equal(purgeMaySweep(protectedName), false, protectedName);
});

test("the account itself is out of reach", () => {
  for (const name of [
    "memberships",
    "users",
    "tenants",
    "subscriptions",
    "usageCounters",
  ])
    assert.equal(purgeMaySweep(name), false, name);
});

test("the record of the purge outlives the purge", () => {
  assert.equal(purgeMaySweep("projectPurges"), false);
});

/**
 * The job record is the handle on the owner's authority, the client contacts
 * and the name that has to be typed. Deleting it inside the sweep would leave
 * a failed purge with no way to finish — the retry would answer
 * PROJECT_NOT_FOUND on a half-erased wedding.
 */
test("the job record is deferred, not protected", () => {
  assert.equal(purgeMaySweep("projects"), false);
  assert.ok(PURGE_DEFERRED_COLLECTIONS.includes("projects"));
  assert.ok(!PURGE_PROTECTED_COLLECTIONS.includes("projects"));
});

test("everything that belongs to the job is swept", () => {
  for (const name of [
    "messages",
    "contracts",
    "invoiceReferences",
    "proposals",
    "schedules",
    "crewAssignments",
    "documents",
    "questionnaireResponses",
    "checkpoints",
    "auditEvents",
  ])
    assert.equal(purgeMaySweep(name), true, name);
});

/** The directory is shared with every other job and is never project-scoped. */
test("the crew and vendor directories are named as kept", () => {
  const kept = PURGE_KEEPS.join(" ").toLocaleLowerCase();
  for (const word of ["crew", "vendor", "package", "other job"])
    assert.ok(kept.includes(word), `the preview never mentions ${word}`);
});

// --- the confirmation gate -----------------------------------------------

test("the job's own name unlocks it", () => {
  assert.equal(purgeConfirmationMatches("Erin and Joe DeMattia", "Erin and Joe DeMattia"), true);
});

test("case and spacing are forgiven", () => {
  for (const typed of [
    "erin and joe demattia",
    "  Erin and Joe DeMattia  ",
    "Erin  and  Joe  DeMattia",
  ])
    assert.equal(purgeConfirmationMatches(typed, "Erin and Joe DeMattia"), true, typed);
});

test("another job's name does not unlock it", () => {
  // The whole point of the gate: the owner had to read which job this is.
  for (const typed of ["Erin and Joe", "DeMattia", "Erin and Jo DeMattia", ""])
    assert.equal(purgeConfirmationMatches(typed, "Erin and Joe DeMattia"), false, typed);
});

/** A project with no name must not become a job anything deletes. */
test("an empty name never matches", () => {
  assert.equal(purgeConfirmationMatches("", ""), false);
  assert.equal(purgeConfirmationMatches("   ", "  "), false);
});

// --- the preview ---------------------------------------------------------

test("the loudest losses are listed first", () => {
  const ordered = orderPurgeLines([
    { collection: "domainEvents", label: "system events", count: 2 },
    { collection: "messages", label: "messages", count: 142 },
    { collection: "invoiceReferences", label: "invoices", count: 3 },
  ]);
  assert.deepEqual(ordered.map((line) => line.count), [142, 3, 2]);
});

test("nothing empty is listed, and the total is what is listed", () => {
  const lines = [
    { collection: "messages", label: "messages", count: 4 },
    { collection: "tasks", label: "tasks", count: 0 },
  ];
  assert.deepEqual(orderPurgeLines(lines).map((line) => line.collection), ["messages"]);
  assert.equal(purgeTotal(orderPurgeLines(lines)), 4);
});

test("a studio reads records, not collection names", () => {
  assert.equal(purgeLineLabel("questionnaireResponses", 3), "questionnaire answers");
  assert.equal(purgeLineLabel("invoiceReferences", 1), "invoice");
  assert.equal(purgeLineLabel("schedules", 2), "run of show versions");
  // Unlabelled is worse than a label and far better than being left out.
  assert.equal(purgeLineLabel("somethingNew", 2), "somethingNew");
});

// --- the refusals --------------------------------------------------------

test("every refusal says what to do instead", () => {
  for (const [code, copy] of Object.entries(PURGE_REFUSALS)) {
    assert.ok(copy.length > 30, code);
    assert.doesNotMatch(copy, /try again/i, `${code} must not say "try again"`);
  }
});

/** tests/error-copy-coverage.test.ts holds this rule product-wide. */
test("the browser can render every code the purge throws", () => {
  const source = readFileSync(
    `${process.cwd()}/functions/src/projects/purge-command.ts`,
    "utf8",
  );
  const thrown = [
    ...source.matchAll(/new Error\("([A-Z_]+)"\)/g),
  ].map((match) => match[1] as string);
  assert.ok(thrown.length >= 4, "the guard found no codes to check");
  for (const code of new Set(thrown))
    assert.equal(errorCodeHasCopy(code), true, `${code} has no copy`);
});

// --- the server, not the browser, decides --------------------------------

const command = readFileSync(
  `${process.cwd()}/functions/src/projects/purge-command.ts`,
  "utf8",
);

test("only the owner, and only with nobody waiting on the job", () => {
  assert.match(command, /role"\) !== "studio_owner"/);
  assert.match(command, /PROJECT_PURGE_OWNER_ONLY/);
  assert.match(command, /isLiveAssignment/);
  assert.match(command, /PROJECT_HAS_LIVE_CREW/);
});

/**
 * The sweep matches on `projectId` alone, because that is the only field every
 * collection shares. A colliding id in another studio's data would then be
 * destroyed by this studio's confirmation, so every candidate is checked
 * against the tenant before it is deleted.
 */
test("no document is deleted without its tenant being checked", () => {
  assert.match(
    command,
    /\.filter\(\(item\) => item\.get\("tenantId"\) === tenantId\)/,
  );
});

test("the name is checked on the server, not taken from the browser", () => {
  const gate = command.indexOf("purgeConfirmationMatches(parsed.input.confirmation");
  assert.ok(gate > 0, "the server must re-check the typed name");
  assert.ok(
    gate < command.indexOf("projectPurges/"),
    "nothing may be written before the name is checked",
  );
});

test("the collections are discovered, not listed in this file", () => {
  // A hand-kept list is wrong the first time somebody adds a collection and
  // forgets it — and being wrong here means records a studio believes are
  // gone are still readable.
  assert.match(command, /db\.listCollections\(\)/);
});

test("a trail survives the records it describes", () => {
  assert.match(command, /action: "project\.purged"/);
  // Written with no projectId, or a later purge of the same id would sweep it.
  assert.match(command, /projectId: null/);
  assert.match(command, /projectPurges\/\$\{purgeId\}/);
});

test("storage goes with the records", () => {
  assert.match(command, /deleteFiles\(\{ prefix, force: true \}\)/);
  assert.match(command, /tenants\/\$\{parsed\.tenantId\}\/projects\//);
});

// --- the browser's three gates -------------------------------------------

const ui = readFileSync(
  `${process.cwd()}/components/projects/delete-job-permanently.tsx`,
  "utf8",
);

test("opening it counts what would go before anything is offered", () => {
  assert.match(ui, /previewProjectPurge\(/);
  // The delete control only exists once the preview has come back.
  assert.ok(
    ui.indexOf("preview ? (") < ui.indexOf("Delete this job and everything in it"),
  );
});

test("the name gates the first press and the second press gates the moment", () => {
  assert.match(ui, /disabled=\{!nameMatches\}/);
  assert.match(ui, /onClick=\{\(\) => setArmed\(true\)\}/);
  assert.match(ui, /armed \?/);
  assert.match(ui, /Keep this job/);
  assert.match(ui, /cannot be undone/);
});

test("it is owner-only and sits below archiving", () => {
  const page = readFileSync(
    `${process.cwd()}/components/projects/live-project-detail.tsx`,
    "utf8",
  );
  assert.match(page, /workspace\.role === "studio_owner" \? \(\s*<DeleteJobPermanently/);
  assert.ok(
    page.indexOf("<ProjectArchiveControl") < page.indexOf("<DeleteJobPermanently"),
    "the reversible option must come first",
  );
});

// --- the mirror ----------------------------------------------------------

test("the functions copy of the policy matches features/", () => {
  const body = (path: string) => {
    const source = readFileSync(`${process.cwd()}/${path}`, "utf8");
    return source.slice(source.indexOf("export const PURGE_PROTECTED_COLLECTIONS"));
  };
  assert.equal(
    body("functions/src/projects/purge-policy.ts"),
    body("features/projects/purge-policy.ts"),
  );
});

// --- reachability --------------------------------------------------------

/**
 * A new Function needs two allowlist entries or it 403s in production with an
 * HTML body the browser reports as "Unexpected token '<'". Both were missed
 * before, by signingTemplatesQuery and by integrationsCommand.
 */
test("the new Function is reachable and invokable in production", () => {
  const relay = readFileSync(
    `${process.cwd()}/app/api/functions/[functionName]/route.ts`,
    "utf8",
  );
  assert.match(relay, /"projectPurgeCommand"/);
  const iam = readFileSync(
    `${process.cwd()}/scripts/configure-production-function-invokers.sh`,
    "utf8",
  );
  assert.match(iam, /^\s*projectpurgecommand\s*$/m);
  const index = readFileSync(`${process.cwd()}/functions/src/index.ts`, "utf8");
  assert.match(index, /export \{ projectPurgeCommand \}/);
});
