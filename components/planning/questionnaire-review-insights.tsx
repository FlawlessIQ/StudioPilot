"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CircleAlert, LoaderCircle, MessageCircleQuestion, Sparkles } from "lucide-react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { useWorkspace } from "@/features/auth/workspace-context";
import { twelveHourTimes } from "@/features/ai/clock-words";
import { getFirebaseClient } from "@/lib/firebase/client";
import { dataIsLive } from "@/lib/runtime-mode";
import {
  flagMentions,
  formFreshness,
  resolveAnswers,
  resolvedFor,
  reviewSettled,
  type ResolvableResponse,
} from "@/features/questionnaires/resolved-answers";

/** An answer as a person reads it: a time in 12-hour form, a list joined. */
const answerText = (value: unknown) =>
  Array.isArray(value) ? value.map(String).join(", ") : twelveHourTimes(String(value ?? ""));


type Review = {
  /** Every question it asked about has been answered on a later form (planning/job-answers-sync.ts). */
  settledSince: Array<{ label: string; value: string; formName: string }>;
  allSettled: boolean;
  summary: string;
  missingInformation: string[];
  contradictions: string[];
  planningRisks: string[];
  suggestedQuestions: string[];
  planningFacts: Array<{
    fieldId: string;
    label: string;
    category: string;
    value: unknown;
  }>;
};

/**
 * Cue's flags, with any 24-hour time it copied from the form in 12-hour form:
 * a review written before it was told to read "07:30" (Jess Styles Bridal,
 * prod walk 2026-10-12; features/ai/clock-words.ts).
 */
const strings = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map(twelveHourTimes)
    : [];

