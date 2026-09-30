"use client";

import { useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Circle,
  MapPin,
  ReceiptText,
} from "lucide-react";
import { Button, Card, List, Main, Note, Pill, PoweredBy, Row } from "@/components/kit/kit";
import { CrewClientBrief } from "@/components/crew/client-brief";
import { useWorkspace } from "@/features/auth/workspace-context";
import { crewCloseoutIsSubmitted } from "@/features/crew/closeout-moment";
import { SCHEDULE_REQUIREMENT_ID } from "@/features/crew/requirements";
import { statusLabel } from "@/features/format/status-label";
import { crewPublicError } from "@/lib/crew/public-error";
import {
  assignmentPlace,
  crewCommand,
  CrewLoadState,
  dayLabel,
  endsAt,
  jobName,
  list,
  number,
  projectFor,
  record,
  text,
  timeLabel,
  useAssignmentParam,
  useCrewData,
  type CrewData,
  type Value,
} from "@/components/crew/kit/crew-data";
import { RequirementSend, StudioMessage } from "@/components/crew/kit/crew-parts";
import { InfoHint } from "@/components/ui/info-hint";

const DOCUMENT_KINDS = ["w9", "insurance", "file"];
const done = (item: Record<string, unknown>) => ["complete", "waived"].includes(String(item.status));

/**
 * A job (M6 of docs/mobile-first-client-crew-plan-2026-09-28.md).
 *
 * Prep, requirements and documents were three pages behind a job-picker
 * <select> and four tiles; they are one screen now, opened from the job. The
 * day sheet and hours are a tap away. /crew/requirements and /crew/documents
 * land here, on the checklist.
 */
export function CrewJob() {
  const data = useCrewData();
  const named = useAssignmentParam(data);
  const [now] = useState(() => Date.now());
  if (data.loading || data.error) return <CrewLoadState data={data} title="Job" />;
  // Without ?assignment=, the next job ahead, then the most recent.
  const nowIso = new Date(now).toISOString();
  const accepted = data.assignments.filter((item) => ["accepted", "completed"].includes(String(item.status)));
  const fallback =
    accepted.filter((item) => String(item.arrivalAt) >= nowIso).sort((a, b) => String(a.arrivalAt).localeCompare(String(b.arrivalAt)))[0] ??
    accepted.sort((a, b) => String(b.arrivalAt).localeCompare(String(a.arrivalAt)))[0];
  const assignment = named ?? fallback ?? null;
  if (!assignment)
    return (
      <Main label="Job">
        <h1 className="kit-title">Your job</h1>
        <Card>
          <p className="kit-body" role="status">
            Accept an offer to see its run of show, checklist and documents here.
          </p>
        </Card>
        <Button href="/crew/jobs" variant="secondary">
          See your jobs
        </Button>
        <PoweredBy />
      </Main>
    );
  return <JobDetail assignment={assignment} data={data} key={assignment.id} now={now} />;
}

