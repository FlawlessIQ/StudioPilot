"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, DatabaseZap, LoaderCircle, ShieldCheck } from "lucide-react";
import { doc, getDoc } from "firebase/firestore";
import { StatusBadge } from "@/components/ui/status-badge";
import { useWorkspace } from "@/features/auth/workspace-context";
import { getFirebaseClient } from "@/lib/firebase/client";

type RecordValue = Record<string, unknown> & { id: string };
type DetailKind = "proposal" | "schedule" | "crew" | "post-production" | "workflow";
const config: Record<
  DetailKind,
  {
    collections: string[];
    back: string;
    backLabel: string;
    label: string;
    description: string;
    active: string;
    titleFields: string[];
    statusFields: string[];
    facts: Array<[string, string[]]>;
    boundary: string;
  }
> = {
  proposal: {
    collections: ["proposals"],
    back: "/studio/proposals",
    backLabel: "proposals",
    label: "Proposal",
    description: "A preserved version of the offer shared with this client.",
    active: "Proposals",
    titleFields: ["projectName", "clientSnapshot.primaryName", "id"],
    statusFields: ["status"],
    facts: [
      ["Version", ["version"]],
      ["Package", ["pricingSnapshot.packageName", "packageSnapshot.name"]],
      ["Total", ["pricingSnapshot.totalCents", "totalCents"]],
      ["Expires", ["expiresAt"]],
      ["Sent", ["sentAt"]],
      ["Accepted", ["acceptedAt"]],
    ],
    boundary:
      "This version and its pricing snapshot are immutable. Proposal acceptance does not mark a contract signed.",
  },
  schedule: {
    collections: ["schedules"],
    back: "/studio/schedules",
    backLabel: "schedules",
    label: "Schedule",
    description: "The current event-day plan and its approval history.",
    active: "Schedules",
    titleFields: ["projectName", "id"],
    statusFields: ["status", "approvalState"],
    facts: [
      ["Version", ["version"]],
      ["Timezone", ["timezone"]],
      ["Published", ["publishedAt"]],
      ["Approved", ["approvedAt"]],
      ["Approved by", ["approvedBy"]],
      ["Items", ["items"]],
    ],
    boundary:
      "Published versions remain preserved. Human approval and renewed crew acknowledgement are tracked independently.",
  },
  crew: {
    collections: ["crewAssignments", "crewProfiles"],
    back: "/studio/crew",
    backLabel: "crew",
    label: "Crew record",
    description: "Assignment details, requirements, and acknowledgement status.",
    active: "Crew",
    titleFields: ["projectName", "name", "role", "id"],
    statusFields: ["status", "active"],
    facts: [
      ["Role", ["role"]],
      ["Email", ["email"]],
      ["Arrival", ["arrivalAt"]],
      ["Departure", ["departureAt"]],
      ["Calendar", ["calendarStatus"]],
      ["Schedule version", ["currentScheduleVersion"]],
      ["Requirements", ["requirements"]],
      ["Specialties", ["specialties"]],
      ["Service areas", ["serviceAreas"]],
      ["W-9", ["w9Status"]],
      ["Insurance", ["insuranceStatus"]],
    ],
    boundary:
      "Crew access is project-scoped. Client finances and unrelated projects are never included in the crew portal.",
  },
  "post-production": {
    collections: ["postProductionRecords"],
    back: "/studio/post-production",
    backLabel: "post-production",
    label: "Post-production",
    description: "Editing, delivery, and closeout progress for this project.",
    active: "Post-production",
    titleFields: ["projectName", "id"],
    statusFields: ["currentStep"],
    facts: [
      ["Current step", ["currentStep"]],
      ["Target delivery", ["targetDeliveryDate"]],
      ["Updated", ["updatedAt"]],
      ["Project", ["projectId"]],
      ["Steps", ["steps"]],
    ],
    boundary:
      "Closeout remains deterministic: delivery, download, financial, crew, and review evidence must be resolved.",
  },
  workflow: {
    collections: ["workflowTemplates"],
    back: "/studio/workflows",
    backLabel: "workflows",
    label: "Workflow",
    description: "The reusable steps and automations in this workflow version.",
    active: "Workflows",
    titleFields: ["name", "id"],
    statusFields: ["status"],
    facts: [
      ["Version", ["version"]],
      ["Event type", ["eventTypeId"]],
      ["Checkpoints", ["checkpoints"]],
      ["Automations", ["automations"]],
      ["Created", ["createdAt"]],
      ["Updated", ["updatedAt"]],
    ],
    boundary:
      "Published workflow versions are immutable for active runs unless an authorized migration is explicitly executed.",
  },
};