export function QuestionnaireReviewInsights({ projectId }: { projectId: string }) {
  const workspace = useWorkspace();
  const [reviews, setReviews] = useState<Array<{ id: string; name: string; review: Review }>>(() =>
    dataIsLive
      ? []
      : [{
          id: "demo-planning-review",
          name: "Wedding Planning v4",
          review: {
            settledSince: [],
            allSettled: false,
            summary: "Planning details are organized; the family photo list still needs confirmation.",
            missingInformation: ["Family photo list"],
            contradictions: [],
            planningRisks: ["Final schedule approval is still pending."],
            suggestedQuestions: ["Which family groupings must be photographed?"],
            planningFacts: [
              { fieldId: "venue", label: "Venue", category: "logistics", value: "The Foundry" },
              { fieldId: "coverage", label: "Coverage", category: "schedule", value: "1:15 PM–9:30 PM" },
            ],
          },
        }],
  );
  const [loading, setLoading] = useState(dataIsLive);

  useEffect(() => {
    if (!dataIsLive) return;
    if (workspace.loading || !workspace.tenantId) return;
    const { firestore } = getFirebaseClient();
    void getDocs(
      query(
        collection(firestore, "questionnaireResponses"),
        where("tenantId", "==", workspace.tenantId),
        where("projectId", "==", projectId),
      ),
    ).then((snapshot) => {
      // The job's answers as they stand now, across every form
      // (features/questionnaires/resolved-answers.ts): a review written when a
      // form said "TBD" shows what a later form settled, and drops the flags
      // and questions about it (GR Productions, 2026-10-13).
      const forms: ResolvableResponse[] = snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
      const resolved = resolveAnswers(forms);
      setReviews(
        snapshot.docs.flatMap((document) => {
          const value = document.get("aiReview");
          if (!value || typeof value !== "object" || Array.isArray(value)) return [];
          const review = value as Record<string, unknown>;
          const planningPackage = document.get("planningPackage") as
            | Record<string, unknown>
            | undefined;
          const planningFacts = Array.isArray(planningPackage?.facts)
            ? planningPackage.facts.flatMap((item) => {
                if (!item || typeof item !== "object" || Array.isArray(item)) return [];
                const fact = item as Record<string, unknown>;
                const fieldId = String(fact.fieldId ?? "");
                const now = resolvedFor(resolved, document.id, fieldId);
                return [{
                  fieldId,
                  label: String(fact.label ?? fact.fieldId ?? "Planning detail"),
                  category: String(fact.category ?? "preferences"),
                  // What the job says now, not what this form said then.
                  value: now && now.status === "answered" ? now.value : fact.value,
                }];
              })
            : [];
          const freshness = formFreshness(resolved, forms.find((form) => form.id === document.id)!);
          const settledLabels = freshness.settled.map((item) => item.label);
          const openLabels = freshness.open.map((item) => item.label);
          // A missing detail or a question about something settled since goes;
          // one also about something still open stays. Contradictions and
          // risks are never hidden: they stand until a person clears them.
          const current = (items: string[]) =>
            items.filter((item) => !flagMentions(item, settledLabels) || flagMentions(item, openLabels));
          const allSettled = review.status === "superseded" || reviewSettled(freshness, review);
          return [{
            id: document.id,
            name: String(document.get("templateName") ?? "Questionnaire"),
            review: {
              settledSince: freshness.settled.map((item) => ({ label: item.label, value: answerText(item.value), formName: item.formName })),
              allSettled,
              summary: twelveHourTimes(String(review.summary ?? "")),
              missingInformation: allSettled ? [] : current(strings(review.missingInformation)),
              contradictions: strings(review.contradictions),
              planningRisks: strings(review.planningRisks),
              suggestedQuestions: allSettled ? [] : current(strings(review.suggestedQuestions)),
              planningFacts,
            },
          }];
        }),
      );
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [projectId, workspace.loading, workspace.tenantId]);

  if (loading) {
    return <section className="panel questionnaire-ai-loading"><LoaderCircle className="spin" /> Reviewing planning intelligence…</section>;
  }
  if (!reviews.length) return null;

  return (
    <section className="questionnaire-ai-reviews">
      <div className="section-heading-row">
        <div><p className="eyebrow">Advisory AI review</p><h2>Planning intelligence</h2><p>Suggested follow-up only. Your team decides what is correct and complete.</p></div>
        <Sparkles aria-hidden="true" />
      </div>
      {reviews.map(({ id, name, review }) => (
        <article className="panel questionnaire-ai-card" key={id}>
          <header>
            <span><small>{name}</small><h3>{review.summary}</h3></span>
            <strong>{review.allSettled ? "Answered since" : "Human review required"}</strong>
          </header>
          {review.settledSince.length ? (
            <p className="questionnaire-ai-settled">
              {review.allSettled ? "Everything this review asked about has been answered since: " : "Answered since: "}
              {review.settledSince.map((item) => `${item.label} ${item.value} (${item.formName})`).join("; ")}.
            </p>
          ) : null}
          <div>
            <section>
              <h4><Sparkles size={15} /> Planning package</h4>
              {review.planningFacts.length ? (
                <ul>
                  {review.planningFacts.slice(0, 8).map((fact) => (
                    <li key={`${fact.category}-${fact.fieldId}`}>
                      <strong>{fact.label}:</strong>{" "}
                      {answerText(fact.value)}
                    </li>
                  ))}
                </ul>
              ) : <p>StudioCue is organizing the submitted answers.</p>}
              <p>{review.planningFacts.length} sourced detail{review.planningFacts.length === 1 ? "" : "s"} ready for the schedule, family formals, vendors, and logistics.</p>
            </section>
            <section><h4><CircleAlert size={15} /> Missing details</h4>{review.missingInformation.length ? <ul>{review.missingInformation.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No missing details were suggested.</p>}</section>
            <section><h4><CircleAlert size={15} /> Risks or conflicts</h4>{review.planningRisks.length || review.contradictions.length ? <ul>{[...review.planningRisks, ...review.contradictions].map((item) => <li key={item}>{item}</li>)}</ul> : <p>No conflicts were suggested.</p>}</section>
            <section><h4><MessageCircleQuestion size={15} /> Follow-up questions</h4>{review.suggestedQuestions.length ? <ul>{review.suggestedQuestions.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No follow-up questions were suggested.</p>}</section>
          </div>
          {review.allSettled ? null : (
            <Link className="button button-dark" href={`/studio/projects/${projectId}`}>
              Review prepared follow-up
            </Link>
          )}
        </article>
      ))}
    </section>
  );
}
