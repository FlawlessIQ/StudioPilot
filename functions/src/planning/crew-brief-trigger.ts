import { getFirestore } from "firebase-admin/firestore";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { buildCrewBrief } from "./crew-brief.js";

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
