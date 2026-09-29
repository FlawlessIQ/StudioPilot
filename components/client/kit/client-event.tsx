"use client";

import { BadgeCheck, CalendarDays, Camera, MapPin, MessageCircle, Sparkles } from "lucide-react";
import { Button, Card, List, Main, Note, PoweredBy, Row } from "@/components/kit/kit";
import { useWorkspace } from "@/features/auth/workspace-context";
import { eventHasPassed } from "@/features/client/portal-day";
import { portalStageIsBehind } from "@/features/client/portal-stage";
import { todayLocalIso } from "@/lib/format/event-date";
import { date, sentenceCase, text, useProject } from "@/components/client/live-client-views";

/**
 * "Your event": the confirmed details of the day (M5 of
 * docs/mobile-first-client-crew-plan-2026-09-28.md, which brings the last
 * two couple pages into the kit). A four-card grid became one list.
 */
export function ClientEvent() {
  const workspace = useWorkspace();
  const project = useProject();
  const studioName =
    workspace.tenantName && !workspace.tenantName.startsWith("Loading") ? workspace.tenantName : "your studio";

  if (!project.value)
    return (
      <Main label="Your event">
        <div className="kit-stack-tight">
          <p className="kit-eyebrow">Your event</p>
          <h1 className="kit-title">Your wedding</h1>
        </div>
        <Card>
          <p className="kit-body" role={project.error ? "alert" : "status"}>
            {project.loading ? "Opening your event…" : project.error ?? "Your event details will appear here."}
          </p>
        </Card>
        <PoweredBy />
      </Main>
    );

  const value = project.value;
  // Who shot it is a past fact once the day has happened, not a promise.
  const past =
    portalStageIsBehind(value.milestones, "schedule") || eventHasPassed(value.eventDate, todayLocalIso());

  return (
    <Main label="Your event">
      <div className="kit-stack-tight">
        <p className="kit-eyebrow">Your event</p>
        <h1 className="kit-title">{text(value.name, "Your wedding")}</h1>
        <p className="kit-body">{`The details ${studioName === "your studio" ? "your studio has" : `${studioName} has`} confirmed.`}</p>
      </div>

      <List label="Event details">
        <Row icon={CalendarDays} subtitle="Date" title={value.eventDate ? date(value.eventDate) : "Date to be confirmed"} />
        <Row icon={MapPin} subtitle="Venue" title={text(value.venueName ?? value.city, "Venue to be confirmed")} />
        <Row icon={Sparkles} subtitle="Event" title={sentenceCase(text(value.eventType, "wedding").replaceAll("_", " "))} />
        <Row
          icon={Camera}
          subtitle="Lead photographer"
          title={text(
            value.leadPhotographerName,
            past ? "Ask your studio who covered your day" : "Your studio will confirm this",
          )}
        />
      </List>

      {value.clientStage === "Complete" ? (
        <Note icon={BadgeCheck} tone="accent">
          Your wedding is complete. Your agreement, payments, timeline and deliveries stay in Files.
        </Note>
      ) : null}

      <Card>
        <h2 className="kit-section">Something changed?</h2>
        <p className="kit-body">Tell your studio, and they’ll update the plan.</p>
        <Button href="/client/messages?context=Event%20details" icon={MessageCircle} variant="secondary">
          Send a message
        </Button>
      </Card>
      <PoweredBy />
    </Main>
  );
}
