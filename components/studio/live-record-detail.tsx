"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { statusLabel } from "@/features/format/status-label";
import { ArrowLeft, CheckCircle2, Copy, CircleDollarSign, DatabaseZap, FileCheck2, LoaderCircle, ReceiptText, ShieldCheck, XCircle } from "lucide-react";
import { collection, doc, getDoc, getDocs, limit, query, where } from "firebase/firestore";
import { StatusBadge } from "@/components/ui/status-badge";
import { useWorkspace } from "@/features/auth/workspace-context";
import { getFirebaseClient } from "@/lib/firebase/client";
import { dataIsLive } from "@/lib/runtime-mode";
import { sendCrewCommand } from "@/lib/crew/command-client";
import { friendlyError } from "@/lib/ai/friendly-error";

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
      // Same relabel as the list: this is when the version was written, not a
      // publication event. "Approved"/"Approved by" render "—" on a schedule
      // whose status pill says `approved`, which is the field that actually
      // matters for an evidence-controlled step — so it now says so plainly.
      ["Version dated", ["publishedAt"]],
      ["Approval recorded", ["approvedAt"]],
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
      "A job closes only once the gallery, the money, the crew and the review are all settled.",
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
      // Same field-name mismatch the list had: the records store
      // checkpointTemplates and automationRules.
      ["Checkpoints", ["checkpointTemplates"]],
      ["Automations", ["automationRules"]],
      ["Created", ["createdAt"]],
      ["Updated", ["updatedAt"]],
    ],
    boundary:
      "Published workflow versions are immutable for active runs unless an authorized migration is explicitly executed.",
  },
};

