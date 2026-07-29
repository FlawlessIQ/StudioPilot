"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { runPublicScheduling } from "@/lib/booking/public-scheduling-client";

type Preview = {
  studioName: string;
  projectName: string;
  eventDate: string | null;
  expiresAt: string;
  mode: string;
};
type Slot = { startsAt: string; endsAt: string };

export function PublicConsultationScheduler({ token }: { token: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
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
        setMessage(
          caught instanceof Error
            ? caught.message.replaceAll("_", " ")
            : "This scheduling link is unavailable.",
        );
      });
    return () => {
      active = false;
    };
  }, [token]);

  const groups = useMemo(
    () =>
      slots.reduce<Record<string, Slot[]>>((result, slot) => {
        const key = new Date(slot.startsAt).toLocaleDateString("en-US", {
          weekday: "long",
          month: "short",
          day: "numeric",
        });
        result[key] = [...(result[key] ?? []), slot];
        return result;
      }, {}),
    [slots],
  );

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
      setMessage(
        `Your consultation is confirmed for ${new Date(String(result.startsAt)).toLocaleString()}.`,
      );
    } catch (caught: unknown) {
      setStatus("ready");
      setMessage(
        caught instanceof Error
          ? caught.message.replaceAll("_", " ")
          : "That time could not be booked.",
      );
    }
  }

  return (
    <main className="public-scheduler-page">
      <header>
        <Logo />
        <span>
          <ShieldCheck size={16} /> Secure scheduling
        </span>
      </header>
      <section className="public-scheduler-layout">
        <aside>
          <p className="eyebrow">Photography consultation</p>
          <h1>
            {preview
              ? `Choose a time with ${preview.studioName}`
              : "Choose a consultation time"}
          </h1>
          <p>
            Select one of the studio’s current openings. Your time is confirmed
            only after you finish this step.
          </p>
          {preview ? (
            <dl>
              <div>
                <dt>Project</dt>
                <dd>{preview.projectName}</dd>
              </div>
              <div>
                <dt>Meeting</dt>
                <dd>{preview.mode.replaceAll("_", " ")}</dd>
              </div>
              <div>
                <dt>Timezone</dt>
                <dd>{timezone}</dd>
              </div>
            </dl>
          ) : null}
        </aside>
        <div className="panel public-scheduler-card">
          {status === "loading" ? (
            <div className="public-scheduler-state">
              <LoaderCircle className="spin" />
              <strong>Loading available times…</strong>
            </div>
          ) : status === "error" ? (
            <div className="public-scheduler-state">
              <CalendarDays />
              <strong>Scheduling link unavailable</strong>
              <p>{message}</p>
            </div>
          ) : status === "complete" ? (
            <div className="public-scheduler-state is-complete">
              <CheckCircle2 />
              <strong>Consultation confirmed</strong>
              <p>{message}</p>
              <small>A branded confirmation is on its way to your email.</small>
            </div>
          ) : (
            <>
              <div className="panel-heading">
                <div>
                  <h2>Available times</h2>
                  <p>Times shown in {timezone || "the studio timezone"}.</p>
                </div>
                <Clock3 />
              </div>
              <div className="public-slot-groups">
                {Object.entries(groups).slice(0, 7).map(([date, values]) => (
                  <fieldset key={date}>
                    <legend>{date}</legend>
                    <div>
                      {values.map((slot) => (
                        <label key={slot.startsAt}>
                          <input
                            checked={selected === slot.startsAt}
                            name="consultation-time"
                            onChange={() => setSelected(slot.startsAt)}
                            type="radio"
                          />
                          <span>
                            {new Date(slot.startsAt).toLocaleTimeString(
                              "en-US",
                              { hour: "numeric", minute: "2-digit" },
                            )}
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
                {!slots.length ? (
                  <p>No times are currently available. Contact the studio for help.</p>
                ) : null}
              </div>
              <button
                className="button button-dark"
                disabled={!selected || status === "booking"}
                onClick={() => void book()}
                type="button"
              >
                {status === "booking" ? "Confirming…" : "Confirm consultation"}
              </button>
              {message ? <p className="form-notice">{message}</p> : null}
            </>
          )}
        </div>
      </section>
    </main>
  );
}
