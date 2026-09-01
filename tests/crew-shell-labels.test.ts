import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import test from "node:test";

/**
 * The crew shell is mounted once, by the layout, and names the page it is on.
 *
 * Both halves of that sentence were false. app/crew/layout.tsx mounted the
 * shell, and every page mounted a second one to pass its own label — which the
 * shell's own nesting guard discarded:
 *
 *     const shellMounted = useContext(CrewShellContext);
 *     if (shellMounted) return <>{children}</>;
 *
 * So thirteen `active` props went nowhere and the header fell back to a table
 * that answers a different question — which nav item to highlight. Several
 * routes share one nav item, so a crew member on Availability, on Profile, and
 * on Account all read the same "Crew · Account", and on Documents the nav lit
 * up a section they were not in.
 *
 * Nothing failed. The label was plausible on every screen, which is why it
 * survived: a wrong name looks like a design decision.
 */
const shell = readFileSync(
  `${process.cwd()}/components/crew/crew-portal-shell.tsx`,
  "utf8",
);

const crewRoutes = readdirSync(`${process.cwd()}/app/crew`, {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

test("no crew page mounts a second shell", () => {
  assert.ok(crewRoutes.length >= 10, "crew routes not found");
  for (const route of crewRoutes) {
    const page = `${process.cwd()}/app/crew/${route}/page.tsx`;
    if (!existsSync(page)) continue;
    assert.doesNotMatch(
      readFileSync(page, "utf8"),
      /CrewPortalShell/,
      `app/crew/${route}/page.tsx mounts its own shell, which the layout's already-mounted one discards`,
    );
  }
});

test("every crew route has a page title of its own", () => {
  const table = shell.slice(
    shell.indexOf("const crewPageTitles"),
    shell.indexOf("const crewRouteLabels"),
  );
  assert.ok(table.length > 0, "crewPageTitles is gone");
  for (const route of crewRoutes) {
    if (!existsSync(`${process.cwd()}/app/crew/${route}/page.tsx`)) continue;
    assert.match(
      table,
      new RegExp(`"?${route}"?:`),
      `/crew/${route} has no page title, so the header will name its nav section instead`,
    );
  }
});

test("the header shows the page, not the nav section", () => {
  // Two lookups, deliberately: several routes share a nav item and must, while
  // no two should share a name in the header.
  assert.match(shell, /<b>Crew ·<\/b> \{pageTitle\}/);
  assert.match(shell, /data-active=\{item\.label === resolvedActive/);
});
