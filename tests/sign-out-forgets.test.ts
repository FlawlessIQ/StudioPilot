import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

/**
 * Signing out has to forget what this browser remembered.
 *
 * It cleared the Firebase session and nothing else. A shared or borrowed
 * laptop kept the previous user's workspace pointer and, worse, their cached
 * event brief: `studiocue:crew-event-brief:<uid>:<assignment>:<version>` holds
 * a subcontractor's call times, venue addresses and on-site contacts so the
 * brief still works with no signal at a venue. Right on their own phone; not
 * something to leave on someone else's machine.
 *
 * A test on the *convention* rather than on a list, because a list is what
 * fails silently: any key the product persists must carry one of the known
 * prefixes, so the prefix sweep at sign-out covers keys added later.
 */

const sourceFiles = (): string[] => {
  const out: string[] = [];
  const walk = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const next = `${path}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else if (/\.tsx?$/.test(entry.name)) out.push(next);
    }
  };
  for (const root of ["components", "features", "lib", "app"]) {
    walk(`${process.cwd()}/${root}`);
  }
  return out;
};

const KNOWN_PREFIXES = ["studiohub.", "studiocue:"];

test("sign-out clears the browser's stored workspace state", () => {
  const boundary = readFileSync(
    `${process.cwd()}/features/auth/auth-boundary.tsx`,
    "utf8",
  );
  assert.match(boundary, /forgetLocalWorkspaceState\(\)/);
  // Inside the sign-out handler, not merely defined somewhere in the file.
  const handler = boundary.slice(
    boundary.indexOf("async function leave()"),
    boundary.indexOf("async function leave()") + 420,
  );
  assert.match(handler, /forgetLocalWorkspaceState\(\)/);
  assert.match(boundary, /sessionStorage/);
});

test("every persisted key carries a prefix the sweep matches", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles()) {
    if (file.endsWith("auth-boundary.tsx")) continue;
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(
      /(?:localStorage|sessionStorage)\.(?:setItem|getItem|removeItem)\(\s*([`"'])([^`"'$]*)/g,
    )) {
      const key = match[2]!;
      if (!key) continue;
      if (!KNOWN_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        offenders.push(`${file.replace(process.cwd() + "/", "")}: "${key}"`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "these keys survive a sign-out because they do not start with " +
      KNOWN_PREFIXES.join(" or "),
  );
});
