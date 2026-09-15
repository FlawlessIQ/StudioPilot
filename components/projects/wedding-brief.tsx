"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  MapPin,
  Sparkles,
  UsersRound,
} from "lucide-react";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { useProjectJourney } from "@/components/projects/use-project-journey";
import {
  briefFacts,
  briefStatus,
  snapshotFields,
  type BriefFact,
} from "@/features/planning/wedding-brief";
import {
  displayableScheduleItems,
  scheduleItemClock,
} from "@/features/schedules/item-clock";
import { describeEventProximity, formatEventDateLong } from "@/lib/format/event-date";
import { statusLabel } from "@/features/format/status-label";

type Row = Record<string, unknown> & { id: string };

const text = (value: unknown) => (typeof value === "string" ? value : "");

const FACT_SECTIONS: Array<{ key: "family_formals" | "vendors" | "logistics" | "preferences"; title: string }> = [
  { key: "family_formals", title: "Family & portraits" },
  { key: "vendors", title: "Vendors" },
  { key: "logistics", title: "Getting around" },
  { key: "preferences", title: "What matters to them" },
];

function FactList({ facts }: { facts: BriefFact[] }) {
  return (
    <dl className="wedding-brief-facts">
      {facts.slice(0, 8).map((fact) => (
        <div key={`${fact.label}-${fact.value}`}>
          <dt>{fact.label}</dt>
          <dd>{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * One page for the wedding: what needs you, what is out with others, and the
 * day as the couple described it. See features/planning/wedding-brief.ts.
 */
export function WeddingBrief({ projectId }: { projectId: string }) {
  const projects = useTenantDocuments("projects");
  const responses = useTenantDocuments("questionnaireResponses");
  const schedules = useTenantDocuments("schedules");
  const assignments = useTenantDocuments("crewAssignments");
  const profiles = useTenantDocuments("crewProfiles");
  const project = (projects.records ?? []).find((row) => row.id === projectId) as Row | undefined;
  const { steps } = useProjectJourney({
    projectId,
    projectState: text(project?.state),
    eventDate: text(project?.eventDate) || null,
    leadId: text(project?.leadId) || null,
  });
  const status = briefStatus(steps);

  const response = useMemo(
    () =>
      ((responses.records ?? []) as Row[])
        .filter((row) => row.projectId === projectId && !row.archivedAt)
        .sort((left, right) => {
          const rank = (row: Row) => (row.status === "submitted" || row.status === "locked" ? 1 : 0);
          return rank(right) - rank(left) || text(right.updatedAt).localeCompare(text(left.updatedAt));
        })[0],
    [responses.records, projectId],
  );
  const facts = useMemo(
    () =>
      response
        ? briefFacts({
            responseId: response.id,
            fields: snapshotFields(response.templateSnapshot),
            answers:
              typeof response.answers === "object" && response.answers !== null
                ? (response.answers as Record<string, unknown>)
                : {},
          })
        : null,
    [response],
  );
  const schedule = useMemo(
    () =>
      ((schedules.records ?? []) as Row[])
        .filter((row) => row.projectId === projectId && !row.archivedAt)
        .sort((left, right) => Number(right.version ?? 0) - Number(left.version ?? 0))[0],
    [schedules.records, projectId],
  );
  const timeline = schedule && Array.isArray(schedule.items)
    ? displayableScheduleItems(schedule.items as Array<Record<string, unknown>>)
    : [];
  const crew = ((assignments.records ?? []) as Row[]).filter(
    (row) => row.projectId === projectId && !row.archivedAt && row.status !== "declined",
  );
  const crewName = (row: Row) =>
    text(
      ((profiles.records ?? []) as Row[]).find((profile) => profile.id === row.crewProfileId)?.name,
    ) ||
    text(row.crewName) ||
    "Crew member";

  if (!project) return null;
  const timeZone = text(project.timezone) || undefined;
  const allSet = status.needsYou.length === 0 && status.waiting.length === 0;
  const proximity = describeEventProximity(project.eventDate);

  return (
    <section className="wedding-brief" aria-label="Wedding brief">
      <header className="wedding-brief-head">
        <div>
          <p className="eyebrow">Wedding brief</p>
          <h2>{text(project.name) || "This wedding"}</h2>
          <p className="wedding-brief-when">
            <CalendarDays aria-hidden="true" size={15} />
            {formatEventDateLong(project.eventDate)}
            {proximity ? ` · ${proximity}` : ""}
            {text(project.venueName) ? (
              <>
                <MapPin aria-hidden="true" size={15} />
                {text(project.venueName)}
              </>
            ) : null}
          </p>
        </div>
        <span className={allSet ? "wedding-brief-pill is-clear" : "wedding-brief-pill"}>
          {allSet ? (
            <>
              <CheckCircle2 aria-hidden="true" size={14} /> Ready for the day
            </>
          ) : status.needsYou.length ? (
            `${status.needsYou.length} ${status.needsYou.length === 1 ? "thing needs" : "things need"} you`
          ) : (
            "Waiting on others"
          )}
        </span>
      </header>

      {status.needsYou.length ? (
        <div className="wedding-brief-block">
          <h3>Needs you</h3>
          <ul className="wedding-brief-actions">
            {status.needsYou.map((item) => (
              <li key={item.key}>
                <span>
                  <strong>{item.title}</strong>
                  {item.detail ? <small>{item.detail}</small> : null}
                </span>
                {item.href ? (
                  <Link className="button button-dark button-sm" href={item.href}>
                    {item.actionLabel ?? "Open"} <ArrowRight size={14} />
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {status.waiting.length ? (
        <div className="wedding-brief-block">
          <h3>Out with others</h3>
          <ul className="wedding-brief-waiting">
            {status.waiting.map((item) => (
              <li key={item.key}>
                <Clock3 aria-hidden="true" size={15} />
                <span>
                  <strong>{item.title}</strong>
                  {item.detail ? <small>{item.detail}</small> : null}
                </span>
                {item.href ? (
                  <Link href={item.href}>Open</Link>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="wedding-brief-grid">
        <div className="wedding-brief-block">
          <h3>
            The day
            {schedule ? (
              <small>
                {" "}
                · version {Number(schedule.version ?? 1)} · {statusLabel(schedule.status)}
              </small>
            ) : null}
          </h3>
          {timeline.length ? (
            <ol className="wedding-brief-timeline">
              {timeline.slice(0, 10).map((item, index) => {
                const clock = scheduleItemClock(item, timeZone);
                return (
                  <li key={text(item.id) || index}>
                    <time>{clock?.start ?? ""}</time>
                    <span>
                      <strong>{text(item.title)}</strong>
                      {text(item.location) ? <small>{text(item.location)}</small> : null}
                    </span>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="wedding-brief-empty">
              {facts && facts.schedule.length
                ? "Their timing answers are in. Draft the run of show from them."
                : "No run of show yet. It drafts from the couple's planning answers."}
            </p>
          )}
          {schedule ? (
            <Link className="wedding-brief-link" href={`/studio/schedules/${schedule.id}`}>
              Open the run of show <ArrowRight size={13} />
            </Link>
          ) : null}
        </div>

        <div className="wedding-brief-block">
          <h3>
            <UsersRound aria-hidden="true" size={15} /> Crew
          </h3>
          {crew.length ? (
            <ul className="wedding-brief-crew">
              {crew.map((row) => (
                <li key={row.id}>
                  <strong>{crewName(row)}</strong>
                  <small>
                    {text(row.role)} · {statusLabel(row.status)}
                  </small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="wedding-brief-empty">No crew on this job — shooting solo unless you add someone.</p>
          )}
          <Link className="wedding-brief-link" href={`/studio/crew?project=${projectId}`}>
            Crew for this job <ArrowRight size={13} />
          </Link>
        </div>
      </div>

      <div className="wedding-brief-block">
        <h3>
          <Sparkles aria-hidden="true" size={15} /> From the couple
          {response ? (
            <small>
              {" "}
              · {response.status === "submitted" || response.status === "locked" ? "submitted" : "in progress"}
            </small>
          ) : null}
        </h3>
        {facts && Object.values(facts).some((list) => list.length) ? (
          <div className="wedding-brief-couple">
            {FACT_SECTIONS.filter((section) => facts[section.key].length).map((section) => (
              <div key={section.key}>
                <h4>{section.title}</h4>
                <FactList facts={facts[section.key]} />
              </div>
            ))}
            {facts.schedule.length ? (
              <div>
                <h4>Timing</h4>
                <FactList facts={facts.schedule} />
              </div>
            ) : null}
          </div>
        ) : (
          <p className="wedding-brief-empty">
            {response
              ? "The couple hasn't filled anything in yet."
              : "Their planning details appear here once you send the planning questionnaire."}
          </p>
        )}
      </div>
    </section>
  );
}
