"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowRight, CalendarDays, Search, Users } from "lucide-react";
import { useTenantDocuments } from "@/components/live/tenant-records";
import {
  CrewRecordActions,
  crewActionsProps,
} from "@/components/crew/crew-record-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { useWorkspace } from "@/features/auth/workspace-context";
import {
  requireInsuranceOf,
  type CrewRequirementSettings,
} from "@/features/crew/requirements";
import {
  assignmentBucket,
  crewAccountLabel,
  paperworkProgress,
  type AssignmentBucket,
} from "@/features/crew/hub";
import {
  describeEventProximity,
  eventDateHasPassed,
  formatDueDate,
  formatEventDate,
} from "@/lib/format/event-date";
import { stateTone } from "@/lib/status-tone";

type Doc = Record<string, unknown> & { id: string };

const BUCKETS: Array<{ key: AssignmentBucket; label: string }> = [
  { key: "upcoming", label: "Upcoming" },
  { key: "waiting", label: "Waiting on a reply" },
  { key: "closed", label: "Past & canceled" },
];

/**
 * The Crew page when no job is open: staff a job, the people, their work.
 *
 * It was three sections stacked — every upcoming job as a row, then every
 * assignment ever made (cancelled ones included), then the directory — so the
 * people a studio came to find were at the bottom of a long scroll, and each
 * person was a wide row with "Open" floating mid-line and the edit button
 * below it (docs/ui-audit-2026-09-27.md). Now: the job picker is one line, and
 * the people and the assignments are tabs, the people as cards.
 */