function JobDetail({ data, assignment, now }: { data: CrewData; assignment: Value; now: number }) {
  const workspace = useWorkspace();
  const project = projectFor(data, assignment);
  const zone = text(project?.timezone) || undefined;
  const name = jobName(data, assignment);
  const requirements = list(assignment.requirements).map(record);
  const outstanding = requirements.filter((item) => item.required === true && !done(item));
  const version = number(assignment.currentScheduleVersion);
  const read = number(assignment.acknowledgedScheduleVersion);
  // "Ready" is a claim about a day still ahead; after it, this is a record.
  const past = Date.parse(endsAt(assignment)) <= now;
  const closeout = record(assignment.closeout);
  const query = `?assignment=${encodeURIComponent(assignment.id)}`;

  return (
    <Main label="Job">
      <div className="kit-stack-tight">
        <p className="kit-eyebrow">{text(assignment.role, "Crew")}</p>
        <h1 className="kit-title">{name}</h1>
        <p className="kit-body">
          {`${dayLabel(assignment.arrivalAt, zone)} · call ${timeLabel(assignment.arrivalAt, zone)}`}
        </p>
        <p className="kit-caption" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <MapPin aria-hidden size={14} /> {assignmentPlace(assignment, project)}
        </p>
      </div>

      {past ? (
        <Note>The day has passed. This is the record of the job.</Note>
      ) : outstanding.length ? (
        <Note icon={AlertTriangle} tone="danger">
          {`${outstanding.length} ${outstanding.length === 1 ? "thing" : "things"} to do before the day.`}
        </Note>
      ) : version ? (
        <Note icon={CheckCircle2} tone="accent">
          You&rsquo;re ready.
        </Note>
      ) : (
        <Note>Waiting on the studio&rsquo;s run of show.</Note>
      )}

      <List label="The day">
        <Row
          href={`/crew/schedule${query}`}
          icon={CalendarDays}
          subtitle={
            !version
              ? "The studio hasn't shared it yet"
              : read === version
                ? `Version ${version} · read · saved for offline`
                : read
                  ? `Version ${version} · changed since you read version ${read}`
                  : `Version ${version} · not read yet`
          }
          title="Day sheet"
        />
        <Row
          href={`/crew/closeout${query}`}
          icon={ReceiptText}
          subtitle={
            crewCloseoutIsSubmitted(text(closeout.status))
              ? statusLabel(closeout.status)
              : text(closeout.status) === "needs_changes"
                ? "The studio asked for changes"
                : past
                  ? "Send in your hours and expenses"
                  : "After the day"
          }
          title="Hours and expenses"
        />
      </List>

      <section aria-label="Checklist" className="kit-stack-tight" id="checklist">
        <h2 className="kit-subsection">
          Checklist <InfoHint term="crew-checklist" />
        </h2>
        {requirements.length ? (
          <Card>
            <ul className="kit-checklist">
              {requirements.map((item) => (
                <li data-done={done(item) || undefined} key={text(item.id)}>
                  {done(item) ? (
                    <CheckCircle2 aria-hidden className="kit-checklist-icon" size={20} />
                  ) : (
                    <Circle aria-hidden className="kit-checklist-icon" size={20} />
                  )}
                  <span className="kit-stack-tight" style={{ flex: 1, minWidth: 0 }}>
                    <strong>{text(item.name, "Requirement")}</strong>
                    {text(item.instructions) || text(item.notes) ? (
                      <span className="kit-caption">{text(item.instructions) || text(item.notes)}</span>
                    ) : null}
                    {done(item) ? (
                      <span className="kit-caption">{statusLabel(item.status)}</span>
                    ) : past ? null : (
                      <RequirementStep assignment={assignment} data={data} requirement={item} />
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <p className="kit-caption">The studio hasn&rsquo;t asked for anything on this job.</p>
        )}
        <p className="kit-caption">
          Only your own paperwork is here. You never see the couple&rsquo;s contract, invoices or photos.
        </p>
      </section>

      <CrewClientBrief projectId={text(assignment.projectId)} />

      <StudioMessage
        assignment={assignment}
        jobName={name}
        studioColor={workspace.tenantBrand?.primaryColor ?? null}
      />
      <PoweredBy />
    </Main>
  );
}

/** One action per row: send it, confirm it, or say why there is nothing to do yet. */
function RequirementStep({
  data,
  assignment,
  requirement,
}: {
  data: CrewData;
  assignment: Value;
  requirement: Record<string, unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kind = text(requirement.kind, "file");
  if (DOCUMENT_KINDS.includes(kind))
    return <RequirementSend assignment={assignment} onSent={data.refresh} requirement={requirement} />;
  if (kind === "contract") return <span className="kit-caption">The studio will send the signing request.</span>;
  /**
   * The run of show is acknowledged against a version, on the day sheet, never
   * declared done here. A bare "Acknowledge" on this list once marked it read
   * on a job with no schedule at all.
   */
  if (text(requirement.id) === SCHEDULE_REQUIREMENT_ID) {
    return number(assignment.currentScheduleVersion) ? (
      <Button
        href={`/crew/schedule?assignment=${encodeURIComponent(assignment.id)}`}
        size="compact"
        variant="secondary"
      >
        Read and confirm
      </Button>
    ) : (
      <span className="kit-caption">The studio has not published the run of show yet.</span>
    );
  }
  if (!["equipment", "acknowledgement"].includes(kind)) return null;
  if (confirmed) return <Pill icon={CheckCircle2} tone="accent">Done</Pill>;
  return (
    <span className="kit-stack-tight">
      <Button
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          void crewCommand("completeRequirement", {
            projectId: text(assignment.projectId),
            assignmentId: assignment.id,
            requirementId: text(requirement.id),
            documentId: null,
          })
            .then(() => {
              setConfirmed(true);
              data.refresh();
            })
            .catch((caught: unknown) =>
              setError(crewPublicError(caught, "That couldn't be saved.", "CREW_REQUIREMENT_UPDATE_FAILED")),
            )
            .finally(() => setBusy(false));
        }}
        size="compact"
        variant="secondary"
      >
        {busy ? "Saving…" : kind === "equipment" ? "I'll bring it" : "Got it"}
      </Button>
      {error ? (
        <span className="kit-error" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
