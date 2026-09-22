import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

/**
 * Every caller of `selectPackage` has to send `discount`.
 *
 * The command schema (functions/src/crm/commands.ts) requires it — a
 * discriminated union with no default and no `.optional()`. The proposal
 * workspace and the booking autopilot both send `{ type: "none" }`. Cue's
 * flow runner did not, so every package chosen from the chat came back
 * `400 INVALID_COMMAND:discount` and nothing was applied. Found on production
 * 2026-09-22; the request and the 400 were read off the wire, not inferred.
 *
 * This is a required field with a sensible-looking omission — exactly the kind
 * a fourth caller will get wrong too.
 */

const callers = execFileSync(
  "grep",
  ["-rl", "selectPackage", "components", "lib", "app"],
  { encoding: "utf8" },
)
  .split("\n")
  .filter(Boolean)
  // The portal route calls its own server-side helper, not the browser command.
  .filter((path) => !path.endsWith("app/api/client/portal/route.ts"));

test("the command still requires a discount", () => {
  // The premise. If discount ever gains a default, this file should be
  // rewritten rather than deleted.
  const schema = readFileSync("functions/src/crm/commands.ts", "utf8");
  const block = /packageId: z\.string\(\)\.min\(1\),[\s\S]{0,700}?discount: z\.discriminatedUnion/;
  assert.match(
    schema,
    block,
    "selectPackage no longer declares a required discount — recheck the callers",
  );
});

test("every browser caller of selectPackage sends a discount", () => {
  assert.ok(callers.length >= 2, `expected callers, found ${callers.length}`);
  for (const path of callers) {
    const source = readFileSync(path, "utf8");
    let index = source.indexOf('runCrmCommand("selectPackage"');
    while (index !== -1) {
      // The call's own object literal, up to the closing `})`.
      const call = source.slice(index, index + 600);
      const body = call.slice(0, call.indexOf("});") + 3);
      assert.match(
        body,
        /discount:/,
        `${path} calls selectPackage without a discount. The command schema ` +
          "requires it, so this returns 400 INVALID_COMMAND:discount and " +
          'applies nothing. Send `discount: { type: "none" }`.',
      );
      index = source.indexOf('runCrmCommand("selectPackage"', index + 1);
    }
  }
});

// Comments are allowed to name the anti-pattern — that is how the reason for
// the fix survives. Only real code counts.
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("flow failures reach the studio as copy, not as a thrown code", () => {
  const runner = withoutComments(
    readFileSync("components/ai/flow-runner.tsx", "utf8"),
  );
  assert.doesNotMatch(
    runner,
    /caught\.message\.replaceAll/,
    'A thrown code was being shown to the studio verbatim — "INVALID ' +
      'COMMAND:discount". Use friendlyError, which carries copy for these codes.',
  );
});
