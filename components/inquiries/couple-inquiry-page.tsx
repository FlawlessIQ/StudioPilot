"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { CalendarDays, CheckCircle2, Clock3, LoaderCircle, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { runPublicScheduling } from "@/lib/booking/public-scheduling-client";

/**
 * The couple's own page: tell us about your day, then pick a time to talk.
 *
 * Reached from the link in the studio's first reply (and every reply until a
 * call is booked). One page instead of two emails: the details the studio
 * still needs — only those — then a time and a way to meet. Coming back later
 * shows the booked call, with a way to move or cancel it.
 */

type Field = "eventDate" | "partnerName" | "venue" | "city" | "ceremonyTime" | "estimatedGuestCount" | "phone";
type Format = "zoom" | "in_person" | "phone";

type Preview = {
  studioName: string;
  firstName: string | null;
  known: Partial<Record<Field, string | number>>;
  missing: Field[];
  detailsSubmitted: boolean;
  formats: Format[];
  inPersonLocation: string | null;
  durationMinutes: number;
  takesBookings: boolean;
  timezone: string;
  booked: { startsAt: string; endsAt: string; format: Format; joinUrl: string | null; location: string | null } | null;
};
type Slot = { startsAt: string; endsAt: string };

const fieldCopy: Record<Field, { label: string; type: string; placeholder?: string }> = {
  eventDate: { label: "Your wedding date", type: "date" },
  partnerName: { label: "Your partner’s name", type: "text" },
  venue: { label: "Venue", type: "text", placeholder: "If you’ve chosen one" },
  city: { label: "Town or city", type: "text" },
  ceremonyTime: { label: "Ceremony time", type: "text", placeholder: "e.g. 4:30pm, if you know it" },
  estimatedGuestCount: { label: "Roughly how many guests", type: "number" },
  phone: { label: "Best number to reach you", type: "tel" },
};

const formatCopy: Record<Format, string> = {
  zoom: "Video call",
  in_person: "In person",
  phone: "Phone call",
};

const friendly: Record<string, string> = {
  INQUIRY_LINK_NOT_FOUND: "This link isn’t working. Reply to the studio’s email and they’ll send a new one.",
  INQUIRY_LINK_CLOSED: "This inquiry is closed. Reply to the studio’s email if you’d like to pick it back up.",
  TIME_NO_LONGER_AVAILABLE: "That time was just taken. Please choose another.",
  EVENT_DATE_REQUIRED: "Add your wedding date first, so the studio can check it’s free.",
  FORMAT_NOT_OFFERED: "Please choose one of the ways the studio meets.",
};

function message(caught: unknown, fallback: string): string {
  const code = caught instanceof Error ? caught.message : "";
  return friendly[code] ?? fallback;
}

function when(startsAt: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone || undefined,
  }).format(new Date(startsAt));
}

const call = (type: string, input: Record<string, unknown>) =>
  runPublicScheduling({ type, idempotencyKey: crypto.randomUUID(), input });

