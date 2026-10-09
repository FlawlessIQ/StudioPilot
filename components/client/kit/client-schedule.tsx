"use client";

import { mcScriptLine, type McScript } from "@/features/schedules/mc-script";
import { useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Clock3, MapPin, MessageCircle, PencilLine } from "lucide-react";
import { Actions, Button, ButtonRow, Card, KitRoot, Main, Note, PoweredBy, TextArea } from "@/components/kit/kit";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { useWorkspace } from "@/features/auth/workspace-context";
import { portalStageIsBehind } from "@/features/client/portal-stage";
import { tradeProfile, tradeVocab } from "@/features/trades/trades";
import {
  displayableScheduleItems,
  scheduleItemClock,
  scheduleZoneLabel,
} from "@/features/schedules/item-clock";
import { friendlyError } from "@/lib/ai/friendly-error";
import { sendPlanningCommand } from "@/lib/planning/command-client";
import { dataIsLive } from "@/lib/runtime-mode";
import { number, text, useClientVocab, useProject, useProjectRecords } from "@/components/client/live-client-views";
import { EmptyMoment } from "@/components/client/kit/empty-moment";
import { InfoHint } from "@/components/ui/info-hint";

type Item = Record<string, unknown>;
type Sheet = { kind: "approve" } | { kind: "changes"; item: Item | null } | null;

/**
 * The couple's wedding-day timeline (M4 of
 * docs/mobile-first-client-crew-plan-2026-09-28.md).
 *
 * A vertical day in the event's own time zone. Approving is a deliberate
 * second step in a sheet (it used to be one tap), and a change request starts
 * from the moment it is about ("Ask about this") instead of a long <select>
 * whose times were in the phone's zone and which listed items that could not
 * even be shown.
 *
 * A DJ's, makeup artist's or hair stylist's client has nothing to approve
 * (trades.ts `journey.scheduleApproval`): the studio publishes the plan with
 * `approvalState: "none"` (functions/src/planning/schedule-lifecycle.ts) and
 * it is here to read, in the trade's words, with no Approve button.
 */
