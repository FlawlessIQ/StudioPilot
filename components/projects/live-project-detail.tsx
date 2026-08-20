"use client";

import { type FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  ClipboardCheck,
  FileCheck2,
  FolderKanban,
  LoaderCircle,
  MapPin,
  Send,
  Store,
  UserRound,
  UsersRound,
} from "lucide-react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { ProjectJourney } from "@/components/projects/project-journey";
import { useProjectJourney } from "@/components/projects/use-project-journey";
import { ReadinessMeter } from "@/components/ui/readiness-meter";
import { StatusBadge } from "@/components/ui/status-badge";
import { stateTone } from "@/lib/status-tone";
import { useWorkspace } from "@/features/auth/workspace-context";
import {
  allowedProjectTransitions,
  transitionAuthority,
} from "@/features/projects/state-machine";
import {
  projectStateSchema,
  type ProjectState,
} from "@/features/projects/schema";
import {
  projectLifecycleProjection,
  type LifecycleLaneKey,
  type LifecycleRecord,
} from "@/features/projects/lifecycle-projection";
import { runCrmCommand } from "@/lib/crm/command-client";
import { getFirebaseClient } from "@/lib/firebase/client";
import { dataIsLive } from "@/lib/runtime-mode";
import { runPublicScheduling } from "@/lib/booking/public-scheduling-client";
import { ProjectWorkspaceNav } from "@/components/projects/project-workspace-nav";
import { ProjectPreparedTray } from "@/components/projects/project-prepared-tray";
import { ProjectPlanningCopilot } from "@/components/projects/project-planning-copilot";
import { crmProjects } from "@/config/crm-demo-data";

type ProjectRecord = Record<string, unknown> & { id: string };
type CheckpointRecord = Record<string, unknown> & { id: string };
type RelatedRecords = {
  tasks: LifecycleRecord[];
  contracts: LifecycleRecord[];
  invoices: LifecycleRecord[];
  questionnaires: LifecycleRecord[];
  insurance: LifecycleRecord[];
  schedules: LifecycleRecord[];
  crewAssignments: LifecycleRecord[];
  automationRuns: LifecycleRecord[];
  aiActions: LifecycleRecord[];
  deliveries: LifecycleRecord[];
  reviewRequests: LifecycleRecord[];
};

const emptyRelatedRecords: RelatedRecords = {
  tasks: [],
  contracts: [],
  invoices: [],
  questionnaires: [],
  insurance: [],
  schedules: [],
  crewAssignments: [],
  automationRuns: [],
  aiActions: [],
  deliveries: [],
  reviewRequests: [],
};

const forwardStage: Partial<Record<ProjectState, ProjectState>> = {
  LEAD: "CONSULTATION",
  CONSULTATION: "PROPOSAL",
  PROPOSAL: "CONTRACT_PENDING",
  CONTRACT_PENDING: "RETAINER_PENDING",
  RETAINER_PENDING: "BOOKED",
  BOOKED: "PLANNING",
  PLANNING: "READY",
  READY: "EVENT_COMPLETE",
  EVENT_COMPLETE: "POST_PRODUCTION",
  POST_PRODUCTION: "DELIVERED",
  DELIVERED: "REVIEW_REQUESTED",
  REVIEW_REQUESTED: "CLOSED",
  CLOSED: "ARCHIVED",
};

function mockProject(projectId: string): ProjectRecord {
  const source =
    crmProjects.find((item) => item.id === projectId) ?? crmProjects[0]!;
  const eventDate = new Date(`${source.date} 12:00:00`);
  return {
    id: source.id,
    name: source.name,
    eventType: source.event,
    eventDate: Number.isNaN(eventDate.valueOf())
      ? source.date
      : eventDate.toISOString().slice(0, 10),
    venueName: source.venue,
    city: "New York",
    leadPhotographerName: source.owner,
    state: source.state,
    stateVersion: 4,
    readinessScore: source.readiness,
    nextAction: source.nextAction,
  };
}

