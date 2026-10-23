"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, CheckCircle2, LoaderCircle } from "lucide-react";
import {
  Actions,
  AppBar,
  Button,
  Card,
  Field,
  KitRoot,
  Main,
  Note,
  PoweredBy,
  Screen,
  type Studio,
} from "@/components/kit/kit";
import { SlotPicker, slotLabel } from "@/components/kit/slot-picker";
import { runPublicScheduling } from "@/lib/booking/public-scheduling-client";
import { scheduleZoneLabel } from "@/features/schedules/item-clock";
import { BOOKING_PAUSED_CODE, bookingPaused, bookingPausedCopy } from "@/features/consultations/booking-paused";

/** What went wrong, in words a couple can act on, not the server's code. */
const friendly: Record<string, string> = {
  SCHEDULING_LINK_EXPIRED: "This scheduling link has expired. Reply to the studio’s email and they’ll send a new one.",
  SCHEDULING_LINK_NOT_FOUND: "This scheduling link isn’t working. Reply to the studio’s email and they’ll send a new one.",
  TIME_NO_LONGER_AVAILABLE: "That time was just taken. Please choose another.",
};
const words = (caught: unknown, fallback: string) => {
  const code = caught instanceof Error ? caught.message : "";
  return friendly[code] ?? fallback;
};

type Preview = {
  studioName: string;
  brandAccentColor?: string | null;
  brandLogoUrl?: string | null;
  projectName: string;
  eventDate: string | null;
  expiresAt: string;
  mode: string;
  /** "final_details": the call a month out; "trial": a makeup or hair trial (features/consultations/purpose.ts). */
  purpose?: string;
  /** The call in the studio's trade's words: "Vibe call", "Makeup trial" (trades.ts). */
  callName?: string;
  /**
   * Set when this link has already booked a call that is still on: when it
   * is, and the studio's zone (functions/src/booking/scheduling-link-view.ts).
   */
  booked?: { startsAt: string; timezone: string } | null;
};
type Slot = { startsAt: string; endsAt: string };
/**
 * The week of a trial's openings on show, and how far it can go
 * (functions/src/booking/trial-window.ts). YYYY-MM-DD on the studio's clock.
 */
type TrialRange = {
  start: string;
  end: string;
  earliest: string;
  latest: string;
  previous: string | null;
  next: string | null;
};

const readSlots = (value: unknown): Slot[] =>
  Array.isArray(value)
    ? value
        .filter((slot): slot is Record<string, unknown> => typeof slot === "object" && slot !== null)
        .map((slot) => ({ startsAt: String(slot.startsAt), endsAt: String(slot.endsAt) }))
    : [];

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const readRange = (value: unknown): TrialRange | null => {
  if (typeof value !== "object" || value === null) return null;
  const range = value as Record<string, unknown>;
  const day = (key: string) => (typeof range[key] === "string" && DAY.test(range[key] as string) ? (range[key] as string) : null);
  const start = day("start");
  const end = day("end");
  const earliest = day("earliest");
  const latest = day("latest");
  if (!start || !end || !earliest || !latest) return null;
  return { start, end, earliest, latest, previous: day("previous"), next: day("next") };
};

const readBooked = (value: unknown): Preview["booked"] => {
  if (typeof value !== "object" || value === null) return null;
  const booked = value as Record<string, unknown>;
  const startsAt = typeof booked.startsAt === "string" ? booked.startsAt : "";
  if (!startsAt || Number.isNaN(Date.parse(startsAt))) return null;
  return { startsAt, timezone: typeof booked.timezone === "string" ? booked.timezone : "" };
};

/**
 * "Wednesday, October 14 at 10:00 AM", on the studio's clock: the zone the
 * appointment is in. Not toLocaleString(), which printed "9/18/2026,
 * 10:00:00 AM" (seconds and a slash-date) to a couple, in whatever zone
 * their laptop was set to. Said the same right after booking and on a return.
 */
export function bookedWhen(startsAt: string, timezone: string): string {
  const options: Intl.DateTimeFormatOptions = {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  };
  try {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone: timezone || undefined }).format(new Date(startsAt));
  } catch {
    // A zone name this browser doesn't know: the time, rather than a blank page.
    return new Intl.DateTimeFormat("en-US", options).format(new Date(startsAt));
  }
}

