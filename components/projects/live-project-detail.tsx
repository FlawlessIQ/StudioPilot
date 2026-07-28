"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  LoaderCircle,
  MapPin,
  UserRound,
} from "lucide-react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { ReadinessMeter } from "@/components/ui/readiness-meter";
import { StatusBadge } from "@/components/ui/status-badge";
import { useWorkspace } from "@/features/auth/workspace-context";
import { getFirebaseClient } from "@/lib/firebase/client";

type ProjectRecord = Record<string, unknown> & { id: string };
type CheckpointRecord = Record<string, unknown> & { id: string };

const states = [
  "LEAD",
  "CONSULTATION",
  "PROPOSAL",
  "CONTRACT_PENDING",
  "RETAINER_PENDING",
  "BOOKED",
  "PLANNING",
  "READY",
  "EVENT_COMPLETE",
  "POST_PRODUCTION",
  "DELIVERED",
  "REVIEW_REQUESTED",
  "CLOSED",
];

function checkpointTone(status: string) {
  if (["complete", "waived"].includes(status)) return "success" as const;
  if (["failed"].includes(status)) return "danger" as const;
  if (["under_review", "in_progress"].includes(status)) return "info" as const;
  return "warning" as const;
}

export function LiveProjectDetail({ projectId }: { projectId: string }) {
  const workspace = useWorkspace();
  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [checkpoints, setCheckpoints] = useState<CheckpointRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (workspace.loading || !workspace.tenantId) return;
    let active = true;
    const { firestore } = getFirebaseClient();
    void Promise.all([
      getDoc(doc(firestore, "projects", projectId)),
      getDocs(
        query(
          collection(firestore, "checkpoints"),
          where("tenantId", "==", workspace.tenantId),
          where("projectId", "==", projectId),
        ),
      ),
    ])
      .then(([projectSnapshot, checkpointSnapshot]) => {
        if (!active) return;
        if (
          !projectSnapshot.exists() ||
          projectSnapshot.get("tenantId") !== workspace.tenantId
        ) {
          throw new Error("Project not found in this workspace.");
        }
        setProject({
          id: projectSnapshot.id,
          ...projectSnapshot.data(),
        });
        setCheckpoints(
          checkpointSnapshot.docs.map((checkpoint) => ({
            id: checkpoint.id,
            ...checkpoint.data(),
          })),
        );
      })
      .catch((caught: unknown) => {
        if (active)
          setError(
            caught instanceof Error ? caught.message : "Project could not be loaded.",
          );
      });
    return () => {
      active = false;
    };
  }, [projectId, workspace.loading, workspace.tenantId]);

  if (workspace.loading || (!project && !error))
    return (
      <section className="panel live-domain-state">
        <LoaderCircle className="spin" />
        <span>
          <strong>Loading project…</strong>
          <small>Resolving your tenant and project access.</small>
        </span>
      </section>
    );
  if (error || !project)
    return (
      <section className="panel live-domain-state live-domain-error">
        <CircleAlert />
        <span>
          <strong>Project unavailable</strong>
          <small>{error ?? "The project does not exist."}</small>
        </span>
      </section>
    );

  const state = String(project.state);
  const stateIndex = states.indexOf(state);
  const readiness = Number(project.readinessScore ?? 0);
  return (
    <div className="project-detail-page">
      <Link className="back-link" href="/studio/projects">
        <ArrowLeft size={15} /> All projects
      </Link>
      <header className="project-detail-header">
        <div>
          <div className="project-title-line">
            <h1>{String(project.name)}</h1>
            <StatusBadge tone={state === "READY" ? "success" : "info"} dot>
              {state.replaceAll("_", " ")}
            </StatusBadge>
          </div>
          <p>
            {project.id} · {String(project.eventType)}
          </p>
        </div>
        <ReadinessMeter value={readiness} size="lg" />
      </header>
      <div className="project-facts">
        <span>
          <CalendarDays size={17} />
          <small>Event date</small>
          <strong>{String(project.eventDate)}</strong>
        </span>
        <span>
          <MapPin size={17} />
          <small>Venue</small>
          <strong>{String(project.venueName ?? project.city ?? "Pending")}</strong>
        </span>
        <span>
          <UserRound size={17} />
          <small>Lead photographer</small>
          <strong>{String(project.leadPhotographerId ?? "Unassigned")}</strong>
        </span>
      </div>
      <div className="project-detail-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Project lifecycle</h2>
              <p>Transitions follow explicit state rules</p>
            </div>
          </div>
          <div className="state-timeline">
            {states.slice(0, 8).map((candidate, index) => (
              <span className={index <= stateIndex ? "complete" : ""} key={candidate}>
                <i>
                  {index < stateIndex ? <CheckCircle2 size={14} /> : index + 1}
                </i>
                <small>{candidate.replaceAll("_", " ")}</small>
              </span>
            ))}
          </div>
        </section>
        <aside className="next-action-card">
          <p className="eyebrow">Next action</p>
          <CircleAlert size={21} />
          <h2>{String(project.nextAction ?? "Review project readiness")}</h2>
          <p>
            This recommendation is derived from persisted project and checkpoint
            state.
          </p>
          <Link className="button button-light" href="/studio/readiness">
            Open readiness
          </Link>
        </aside>
      </div>
      <section className="panel project-checkpoints-panel">
        <div className="panel-heading">
          <div>
            <h2>Readiness checkpoints</h2>
            <p>Deterministic requirements and evidence</p>
          </div>
          <StatusBadge tone={readiness === 100 ? "success" : "warning"}>
            {readiness}% ready
          </StatusBadge>
        </div>
        <div className="project-checkpoint-list">
          {checkpoints.map((checkpoint) => {
            const status = String(checkpoint.status);
            return (
              <article key={checkpoint.id}>
                <span
                  className={
                    status === "complete"
                      ? "checkpoint-state complete"
                      : "checkpoint-state"
                  }
                >
                  {status === "complete" ? <CheckCircle2 size={15} /> : <i />}
                </span>
                <span>
                  <strong>{String(checkpoint.name)}</strong>
                  <small>
                    {String(checkpoint.ownerType)} ·{" "}
                    {String(checkpoint.resolvedDueDate ?? "No due date")}
                  </small>
                </span>
                <StatusBadge tone={checkpoint.blocking ? "warning" : "neutral"}>
                  {checkpoint.blocking ? "Affects readiness" : "Non-blocking"}
                </StatusBadge>
                <StatusBadge tone={checkpointTone(status)}>
                  {status.replaceAll("_", " ")}
                </StatusBadge>
              </article>
            );
          })}
          {!checkpoints.length ? (
            <div className="live-record-state">
              <span>
                <strong>No checkpoints instantiated</strong>
                <small>
                  Booking or workflow activation will create project checkpoints.
                </small>
              </span>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
