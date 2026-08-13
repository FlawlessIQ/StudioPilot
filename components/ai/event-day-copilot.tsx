"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  BookOpenCheck,
  CalendarClock,
  LoaderCircle,
  MapPin,
  Send,
  ShieldCheck,
  Sparkles,
  UsersRound,
} from "lucide-react";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { StatusBadge } from "@/components/ui/status-badge";
import { useWorkspace } from "@/features/auth/workspace-context";
import { askCopilot, type CopilotResult } from "@/lib/ai/copilot-client";

const text = (value: unknown) => (typeof value === "string" ? value : "");
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const time = (value: unknown) => {
  const date = new Date(text(value));
  return Number.isNaN(date.valueOf())
    ? "Time pending"
    : new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
      }).format(date);
};

const quickQuestions = [
  "Give me the event-day brief in priority order.",
  "What is the next scheduled moment and where is it?",
  "Which facts or approvals are still uncertain?",
  "Summarize crew arrival, roles, and acknowledgements.",
  "What venue or insurance detail should I double-check?",
];

export function EventDayCopilot({
  initialProjectId = "",
}: {
  initialProjectId?: string;
}) {
  const workspace = useWorkspace();
  const { records: projects, loading } = useTenantDocuments("projects");
  const { records: schedules } = useTenantDocuments("schedules");
  const { records: assignments } = useTenantDocuments("crewAssignments");
  const { records: readiness } = useTenantDocuments("readinessAssessments");
  const { records: insurance } = useTenantDocuments("insuranceRequests");
  const [projectId, setProjectId] = useState(initialProjectId);
  const [question, setQuestion] = useState(quickQuestions[0]!);
  const [result, setResult] = useState<CopilotResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upcoming = useMemo(
    () =>
      [...(projects ?? [])]
        .filter(
          (project) =>
            text(project.eventDate) >= new Date().toISOString().slice(0, 10) &&
            !["CANCELLED", "CLOSED", "ARCHIVED"].includes(text(project.state)),
        )
        .sort((left, right) =>
          text(left.eventDate).localeCompare(text(right.eventDate)),
        ),
    [projects],
  );
  useEffect(() => {
    if (projectId || !upcoming[0]) return;
    const frame = requestAnimationFrame(() => setProjectId(upcoming[0]!.id));
    return () => cancelAnimationFrame(frame);
  }, [projectId, upcoming]);

  const project = projects?.find((item) => item.id === projectId);
  const schedule = [...(schedules ?? [])]
    .filter(
      (item) =>
        item.projectId === projectId &&
        text(item.status) === "published",
    )
    .sort((left, right) => Number(right.version) - Number(left.version))[0];
  const projectAssignments = (assignments ?? []).filter(
    (item) => item.projectId === projectId && item.status === "accepted",
  );
  const projectReadiness = (readiness ?? []).find(
    (item) => item.projectId === projectId,
  );
  const projectInsurance = (insurance ?? []).filter(
    (item) => item.projectId === projectId,
  );
  const items = list(schedule?.items).map(record);

  async function ask(nextQuestion = question) {
    if (!workspace.tenantId || !projectId) return;
    setBusy(true);
    setError(null);
    setQuestion(nextQuestion);
    try {
      setResult(
        await askCopilot({
          tenantId: workspace.tenantId,
          projectId,
          question: nextQuestion,
        }),
      );
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Copilot could not answer.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="event-day-copilot">
      <header className="event-day-hero">
        <div>
          <p className="eyebrow">Mobile event command</p>
          <h1>Event day, without the scavenger hunt</h1>
          <p>
            One read-only brief grounded in the published schedule, crew,
            readiness, insurance, and venue facts.
          </p>
        </div>
        <Sparkles aria-hidden="true" />
      </header>

      <label className="event-day-project-select">
        Event
        <select
          disabled={loading}
          onChange={(event) => {
            setProjectId(event.target.value);
            setResult(null);
          }}
          value={projectId}
        >
          <option value="">Select an upcoming project</option>
          {upcoming.map((item) => (
            <option key={item.id} value={item.id}>
              {text(item.eventDate)} · {text(item.name)}
            </option>
          ))}
        </select>
      </label>

      {project ? (
        <>
          <section className="event-day-facts">
            <article>
              <MapPin />
              <span><small>Venue</small><strong>{text(project.venueName) || "Pending"}</strong></span>
            </article>
            <article>
              <CalendarClock />
              <span><small>Schedule</small><strong>{schedule ? `Version ${Number(schedule.version ?? 0)}` : "Not published"}</strong></span>
            </article>
            <article>
              <UsersRound />
              <span><small>Accepted crew</small><strong>{projectAssignments.length}</strong></span>
            </article>
            <article>
              <ShieldCheck />
              <span><small>Readiness</small><strong>{Number(projectReadiness?.score ?? project.readinessScore ?? 0)}%</strong></span>
            </article>
          </section>

          {!projectInsurance.length ||
          projectInsurance.some((item) => item.status !== "sent_to_venue") ? (
            <div className="event-day-warning">
              <AlertTriangle />
              <span>
                <strong>Insurance still needs attention</strong>
                <small>Open the project record before relying on the certificate.</small>
              </span>
              <Link href={`/studio/insurance?project=${projectId}`}>Review</Link>
            </div>
          ) : null}

          <section className="panel event-day-timeline">
            <header>
              <span>
                <p className="eyebrow">Current published plan</p>
                <h2>Run of show</h2>
              </span>
              <Link href={`/studio/schedules?project=${projectId}`}>Full schedule</Link>
            </header>
            {items.map((item) => (
              <article key={text(item.id)}>
                <time>{time(item.startAt)}</time>
                <i />
                <span>
                  <strong>{text(item.title)}</strong>
                  <small>{text(item.location) || "Location pending"}</small>
                </span>
              </article>
            ))}
            {!items.length ? <p>No published schedule is available yet.</p> : null}
          </section>

          <section className="panel event-day-ask">
            <header>
              <BookOpenCheck />
              <span>
                <h2>Ask the event brief</h2>
                <p>Answers cite current project records and never alter them.</p>
              </span>
            </header>
            <div className="event-day-quick-questions">
              {quickQuestions.map((prompt) => (
                <button disabled={busy} key={prompt} onClick={() => void ask(prompt)} type="button">
                  {prompt}
                </button>
              ))}
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void ask();
              }}
            >
              <textarea
                minLength={3}
                onChange={(event) => setQuestion(event.target.value)}
                required
                value={question}
              />
              <button className="button button-dark" disabled={busy} type="submit">
                {busy ? <LoaderCircle className="spin" /> : <Send />}
                {busy ? "Checking records…" : "Ask StudioCue"}
              </button>
            </form>
            {error ? <p className="form-notice">{error}</p> : null}
            {result ? (
              <div className="event-day-answer" aria-live="polite">
                <strong>{result.answer}</strong>
                {result.facts.map((fact) => <p key={fact}>{fact}</p>)}
                <StatusBadge tone="info">Read-only answer</StatusBadge>
              </div>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}
