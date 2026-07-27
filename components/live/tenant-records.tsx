"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  ChevronRight,
  CircleCheck,
  Clock3,
} from "lucide-react";
import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { crmLeads, crmProjects } from "@/config/crm-demo-data";
import { demoProjects } from "@/config/demo-data";
import { getFirebaseClient } from "@/lib/firebase/client";
import { dataIsLive } from "@/lib/runtime-mode";
import { ReadinessMeter } from "@/components/ui/readiness-meter";
import { StatusBadge } from "@/components/ui/status-badge";
type Document = Record<string, unknown> & { id: string };
async function tenantDocuments(collectionName: string): Promise<Document[]> {
  const { auth, firestore } = getFirebaseClient();
  const user = auth.currentUser;
  if (!user) return [];
  const memberships = await getDocs(
    query(
      collection(firestore, "memberships"),
      where("userId", "==", user.uid),
      where("status", "==", "active"),
      limit(1),
    ),
  );
  const tenantId = memberships.docs[0]?.data().tenantId;
  if (typeof tenantId !== "string") return [];
  const snapshot = await getDocs(
    query(
      collection(firestore, collectionName),
      where("tenantId", "==", tenantId),
      limit(100),
    ),
  );
  return snapshot.docs.map(
    (document) => ({ id: document.id, ...document.data() }) as Document,
  );
}
export function LiveProjectRows({
  type,
  view,
}: {
  type: string;
  view: string;
}) {
  const [records, setRecords] = useState<Document[] | null>(null);
  useEffect(() => {
    if (!dataIsLive) return;
    let active = true;
    void tenantDocuments("projects").then((value) => {
      if (active) setRecords(value);
    });
    return () => {
      active = false;
    };
  }, []);
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
  const [records, setRecords] = useState<Document[] | null>(null);
  useEffect(() => {
    if (!dataIsLive) return;
    let active = true;
    void tenantDocuments("leads").then((value) => {
      if (active) setRecords(value);
    });
    return () => {
      active = false;
    };
  }, []);
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
  const [records, setRecords] = useState<Document[] | null>(null);
  useEffect(() => {
    if (!dataIsLive) return;
    let active = true;
    void tenantDocuments("projects").then((value) => {
      if (active)
        setRecords(
          value
            .filter(
              (item) =>
                !["ARCHIVED", "CANCELLED", "CLOSED"].includes(
                  String(item.state),
                ),
            )
            .sort((a, b) =>
              String(a.eventDate).localeCompare(String(b.eventDate)),
            )
            .slice(0, 5),
        );
    });
    return () => {
      active = false;
    };
  }, []);
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
