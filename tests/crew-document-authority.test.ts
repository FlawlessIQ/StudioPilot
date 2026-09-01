import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * A file arriving is not the same as somebody having checked it.
 *
 * `submitCrewProfileDocument` exists so a crew member can send their own W-9
 * and insurance, and so a studio can file one it was emailed. Both write the
 * same field the ranking engine reads and the studio's compliance record
 * shows, which makes the tempting shortcut obvious: mark it verified on
 * upload and save everyone a click.
 *
 * That would move the attestation from the studio to whoever uploaded the
 * file — including the crew member being attested about. "Verified" is the
 * studio saying it has looked at a document; it is the only reason
 * setCrewCompliance exists. Upload may take a status as far as "received" and
 * no further.
 *
 * The path check is the other half. The command records a storage path into
 * the profile, so without pinning that path under this profile's own folder a
 * valid caller could point one profile's record at another's file.
 */
const handler = (() => {
  const source = readFileSync(
    `${process.cwd()}/functions/src/crew/commands.ts`,
    "utf8",
  );
  const start = source.indexOf('parsed.type === "submitCrewProfileDocument"');
  assert.ok(start >= 0, "the command is gone");
  const end = source.indexOf("} else if (parsed.type ===", start + 20);
  return source.slice(start, end);
})();

test("uploading a document never marks it verified", () => {
  assert.match(handler, /"received"/);
  assert.doesNotMatch(
    handler,
    /"verified"/,
    "upload is asserting what only the studio may assert",
  );
});

test("the recorded path must sit under the profile it is recorded against", () => {
  assert.match(handler, /crewProfiles\/\$\{parsed\.input\.crewProfileId\}/);
  assert.match(handler, /startsWith\(prefix\)/);
  assert.match(handler, /DOCUMENT_PATH_MISMATCH/);
});

test("only the studio or the person themselves may file", () => {
  assert.match(handler, /internalRoles\.has\(role\)/);
  assert.match(handler, /current\.get\("userId"\) === identity\.uid/);
});

test("storage keeps crew paperwork away from clients", () => {
  const rules = readFileSync(`${process.cwd()}/storage.rules`, "utf8");
  const start = rules.indexOf(
    "match /tenants/{tenantId}/crewProfiles/{crewProfileId}",
  );
  assert.ok(start >= 0, "the profile document rule is gone");
  const block = rules.slice(start, rules.indexOf("\n    match ", start + 20));
  // Without this a W-9 could be filed as "shared", which the project-wide
  // rule hands to the couple.
  assert.match(block, /metadata\.visibility == "crew"/);
  // No overwriting a filed document in place.
  assert.match(block, /resource == null/);
  assert.match(block, /scanStatus == "clean"/);
});