/** "Mar 9" for a studio-local YYYY-MM-DD. */
const shortDay = (day: string) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));

/**
 * A trial week with nothing open, pointing only where there is somewhere to
 * go: the last week before the event has no later one.
 */
export function noOpeningsThatWeek(range: Pick<TrialRange, "previous" | "next">): string {
  if (range.next) return "No openings that week. Try a later one, or jump to another date.";
  if (range.previous) return "No openings that week. Try an earlier one, or reply to the studio’s email.";
  return "No openings before the day. Reply to the studio’s email and they’ll find a time.";
}

export function PublicConsultationScheduler({ token }: { token: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const finalCall = preview?.purpose === "final_details";
  const trial = preview?.purpose === "trial";
  const walkthrough = preview?.purpose === "walkthrough";
  // Unknown until the preview loads: a makeup trial's page must not open on
  // "consultation" (a makeup artist or hair stylist has no sales call).
  const callWord = preview ? (preview.callName ?? (finalCall ? "final details call" : "consultation")).toLowerCase() : null;
  const chooseTime = callWord ? `Choose a ${callWord} time` : "Choose a time";
  const [slots, setSlots] = useState<Slot[]>([]);
  // A trial's openings come a week at a time, up to the day before the
  // event: a hair trial waits for the veil, often months (Priya Shah, Jess
  // Styles Bridal, 2026-10-10). Null for a call, which keeps its next openings.
  const [range, setRange] = useState<TrialRange | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const browseAsk = useRef(0);
  // What they typed in "Or jump to a date": theirs, not the week's start, so a
  // date half typed is never overwritten.
  const [jumpTo, setJumpTo] = useState("");
  const [timezone, setTimezone] = useState("");
  const [selected, setSelected] = useState("");
  // "complete": booked just now, on this page. "booked": booked before, and
  // opened again.
  const [status, setStatus] = useState<
    "loading" | "ready" | "booking" | "complete" | "booked" | "error"
  >("loading");
  const [message, setMessage] = useState("");
  // The studio's calendar couldn't be read, so no time is offered: the page
  // says online booking is briefly unavailable (features/consultations/booking-paused.ts).
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!token) {
      queueMicrotask(() => {
        setStatus("error");
        setMessage("This scheduling link is incomplete.");
      });
      return;
    }
    let active = true;
    // Both at once, as before. A link that has booked answers the preview with
    // its booking and refuses the openings, so the preview decides first.
    void Promise.allSettled([
      runPublicScheduling({
        type: "preview",
        idempotencyKey: crypto.randomUUID(),
        input: { token },
      }),
      runPublicScheduling({
        type: "availability",
        idempotencyKey: crypto.randomUUID(),
        input: { token },
      }),
    ])
      .then(([previewSettled, availabilitySettled]) => {
        if (!active) return;
        if (previewSettled.status === "rejected") throw previewSettled.reason;
        const previewResult = previewSettled.value;
        const booked = readBooked(previewResult.booked);
        const loaded: Preview = {
          studioName: String(previewResult.studioName),
          projectName: String(previewResult.projectName),
          eventDate:
            typeof previewResult.eventDate === "string"
              ? previewResult.eventDate
              : null,
          expiresAt: String(previewResult.expiresAt),
          mode: String(previewResult.mode),
          brandAccentColor:
            typeof previewResult.brandAccentColor === "string" ? previewResult.brandAccentColor : null,
          brandLogoUrl: typeof previewResult.brandLogoUrl === "string" ? previewResult.brandLogoUrl : null,
          // What the call is for, in the studio's words: a makeup trial, a
          // final details call (public-scheduling.ts). They were dropped here,
          // so every trial page read "Photography consultation" (UAT on prod, 2026-10-09).
          purpose: typeof previewResult.purpose === "string" ? previewResult.purpose : undefined,
          callName: typeof previewResult.callName === "string" ? previewResult.callName : undefined,
          booked,
        };
        // Booked through this link already: the time it's booked for, and no
        // picker (Priya Shah's hair trial read "expired", 2026-10-11).
        if (booked) {
          setPreview(loaded);
          setTimezone(booked.timezone);
          setStatus("booked");
          return;
        }
        if (availabilitySettled.status === "rejected") throw availabilitySettled.reason;
        const availability = availabilitySettled.value;
        setPreview(loaded);
        setSlots(readSlots(availability.slots));
        setRange(readRange(availability.window));
        setTimezone(String(availability.timezone ?? ""));
        setPaused(bookingPaused(availability));
        setStatus("ready");
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setStatus("error");
        setMessage(words(caught, "This scheduling link is unavailable. Reply to the studio’s email for a new one."));
      });
    return () => {
      active = false;
    };
  }, [token]);

  /** Another week of a trial's openings. The pick stays until they book or pick again. */
  async function browse(from: string) {
    if (!DAY.test(from)) return;
    // Only the latest ask lands: a date typed digit by digit asks several times.
    const ask = ++browseAsk.current;
    setBrowsing(true);
    setMessage("");
    try {
      const availability = await runPublicScheduling({
        type: "availability",
        idempotencyKey: crypto.randomUUID(),
        input: { token, from },
      });
      if (ask !== browseAsk.current) return;
      setSlots(readSlots(availability.slots));
      setRange(readRange(availability.window));
      setPaused(bookingPaused(availability));
    } catch (caught: unknown) {
      if (ask === browseAsk.current) setMessage(words(caught, "Those times couldn’t be loaded. Please try again."));
    } finally {
      if (ask === browseAsk.current) setBrowsing(false);
    }
  }

  async function book() {
    if (!selected) return;
    setStatus("booking");
    setMessage("");
    try {
      const result = await runPublicScheduling({
        type: "book",
        idempotencyKey: crypto.randomUUID(),
        input: { token, startsAt: selected },
      });
      setStatus("complete");
      // On the studio's clock (bookedWhen), the zone the appointment is in.
      setMessage(`Your ${callWord ?? "appointment"} is confirmed for ${bookedWhen(String(result.startsAt), timezone)}.`);
    } catch (caught: unknown) {
      setStatus("ready");
      // The calendar went unreadable since the times loaded: none is bookable.
      if (caught instanceof Error && caught.message === BOOKING_PAUSED_CODE) {
        setPaused(true);
        setSlots([]);
        setSelected("");
        return;
      }
      setMessage(words(caught, "That time could not be booked. Please choose another."));
    }
  }

  const brand: Studio = {
    name: preview?.studioName ?? "Your studio",
    color: preview?.brandAccentColor ?? null,
    logoUrl: preview?.brandLogoUrl ?? null,
  };
  // "Eastern Time", not "America/New_York" (Jess Styles Bridal, 2026-10-12).
  const zone = scheduleZoneLabel(timezone) ?? "the studio’s time zone";
  const bookedIn = status === "complete" || status === "booked";

  return (
    <KitRoot studio={brand}>
      <Screen>
        {/* No stand-in studio: while it loads, or for a link that names none,
            the bar is empty rather than "Your studio". */}
        <AppBar studio={preview ? brand : undefined} />
        <Main label={bookedIn ? "You’re booked in" : chooseTime}>
          <div className="kit-stack-tight">
            {/* The call's own name from the server (tradeVocab): a photographer's
                "Consultation", a DJ's "Vibe call", a "Makeup trial". Nothing before it loads. */}
            {preview ? (
              <p className="kit-eyebrow">{preview.callName ?? (finalCall ? "Final details call" : "Consultation")}</p>
            ) : null}
            <h1 className="kit-title">
              {bookedIn
                ? "You’re booked in"
                : preview
                  ? `Choose a time with ${preview.studioName}`
                  : chooseTime}
            </h1>
            {bookedIn || paused ? null : (
              <p className="kit-body">
                {finalCall
                  ? "A short call to go over your final details and timeline together. Pick one of the studio’s openings — nothing is booked until you confirm."
                  : trial
                    ? "Your look, tried before the day. Pick an opening this week, or browse ahead to any week before the day. Nothing is booked until you confirm."
                    : walkthrough
                      ? "We'll walk the venue together with the venue coordinator. Pick an opening this week, or browse ahead to any week before the day. Nothing is booked until you confirm."
                    : "Pick one of the studio’s openings. Nothing is booked until you confirm."}
              </p>
            )}
          </div>

          {status === "loading" ? (
            <Card>
              <p className="kit-body" role="status">
                <LoaderCircle aria-hidden="true" className="spin" size={18} /> Loading available times…
              </p>
            </Card>
          ) : status === "error" ? (
            <Note icon={CalendarDays}>{message}</Note>
          ) : status === "complete" ? (
            <Card tone="accent">
              <p className="kit-eyebrow" style={{ color: "var(--kit-accent)" }}>
                <CheckCircle2 aria-hidden="true" size={14} /> Confirmed
              </p>
              <p className="kit-body">{message} We’ve emailed you the details.</p>
            </Card>
          ) : status === "booked" && preview?.booked ? (
            // Opened again after booking. This link only ever books, so a
            // change goes through the studio, as the confirmation email says.
            <Card tone="accent">
              <p className="kit-eyebrow" style={{ color: "var(--kit-accent)" }}>
                <CheckCircle2 aria-hidden="true" size={14} /> Confirmed
              </p>
              <p className="kit-body">
                Your {callWord ?? "appointment"} is booked for {bookedWhen(preview.booked.startsAt, timezone)}.
              </p>
              <p className="kit-caption">Time shown in {zone}.</p>
              <p className="kit-body">Need a different time? Reply to the studio’s email and they’ll sort it out.</p>
            </Card>
          ) : paused ? (
            <Note icon={CalendarDays}>{bookingPausedCopy(preview?.studioName)}</Note>
          ) : (
            <div className="kit-stack">
              {preview ? (
                <p className="kit-caption">
                  {preview.projectName} · {preview.mode.replaceAll("_", " ")}
                </p>
              ) : null}
              {range ? (
                <>
                  {/* Wraps rather than squeezes: in a narrow column the dates
                      take their own row above the two buttons (app/kit.css). */}
                  <div aria-label="Week" className="kit-week-nav" role="group">
                    <Button
                      aria-label="Earlier week"
                      disabled={!range.previous || browsing}
                      onClick={() => {
                        if (!range.previous) return;
                        setJumpTo("");
                        void browse(range.previous);
                      }}
                      size="compact"
                      variant="secondary"
                    >
                      Earlier
                    </Button>
                    <span aria-live="polite" className="kit-week-nav-label">
                      {browsing
                        ? "Loading…"
                        : range.start === range.end
                          ? shortDay(range.start)
                          : `${shortDay(range.start)} – ${shortDay(range.end)}`}
                    </span>
                    <Button
                      aria-label="Later week"
                      disabled={!range.next || browsing}
                      onClick={() => {
                        if (!range.next) return;
                        setJumpTo("");
                        void browse(range.next);
                      }}
                      size="compact"
                      variant="secondary"
                    >
                      Later
                    </Button>
                  </div>
                  <Field
                    hint={`Any day up to ${shortDay(range.latest)}.`}
                    label="Or jump to a date"
                    max={range.latest}
                    min={range.earliest}
                    onChange={(event) => {
                      const day = event.target.value;
                      setJumpTo(day);
                      // A year half typed ("0002-03-08") is not a date to fetch.
                      if (day >= range.earliest && day <= range.latest) void browse(day);
                    }}
                    type="date"
                    value={jumpTo}
                  />
                </>
              ) : null}
              {/* Keyed by the week: a new week starts on its own first day,
                  not on a day tapped in the last one. */}
              <SlotPicker
                key={range?.start ?? "calls"}
                onSelect={setSelected}
                selected={selected}
                slots={slots}
                timezone={timezone}
              />
              {slots.length ? (
                <p className="kit-caption">Times shown in {zone}.</p>
              ) : range ? (
                <Note>{noOpeningsThatWeek(range)}</Note>
              ) : (
                <Note>No times are open right now. Reply to the studio’s email and they’ll find one.</Note>
              )}
              {message ? (
                <p className="kit-note" data-tone="danger" role="alert">
                  {message}
                </p>
              ) : null}
            </div>
          )}
          <PoweredBy />
        </Main>
        {(status === "ready" || status === "booking") && !paused ? (
          <Actions>
            <Button disabled={!selected || status === "booking"} onClick={() => void book()}>
              {status === "booking"
                ? "Confirming…"
                : selected
                  ? `Book ${slotLabel(selected, timezone)}`
                  : "Choose a time"}
            </Button>
          </Actions>
        ) : null}
      </Screen>
    </KitRoot>
  );
}
