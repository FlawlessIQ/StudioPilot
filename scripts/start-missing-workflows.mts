/**
 * Start the readiness checklist on booked jobs that never got one.
 *
 * A job's checklist starts once, at booking (or at import), from the studio's
 * template for its kind. When there was none, `autoInstantiateWorkflow`
 * skipped with `no_active_template` and nothing ever tried again: GR's two
 * imported bar mitzvahs sat at 0% ready with nothing to remind anyone, since
 * no studio had a mitzvah template (2026-10-28). Run this after
 * `backfill-starter-workflows.mts` has given studios the template.
 *
 * It goes through `autoInstantiateWorkflow` itself, exactly as booking and
 * the import do, with the import's dates for an imported job. Starting a
 * checklist sends nothing: no email, no automation; the checks' reminders
 * fall due on their own dates, as on any job.
 *
 * Only jobs still before their day (BOOKED, PLANNING, READY), not archived.
 * DRY RUN by default; `--write` starts them.
 *
 *   npx tsx scripts/start-missing-workflows.mts --prod <tenantId|--all> [--write]
 */
import { createRequire } from "node:module";

const args = process.argv.slice(2);
const write = args.includes("--write");
const prod = args.includes("--prod");
const all = args.includes("--all");
const tenantArgument = args.find((argument) => !argument.startsWith("--"));

if (!prod && !process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("Refusing to run: set FIRESTORE_EMULATOR_HOST for the emulator, or pass --prod for studiohub-prod.");
  process.exit(1);
}
if (!all && !tenantArgument) {
  console.error("usage: npx tsx scripts/start-missing-workflows.mts --prod <tenantId|--all> [--write]");
  process.exit(1);
}

// The functions package's own firebase-admin: autoInstantiateWorkflow calls
// getFirestore() from that copy, so the app must be initialised on it.
const functionsRequire = createRequire(new URL("../functions/package.json", import.meta.url));
const { applicationDefault, getApps, initializeApp } = functionsRequire("firebase-admin/app") as typeof import("firebase-admin/app");
const { getFirestore } = functionsRequire("firebase-admin/firestore") as typeof import("firebase-admin/firestore");
if (!getApps().length) {
  initializeApp(
    prod
      ? { credential: applicationDefault(), projectId: "studiohub-prod" }
      : { projectId: process.env.GOOGLE_CLOUD_PROJECT ?? "studiohub-dev" },
  );
}
const { autoInstantiateWorkflow } = await import("../functions/src/workflow/commands.ts");

const db = getFirestore();
const today = new Date().toISOString().slice(0, 10);
const BEFORE_THE_DAY = ["BOOKED", "PLANNING", "READY"];
const text = (value: unknown) => (typeof value === "string" ? value : "");

const projects = await (all
  ? db.collection("projects").where("state", "in", BEFORE_THE_DAY)
  : db.collection("projects").where("tenantId", "==", tenantArgument).where("state", "in", BEFORE_THE_DAY)
).get();
const runs = await (all
  ? db.collection("workflowRuns").where("status", "==", "active")
  : db.collection("workflowRuns").where("tenantId", "==", tenantArgument).where("status", "==", "active")
).get();
const running = new Set(runs.docs.map((run) => text(run.get("projectId"))));

const missing = projects.docs.filter(
  (project) => !project.get("archivedAt") && !running.has(project.id) && text(project.get("eventDate")) >= today,
);
console.log(`${projects.size} jobs before their day, ${missing.length} with no checklist`);

let failed = false;
for (const project of missing) {
  const data = project.data();
  const importedOn = text(data.importedAt).slice(0, 10);
  const label = `${project.id}  ${text(data.tenantId)}  ${text(data.name)}  ${text(data.eventKind) || text(data.eventType)}  ${text(data.eventDate)}`;
  if (!write) {
    console.log(`  would start: ${label}${importedOn ? "  (imported)" : ""}`);
    continue;
  }
  const result = await autoInstantiateWorkflow({
    tenantId: text(data.tenantId),
    projectId: project.id,
    actorId: "backfill:start-missing-workflows",
    ...(importedOn
      ? {
          imported: {
            bookingDate: text(data.bookingCompletedAt).slice(0, 10) || importedOn,
            importedOn,
            eventAhead: true,
            // What the import said was owed isn't kept on the job, so no
            // money step is recorded as settled: the records answer them
            // (checkpoint-evidence.ts), or the studio ticks them.
            retainerOwed: true,
            balanceOwed: true,
          },
        }
      : {}),
  });
  if ("skipped" in result) {
    failed = true;
    console.log(`  SKIPPED (${result.skipped}): ${label}`);
  } else {
    console.log(`  started ${result.checkpointCount} checks, ${result.readinessScore}% ready: ${label}`);
  }
}
if (!write) console.log("\nDRY RUN — pass --write to start them.");
if (failed) process.exit(1);