export function CoupleInquiryPage({ token }: { token: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [step, setStep] = useState<"loading" | "details" | "time" | "booked" | "error">("loading");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [values, setValues] = useState<Partial<Record<Field | "notes", string>>>({});
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selected, setSelected] = useState("");
  const [format, setFormat] = useState<Format | "">("");
  // Bumped after each change so the page re-reads where the couple stands.
  const [reloadKey, setReloadKey] = useState(0);
  const load = () => setReloadKey((key) => key + 1);

  useEffect(() => {
    let active = true;
    const read = token
      ? call("inquiry_preview", { token })
      : Promise.reject(new Error("INQUIRY_LINK_NOT_FOUND"));
    void read
      .then((raw) => {
        if (!active) return;
        const result = raw as unknown as Preview;
        setPreview(result);
        setFormat((current) => current || result.formats[0] || "zoom");
        setStep(
          result.booked
            ? "booked"
            : result.missing.length && !result.detailsSubmitted
              ? "details"
              : "time",
        );
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setNotice(message(caught, "This page couldn’t load. Please try again in a moment."));
        setStep("error");
      });
    return () => {
      active = false;
    };
  }, [token, reloadKey]);

  useEffect(() => {
    if (step !== "time" || !preview?.takesBookings) return;
    let active = true;
    void call("inquiry_availability", { token })
      .then((result) => {
        if (!active) return;
        setSlots(
          Array.isArray(result.slots)
            ? (result.slots as Array<Record<string, unknown>>).map((slot) => ({
                startsAt: String(slot.startsAt),
                endsAt: String(slot.endsAt),
              }))
            : [],
        );
      })
      .catch((caught: unknown) => {
        if (active) setNotice(message(caught, "Times couldn’t load. Please try again."));
      });
    return () => {
      active = false;
    };
  }, [step, preview?.takesBookings, token]);

  const groups = useMemo(
    () =>
      slots.reduce<Record<string, Slot[]>>((result, slot) => {
        const key = new Intl.DateTimeFormat("en-US", {
          weekday: "long",
          month: "short",
          day: "numeric",
          timeZone: preview?.timezone || undefined,
        }).format(new Date(slot.startsAt));
        result[key] = [...(result[key] ?? []), slot];
        return result;
      }, {}),
    [slots, preview?.timezone],
  );

  async function saveDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      const details: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(values)) {
        if (!value || !value.trim()) continue;
        details[key] = key === "estimatedGuestCount" ? Number(value) : value.trim();
      }
      await call("inquiry_details", { token, details });
      load();
    } catch (caught: unknown) {
      setNotice(message(caught, "Your details couldn’t be saved. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  async function book() {
    if (!selected || !format) return;
    setBusy(true);
    setNotice("");
    try {
      await call("inquiry_book", { token, startsAt: selected, format });
      setSelected("");
      load();
    } catch (caught: unknown) {
      setNotice(message(caught, "That time couldn’t be booked. Please try another."));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!window.confirm("Cancel your consultation? You can book another time here afterwards.")) return;
    setBusy(true);
    setNotice("");
    try {
      await call("inquiry_cancel", { token, reason: null });
      load();
    } catch (caught: unknown) {
      setNotice(message(caught, "Your consultation couldn’t be cancelled. Please reply to the studio’s email."));
    } finally {
      setBusy(false);
    }
  }

  const studio = preview?.studioName ?? "your photographer";
  const phrase =
    step === "details"
      ? "tell us about your day"
      : step === "booked"
        ? "you’re booked in"
        : `pick a time to talk with ${studio}`;
  // "Hi Sarah — tell us…" once we know them; otherwise the phrase stands alone
  // and starts with a capital.
  const heading = preview?.firstName
    ? `Hi ${preview.firstName} — ${phrase}`
    : `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}`;
  const missingDate = preview?.missing.includes("eventDate") ?? false;

  return (
    <main className="public-scheduler-page">
      <header>
        <Logo />
        <span>
          <ShieldCheck size={16} /> Private to you
        </span>
      </header>
      <section className="public-scheduler-layout">
        <aside>
          <p className="eyebrow">{step === "details" ? "Step 1 of 2" : step === "time" ? "Step 2 of 2" : "Your consultation"}</p>
          <h1>{heading}</h1>
          <p>
            {step === "details"
              ? "Just what the studio doesn’t know yet. Skip anything you haven’t decided."
              : step === "booked"
                ? "Need a different time? You can move it or cancel it here."
                : `A ${preview?.durationMinutes ?? 30}-minute conversation about your plans. Nothing is booked until you confirm.`}
          </p>
        </aside>
        <div className="panel public-scheduler-card">
          {step === "loading" ? (
            <div className="public-scheduler-state">
              <LoaderCircle className="spin" />
              <strong>One moment…</strong>
            </div>
          ) : step === "error" ? (
            <div className="public-scheduler-state">
              <CalendarDays />
              <strong>This link isn’t available</strong>
              <p>{notice}</p>
            </div>
          ) : step === "details" && preview ? (
            <form className="couple-details-form" onSubmit={(event) => void saveDetails(event)}>
              {preview.missing.map((field) => (
                <label key={field}>
                  {fieldCopy[field].label}
                  <input
                    inputMode={field === "estimatedGuestCount" ? "numeric" : undefined}
                    min={field === "estimatedGuestCount" ? 1 : undefined}
                    onChange={(event) => setValues((current) => ({ ...current, [field]: event.target.value }))}
                    placeholder={fieldCopy[field].placeholder}
                    required={field === "eventDate"}
                    type={fieldCopy[field].type}
                    value={values[field] ?? ""}
                  />
                </label>
              ))}
              <label>
                {`Anything else you’d like ${studio} to know?`}
                <textarea
                  onChange={(event) => setValues((current) => ({ ...current, notes: event.target.value }))}
                  rows={3}
                  value={values.notes ?? ""}
                />
              </label>
              <div className="couple-details-actions">
                <button className="button button-dark" disabled={busy} type="submit">
                  {busy ? "Saving…" : "Continue"}
                </button>
                {!missingDate ? (
                  <button className="button button-light" disabled={busy} onClick={() => setStep("time")} type="button">
                    Skip for now
                  </button>
                ) : null}
              </div>
              {notice ? <p className="form-notice">{notice}</p> : null}
            </form>
          ) : step === "booked" && preview?.booked ? (
            <div className="public-scheduler-state is-complete">
              <CheckCircle2 />
              <strong>{when(preview.booked.startsAt, preview.timezone)}</strong>
              <p>
                {formatCopy[preview.booked.format] ?? "Consultation"}
                {preview.booked.format === "in_person" && preview.booked.location ? ` at ${preview.booked.location}` : ""}
              </p>
              {preview.booked.format === "zoom" && preview.booked.joinUrl ? (
                <a className="button button-light" href={preview.booked.joinUrl} rel="noreferrer" target="_blank">
                  Open the video call link
                </a>
              ) : null}
              <small>We’ve emailed you the details.</small>
              <div className="couple-details-actions">
                <button className="button button-light" disabled={busy} onClick={() => setStep("time")} type="button">
                  Choose a different time
                </button>
                <button className="button button-light" disabled={busy} onClick={() => void cancel()} type="button">
                  Cancel it
                </button>
              </div>
              {notice ? <p className="form-notice">{notice}</p> : null}
            </div>
          ) : preview && !preview.takesBookings ? (
            <div className="public-scheduler-state is-complete">
              <CheckCircle2 />
              <strong>Thank you — that’s everything</strong>
              <p>{studio} will be in touch to find a time to talk.</p>
            </div>
          ) : preview ? (
            <>
              {preview.formats.length > 1 ? (
                <fieldset className="couple-format-choice">
                  <legend>How would you like to meet?</legend>
                  {preview.formats.map((option) => (
                    <label key={option}>
                      <input
                        checked={format === option}
                        name="meeting-format"
                        onChange={() => setFormat(option)}
                        type="radio"
                      />
                      <span>
                        {formatCopy[option]}
                        {option === "in_person" && preview.inPersonLocation ? <small>{preview.inPersonLocation}</small> : null}
                      </span>
                    </label>
                  ))}
                </fieldset>
              ) : null}
              <div className="panel-heading">
                <div>
                  <h2>Available times</h2>
                  <p>Times shown in {preview.timezone}.</p>
                </div>
                <Clock3 />
              </div>
              <div className="public-slot-groups">
                {Object.entries(groups).slice(0, 7).map(([date, dayslots]) => (
                  <fieldset key={date}>
                    <legend>{date}</legend>
                    <div>
                      {dayslots.map((slot) => (
                        <label key={slot.startsAt}>
                          <input
                            checked={selected === slot.startsAt}
                            name="consultation-time"
                            onChange={() => setSelected(slot.startsAt)}
                            type="radio"
                          />
                          <span>
                            {new Intl.DateTimeFormat("en-US", {
                              hour: "numeric",
                              minute: "2-digit",
                              timeZone: preview.timezone || undefined,
                            }).format(new Date(slot.startsAt))}
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
                {!slots.length ? <p>No times are open right now. Reply to the studio’s email and they’ll find one.</p> : null}
              </div>
              <button
                className="button button-dark"
                disabled={!selected || !format || busy}
                onClick={() => void book()}
                type="button"
              >
                {busy ? "Confirming…" : preview.booked ? "Move my consultation" : "Confirm consultation"}
              </button>
              {notice ? <p className="form-notice">{notice}</p> : null}
            </>
          ) : null}
        </div>
      </section>
    </main>
  );
}