export function CrewHub({ initialView }: { initialView: "crew" | "assignments" }) {
  const router = useRouter();
  const workspace = useWorkspace();
  const [view, setView] = useState(initialView);
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [bucket, setBucket] = useState<AssignmentBucket>("upcoming");
  const [jobId, setJobId] = useState("");

  const profiles = useTenantDocuments("crewProfiles");
  const assignments = useTenantDocuments("crewAssignments");
  const projects = useTenantDocuments("projects");
  const tenants = useTenantDocuments("tenants");

  const crewSettings = (tenants.records ?? []).find(
    (entry) => entry.id === workspace.tenantId,
  )?.crewOffers as CrewRequirementSettings | undefined;
  const insuranceRequired = requireInsuranceOf(crewSettings);

  const projectById = useMemo(
    () => new Map((projects.records ?? []).map((project) => [project.id, project])),
    [projects.records],
  );
  const profileById = useMemo(
    () => new Map((profiles.records ?? []).map((profile) => [profile.id, profile])),
    [profiles.records],
  );

  const staffable = useMemo(
    () =>
      (projects.records ?? [])
        .filter((project) => {
          const state = String(project.state ?? "");
          if (["CANCELLED", "ARCHIVED", "POSTPONED"].includes(state)) return false;
          if (project.archivedAt) return false;
          return !eventDateHasPassed(project.eventDate);
        })
        .sort((a, b) => String(a.eventDate ?? "").localeCompare(String(b.eventDate ?? ""))),
    [projects.records],
  );

  // Fixed for the page's life: which list an offer is in shouldn't shift
  // under the studio mid-read.
  const [now] = useState(() => Date.now());
  const allAssignments = (assignments.records ?? []).filter((item) => !item.archivedAt);
  const bucketOf = (item: Doc) =>
    assignmentBucket(String(item.status ?? ""), String(item.arrivalAt ?? ""), now);
  const upcomingByProfile = new Map<string, number>();
  for (const item of allAssignments) {
    if (bucketOf(item) === "closed") continue;
    const key = String(item.crewProfileId ?? "");
    upcomingByProfile.set(key, (upcomingByProfile.get(key) ?? 0) + 1);
  }

  const archivedProfiles = (profiles.records ?? []).filter((profile) => profile.archivedAt);
  const needle = query.trim().toLowerCase();
  const visibleProfiles = (showArchived
    ? archivedProfiles
    : (profiles.records ?? []).filter((profile) => !profile.archivedAt)
  )
    .filter((profile) => {
      if (!needle) return true;
      return [profile.name, profile.email, ...(Array.isArray(profile.specialties) ? profile.specialties : [])]
        .map((value) => String(value ?? "").toLowerCase())
        .some((value) => value.includes(needle));
    })
    .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));

  const bucketCounts = Object.fromEntries(
    BUCKETS.map(({ key }) => [key, allAssignments.filter((item) => bucketOf(item) === key).length]),
  ) as Record<AssignmentBucket, number>;
  const visibleAssignments = allAssignments
    .filter((item) => bucketOf(item) === bucket)
    .sort((a, b) => {
      const order = String(a.arrivalAt ?? "").localeCompare(String(b.arrivalAt ?? ""));
      return bucket === "closed" ? -order : order;
    });

  const choose = (next: "crew" | "assignments") => {
    setView(next);
    const url = new URL(window.location.href);
    if (next === "crew") url.searchParams.delete("view");
    else url.searchParams.set("view", next);
    window.history.replaceState(null, "", url);
  };

  const activeCrewCount = (profiles.records ?? []).filter((profile) => !profile.archivedAt).length;

  return (
    <div className="crew-hub">
      <section className="panel crew-hub-staff">
        <span className="crew-hub-staff-icon">
          <Users aria-hidden="true" size={18} />
        </span>
        <div className="crew-hub-staff-copy">
          <strong>Staff a job</strong>
          <small>Pick a job and StudioCue ranks who to ask for each role.</small>
        </div>
        <form
          className="crew-hub-staff-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (jobId) router.push(`/studio/crew?project=${jobId}`);
          }}
        >
          <select
            aria-label="Job to staff"
            disabled={projects.loading || staffable.length === 0}
            onChange={(event) => setJobId(event.target.value)}
            value={jobId}
          >
            <option value="">
              {projects.loading
                ? "Loading jobs…"
                : staffable.length
                  ? "Choose a job…"
                  : "No upcoming jobs to staff"}
            </option>
            {staffable.map((project) => {
              const proximity = describeEventProximity(project.eventDate);
              return (
                <option key={project.id} value={project.id}>
                  {String(project.name ?? "Untitled job")}
                  {project.eventDate
                    ? ` · ${formatEventDate(project.eventDate)}${proximity ? ` (${proximity})` : ""}`
                    : ""}
                </option>
              );
            })}
          </select>
          <button className="button button-dark" disabled={!jobId} type="submit">
            Open crew plan <ArrowRight aria-hidden="true" size={15} />
          </button>
        </form>
      </section>

      <div className="crew-hub-tabs" role="tablist" aria-label="Crew">
        <button
          aria-selected={view === "crew"}
          onClick={() => choose("crew")}
          role="tab"
          type="button"
        >
          Crew <span>{activeCrewCount}</span>
        </button>
        <button
          aria-selected={view === "assignments"}
          onClick={() => choose("assignments")}
          role="tab"
          type="button"
        >
          Assignments <span>{bucketCounts.upcoming + bucketCounts.waiting}</span>
        </button>
      </div>

      {view === "crew" ? (
        <section className="crew-hub-panel" role="tabpanel">
          <div className="crew-hub-toolbar">
            <label className="crew-hub-search">
              <Search aria-hidden="true" size={15} />
              <input
                aria-label="Search crew"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by name, email or specialty"
                value={query}
              />
            </label>
            {archivedProfiles.length ? (
              <button
                className="button button-light"
                onClick={() => setShowArchived((value) => !value)}
                type="button"
              >
                {showArchived ? "Show current crew" : `Show ${archivedProfiles.length} archived`}
              </button>
            ) : null}
          </div>
          {profiles.loading ? (
            <p className="crew-hub-empty">Loading your crew…</p>
          ) : profiles.error ? (
            <p className="form-error">{profiles.error}</p>
          ) : visibleProfiles.length === 0 ? (
            <div className="crew-hub-empty">
              <strong>
                {needle
                  ? "No one matches that search"
                  : showArchived
                    ? "No archived crew"
                    : "No crew yet"}
              </strong>
              {!needle && !showArchived ? (
                <Link className="button button-dark" href="/studio/crew/new">
                  Add crew member
                </Link>
              ) : null}
            </div>
          ) : (
            <div className="crew-card-grid">
              {visibleProfiles.map((profile) => (
                <CrewCard
                  insuranceRequired={insuranceRequired}
                  key={profile.id}
                  profile={profile}
                  upcoming={upcomingByProfile.get(profile.id) ?? 0}
                />
              ))}
            </div>
          )}
        </section>
      ) : (
        <section className="crew-hub-panel" role="tabpanel">
          <div className="crew-hub-toolbar">
            <div className="crew-hub-filters" role="group" aria-label="Which assignments">
              {BUCKETS.map(({ key, label }) => (
                <button
                  aria-pressed={bucket === key}
                  key={key}
                  onClick={() => setBucket(key)}
                  type="button"
                >
                  {label} <span>{bucketCounts[key]}</span>
                </button>
              ))}
            </div>
          </div>
          {assignments.loading ? (
            <p className="crew-hub-empty">Loading assignments…</p>
          ) : assignments.error ? (
            <p className="form-error">{assignments.error}</p>
          ) : visibleAssignments.length === 0 ? (
            <div className="crew-hub-empty">
              <strong>
                {bucket === "upcoming"
                  ? "No confirmed work coming up"
                  : bucket === "waiting"
                    ? "Nobody is waiting to reply"
                    : "Nothing past or canceled"}
              </strong>
              {bucket === "upcoming" ? (
                <small>Pick a job above to offer its roles.</small>
              ) : null}
            </div>
          ) : (
            <div className="crew-assignment-list">
              {visibleAssignments.map((item) => {
                const project = projectById.get(String(item.projectId ?? ""));
                const person = profileById.get(String(item.crewProfileId ?? ""));
                const paperwork = paperworkProgress(item.requirements);
                const version = Number(item.currentScheduleVersion ?? 0);
                const status = String(item.status ?? "");
                return (
                  <Link
                    className="crew-assignment-row"
                    href={`/studio/crew/${item.id}`}
                    key={item.id}
                  >
                    <span className="crew-assignment-date">
                      <CalendarDays aria-hidden="true" size={14} />
                      {item.arrivalAt ? formatDueDate(String(item.arrivalAt)) : "No date"}
                    </span>
                    <span className="crew-assignment-job">
                      <strong>{String(project?.name ?? item.projectName ?? "A job")}</strong>
                      <small>
                        {String(person?.name ?? "Crew member")} · {String(item.role ?? "Crew")}
                      </small>
                    </span>
                    <span className="crew-assignment-fact">
                      <small>Run of show</small>
                      {version > 0 ? `v${version} sent` : "Not sent yet"}
                    </span>
                    <span className="crew-assignment-fact">
                      <small>Paperwork</small>
                      {paperwork.total ? `${paperwork.done} of ${paperwork.total} done` : "None"}
                    </span>
                    <StatusBadge tone={stateTone(status)}>
                      {status ? status.charAt(0).toUpperCase() + status.slice(1) : "Draft"}
                    </StatusBadge>
                    <ArrowRight aria-hidden="true" className="crew-assignment-go" size={15} />
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function CrewCard({
  profile,
  upcoming,
  insuranceRequired,
}: {
  profile: Doc;
  upcoming: number;
  insuranceRequired: boolean;
}) {
  const name = String(profile.name ?? "Crew member");
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
  const trades = Array.isArray(profile.trades) ? profile.trades.map(String) : [];
  const specialties = Array.isArray(profile.specialties) ? profile.specialties.map(String) : [];
  const account = crewAccountLabel(profile);
  const w9 = String(profile.w9Status ?? "missing");
  const insurance = String(profile.insuranceStatus ?? "missing");
  const docTone = (value: string) =>
    ["received", "verified"].includes(value)
      ? ("success" as const)
      : value === "requested"
        ? ("info" as const)
        : ("warning" as const);

  return (
    <article className="crew-card">
      <header>
        <span className="crew-card-avatar">{initials}</span>
        <span className="crew-card-name">
          <strong>{name}</strong>
          <small>{String(profile.email ?? "No email")}</small>
        </span>
        <StatusBadge tone={account.tone}>{account.label}</StatusBadge>
      </header>
      {trades.length || specialties.length ? (
        <ul className="crew-card-tags" aria-label="What they do">
          {trades.map((trade) => (
            <li className="is-trade" key={`t-${trade}`}>
              {trade.charAt(0).toUpperCase() + trade.slice(1)}
            </li>
          ))}
          {specialties.map((specialty) => (
            <li key={`s-${specialty}`}>{specialty}</li>
          ))}
        </ul>
      ) : (
        <p className="crew-card-muted">No trades or specialties yet</p>
      )}
      <dl className="crew-card-facts">
        <div>
          <dt>W-9</dt>
          <dd>
            <StatusBadge tone={docTone(w9)}>{w9}</StatusBadge>
          </dd>
        </div>
        {insuranceRequired ? (
          <div>
            <dt>Insurance</dt>
            <dd>
              <StatusBadge tone={docTone(insurance)}>{insurance}</StatusBadge>
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Upcoming</dt>
          <dd>{upcoming ? `${upcoming} job${upcoming === 1 ? "" : "s"}` : "None"}</dd>
        </div>
      </dl>
      <footer className="record-row-actions">
        <Link className="crew-card-open" href={`/studio/crew/${profile.id}`}>
          Open profile <ArrowRight aria-hidden="true" size={14} />
        </Link>
        <CrewRecordActions crew={crewActionsProps(profile)} />
      </footer>
    </article>
  );
}
