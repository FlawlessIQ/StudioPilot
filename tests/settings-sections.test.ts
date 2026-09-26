import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  SETTINGS_SECTIONS,
  legacySettingsTarget,
  settingsSectionBySlug,
} from "../features/settings/sections";

/**
 * Studio settings is a hub of quick links and a page per section.
 *
 * It used to be one long page, and before that the section list existed twice
 * (the phone's GROUPS and a hand-written desktop stack) and drifted: "Crew
 * offers" shipped invisible on desktop. Now one registry drives the hub (both
 * layouts) and the /studio/settings/[section] route, so these hold the three
 * together: every panel has a page, every page is on the hub, and old links
 * still land.
 */
const shell = readFileSync(`${process.cwd()}/components/settings/settings-shell.tsx`, "utf8");

const sectionComponents = () => {
  const block = shell.slice(
    shell.indexOf("const SECTION_COMPONENT"),
    shell.indexOf("};", shell.indexOf("const SECTION_COMPONENT")),
  );
  return [...block.matchAll(/^\s*(\w+):\s*(\w+),/gm)].map((match) => ({ key: match[1]!, component: match[2]! }));
};

test("every settings panel has its own page", () => {
  const keys = SETTINGS_SECTIONS.map((section) => section.key);
  assert.deepEqual(
    sectionComponents().map((section) => section.key).sort(),
    [...keys].sort(),
    "SECTION_COMPONENT and SETTINGS_SECTIONS must name the same sections",
  );
  const slugs = SETTINGS_SECTIONS.map((section) => section.slug);
  assert.equal(new Set(slugs).size, slugs.length, "slugs are unique");
  for (const slug of slugs) assert.ok(/^[a-z-]+$/.test(slug), `${slug} is a readable path`);
});

test("every section is a quick link on the hub", () => {
  const groups = shell.slice(shell.indexOf("const GROUPS"), shell.indexOf("function resolve"));
  const missing = SETTINGS_SECTIONS.filter((section) => !groups.includes(`key: "${section.key}"`));
  assert.deepEqual(missing.map((section) => section.key), [], "on no hub group, so reachable only by URL");
});

test("the hub renders no panel of its own, so nothing is found by scrolling", () => {
  const hub = shell.slice(shell.indexOf("export function SettingsShell"), shell.indexOf("export function SettingsSectionPage"));
  for (const { component } of sectionComponents()) assert.ok(!hub.includes(`<${component}`), `${component} renders on the hub`);
});

test("the crew trust dial is one of the sections", () => {
  assert.ok(sectionComponents().some((section) => section.component === "CrewOfferSettings"));
});

test("links written before sections had pages still land on them", () => {
  assert.equal(legacySettingsTarget("?section=forwarding", ""), "/studio/settings/inquiry-capture");
  assert.equal(legacySettingsTarget("", "#consultation-availability"), "/studio/settings/consultation-availability");
  assert.equal(legacySettingsTarget("", ""), null);
  assert.equal(legacySettingsTarget("?section=nonsense", ""), null);
  assert.equal(settingsSectionBySlug("inquiry-capture")?.key, "forwarding");
  assert.equal(settingsSectionBySlug("nope"), null);
});
