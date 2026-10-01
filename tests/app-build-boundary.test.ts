import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * The app's production build type-checks every .ts/.mts/.tsx file tsconfig
 * includes, and follows their imports. App Hosting installs only the root
 * package, so a file that statically imports ../functions/src pulls in code
 * needing firebase-functions, which isn't there, and the build fails — while
 * every local build passes, because functions/node_modules exists here
 * (scripts/purge-tenant-jobs.ts, 2026-10-01: build-2026-10-01-017 FAILED).
 *
 * Such a file must be listed in tsconfig's exclude (it still runs via tsx).
 */
const config = JSON.parse(readFileSync("tsconfig.json", "utf8")) as { exclude: string[] };
const excluded = (path: string) =>
  config.exclude.some((entry) => path === entry || path.startsWith(`${entry.replace(/\/$/, "")}/`));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) return [];
    return statSync(path).isDirectory() ? files(path) : /\.(m?ts|tsx)$/.test(name) ? [path] : [];
  });
}

test("no type-checked app file statically imports the functions package", () => {
  const offenders = ["app", "components", "features", "lib", "server", "scripts", "config"]
    .flatMap((dir) => {
      try {
        return files(dir);
      } catch {
        return [];
      }
    })
    .filter((path) => !excluded(path))
    .filter((path) =>
      /(?:^|\n)\s*(?:import|export)[^;]*?from\s+["'](?:\.\.\/)+functions\/src\//.test(readFileSync(path, "utf8")),
    );
  assert.deepEqual(offenders, []);
});
