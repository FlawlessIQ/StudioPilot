"use client";

import { useState } from "react";
import { LoaderCircle, PackageOpen, Send, Users } from "lucide-react";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { sendCrewCommand } from "@/lib/crew/command-client";
import { runCrmCommand } from "@/lib/crm/command-client";
import { crewPublicError } from "@/lib/crew/public-error";
import {
  rankCrewCandidates,
  type CrewCandidateInput,
} from "@/features/crew/cascade";
import type { CopilotFlow } from "@/lib/ai/copilot-client";

const str = (value: unknown) => (typeof value === "string" ? value : "");
const num = (value: unknown) => (typeof value === "number" ? value : 0);
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/**
 * A copilot-launched conversational flow: gather → select → form → act. The
 * model only chose the flow type + project; every option shown is a real record,
 * the operator makes the choices and types any money, and the final tap runs the
 * real command. Nothing the model can't be trusted with is authored by the model.
 */
export function FlowRunner({ flow }: { flow: CopilotFlow }) {
  if (flow.type === "crew_offer") return <CrewOfferFlow flow={flow} />;
  if (flow.type === "select_package") return <PackageSelectFlow flow={flow} />;
  return null;
}

const dollars = (cents: unknown) =>
  `$${(num(cents) / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

/**
 * gather → select → act for choosing a project's package. Prices come from the
 * package records (never the model); selecting one creates the immutable
 * package snapshot the proposal is later built from.
 */
function PackageSelectFlow({ flow }: { flow: CopilotFlow }) {
  const projectId = flow.projectId;
  const { records: projects } = useTenantDocuments("projects");
  const { records: packages } = useTenantDocuments("packages");
  const project = (projects ?? []).find((item) => item.id === projectId);
  const alreadySelected = Boolean(str(project?.packageSnapshotId));
  const eventTypeId = str(project?.eventTypeId);

  // Active packages, preferring ones matching the project's event type.
  const options = (packages ?? [])
    .filter((p) => p.active === true)
    .filter((p) => !eventTypeId || str(p.eventTypeId) === eventTypeId || !str(p.eventTypeId))
    .sort((a, b) => num(a.displayOrder) - num(b.displayOrder));

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function apply(packageId: string, name: string) {
    setBusy(true);
    setNotice(null);
    try {
      const response = await runCrmCommand("selectPackage", {
        projectId,
        packageId,
        selectedAddOns: [],
      });
      if (response.persisted) setDone(name);
      else setNotice("Preview: the package would be selected from here.");
    } catch (caught: unknown) {
      setNotice(
        caught instanceof Error
          ? caught.message.replaceAll("_", " ")
          : "The package could not be selected.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="panel copilot-flow">
        <p role="status">
          Selected {done} for {str(project?.name) || "the project"}. You can now
          prepare a proposal from it.
        </p>
      </div>
    );
  }

  return (
    <div className="panel copilot-flow">
      <header className="copilot-flow-head">
        <PackageOpen size={15} />
        <span>
          <strong>{flow.title}</strong>
          <small>{flow.reason}</small>
        </span>
      </header>
      {alreadySelected ? (
        <p role="status">
          {str(project?.name) || "This project"} already has a package selected.
        </p>
      ) : options.length === 0 ? (
        <p role="status">No active packages to choose from yet.</p>
      ) : (
        <div className="copilot-flow-options">
          {options.map((option) => (
            <button
              key={str(option.id)}
              className="copilot-flow-option"
              disabled={busy}
              onClick={() => void apply(str(option.id), str(option.name))}
              type="button"
            >
              <strong>
                {str(option.name)} · {dollars(option.basePriceCents)}
              </strong>
              {str(option.eventTypeLabel) ? (
                <small>{str(option.eventTypeLabel)}</small>
              ) : null}
            </button>
          ))}
        </div>
      )}
      {notice ? <p role="status">{notice}</p> : null}
    </div>
  );
}

// Map a project's event type to the crew specialty the ranker matches on.
const SPECIALTY: Record<string, string> = {
  Wedding: "weddings",
  Corporate: "corporate",
  Sports: "sports",
};

type Requirement = {
  id: string;
  name: string;
  kind: "w9" | "insurance" | "acknowledgement";
  required: boolean;
  dueAt: string | null;
  instructions: string;
};

// The same obligations a cascade or direct offer carries, so every path agrees.
const REQUIREMENTS: Requirement[] = [
  { id: "w9", name: "W-9 on file", kind: "w9", required: true, dueAt: null, instructions: "Upload a current signed W-9 for studio review." },
  { id: "insurance", name: "Liability insurance", kind: "insurance", required: true, dueAt: null, instructions: "Upload a current certificate of liability insurance." },
  { id: "schedule", name: "Current schedule acknowledged", kind: "acknowledgement", required: true, dueAt: null, instructions: "Review and acknowledge the current schedule before event day." },
];

function CrewOfferFlow({ flow }: { flow: CopilotFlow }) {
  const projectId = flow.projectId;
  const { records: projects } = useTenantDocuments("projects");
  const { records: profiles } = useTenantDocuments("crewProfiles");
  const { records: availability } = useTenantDocuments("crewAvailability");
  const { records: assignments } = useTenantDocuments("crewAssignments");
  const { records: schedules } = useTenantDocuments("schedules");

  const project = (projects ?? []).find((item) => item.id === projectId);
  const eventDate = str(project?.eventDate) || new Date().toISOString().slice(0, 10);
  const startsAt = new Date(`${eventDate}T12:00:00`).toISOString();
  const endsAt = new Date(`${eventDate}T20:00:00`).toISOString();
  const roleSpecialty = SPECIALTY[str(project?.eventType)] ?? "events";
  const serviceArea = str(project?.city);

  const latestSchedule = (schedules ?? [])
    .filter((item) => item.projectId === projectId)
    .filter((item) => !["superseded", "archived"].includes(str(item.status)))
    .sort((a, b) => num(b.version) - num(a.version))[0];

  // Anyone already offered or booked on this job is not a candidate for a
  // second offer on it — the server would happily write a duplicate. (The React
  // Compiler memoizes these derivations; no manual useMemo.)
  const spokenFor = new Set<string>();
  for (const item of assignments ?? []) {
    if (item.projectId === projectId && !["declined", "cancelled"].includes(str(item.status)))
      spokenFor.add(str(item.crewProfileId));
  }

  // Candidate assembly + ranking mirrors the crew cascade workspace, so the
  // copilot flow and that screen agree on who is available.
  const candidates: CrewCandidateInput[] = (profiles ?? [])
    .filter((p) => p.active === true)
    .map((p) => ({
      id: str(p.id),
      name: str(p.name),
      active: p.active === true,
      specialties: arr(p.specialties).map(String),
      serviceAreas: arr(p.serviceAreas).map(String),
      travelRadiusMiles: num(p.travelRadiusMiles),
      preferenceRank: typeof p.preferenceRank === "number" ? p.preferenceRank : null,
      w9Status: str(p.w9Status) || "unknown",
      insuranceStatus: str(p.insuranceStatus) || "unknown",
      contractStatus: str(p.contractStatus) || "unknown",
      availability: (availability ?? [])
        .filter((av) => av.crewProfileId === p.id)
        .map((av) => ({
          startsAt: str(av.startsAt),
          endsAt: str(av.endsAt),
          status: (str(av.status) || "available") as
            | "available"
            | "unavailable"
            | "tentative",
        })),
      acceptedAssignments: (assignments ?? [])
        .filter((a) => a.crewProfileId === p.id && str(a.status) === "accepted")
        .map((a) => ({ startsAt: str(a.arrivalAt), endsAt: str(a.departureAt) })),
    }));
  const ranked = rankCrewCandidates({
    roleSpecialty,
    serviceArea,
    startsAt,
    endsAt,
    candidates,
  }).filter((candidate) => !spokenFor.has(candidate.crewProfileId));

  const [step, setStep] = useState<"select" | "form">("select");
  const [selected, setSelected] = useState<string[]>([]);
  const [role, setRole] = useState("Second photographer");
  const [rate, setRate] = useState("");
  const [windowHours, setWindowHours] = useState("48");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const profileById = (id: string) => (profiles ?? []).find((p) => p.id === id);
  // Selected candidates, kept in the ranker's order — that order is the cascade
  // order (offer to the top pick first, then down the list).
  const orderedIds = ranked
    .map((c) => c.crewProfileId)
    .filter((id) => selected.includes(id));
  const firstProfile = orderedIds[0] ? profileById(orderedIds[0]) : undefined;
  const isCascade = orderedIds.length > 1;

  function toggle(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function proceed() {
    const first = orderedIds[0] ? profileById(orderedIds[0]) : undefined;
    setRate(first ? String(Math.round(num(first.rateCents) / 100)) : "");
    setStep("form");
    setNotice(null);
  }

  async function send() {
    const ids = orderedIds;
    const first = ids[0] ? profileById(ids[0]) : undefined;
    if (!ids.length || !first) return;
    setBusy(true);
    setNotice(null);
    // Terms shared by a single offer and a cascade; the operator authors the pay.
    const terms = {
      projectId,
      role,
      compensationCents: Math.round(Number(rate || 0) * 100),
      compensationType: str(first.rateType) === "hourly" ? "hourly" : "event",
      currency: "USD",
      compensationVisibleToCrew: true,
      arrivalAt: startsAt,
      departureAt: endsAt,
      locations: [
        {
          name: str(project?.venueName) || "Event location",
          address:
            str((project?.venue as Record<string, unknown> | undefined)?.formatted) || null,
        },
      ],
      responsibilities: arr(latestSchedule?.items)
        .map((it) => str((it as Record<string, unknown>).title))
        .filter(Boolean),
      scheduleItemIds: [],
      currentScheduleId: latestSchedule ? str(latestSchedule.id) : null,
      currentScheduleVersion: num(latestSchedule?.version),
      requirements: REQUIREMENTS,
    };
    try {
      if (ids.length === 1) {
        const response = await sendCrewCommand("inviteAssignment", {
          ...terms,
          crewProfileId: ids[0],
          userId: str(first.userId) || null,
        });
        if (response.persisted) setSent(`Offer sent to ${str(first.name)}.`);
        else setNotice("Preview: the offer would be sent from here.");
      } else {
        const hours = Math.min(168, Math.max(1, Math.round(Number(windowHours) || 48)));
        const response = await sendCrewCommand("createCrewCascade", {
          ...terms,
          candidateIds: ids,
          responseWindowHours: hours,
        });
        if (response.persisted)
          setSent(
            `Cascade started — offered to ${str(first.name)} first; if they pass, the next in line is offered automatically (each has ${hours}h).`,
          );
        else setNotice("Preview: the cascade would start from here.");
      }
    } catch (caught: unknown) {
      setNotice(crewPublicError(caught, "The offer could not be sent."));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="panel copilot-flow">
        <p role="status">
          {sent} They&rsquo;ll get an email to accept or decline — nothing changes
          on the job until they respond.
        </p>
      </div>
    );
  }

  return (
    <div className="panel copilot-flow">
      <header className="copilot-flow-head">
        <Users size={15} />
        <span>
          <strong>{flow.title}</strong>
          <small>{flow.reason}</small>
        </span>
      </header>

      {step === "select" ? (
        <>
          <div className="copilot-flow-options">
            {ranked.length === 0 ? (
              <p role="status">
                No available crew to offer for {str(project?.name) || "this project"}{" "}
                right now. Crew set their own availability for the event window.
              </p>
            ) : (
              ranked.map((candidate) => {
                const picked = selected.includes(candidate.crewProfileId);
                return (
                  <button
                    key={candidate.crewProfileId}
                    className={`copilot-flow-option${picked ? " is-picked" : ""}`}
                    disabled={!candidate.eligible}
                    aria-pressed={picked}
                    onClick={() => toggle(candidate.crewProfileId)}
                    type="button"
                  >
                    <strong>
                      {picked ? "✓ " : ""}
                      {candidate.name}
                    </strong>
                    {candidate.explanations[0] ? (
                      <small>{candidate.explanations[0]}</small>
                    ) : null}
                    {!candidate.eligible && candidate.exclusions[0] ? (
                      <small className="cp-attn-tag warning">
                        {candidate.exclusions[0]}
                      </small>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
          {orderedIds.length > 0 ? (
            <div className="copilot-flow-actions">
              <button className="button button-dark" onClick={proceed} type="button">
                Continue with {orderedIds.length}{" "}
                {orderedIds.length === 1 ? "candidate" : "candidates in order"}
              </button>
              {orderedIds.length > 1 ? (
                <small>Offered one at a time, top pick first.</small>
              ) : null}
            </div>
          ) : ranked.length ? (
            <small>Pick one to offer directly, or several to cascade in order.</small>
          ) : null}
        </>
      ) : (
        <div className="copilot-flow-form">
          <p>
            {isCascade ? (
              <>
                Cascade to{" "}
                <strong>
                  {orderedIds
                    .map((id) => str(profileById(id)?.name))
                    .filter(Boolean)
                    .join(" → ")}
                </strong>
                . Set the terms — approving offers the first in line, then the next
                automatically if they pass.
              </>
            ) : (
              <>
                Offer to <strong>{str(firstProfile?.name)}</strong>. Set the terms —
                approving sends them the offer to accept or decline.
              </>
            )}
          </p>
          <label>
            <span>Role</span>
            <input value={role} onChange={(e) => setRole(e.target.value)} />
          </label>
          <label>
            <span>
              Pay ({str(firstProfile?.rateType) === "hourly" ? "per hour" : "for the event"}, USD)
            </span>
            <input
              inputMode="decimal"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              placeholder="e.g. 500"
            />
          </label>
          {isCascade ? (
            <label>
              <span>Hours each candidate has to respond</span>
              <input
                inputMode="numeric"
                value={windowHours}
                onChange={(e) => setWindowHours(e.target.value)}
                placeholder="48"
              />
            </label>
          ) : null}
          <small>
            {eventDate} · {str(project?.venueName) || "event location"}
          </small>
          <div className="copilot-flow-actions">
            <button
              className="button button-dark"
              disabled={busy || !rate.trim()}
              onClick={() => void send()}
              type="button"
            >
              {busy ? <LoaderCircle className="spin" size={14} /> : <Send size={14} />}
              {isCascade
                ? `Start cascade (${orderedIds.length})`
                : `Send offer to ${str(firstProfile?.name).split(" ")[0] || "them"}`}
            </button>
            <button disabled={busy} onClick={() => setStep("select")} type="button">
              Back
            </button>
          </div>
        </div>
      )}
      {notice ? <p role="status">{notice}</p> : null}
    </div>
  );
}
