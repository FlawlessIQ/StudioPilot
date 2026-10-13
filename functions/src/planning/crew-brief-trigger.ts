import { getFirestore } from "firebase-admin/firestore";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { buildCrewBrief } from "./crew-brief.js";
import { jobPackageSnapshotIds } from "../ai/schedule-package-facts.js";
import { packagesIncludeVideo } from "../ai/schedule-crew.js";
import { saveFormBillingAddress } from "../contacts/address-from-form.js";
import { fillVenueFromForm } from "./venue-from-form.js";
import { openFinalDetailsIfDue, refreshAwaitingSignoff } from "./final-details.js";
import { isReturned } from "./questionnaire-lifecycle.js";
import { syncJobAnswers } from "./job-answers-sync.js";

/**
 * Whether this write is the client's form coming back, or the party list on
 * a returned form changing — the moments the final details may now be due.
 * Pure: every other write (a studio note, a reminder stamp) is not one.
 */
export function formJustReturned(before: Record<string, unknown> | undefined, after: Record<string, unknown>): boolean {
  if (after.archivedAt || !isReturned(after.status)) return false;
  if (typeof after.tenantId !== "string" || typeof after.projectId !== "string") return false;
  if (!before || !isReturned(before.status)) return true;
  // Any answer changed on a returned form, not only the party list: a couple
  // fixing a time on their Event details after the sign-off was asked must see
  // the fix in what they confirm (GR Productions, 2026-10-13). The studio
  // locking it is the same answers.
  return JSON.stringify(before.answers ?? null) !== JSON.stringify(after.answers ?? null);
}

/** Whether a write changed what the form says. A review, a reminder stamp or a note is not a change. */
export function answersChanged(before: Record<string, unknown> | undefined, after: Record<string, unknown> | undefined): boolean {
  if (!before || !after) return true;
  return (
    JSON.stringify(before.answers ?? null) !== JSON.stringify(after.answers ?? null) ||
    String(before.status ?? "") !== String(after.status ?? "") ||
    Boolean(before.archivedAt) !== Boolean(after.archivedAt)
  );
}

/**
 * Whether the job's packages send a videographer, so the brief can say
 * "photographed or filmed" to the people holding both cameras. A missing
 * project or package reads as photo-only — the wording the couple saw.
 */
async function jobHasVideo(tenantId: string, projectId: string): Promise<boolean> {
  const db = getFirestore();
  const project = await db.doc(`projects/${projectId}`).get();
  if (!project.exists || project.get("tenantId") !== tenantId) return false;
  const snapshots = await Promise.all(
    jobPackageSnapshotIds({
      packageSnapshotId: project.get("packageSnapshotId"),
      additionalPackageSnapshotIds: project.get("additionalPackageSnapshotIds"),
    }).map((id) => db.doc(`packageSnapshots/${id}`).get()),
  );
  return packagesIncludeVideo(
    snapshots
      .filter((snapshot) => snapshot.exists && snapshot.get("tenantId") === tenantId)
      .map((snapshot) => snapshot.data() ?? {}),
  );
}

/**
 * Keep each submitted questionnaire's crew brief current.
 *
 * Crew can't read questionnaire responses — rightly, since those hold billing
 * contacts, approvers and private email addresses — so the part they need is
 * projected into `crewBriefs`, which assigned crew can read. Only a submitted
 * (or locked) response is projected: a half-finished form would hand crew a
 * do-not-photograph list that isn't finished either. An edit after submission
 * re-projects; a response that stops being submitted, or is archived, takes
 * its brief with it.
 */