export function ClientSchedule() {
  const workspace = useWorkspace();
  const project = useProject();
  const words = useClientVocab();
  const schedules = useProjectRecords("schedules");
  const [sheet, setSheet] = useState<Sheet>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localStatus, setLocalStatus] = useState<string | null>(null);
  const ordered = useMemo(
    () => [...schedules.value].sort((a, b) => number(b.version) - number(a.version)),
    [schedules.value],
  );
  const schedule = ordered[0];
  const studioName =
    workspace.tenantName && !workspace.tenantName.startsWith("Loading") ? workspace.tenantName : "your studio";
  // The plan's own name for a vendor ("Getting-ready schedule"); "Your timeline" otherwise.
  const tradeWords = tradeVocab(workspace.tenantTrade);
  const readOnlyTrade = !tradeProfile(workspace.tenantTrade).journey.scheduleApproval;
  const title = readOnlyTrade && tradeWords.planOfDay ? tradeWords.planOfDay : "Your timeline";

  if (!schedule)
    return (
      <Main label="Timeline">
        <div className="kit-stack-tight">
          <p className="kit-eyebrow">{words.Day}</p>
          <h1 className="kit-title">{title}</h1>
        </div>
        <EmptyMoment
          area="schedule"
          error={schedules.error}
          loading={schedules.loading}
          loadingText="Opening your timeline…"
          upcoming={
            readOnlyTrade
              ? `${studioName === "your studio" ? "Your studio" : studioName} builds this from your ${(tradeWords.detailsForm ?? "form").toLowerCase()} and shares it here. There’s nothing for you to approve.`
              : `${studioName === "your studio" ? "Your studio" : studioName} will share the running order of your day here when it’s ready for you to check.`
          }
        />
        <PoweredBy />
      </Main>
    );

  const zone = text(schedule.timezone, "") || undefined;
  const zoneLabel = scheduleZoneLabel(zone);
  const items = displayableScheduleItems(
    (Array.isArray(schedule.items) ? (schedule.items as Item[]) : []).filter((item) =>
      ["client", "shared"].includes(text(item.visibility, "shared")),
    ),
  );
  /**
   * A published version keeps `status: "published"`; whether they have
   * answered it is `approvalState`. This read `status` alone and waited for
   * "client_review", which nothing sets — so no couple was ever asked.
   */
  const approval = text(schedule.approvalState);
  const status =
    localStatus ??
    (approval === "client_approved"
      ? "approved"
      : approval === "changes_requested"
        ? "changes_requested"
        : text(schedule.status));
  // Nothing is left to decide about a day that has happened.
  const behind = portalStageIsBehind(project.value?.milestones ?? null, "schedule");
  const awaiting = status === "client_review" || (status === "published" && approval === "client_pending");
  // A vendor's client is never asked, even on a version published before
  // their plans stopped asking (it still says "client_pending").
  const actionable = awaiting && items.length > 0 && !behind && !readOnlyTrade;
  // Published to read: nothing to approve (publishedApprovalState).
  const toRead =
    !actionable &&
    items.length > 0 &&
    !behind &&
    status === "published" &&
    (approval === "none" || (readOnlyTrade && approval === "client_pending"));
  // "The morning" → "morning", "The night" → "night".
  const dayWord = tradeWords.dayName.replace(/^the /i, "").toLowerCase();
  const version = number(schedule.version);

  function open(next: Sheet) {
    setError(null);
    setNote("");
    setSheet(next);
  }

  async function decide(decision: "approved" | "changes_requested") {
    if (busy) return;
    const about = sheet?.kind === "changes" ? sheet.item : null;
    const clock = about ? scheduleItemClock(about, zone) : null;
    setBusy(true);
    setError(null);
    try {
      /**
       * Only an answer the studio actually received is shown as sent.
       *
       * This skipped the call outside live data and fell through to the
       * success state, and the command client answers "not persisted" rather
       * than failing when its endpoint is missing — either way the couple was
       * told their answer had gone when nothing had reached the studio.
       */
      if (!dataIsLive) {
        setError("This is a preview, so nothing was sent to your studio.");
        return;
      }
      const response = await sendPlanningCommand("approveSchedule", {
        projectId: schedule.projectId,
        scheduleId: schedule.id,
        decision,
        notes:
          decision === "approved"
            ? "Approved by client in the StudioCue portal."
            : `${about ? `Schedule item: ${text(about.title)} (${clock?.start ?? "time to be confirmed"}). ` : ""}${note.trim()}`,
      });
      if (!response.persisted) {
        setError("Your answer couldn’t reach your studio just now. Please try again in a moment.");
        return;
      }
      setLocalStatus(decision);
      setSheet(null);
      window.scrollTo({ top: 0 });
    } catch (caught: unknown) {
      setError(friendlyError(caught, "Your answer couldn’t be sent. Check your connection and try again."));
    } finally {
      setBusy(false);
    }
  }

  const about = sheet?.kind === "changes" ? sheet.item : null;
  const aboutClock = about ? scheduleItemClock(about, zone) : null;

  return (
    <>
      <Main label="Timeline">
        <div className="kit-stack-tight">
          <p className="kit-eyebrow">{words.Day} · version {version}</p>
          <h1 className="kit-title">{title}</h1>
          <p className="kit-body">
            {zoneLabel ? `Times are in ${zoneLabel}, where the ${words.event} is.` : `Times are local to the ${words.event}.`}
            {ordered.length > 1 ? ` Earlier versions are kept by ${studioName}.` : ""}
          </p>
        </div>

        {actionable ? (
          <Card tone="accent">
            <h2 className="kit-section">
              Ready for you to check <InfoHint term="couple-timeline" />
            </h2>
            <p className="kit-body">
              Look through the times. If one’s not right, tap “Ask about this” on it. If it all looks good, approve
              it so your studio and crew can plan from it.
            </p>
          </Card>
        ) : status === "approved" ? (
          <Note icon={CheckCircle2} tone="accent">
            {`You approved version ${version}. If anything changes, ${studioName} will send a new version to check.`}
          </Note>
        ) : status === "changes_requested" ? (
          <Note icon={PencilLine}>
            {`You asked for changes to version ${version}. ${studioName === "your studio" ? "Your studio" : studioName} is revising it and will send the new version here.`}
          </Note>
        ) : toRead ? (
          <Note icon={CheckCircle2} tone="accent">
            {`Here’s the plan for your ${dayWord}, built from what you told ${studioName}. There’s nothing you need to do — if something changes, send them a message.`}
          </Note>
        ) : behind ? (
          <Note icon={Clock3}>The running order your day was built on, kept for your records.</Note>
        ) : null}

        {items.length ? (
          <ol aria-label="Timeline" className="kit-timeline">
            {items.map((item) => {
              const clock = scheduleItemClock(item, zone);
              return (
                <li key={text(item.id)}>
                  <span className="kit-timeline-time">
                    {clock?.start}
                    {clock?.end ? <small>to {clock.end}</small> : null}
                  </span>
                  <span className="kit-timeline-body">
                    <span className="kit-timeline-title">{text(item.title, "Detail to be confirmed")}</span>
                    {/* A DJ's song and announcement for the moment, so the couple can check names. */}
                    {mcScriptLine(item.mc as Partial<McScript> | undefined) ? (
                      <span className="kit-timeline-place">{mcScriptLine(item.mc as Partial<McScript> | undefined)}</span>
                    ) : null}
                    {item.location ? (
                      <span className="kit-timeline-place">
                        <MapPin aria-hidden size={13} /> {text(item.location)}
                      </span>
                    ) : null}
                    {actionable ? (
                      <button
                        aria-label={`Ask about ${text(item.title, "this")}`}
                        className="kit-timeline-ask"
                        onClick={() => open({ kind: "changes", item })}
                        type="button"
                      >
                        Ask about this
                      </button>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ol>
        ) : (
          <Card>
            <h2 className="kit-section">No times are set yet</h2>
            <p className="kit-body">
              Your studio is still putting the running order together. It will appear here as soon as the times are
              set.
            </p>
          </Card>
        )}

        <Link
          className="kit-caption"
          href="/client/messages?context=Event%20schedule"
          style={{ display: "inline-flex", gap: 6, alignItems: "center" }}
        >
          <MessageCircle aria-hidden size={15} /> {`Message ${studioName} about the day`}
        </Link>
        <PoweredBy />
      </Main>

      {actionable ? (
        <Actions>
          <ButtonRow>
            <Button onClick={() => open({ kind: "changes", item: null })} size="compact" variant="secondary">
              Ask for changes
            </Button>
            <Button onClick={() => open({ kind: "approve" })}>
              Approve timeline
            </Button>
          </ButtonRow>
        </Actions>
      ) : null}

      <SheetDialog
        label={sheet?.kind === "approve" ? `Approve version ${version}?` : "Ask for a change"}
        onClose={() => (busy ? undefined : setSheet(null))}
        open={sheet !== null}
      >
        <KitRoot className="kit-embed kit-sheet" studio={{ color: workspace.tenantBrand?.primaryColor ?? null }}>
          {sheet?.kind === "approve" ? (
            <div className="kit-stack">
              <p className="kit-body">
                {`${studioName === "your studio" ? "Your studio" : studioName} and your crew will work from these ${items.length} times. If something changes later, they’ll send a new version for you to check.`}
              </p>
              {error ? (
                <p className="kit-error" role="alert">
                  {error}
                </p>
              ) : null}
              <Button disabled={busy} icon={CheckCircle2} onClick={() => void decide("approved")}>
                {busy ? "Approving…" : `Approve version ${version}`}
              </Button>
              <Button disabled={busy} onClick={() => setSheet(null)} variant="secondary">
                Not yet
              </Button>
            </div>
          ) : sheet?.kind === "changes" ? (
            <div className="kit-stack">
              <p className="kit-body">
                {about
                  ? `About ${text(about.title, "this moment")}${aboutClock ? ` at ${aboutClock.start}` : ""}.`
                  : "About the timeline overall."}
              </p>
              <TextArea
                autoFocus
                hint="A few words is fine: the right time, place or order."
                label="What should change?"
                maxLength={2000}
                onChange={(event) => setNote(event.target.value)}
                rows={4}
                value={note}
              />
              {error ? (
                <p className="kit-error" role="alert">
                  {error}
                </p>
              ) : null}
              <Button
                disabled={busy || note.trim().length < 10}
                onClick={() => void decide("changes_requested")}
              >
                {busy ? "Sending…" : "Send to your studio"}
              </Button>
            </div>
          ) : null}
        </KitRoot>
      </SheetDialog>
    </>
  );
}
