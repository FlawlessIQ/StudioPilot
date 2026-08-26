/**
 * Strip sending chrome from stored message bodies written before `threadBody`.
 *
 * Emails are rendered with a letterhead before sending. Messages written before
 * that change stored the whole rendered email, so the studio's own thread opens
 * with "FlawlessIQ · Powered by StudioCue" above the actual words.
 *
 * Dry by default. Prints every change it would make so the diff can be read
 * before anything is written, because a message body is the record of what was
 * said to a client.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8580 npx tsx scripts/backfill-message-letterhead.ts
 *   npx tsx scripts/backfill-message-letterhead.ts --apply
 */
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  hasLetterhead,
  stripLetterhead,
} from "../features/messaging/strip-letterhead.ts";

const apply = process.argv.includes("--apply");
const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

if (!getApps().length) {
  initializeApp(
    emulator
      ? { projectId: process.env.GOOGLE_CLOUD_PROJECT ?? "studiohub-dev" }
      : { credential: applicationDefault(), projectId: "studiohub-prod" },
  );
}
const db = getFirestore();

async function main() {
  const messages = await db.collection("messages").get();
  const changes: Array<{ id: string; before: string; after: string }> = [];

  for (const document of messages.docs) {
    for (const field of ["body", "bodyPreview"] as const) {
      const value = document.get(field);
      if (!hasLetterhead(value)) continue;
      changes.push({
        id: `${document.id}.${field}`,
        before: String(value).slice(0, 80),
        after: stripLetterhead(value).slice(0, 80),
      });
    }
  }

  console.log(`${messages.size} messages, ${changes.length} field(s) to clean`);
  for (const change of changes) {
    console.log(`\n  ${change.id}`);
    console.log(`    before: ${JSON.stringify(change.before)}`);
    console.log(`    after:  ${JSON.stringify(change.after)}`);
  }
  if (!changes.length) return;

  if (!apply) {
    console.log("\nre-run with --apply to write");
    return;
  }

  let batch = db.batch();
  let queued = 0;
  for (const document of messages.docs) {
    const update: Record<string, unknown> = {};
    for (const field of ["body", "bodyPreview"] as const) {
      const value = document.get(field);
      if (hasLetterhead(value)) update[field] = stripLetterhead(value);
    }
    if (!Object.keys(update).length) continue;
    batch.update(document.ref, update);
    queued += 1;
    if (queued === 400) {
      await batch.commit();
      batch = db.batch();
      queued = 0;
    }
  }
  if (queued) await batch.commit();
  console.log(`\napplied to ${changes.length} field(s)`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
