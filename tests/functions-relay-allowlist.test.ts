import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

/**
 * Every Function the browser calls has to be named in the relay's allowlist.
 *
 * In production `NEXT_PUBLIC_*_FUNCTIONS_URL` is `/api/functions`, not a
 * Functions origin, so a browser call goes through
 * app/api/functions/[functionName]/route.ts — which checks the name against
 * a hard-coded list and returns FUNCTION_NOT_FOUND for anything missing.
 *
 * Locally those same env vars point straight at the emulator, so a caller
 * added without its allowlist entry works on the developer's machine and
 * 404s the moment it ships. That is exactly how signingTemplatesQuery
 * reached production as "Your templates could not be loaded" with nothing
 * in the Function's own logs, because the request never got that far.
 *
 * Both calling styles are checked: `${endpoint}/name`, where endpoint is one
 * of those env vars, and a literal "/api/functions/name".
 */

const root = process.cwd();

function sourceFiles(directory: string): string[] {
  const out: string[] = [];
  const walk = (path: string) => {
    for (const entry of readdirSync(path)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = join(path, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
    }
  };
  walk(join(root, directory));
  return out;
}

const route = readFileSync(
  join(root, "app/api/functions/[functionName]/route.ts"),
  "utf8",
);
const allowlist = new Set(
  [...route.matchAll(/^\s*"([A-Za-z][A-Za-z0-9]*)",\s*$/gm)].map(
    (match) => match[1] as string,
  ),
);

test("the relay allowlist is not empty", () => {
  // A refactor that renames the array must not silently turn this whole
  // file into a test that asserts nothing.
  assert.ok(
    allowlist.size > 10,
    `parsed ${allowlist.size} names from the relay route; the shape it is scraped from probably changed`,
  );
});

test("every browser-called Function is in the relay allowlist", () => {
  const called = new Map<string, string>();
  for (const file of [...sourceFiles("lib"), ...sourceFiles("components"), ...sourceFiles("app")]) {
    if (file.includes("api/functions")) continue;
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(
      /\$\{endpoint[^}]*\}\/([A-Za-z][A-Za-z0-9]*)/g,
    )) {
      called.set(match[1] as string, file.slice(root.length + 1));
    }
    for (const match of source.matchAll(
      /["'`]\/api\/functions\/([A-Za-z][A-Za-z0-9]*)/g,
    )) {
      called.set(match[1] as string, file.slice(root.length + 1));
    }
  }

  assert.ok(called.size > 5, "found no browser Function calls to check");

  const missing = [...called.entries()].filter(
    ([name]) => !allowlist.has(name),
  );
  assert.deepEqual(
    missing,
    [],
    `these Functions are called from the browser but missing from the relay allowlist in app/api/functions/[functionName]/route.ts:\n` +
      missing.map(([name, file]) => `  ${name}  (${file})`).join("\n"),
  );
});
