import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import {
  clientsAddedToJob,
  ensureReturningClientAccess,
} from "./returning-client-access.js";

/**
 * A returning client can open a job the moment the studio makes it theirs.
 *
 * Every way a job gets a client — the studio making it (createProject), adding
 * someone to it (addProjectClient), Cue — ends in this document's
 * `clientContactIds`. So the grant is made here, once, instead of in each of
 * them: a client with a portal account and an active membership in this
 * studio has the job added to it (returning-client-access.ts). Anyone else is
 * untouched, and is sent an invitation when the studio first sends them
 * something, as before.
 *
 * Not for a job nobody at the studio has chosen to show a client yet
 * (automaticGrantHold, inside clientsAddedToJob): an inquiry that made itself
 * a job from the public form or a captured email — anyone who knows a
 * client's address can send one — or an imported booking still held quiet
 * (ADR 0005; tests/quiet-imported-bookings.test.ts). Those reach the account
 * with the studio's first send for them.
 *
 * Only on a create or an assignment: a write that leaves the job's clients as
 * they were returns before reading anything.
 */
export const clientAccessOnProjectWrite = onDocumentWritten(
  { document: "projects/{projectId}", retry: true },
  async (event) => {
    const before = event.data?.before;
    const after = event.data?.after;
    if (!after?.exists) return;
    const added = clientsAddedToJob(before?.exists ? (before.data() ?? null) : null, after.data() ?? null);
    if (!added.length) return;
    const tenantId = String(after.get("tenantId") ?? "");
    const projectId = event.params.projectId;
    const access = await ensureReturningClientAccess(getFirestore(), {
      tenantId,
      projectId,
      clientContactIds: added,
      actorId: "system:client-access",
      now: new Date().toISOString(),
      reason: before?.exists ? "client_added_to_job" : "job_created",
    });
    const granted = access.entries.filter((entry) => entry.plan === "grant");
    if (granted.length)
      logger.info("clientAccessOnProjectWrite granted", {
        tenantId,
        projectId,
        contactIds: granted.map((entry) => entry.contactId),
      });
  },
);
