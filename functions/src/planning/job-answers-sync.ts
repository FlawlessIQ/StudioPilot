import type { Firestore } from "firebase-admin/firestore";
import { buildCrewBrief } from "./crew-brief.js";
import { answersAsSettled, formFreshness, resolveAnswers, responseCounts, reviewSettled, type ResolvableResponse } from "./resolved-answers.js";

/**
 * Keep everything written from one form in step with the job's answers as
 * they now stand (planning/resolved-answers.ts) — GR Productions, 2026-10-13:
 * details captured on a later form kept showing as TBD wherever the earlier
 * form had been read.
 *
 * Run whenever a form's answers change (crew-brief-trigger.ts):
 * - **Every returned form's crew brief** is rebuilt from its answers with the
 *   undecided ones replaced by what another form has since settled, so the
 *   crew's Event details brief stops saying "TBD" once the Final schedule
 *   answers it.
 * - **A planning review gone stale is superseded** (resolved-answers.ts
 *   `reviewSettled`): written before the answers that settled it, raising no
 *   contradiction or risk, and every missing detail it listed answered since
 *   on another form. Its flags and its prepared follow-up are about nothing:
 *   the follow-up is withdrawn, so nobody approves an email asking the couple
 *   for what they already gave, and the review is marked superseded.
 *
 * Idempotent: the same answers always write the same briefs and the same
 * states, and an action already decided is left as it is.
 */

type Row = Record<string, unknown>;

export async function syncJobAnswers(
  db: Firestore,
  input: { tenantId: string; projectId: string; video: boolean; now: string },
): Promise<{ briefs: number; superseded: string[]; rerun: string[] }> {
  const forms = await db
    .collection("questionnaireResponses")
    .where("tenantId", "==", input.tenantId)
    .where("projectId", "==", input.projectId)
    .get();
  const responses: ResolvableResponse[] = forms.docs.map((form) => ({ id: form.id, ...(form.data() as Row) }));
  const resolved = resolveAnswers(responses);
  const batch = db.batch();
  let briefs = 0;
  const superseded: string[] = [];
  const rerun: string[] = [];
  for (const response of responses) {
    const data = response as Row;
    const shareable = !data.archivedAt && ["submitted", "locked"].includes(String(data.status));
    if (shareable) {
      const brief = buildCrewBrief({
        sections: (data.templateSnapshot as { sections?: unknown } | undefined)?.sections,
        answers: answersAsSettled(resolved, response) as Record<string, unknown>,
        video: input.video,
      });
      batch.set(db.doc(`crewBriefs/${response.id}`), {
        id: response.id,
        tenantId: input.tenantId,
        projectId: input.projectId,
        questionnaireName: String(data.templateName ?? "Client brief"),
        beforeYouShoot: brief.beforeYouShoot,
        onTheDay: brief.onTheDay,
        submittedAt: data.submittedAt ?? null,
        updatedAt: input.now,
      });
      briefs += 1;
    }
    if (!responseCounts(response) || !data.aiReview) continue;
    const freshness = formFreshness(resolved, response);
    const review = data.aiReview as Row;
    // A later form settled something this review asked about since it was
    // written: the review runs again with the job's answers in hand
    // (operations/ai-pdf.ts reads them), so its flags, its risks and its
    // follow-up are about what is still open — or there is no follow-up.
    // Once per settling answer: the job carries the moment it was asked for.
    const newestSettling = freshness.settled.map((item) => item.answeredAt).sort().at(-1) ?? "";
    const generatedAt = String(review.generatedAt ?? "");
    if (newestSettling && generatedAt && generatedAt < newestSettling) {
      const jobReference = db.doc(`aiJobs/questionnaire_${response.id}`);
      const job = await jobReference.get();
      const alreadyAsked = String(job.get("rerunFor") ?? "") >= newestSettling;
      if (!alreadyAsked && !["queued", "running"].includes(String(job.get("status") ?? ""))) {
        batch.set(
          jobReference,
          {
            id: jobReference.id,
            tenantId: input.tenantId,
            projectId: input.projectId,
            responseId: response.id,
            type: "questionnaire_analysis",
            status: "queued",
            attempts: 0,
            humanReviewRequired: true,
            rerunFor: newestSettling,
            rerunReason: "settled_on_a_later_form",
            updatedAt: input.now,
            ...(job.exists ? {} : { createdAt: input.now }),
          },
          { merge: true },
        );
        rerun.push(response.id);
      }
    }
    if (review.status === "superseded" || !reviewSettled(freshness, review)) continue;
    superseded.push(response.id);
    const settled = freshness.settled.map((item) => ({ fieldId: item.fieldId, label: item.label, form: item.formName }));
    batch.update(db.doc(`questionnaireResponses/${response.id}`), {
      "aiReview.status": "superseded",
      "aiReview.supersededAt": input.now,
      "aiReview.settledSince": settled,
    });
    for (const actionId of [`ai_questionnaire_${response.id}`, `ai_planning_followup_${response.id}`]) {
      const action = await db.doc(`aiActions/${actionId}`).get();
      if (!action.exists || action.get("tenantId") !== input.tenantId) continue;
      // Only one still waiting on a person: a decided action stays as decided.
      if (!["review_required", "draft", "pending"].includes(String(action.get("status") ?? ""))) continue;
      batch.update(action.ref, {
        status: "superseded",
        supersededAt: input.now,
        supersededReason: "answered_on_a_later_form",
        updatedAt: input.now,
        updatedBy: "job-answers-sync",
      });
    }
  }
  await batch.commit();
  return { briefs, superseded, rerun };
}
