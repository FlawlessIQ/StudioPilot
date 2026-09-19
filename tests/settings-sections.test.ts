import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Settings are listed twice, and the two lists drift.
 *
 * `GROUPS` drives the phone screen; `DesktopSettings` is a hand-written stack
 * of the same panels. Nothing ties them together, so a section added to
 * `GROUPS` renders on a phone and nowhere else — which is how "Crew offers"
 * shipped invisible to every desktop user until this test existed.
 *
 * Matching on the component name rather than the key, because that is what the
 * desktop branch actually renders.
 */
const source = readFileSync(
  `${process.cwd()}/components/settings/settings-shell.tsx`,
  "utf8",
);

const sectionComponents = () => {
  const block = source.slice(
    source.indexOf("const SECTION_COMPONENT"),
    source.indexOf("};", source.indexOf("const SECTION_COMPONENT")),
  );
  return [...block.matchAll(/^\s*(\w+):\s*(\w+),/gm)].map((match) => ({
    key: match[1]!,
    component: match[2]!,
  }));
};

const desktopStack = () => {
  const start = source.indexOf("function DesktopSettings()");
  return source.slice(start, source.indexOf("export function SettingsShell"));
};

test("every settings section on the phone also renders on desktop", () => {
  const desktop = desktopStack();
  const missing = sectionComponents().filter(
    (section) => !desktop.includes(`<${section.component} />`),
  );
  assert.deepEqual(
    missing.map((section) => section.key),
    [],
    "these sections exist on the phone screen and are absent from DesktopSettings",
  );
});

test("the crew trust dial is one of them", () => {
  // The premise of the test above: a real section it must keep honest.
  assert.ok(
    sectionComponents().some(
      (section) => section.component === "CrewOfferSettings",
    ),
  );
});
