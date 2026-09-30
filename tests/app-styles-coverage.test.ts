import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

/**
 * The app's stylesheets load per section, so the public inquiry form doesn't
 * carry them (H5, 2026-09-30).
 *
 * The root layout imported every stylesheet — 729 KB, 6,369 rules — and
 * Next.js loads what the root layout imports on every page, including the form
 * couples open on their phones and studios embed on their websites. Each
 * section's layout now imports app/app-styles.ts; /inquiry imports a small
 * sheet of its own. These keep both halves honest: no section loses its
 * styles, and the form never uses a class its sheet doesn't style.
 */

const read = (file: string) => readFileSync(file, "utf8");
const PUBLIC_FORM = "inquiry";

function hasPage(dir: string): boolean {
  return readdirSync(dir).some((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? hasPage(full) : entry === "page.tsx";
  });
}

test("every section with pages loads the app's stylesheets; the root layout loads none", () => {
  const root = read("app/layout.tsx");
  assert.doesNotMatch(root, /import\s+["'][^"']+\.css["']/, "the root layout imports no stylesheet");
  assert.doesNotMatch(root, /import\s+["'][^"']*app-styles/);
  assert.match(read("app/page.tsx"), /import "@\/app\/app-styles";/, "the home page");
  const sections = readdirSync("app").filter(
    (entry) => statSync(path.join("app", entry)).isDirectory() && entry !== "api" && entry !== PUBLIC_FORM,
  );
  assert.ok(sections.length > 20);
  for (const section of sections) {
    const dir = path.join("app", section);
    if (!hasPage(dir)) continue;
    const layout = path.join(dir, "layout.tsx");
    assert.ok(existsSync(layout), `${section} has a layout`);
    assert.match(read(layout), /import "@\/app\/app-styles";/, `${section}'s layout loads the app's stylesheets`);
  }
  // Every stylesheet the root layout used to load is in the shared module.
  const styles = read("app/app-styles.ts");
  for (const sheet of ["globals", "design-system", "legacy-bridge", "contracts", "kit-tokens", "kit"])
    assert.match(styles, new RegExp(`import "\\./${sheet}\\.css";`), sheet);
});

test("the inquiry form loads its own small sheet and the kit, nothing else", () => {
  const layout = read("app/inquiry/layout.tsx");
  assert.doesNotMatch(layout, /app-styles/);
  assert.match(layout, /import "\.\/inquiry\.css";\s*import "\.\.\/kit-tokens\.css";\s*import "\.\.\/kit\.css";/);
  // Nothing in the form's own files pulls a stylesheet back in.
  for (const file of formFiles().filter((file) => file !== "app/inquiry/layout.tsx"))
    assert.doesNotMatch(read(file), /import\s+["'][^"']+\.css["']/, file);
  const bytes = ["app/inquiry/inquiry.css", "app/kit-tokens.css", "app/kit.css"].reduce((sum, file) => sum + statSync(file).size, 0);
  assert.ok(bytes < 90_000, `the form's CSS is ${bytes} bytes; the budget is 90 KB`);
  // No service worker or page-wide observer on the public form.
  assert.match(read("components/pwa/register-service-worker.tsx"), /PUBLIC_FORM\.test\(window\.location\.pathname\)\)return;/);
  assert.match(read("components/ui/icon-button-titles.tsx"), /\/\^\\\/inquiry\(\\\/\|\$\)\/\.test\(window\.location\.pathname\)\) return;/);
});

test("every class the form's files use is styled by its own sheet or the kit", () => {
  const css = ["app/inquiry/inquiry.css", "app/kit-tokens.css", "app/kit.css"].map(read).join("\n");
  const styled = new Set([...css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((match) => match[1]));
  // Classes that are markers or behaviour hooks, never styled on purpose.
  const unstyledByDesign = new Set(["honeypot"]);
  const missing: string[] = [];
  for (const file of formFiles()) {
    for (const match of read(file).matchAll(/className=\{?["`]([^"`]+)["`]/g)) {
      for (const cls of match[1]!.split(/\s+/)) {
        if (!cls || cls.includes("$") || cls.includes("{") || unstyledByDesign.has(cls)) continue;
        if (!styled.has(cls)) missing.push(`${path.basename(file)}: ${cls}`);
      }
    }
  }
  assert.deepEqual(missing, [], "a class the form uses has no rule in inquiry.css or the kit");
});

/** The inquiry page and every file it imports, followed through @/ and relative imports. */
function formFiles(): string[] {
  const seen = new Set<string>();
  const queue = ["app/inquiry/page.tsx", "app/inquiry/layout.tsx"].map((file) => path.resolve(file));
  const resolve = (from: string, spec: string) => {
    const base = spec.startsWith("@/") ? path.resolve(spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(from), spec) : null;
    if (!base) return null;
    for (const ext of ["", ".tsx", ".ts", "/index.tsx", "/index.ts"]) {
      const file = base + ext;
      if (existsSync(file) && statSync(file).isFile()) return file;
    }
    return null;
  };
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file) || !/\.tsx?$/.test(file)) continue;
    seen.add(file);
    for (const match of read(file).matchAll(/(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
      const next = resolve(file, match[1] ?? match[2]!);
      if (next) queue.push(next);
    }
  }
  return [...seen].map((file) => path.relative(process.cwd(), file));
}
