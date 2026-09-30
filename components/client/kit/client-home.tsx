"use client";

import { ClientBookingChange } from "@/components/client/kit/client-booking-change";
import { useState } from "react";
import { CalendarDays, CheckCircle2, Clock3, MapPin, ShieldCheck } from "lucide-react";
import { Button, Card, Main, Pill, PoweredBy, Steps } from "@/components/kit/kit";
import { useWorkspace } from "@/features/auth/workspace-context";
import { daysUntilEvent } from "@/lib/format/event-date";
import {
  date,
  text,
  useProject,
  useReserveYourDate,
} from "@/components/client/live-client-views";

/**
 * The couple's home: one next step, the countdown, and the journey
 * (M3 of docs/mobile-first-client-crew-plan-2026-09-28.md). It replaces a
 * long desktop page of hero, records hub and milestone panels; records now
 * live under Files, and everything by stage under Plan.
 */
export function ClientHome() {
  const workspace = useWorkspace();
  const project = useProject();
  const reserve = useReserveYourDate();
  const [renderedAt] = useState(() => Date.now());
  const first = workspace.userName.split(" ")[0] || "there";

  if (project.loading || project.error || !project.value)
    return (
      <Main label="Your project">
        <div className="kit-stack-tight">
          <p className="kit-eyebrow">Your project</p>
          <h1 className="kit-title">Hello, {first}.</h1>
        </div>
        <Card>
          <p className="kit-body" role={project.error ? "alert" : "status"}>
            {project.loading
              ? "Opening your project…"
              : project.error ?? "Your project details will appear here once your studio has set it up."}
          </p>
        </Card>
        <PoweredBy />
      </Main>
    );

  const value = project.value;
  // The couple's countdown and the studio's must be the same number: one
  // shared function (lib/format/event-date.ts).
  const days = value.eventDate ? daysUntilEvent(value.eventDate, new Date(renderedAt)) : null;
  const countdown =
    days === null
      ? "Your date is to be confirmed"
      : days < 0
        ? `${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"} since your day`
        : days === 0
          ? "Today is the day"
          : `${days} ${days === 1 ? "day" : "days"} to go`;
  const action = value.nextClientAction;
  const studioIsWorking = action.responsibility === "studio";
  const venue = text(value.venueName ?? value.city, "");

  return (
    <Main label="Your project">
      <div className="kit-stack-tight">
        <p className="kit-body">Hello, {first}</p>
        <h1 className="kit-title">{countdown}</h1>
      </div>
      <div className="kit-chip-list">
        {value.eventDate ? <Pill icon={CalendarDays}>{date(value.eventDate)}</Pill> : null}
        {venue ? <Pill icon={MapPin}>{venue}</Pill> : null}
      </div>

      {/* A change to their signed booking, waiting for their signature. */}
      <ClientBookingChange compact />

      {reserve ? (
        <Card tone="accent">
          <p className="kit-eyebrow" style={{ color: "var(--kit-accent)" }}>
            Reserve your date
          </p>
          <Steps
            step={reserve.steps.filter((step) => step.state === "done").length}
            total={reserve.steps.length}
          />
          <h2 className="kit-section">{reserve.next.title}</h2>
          <p className="kit-body">{reserve.next.detail}</p>
          {reserve.next.href && reserve.next.href !== "/client" && reserve.next.actionLabel ? (
            <Button href={reserve.next.href}>{reserve.next.actionLabel}</Button>
          ) : null}
        </Card>
      ) : (
        <Card tone={studioIsWorking ? undefined : "accent"}>
          <p className="kit-eyebrow" style={studioIsWorking ? undefined : { color: "var(--kit-accent)" }}>
            {studioIsWorking ? (
              <>
                <ShieldCheck aria-hidden="true" size={14} /> Your studio is on it
              </>
            ) : (
              <>
                <Clock3 aria-hidden="true" size={14} /> Your next step
              </>
            )}
          </p>
          <h2 className="kit-section">{action.name}</h2>
          {action.description ? <p className="kit-body">{action.description}</p> : null}
          {action.dueDate ? <p className="kit-caption">Due {date(action.dueDate)}</p> : null}
          {action.href !== "/client" ? (
            <Button href={action.href} variant={studioIsWorking ? "secondary" : "primary"}>
              {action.actionLabel}
            </Button>
          ) : null}
        </Card>
      )}

      <section className="kit-stack" aria-labelledby="journey-heading">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h2 className="kit-subsection" id="journey-heading">
            Your journey
          </h2>
          <span className="kit-caption">{value.clientProgress}% done</span>
        </div>
        <ol className="kit-journey">
          {value.milestones.map((milestone) => (
            <li data-state={milestone.status} key={milestone.id}>
              <span aria-hidden="true" className="kit-journey-dot">
                {milestone.status === "complete" ? <CheckCircle2 size={16} /> : null}
              </span>
              <span className="kit-row-text">
                <span className="kit-row-title">
                  {milestone.label}
                  {milestone.status === "current" ? <span className="kit-sr"> (now)</span> : null}
                </span>
                <span className="kit-row-subtitle">{milestone.description}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>
      <PoweredBy />
    </Main>
  );
}
