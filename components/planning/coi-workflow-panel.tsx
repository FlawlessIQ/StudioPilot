"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  CheckCircle2,
  LoaderCircle,
  Send,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import {
  collection,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { StatusBadge } from "@/components/ui/status-badge";
import { useWorkspace } from "@/features/auth/workspace-context";
import { getFirebaseClient } from "@/lib/firebase/client";
import { sendPlanningCommand } from "@/lib/planning/command-client";
import { dataIsLive } from "@/lib/runtime-mode";
import { statusLabel } from "@/features/format/status-label";

type RequestRecord = Record<string, unknown> & { id: string };

export function CoiWorkflowPanel({ projectId }: { projectId?: string }) {
  const workspace = useWorkspace();
  const { records: projects, loading: projectsLoading } =
    useTenantDocuments("projects");
  const [requests, setRequests] = useState<RequestRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [reason, setReason] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!dataIsLive) return;
    if (workspace.loading || !workspace.tenantId) return;
    const { firestore } = getFirebaseClient();
    return onSnapshot(
      query(
        collection(firestore, "insuranceRequests"),
        where("tenantId", "==", workspace.tenantId),
      ),
      (snapshot) => {
        const next: RequestRecord[] = snapshot.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        }));
        setRequests(projectId ? next.filter((item) => item.projectId === projectId) : next);
      },
      () => setNotice("The COI review queue could not be refreshed."),
    );
  }, [projectId, workspace.loading, workspace.tenantId]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    const form = new FormData(event.currentTarget);
    try {
      const result = await sendPlanningCommand("createCoiRequest", {
        projectId: String(form.get("projectId")),
        certificateHolder: String(form.get("certificateHolder")),
        venueLegalName: String(form.get("venueLegalName")),
        venueAddress: String(form.get("venueAddress")),
        eventDate: String(form.get("eventDate")),
        coverageTypes: String(form.get("coverageTypes"))
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        requiredLimits: {
          generalLiability: Math.round(
            Number(form.get("generalLiabilityDollars")) * 100,
          ),
        },
        additionalInsuredWording:
          String(form.get("additionalInsuredWording")) || null,
        waiverOfSubrogation: form.get("waiverOfSubrogation") === "on",
        primaryNoncontributory: form.get("primaryNoncontributory") === "on",
        specialInstructions: String(form.get("specialInstructions")) || null,
        submissionEmail: String(form.get("submissionEmail")),
        dueDate: String(form.get("dueDate")),
        insuranceAgentEmail: String(form.get("insuranceAgentEmail")),
      });
      setNotice(
        result.persisted
          ? "COI request created and the agent email was queued."
          : "Development preview validated the COI request.",
      );
      if (result.persisted) {
        event.currentTarget.reset();
      }
    } catch (caught: unknown) {
      setNotice(caught instanceof Error ? caught.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  async function decide(
    request: RequestRecord,
    decision: "approved" | "rejected",
  ) {
    setBusy(true);
    setNotice(null);
    try {
      await sendPlanningCommand("decideCoi", {
        projectId: String(request.projectId),
        requestId: request.id,
        decision,
        reason: reason[request.id] ?? "",
      });
      setNotice(
        decision === "approved"
          ? "Human approval recorded; approved storage jobs were queued."
          : "Rejection recorded and a correction request was queued.",
      );
    } catch (caught: unknown) {
      setNotice(caught instanceof Error ? caught.message : "Decision failed.");
    } finally {
      setBusy(false);
    }
  }

  async function sendToVenue(request: RequestRecord) {
    setBusy(true);
    setNotice(null);
    try {
      await sendPlanningCommand("sendCoiToVenue", {
        projectId: String(request.projectId),
        requestId: request.id,
      });
      setNotice("Venue delivery was queued and its status was recorded.");
    } catch (caught: unknown) {
      setNotice(caught instanceof Error ? caught.message : "Delivery failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="coi-workflow-panel">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">New requirement</p>
            <h2>Request a certificate</h2>
            <p>A unique reply route associates one inbound PDF with this project.</p>
          </div>
          <Send />
        </div>
        <form className="coi-request-form" onSubmit={(event) => void create(event)}>
          <label>
            Project
            <select name="projectId" required disabled={projectsLoading} defaultValue={projectId ?? ""}>
              <option value="">Select a project</option>
              {projects?.map((project) => (
                <option key={project.id} value={project.id}>
                  {String(project.name)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Certificate holder
            <input name="certificateHolder" required />
          </label>
          <label>
            Venue legal name
            <input name="venueLegalName" required />
          </label>
          <label>
            Venue address
            <input name="venueAddress" required />
          </label>
          <label>
            Event date
            <input name="eventDate" type="date" required />
          </label>
          <label>
            Due date
            <input name="dueDate" type="date" required />
          </label>
          <label>
            Insurance agent email
            <input name="insuranceAgentEmail" type="email" required />
          </label>
          <label>
            Venue submission email
            <input name="submissionEmail" type="email" required />
          </label>
          <label>
            Coverage types
            <input name="coverageTypes" defaultValue="General liability" required />
          </label>
          <label>
            General liability limit (USD)
            <input name="generalLiabilityDollars" min="0" type="number" defaultValue="1000000" required />
          </label>
          <label className="form-span">
            Additional-insured wording
            <textarea name="additionalInsuredWording" />
          </label>
          <label className="form-span">
            Special instructions
            <textarea name="specialInstructions" />
          </label>
          <label className="coi-checkbox">
            <input name="waiverOfSubrogation" type="checkbox" /> Waiver of subrogation required
          </label>
          <label className="coi-checkbox">
            <input name="primaryNoncontributory" type="checkbox" /> Primary and noncontributory wording required
          </label>
          <button className="button button-dark" disabled={busy} type="submit">
            {busy ? <LoaderCircle className="spin" /> : <Send />}
            {busy ? "Creating…" : "Create and send request"}
          </button>
        </form>
      </section>
      <section>
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Human review queue</p>
            <h2>Certificates requiring action</h2>
          </div>
        </div>
        <div className="coi-review-list">
          {requests
            .map((request) => {
              const discrepancies = Array.isArray(request.discrepancies)
                ? request.discrepancies
                : [];
              return (
                <article className="panel" key={request.id}>
                  <header>
                    <span>
                      <small>{String(request.venueName ?? "Venue")}</small>
                      <strong>{request.id}</strong>
                    </span>
                    <StatusBadge tone={request.status === "approved" ? "success" : "warning"}>
                      {statusLabel(request.status)}
                    </StatusBadge>
                  </header>
                  <div className="coi-status-track" aria-label="COI progress">
                    {[
                      ["requested", "Requested"],
                      ["under_review", "Received"],
                      ["approved", "Approved"],
                      ["sent_to_venue", "Delivered"],
                    ].map(([status, label], index, stages) => {
                      const currentIndex = stages.findIndex(
                        ([candidate]) => candidate === request.status,
                      );
                      const correction =
                        request.status === "correction_required";
                      return (
                        <span
                          className={
                            index <= currentIndex && !correction
                              ? "is-complete"
                              : correction && index === 1
                                ? "needs-action"
                                : ""
                          }
                          key={status}
                        >
                          <i />
                          <small>
                            {correction && index === 1
                              ? "Needs correction"
                              : label}
                          </small>
                        </span>
                      );
                    })}
                  </div>
                  <ul>
                    {discrepancies.map((item, index) => {
                      const value =
                        typeof item === "object" && item !== null
                          ? (item as Record<string, unknown>)
                          : {};
                      return (
                        <li key={`${String(value.field)}-${index}`}>
                          <ShieldCheck size={14} />
                          {String(value.field)}: expected {String(value.expected)}, extracted {String(value.extracted)}
                        </li>
                      );
                    })}
                    {!discrepancies.length ? <li>No extracted discrepancies were reported. Human review is still required.</li> : null}
                  </ul>
                  {request.status === "approved" ? (
                    <button className="button button-dark" disabled={busy} type="button" onClick={() => void sendToVenue(request)}>
                      <Send /> Send approved PDF to venue
                    </button>
                  ) : ["under_review", "correction_required"].includes(
                      String(request.status),
                    ) ? (
                    <>
                      <label>
                        Required review reason
                        <textarea value={reason[request.id] ?? ""} onChange={(event) => setReason((current) => ({ ...current, [request.id]: event.target.value }))} />
                      </label>
                      <footer>
                        <button className="button button-dark" disabled={busy} type="button" onClick={() => void decide(request, "approved")}>
                          <CheckCircle2 /> Approve
                        </button>
                        <button className="button button-danger" disabled={busy} type="button" onClick={() => void decide(request, "rejected")}>
                          <XCircle /> Request correction
                        </button>
                      </footer>
                    </>
                  ) : (
                    <p className="coi-status-note">
                      {request.status === "requested"
                        ? "Waiting for the insurance agent to reply through the secure project address."
                        : request.status === "sent_to_venue"
                          ? "The approved certificate was queued for venue delivery and recorded in this project."
                          : "StudioCue is waiting for the next provider event."}
                    </p>
                  )}
                </article>
              );
            })}
        </div>
      </section>
      {notice ? <p className="form-notice" role="status">{notice}</p> : null}
    </div>
  );
}
