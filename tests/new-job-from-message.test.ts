import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  clientMatchNote,
  isClientContact,
  jobNameFromRead,
  matchClientByEmail,
  occasionKept,
  teamEmailsOf,
} from "@/features/crm/new-job-from-message";
import { cleanOccasion, prefillFromText, readyByClock } from "@/features/crm/project-prefill";
import { projectThread } from "@/features/journey/thread";
import { occasionInstructionParts, readIntakeExtras } from "../functions/src/ai/copilot.js";
import { deterministicIntakeExtraction } from "../functions/src/ai/intake-prefill.js";
import {
  jobSourceMessageInputSchema,
  jobSourceMessageOf,
  jobSourceMessageRecord,
} from "../functions/src/crm/job-source-message.js";
import { jobFactSheet, prefillFromFacts, spokenClock } from "../functions/src/planning/job-facts.js";
import { recommendedFor } from "../functions/src/planning/recommended-templates.js";

/**
 * Making a job by pasting a message into "Tell me about the booking" on New
 * job, as walked on prod with Jess Styles Bridal (hair) on 2026-10-12.
 *
 * Priya Shah, a returning client whose wedding is already a job with a portal,
 * wrote asking for hair for her Sangeet that evening: guests at 6:00 PM, hair
 * done by 5:30 PM. Cue filled "New client" with her details (a second Priya),
 * named the job "Priya Shah wedding", dropped the time, threw the message away,
 * and later drafted her quote as "your wedding … styled on the morning".
 */

const read = (root: string, path: string) => readFileSync(`${process.cwd()}/${root}${path}`, "utf8");

const PRIYA_MESSAGE =
  "Hi Jess! It's Priya Shah again (Priya.Shah@Example.com). Could you do hair for her Sangeet tonight? " +
  "Guests arrive at 6:00 PM so we need hair done by 5:30 PM. It's at The Grand Ballroom. 3 people. Thanks, Priya";

const contacts = [
  {
    id: "priya",
    displayName: "Priya Shah",
    firstName: "Priya",
    lastName: "Shah",
    email: "priya.shah@example.com",
    normalizedEmail: "priya.shah@example.com",
    contactTypes: ["client"],
    archivedAt: null,
  },
  {
    id: "priya-plus",
    displayName: "Priya (test)",
    firstName: "Priya",
    lastName: "Test",
    email: "priya.shah+test@example.com",
    normalizedEmail: "priya.shah+test@example.com",
    contactTypes: ["client"],
    archivedAt: null,
  },
  {
    id: "florist",
    displayName: "Petal & Stem",
    firstName: "Rose",
    lastName: "Florist",
    email: "hello@petal.example",
    normalizedEmail: "hello@petal.example",
    contactTypes: ["vendor"],
    archivedAt: null,
  },
  {
    id: "old",
    displayName: "Old Client",
    firstName: "Old",
    lastName: "Client",
    email: "old@example.com",
    normalizedEmail: "old@example.com",
    contactTypes: ["client"],
    archivedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "prospect",
    displayName: "Nia Park",
    firstName: "Nia",
    lastName: "Park",
    email: "nia@example.com",
    normalizedEmail: "nia@example.com",
    contactTypes: ["prospect"],
    archivedAt: null,
  },
];

// ── F1: an existing client is matched by email ──────────────────────────

