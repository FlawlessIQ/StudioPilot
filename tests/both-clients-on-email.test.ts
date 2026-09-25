import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * A wedding is two people and the studio holds both. `clientContactIds` has
 * always been an array; every send path took the first and ignored the rest,
 * so the partner heard nothing — not the proposal, not the questionnaire, not
 * the gallery. "A lot of the time they both want to be on emails."
 */
const source = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");
const jobs = source("functions/src/operations/jobs.ts");
const crm = source("functions/src/crm/commands.ts");
const detail = source("components/projects/live-project-detail.tsx");
const form = source("components/projects/project-add-client.tsx");

test("client mail reaches every client on the job", () => {
  assert.match(jobs, /const partnerRecipients = context\.recipientIsClient/);
  assert.match(
    jobs,
    /to: \[\{ email: recipient \}, \.\.\.partnerRecipients\.map\(\(email\) => \(\{ email \}\)\)\]/,
  );
});

/**
 * The gate is the whole safety of this. A crew offer, a studio notification or
 * an auth link must never fan out to a couple, and `recipientIsClient` falls
 * closed — an address it does not recognise stays studio-only.
 */
test("only mail that is already the client's is widened", () => {
  const block = jobs.slice(
    jobs.indexOf("const partnerRecipients ="),
    jobs.indexOf("const apiKey = process.env.SENDGRID_API_KEY"),
  );
  assert.match(block, /context\.recipientIsClient/);
  assert.match(block, /: \[\];/);
  // The addressed recipient is not repeated on the line.
  assert.match(block, /email !== recipient\.trim\(\)\.toLowerCase\(\)/);
  // A `to` line is visible to everyone on it.
  assert.match(block, /\.slice\(0, 3\)/);
});

test("a second client can actually be added", () => {
  assert.match(crm, /type: z\.literal\("addProjectClient"\)/);
  assert.match(crm, /if \(command\.type === "addProjectClient"\)/);
  assert.match(form, /runCrmCommand\("addProjectClient"/);
  assert.match(detail, /<ProjectAddClient/);
});

/** A studio that already met the partner should not end up with them twice. */
test("an existing contact is reused rather than duplicated", () => {
  const block = crm.slice(
    crm.indexOf('if (command.type === "addProjectClient")'),
    crm.indexOf('if (command.type === "updateProject")'),
  );
  assert.match(block, /where\("normalizedEmail", "==", normalizedEmail\)/);
  assert.match(block, /existingContact\?\.id \?\? randomUUID\(\)/);
  assert.match(block, /CLIENT_ALREADY_ON_PROJECT/);
  // Appends, never replaces — the first client stays on the job.
  assert.match(block, /clientContactIds: \[\.\.\.existingIds, contactId\]/);
});

test("it refuses where the other job controls refuse", () => {
  const block = crm.slice(
    crm.indexOf('if (command.type === "addProjectClient")'),
    crm.indexOf('if (command.type === "updateProject")'),
  );
  assert.match(block, /tenantId"\) !== command\.tenantId/);
  assert.match(block, /hasProjectAccess\(/);
  assert.match(block, /PROJECT_ARCHIVED/);
  assert.match(block, /action: "project\.client_added"/);
  assert.match(form, /if \(archived\) return null;/);
});

test("both new refusals have copy", () => {
  const copy = source("lib/ai/friendly-error.ts");
  assert.match(copy, /CLIENT_ALREADY_ON_PROJECT:/);
  assert.match(copy, /PROJECT_ARCHIVED:/);
});
