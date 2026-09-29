"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, LoaderCircle } from "lucide-react";
import { doc, getDoc } from "firebase/firestore";
import { demoTenantDocuments } from "@/components/live/tenant-records";
import { FileLinks } from "@/components/documents/file-link";
import { StatusBadge } from "@/components/ui/status-badge";
import { useWorkspace } from "@/features/auth/workspace-context";
import { fileAnswerRefs } from "@/features/documents/file-ref";
import { statusLabel } from "@/features/format/status-label";
import { answerText } from "@/features/questionnaires/crew-brief";
import { parseQuestionnaireSections, type QuestionnaireField } from "@/features/questionnaires/client-form";
import { getFirebaseClient } from "@/lib/firebase/client";
import { formatDueDate } from "@/lib/format/event-date";
import { dataIsLive } from "@/lib/runtime-mode";

type Row = Record<string, unknown> & { id: string };

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [];

function when(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  try {
    return formatDueDate(raw);
  } catch {
    return raw;
  }
}

/**
 * A couple's questionnaire, as they answered it (docs/document-access-plan-2026-09-28.md, 2.2).
 *
 * The Questionnaires list was a column of rows that opened nothing: a studio
 * could see a form was submitted and could not read it. This is the read-only
 * answer sheet. Unlike the couple's form it shows the studio's internal-only
 * questions, and files open in place.
 */