function nested(value: RecordValue, fields: string[]) {
  for (const field of fields) {
    let current: unknown = value;
    for (const segment of field.split("."))
      current =
        current && typeof current === "object"
          ? (current as Record<string, unknown>)[segment]
          : null;
    if (current !== null && current !== undefined && current !== "")
      return current;
  }
  return null;
}
function show(value: unknown, label: string) {
  if (value === null || value === undefined) return "—";
  if (label === "Total" && typeof value === "number")
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(value / 100);
  if (Array.isArray(value)) return `${value.length}`;
  if (typeof value === "object")
    return `${Object.keys(value as Record<string, unknown>).length} tracked`;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (/At$|Created|Updated|Expires|Published|Approved|Arrival|Departure|delivery/i.test(label)) {
    const date = new Date(String(value));
    if (!Number.isNaN(date.valueOf())) return date.toLocaleString();
  }
  return String(value).replaceAll("_", " ");
}

export function LiveRecordDetail({
  id,
  kind,
}: {
  id: string;
  kind: DetailKind;
}) {
  const workspace = useWorkspace();
  const selected = config[kind];
  const [record, setRecord] = useState<RecordValue | null | undefined>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (workspace.loading) return;
    let active = true;
    const load = async () => {
      const { firestore } = getFirebaseClient();
      for (const collectionName of selected.collections) {
        const snapshot = await getDoc(doc(firestore, collectionName, id));
        if (snapshot.exists()) {
          const value = { id: snapshot.id, ...snapshot.data() } as RecordValue;
          if (value.tenantId !== workspace.tenantId)
            throw new Error("This record is outside the active studio.");
          if (typeof value.projectId === "string") {
            const project = await getDoc(doc(firestore, "projects", value.projectId));
            if (project.exists()) value.projectName = project.get("name");
          }
          return value;
        }
      }
      return null;
    };
    void load()
      .then((value) => active && setRecord(value))
      .catch((caught: unknown) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "Record could not be loaded.");
        setRecord(null);
      });
    return () => {
      active = false;
    };
  }, [id, selected, workspace.loading, workspace.tenantId]);
  if (record === undefined)
    return <div className="live-domain-state"><LoaderCircle className="spin" /><span><strong>Loading record…</strong><small>Checking tenant and project access.</small></span></div>;
  if (!record)
    return <div className="live-detail-page"><Link className="back-link" href={selected.back}><ArrowLeft /> Back to {selected.backLabel}</Link><div className="live-domain-state live-domain-error"><DatabaseZap /><span><strong>Record unavailable</strong><small>{error || "It may have been archived, removed, or be outside your access."}</small></span></div></div>;
  const title = show(nested(record, selected.titleFields), "Title");
  const status = show(nested(record, selected.statusFields), "Status");
  const items = Array.isArray(record.items)
    ? record.items.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    : [];
  const requirements = Array.isArray(record.requirements)
    ? record.requirements.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    : [];
  return (
    <div className="live-detail-page">
      <Link className="back-link" href={selected.back}><ArrowLeft /> Back to {selected.backLabel}</Link>
      <header className="page-heading">
        <div><p className="eyebrow">{selected.label}</p><h1>{title}</h1><p>{selected.description}</p></div>
        <StatusBadge tone={/approved|complete|published|active|accepted/i.test(status) ? "success" : "warning"}>{status}</StatusBadge>
      </header>
      <section className="live-detail-grid">
        {selected.facts.map(([label, fields]) => (
          <article className="panel" key={label}><small>{label}</small><strong>{show(nested(record, fields), label)}</strong></article>
        ))}
      </section>
      {items.length ? <section className="panel live-detail-list"><div className="panel-heading"><div><h2>Schedule items</h2><p>Current immutable version</p></div></div>{items.map((item, index) => <article key={String(item.id ?? index)}><time>{show(item.startAt, "Arrival")}</time><span><strong>{show(item.title, "Title")}</strong><small>{show(item.location, "Location")}</small></span><small>{show(item.endAt, "Departure")}</small></article>)}</section> : null}
      {requirements.length ? <section className="panel live-detail-list"><div className="panel-heading"><div><h2>Requirements</h2><p>Verified completion evidence</p></div></div>{requirements.map((item, index) => <article key={String(item.id ?? index)}><span><strong>{show(item.name, "Name")}</strong><small>{show(item.kind, "Kind")}</small></span><StatusBadge>{show(item.status, "Status")}</StatusBadge></article>)}</section> : null}
      <section className="panel live-detail-boundary"><ShieldCheck /><span><strong>How this record works</strong><small>{selected.boundary}</small></span></section>
    </div>
  );
}
