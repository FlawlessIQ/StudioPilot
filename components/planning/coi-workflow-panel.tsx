"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
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
import { todayLocalIso } from "@/lib/format/event-date";
import { sendPlanningCommand } from "@/lib/planning/command-client";
import { dataIsLive } from "@/lib/runtime-mode";
import { statusLabel } from "@/features/format/status-label";
import { AddressField } from "@/components/forms/address-field";
import type { CapturedPlace } from "@/features/places/schema";
import { friendlyError } from "@/lib/ai/friendly-error";
import { useReturnToJob } from "@/lib/projects/return-to-job";

type RequestRecord = Record<string, unknown> & { id: string };

export function CoiWorkflowPanel({ projectId }: { projectId?: string }) {
  const [venueAddress, setVenueAddress] = useState<CapturedPlace | null>(null);
  const workspace = useWorkspace();
  const { records: projects, loading: projectsLoading } =
    useTenantDocuments("projects");
  const [requests, setRequests] = useState<RequestRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [reason, setReason] = useState<Record<string, string>>({});
  const returnToJob = useReturnToJob(projectId ?? null);
  /**
   * Derived, not synchronised. The page's own project wins until the studio
   * picks a different one — no effect mirroring a prop into state, which is
   * the pattern that makes a late-arriving `projectId` fight whatever was
   * rendered first.
   */
  const [projectOverride, setProjectOverride] = useState<string | null>(null);
  const [eventDateOverride, setEventDateOverride] = useState<string | null>(null);
  const [dueDateOverride, setDueDateOverride] = useState<string | null>(null);
  const [limitDollars, setLimitDollars] = useState("1000000");
  // `1000000` in a bare number input is hard to read and easy to mistype by
  // an order of magnitude, which on a certificate is the whole point of it.
  const formattedLimit = useMemo(() => {
    const value = Number(limitDollars);
    return Number.isFinite(value) && value > 0
      ? value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
      : "";
  }, [limitDollars]);
  const selectedProject = projectOverride ?? projectId ?? "";

  /**
   * Dates and venue, from the job.
   *
   * Both date inputs shipped with no default while the app knew the event
   * date all along — and an empty `type="date"` is painted by Safari as a
   * greyed *today*, so they read as filled with today's date for an event
   * six weeks out. A wrong date on a certificate is the most expensive
   * mistake available on this page, and it looked pre-filled.
   *
   * The due date leads the event by two weeks so there is room to correct a
   * certificate that comes back wrong, and never lands in the past.
   */
  const chosen = projects?.find((item) => item.id === selectedProject);
  const chosenEventDate = String(chosen?.eventDate ?? "").slice(0, 10);
  const defaultDueDate = useMemo(() => {
    if (!chosenEventDate) return "";
    const event = Date.parse(`${chosenEventDate}T12:00:00`);
    if (!Number.isFinite(event)) return "";
    // `todayLocalIso` takes the date to convert, so it doubles as the
    // local-ISO formatter and saves a second implementation of it.
    const lead = todayLocalIso(new Date(event - 14 * 86_400_000));
    const today = todayLocalIso();
    return lead < today ? today : lead;
  }, [chosenEventDate]);

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
    // See vendor-create-form: `currentTarget` is null after the await.
    const element = event.currentTarget;
    const form = new FormData(element);
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
        element.reset();
        setVenueAddress(null);
        // The step now waits on the agent, which the job page says better
        // than this form can.
        if (projectId) returnToJob();
      }
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "Request failed."));
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
      setNotice(friendlyError(caught, "Decision failed."));
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
      setNotice(friendlyError(caught, "Delivery failed."));
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
            {/* Controlled, not `defaultValue`. The options arrive from
                Firestore after mount, and `defaultValue` only applies at
                mount — so a URL carrying ?project=… still rendered "Select a
                project" once the list loaded, on the very page that had been
                opened for that project. */}
            <select
              disabled={projectsLoading}
              name="projectId"
              onChange={(event) => setProjectOverride(event.target.value)}
              required
              value={selectedProject}
            >
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
            <small>
              The venue&apos;s legal entity, exactly as their contract writes it.
              This is who the certificate is issued to.
            </small>
          </label>
          <label>
            Venue legal name
            <input
              defaultValue={String(chosen?.venueName ?? "")}
              key={`venue-${selectedProject}`}
              name="venueLegalName"
              required
            />
          </label>
          {/* The one address in the product with a legal consequence: it
              goes on the certificate the venue checks at the door. Looking
              it up beats retyping it off an email thread. The `name` prop
              still writes a plain form value, so the command that sends
              this is unchanged. */}
          <AddressField
            hint={
              venueAddress?.verified
                ? "Confirmed address — safe to put on the certificate."
                : "Look the venue up so the certificate carries its real address."
            }
            label="Venue address"
            name="venueAddress"
            onChange={setVenueAddress}
            placeholder="Venue street address"
            required
            value={venueAddress}
          />
          <label>
            Event date
            <input
              name="eventDate"
              onChange={(event) => setEventDateOverride(event.target.value)}
              required
              type="date"
              value={eventDateOverride ?? chosenEventDate}
            />
          </label>
          <label>
            Due date
            <input
              name="dueDate"
              onChange={(event) => setDueDateOverride(event.target.value)}
              required
              type="date"
              value={dueDateOverride ?? defaultDueDate}
            />
          </label>
          <label>
            Insurance agent email
            <input name="insuranceAgentEmail" type="email" required />
            <small>Your own agent. They get the request as soon as you send it.</small>
          </label>
          <label>
            Venue submission email
            <input name="submissionEmail" type="email" required />
            <small>
              Where the finished certificate goes — only after you have
              reviewed and approved it. Nothing is sent here now.
            </small>
          </label>
          <label>
            Coverage type
            <input name="coverageTypes" defaultValue="General liability" required />
            <small>Separate several with commas, as the venue lists them.</small>
          </label>
          <label>
            General liability limit (USD)
            <input
              min="0"
              name="generalLiabilityDollars"
              onChange={(event) => setLimitDollars(event.target.value)}
              required
              type="number"
              value={limitDollars}
            />
            <small>
              {formattedLimit
                ? `${formattedLimit} — most venues ask for $1,000,000.`
                : "Most venues ask for $1,000,000."}
            </small>
          </label>
          <label className="form-span">
            Additional-insured wording <span className="coi-optional">optional</span>
            <textarea name="additionalInsuredWording" />
            <small>
              Copy this from the venue&apos;s contract if it specifies wording.
            </small>
          </label>
          <label className="form-span">
            Special instructions <span className="coi-optional">optional</span>
            <textarea name="specialInstructions" />
          </label>
          <label className="coi-checkbox">
            <input name="waiverOfSubrogation" type="checkbox" /> Waiver of
            subrogation required
            <small>Tick only if the venue&apos;s contract asks for it.</small>
          </label>
          <label className="coi-checkbox">
            <input name="primaryNoncontributory" type="checkbox" /> Primary and noncontributory wording required
          </label>
          <p className="coi-send-summary form-span">
            Sending requests the certificate from your agent. The venue is not
            contacted until you approve what comes back.
          </p>
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
