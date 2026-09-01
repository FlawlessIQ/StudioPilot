import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Every refusal an invitee can be handed, said in words.
 *
 * These endpoints answer with a bare constant — INVITED_EMAIL_MISMATCH,
 * SUBCONTRACTOR_LIMIT_REACHED — and each accept page turns it into a sentence
 * saying what to do next. A code with no case falls to a generic "retry once,
 * then ask the studio to resend", which is wrong advice for most of them:
 * resending does not help somebody signed in as the wrong address, and
 * retrying does not help a studio out of seats.
 *
 * The person reading it cannot see the studio's screen, is usually not
 * technical, and has no other route in. A raw constant strands them.
 *
 * Scoped to the branches an invitee can actually reach. These files also throw
 * for the studio-facing half — revoking, editing members — and those codes
 * surface in the workspace, not here.
 */
const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");

/** One handler branch: from its `parsed.type ===` guard to the next one. */
function branch(source: string, type: string) {
  const start = source.indexOf(`parsed.type === "${type}"`);
  assert.ok(start >= 0, `no branch for ${type}`);
  const next = source.indexOf("parsed.type === ", start + 20);
  return source.slice(start, next === -1 ? source.length : next);
}

const codesIn = (source: string) =>
  new Set(
    [...source.matchAll(/throw new Error\("([A-Z_]+)"\)/g)].map(
      (match) => match[1]!,
    ),
  );

const surfaces = [
  {
    name: "crew",
    // Nothing else lives in this file, so the whole of it is invitee-facing.
    codes: () => codesIn(read("functions/src/crew/invitations.ts")),
    page: "features/auth/accept-crew-invitation.tsx",
  },
  {
    name: "staff",
    codes: () => {
      const source = read("functions/src/saas/memberships.ts");
      return codesIn(
        branch(source, "previewInvitation") +
          branch(source, "acceptInvitation"),
      );
    },
    page: "features/auth/accept-invitation.tsx",
  },
  {
    name: "client",
    codes: () => {
      const source = read("functions/src/client/invitations.ts");
      return codesIn(branch(source, "preview") + branch(source, "accept"));
    },
    page: "features/auth/accept-client-invitation.tsx",
  },
];

for (const surface of surfaces) {
  test(`the ${surface.name} accept page has words for every refusal`, () => {
    const codes = surface.codes();
    // Guards the extraction: if this ever reads zero codes the assertion
    // below passes vacuously.
    assert.ok(codes.size >= 3, `only found ${codes.size} codes`);
    const page = read(surface.page);
    for (const code of codes) {
      assert.match(
        page,
        new RegExp(`case "${code}":`),
        `${code} reaches the invitee as a raw constant`,
      );
    }
  });
}