function mockCheckpoints(projectId: string): CheckpointRecord[] {
  const project = mockProject(projectId);
  const eventDate = new Date(`${String(project.eventDate)}T12:00:00`);
  const dueDate = (daysBefore: number) => {
    const value = new Date(eventDate);
    value.setDate(value.getDate() - daysBefore);
    return value.toISOString().slice(0, 10);
  };
  return [
    {
      id: "checkpoint-questionnaire",
      name: "Client questionnaire complete",
      ownerType: "client",
      resolvedDueDate: dueDate(60),
      blocking: true,
      status: "complete",
    },
    {
      id: "checkpoint-schedule",
      name: "Final schedule approved",
      ownerType: "studio",
      resolvedDueDate: dueDate(14),
      blocking: true,
      status: project.state === "READY" ? "complete" : "in_progress",
    },
    {
      id: "checkpoint-crew",
      name: "Crew acknowledges current schedule",
      ownerType: "subcontractor",
      resolvedDueDate: dueDate(7),
      blocking: true,
      status: project.state === "READY" ? "complete" : "not_started",
    },
  ];
}

function stateLabel(state: ProjectState): string {
  return state
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^\w/, (value) => value.toUpperCase());
}

function displayDate(value: unknown): string {
  const source = String(value ?? "");
  const date = new Date(`${source}T12:00:00`);
  if (Number.isNaN(date.valueOf())) return source || "Date pending";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function projectAction(
  state: ProjectState,
  projectId: string,
): { href: string; label: string; detail: string; headline: string } {
  // The headline, label, and detail all derive from the live project state.
  // (The stored project.nextAction field is written at scattered moments and
  // goes stale — a signed project kept demanding the agreement it already had.)
  const routes: Record<
    ProjectState,
    { href: string; label: string; detail: string; headline: string }
  > = {
    LEAD: {
      href: `/studio/calendar?project=${projectId}`,
      label: "Schedule consultation",
      headline: "Complete lead review",
      detail: "Qualify the inquiry, then choose a time with the client.",
    },
    CONSULTATION: {
      href: `/studio/booking?project=${projectId}`,
      label: "Run booking autopilot",
      headline: "Turn the consultation into a proposal",
      detail:
        "Turn consultation notes into a cited brief, package fit, and unsent proposal draft.",
    },
    PROPOSAL: {
      href: `/studio/proposals?project=${projectId}`,
      label: "Review proposal",
      headline: "Get the proposal to the client",
      detail: "Confirm pricing, expiration, and acceptance before contracting.",
    },
    CONTRACT_PENDING: {
      href: `/studio/contracts?project=${projectId}`,
      label: "Open contract",
      headline: "Prepare and send the photography agreement",
      detail: "Track the authoritative signing request and signer status.",
    },
    RETAINER_PENDING: {
      href: `/studio/contracts?project=${projectId}`,
      label: "Check retainer status",
      headline: "Collect the retainer",
      detail: "Confirm the QuickBooks retainer evidence before booking.",
    },
    BOOKED: {
      href: `/studio/vendors?project=${projectId}`,
      label: "Begin planning",
      headline: "Start planning the event",
      detail: "Collect the people, locations, and requirements behind the event.",
    },
    PLANNING: {
      href: `/studio/readiness?project=${projectId}`,
      label: "Review readiness",
      headline: "Close out the readiness blockers",
      detail: "Resolve blocking checkpoints before moving the project to Ready.",
    },
    READY: {
      href: `/studio/schedules?project=${projectId}`,
      label: "Open final schedule",
      headline: "Confirm the final run of show",
      detail: "Confirm the published version and every crew acknowledgement.",
    },
    EVENT_COMPLETE: {
      href: `/studio/post-production?project=${projectId}`,
      label: "Start post-production",
      headline: "Protect the files, then start editing",
      detail: "Record protected backup before culling and editing begin.",
    },
    POST_PRODUCTION: {
      href: `/studio/delivery?project=${projectId}`,
      label: "Review delivery",
      headline: "Get the gallery to the client",
      detail: "Track the approved gallery and client delivery evidence.",
    },
    DELIVERED: {
      href: `/studio/reviews?project=${projectId}`,
      label: "Manage review request",
      headline: "Ask for the review",
      detail: "Invite feedback without claiming a review was posted.",
    },
    REVIEW_REQUESTED: {
      href: `/studio/post-production?project=${projectId}`,
      label: "Review closeout",
      headline: "Close the project out",
      detail: "Confirm every closeout requirement before closing the project.",
    },
    CLOSED: {
      href: `/studio/delivery?project=${projectId}`,
      label: "View delivery record",
      headline: "This project is complete",
      detail: "Keep the completed project accessible until it is archived.",
    },
    CANCELLED: {
      href: `/studio/tasks/new?project=${projectId}`,
      label: "Add follow-up task",
      headline: "Wrap up the cancellation",
      detail: "Record any remaining client, financial, or archival work.",
    },
    POSTPONED: {
      href: `/studio/calendar?project=${projectId}`,
      label: "Review new date",
      headline: "Rebuild around the new date",
      detail: "Reconfirm availability and rebuild every date-relative task.",
    },
    ARCHIVED: {
      href: `/studio/documents?project=${projectId}`,
      label: "View project files",
      headline: "This project is archived",
      detail: "Review retained project evidence without reopening the workflow.",
    },
  };
  return routes[state];
}

function ProjectStageControl({
  projectId,
  state,
  stateVersion,
  onTransition,
}: {
  projectId: string;
  state: ProjectState;
  stateVersion: number;
  onTransition: (state: ProjectState, version: number) => void;
}) {
  const target = forwardStage[state];
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  if (
    !target ||
    !allowedProjectTransitions[state].includes(target) ||
    transitionAuthority(state, target)
  ) {
    return null;
  }
  const nextStage = target;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const response = await runCrmCommand("transitionProject", {
        projectId,
        expectedVersion: stateVersion,
        targetState: nextStage,
      });
      if (response.persisted) {
        const version = Number(response.result.stateVersion ?? stateVersion + 1);
        onTransition(nextStage, version);
        setNotice(`Project moved to ${stateLabel(nextStage)}.`);
      } else {
        setNotice(
          `Development preview: the project would move to ${stateLabel(nextStage)}.`,
        );
      }
    } catch (caught: unknown) {
      setNotice(
        caught instanceof Error
          ? caught.message.replaceAll("_", " ")
          : "The project stage could not be changed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    // Open by default: collapsed, this was the only way to advance a stage
    // by hand and users could not find it.
    <details className="project-stage-control" open>
      <summary>Move this project forward</summary>
      <form onSubmit={(event) => void submit(event)}>
        <span>
          <small>Current stage</small>
          <strong>{stateLabel(state)}</strong>
        </span>
        <ArrowRight aria-hidden="true" size={16} />
        <span>
          <small>Next stage</small>
          <strong>{stateLabel(nextStage)}</strong>
        </span>
        <p>
          Use this when the step happened outside StudioCue — for example a
          consultation handled over the phone. The change is recorded in the
          audit log.
        </p>
        <button className="button button-light-on-dark" disabled={busy} type="submit">
          {busy ? "Updating…" : `Confirm ${stateLabel(nextStage)}`}
        </button>
        {notice ? <p className="project-stage-notice" role="status">{notice}</p> : null}
      </form>
    </details>
  );
}

function ConsultationInviteAction({
  projectId,
  contactId,
}: {
  projectId: string;
  contactId: string;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  async function send() {
    setBusy(true);
    setNotice(null);
    try {
      await runPublicScheduling({
        type: "create_link",
        idempotencyKey: crypto.randomUUID(),
        input: { projectId, contactId, mode: "zoom" },
      });
      setNotice("Scheduling invitation queued for delivery.");
    } catch (caught: unknown) {
      setNotice(
        caught instanceof Error
          ? caught.message.replaceAll("_", " ")
          : "Scheduling invitation could not be sent.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="project-consultation-invite">
      <button
        className="button project-action-secondary"
        disabled={busy}
        onClick={() => void send()}
        type="button"
      >
        {busy ? "Sending…" : "Invite client to choose a time"}
      </button>
      {notice ? <small role="status">{notice}</small> : null}
    </div>
  );
}

function checkpointTone(status: string) {
  if (["complete", "waived"].includes(status)) return "success" as const;
  if (["failed"].includes(status)) return "danger" as const;
  if (["under_review", "in_progress"].includes(status)) return "info" as const;
  return "warning" as const;
}

const laneDetails: Record<
  LifecycleLaneKey,
  { title: string; icon: typeof Bot; empty: string }
> = {
  studiocue: {
    title: "StudioCue is doing",
    icon: Bot,
    empty: "No background work is running.",
  },
  studio: {
    title: "Studio needs",
    icon: Store,
    empty: "Nothing needs studio attention.",
  },
  client: {
    title: "Client needs",
    icon: UserRound,
    empty: "Nothing is waiting on the client.",
  },
  crew: {
    title: "Crew needs",
    icon: UsersRound,
    empty: "Nothing is waiting on crew.",
  },
};

function ProjectLifecycleLanes({
  project,
  checkpoints,
  related,
}: {
  project: ProjectRecord;
  checkpoints: CheckpointRecord[];
  related: RelatedRecords;
}) {
  const projection = projectLifecycleProjection({
    project,
    checkpoints,
    ...related,
  });
  return (
    <section className="project-lifecycle-cockpit" id="project-checkpoints">
      <header>
        <div>
          <p className="eyebrow">One operational truth</p>
          <h2>Who needs to do what next</h2>
          <p>
            {projection.primaryBlocker
              ? `Main blocker: ${projection.primaryBlocker}`
              : `No hard blocker. Next action belongs to ${projection.nextAction.owner.toLowerCase()}.`}
          </p>
        </div>
      </header>
      <div className="project-work-lanes">
        {(Object.keys(laneDetails) as LifecycleLaneKey[]).filter((laneKey) => projection.lanes[laneKey].length).map((laneKey) => {
          const detail = laneDetails[laneKey];
          const Icon = detail.icon;
          const values = projection.lanes[laneKey];
          return (
            <section className={`project-work-lane lane-${laneKey}`} key={laneKey}>
              <h3>
                <span><Icon size={15} /></span>
                {detail.title}
                <em>{values.length}</em>
              </h3>
              <div>
                {values.slice(0, 5).map((work) => (
                  <Link href={work.href} key={work.id}>
                    <span className={`work-state is-${work.status}`} />
                    <span>
                      <strong>{work.label}</strong>
                      <small>{work.detail}</small>
                      <em>
                        {work.dueAt
                          ? `Due ${displayDate(work.dueAt.slice(0, 10))}`
                          : work.evidence
                            ? `Evidence ${work.evidence.slice(0, 12)}`
                            : work.status}
                      </em>
                    </span>
                    <ArrowRight size={14} />
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
        {(Object.keys(laneDetails) as LifecycleLaneKey[]).every((laneKey) => !projection.lanes[laneKey].length) ? (
          <p className="project-work-caught-up"><CheckCircle2 size={16} /> No one is waiting on work for this project.</p>
        ) : null}
      </div>
    </section>
  );
}

export function LiveProjectDetail({ projectId }: { projectId: string }) {
  const workspace = useWorkspace();
  const [project, setProject] = useState<ProjectRecord | null>(
    dataIsLive ? null : mockProject(projectId),
  );
  const [checkpoints, setCheckpoints] = useState<CheckpointRecord[]>(
    dataIsLive ? [] : mockCheckpoints(projectId),
  );
  const [related, setRelated] = useState<RelatedRecords>(emptyRelatedRecords);
  const [error, setError] = useState<string | null>(null);
  // One derivation of the project's position, shared by the journey panel
  // and the recommended-move card so they can never disagree.
  const journey = useProjectJourney({
    projectId,
    projectState: String(project?.state ?? "LEAD"),
    eventDate:
      typeof project?.eventDate === "string" ? project.eventDate : null,
    leadId: typeof project?.leadId === "string" ? project.leadId : null,
  });

  useEffect(() => {
    if (!dataIsLive || workspace.loading || !workspace.tenantId) return;
    let active = true;
    const { firestore } = getFirebaseClient();
    const relatedCollections: Array<{
      key: keyof RelatedRecords;
      collectionName: string;
    }> = [
      { key: "tasks", collectionName: "tasks" },
      { key: "contracts", collectionName: "contracts" },
      { key: "invoices", collectionName: "invoiceReferences" },
      { key: "questionnaires", collectionName: "questionnaireResponses" },
      { key: "insurance", collectionName: "insuranceRequests" },
      { key: "schedules", collectionName: "schedules" },
      { key: "crewAssignments", collectionName: "crewAssignments" },
      { key: "automationRuns", collectionName: "automationRuns" },
      { key: "aiActions", collectionName: "aiActions" },
      { key: "deliveries", collectionName: "deliveries" },
      { key: "reviewRequests", collectionName: "reviewRequests" },
    ];
    void Promise.all([
      getDoc(doc(firestore, "projects", projectId)),
      getDocs(
        query(
          collection(firestore, "checkpoints"),
          where("tenantId", "==", workspace.tenantId),
          where("projectId", "==", projectId),
        ),
      ),
      Promise.allSettled(
        relatedCollections.map(({ collectionName }) =>
          getDocs(
            query(
              collection(firestore, collectionName),
              where("tenantId", "==", workspace.tenantId),
              where("projectId", "==", projectId),
            ),
          ),
        ),
      ),
    ])
      .then(([projectSnapshot, checkpointSnapshot, relatedSnapshots]) => {
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
        setRelated(
          relatedCollections.reduce<RelatedRecords>(
            (records, definition, index) => {
              const outcome = relatedSnapshots[index];
              records[definition.key] =
                outcome?.status === "fulfilled"
                  ? outcome.value.docs.map((document) => ({
                      id: document.id,
                      ...document.data(),
                    }))
                  : [];
              return records;
            },
            { ...emptyRelatedRecords },
          ),
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
          <small>Checking your access and loading project details.</small>
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

  const parsedState = projectStateSchema.safeParse(project.state);
  const state: ProjectState = parsedState.success ? parsedState.data : "LEAD";
  const readiness = Number(project.readinessScore ?? 0);
  // The checkpoints that are both required and unfinished — i.e. the missing
  // percentage, in words.
  const outstanding = checkpoints
    .filter(
      (checkpoint) =>
        checkpoint.blocking === true &&
        !["complete", "completed", "waived"].includes(
          String(checkpoint.status ?? ""),
        ),
    )
    .map((checkpoint) => String(checkpoint.name ?? "Unnamed checkpoint"));
  const action = projectAction(state, projectId);
  const current = journey.current;
  const onTransition = (nextState: string, version: number) =>
    setProject((value) =>
      value ? { ...value, state: nextState, stateVersion: version } : value,
    );
  return (
    <div className="project-detail-page">
      <Link className="back-link" href="/studio/projects">
        <ArrowLeft size={15} /> All projects
      </Link>
      <header className="project-detail-header">
        <div>
          <p className="eyebrow">Project command center</p>
          <div className="project-title-line">
            <h1>{String(project.name)}</h1>
            <StatusBadge tone={stateTone(state)} dot>
              {stateLabel(state)}
            </StatusBadge>
          </div>
          <p>
            {String(project.eventType)} photography ·{" "}
            {displayDate(project.eventDate)}
          </p>
        </div>
        <div className="project-readiness-summary">
          <span>
            <small>Event readiness</small>
            <strong>{readiness}%</strong>
            {/* A bare percentage says nothing about the gap. Name what the
                remainder actually is, and point at the list that holds it. */}
            {outstanding.length ? (
              <a className="project-readiness-gap" href="#project-checkpoints">
                {outstanding.length} blocker{outstanding.length === 1 ? "" : "s"}:{" "}
                {outstanding[0]}
                {outstanding.length > 1 ? ` +${outstanding.length - 1} more` : ""}
              </a>
            ) : checkpoints.length === 0 ? (
              // With no checkpoints yet, "0% and nothing blocking" reads as a
              // contradiction. Say what is actually true instead.
              <small className="project-readiness-clear">
                Readiness tracking starts once planning begins.
              </small>
            ) : (
              <small className="project-readiness-clear">
                Nothing blocking — every required checkpoint is complete.
              </small>
            )}
          </span>
          <ReadinessMeter value={readiness} size="lg" />
        </div>
      </header>
      <ProjectWorkspaceNav projectId={projectId} />
      <div className="project-facts">
        <span>
          <CalendarDays size={17} />
          <small>Event date</small>
          <strong>{displayDate(project.eventDate)}</strong>
        </span>
        <span>
          <MapPin size={17} />
          <small>Venue</small>
          <strong>{String(project.venueName ?? project.city ?? "Pending")}</strong>
        </span>
        <span>
          <UserRound size={17} />
          <small>Lead photographer</small>
          <strong>{String(project.leadPhotographerName ?? "Unassigned")}</strong>
        </span>
      </div>
      <div className="project-detail-grid">
        <ProjectJourney
          current={journey.current}
          onTransition={onTransition}
          projectId={projectId}
          stateVersion={Number(project.stateVersion ?? 0)}
          steps={journey.steps}
        />
        <aside className="next-action-card">
          <p className="eyebrow">Recommended next move</p>
          <span className="next-action-icon"><CircleAlert size={21} /></span>
          {/* Same derivation as the journey's current step — never a second
              opinion. The state map only covers post-journey states. */}
          <h2>{current ? current.title : action.headline}</h2>
          <p>{current ? current.detail : action.detail}</p>
          <div className="project-next-actions">
            {current?.action?.kind === "link" ? (
              <Link
                className="button button-light-on-dark"
                href={current.action.href}
              >
                {current.action.label} <ArrowRight size={15} />
              </Link>
            ) : !current ? (
              <Link className="button button-light-on-dark" href={action.href}>
                {action.label} <ArrowRight size={15} />
              </Link>
            ) : null}
            <Link className="button project-action-secondary" href={`/studio/tasks/new?project=${projectId}`}>
              Add a task
            </Link>
          </div>
          {state === "LEAD" &&
          Array.isArray(project.clientContactIds) &&
          typeof project.clientContactIds[0] === "string" ? (
            <ConsultationInviteAction
              contactId={project.clientContactIds[0]}
              projectId={projectId}
            />
          ) : null}
          <ProjectStageControl
            onTransition={onTransition}
            projectId={projectId}
            state={state}
            stateVersion={Number(project.stateVersion ?? 0)}
          />
        </aside>
      </div>
      <section className="project-now-next" aria-label="Project work summary">
        <ProjectLifecycleLanes
          checkpoints={checkpoints}
          project={project}
          related={related}
        />
        <ProjectPreparedTray projectId={projectId} />
      </section>
      <details className="project-detail-disclosure">
        <summary>
          <span>
            <small>Coming next</small>
            <strong>Planning automation and readiness details</strong>
          </span>
          <em>{readiness}% ready</em>
        </summary>
        <div className="project-detail-disclosure-body">
          <ProjectPlanningCopilot
            insurance={related.insurance}
            invoices={related.invoices}
            projectId={projectId}
            questionnaires={related.questionnaires}
            schedules={related.schedules}
          />
          <section className="panel project-checkpoints-panel">
            <div className="panel-heading">
              <div>
                <h2>Readiness checkpoints</h2>
                <p>Requirements that must be completed before the event.</p>
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
                    <span className={status === "complete" ? "checkpoint-state complete" : "checkpoint-state"}>
                      {status === "complete" ? <CheckCircle2 size={15} /> : <i />}
                    </span>
                    <span>
                      <strong>{String(checkpoint.name)}</strong>
                      <small>{String(checkpoint.ownerType)} · {String(checkpoint.resolvedDueDate ?? "No due date")}</small>
                    </span>
                    <StatusBadge tone={checkpoint.blocking ? "warning" : "neutral"}>
                      {checkpoint.blocking ? "Affects readiness" : "Non-blocking"}
                    </StatusBadge>
                    <StatusBadge tone={checkpointTone(status)}>{status.replaceAll("_", " ")}</StatusBadge>
                  </article>
                );
              })}
              {!checkpoints.length ? (
                <div className="live-record-state">
                  <span><strong>No readiness steps yet</strong><small>They will appear when a workflow starts for this project.</small></span>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </details>
    </div>
  );
}
