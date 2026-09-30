"use client";

import { useState } from "react";
import { ArrowRight, CalendarCheck, CheckCircle2, MapPin, ReceiptText, Send } from "lucide-react";
import { Button, Card, List, Main, Note, Pill, PoweredBy, Row } from "@/components/kit/kit";
import { greetingName } from "@/features/auth/session-failure";
import { useWorkspace } from "@/features/auth/workspace-context";
import { crewAttention } from "@/features/crew/attention";
import {
  assignmentPlace,
  CrewLoadState,
  dayLabel,
  jobName,
  money,
  number,
  projectFor,
  text,
  timeLabel,
  useCrewData,
} from "@/components/crew/kit/crew-data";
import { InfoHint } from "@/components/ui/info-hint";

/** "today", "tomorrow", "in 6 days". */
function whenFrom(iso: string, now: number): string {
  const days = Math.round((new Date(iso).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

/**
 * Today (M6 of docs/mobile-first-client-crew-plan-2026-09-28.md).
 *
 * The next job leads, with its call time, place and a way in; below it, only
 * what needs this person now (features/crew/attention.ts, one derivation
 * shared with the Jobs tab). It was a card grid where the next job was
 * buried under the header.
 */
export function CrewToday() {
  const workspace = useWorkspace();
  const data = useCrewData();
  const [now] = useState(() => Date.now());
  const loadState = <CrewLoadState data={data} title="Today" />;
  if (data.loading || data.error) return loadState;

  const attention = crewAttention(data.assignments, new Date(now));
  const nowIso = new Date(now).toISOString();
  // What is next is what has not happened yet: the most recent past job
  // under "Next" was a real defect.
  const next = data.assignments
    .filter((assignment) => assignment.status === "accepted" && String(assignment.arrivalAt) >= nowIso)
    .sort((a, b) => String(a.arrivalAt).localeCompare(String(b.arrivalAt)))[0];
  const nextProject = next ? projectFor(data, next) : undefined;
  const zone = text(nextProject?.timezone) || undefined;
  const name = greetingName(workspace.userName, workspace.tenantName);
  const nothing =
    !attention.invitations.length && !attention.acknowledgementDue && !attention.closeoutsDue.length;
  const soon = next ? whenFrom(String(next.arrivalAt), now) : null;

  return (
    <Main label="Today">
      <div className="kit-stack-tight">
        <p className="kit-eyebrow">Today</p>
        <h1 className="kit-title">{name ? `Hi, ${name}.` : "Hi."}</h1>
        <p className="kit-body">{attention.headline}</p>
      </div>

      {next ? (
        <Card tone="accent">
          <p className="kit-eyebrow" style={{ color: "var(--kit-accent)" }}>
            {`Next up · ${soon}`}
          </p>
          <h2 className="kit-section">{jobName(data, next)}</h2>
          <p className="kit-body">
            <strong>{`${dayLabel(next.arrivalAt, zone)} · call ${timeLabel(next.arrivalAt, zone)}`}</strong>
            <InfoHint term="call-time" />
            <br />
            {text(next.role, "Crew")}
          </p>
          <p className="kit-caption" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <MapPin aria-hidden size={14} /> {assignmentPlace(next, nextProject)}
          </p>
          <Button
            href={
              soon === "today" || soon === "tomorrow"
                ? `/crew/schedule?assignment=${encodeURIComponent(next.id)}`
                : `/crew/prep?assignment=${encodeURIComponent(next.id)}`
            }
          >
            {soon === "today" || soon === "tomorrow" ? "Open the day sheet" : "Open the job"}{" "}
            <ArrowRight aria-hidden size={18} />
          </Button>
        </Card>
      ) : null}

      {!nothing ? (
        <section aria-label="Needs you" className="kit-stack-tight">
          <h2 className="kit-subsection">
            Needs you
            <InfoHint label="Needs you">
              Only what’s waiting on you: offers to answer, a run of show to confirm, and hours to send in after a job.
            </InfoHint>
          </h2>
          <List>
            {attention.invitations.map((offer) => (
              <Row
                href={`/crew/pending?assignment=${encodeURIComponent(offer.id)}`}
                icon={Send}
                key={offer.id}
                subtitle={`${dayLabel(offer.arrivalAt)}${offer.compensationVisibleToCrew ? ` · ${money(offer.compensationCents, offer.currency)}` : ""}`}
                title={`New offer: ${jobName(data, offer)}`}
              />
            ))}
            {attention.acknowledgementDue ? (
              <Row
                href={`/crew/schedule?assignment=${encodeURIComponent(attention.acknowledgementDue.id)}`}
                icon={CalendarCheck}
                subtitle={
                  number(attention.acknowledgementDue.acknowledgedScheduleVersion)
                    ? `It changed since you read version ${number(attention.acknowledgementDue.acknowledgedScheduleVersion)}`
                    : "Read it and confirm"
                }
                title={`Run of show for ${jobName(data, attention.acknowledgementDue)}`}
              />
            ) : null}
            {attention.closeoutsDue.map(({ assignment, moment }) => (
              <Row
                href={`/crew/closeout?assignment=${encodeURIComponent(assignment.id)}`}
                icon={ReceiptText}
                key={`closeout-${assignment.id}`}
                // The amount, when he may see it: payment waits on this.
                subtitle={
                  assignment.compensationVisibleToCrew
                    ? `${money(assignment.compensationCents, assignment.currency)} is waiting on it`
                    : "Your studio pays once it's in"
                }
                title={
                  moment.reason === "needs_changes"
                    ? `Update your hours: ${jobName(data, assignment)}`
                    : `Send in your hours: ${jobName(data, assignment)}`
                }
                trailing={moment.reason === "needs_changes" ? <Pill tone="danger">Changes asked</Pill> : undefined}
              />
            ))}
          </List>
        </section>
      ) : (
        <Note icon={CheckCircle2} tone="accent">
          {/* True only when there's genuinely nothing: an accepted job close
              to its date with no run of show is itself something to chase. */}
          {next
            ? "Nothing needs you right now. If the date is close and there's no run of show yet, ask your studio."
            : "Nothing needs you right now. New offers from your studio appear here."}
        </Note>
      )}

      {data.profile && data.profile.active !== true ? (
        <Note>Your profile is with your studio for review. You can still answer offers.</Note>
      ) : null}
      <PoweredBy />
    </Main>
  );
}
