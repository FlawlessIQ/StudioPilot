import { getFirestore } from "firebase-admin/firestore";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { buildCrewBrief } from "./crew-brief.js";
import { jobPackageSnapshotIds } from "../ai/schedule-package-facts.js";
import { packagesIncludeVideo } from "../ai/schedule-crew.js";
import { saveFormBillingAddress } from "../contacts/address-from-form.js";

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
    }
    // Reopened for the couple: the crew keep the brief they had until the
    // couple sends the form again. Their half-made edits are not the plan,
    // and deleting the brief would take the do-not-photograph list with it.
    if (after && !after.archivedAt && String(after.status) === "reopened") return;
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
