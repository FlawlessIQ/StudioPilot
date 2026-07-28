"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  ChevronRight,
  CircleCheck,
  Clock3,
  DatabaseZap,
  Inbox,
  LoaderCircle,
} from "lucide-react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
} from "firebase/firestore";
import { crmLeads, crmProjects } from "@/config/crm-demo-data";
import { demoProjects } from "@/config/demo-data";
import type { Role } from "@/features/auth/roles";
import { useWorkspace } from "@/features/auth/workspace-context";
import { getFirebaseClient } from "@/lib/firebase/client";
import { dataIsLive } from "@/lib/runtime-mode";
import { ReadinessMeter } from "@/components/ui/readiness-meter";
import { StatusBadge } from "@/components/ui/status-badge";
import { ClientPortalInvite } from "@/components/clients/client-portal-invite";
export type TenantDocument = Record<string, unknown> & { id: string };
async function tenantDocuments(
  collectionName: string,
  tenantId: string,
  role: Role | null,
  projectIds: string[],
): Promise<TenantDocument[]> {
  const { firestore } = getFirebaseClient();
  if (
    collectionName === "projects" &&
    role !== "studio_owner" &&
    role !== "studio_admin"
  ) {
    const documents = await Promise.all(
      projectIds.slice(0, 100).map((projectId) =>
        getDoc(doc(firestore, "projects", projectId)),
      ),
    );
    return documents
      .filter((document) => document.exists())
      .map(
        (document) =>
          ({ id: document.id, ...document.data() }) as TenantDocument,
      )
      .filter((document) => document.tenantId === tenantId);
  }
  const snapshot = await getDocs(
    query(
      collection(firestore, collectionName),
      where("tenantId", "==", tenantId),
      limit(100),
    ),
  );
  return snapshot.docs.map(
    (document) => ({ id: document.id, ...document.data() }) as TenantDocument,
  );
}

export function useTenantDocuments(collectionName: string) {
  const workspace = useWorkspace();
  const [records, setRecords] = useState<TenantDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!dataIsLive || workspace.loading) return;
    if (!workspace.tenantId) return;
    let active = true;
    void tenantDocuments(
      collectionName,
      workspace.tenantId,
      workspace.role,
      workspace.projectIds,
    )
      .then((value) => {
        if (active) setRecords(value);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setRecords([]);
        setError(
          caught instanceof Error
            ? caught.message
            : `The ${collectionName} could not be loaded.`,
        );
      });
    return () => {
      active = false;
    };
  }, [
    collectionName,
    workspace.error,
    workspace.loading,
    workspace.projectIds,
    workspace.role,
    workspace.tenantId,
  ]);
  return {
    records,
    error:
      error ??
      (!workspace.loading && !workspace.tenantId
        ? workspace.error ?? "No active studio was found."
        : null),
    loading:
      dataIsLive &&
      (workspace.loading || (workspace.tenantId !== null && records === null)),
  };
}

export function LiveClientCards({
  q,
  view,
}: {
  q: string;
  view: string;
}) {
  const { records, error, loading } = useTenantDocuments("contacts");
  const values = (records ?? []).filter((contact) => {
    const contactTypes = Array.isArray(contact.contactTypes)
      ? contact.contactTypes.map(String)
      : [];
    const archived = Boolean(contact.archivedAt);
    const matchesView =
      view === "archived"
        ? archived
        : view === "prospects"
          ? !archived && contactTypes.includes("prospect")
          : !archived && contactTypes.includes("client");
    return (
      matchesView &&
      String(contact.displayName ?? "")
        .toLowerCase()
        .includes(q.toLowerCase())
    );
  });
  if (loading)
    return (
      <LiveRecordsState
        kind="loading"
        state="Loading clients…"
        detail="Loading your client list."
      />
    );
  if (error)
    return (
      <LiveRecordsState
        kind="error"
        state="Clients could not be loaded"
        detail={error}
      />
    );
  if (!values.length)
    return (
      <LiveRecordsState
        kind="empty"
        state="No matching clients"
        detail="Add a client directly or convert an inquiry when you are ready to book."
        action={{ href: "/studio/clients/new", label: "Add client" }}
      />
    );
  return (
    <>
      {values.map((client) => {
        const name = String(client.displayName ?? "Client");
        const email =
          typeof client.email === "string" ? client.email : null;
        const projectCount = Array.isArray(client.projectIds)
          ? client.projectIds.length
          : 0;
        const projectIds = Array.isArray(client.projectIds)
          ? client.projectIds.filter(
              (value): value is string => typeof value === "string",
            )
          : [];
        return (
          <article key={client.id}>
            <div className="client-card-head">
              <span className="avatar avatar-sand">
                {name
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((part) => part.charAt(0))
                  .join("")}
              </span>
              <StatusBadge tone={client.portalUserId ? "success" : "neutral"}>
                {client.portalUserId ? "Portal active" : "Not invited"}
              </StatusBadge>
            </div>
            <h2>{name}</h2>
            <p>{email ?? "No email recorded"}</p>
            <dl>
              <div>
                <dt>Projects</dt>
                <dd>{projectCount}</dd>
              </div>
              <div>
                <dt>Company</dt>
                <dd>{String(client.company ?? "—")}</dd>
              </div>
            </dl>
            {email ? (
              <a href={`mailto:${email}`}>
                <ArrowUpRight size={15} /> Message client
              </a>
            ) : null}
            {!client.portalUserId && email ? (
              <ClientPortalInvite
                contactId={client.id}
                projectIds={projectIds}
              />
            ) : null}
          </article>
        );
      })}
    </>
  );
}

