/**
 * Backfill `visibility` on messages that predate the field.
 *
 * The client portal requires `visibility` to be "client" or "shared" and does
 * **not** default when it is absent
 * ([app/api/client/portal/route.ts](../app/api/client/portal/route.ts)). That is
 * the correct fail-closed behaviour — defaulting a message of unknown audience
 * to "shared" would publish studio-internal notes to clients. The consequence is
 * that any message written before the field existed is invisible in the portal
 * while still visible in the studio thread, and the studio has no way to know
 * the client never saw it.
 *
 * So this decides each message from evidence rather than from a default, using
 * one rule that cannot leak:
 *
 *   **A message that was already delivered to, or received from, the client
 *   cannot be leaked by showing it to the client.**
 *
 *   inbound            → "shared"  (the client wrote it; they have it already)
 *   outbound + client  → "shared"  (it was sent to their address; they have it)
 *   anything else      → "studio"  (unproven audience stays internal)
 *
 * Nothing is widened on a guess. A message with no direction and no client
 * recipient becomes "studio", which is what it already effectively was.
 *
 * Idempotent: documents that already carry a visibility are left untouched, so
 * this can be run repeatedly and after a partial run.
 *
 * Usage:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8580 npx tsx scripts/backfill-message-visibility.ts
 *   npx tsx scripts/backfill-message-visibility.ts --apply     # production
 *
 * Without --apply it reports what it would change and writes nothing.
 */
import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  decideVisibility,
  type MessageVisibilityDecision,
} from "../features/messaging/visibility-backfill.ts";

const apply = process.argv.includes("--apply");
const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

if (!getApps().length) {
  initializeApp(
    emulator
      ? { projectId: process.env.GOOGLE_CLOUD_PROJECT ?? "studiohub-dev" }
      : { credential: applicationDefault() },
  );
}
const db = getFirestore();

async function main() {
  const messages = await db.collection("messages").get();
  const missing = messages.docs.filter(
    (document) => typeof document.get("visibility") !== "string",
  );
  console.log(
    `${messages.size} messages, ${missing.length} without visibility`,
  );
  if (!missing.length) return;

  // Client contact emails per project, so an outbound message can be proven to
  // have gone to the client.
  const clientEmailsByProject = new Map<string, string[]>();
  for (const document of missing) {
    const projectId = String(document.get("projectId") ?? "");
    if (!projectId || clientEmailsByProject.has(projectId)) continue;
    const project = await db.doc(`projects/${projectId}`).get();
    const contactIds = Array.isArray(project.get("clientContactIds"))
      ? (project.get("clientContactIds") as unknown[]).map(String)
      : [];
    const emails: string[] = [];
    for (const contactId of contactIds) {
      const contact = await db.doc(`contacts/${contactId}`).get();
      const email = contact.get("normalizedEmail") ?? contact.get("email");
      if (typeof email === "string" && email.trim()) emails.push(email);
    }
    clientEmailsByProject.set(projectId, emails);
  }

  const tally: Record<MessageVisibilityDecision, number> = { shared: 0, studio: 0 };
  let batch = db.batch();
  let queued = 0;
  for (const document of missing) {
    const decision = decideVisibility({
      direction: document.get("direction"),
      recipientIsClient: document.get("recipientIsClient"),
      contactId: document.get("contactId"),
      recipient: document.get("recipient"),
      clientEmails:
        clientEmailsByProject.get(String(document.get("projectId") ?? "")) ?? [],
    });
    tally[decision] += 1;
    if (apply) {
      batch.update(document.ref, { visibility: decision });
      queued += 1;
      if (queued === 400) {
        await batch.commit();
        batch = db.batch();
        queued = 0;
      }
    }
  }
  if (apply && queued) await batch.commit();
  console.log(
    `${apply ? "applied" : "would apply"}: shared=${tally.shared} studio=${tally.studio}`,
  );
  if (!apply) console.log("re-run with --apply to write");
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