export const crewBriefOnQuestionnaireWrite = onDocumentWritten(
  { document: "questionnaireResponses/{responseId}", region: "us-east4" },
  async (event) => {
    const responseId = event.params.responseId;
    const reference = getFirestore().doc(`crewBriefs/${responseId}`);
    const after = event.data?.after?.data();
    // A billing address the couple gave on the form goes onto their client
    // record when none is there (contacts/address-from-form.ts). Its own
    // failure must not cost the crew their brief.
    if (after) {
      await saveFormBillingAddress(getFirestore(), responseId, after).catch((caught: unknown) => {
        console.error("form billing address", responseId, caught instanceof Error ? caught.message : caught);
      });
      // And the job's venue, when it has none (planning/venue-from-form.ts).
      await fillVenueFromForm(getFirestore(), responseId, after).catch((caught: unknown) => {
        console.error("form venue", responseId, caught instanceof Error ? caught.message : caught);
      });
      // Their form back after the details locked: the final details go now,
      // not at tomorrow's sweep. For a makeup or hair client it is the party
      // list the headcount waits on (final-details.ts). A no-op unless due.
      // Already asked and not yet confirmed (asked at booking, before the
      // form was back): what they confirm becomes the details as they stand.
      // Not a headcount's number: that is the floor from the lock.
      if (formJustReturned(event.data?.before?.data(), after)) {
        const db = getFirestore();
        const job = { tenantId: String(after.tenantId), projectId: String(after.projectId) };
        const now = new Date().toISOString();
        const outcome = await openFinalDetailsIfDue(db, job, now)
          .then(async (opened) => (opened === "exists" ? await refreshAwaitingSignoff(db, job, now) : opened))
          .catch((caught: unknown) => `failed:${caught instanceof Error ? caught.message : String(caught)}`);
        if (outcome === "opened" || outcome === "refreshed" || outcome.startsWith("failed:"))
          console.log(JSON.stringify({ severity: outcome.startsWith("failed:") ? "ERROR" : "INFO", event: "final_details.on_form_return", responseId, outcome }));
      }
    }
    // Reopened for the couple: the crew keep the brief they had until the
    // couple sends the form again. Their half-made edits are not the plan,
    // and deleting the brief would take the do-not-photograph list with it.
    if (after && !after.archivedAt && String(after.status) === "reopened") return;
    // What the form says changed: every brief and review on the job follows
    // the job's answers as they now stand (planning/job-answers-sync.ts). Its
    // own failure falls back to this form's brief below.
    // Nothing the briefs read changed (a review written, a reminder stamped,
    // this sync's own "superseded"): nothing to do, and no loop.
    if (!answersChanged(event.data?.before?.data(), after)) return;
    // A draft being filled in (autosaves) — sent back neither before nor
    // after this write — changes nothing a brief or a review reads.
    const sentBack = (row: Record<string, unknown> | undefined) => Boolean(row) && !row!.archivedAt && isReturned(row!.status);
    if (!sentBack(event.data?.before?.data()) && !sentBack(after)) return;
    const tenantId = String((after ?? event.data?.before?.data())?.tenantId ?? "");
    const projectId = String((after ?? event.data?.before?.data())?.projectId ?? "");
    if (tenantId && projectId) {
      const synced = await syncJobAnswers(getFirestore(), {
        tenantId,
        projectId,
        video: await jobHasVideo(tenantId, projectId),
        now: new Date().toISOString(),
      }).catch((caught: unknown) => {
        console.error(JSON.stringify({ severity: "ERROR", event: "job_answers.sync_failed", responseId, reason: caught instanceof Error ? caught.message : String(caught) }));
        return null;
      });
      if (synced) {
        if (synced.superseded.length || synced.rerun.length)
          console.log(JSON.stringify({ severity: "INFO", event: "job_answers.reviews_followed", responseId, superseded: synced.superseded, rerun: synced.rerun }));
        const shareableNow = after && !after.archivedAt && ["submitted", "locked"].includes(String(after.status));
        if (!shareableNow) await reference.delete();
        return;
      }
    }
    const shareable =
      after &&
      !after.archivedAt &&
      ["submitted", "locked"].includes(String(after.status)) &&
      typeof after.tenantId === "string" &&
      typeof after.projectId === "string";
    if (!shareable) {
      await reference.delete();
      return;
    }
    const brief = buildCrewBrief({
      sections: (after.templateSnapshot as { sections?: unknown } | undefined)?.sections,
      answers:
        after.answers && typeof after.answers === "object"
          ? (after.answers as Record<string, unknown>)
          : {},
      video: await jobHasVideo(String(after.tenantId), String(after.projectId)),
    });
    await reference.set({
      id: responseId,
      tenantId: after.tenantId,
      projectId: after.projectId,
      questionnaireName: String(after.templateName ?? "Client brief"),
      beforeYouShoot: brief.beforeYouShoot,
      onTheDay: brief.onTheDay,
      submittedAt: after.submittedAt ?? null,
      updatedAt: new Date().toISOString(),
    });
  },
);
