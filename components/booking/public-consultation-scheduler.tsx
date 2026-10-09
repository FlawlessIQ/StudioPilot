"use client";

import { useEffect, useState } from "react";
import { CalendarDays, CheckCircle2, LoaderCircle } from "lucide-react";
import {
  Actions,
  AppBar,
  Button,
  Card,
  KitRoot,
  Main,
  Note,
  PoweredBy,
  Screen,
  type Studio,
} from "@/components/kit/kit";
import { SlotPicker, slotLabel } from "@/components/kit/slot-picker";
import { runPublicScheduling } from "@/lib/booking/public-scheduling-client";

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
};
type Slot = { startsAt: string; endsAt: string };

export function PublicConsultationScheduler({ token }: { token: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const finalCall = preview?.purpose === "final_details";
  const trial = preview?.purpose === "trial";
  const callWord = (preview?.callName ?? (finalCall ? "final details call" : "consultation")).toLowerCase();
  const [slots, setSlots] = useState<Slot[]>([]);
  const [timezone, setTimezone] = useState("");
  const [selected, setSelected] = useState("");
  const [status, setStatus] = useState<
    "loading" | "ready" | "booking" | "complete" | "error"
  >("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) {
      queueMicrotask(() => {
        setStatus("error");
        setMessage("This scheduling link is incomplete.");
      });
      return;
    }
    let active = true;
    void Promise.all([
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
      .then(([previewResult, availability]) => {
        if (!active) return;
        setPreview({
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
        });
        setSlots(
          Array.isArray(availability.slots)
            ? availability.slots
                .filter(
                  (slot): slot is Record<string, unknown> =>
                    typeof slot === "object" && slot !== null,
                )
                .map((slot) => ({
                  startsAt: String(slot.startsAt),
                  endsAt: String(slot.endsAt),
                }))
            : [],
        );
        setTimezone(String(availability.timezone ?? ""));
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
      // Not toLocaleString(): it printed "9/18/2026, 10:00:00 AM" — seconds and
      // a slash-date — to a couple, in whatever zone their laptop is set to.
      // The studio's zone is the one the appointment is in.
      setMessage(
        `Your ${callWord} is confirmed for ${new Intl.DateTimeFormat("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          timeZone: timezone || undefined,
        }).format(new Date(String(result.startsAt)))}.`,
      );
    } catch (caught: unknown) {
      setStatus("ready");
      setMessage(words(caught, "That time could not be booked. Please choose another."));
    }
  }

  const brand: Studio = {
    name: preview?.studioName ?? "Your photographer",
    color: preview?.brandAccentColor ?? null,
    logoUrl: preview?.brandLogoUrl ?? null,
  };
  const zone = timezone || "the studio’s time zone";

  return (
    <KitRoot studio={brand}>
      <Screen>
        <AppBar studio={brand} />
        <Main label={`Choose a ${callWord} time`}>
          <div className="kit-stack-tight">
            <p className="kit-eyebrow">{preview?.callName ?? (finalCall ? "Final details call" : "Photography consultation")}</p>
            <h1 className="kit-title">
              {status === "complete"
                ? "You’re booked in"
                : preview
                  ? `Choose a time with ${preview.studioName}`
                  : `Choose a ${callWord} time`}
            </h1>
            {status === "complete" ? null : (
              <p className="kit-body">
                {finalCall
                  ? "A short call to go over your final details and timeline together. Pick one of the studio’s openings — nothing is booked until you confirm."
                  : trial
                    ? "Your look, tried before the day. Pick one of the studio’s openings — nothing is booked until you confirm."
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
          ) : (
            <div className="kit-stack">
              {preview ? (
                <p className="kit-caption">
                  {preview.projectName} · {preview.mode.replaceAll("_", " ")}
                </p>
              ) : null}
              <SlotPicker onSelect={setSelected} selected={selected} slots={slots} timezone={timezone} />
              {slots.length ? (
                <p className="kit-caption">Times shown in {zone}.</p>
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
        {status === "ready" || status === "booking" ? (
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
