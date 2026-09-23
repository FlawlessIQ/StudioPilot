/**
 * Turn a week of "this wasn't right" into eval cases.
 *
 * This is the half of the flywheel that closes it. A turn already records what
 * the model asked for, which tools ran and which records it saw; the operator's
 * verdict joins to that. What has been missing is anyone turning those into
 * tests — done by hand until now, which is why the ampersand bug took two
 * attempts and a fixture audit before the real case was covered.
 *
 * Prints scenario stubs for tests/cue-eval.test.ts. It does NOT write them:
 * a scenario needs an expected answer, and only a person knows what the turn
 * should have done. What it removes is the archaeology — finding the turn,
 * recovering the question, and working out whether retrieval or judgement
 * failed.
 *
 * Usage:
 *   node scripts/cue-feedback-to-scenarios.mjs            # everything unpromoted
 *   node scripts/cue-feedback-to-scenarios.mjs --all      # including promoted
 */
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

initializeApp({ projectId: "studiohub-prod" });
const db = getFirestore();
const includePromoted = process.argv.includes("--all");

const snapshot = await db.collection("copilotFeedback").limit(200).get();
const rows = snapshot.docs
  .map((doc) => doc.data())
  .filter((row) => (includePromoted ? true : !row.promotedToEvalAt))
  .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));

if (!rows.length) {
  console.log("No unreviewed feedback. Nothing to promote.");
  process.exit(0);
}

console.log(`${rows.length} turn(s) an operator marked wrong\n`);

for (const row of rows) {
  const d = row.diagnostics || {};
  /**
   * Which half failed, from the record rather than from a guess.
   *
   * The distinction that used to cost an hour: a flow the model never asked
   * for is the model's, a flow we could not aim is ours, and an answer with no
   * tool calls at all never saw the records it was being asked about.
   */
  const verdict = !d.tools || !d.tools.length
    ? "RETRIEVAL — the model called no tools; it answered without reading anything"
    : d.flowResolution === "dropped_unresolved_project"
      ? "OURS — the model asked for a flow and we could not aim it at a project"
      : d.flowResolution === "not_requested"
        ? "MODEL — no flow was asked for"
        : "JUDGEMENT — the records were read and the flow resolved";

  console.log("─".repeat(72));
  console.log(`said:      ${row.question}`);
  console.log(`verdict:   ${row.verdict}${row.note ? ` — "${row.note}"` : ""}`);
  console.log(`diagnosis: ${verdict}`);
  console.log(`tools:     ${(d.tools || []).map((t) => t.name).join(", ") || "none"}`);
  console.log(`prompt:    ${d.promptFingerprint || "?"}   model: ${d.model || "?"}`);
  console.log(`
  {
    id: ${JSON.stringify(String(row.question).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40))},
    said: ${JSON.stringify(row.question)},
    subjectPhrase: null,          // the words the model would copy through
    expectProject: null,          // the job it should resolve to
    expectSubject: null,
    intent: "action",             // or "question"
    because: "reported wrong by an operator on ${String(row.createdAt).slice(0, 10)}",
  },`);
}

console.log("─".repeat(72));
console.log(`
Paste the stubs above into tests/cue-eval.test.ts, fill in what each turn
SHOULD have done, and the case is covered from then on. Mark a row promoted:

  copilotFeedback/<interactionId>.promotedToEvalAt = <ISO date>
`);
