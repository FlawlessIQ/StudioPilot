import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { suggestedResponsibilities } from "@/features/crew/responsibilities";

/**
 * A videographer's offer said he would be the backup primary photographer.
 *
 * Walked as the crew member on production, 2026-09-22. Once a run of show
 * exists the responsibilities come from it, but this job had none, and the
 * fallback was the constant photography list — sent with a $950 offer, on the
 * one screen a subcontractor reads before accepting or declining.
 */

test("a videographer role is not offered photography duties", () => {
  const video = suggestedResponsibilities(["Videographer"]);
  assert.ok(
    !video.some((duty) => /photographer/i.test(duty)),
    `a videographer was offered: ${video.join(", ")}`,
  );
});

test("a photography role keeps the list it always had", () => {
  assert.deepEqual(suggestedResponsibilities(["Second photographer"]), [
    "Ceremony reactions",
    "Cocktail-hour candids",
    "Backup primary photographer",
  ]);
});

test("a retitled video role still reads as video", () => {
  // `coverageRoleForLabel` is the single rule for which trade a label is.
  for (const label of ["Video lead", "Second videographer", "VIDEOGRAPHER"]) {
    assert.ok(
      !suggestedResponsibilities([label]).some((duty) =>
        /photographer/i.test(duty),
      ),
      `"${label}" was offered photography duties`,
    );
  }
});

test("both trades on one job name both, not one", () => {
  const mixed = suggestedResponsibilities(["Second photographer", "Videographer"]);
  assert.notDeepEqual(mixed, suggestedResponsibilities(["Second photographer"]));
  assert.notDeepEqual(mixed, suggestedResponsibilities(["Videographer"]));
});

test("the staffing form no longer hardcodes the photography list", () => {
  const workspace = readFileSync(
    "components/crew/crew-cascade-workspace.tsx",
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(
    workspace,
    /useState\(\s*"Ceremony reactions/,
    "the constant default is what reached the videographer",
  );
  assert.match(workspace, /suggestedResponsibilitiesText\(roles\)/);
});

test("the form does not claim a run of show it does not have", () => {
  const workspace = readFileSync(
    "components/crew/crew-cascade-workspace.tsx",
    "utf8",
  );
  assert.doesNotMatch(
    workspace,
    /responsibilities from the coverage you planned/,
    "the notice asserted a provenance the fallback does not have",
  );
});
