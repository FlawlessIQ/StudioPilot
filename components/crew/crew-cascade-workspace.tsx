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
  UserRoundCheck,
  UserRoundSearch,
} from "lucide-react";
import Link from "next/link";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { useReturnToJob } from "@/lib/projects/return-to-job";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  rankCrewCandidates,
  type CrewCandidateInput,
} from "@/features/crew/cascade";
import { daysUntilEvent } from "@/lib/format/event-date";
import { sendCrewCommand } from "@/lib/crew/command-client";
import { crewPublicError } from "@/lib/crew/public-error";
import { statusLabel } from "@/features/format/status-label";

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
  const returnToJob = useReturnToJob(projectId);
  const { records: projects } = useTenantDocuments("projects");
  const { records: profiles, loading } = useTenantDocuments("crewProfiles");
  const { records: availability } = useTenantDocuments("crewAvailability");
  const { records: assignments } = useTenantDocuments("crewAssignments");
  const { records: schedules } = useTenantDocuments("schedules");
  const { records: cascades } = useTenantDocuments("crewCascades");
  const { records: packageSnapshots } = useTenantDocuments("packageSnapshots");
  const project = projects?.find((item) => item.id === projectId);
  const eventDate = text(project?.eventDate) || new Date().toISOString().slice(0, 10);
  const initialStart = new Date(`${eventDate}T12:00:00`);
  const initialEnd = new Date(`${eventDate}T20:00:00`);
  const [rolesText, setRolesText] = useState("Second photographer");
  const [specialty, setSpecialty] = useState("weddings");
  const [startsAt, setStartsAt] = useState(localDateTime(initialStart));
  const [endsAt, setEndsAt] = useState(localDateTime(initialEnd));
  const [compensationDollars, setCompensationDollars] = useState("800");
  const [responsibilities, setResponsibilities] = useState(
    "Ceremony reactions\nCocktail-hour candids\nBackup primary photographer",
  );
  const [defaultsHydrated, setDefaultsHydrated] = useState(false);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [restartOpen, setRestartOpen] = useState(false);
  const [responseWindowHours, setResponseWindowHours] = useState("24");

  const [requesting, setRequesting] = useState<string | null>(null);
  const [requested, setRequested] = useState<Set<string>>(new Set());
  /**
   * Paperwork the person has to send, as opposed to profile fields the studio
   * can fill in itself.
   *
   * `incompleteProfile` lumps both together, so a row read
   * "Complete: travel radius, W-9, insurance" — one of which the studio fixes
   * by editing a profile and two of which need the crew member to act. One
   * label for two different remedies is why nobody knew what to do next.
   */
  const CREW_SUPPLIED = ["W-9", "insurance", "crew agreement"];
  const splitBlockers = (items: readonly string[]) => ({
    theirs: items.filter((item) => CREW_SUPPLIED.includes(item)),
    yours: items.filter((item) => !CREW_SUPPLIED.includes(item)),
  });

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
  // What is already happening on this job. The screen used to open on a
  // blank staffing form regardless — inviting the photographer to start work
  // that was already offered and waiting on someone's reply.
  const projectAssignments = (assignments ?? []).filter(
    (item) => item.projectId === projectId,
  );
  // "invited" and "viewed" are what an outstanding offer actually is —
  // functions/src/crew/commands.ts writes "invited" on release, and the
  // portal marks it "viewed" when the person opens it. This filtered on
  // "offered", which is not in assignmentStatusSchema at all, so the
  // waiting state never fired outside the demo that shared the mistake.
  const awaitingReply = projectAssignments.filter((item) =>
    ["invited", "viewed"].includes(String(item.status)),
  );
  const acceptedHere = projectAssignments.filter(
    (item) => String(item.status) === "accepted",
  );
  const staffingInFlight =
    awaitingReply.length > 0 ||
    projectCascades.some((cascade) => String(cascade.status) === "active");
  /**
   * A cascade that ran out of people.
   *
   * `staffingInFlight` covers an offer that is still out, and collapses the
   * form so the page does not invite a second plan on top of it. It says
   * nothing about a cascade that finished with nobody accepting — so the page
   * went back to opening on a blank form while ALSO showing "Nobody accepted"
   * below it and an assignment chipped "expired" further down. Three answers
   * to "is this role filled?" on one screen, and no way to act on the only
   * one that mattered.
   */
  const stalledCascades = projectCascades.filter(
    (cascade) => String(cascade.status) === "exhausted",
  );
  const filledRoles = new Set(
    acceptedHere.map((item) => text(item.role)).filter(Boolean),
  );
  // Only stalled if nobody has since been placed in that role by another route.
  const openStalled = stalledCascades.filter(
    (cascade) => !filledRoles.has(text(cascade.role)),
  );
  const formCollapsed = staffingInFlight || openStalled.length > 0;
  /**
   * The people this cascade never got to.
   *
   * Offering "to someone else" means the candidates after the one it stopped
   * on — not starting from the top again, which would re-ask people who
   * already declined.
   */
  const untriedFor = (cascade: Record<string, unknown>): string[] => {
    const ordered = list(cascade.candidateIds).map(text).filter(Boolean);
    const reached = Number(cascade.currentCandidateIndex ?? 0);
    return ordered.slice(reached + 1);
  };
  // Ranking someone the studio cannot offer the job to reads as a bug. The
  // count in the heading already says how many were ruled out; the people
  // themselves belong behind it, not interleaved with the shortlist carrying
  // scores and a "—" where their rank would be.
  const ruledOut = recommendations.filter((candidate) => !candidate.eligible);
  const shortlist = recommendations.filter((candidate) => candidate.eligible);
  // Who in the shortlist still cannot legally work the job.
  const paperworkPending = included.filter(
    (candidate) => splitBlockers(candidate.incompleteProfile).theirs.length,
  );
  // `daysUntilEvent` already exists and already handles the timezone
  // question its own comment describes. A second implementation here would
  // be a third answer to "how many days away is this?".
  const daysToEvent = useMemo(() => {
    const days = daysUntilEvent(eventDate);
    return days !== null && days >= 0 ? days : null;
  }, [eventDate]);
  const profileEmail = (crewProfileId: string) =>
    text(
      (profiles ?? []).find((profile) => profile.id === crewProfileId)?.email,
    );

  async function requestPaperwork(crewProfileId: string) {
    setRequesting(crewProfileId);
    try {
      await sendCrewCommand("inviteCrewProfile", { crewProfileId });
      setRequested((current) => new Set(current).add(crewProfileId));
    } catch (caught: unknown) {
      setNotice(crewPublicError(caught, "That request could not be sent."));
    } finally {
      setRequesting(null);
    }
  }

  const roles = rolesText
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);
  const rolePlans = roles.map((plannedRole, roleIndex) => ({
    role: plannedRole,
    candidates: included.filter(
      (_candidate, candidateIndex) => candidateIndex % roles.length === roleIndex,
    ),
  }));

  useEffect(() => {
    if (
      defaultsHydrated ||
      !project ||
      !profiles ||
      !schedules ||
      !packageSnapshots
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
    const packageSnapshot = packageSnapshots.find(
      (snapshot) =>
        snapshot.id === project.packageSnapshotId ||
        snapshot.projectId === projectId,
    );
    const photographerCount = Math.max(
      1,
      Number(packageSnapshot?.includedPhotographers ?? 1),
    );
    const suggestedRoles = Array.from(
      { length: Math.max(1, photographerCount - 1) },
      (_value, index) =>
        index === 0 ? "Second photographer" : `Photographer ${index + 2}`,
    );

    const frame = requestAnimationFrame(() => {
      setStartsAt(nextStart);
      setEndsAt(nextEnd);
      if (Number.isFinite(rateCents) && rateCents >= 0) {
        setCompensationDollars(String(rateCents / 100));
      }
      if (scheduleResponsibilities.length) {
        setResponsibilities(scheduleResponsibilities.join("\n"));
      }
      setRolesText(suggestedRoles.join("\n"));
      setDefaultsHydrated(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [
    defaultsHydrated,
    eventDate,
    latestSchedule,
    packageSnapshots,
    profiles,
    project,
    projectId,
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
    if (!included.length || !roles.length || rolePlans.some((plan) => !plan.candidates.length)) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setNotice(null);
    try {
      const shared = {
        projectId,
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
            instructions: "Upload a current signed W-9 for studio review.",
          },
          {
            id: "insurance",
            name: "Liability insurance",
            kind: "insurance",
            required: true,
            dueAt: null,
            instructions: "Upload a current certificate of liability insurance.",
          },
          {
            id: "schedule",
            name: "Current schedule acknowledged",
            kind: "acknowledgement",
            required: true,
            dueAt: null,
            instructions: "Review and acknowledge the current schedule before event day.",
          },
        ],
      };
      const result =
        rolePlans.length === 1
          ? await sendCrewCommand("createCrewCascade", {
              ...shared,
              role: rolePlans[0]!.role,
              candidateIds: rolePlans[0]!.candidates.map(
                (candidate) => candidate.crewProfileId,
              ),
            })
          : await sendCrewCommand("createCrewPlan", {
              projectId,
              cascades: rolePlans.map((plan) => ({
                ...shared,
                role: plan.role,
                candidateIds: plan.candidates.map(
                  (candidate) => candidate.crewProfileId,
                ),
              })),
            });
      setNotice(
        result.persisted
          ? rolePlans.length > 1
            ? `${rolePlans.length} role cascades started from one approval. Each candidate appears in only one role plan.`
            : "Cascade started. Only the first approved candidate received an offer."
          : "Development preview validated the candidate order without sending an offer.",
      );
      // The step now waits on the crew member's answer, which the job page
      // states plainly.
      if (result.persisted) returnToJob({ delayMs: 1400 });
    } catch (caught: unknown) {
      setNotice(
        crewPublicError(caught, "The crew offer sequence could not be started.", "CREW_CASCADE_START_FAILED"),
      );
    } finally {
      setBusy(false);
    }
  }

  /**
   * One form, rendered in whichever branch applies.
   *
   * This markup existed twice — once inside the disclosure and once
   * expanded — and the copies had already drifted: the collapsed one
   * gained a shortlist, an email and a paperwork request while the
   * expanded one still ranked ineligible people and printed a score.
   * Two copies of three hundred lines guarantees that.
   */
  const planForm = (
            <form className="panel crew-cascade-form" id="crew-cascade-plan" onSubmit={(event) => void create(event)}>
              <div className="crew-cascade-config">
                <label>
                  Roles to fill, one per line
                  <textarea
                    onChange={(event) => setRolesText(event.target.value)}
                    value={rolesText}
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
                  Event rate (USD)
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
                  <select
                name="responseWindowHours"
                onChange={(event) => setResponseWindowHours(event.target.value)}
                value={responseWindowHours}
              >
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
                  Times come from the current schedule, the rate from the crew
                  profile, and the responsibilities from the coverage you planned.
                  Check the order below, then send the first offer.
                </p>
              </div>
              <div className="crew-recommendation-heading">
                <span>
                  <UserRoundSearch />
                  <strong>Recommended order</strong>
                  <small>
                    {included.length} available ·{" "}
                    {ruledOut.length} ruled out
                  </small>
                </span>
                <StatusBadge tone={included.length ? "success" : "warning"}>
                  {loading ? "Ranking…" : included.length ? "Ready to review" : "Needs candidates"}
                </StatusBadge>
              </div>
              {rolePlans.length > 1 ? (
                <div className="crew-role-plan-summary">
                  {rolePlans.map((plan) => (
                    <article key={plan.role}>
                      <strong>{plan.role}</strong>
                      <small>
                        {plan.candidates.length
                          ? plan.candidates.map((candidate) => candidate.name).join(" → ")
                          : "Add more eligible candidates before approval"}
                      </small>
                    </article>
                  ))}
                </div>
              ) : null}
              <div className="crew-recommendation-list">
                {shortlist.map((candidate) => {
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
                        {/* Two people called "Conor Lawless" at different scores is
                            indistinguishable without this. The directory below
                            shows an email; the list where the choice is actually
                            made did not. */}
                        {profileEmail(candidate.crewProfileId) ? (
                          <small className="crew-candidate-email">
                            {profileEmail(candidate.crewProfileId)}
                          </small>
                        ) : null}
                        <small>
                          {candidate.explanations.length
                            ? candidate.explanations.join(" · ")
                            : "Nothing on file about this person yet"}
                          {candidate.unknowns.length ? (
                            <em className="crew-candidate-unknowns">
                              {" "}
                              Not known: {candidate.unknowns.join(", ")}
                            </em>
                          ) : null}
                        </small>
                        {candidate.incompleteProfile.length ? (
                          (() => {
                            const { theirs, yours } = splitBlockers(
                              candidate.incompleteProfile,
                            );
                            return (
                              <>
                                {theirs.length ? (
                                  <em className="crew-candidate-blocked">
                                    <CircleAlert size={12} /> Waiting on them:{" "}
                                    {theirs.join(", ")}
                                    {requested.has(candidate.crewProfileId) ? (
                                      <span className="crew-requested">
                                        <CheckCircle2 size={12} /> Requested
                                      </span>
                                    ) : (
                                      <button
                                        className="crew-request-paperwork"
                                        disabled={
                                          requesting === candidate.crewProfileId
                                        }
                                        onClick={() =>
                                          void requestPaperwork(
                                            candidate.crewProfileId,
                                          )
                                        }
                                        type="button"
                                      >
                                        {requesting === candidate.crewProfileId
                                          ? "Requesting…"
                                          : "Request paperwork"}
                                      </button>
                                    )}
                                  </em>
                                ) : null}
                                {yours.length ? (
                                  <em>
                                    <CircleAlert size={12} /> Missing from their
                                    profile: {yours.join(", ")}
                                  </em>
                                ) : null}
                              </>
                            );
                          })()
                        ) : (
                          <em className="is-complete">
                            <CheckCircle2 size={12} /> Profile complete
                          </em>
                        )}
                        {candidate.exclusions.length ? (
                          <em>{candidate.exclusions.join(" · ")}</em>
                        ) : null}
                      </div>
                      {/* The score is gone on purpose. It read 45 / 35 with no
                          scale, while every row also said "Not known:
                          availability" — the headline input to the ranking. A
                          number implying precision the data does not have is
                          worse than the order itself, which is what the studio
                          actually adjusts. */}
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
              {ruledOut.length ? (
                <details className="crew-ruled-out">
                  <summary>
                    {ruledOut.length} ruled out — not offerable for this role
                  </summary>
                  <div className="crew-recommendation-list">
                    {ruledOut.map((candidate) => (
                      <article className="is-excluded" key={candidate.crewProfileId}>
                        <span className="crew-rank">—</span>
                        <div>
                          <strong>{candidate.name}</strong>
                          {profileEmail(candidate.crewProfileId) ? (
                            <small className="crew-candidate-email">
                              {profileEmail(candidate.crewProfileId)}
                            </small>
                          ) : null}
                          <em>
                            {candidate.exclusions.length
                              ? candidate.exclusions.join(" · ")
                              : "Not eligible for this role"}
                          </em>
                        </div>
                      </article>
                    ))}
                  </div>
                </details>
              ) : null}
              <div className="crew-cascade-boundary">
                <Clock3 />
                <span>
                  <strong>One offer at a time</strong>
                  <small>
                    Each person sees the offer alone. If they accept, the role is
                    filled and nobody else is asked. If they decline or run out of
                    time, it moves to the next person. Nobody is ever offered two
                    roles at once.
                  </small>
                  {/* The math nobody was doing. One offer at a time times the
                      response window is the real worst case, and it was invisible
                      next to the window selector. */}
                  <small className="crew-cascade-timing">
                    {included.length} in the order × {responseWindowHours}h = up to{" "}
                    {Math.ceil((included.length * Number(responseWindowHours)) / 24)}{" "}
                    {Math.ceil((included.length * Number(responseWindowHours)) / 24) === 1
                      ? "day"
                      : "days"}{" "}
                    to fill.
                    {daysToEvent !== null
                      ? ` The event is in ${daysToEvent} ${daysToEvent === 1 ? "day" : "days"}.`
                      : ""}
                  </small>
                  {paperworkPending.length ? (
                    /* The real blocker, stated where the decision is made. */
                    <small className="crew-cascade-paperwork-warning">
                      You can send offers now, but{" "}
                      {paperworkPending.length === included.length
                        ? "nobody in this order"
                        : `${paperworkPending.length} of ${included.length}`}{" "}
                      can work this job until their paperwork is complete.
                    </small>
                  ) : null}
                </span>
                <button
                  className="button button-dark"
                  disabled={
                    busy ||
                    !included.length ||
                    !roles.length ||
                    rolePlans.some((plan) => !plan.candidates.length)
                  }
                  type="submit"
                >
                  <Send /> {busy ? "Starting…" : "Approve crew plan and start"}
                </button>
              </div>
              {notice ? <p className="form-notice" role="status">{notice}</p> : null}
            </form>
  );

  return (
    <section className="crew-cascade-workspace">
      {staffingInFlight ? (
        <header className="crew-cascade-hero is-waiting">
          <div>
            <p className="eyebrow">Already out</p>
            <h2>
              {awaitingReply.length === 1
                ? `Waiting on ${text(awaitingReply[0]?.crewName) || "one person"}`
                : `Waiting on ${awaitingReply.length} people`}
            </h2>
            <p>
              {awaitingReply
                .map(
                  (item) =>
                    `${text(item.role) || "Role"} · ${text(item.crewName) || "Offered"}`,
                )
                .join(" · ") || "An offer is out and has not been answered."}
              {acceptedHere.length
                ? ` — ${acceptedHere.length} already accepted.`
                : ""}
            </p>
          </div>
          <Clock3 aria-hidden="true" />
        </header>
      ) : openStalled.length ? (
        /**
         * The dead end, made actionable.
         *
         * This state used to render a red badge reading "Nobody accepted" and
         * nothing else — the role unfilled, the event weeks away, and no way
         * forward from the one page where you would fix it. The Today page
         * already offers "Find crew" for exactly this, so the workspace knew
         * it was a problem; the page that owns it stayed silent.
         *
         * "Offer to someone else" prefills the form with the people this
         * cascade never reached rather than sending anything: the studio still
         * approves the plan, which is the boundary the rest of the product
         * keeps.
         */
        <header className="crew-cascade-hero is-stalled">
          <div>
            <p className="eyebrow">Nobody accepted</p>
            <h2>
              {openStalled.length === 1
                ? `${text(openStalled[0]?.role) || "This role"} is still open`
                : `${openStalled.length} roles are still open`}
            </h2>
            <p>
              {openStalled
                .map((cascade) => {
                  const left = untriedFor(cascade).length;
                  return `${text(cascade.role) || "Role"} — ${
                    left
                      ? `${left} more ${left === 1 ? "person" : "people"} not yet asked`
                      : "everyone on the list has been asked"
                  }`;
                })
                .join(" · ")}
            </p>
            <div className="crew-cascade-recovery">
              <button
                className="button button-dark"
                onClick={() => {
                  const roles = openStalled
                    .map((cascade) => text(cascade.role))
                    .filter(Boolean);
                  setRolesText(roles.join("\n"));
                  // Everyone already asked is off the table for this round.
                  const asked = new Set(
                    openStalled.flatMap((cascade) => {
                      const ordered = list(cascade.candidateIds).map(text);
                      return ordered.slice(
                        0,
                        Number(cascade.currentCandidateIndex ?? 0) + 1,
                      );
                    }),
                  );
                  setExcluded(asked);
                  setRestartOpen(true);
                }}
                type="button"
              >
                <Send /> Offer to someone else
              </button>
              <a className="button button-light" href="#crew-direct-invite">
                Invite someone directly
              </a>
              <Link className="button button-light" href="/studio/crew/new">
                Add a crew member
              </Link>
            </div>
          </div>
          <Clock3 aria-hidden="true" />
        </header>
      ) : (
        <header className="crew-cascade-hero">
          <div>
            <p className="eyebrow">Staffing</p>
            <h2>Fill this role</h2>
            <p>
              StudioCue ranks the people you work with by role, availability,
              conflicts, travel and paperwork. You control the final order.
            </p>
            {/* Two ways to staff a job, presented as two ways.
                "Already know who you want?" was a closed disclosure below the
                fold while a seven-field ranking form took the whole hero —
                so the common case for a studio with a regular second shooter
                was the least visible thing on the page. */}
            <div className="crew-staffing-choice">
              <a className="button button-dark" href="#crew-direct-invite">
                <UserRoundCheck /> I know who I want
              </a>
              <a className="button button-light" href="#crew-cascade-plan">
                <UserRoundSearch /> Rank my options
              </a>
            </div>
            <ol className="crew-staffing-stages" aria-label="How staffing works">
              <li>Define the role</li>
              <li>Review the order</li>
              <li>Approve</li>
              <li>Offers go out, one at a time</li>
              <li>Someone accepts</li>
              <li>Paperwork clears</li>
            </ol>
          </div>
          <Sparkles aria-hidden="true" />
        </header>
      )}
      {/* When an offer is already out, starting a second staffing plan is
          almost never what the photographer came here to do. The form stays
          one click away rather than being the first thing on the page. */}
      {formCollapsed ? (
        <details className="crew-cascade-restart" open={restartOpen}>
          <summary
            onClick={() => {
              // Controlled so "Offer to someone else" above can open it and
              // land the photographer in a prefilled form.
              setRestartOpen((current) => !current);
            }}
          >
            {openStalled.length ? "Plan another round" : "Offer this role to someone else instead"}
          </summary>
      {planForm}
        </details>
      ) : (
        planForm
      )}
      {projectCascades.length ? (
        <div className="crew-cascade-statuses">
          {projectCascades.map((cascade) => (
            <article className="panel" key={cascade.id}>
              <span>
                <strong>{text(cascade.role)}</strong>
                {/* "Candidate 1 of 1" told the studio the array index it had
                    reached. What they need to know is whether anyone is
                    thinking about it, and how many people are left. */}
                <small>
                  {String(cascade.status) === "filled"
                    ? "Filled"
                    : String(cascade.status) === "exhausted"
                      ? untriedFor(cascade).length
                        ? `Asked ${Number(cascade.currentCandidateIndex ?? 0) + 1} of ${list(cascade.candidateIds).length} — ${untriedFor(cascade).length} not yet asked`
                        : `Asked everyone on the list (${list(cascade.candidateIds).length})`
                      : `Offer out to person ${Number(cascade.currentCandidateIndex ?? 0) + 1} of ${list(cascade.candidateIds).length}`}
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
                {statusLabel(cascade.status)}
              </StatusBadge>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
