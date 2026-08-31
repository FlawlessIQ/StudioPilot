/**
 * Remove CSS for classes no component renders.
 *
 * Written for one specific piece of debris: the pre-`ds-` application shell.
 * `.sidebar`, `.topbar`, `.nav-item`, `.nav-active`, `.user-card`,
 * `.tenant-switcher`, `.shell-signout`, `.avatar-ink` and friends were replaced
 * by `.ds-sidebar`, `.ds-topbar`, `.ds-nav-item` and the rest, and their rules
 * were left behind — including a `padding-inline` that looked like an inset fix
 * and had never applied to anything.
 *
 * Uses postcss rather than regex. The first attempt at this was regex over a
 * minified stylesheet and it lost a brace, which is exactly the outcome that
 * argument deserves.
 *
 *   node scripts/audit/prune-dead-css.mjs            # report
 *   node scripts/audit/prune-dead-css.mjs --apply
 */
import postcss from "postcss";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";

const DEAD = new Set([
  "sidebar", "sidebar-brand", "sidebar-open", "topbar", "tenant-switcher",
  "tenant-copy", "user-card", "nav-item", "nav-active", "shell-signout",
  "avatar-ink",
]);

/** Every class token any component can render, so a live one is never removed. */
const rendered = (() => {
  const found = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const next = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else if (/\.tsx?$/.test(entry.name)) {
        const text = readFileSync(next, "utf8");
        for (const m of text.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{"([^"]*)"\})/g)) {
          for (const t of (m[1] ?? m[2] ?? m[3] ?? "").split(/[\s${}?:'"()+]+/)) {
            if (t) found.add(t);
          }
        }
      }
    }
  };
  for (const root of ["components", "app", "features", "lib"]) walk(root);
  return found;
})();

for (const name of DEAD) {
  if (rendered.has(name)) {
    console.error(`refusing to run: .${name} is rendered by a component`);
    process.exit(2);
  }
}

const apply = process.argv.includes("--apply");
let dropped = 0;
let trimmed = 0;

for (const file of readdirSync("app").filter((f) => f.endsWith(".css"))) {
  const path = `app/${file}`;
  const root = postcss.parse(readFileSync(path, "utf8"), { from: path });
  const changes = [];

  root.walkRules((rule) => {
    const parts = rule.selectors ?? [];
    const isDead = (one) =>
      [...one.matchAll(/\.([A-Za-z][\w-]*)/g)].some((m) => DEAD.has(m[1]));
    const deadParts = parts.filter(isDead);
    if (!deadParts.length) return;
    if (deadParts.length === parts.length) {
      changes.push(() => rule.remove());
      dropped += 1;
    } else {
      const keep = parts.filter((one) => !isDead(one));
      changes.push(() => { rule.selectors = keep; });
      trimmed += 1;
    }
    console.log(`  ${deadParts.length === parts.length ? "DROP" : "TRIM"}  ${path}: ${deadParts.join(", ").slice(0, 90)}`);
  });

  for (const change of changes) change();

  // An at-rule left holding nothing is debris too.
  let emptied;
  do {
    emptied = 0;
    root.walkAtRules((at) => {
      if (at.nodes && at.nodes.length === 0) { at.remove(); emptied += 1; }
    });
  } while (emptied);

  if (apply && changes.length) writeFileSync(path, root.toString());
}

console.log(`\n${dropped} rule(s) dropped, ${trimmed} selector list(s) trimmed${apply ? " — applied" : " (report only)"}`);
