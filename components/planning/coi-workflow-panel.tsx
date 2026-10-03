"use client";

import { CoiRequestActions } from "@/components/planning/coi-request-actions";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  LoaderCircle,
  Send,
  ShieldCheck,
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
import {
  describeDiscrepancy,
  stillDisagrees,
} from "@/features/insurance/certificate-review";
import { coiProgress } from "@/features/insurance/progress";
import { dataIsLive } from "@/lib/runtime-mode";
import { statusLabel } from "@/features/format/status-label";
import { AddressField } from "@/components/forms/address-field";
import type { CapturedPlace } from "@/features/places/schema";
import { friendlyError } from "@/lib/ai/friendly-error";
import { useReturnToJob } from "@/lib/projects/return-to-job";
import { liveProjects } from "@/features/projects/put-away";
import { InfoHint } from "@/components/ui/info-hint";

type RequestRecord = Record<string, unknown> & { id: string };

export function CoiWorkflowPanel({ projectId }: { projectId?: string }) {
  const [venueAddress, setVenueAddress] = useState<CapturedPlace | null>(null);
  const workspace = useWorkspace();
  const { records: projects, loading: projectsLoading } =
    useTenantDocuments("projects");
  // The request's details and the studio's saved agent (H3).
  const managerRole = ["studio_owner", "studio_admin", "studio_coordinator"].includes(String(workspace.role ?? ""));
  const { records: requirements } = useTenantDocuments("insuranceRequirements", { enabled: managerRole });
  const { records: coiSettingsRecords } = useTenantDocuments("coiSettings", { enabled: managerRole });
  const coiSettings = (coiSettingsRecords ?? [])[0];
  const savedAgentEmail = typeof coiSettings?.agentEmail === "string" ? coiSettings.agentEmail : "";
  const chaseEveryDays = typeof coiSettings?.chaseEveryDays === "number" ? coiSettings.chaseEveryDays : 3;
  const maxChases = typeof coiSettings?.maxChases === "number" ? coiSettings.maxChases : 4;
  const [requests, setRequests] = useState<RequestRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
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
  const [settingRequirement, setSettingRequirement] = useState(false);
  // A request already open for this job: the form waits behind a button
  // rather than inviting a second request for the same venue (walked 2026-09-29).
  const [requestAnother, setRequestAnother] = useState(false);

  /**
   * Whether this venue asks for a certificate at all.
   *
   * Saying "it does not" is the fastest correct way past this step, and until
   * now the only way was to find the readiness panel and waive the
   * `coi-approved` checkpoint — which records the studio accepting a risk
   * rather than the fact that nobody ever asked for one.
   */
  async function setRequirement(next: "required" | "not_required" | "unknown") {
    if (!selectedProject) return;
    setSettingRequirement(true);
    setNotice(null);
    try {
      const outcome = await sendPlanningCommand("setInsuranceRequirement", {
        projectId: selectedProject,
        insuranceRequired: next,
      });
      setNotice(
        outcome.persisted
          ? next === "not_required"
            ? "Marked as not required. This job no longer waits on a certificate."
            : next === "required"
              ? "Marked as required."
              : "Set back to unknown."
          : "Development preview — nothing was saved.",
      );
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "That could not be saved."));
    } finally {
      setSettingRequirement(false);
    }
  }
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
  const requirement = String(chosen?.insuranceRequired ?? "unknown");
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
        submissionEmail: String(form.get("submissionEmail") ?? "") || null,
        dueDate: String(form.get("dueDate")),
        insuranceAgentEmail: String(form.get("insuranceAgentEmail") ?? "") || null,
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

  const openForThisJob = Boolean(
    projectId &&
      requests.some(
        (request) =>
          request.projectId === projectId &&
          !["venue_acknowledged", "not_required", "cancelled", "superseded"].includes(String(request.status)),
      ),
  );

  // Prepared by StudioCue but not sent: "already on its way" was untrue for a
  // request still waiting on the venue's details (walked 2026-09-30).
  const notSentYet = Boolean(
    projectId &&
      requests.some(
        (request) =>
          request.projectId === projectId &&
          ["needs_details", "prepared", "self_serve"].includes(String(request.status)),
      ),
  );

  return (
    <div className="coi-workflow-panel">
      {openForThisJob && !requestAnother ? (
        <section className="panel coi-request-collapsed">
          <p>
            <strong>
              {notSentYet
                ? "StudioCue has started this job's certificate request."
                : "A certificate is already on its way for this job."}
            </strong>
            <small>
              {notSentYet
                ? "Finish it below; nothing has gone to your agent yet. A second venue? Request another."
                : "Its progress is below. A second venue, or a new certificate after a change? Request another."}
            </small>
          </p>
          <button className="button button-light" onClick={() => setRequestAnother(true)} type="button">
            <Send aria-hidden="true" size={15} /> Request another certificate
          </button>
        </section>
      ) : (
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">New requirement</p>
            <h2>
              Request a certificate <InfoHint term="coi" />
            </h2>
            <p>A unique reply route associates one inbound PDF with this project.</p>
          </div>
          <Send />
        </div>
        {/* Answered before the form, because the answer decides whether the
            form is needed at all. */}
        <div className="coi-requirement-choice" role="group" aria-label="Does this venue require a certificate?">
          <p>
            <strong>Does this venue require a certificate?</strong>
            <small>
              {requirement === "not_required"
                ? "Marked as not required — this job is not waiting on one."
                : requirement === "required"
                  ? "Marked as required."
                  : "Nobody has said yet. Check the venue contract."}
            </small>
          </p>
          <div className="coi-requirement-actions">
            <button
              className={requirement === "required" ? "button button-dark" : "button button-light"}
              disabled={settingRequirement || !selectedProject}
              onClick={() => void setRequirement("required")}
              type="button"
            >
              Yes, it does
            </button>
            <button
              className={requirement === "not_required" ? "button button-dark" : "button button-light"}
              disabled={settingRequirement || !selectedProject}
              onClick={() => void setRequirement("not_required")}
              type="button"
            >
              No — not required
            </button>
            {requirement !== "unknown" ? (
              <button
                className="button button-quiet"
                disabled={settingRequirement}
                onClick={() => void setRequirement("unknown")}
                type="button"
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>
        <form className="coi-request-form" onSubmit={(event) => void create(event)}>
          <label>
            Project
            {" "}{/* Controlled, not `defaultValue`. The options arrive from
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
              {liveProjects(projects).map((project) => (
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
            <input
              name="insuranceAgentEmail"
              placeholder={savedAgentEmail || undefined}
              required={!savedAgentEmail}
              type="email"
            />
            <small>
              {savedAgentEmail
                ? `Leave blank to use your saved agent, ${savedAgentEmail}.`
                : "Your own agent. Save them in Settings → Insurance and StudioCue asks for you."}
            </small>
          </label>
          <label>
            Venue submission email <span className="coi-optional">optional for now</span>
            <input name="submissionEmail" type="email" />
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
      )}
      <section>
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Certificates of insurance</p>
            <h2>
              {requests.length === 1 ? "This job’s certificate" : "Certificates"}
              <InfoHint label="Chasing your agent">
                {/* The studio's own numbers (Settings → Insurance). "Daily in
                    the last week" never happened with the defaults: the last
                    follow-up goes weeks before then. */}
                {`StudioCue follows up with your agent every ${chaseEveryDays} day${chaseEveryDays === 1 ? "" : "s"}, up to ${maxChases} time${maxChases === 1 ? "" : "s"}. Then it stops and tells you on Today — or sooner, 5 days before the due date.`}
              </InfoHint>
            </h2>
          </div>
        </div>
        <div className="coi-review-list">
          {requests
            .map((request) => {
              // Read back through today's rules: what was flagged when the
              // certificate arrived can include disagreements that were never
              // real, and those records are frozen.
              const discrepancies = (
                Array.isArray(request.discrepancies) ? request.discrepancies : []
              ).filter((item) => {
                const value =
                  typeof item === "object" && item !== null
                    ? (item as Record<string, unknown>)
                    : {};
                return stillDisagrees({
                  field: String(value.field ?? ""),
                  expected: String(value.expected ?? ""),
                  extracted: String(value.extracted ?? ""),
                  severity:
                    value.severity === "blocking" || value.severity === "info"
                      ? value.severity
                      : "warning",
                });
              });
              // Every status mapped (features/insurance/progress.ts): the
              // track once stayed empty for a certificate the venue had.
              const progress = coiProgress(request.status);
              return (
                <article className="panel" key={request.id}>
                  <header>
                    {/* The job and venue, never the record id (walked on prod: a
                        raw "coi_request_…" id was the title, and its width
                        pushed the badge and progress off the card). */}
                    <span>
                      <small>{String(request.venueName ?? "Venue")}</small>
                      <strong>
                        {String(
                          (projects ?? []).find((project) => project.id === request.projectId)?.name ??
                            "Certificate of insurance",
                        )}
                      </strong>
                    </span>
                    <StatusBadge tone={progress.tone}>
                      {statusLabel(request.status)}
                    </StatusBadge>
                  </header>
                  <div className="coi-status-track" aria-label="COI progress">
                    {progress.steps.map((step) => (
                      <span
                        className={
                          step.state === "complete"
                            ? "is-complete"
                            : step.state === "needs-action"
                              ? "needs-action"
                              : ""
                        }
                        key={step.key}
                      >
                        <i />
                        <small>{step.label}</small>
                      </span>
                    ))}
                  </div>
                  <ul className="coi-discrepancy-list">
                    {discrepancies.map((item, index) => {
                      const value =
                        typeof item === "object" && item !== null
                          ? (item as Record<string, unknown>)
                          : {};
                      // Field paths and cents are how this is stored, not how a
                      // person decides whether a certificate is good enough.
                      const said = describeDiscrepancy({
                        field: String(value.field ?? ""),
                        expected: String(value.expected ?? ""),
                        extracted: String(value.extracted ?? ""),
                        severity:
                          value.severity === "blocking" || value.severity === "info"
                            ? value.severity
                            : "warning",
                      });
                      return (
                        <li
                          data-severity={said.severity}
                          key={`${String(value.field)}-${index}`}
                        >
                          <ShieldCheck size={14} />
                          <span>
                            <strong>{said.label}</strong>
                            <small>{said.detail}</small>
                          </span>
                        </li>
                      );
                    })}
                    {/* Nothing to flag until a certificate has come back and
                        been read. */}
                    {!discrepancies.length &&
                    ["under_review", "approved", "sent_to_venue", "venue_acknowledged"].includes(String(request.status)) ? <li><ShieldCheck size={14} /><span><strong>Nothing flagged</strong><small>Read it yourself before approving — StudioCue never decides whether a certificate is legally sufficient.</small></span></li> : null}
                  </ul>
                  {/* Every status has its one next step (H3): approve the
                      prepared request, fill in the venue, make it in the
                      insurer's portal, or approve and send it to the venue. */}
                  <CoiRequestActions
                    request={request as Record<string, unknown> & { id: string }}
                    requirement={(requirements ?? []).find((item) => item.id === request.requirementId)}
                    settings={coiSettings}
                  />
                </article>
              );
            })}
        </div>
      </section>
      {notice ? <p className="form-notice" role="status">{notice}</p> : null}
    </div>
  );
}