function LiveRecordsState({
  kind,
  state,
  detail,
  action,
}: {
  kind: "loading" | "error" | "empty";
  state: string;
  detail: string;
  action?: { href: string; label: string };
}) {
  const Icon =
    kind === "loading" ? LoaderCircle : kind === "error" ? DatabaseZap : Inbox;
  return (
    <div className={`live-record-state live-record-${kind}`} role="row">
      <Icon aria-hidden="true" size={18} />
      <span>
        <strong>{state}</strong>
        <small>{detail}</small>
      </span>
      {action ? (
        <Link className="live-state-action" href={action.href}>
          {action.label} <ArrowRight size={14} />
        </Link>
      ) : null}
    </div>
  );
}

export function LiveProjectRows({
  type,
  view,
}: {
  type: string;
  view: string;
}) {
  const { records, error, loading } = useTenantDocuments("projects");
  const values = records
    ? records
        .filter((item) =>
          view === "archived"
            ? item.state === "ARCHIVED"
            : item.state !== "ARCHIVED",
        )
        .filter(
          (item) =>
            type === "all" || String(item.eventType).toLowerCase() === type,
        )
        .map((item) => ({
          id: item.id,
          name: String(item.name),
          event: String(item.eventType),
          date: String(item.eventDate),
          venue: String(item.venueName ?? item.city ?? "Location pending"),
          state: String(item.state),
          readiness: Number(item.readinessScore ?? 0),
          nextAction: String(item.nextAction ?? "Review project readiness"),
          owner: "Assigned team",
        }))
    : view === "archived"
      ? []
      : crmProjects.filter(
          (project) => type === "all" || project.event.toLowerCase() === type,
        );
  if (loading) {
    return (
      <LiveRecordsState
        kind="loading"
        state="Loading projects…"
        detail="Reading records from your active studio."
      />
    );
  }
  if (error) {
    return (
      <LiveRecordsState
        kind="error"
        state="Projects could not be loaded"
        detail={error}
      />
    );
  }
  if (values.length === 0) {
    return (
      <LiveRecordsState
        kind="empty"
        state="No projects in this view"
        detail="Create your first project or change the active filters."
        action={{ href: "/studio/projects/new", label: "Create project" }}
      />
    );
  }
  return (
    <>
      {values.map((project) => (
        <article key={project.id}>
          <span className="crm-primary">
            <strong>{project.name}</strong>
            <small>
              {project.id} · {project.event}
            </small>
          </span>
          <span>
            <strong>{project.date}</strong>
            <small>{project.venue}</small>
          </span>
          <span>
            <StatusBadge
              tone={
                project.state === "READY"
                  ? "success"
                  : project.state === "CONTRACT_PENDING"
                    ? "warning"
                    : "info"
              }
            >
              {project.state.replaceAll("_", " ")}
            </StatusBadge>
          </span>
          <span className="readiness-cell">
            <ReadinessMeter value={project.readiness} size="sm" />
            <small>{project.readiness === 100 ? "Ready" : "Not ready"}</small>
          </span>
          <span>
            <strong>{project.nextAction}</strong>
            <small>{project.owner}</small>
          </span>
          <Link
            href={`/studio/projects/${project.id}`}
            aria-label={`Open ${project.name}`}
          >
            <ArrowRight size={16} />
          </Link>
        </article>
      ))}
    </>
  );
}
export function LiveLeadRows({ view, q }: { view: string; q: string }) {
  const { records, error, loading } = useTenantDocuments("leads");
  const values = records
    ? records
        .filter((item) =>
          view === "open"
            ? !["converted", "lost"].includes(String(item.status))
            : String(item.status) === view,
        )
        .filter((item) =>
          String(item.displayName ?? item.firstName ?? "")
            .toLowerCase()
            .includes(q.toLowerCase()),
        )
        .map((item) => ({
          id: item.id,
          name: String(
            item.displayName ??
              `${item.firstName ?? ""} ${item.lastName ?? ""}`,
          ),
          age: new Date(String(item.createdAt)).toLocaleDateString(),
          event: String(item.eventType ?? "Event"),
          date: String(item.eventDate ?? "Date pending"),
          venue: String(item.venue ?? item.city ?? "Venue pending"),
          source: String(item.referralSource ?? "Direct"),
          assigned: String(item.assignedUserId ?? "Unassigned"),
          status: String(item.status ?? "new"),
          missing: Array.isArray(item.missingFields)
            ? item.missingFields.length
            : 0,
        }))
    : view === "open"
      ? crmLeads.filter((lead) =>
          lead.name.toLowerCase().includes(q.toLowerCase()),
        )
      : [];
  if (loading) {
    return (
      <LiveRecordsState
        kind="loading"
        state="Loading leads…"
        detail="Loading your inquiries."
      />
    );
  }
  if (error) {
    return (
      <LiveRecordsState
        kind="error"
        state="Leads could not be loaded"
        detail={error}
      />
    );
  }
  if (values.length === 0) {
    return (
      <LiveRecordsState
        kind="empty"
        state="No inquiries in this view"
        detail="Share your studio inquiry form or change the active filter."
      />
    );
  }
  return (
    <>
      {values.map((lead) => (
        <article key={lead.id}>
          <span className="crm-primary">
            <strong>{lead.name}</strong>
            <small>
              {lead.id} · received {lead.age}
            </small>
          </span>
          <span>
            <strong>
              {lead.event} · {lead.date}
            </strong>
            <small>{lead.venue}</small>
          </span>
          <span>{lead.source}</span>
          <span>{lead.assigned}</span>
          <span>
            <StatusBadge
              tone={
                String(lead.status).toLowerCase() === "new" ? "info" : "warning"
              }
              dot
            >
              {lead.status}
            </StatusBadge>
            {lead.missing > 0 ? (
              <small>
                {lead.missing} detail{lead.missing > 1 ? "s" : ""} missing
              </small>
            ) : null}
          </span>
          <Link
            href={`/studio/leads/${lead.id}`}
            aria-label={`Open ${lead.name}`}
          >
            <ArrowUpRight size={16} />
          </Link>
        </article>
      ))}
    </>
  );
}
export function LiveUpcomingRows() {
  const { records: allRecords, error, loading } =
    useTenantDocuments("projects");
  const records = allRecords
    ? allRecords
        .filter(
          (item) =>
            !["ARCHIVED", "CANCELLED", "CLOSED"].includes(String(item.state)),
        )
        .sort((a, b) =>
          String(a.eventDate).localeCompare(String(b.eventDate)),
        )
        .slice(0, 5)
    : null;
  const values = records
    ? records.map((item, index) => ({
        id: item.id,
        client: String(item.name),
        event: String(item.eventType),
        date: String(item.eventDate),
        state: String(item.state),
        readiness: Number(item.readinessScore ?? 0),
        blocker: String(item.nextAction ?? "Review readiness"),
        owner: "Assigned team",
        tone: ["sand", "lilac", "blue", "green", "amber"][index % 5],
      }))
    : demoProjects;
  if (loading) {
    return (
      <LiveRecordsState
        kind="loading"
        state="Loading upcoming projects…"
        detail="Calculating your next operational priorities."
      />
    );
  }
  if (error) {
    return (
      <LiveRecordsState
        kind="error"
        state="Upcoming projects could not be loaded"
        detail={error}
      />
    );
  }
  if (values.length === 0) {
    return (
      <LiveRecordsState
        kind="empty"
        state="No upcoming projects"
        detail="Active projects will appear here in event-date order."
      />
    );
  }
  return (
    <>
      {values.map((project) => (
        <Link
          className="project-table-row"
          role="row"
          href={`/studio/projects/${project.id}`}
          key={project.id}
        >
          <span className="project-name" role="cell">
            <span className={`project-avatar avatar-${project.tone}`}>
              {project.client.charAt(0)}
            </span>
            <span>
              <strong>{project.client}</strong>
              <small>{project.event}</small>
            </span>
          </span>
          <time role="cell">{project.date}</time>
          <span role="cell">
            <StatusBadge
              tone={project.state === "READY" ? "success" : "neutral"}
              dot
            >
              {project.state.replaceAll("_", " ")}
            </StatusBadge>
          </span>
          <span className="readiness-cell" role="cell">
            <ReadinessMeter value={project.readiness} size="sm" />
            <strong>{project.readiness}%</strong>
          </span>
          <span className="blocker-cell" role="cell">
            {project.readiness === 100 ? (
              <CircleCheck size={16} className="text-success" />
            ) : (
              <Clock3 size={16} />
            )}
            <span>
              <strong>{project.blocker}</strong>
              <small>{project.owner}</small>
            </span>
            <ChevronRight size={16} />
          </span>
        </Link>
      ))}
    </>
  );
}