function mockRecord(kind: DetailKind, id: string): RecordValue {
  const records: Record<DetailKind, RecordValue> = {
    proposal: {
      id,
      projectName: "Rivera wedding",
      clientSnapshot: { primaryName: "Maya and Elena Rivera" },
      status: "sent",
      version: 2,
      pricingSnapshot: {
        packageName: "Signature wedding",
        totalCents: 680000,
      },
      expiresAt: "2027-01-31T17:00:00.000Z",
      sentAt: "2027-01-18T14:00:00.000Z",
      acceptedAt: null,
    },
    schedule: {
      id,
      projectName: "Rivera wedding",
      status: "published",
      approvalState: "approved",
      version: 3,
      timezone: "America/New_York",
      publishedAt: "2027-06-01T16:00:00.000Z",
      approvedAt: "2027-06-02T13:30:00.000Z",
      approvedBy: "Maya Rivera",
      items: [
        {
          id: "arrival",
          startAt: "2027-06-12T12:30:00-04:00",
          endAt: "2027-06-12T13:00:00-04:00",
          title: "Crew arrival and venue walk-through",
          location: "The Garden Conservatory",
        },
        {
          id: "ceremony",
          startAt: "2027-06-12T17:00:00-04:00",
          endAt: "2027-06-12T17:45:00-04:00",
          title: "Ceremony",
          location: "Garden terrace",
        },
      ],
    },
    crew: {
      id,
      name: "Jordan Lee",
      role: "Lead photographer",
      active: true,
      email: "jordan@example.test",
      arrivalAt: "2027-06-12T12:30:00-04:00",
      departureAt: "2027-06-12T22:30:00-04:00",
      calendarStatus: "accepted",
      currentScheduleVersion: 3,
      requirements: [
        { name: "W-9", kind: "document", status: "complete" },
        { name: "Final schedule", kind: "acknowledgement", status: "ready" },
      ],
      specialties: ["Weddings", "Documentary"],
      serviceAreas: ["New York City", "Hudson Valley"],
      w9Status: "complete",
      insuranceStatus: "current",
    },
    "post-production": {
      id,
      projectName: "Rivera wedding",
      currentStep: "editing_started",
      targetDeliveryDate: "2027-08-07",
      updatedAt: "2027-06-16T18:00:00.000Z",
      projectId: "demo-project",
      steps: {
        backup_complete: true,
        cull_complete: true,
        editing_started: true,
      },
    },
    workflow: {
      id,
      name: "Wedding photography",
      status: "active",
      version: 4,
      eventTypeId: "wedding",
      checkpoints: ["Contract", "Retainer", "Questionnaire", "Schedule"],
      automations: ["Booking confirmation", "Final invoice", "Review request"],
      createdAt: "2026-10-12T14:00:00.000Z",
      updatedAt: "2027-01-04T15:30:00.000Z",
    },
  };
  return records[kind];
}

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
  // Matches on the label, so renaming a field can silently stop it being
  // formatted as a date. "Version dated" and "Approval recorded" are here
  // because of exactly that.
  if (
    /At$|Created|Updated|Expires|Published|Approv|Arrival|Departure|delivery|dated|recorded/i.test(
      label,
    )
  ) {
    const date = new Date(String(value));
    if (!Number.isNaN(date.valueOf())) {
      // `toLocaleString()` renders "8/30/2026, 1:00:00 PM" — a fourth date
      // format in an app that already shows one date three ways, and seconds
      // nobody needs. A run-of-show row wants the clock; a record timestamp
      // wants the day.
      const clockOnly = /Arrival|Departure/i.test(label);
      return new Intl.DateTimeFormat("en-US", {
        ...(clockOnly
          ? {}
          : { month: "short", day: "numeric", year: "numeric" }),
        hour: "numeric",
        minute: "2-digit",
      }).format(date);
    }
  }
  return String(value).replaceAll("_", " ");
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function CrewStudioOperations({
  assignment,
  onChanged,
}: {
  assignment: RecordValue;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [messages, setMessages] = useState<RecordValue[]>([]);
  const [messageVersion, setMessageVersion] = useState(0);
  const closeout = objectValue(assignment.closeout);
  const payment = objectValue(assignment.payment);
  const requirements = Array.isArray(assignment.requirements)
    ? (assignment.requirements as Array<Record<string, unknown>>)
    : [];
  useEffect(() => {
    if (!dataIsLive) return;
    let active = true;
    void getDocs(query(
      collection(getFirebaseClient().firestore, "crewMessages"),
      where("tenantId", "==", String(assignment.tenantId)),
      where("assignmentId", "==", assignment.id),
      limit(50),
    )).then((snapshot) => {
      if (!active) return;
      setMessages(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as RecordValue).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))));
    }).catch(() => {
      if (active) setMessages([]);
    });
    return () => { active = false; };
  }, [assignment.id, assignment.tenantId, messageVersion]);
  const command = async (type: string, input: Record<string, unknown>) => {
    if (busy) return false;
    setBusy(type);
    setNotice("");
    try {
      const response = await sendCrewCommand(type, {
        projectId: String(assignment.projectId),
        assignmentId: assignment.id,
        ...input,
      });
      if (!response.persisted) {
        setNotice("Development preview only. Nothing was changed.");
        return false;
      }
      setNotice("Crew record updated.");
      if (type === "contactStudio") setMessageVersion((value) => value + 1);
      onChanged();
      return true;
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "Crew record could not be updated."));
      return false;
    } finally {
      setBusy("");
    }
  };
  const review = (decision: "approved" | "needs_changes", form: HTMLFormElement) => {
    const data = new FormData(form);
    void command("reviewAssignmentCloseout", {
      decision,
      reviewerNote: String(data.get("reviewerNote") ?? "").trim() || null,
    });
  };
  const paymentSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const expected = String(data.get("expectedAt") ?? "");
    void command("updateAssignmentPayment", {
      status: String(data.get("status")),
      expectedAt: expected ? new Date(expected).toISOString() : null,
      reference: String(data.get("reference") ?? "").trim() || null,
    });
  };
  const messageSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void command("contactStudio", {
      subject: String(data.get("subject") ?? "").trim(),
      message: String(data.get("message") ?? "").trim(),
      urgency: "normal",
    }).then((persisted) => { if (persisted) form.reset(); });
  };
  return (
    <section className="crew-studio-operations">
      <header><div><p className="eyebrow">Studio controls</p><h2>Requirements, closeout & payment</h2></div><StatusBadge tone={closeout.status === "paid" ? "success" : "info"}>{show(closeout.status ?? "not submitted", "Status")}</StatusBadge></header>
      <div className="crew-studio-requirements">
        {requirements.map((item, index) => {
          const status = String(item.status ?? "missing");
          const complete = ["complete", "waived"].includes(status);
          return <article key={String(item.id ?? index)}><FileCheck2/><span><strong>{show(item.name, "Name")}</strong><small>{show(item.kind, "Kind")} · {show(status, "Status")}</small></span>{!complete ? <span className="crew-studio-inline-actions"><button className="button button-light button-sm" disabled={Boolean(busy)} type="button" onClick={() => void command("completeRequirement", { requirementId: item.id, documentId: item.documentId ?? null })}>Approve</button><button className="button button-light button-sm" disabled={Boolean(busy)} type="button" onClick={() => { const reason = window.prompt("Reason for waiving this requirement?"); if (reason?.trim()) void command("waiveRequirement", { requirementId: item.id, reason: reason.trim() }); }}>Waive</button></span> : <CheckCircle2 className="crew-studio-complete"/>}</article>;
        })}
      </div>
      {assignment.status === "accepted" ? <button className="button button-light" disabled={Boolean(busy)} type="button" onClick={() => void command("completeAssignment", {})}><CheckCircle2/> Mark event work complete</button> : null}
      {closeout.status === "submitted" ? <form className="panel crew-studio-closeout-review" onSubmit={(event) => { event.preventDefault(); review("approved", event.currentTarget); }}><ReceiptText/><div><strong>Review submitted work record</strong><small>Actual time: {show(closeout.actualStartsAt, "Arrival")} – {show(closeout.actualEndsAt, "Departure")} · {Number(closeout.extraMinutes ?? 0)} extra minutes · {Array.isArray(closeout.expenses) ? closeout.expenses.length : 0} expenses · {Array.isArray(closeout.deliverables) ? closeout.deliverables.length : 0} deliverables</small></div><label>Review note<textarea name="reviewerNote" maxLength={2000}/></label><span><button className="button button-dark" disabled={Boolean(busy)} type="submit"><CheckCircle2/> Approve closeout</button><button className="button button-light" disabled={Boolean(busy)} type="button" onClick={(event) => { const form = event.currentTarget.form; if (form) review("needs_changes", form); }}><XCircle/> Request changes</button></span></form> : null}
      {["approved", "paid"].includes(String(closeout.status)) ? <form className="panel crew-studio-payment" onSubmit={paymentSubmit}><CircleDollarSign/><div><strong>Payment status</strong><small>Keep the crew member informed without exposing client finances.</small></div><label>Status<select name="status" defaultValue={String(payment.status ?? "scheduled")}><option value="scheduled">Scheduled</option><option value="processing">Processing</option><option value="paid">Paid</option></select></label><label>Expected date<input name="expectedAt" type="datetime-local" /></label><label>Reference<input name="reference" maxLength={240} defaultValue={String(payment.reference ?? "")}/></label><button className="button button-dark" disabled={Boolean(busy)} type="submit">Save payment status</button></form> : null}
      <section className="panel crew-studio-messages"><header><div><strong>Assignment messages</strong><small>A private thread between the studio and this crew member.</small></div></header>{messages.length ? <div className="crew-message-thread">{messages.map((message) => <article key={message.id} data-direction={String(message.direction)}><small>{message.direction === "studio_to_crew" ? "Studio" : "Crew"} · {show(message.createdAt, "Created")}</small><strong>{show(message.subject, "Subject")}</strong><p>{show(message.message, "Message")}</p></article>)}</div> : <p className="crew-message-empty">No messages on this assignment yet.</p>}<form onSubmit={messageSubmit}><label>Subject<input name="subject" maxLength={160} required defaultValue="Assignment update"/></label><label>Message<textarea name="message" maxLength={4000} required/></label><button className="button button-dark" disabled={Boolean(busy)} type="submit">Send to crew member</button></form></section>
      {notice ? <p className="form-notice" role="status">{notice}</p> : null}
    </section>
  );
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
  const [record, setRecord] = useState<RecordValue | null | undefined>(
    dataIsLive ? undefined : mockRecord(kind, id),
  );
  const [error, setError] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);
  useEffect(() => {
    if (!dataIsLive || workspace.loading) return;
    let active = true;
    const load = async () => {
      const { firestore } = getFirebaseClient();
      // A kind can live in more than one collection ("crew" is an assignment
      // or a profile), so this probes each in turn. Probing costs nothing on
      // a hit and everything on a miss: every rule here reads
      // `resource.data.tenantId`, and on a document that does not exist there
      // is no `resource` to read, so Firestore denies rather than returning
      // empty. A miss is therefore indistinguishable from a real denial, and
      // an uncaught one ended the loop before the later collection was ever
      // tried — which is why opening any crew profile said the owner had no
      // access to their own directory. Remember the denial, keep looking, and
      // only surface it if nothing anywhere matched.
      let denial: unknown = null;
      for (const collectionName of selected.collections) {
        let snapshot;
        try {
          snapshot = await getDoc(doc(firestore, collectionName, id));
        } catch (caught: unknown) {
          denial = denial ?? caught;
          continue;
        }
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
      if (denial) throw denial;
      return null;
    };
    void load()
      .then((value) => active && setRecord(value))
      .catch((caught: unknown) => {
        if (!active) return;
        setError(friendlyError(caught, "Record could not be loaded."));
        setRecord(null);
      });
    return () => {
      active = false;
    };
  }, [id, refreshVersion, selected, workspace.loading, workspace.tenantId]);
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
  /**
   * A workflow's steps, on the page that describes itself as showing
   * "the reusable steps and automations in this workflow version".
   *
   * It showed neither — six metadata tiles and a boundary note. Someone
   * trying to work out what a workflow actually does had nowhere to look,
   * which is most of why the feature reads as unknowable.
   */
  const checkpoints = Array.isArray(record.checkpointTemplates)
    ? record.checkpointTemplates.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object",
      )
    : [];
  const automations = Array.isArray(record.automationRules)
    ? record.automationRules.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object",
      )
    : [];
  return (
    <div className="live-detail-page">
      <Link className="back-link" href={selected.back}><ArrowLeft /> Back to {selected.backLabel}</Link>
      <header className="page-heading">
        <div><p className="eyebrow">{selected.label}</p><h1>{title}</h1><p>{selected.description}</p></div>
        <div className="live-detail-header-actions">
          <StatusBadge tone={/approved|complete|published|active|accepted/i.test(status) ? "success" : "warning"}>{status}</StatusBadge>
          {/* Published versions are immutable, which is right — a wedding
              three months into its checkpoints must not have its rules
              changed underneath it. The other half of that bargain is an
              obvious way to make the next version, and it was missing:
              the mechanism existed but was spelled "create a new thing
              with the same name". */}
          {kind === "workflow" ? (
            <Link
              className="button button-dark button-sm"
              href={`/studio/workflows/new?from=${encodeURIComponent(String(record.id ?? ""))}`}
            >
              <Copy size={14} /> New version
            </Link>
          ) : null}
        </div>
      </header>
      <section className="live-detail-grid">
        {selected.facts.map(([label, fields]) => (
          <article className="panel" key={label}><small>{label}</small><strong>{show(nested(record, fields), label)}</strong></article>
        ))}
      </section>
      {items.length ? <section className="panel live-detail-list"><div className="panel-heading"><div><h2>Schedule items</h2><p>Current immutable version</p></div></div>{items.map((item, index) => <article key={String(item.id ?? index)}><time>{show(item.startAt, "Arrival")}</time><span><strong>{show(item.title, "Title")}</strong><small>{show(item.location, "Location")}</small></span><small>{show(item.endAt, "Departure")}</small></article>)}</section> : null}
      {requirements.length ? <section className="panel live-detail-list"><div className="panel-heading"><div><h2>Requirements</h2><p>Verified completion evidence</p></div></div>{requirements.map((item, index) => <article key={String(item.id ?? index)}><span><strong>{show(item.name, "Name")}</strong><small>{show(item.kind, "Kind")}</small></span><StatusBadge>{show(item.status, "Status")}</StatusBadge></article>)}</section> : null}
      {checkpoints.length ? (
        <section className="panel live-detail-list is-two-column">
          <div className="panel-heading">
            <div>
              <h2>Steps</h2>
              <p>Dated from each job&rsquo;s event date when the workflow starts</p>
            </div>
          </div>
          {checkpoints.map((item, index) => {
            const offset = Number(
              (item.dueDateRule as { offsetDays?: unknown } | undefined)
                ?.offsetDays ?? 0,
            );
            return (
              <article key={String(item.key ?? index)}>
                <span>
                  <strong>{show(item.name, "Step")}</strong>
                  <small>
                    {show(item.category, "Stage")}
                    {offset ? ` · ${Math.abs(offset)} days before the event` : ""}
                    {item.ownerType ? ` · ${statusLabel(String(item.ownerType))}` : ""}
                  </small>
                </span>
                {item.blocking ? (
                  <StatusBadge tone="warning">Required for readiness</StatusBadge>
                ) : (
                  <StatusBadge>Optional</StatusBadge>
                )}
              </article>
            );
          })}
        </section>
      ) : null}
      {automations.length ? (
        <section className="panel live-detail-list is-two-column">
          <div className="panel-heading">
            <div>
              <h2>Automations</h2>
              <p>What StudioCue does on its own while a job runs</p>
            </div>
          </div>
          {automations.map((item, index) => (
            <article key={String(item.key ?? index)}>
              <span>
                <strong>{show(item.name, "Automation")}</strong>
                <small>
                  Runs when: {statusLabel(String(item.trigger ?? ""))}
                </small>
              </span>
              <StatusBadge tone={item.active === false ? "neutral" : "success"}>
                {item.active === false ? "Off" : "On"}
              </StatusBadge>
            </article>
          ))}
        </section>
      ) : null}
      {kind === "crew" && typeof record.projectId === "string" ? <CrewStudioOperations assignment={record} onChanged={() => setRefreshVersion((value) => value + 1)} /> : null}
      <section className="panel live-detail-boundary"><ShieldCheck /><span><strong>How this record works</strong><small>{selected.boundary}</small></span></section>
    </div>
  );
}
