"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Send,
  Sparkles,
  UserRoundSearch,
} from "lucide-react";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  rankCrewCandidates,
  type CrewCandidateInput,
} from "@/features/crew/cascade";
import { sendCrewCommand } from "@/lib/crew/command-client";

const text = (value: unknown) =>
  typeof value === "string" ? value : "";
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const localDateTime = (value: Date) => {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.valueOf() - offset).toISOString().slice(0, 16);
};
const safeIso = (value: string) => {
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf())
    ? parsed.toISOString()
    : new Date().toISOString();
};

export function CrewCascadeWorkspace({ projectId }: { projectId: string }) {
  const { records: projects } = useTenantDocuments("projects");
  const { records: profiles, loading } = useTenantDocuments("crewProfiles");
  const { records: availability } = useTenantDocuments("crewAvailability");
  const { records: assignments } = useTenantDocuments("crewAssignments");
  const { records: schedules } = useTenantDocuments("schedules");
  const { records: cascades } = useTenantDocuments("crewCascades");
  const project = projects?.find((item) => item.id === projectId);
  const eventDate = text(project?.eventDate) || new Date().toISOString().slice(0, 10);
  const initialStart = new Date(`${eventDate}T12:00:00`);
  const initialEnd = new Date(`${eventDate}T20:00:00`);
  const [role, setRole] = useState("Second photographer");
  const [specialty, setSpecialty] = useState("weddings");
  const [startsAt, setStartsAt] = useState(localDateTime(initialStart));
  const [endsAt, setEndsAt] = useState(localDateTime(initialEnd));
  const [compensationDollars, setCompensationDollars] = useState("800");
  const [responsibilities, setResponsibilities] = useState(
    "Ceremony reactions\nCocktail-hour candids\nBackup primary photographer",
  );
  const [defaultsHydrated, setDefaultsHydrated] = useState(false);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [manualOrder, setManualOrder] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const recommendations = useMemo(() => {
    if (!profiles) return [];
    const inputs: CrewCandidateInput[] = profiles.map((profile) => ({
      id: profile.id,
      name: text(profile.name) || "Crew member",
      active: profile.active === true,
      specialties: list(profile.specialties).map(String),
      serviceAreas: list(profile.serviceAreas).map(String),
      travelRadiusMiles: Number(profile.travelRadiusMiles ?? 0),
      preferenceRank:
        Number.isFinite(Number(profile.preferenceRank))
          ? Number(profile.preferenceRank)
          : null,
      w9Status: text(profile.w9Status),
      insuranceStatus: text(profile.insuranceStatus),
      contractStatus: text(profile.contractStatus),
      availability: (availability ?? [])
        .filter((item) => item.crewProfileId === profile.id)
        .flatMap((item) =>
          ["available", "unavailable", "tentative"].includes(text(item.status))
            ? [
                {
                  startsAt: text(item.startsAt),
                  endsAt: text(item.endsAt),
                  status: text(item.status) as
                    | "available"
                    | "unavailable"
                    | "tentative",
                },
              ]
            : [],
        ),
      acceptedAssignments: (assignments ?? [])
        .filter(
          (item) =>
            item.crewProfileId === profile.id && item.status === "accepted",
        )
        .map((item) => ({
          startsAt: text(item.arrivalAt),
          endsAt: text(item.departureAt),
        })),
    }));
    const ranked = rankCrewCandidates({
      roleSpecialty: specialty,
      serviceArea: text(project?.city),
      startsAt: safeIso(startsAt),
      endsAt: safeIso(endsAt),
      candidates: inputs,
    });
    const rank = new Map(manualOrder.map((id, index) => [id, index]));
    return [...ranked].sort((left, right) => {
      const leftRank = rank.get(left.crewProfileId);
      const rightRank = rank.get(right.crewProfileId);
      if (leftRank !== undefined || rightRank !== undefined)
        return (
          (leftRank ?? Number.MAX_SAFE_INTEGER) -
          (rightRank ?? Number.MAX_SAFE_INTEGER)
        );
      return 0;
    });
  }, [
    assignments,
    availability,
    endsAt,
    manualOrder,
    profiles,
    project?.city,
    specialty,
    startsAt,
  ]);
  const included = recommendations.filter(
    (candidate) =>
      candidate.eligible && !excluded.has(candidate.crewProfileId),
  );
  const latestSchedule = [...(schedules ?? [])]
    .filter(
      (schedule) =>
        schedule.projectId === projectId &&
        !["superseded", "archived"].includes(String(schedule.status)),
    )
    .sort((left, right) => Number(right.version) - Number(left.version))[0];
  const projectCascades =
    cascades?.filter((cascade) => cascade.projectId === projectId) ?? [];

  useEffect(() => {
    if (
      defaultsHydrated ||
      !project ||
      !profiles ||
      !schedules
    ) {
      return;
    }
    const items = list(latestSchedule?.items)
      .map(record)
      .filter(
        (item) =>
          Number.isFinite(Date.parse(text(item.startAt))) &&
          Number.isFinite(Date.parse(text(item.endAt))),
      )
      .sort(
        (left, right) =>
          Date.parse(text(left.startAt)) - Date.parse(text(right.startAt)),
      );
    const firstItem = items[0];
    const lastItem = items.at(-1);
    const nextStart = firstItem
      ? localDateTime(new Date(text(firstItem.startAt)))
      : localDateTime(new Date(`${eventDate}T12:00:00`));
    const nextEnd = lastItem
      ? localDateTime(new Date(text(lastItem.endAt)))
      : localDateTime(new Date(`${eventDate}T20:00:00`));
    const preferredProfile =
      profiles.find(
        (profile) =>
          profile.active === true &&
          list(profile.specialties).map(String).includes(specialty),
      ) ?? profiles.find((profile) => profile.active === true);
    const rateCents = Number(preferredProfile?.rateCents);
    const scheduleResponsibilities = items
      .map((item) => text(item.title))
      .filter(Boolean);

    const frame = requestAnimationFrame(() => {
      setStartsAt(nextStart);
      setEndsAt(nextEnd);
      if (Number.isFinite(rateCents) && rateCents >= 0) {
        setCompensationDollars(String(rateCents / 100));
      }
      if (scheduleResponsibilities.length) {
        setResponsibilities(scheduleResponsibilities.join("\n"));
      }
      setDefaultsHydrated(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [
    defaultsHydrated,
    eventDate,
    latestSchedule,
    profiles,
    project,
    schedules,
    specialty,
  ]);

  function move(candidateId: string, direction: -1 | 1) {
    const ids = included.map((candidate) => candidate.crewProfileId);
    const index = ids.indexOf(candidateId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    setManualOrder(ids);
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!included.length) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setNotice(null);
    try {
      const result = await sendCrewCommand("createCrewCascade", {
        projectId,
        role,
        candidateIds: included.map((candidate) => candidate.crewProfileId),
        responseWindowHours: Number(form.get("responseWindowHours")),
        compensationCents: Math.round(
          Number(form.get("compensationDollars")) * 100,
        ),
        compensationType: "event",
        currency: "USD",
        compensationVisibleToCrew: true,
        arrivalAt: new Date(startsAt).toISOString(),
        departureAt: new Date(endsAt).toISOString(),
        locations: [
          {
            name: text(project?.venueName) || "Event location",
            address: text(project?.venueAddress) || null,
          },
        ],
        responsibilities: text(form.get("responsibilities"))
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean),
        scheduleItemIds: [],
        currentScheduleId: latestSchedule?.id ?? null,
        currentScheduleVersion: Number(latestSchedule?.version ?? 0),
        requirements: [
          {
            id: "w9",
            name: "W-9 on file",
            kind: "w9",
            required: true,
            dueAt: null,
          },
          {
            id: "insurance",
            name: "Liability insurance",
            kind: "insurance",
            required: true,
            dueAt: null,
          },
          {
            id: "schedule",
            name: "Current schedule acknowledged",
            kind: "acknowledgement",
            required: true,
            dueAt: null,
          },
        ],
      });
      setNotice(
        result.persisted
          ? "Cascade started. Only the first approved candidate received an offer."
          : "Development preview validated the candidate order without sending an offer.",
      );
    } catch (caught: unknown) {
      setNotice(
        caught instanceof Error ? caught.message : "Crew cascade could not start.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="crew-cascade-workspace">
      <header className="crew-cascade-hero">
        <div>
          <p className="eyebrow">AI-assisted staffing</p>
          <h2>Fill a role in one reviewed cascade</h2>
          <p>
            StudioCue ranks eligible collaborators from role, availability,
            conflicts, travel, studio preference, and document readiness. You
            control the final order.
          </p>
        </div>
        <Sparkles aria-hidden="true" />
      </header>
      <form className="panel crew-cascade-form" onSubmit={(event) => void create(event)}>
        <div className="crew-cascade-config">
          <label>
            Role
            <input
              onChange={(event) => setRole(event.target.value)}
              value={role}
            />
          </label>
          <label>
            Required specialty
            <select
              onChange={(event) => setSpecialty(event.target.value)}
              value={specialty}
            >
              <option value="weddings">Weddings</option>
              <option value="video">Video</option>
              <option value="assistant">Assistant</option>
              <option value="corporate">Corporate</option>
              <option value="sports">Sports</option>
            </select>
          </label>
          <label>
            Arrival
            <input
              onChange={(event) => setStartsAt(event.target.value)}
              type="datetime-local"
              value={startsAt}
            />
          </label>
          <label>
            Departure
            <input
              onChange={(event) => setEndsAt(event.target.value)}
              type="datetime-local"
              value={endsAt}
            />
          </label>
          <label>
            Event rate
            <input
              min="0"
              name="compensationDollars"
              onChange={(event) => setCompensationDollars(event.target.value)}
              type="number"
              value={compensationDollars}
            />
          </label>
          <label>
            Response window
            <select defaultValue="24" name="responseWindowHours">
              <option value="12">12 hours</option>
              <option value="24">24 hours</option>
              <option value="48">48 hours</option>
              <option value="72">72 hours</option>
            </select>
          </label>
          <label className="form-span">
            Responsibilities, one per line
            <textarea
              name="responsibilities"
              onChange={(event) => setResponsibilities(event.target.value)}
              value={responsibilities}
            />
          </label>
          <p className="form-notice form-span">
            Times come from the current schedule, rate from the crew profile,
            and responsibilities from scheduled coverage. Review the suggested
            order, then approve the cascade.
          </p>
        </div>
        <div className="crew-recommendation-heading">
          <span>
            <UserRoundSearch />
            <strong>Recommended order</strong>
            <small>
              {included.length} eligible ·{" "}
              {recommendations.filter((candidate) => !candidate.eligible).length} excluded by hard gates
            </small>
          </span>
          <StatusBadge tone={included.length ? "success" : "warning"}>
            {loading ? "Ranking…" : included.length ? "Ready to review" : "Needs candidates"}
          </StatusBadge>
        </div>
        <div className="crew-recommendation-list">
          {recommendations.map((candidate) => {
            const isExcluded =
              excluded.has(candidate.crewProfileId) || !candidate.eligible;
            const includedIndex = included.findIndex(
              (item) => item.crewProfileId === candidate.crewProfileId,
            );
            return (
              <article
                className={
                  isExcluded ? "is-excluded" : "is-included"
                }
                key={candidate.crewProfileId}
              >
                <span className="crew-rank">
                  {candidate.eligible && !isExcluded ? includedIndex + 1 : "—"}
                </span>
                <div>
                  <strong>{candidate.name}</strong>
                  <small>{candidate.explanations.join(" · ")}</small>
                  {candidate.incompleteProfile.length ? (
                    <em>
                      <CircleAlert size={12} /> Complete:{" "}
                      {candidate.incompleteProfile.join(", ")}
                    </em>
                  ) : (
                    <em className="is-complete">
                      <CheckCircle2 size={12} /> Profile complete
                    </em>
                  )}
                  {candidate.exclusions.length ? (
                    <em>{candidate.exclusions.join(" · ")}</em>
                  ) : null}
                </div>
                <b>{candidate.score}</b>
                {candidate.eligible ? (
                  <footer>
                    <button
                      aria-label={`Move ${candidate.name} up`}
                      disabled={isExcluded || includedIndex <= 0}
                      onClick={() => move(candidate.crewProfileId, -1)}
                      type="button"
                    >
                      <ArrowUp />
                    </button>
                    <button
                      aria-label={`Move ${candidate.name} down`}
                      disabled={
                        isExcluded || includedIndex === included.length - 1
                      }
                      onClick={() => move(candidate.crewProfileId, 1)}
                      type="button"
                    >
                      <ArrowDown />
                    </button>
                    <button
                      onClick={() =>
                        setExcluded((current) => {
                          const next = new Set(current);
                          if (next.has(candidate.crewProfileId))
                            next.delete(candidate.crewProfileId);
                          else next.add(candidate.crewProfileId);
                          return next;
                        })
                      }
                      type="button"
                    >
                      {excluded.has(candidate.crewProfileId)
                        ? "Include"
                        : "Exclude"}
                    </button>
                  </footer>
                ) : null}
              </article>
            );
          })}
        </div>
        <div className="crew-cascade-boundary">
          <Clock3 />
          <span>
            <strong>Sequential release</strong>
            <small>
              One person sees the offer at a time. Acceptance stops the
              cascade; a decline or expiry advances it.
            </small>
          </span>
          <button
            className="button button-dark"
            disabled={busy || !included.length}
            type="submit"
          >
            <Send /> {busy ? "Starting…" : "Approve order and start"}
          </button>
        </div>
        {notice ? <p className="form-notice" role="status">{notice}</p> : null}
      </form>
      {projectCascades.length ? (
        <div className="crew-cascade-statuses">
          {projectCascades.map((cascade) => (
            <article className="panel" key={cascade.id}>
              <span>
                <strong>{text(cascade.role)}</strong>
                <small>
                  Candidate {Number(cascade.currentCandidateIndex ?? 0) + 1} of{" "}
                  {list(cascade.candidateIds).length}
                </small>
              </span>
              <StatusBadge
                tone={
                  cascade.status === "filled"
                    ? "success"
                    : cascade.status === "exhausted"
                      ? "danger"
                      : "warning"
                }
              >
                {text(cascade.status)}
              </StatusBadge>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
