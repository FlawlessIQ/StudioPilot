import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * A couple who already had a job with a studio accepted an invitation to a
 * new one and landed on the old one: the portal opens whichever job it
 * remembers. Found on a production walk (2026-09-25), where the old job was a
 * booked wedding whose contract read "complete" and the new proposal sat
 * unopened. The accept result names the invitation's job; the page must make
 * it the one the portal opens.
 */
test("accepting an invitation opens the job it was for", () => {
  const page = readFileSync("features/auth/accept-client-invitation.tsx", "utf8");
  const accept = page.slice(page.indexOf("const acceptInvitation"), page.indexOf("router.replace(destination)"));
  assert.match(accept, /result\.projectId/);
  assert.match(accept, /studiohub\.activeClientProjectId\.\$\{tenantId\}/);
  // The key must be the one the portal reads when it chooses a job.
  const workspace = readFileSync("features/auth/workspace-context.tsx", "utf8");
  assert.match(workspace, /studiohub\.activeClientProjectId\.\$\{membership\.tenantId\}/);
  // And the command still reports which job it was.
  const command = readFileSync("functions/src/client/invitations.ts", "utf8");
  assert.match(command, /return \{ tenantId, projectId, status: "active" \}/);
});
