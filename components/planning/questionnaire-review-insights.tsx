"use client";

import { useEffect, useState } from "react";
import { CircleAlert, LoaderCircle, MessageCircleQuestion, Sparkles } from "lucide-react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { useWorkspace } from "@/features/auth/workspace-context";
import { getFirebaseClient } from "@/lib/firebase/client";

type Review = {
  summary: string;
  missingInformation: string[];
  contradictions: string[];
  planningRisks: string[];
  suggestedQuestions: string[];
};

const strings = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

export function QuestionnaireReviewInsights({ projectId }: { projectId: string }) {
  const workspace = useWorkspace();
  const [reviews, setReviews] = useState<Array<{ id: string; name: string; review: Review }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (workspace.loading || !workspace.tenantId) return;
    const { firestore } = getFirebaseClient();
    void getDocs(
      query(
        collection(firestore, "questionnaireResponses"),
        where("tenantId", "==", workspace.tenantId),
        where("projectId", "==", projectId),
      ),
    ).then((snapshot) => {
      setReviews(
        snapshot.docs.flatMap((document) => {
          const value = document.get("aiReview");
          if (!value || typeof value !== "object" || Array.isArray(value)) return [];
          const review = value as Record<string, unknown>;
          return [{
            id: document.id,
            name: String(document.get("templateName") ?? "Questionnaire"),
            review: {
              summary: String(review.summary ?? ""),
              missingInformation: strings(review.missingInformation),
              contradictions: strings(review.contradictions),
              planningRisks: strings(review.planningRisks),
              suggestedQuestions: strings(review.suggestedQuestions),
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
          <header><span><small>{name}</small><h3>{review.summary}</h3></span><strong>Human review required</strong></header>
          <div>
            <section><h4><CircleAlert size={15} /> Missing details</h4>{review.missingInformation.length ? <ul>{review.missingInformation.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No missing details were suggested.</p>}</section>
            <section><h4><CircleAlert size={15} /> Risks or conflicts</h4>{review.planningRisks.length || review.contradictions.length ? <ul>{[...review.planningRisks, ...review.contradictions].map((item) => <li key={item}>{item}</li>)}</ul> : <p>No conflicts were suggested.</p>}</section>
            <section><h4><MessageCircleQuestion size={15} /> Follow-up questions</h4>{review.suggestedQuestions.length ? <ul>{review.suggestedQuestions.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No follow-up questions were suggested.</p>}</section>
          </div>
        </article>
      ))}
    </section>
  );
}
