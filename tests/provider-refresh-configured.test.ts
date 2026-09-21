import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * A provider refresh needs the client credentials of the Function it runs in.
 *
 * `refreshCredential` reads `process.env.<PROVIDER>_CLIENT_ID/_SECRET`, which
 * exist only on Functions that declare them. QuickBooks declares them on three
 * — the OAuth handler and the two job workers — and every code path that
 * actually refreshes a QuickBooks credential runs in one of those. That is not
 * obvious from reading any single file, and nothing enforced it.
 *
 * Found 2026-09-21: the reference studio's QuickBooks connection sat in
 * `status: error / QUICKBOOKS_REFRESH_NOT_CONFIGURED` for three days. The
 * credential was fine; a refresh had been attempted somewhere without the
 * secret, and the failure was written onto *their* connection as though they
 * had broken it.
 */
const root = process.cwd();
const runtime = readFileSync(
  join(root, "functions/src/operations/provider-runtime.ts"),
  "utf8",
);

test("a deployment fault does not mark the studio's connection broken", () => {
  // The studio cannot fix a missing secret by reconnecting, and telling them to
  // throws away an authorisation that still works.
  assert.match(runtime, /_REFRESH_NOT_CONFIGURED\$\/\.test\(code\)/);
  const guard = runtime.slice(runtime.indexOf("_REFRESH_NOT_CONFIGURED$/.test(code)"));
  assert.match(
    guard.slice(0, 400),
    /integration\.refresh_not_configured/,
    "it must still be loud in the logs",
  );
  assert.ok(
    guard.indexOf("throw caught") < guard.indexOf('status:"error"'),
    "it must throw before any status write",
  );
});

/**
 * Every module that opens a provider connection, and the Function entry points
 * that can reach it. A new caller in a Function without the secrets brings the
 * bug straight back — silently, because the symptom lands on the studio's
 * connection document rather than in the caller.
 */
test("only modules reachable from a credentialed Function open a connection", () => {
  const callers: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.endsWith(".ts")) continue;
      const source = readFileSync(full, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      if (/\bawait connection\(/.test(source))
        callers.push(full.slice(root.length + 1));
    }
  };
  walk(join(root, "functions/src"));

  /**
   * Each of these runs only inside a Function that declares the provider
   * secrets. `billing/autopay.ts` is the one worth stating: its scheduler has
   * no secrets at all and is allowed here because it only *enqueues* — the
   * charge itself runs in the job workers, which do. If that ever changes,
   * autopay starts failing every run and blaming the studio for it.
   */
  const KNOWN = [
    "functions/src/billing/autopay.ts",
    "functions/src/integrations/signing-templates.ts",
    "functions/src/operations/provider-runtime.ts",
  ];
  assert.deepEqual(
    callers.sort(),
    KNOWN.sort(),
    "a new module opens a provider connection — confirm the Function it runs in declares that provider's CLIENT_ID and CLIENT_SECRET, then add it here",
  );
});

/** The one this guard caught on its first run. */
test("the signing templates query declares the Dropbox Sign secret", () => {
  const source = readFileSync(
    join(root, "functions/src/integrations/signing-templates.ts"),
    "utf8",
  );
  assert.match(source, /await connection\(tenantId, "dropbox_sign"\)/);
  assert.match(source, /secrets: \["DROPBOX_SIGN_CLIENT_SECRET"\]/);
});

test("the job workers and the OAuth handler declare the QuickBooks credentials", () => {
  // These are the three Functions every QuickBooks refresh actually runs in.
  for (const path of [
    "functions/src/integrations/oauth.ts",
    "functions/src/operations/jobs.ts",
    "functions/src/operations/task-queue.ts",
  ]) {
    const source = readFileSync(join(root, path), "utf8");
    assert.match(source, /"QUICKBOOKS_CLIENT_ID"/, path);
    assert.match(source, /"QUICKBOOKS_CLIENT_SECRET"/, path);
  }
});