export function QuestionnaireResponseView({ id }: { id: string }) {
  const workspace = useWorkspace();
  const [response, setResponse] = useState<Row | null | undefined>(() =>
    dataIsLive
      ? undefined
      : ((demoTenantDocuments("questionnaireResponses") as Row[]).find((item) => item.id === id) ?? null),
  );
  const [projectName, setProjectName] = useState<string>("");

  useEffect(() => {
    if (!dataIsLive || workspace.loading) return;
    let active = true;
    void (async () => {
      const { firestore } = getFirebaseClient();
      try {
        const snapshot = await getDoc(doc(firestore, "questionnaireResponses", id));
        if (!active) return;
        if (!snapshot.exists() || snapshot.get("tenantId") !== workspace.tenantId) {
          setResponse(null);
          return;
        }
        const data = { id: snapshot.id, ...snapshot.data() } as Row;
        setResponse(data);
        const projectId = text(data.projectId);
        if (projectId) {
          const project = await getDoc(doc(firestore, "projects", projectId)).catch(() => null);
          if (active && project?.exists()) setProjectName(text(project.get("name")));
        }
      } catch {
        if (active) setResponse(null);
      }
    })();
    return () => {
      active = false;
    };
  }, [id, workspace.loading, workspace.tenantId]);

  if (response === undefined) {
    return (
      <div className="live-detail-page">
        <p className="live-domain-state">
          <LoaderCircle aria-hidden="true" className="spin" size={16} /> Opening the questionnaire…
        </p>
      </div>
    );
  }
  if (!response) {
    return (
      <div className="live-detail-page">
        <Link className="back-link" href="/studio/questionnaires">
          <ArrowLeft /> Back to questionnaires
        </Link>
        <h1>Questionnaire unavailable</h1>
        <p>This questionnaire isn&rsquo;t available in the active studio.</p>
      </div>
    );
  }

  const projectId = text(response.projectId);
  const answers = record(response.answers);
  const sections = parseQuestionnaireSections(record(response.templateSnapshot).sections);
  const labels = new Map<string, QuestionnaireField>(
    sections.flatMap((section) => section.fields.map((field) => [field.id, field] as const)),
  );
  const title = text(response.templateName) || text(response.name) || "Questionnaire";
  const review = record(response.aiReview);
  const history = (Array.isArray(response.changeHistory) ? response.changeHistory : [])
    .map(record)
    .filter((entry) => text(entry.fieldId))
    .slice(-12)
    .reverse();
  const facts: Array<[string, string]> = [];
  const submitted = when(response.submittedAt);
  if (submitted) facts.push(["Sent back", submitted]);
  const due = when(response.dueDate);
  if (due && !submitted) facts.push(["Due", due]);
  const updated = when(response.updatedAt);
  if (updated) facts.push(["Last change", updated]);
  if (typeof response.completionPercent === "number") facts.push(["Answered", `${response.completionPercent}%`]);

  return (
    <div className="live-detail-page questionnaire-response">
      <Link
        className="back-link"
        href={projectId ? `/studio/questionnaires?project=${encodeURIComponent(projectId)}` : "/studio/questionnaires"}
      >
        <ArrowLeft /> {projectName ? `${projectName} questionnaires` : "Back to questionnaires"}
      </Link>
      <header className="page-heading">
        <div>
          <p className="eyebrow">{projectName || "Questionnaire"}</p>
          <h1>{title}</h1>
        </div>
        {text(response.status) ? (
          <div className="live-detail-header-actions">
            <StatusBadge>{statusLabel(response.status)}</StatusBadge>
          </div>
        ) : null}
      </header>

      {facts.length ? (
        <section className="live-detail-grid">
          {facts.map(([label, value]) => (
            <article className="panel" key={label}>
              <small>{label}</small>
              <strong>{value}</strong>
            </article>
          ))}
        </section>
      ) : null}

      {sections.map((section) => {
        const fields = section.fields.filter((field) => {
          if (field.type === "information") return false;
          const answered = answerText(field.type, answers[field.id]) !== "";
          if (answered) return true;
          // An unanswered follow-up that never applied isn't missing.
          if (field.conditionalOn) {
            return JSON.stringify(answers[field.conditionalOn.fieldId]) === JSON.stringify(field.conditionalOn.equals);
          }
          return true;
        });
        if (!fields.length) return null;
        return (
          <section className="panel questionnaire-response-section" key={section.id}>
            <h2>{section.title}</h2>
            <dl>
              {fields.map((field) => {
                const value = answers[field.id];
                const files = field.type === "file" ? fileAnswerRefs(value) : [];
                const shown = files.length ? "" : answerText(field.type, value);
                return (
                  <div key={field.id}>
                    <dt>
                      {field.label}
                      {field.internalOnly ? <span className="questionnaire-response-tag">Studio only</span> : null}
                    </dt>
                    <dd>
                      {files.length ? (
                        <FileLinks files={files} />
                      ) : shown ? (
                        shown
                      ) : (
                        <span className="questionnaire-response-empty">
                          {field.required ? "Not answered yet" : "No answer"}
                        </span>
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </section>
        );
      })}

      {text(review.summary) || strings(review.missingInformation).length ? (
        <section className="panel questionnaire-response-section">
          <p className="eyebrow">Advisory AI review</p>
          <h2>What StudioCue noticed</h2>
          {text(review.summary) ? <p>{text(review.summary)}</p> : null}
          {(
            [
              ["Missing", strings(review.missingInformation)],
              ["Doesn’t add up", strings(review.contradictions)],
              ["Planning risks", strings(review.planningRisks)],
              ["Worth asking", strings(review.suggestedQuestions)],
            ] as const
          ).map(([label, items]) =>
            items.length ? (
              <div className="questionnaire-response-review" key={label}>
                <strong>{label}</strong>
                <ul>
                  {items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null,
          )}
        </section>
      ) : null}

      {history.length ? (
        <section className="panel questionnaire-response-section">
          <h2>Changes</h2>
          <ul className="questionnaire-response-history">
            {history.map((entry, index) => {
              const field = labels.get(text(entry.fieldId));
              const type = field?.type ?? "text";
              const before = answerText(type, entry.before);
              const after = answerText(type, entry.after);
              return (
                <li key={`${text(entry.fieldId)}-${text(entry.changedAt)}-${index}`}>
                  <strong>{field?.label ?? text(entry.fieldId)}</strong>
                  <span>
                    {before ? `${before} → ` : ""}
                    {after || "cleared"}
                  </span>
                  {when(entry.changedAt) ? <small>{when(entry.changedAt)}</small> : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