test("the read's email picks out the existing client: case and spacing aside, nothing else", () => {
  assert.deepEqual(matchClientByEmail(contacts, "  Priya.Shah@Example.COM "), {
    kind: "one",
    contactId: "priya",
    name: "Priya Shah",
    firstName: "Priya",
    lastName: "Shah",
  });
  // A plus-address is its own address, both ways round.
  assert.equal((matchClientByEmail(contacts, "priya.shah+test@example.com") as { contactId?: string }).contactId, "priya-plus");
  assert.deepEqual(matchClientByEmail(contacts, "priya.shah+sangeet@example.com"), { kind: "none" });
  // A prospect is a client-to-be; a second record for one is the same duplicate.
  assert.equal(matchClientByEmail(contacts, "nia@example.com").kind, "one");
  // Never a vendor, never an archived contact, never without an address.
  assert.deepEqual(matchClientByEmail(contacts, "hello@petal.example"), { kind: "none" });
  assert.deepEqual(matchClientByEmail(contacts, "old@example.com"), { kind: "none" });
  assert.deepEqual(matchClientByEmail(contacts, null), { kind: "none" });
  assert.deepEqual(matchClientByEmail(contacts, "not an email"), { kind: "none" });
  assert.deepEqual(matchClientByEmail(null, "priya.shah@example.com"), { kind: "none" });
  assert.equal(isClientContact({ contactTypes: ["vendor", "client"] }), true);
  assert.equal(isClientContact({ contactTypes: ["planner"] }), false);
});

test("several clients on one address pick nobody, and the form says so", () => {
  const twins = [...contacts, { ...contacts[0]!, id: "priya-again", displayName: "P. Shah" }];
  const match = matchClientByEmail(twins, "priya.shah@example.com");
  assert.deepEqual(match, { kind: "several", count: 2 });
  const note = clientMatchNote({ mode: "existing", read: match, selectedId: "", typed: { kind: "none" } });
  assert.ok(note?.warn);
  assert.match(note!.text, /2 of your clients use this email, so none was picked/);
  // Once the studio picks one, the note has said its piece.
  assert.equal(clientMatchNote({ mode: "existing", read: match, selectedId: "priya", typed: { kind: "none" } }), null);
});

test("the studio's own people are never matched as the client", () => {
  const team = teamEmailsOf({
    crewProfiles: [
      { email: " Sam@Crew.example ", archivedAt: null },
      { email: "gone@crew.example", archivedAt: "2026-01-01" },
      { email: "" },
    ],
    userEmail: "Jess@JessStyles.example",
  });
  assert.deepEqual([...team].sort(), ["jess@jessstyles.example", "sam@crew.example"]);
  // Even a client record carrying a crew member's address is not a match.
  const withCrewClient = [
    ...contacts,
    { id: "crew-as-client", displayName: "Sam", email: "sam@crew.example", contactTypes: ["client"], archivedAt: null },
  ];
  assert.deepEqual(matchClientByEmail(withCrewClient, "SAM@crew.example", team), { kind: "team" });
  assert.deepEqual(matchClientByEmail(withCrewClient, "jess@jessstyles.example", team), { kind: "team" });
  const note = clientMatchNote({ mode: "new", read: null, selectedId: "", typed: { kind: "team" } });
  assert.ok(note?.warn);
  assert.match(note!.text, /your own or one of your crew’s/);
});

test("the form says what it matched, and warns before a second record is made", () => {
  const match = matchClientByEmail(contacts, "priya.shah@example.com");
  const matched = clientMatchNote({ mode: "existing", read: match, selectedId: "priya", typed: { kind: "none" } });
  assert.deepEqual(matched?.warn, false);
  assert.match(matched!.text, /^Matched by email: Priya Shah is already your client/);
  assert.match(matched!.text, /Choose “New client”/);
  // Switched to "New client" with her address still typed: said, not blocked.
  const typed = clientMatchNote({ mode: "new", read: match, selectedId: "priya", typed: match });
  assert.ok(typed?.warn);
  assert.match(typed!.text, /Priya Shah is already your client at this email/);
  // Nothing to say about a stranger.
  assert.equal(
    clientMatchNote({ mode: "new", read: { kind: "none" }, selectedId: "", typed: { kind: "none" } }),
    null,
  );
  // A different client chosen by hand is the studio's call.
  assert.equal(clientMatchNote({ mode: "existing", read: match, selectedId: "prospect", typed: { kind: "none" } }), null);
});

test("the New job form matches before choosing New client, and waits for the client list", () => {
  const form = read("", "components/crm/create-project-form.tsx");
  assert.match(form, /matchClientByEmail\(contacts, found\.email, teamEmails\)/);
  assert.match(form, /if \(!intake \|\| !pending \|\| contactsLoading \|\| crewLoading\) return;/);
  // A message signed with a first name alone is named for the client it matched.
  assert.match(form, /firstName: match\.firstName,\s*lastName: match\.lastName,/);
  // The read no longer forces "New client" on its own.
  const start = form.indexOf("async function runCopilot()");
  assert.ok(start > 0);
  const readBlock = form.slice(start, form.indexOf("const submit", start));
  assert.match(readBlock, /pendingClientRead\.current = \{ found, eventWord \};/);
  assert.doesNotMatch(readBlock, /setValue\("clientMode", "new"\)/);
  // The note is shown, under the tabs, as a status.
  assert.match(form, /className=\{`intake-client-match\$\{clientNote\.warn \? " is-warning" : ""\}`\}/);
  const css = read("", "app/project-intake.css");
  assert.match(css, /\.intake-client-match > span \{\s*flex: 1 1 18ch;\s*min-width: 0;/);
});

// ── F2: the job is named for the occasion ───────────────────────────────

test("the job is named for the occasion the message names, otherwise for its kind", () => {
  assert.equal(
    jobNameFromRead({ firstName: "Priya", lastName: "Shah", partnerName: null, occasion: "her Sangeet", eventWord: "wedding" }),
    "Priya Shah Sangeet",
  );
  assert.equal(
    jobNameFromRead({ firstName: "Ava", lastName: "Chen", partnerName: "Liam", occasion: null, eventWord: "wedding" }),
    "Ava & Liam Chen wedding",
  );
  // "Wedding" is the kind, never an occasion of its own.
  assert.equal(
    jobNameFromRead({ firstName: "Ava", lastName: null, partnerName: null, occasion: "the wedding", eventWord: "session" }),
    "Ava session",
  );
  assert.equal(jobNameFromRead({ firstName: null, lastName: "Shah", partnerName: null, occasion: "Sangeet", eventWord: "wedding" }), null);
});

test("an occasion is read from the message only when it is what they ask for", () => {
  const cases: Array<[string, string | null]> = [
    [PRIYA_MESSAGE, "Sangeet"],
    // A returning bride: the wedding is behind her, the Sangeet is the ask.
    ["Hi Jess, you did my wedding hair last month! Could you do my Sangeet on October 12? Priya Shah priya@example.com", "Sangeet"],
    ["Could you book us for the rehearsal dinner on June 5? Ava ava@example.com", "rehearsal dinner"],
    // A wedding inquiry that mentions another event is still the wedding.
    ["Hi, we're getting married June 6, 2027 at Ryland Inn. We're also having a rehearsal dinner. Ava Chen ava@example.com", null],
    ["Hair for my wedding on June 6 2027, and we have a Sangeet the night before. Ava Chen ava@example.com", null],
    // Several events are the studio's to name.
    ["Wedding June 6 2027, Sangeet June 4, Mehndi June 3. Need hair for all three. Ava ava@example.com", null],
    ["Hi! Looking for hair for my wedding on June 6, 2027.", null],
  ];
  for (const [message, occasion] of cases) {
    assert.equal(prefillFromText(message).occasion, occasion, message);
    assert.equal(deterministicIntakeExtraction(message).occasion, occasion, `functions: ${message}`);
  }
  assert.equal(cleanOccasion("  her Sangeet. "), "Sangeet");
  assert.equal(cleanOccasion("Wedding day"), null);
  assert.equal(cleanOccasion("x".repeat(61)), null);
  assert.equal(cleanOccasion(42), null);
});

test("a renamed job keeps no occasion its name no longer carries", () => {
  assert.equal(occasionKept("Sangeet", "Priya Shah Sangeet"), "Sangeet");
  assert.equal(occasionKept("Sangeet", "Priya Shah wedding"), null);
  assert.equal(occasionKept(null, "Priya Shah Sangeet"), null);
});

test("the AI read is asked for the occasion and the ready-by time, and both are cleaned after it", () => {
  const copilot = read("", "functions/src/ai/copilot.ts");
  assert.match(copilot, /occasion: z\.string\(\)\.max\(120\)\.nullable\(\)\.default\(null\)/);
  assert.match(copilot, /readyByTime: z\.string\(\)\.max\(40\)\.nullable\(\)\.default\(null\)/);
  assert.match(copilot, /occasion: \{ type: "STRING", nullable: true \}/);
  assert.match(copilot, /readyByTime: \{ type: "STRING", nullable: true \}/);
  assert.match(copilot, /INTAKE_OCCASION_AND_TIME \+/);
  assert.deepEqual(
    readIntakeExtras({ email: "a@b.c", occasion: "her Sangeet", readyByTime: "5:30 PM" }),
    { email: "a@b.c", occasion: "Sangeet", readyByTime: "17:30" },
  );
  // A model that guessed, or an older reply without either: nothing.
  assert.deepEqual(readIntakeExtras({ occasion: "wedding", readyByTime: "around 5" }), {
    occasion: null,
    readyByTime: null,
  });
  assert.deepEqual(readIntakeExtras({}), { occasion: null, readyByTime: null });
});

// ── F3: the ready-by time reaches the party list ────────────────────────

test("the ready-by time is read from 'done by', never from an arrival time", () => {
  assert.equal(prefillFromText(PRIYA_MESSAGE).readyByTime, "17:30");
  assert.equal(prefillFromText("Everyone ready by noon please").readyByTime, "12:00");
  assert.equal(prefillFromText("Guests arrive at 6:00 PM").readyByTime, null);
  assert.equal(prefillFromText("Need us done by 5 please").readyByTime, null);
  assert.equal(deterministicIntakeExtraction(PRIYA_MESSAGE).readyByTime, "17:30");
  // The browser's clock reading agrees with the party list's (job-facts spokenClock).
  for (const value of ["5:30 PM", "5:30 p.m.", "by 5:30pm", "noon", "12 noon", "17:30", "9:30", "7:30", "1:30", "5", "12:30 AM", "25:00", "", null])
    assert.equal(readyByClock(value), spokenClock(value) || null, String(value));
});

test("a hair or makeup job made on New job fills the party list's ready-by from the project", () => {
  const sheet = jobFactSheet({
    projectId: "sangeet",
    project: { eventDate: "2026-10-12", eventType: "Wedding", state: "BOOKED", readyByTime: "17:30" },
    leadId: null,
    lead: null,
    contacts: [],
    vendors: [],
    schedule: null,
    responses: [],
  });
  for (const trade of ["hair", "makeup"] as const) {
    const form = recommendedFor(trade)[0]!;
    const { answers, answerProvenance } = prefillFromFacts({ sheet, sections: form.sections, trade });
    assert.equal(answers["ready-by-time"], "17:30", trade);
    assert.equal(answerProvenance["ready-by-time"]?.sourceCollection, "projects", trade);
    assert.equal(answerProvenance["ready-by-time"]?.sourceField, "readyByTime", trade);
  }
  // A job without one stays blank.
  const blank = jobFactSheet({
    projectId: "p",
    project: { eventDate: "2026-10-12", readyByTime: "around 5" },
    leadId: null,
    lead: null,
    contacts: [],
    vendors: [],
    schedule: null,
    responses: [],
  });
  assert.equal(blank.facts.ready_by_time, undefined);
});

test("only a per-person trade's form asks for, and sends, the ready-by time", () => {
  const form = read("", "components/crm/create-project-form.tsx");
  assert.match(form, /const perPerson = tradeProfile\(trade\)\.perPersonPricing;/);
  assert.match(form, /if \(perPerson\) set\("readyByTime", found\.readyByTime \?\? null\);/);
  assert.match(form, /\.\.\.\(perPerson && values\.readyByTime \? \{ readyByTime: values\.readyByTime \} : \{\}\)/);
  assert.match(form, /\{perPerson \? \(\s*<label/);
  const commands = read("", "functions/src/crm/commands.ts");
  assert.match(commands, /readyByTime: z\s*\.string\(\)\s*\.trim\(\)\s*\.regex\(\/\^\(\[01\]\\d\|2\[0-3\]\):\[0-5\]\\d\$\/\)\s*\.nullable\(\)\s*\.optional\(\)/);
});

// ── F8: the message is kept with the job, for the studio ────────────────

test("the message is kept beside the job, never on it, and only for the studio", () => {
  const commands = read("", "functions/src/crm/commands.ts");
  const create = commands.slice(commands.indexOf('if (command.type === "createProject") {'));
  assert.match(create, /const \{ sourceMessage, \.\.\.projectInput \} = command\.input;/);
  assert.match(create, /\.\.\.projectInput,\s*eventKind,/);
  assert.match(create, /transaction\.create\(\s*db\.doc\(`\$\{JOB_SOURCE_MESSAGES\}\/\$\{projectId\}`\),/);
  // The audit trail says a message was kept, never what it said.
  assert.match(create, /sourceMessageKept: true/);

  const rules = read("", "firestore.rules");
  const block = rules.slice(rules.indexOf("match /jobSourceMessages/{projectId}"), rules.indexOf("match /packages/{packageId}"));
  assert.match(block, /allow write: if false;/);
  assert.doesNotMatch(block, /"client"|subcontractor|staff_photographer/);
  assert.match(block, /studio_owner", "studio_admin"/);
  assert.match(block, /isAssignedToProject\(resource\.data\.tenantId, resource\.data\.projectId\)\s*&& hasRole\(resource\.data\.tenantId, \["studio_coordinator"\]\)/);

  // Exported and erased with the studio's other data, and purged with the job.
  assert.match(read("", "functions/src/saas/data-lifecycle.ts"), /"jobSourceMessages",/);
  assert.match(read("", "features/projects/purge-policy.ts"), /jobSourceMessages: \{ one: "message the job was made from"/);
});

test("the kept record is tenant-checked, cleaned and bounded", () => {
  const source = jobSourceMessageInputSchema.parse({ text: `  ${PRIYA_MESSAGE}  `, occasion: " her Sangeet " });
  assert.equal(source.text, PRIYA_MESSAGE);
  assert.equal(source.summary, null);
  assert.throws(() => jobSourceMessageInputSchema.parse({ text: "   " }));
  assert.throws(() => jobSourceMessageInputSchema.parse({ text: "x".repeat(8001) }));
  const record = jobSourceMessageRecord({
    tenantId: "jess",
    projectId: "sangeet",
    source,
    actorId: "owner",
    timestamp: "2026-10-12T15:00:00.000Z",
  });
  assert.deepEqual(record, {
    id: "sangeet",
    tenantId: "jess",
    projectId: "sangeet",
    message: PRIYA_MESSAGE,
    summary: null,
    occasion: "Sangeet",
    origin: "new_job_form",
    createdAt: "2026-10-12T15:00:00.000Z",
    createdBy: "owner",
    archivedAt: null,
  });
  assert.deepEqual(jobSourceMessageOf(record, "jess", "sangeet"), {
    message: PRIYA_MESSAGE,
    summary: null,
    occasion: "Sangeet",
  });
  assert.equal(jobSourceMessageOf(record, "another-studio", "sangeet"), null);
  assert.equal(jobSourceMessageOf(record, "jess", "another-job"), null);
  assert.equal(jobSourceMessageOf({ ...record, archivedAt: "2026-10-13" }, "jess", "sangeet"), null);
  assert.equal(jobSourceMessageOf({ ...record, message: "  " }, "jess", "sangeet"), null);
  assert.equal(jobSourceMessageOf(null, "jess", "sangeet"), null);
});

test("Job history opens with the message the job was made from", () => {
  const base = {
    projectId: "sangeet",
    projectName: "Priya Shah Sangeet",
    projectCreatedAt: "2026-10-12T15:00:00.000Z",
    clientName: "Priya",
    trade: "hair",
  };
  const entries = projectThread({
    ...base,
    sourceMessage: { id: "sangeet", message: PRIYA_MESSAGE, createdAt: "2026-10-12T15:00:00.000Z" },
  });
  assert.equal(entries[0]?.id, "source-sangeet");
  assert.equal(entries[0]?.actor, "studio");
  assert.equal(entries[0]?.title, "You made this job from a message");
  assert.equal(entries[0]?.detail, PRIYA_MESSAGE);
  // It already says the studio started the job: no second opener.
  assert.ok(!entries.some((entry) => entry.title === "You started this job"));
  // Archived, or never kept: the job opens as it always did.
  for (const sourceMessage of [
    { id: "sangeet", message: PRIYA_MESSAGE, createdAt: base.projectCreatedAt, archivedAt: "2026-10-13" },
    null,
  ]) {
    const [first] = projectThread({ ...base, sourceMessage });
    assert.equal(first?.title, "You started this job");
  }
  // Read by its id, from the studio's job page only.
  const hook = read("", "components/projects/use-project-thread.ts");
  assert.match(hook, /getDoc\(doc\(firestore, "jobSourceMessages", projectId\)\)/);
  assert.match(hook, /data\.tenantId === tenantId/);
});

test("'Draft from what they told you' reads the kept message, its occasion and its time", () => {
  const copilot = read("", "functions/src/ai/copilot.ts");
  const handler = copilot.slice(copilot.indexOf('kind === "proposal_drafting"'), copilot.indexOf('kind === "list_threads"'));
  assert.match(handler, /db\.doc\(`jobSourceMessages\/\$\{draftRequest\.projectId\}`\)\.get\(\)/);
  assert.match(handler, /jobSourceMessageOf\(\s*sourceDocument\.data\(\),\s*draftRequest\.tenantId,\s*draftRequest\.projectId,\s*\)/);
  assert.match(handler, /\.\.\.\(source\?\.occasion \? \{ occasion: source\.occasion \} : \{\}\)/);
  assert.match(handler, /readyByTime: spokenClock\(projectDocument\.get\("readyByTime"\)\)/);
  assert.match(copilot, /\.\.\.occasionInstructionParts\(facts\.project\),/);

  const [sangeet] = occasionInstructionParts({ occasion: "Sangeet", readyByTime: "17:30" });
  assert.match(sangeet!.text, /call it their Sangeet, never their wedding or wedding day/);
  assert.match(sangeet!.text, /never assume the morning/);
  assert.match(sangeet!.text, /project\.readyByTime/);
  // A ready-by time alone still keeps the trade's "morning" out.
  const [timed] = occasionInstructionParts({ readyByTime: "17:30" });
  assert.doesNotMatch(timed!.text, /call it their/);
  assert.match(timed!.text, /never assume the morning/);
  // Every other job's prompt is exactly as it was.
  assert.deepEqual(occasionInstructionParts({ name: "Ava & Liam Chen wedding", eventKind: "wedding" }), []);
  assert.deepEqual(occasionInstructionParts({ occasion: "wedding" }), []);
});

// ── The mirror ──────────────────────────────────────────────────────────

test("the deterministic read is the same in the app and in functions", () => {
  const app = read("", "features/crm/project-prefill.ts")
    .replaceAll("ProjectPrefill", "ProjectIntakeExtraction")
    .replaceAll("prefillFromText", "deterministicIntakeExtraction");
  const functionsCopy = read("", "functions/src/ai/intake-prefill.ts");
  const body = functionsCopy.slice(0, functionsCopy.indexOf("// Provenance note")).trimEnd();
  assert.equal(body, app.trimEnd());
});
