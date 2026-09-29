"use client";

import { useEffect, useState, type FormEvent } from "react";
import { CalendarDays, CheckCircle2, LoaderCircle, Video } from "lucide-react";
import {
  Actions,
  AppBar,
  Button,
  ButtonRow,
  Card,
  Choices,
  Field,
  KitRoot,
  Main,
  Note,
  PoweredBy,
  Screen,
  Steps,
  TextArea,
  type Studio,
} from "@/components/kit/kit";
import { SlotPicker, slotLabel } from "@/components/kit/slot-picker";
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
  /** The studio's colour and logo; absent from an older functions build. */
  brandAccentColor?: string | null;
  brandLogoUrl?: string | null;
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

  // Confirmed in the page, not window.confirm: a browser dialog on a phone
  // reads as an error, and nothing about it looks like the studio.
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  async function cancel() {
    setConfirmingCancel(false);
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

  const brand: Studio = {
    name: preview?.studioName ?? "Your photographer",
    color: preview?.brandAccentColor ?? null,
    logoUrl: preview?.brandLogoUrl ?? null,
  };
  const eyebrow =
    step === "details" ? "Step 1 of 2" : step === "time" ? "Step 2 of 2" : "Your consultation";
  const lede =
    step === "details"
      ? "Just what the studio doesn’t know yet. Skip anything you haven’t decided."
      : step === "booked"
        ? "Need a different time? You can move it or cancel it here."
        : `A ${preview?.durationMinutes ?? 30}-minute conversation about your plans. Nothing is booked until you confirm.`;

  return (
    <KitRoot studio={brand}>
      <Screen>
        <AppBar studio={brand} />
        <Main label="Your inquiry">
          {step === "details" || step === "time" ? (
            <Steps step={step === "details" ? 1 : 2} total={2} />
          ) : null}
          {step !== "loading" && step !== "error" ? (
            <div className="kit-stack-tight">
              <p className="kit-eyebrow">{eyebrow}</p>
              <h1 className="kit-title">{heading}</h1>
              <p className="kit-body">{lede}</p>
            </div>
          ) : null}

          {step === "loading" ? (
            <Card>
              <p className="kit-body" role="status">
                <LoaderCircle aria-hidden="true" className="spin" size={18} /> One moment…
              </p>
            </Card>
          ) : null}

          {step === "error" ? (
            <div className="kit-stack">
              <h1 className="kit-title">This link isn’t available</h1>
              <Note icon={CalendarDays}>{notice}</Note>
            </div>
          ) : null}

          {step === "details" && preview ? (
            <form className="kit-stack" id="couple-details" onSubmit={(event) => void saveDetails(event)}>
              {preview.missing.map((field) => (
                <Field
                  inputMode={field === "estimatedGuestCount" ? "numeric" : field === "phone" ? "tel" : undefined}
                  key={field}
                  label={fieldCopy[field].label}
                  min={field === "estimatedGuestCount" ? 1 : undefined}
                  name={field}
                  onChange={(event) => setValues((current) => ({ ...current, [field]: event.target.value }))}
                  placeholder={fieldCopy[field].placeholder}
                  required={field === "eventDate"}
                  type={fieldCopy[field].type}
                  value={values[field] ?? ""}
                />
              ))}
              <TextArea
                label={`Anything else you’d like ${studio} to know?`}
                onChange={(event) => setValues((current) => ({ ...current, notes: event.target.value }))}
                rows={3}
                value={values.notes ?? ""}
              />
            </form>
          ) : null}

          {step === "booked" && preview?.booked ? (
            <Card tone="accent">
              <p className="kit-eyebrow" style={{ color: "var(--kit-accent)" }}>
                <CheckCircle2 aria-hidden="true" size={14} /> Your consultation
              </p>
              <h2 className="kit-section">{when(preview.booked.startsAt, preview.timezone)}</h2>
              <p className="kit-body">
                {formatCopy[preview.booked.format] ?? "Consultation"}
                {preview.booked.format === "in_person" && preview.booked.location
                  ? ` at ${preview.booked.location}`
                  : ""}
                . We’ve emailed you the details.
              </p>
              {preview.booked.format === "zoom" && preview.booked.joinUrl ? (
                <a className="kit-button" data-variant="secondary" href={preview.booked.joinUrl} rel="noreferrer" target="_blank">
                  <Video aria-hidden="true" size={20} /> Open the video call link
                </a>
              ) : null}
            </Card>
          ) : null}

          {step === "time" && preview && !preview.takesBookings ? (
            <Card tone="accent">
              <h2 className="kit-section">Thank you — that’s everything</h2>
              <p className="kit-body">{studio} will be in touch to find a time to talk.</p>
            </Card>
          ) : null}

          {step === "time" && preview && preview.takesBookings ? (
            <div className="kit-stack">
              {preview.formats.length > 1 ? (
                <Choices
                  legend="How would you like to meet?"
                  onChange={(next) => setFormat(next as Format)}
                  options={preview.formats.map((option) => ({ value: option, label: formatCopy[option] }))}
                  value={format || null}
                />
              ) : null}
              {preview.formats.includes("in_person") && format === "in_person" && preview.inPersonLocation ? (
                <p className="kit-caption">In person at {preview.inPersonLocation}</p>
              ) : null}
              <SlotPicker onSelect={setSelected} selected={selected} slots={slots} timezone={preview.timezone} />
              {slots.length ? (
                <p className="kit-caption">Times shown in {preview.timezone}.</p>
              ) : (
                <Note>No times are open right now. Reply to the studio’s email and they’ll find one.</Note>
              )}
            </div>
          ) : null}

          {notice && step !== "error" ? (
            <p className="kit-note" data-tone="danger" role="alert">
              {notice}
            </p>
          ) : null}
          <PoweredBy />
        </Main>

        {step === "details" && preview ? (
          <Actions>
            {!missingDate ? (
              <ButtonRow>
                <Button disabled={busy} onClick={() => setStep("time")} size="compact" variant="secondary">
                  Skip for now
                </Button>
                <Button disabled={busy} form="couple-details" type="submit">
                  {busy ? "Saving…" : "Continue"}
                </Button>
              </ButtonRow>
            ) : (
              <Button disabled={busy} form="couple-details" type="submit">
                {busy ? "Saving…" : "Continue"}
              </Button>
            )}
          </Actions>
        ) : null}

        {step === "time" && preview?.takesBookings ? (
          <Actions note={preview.booked ? "Your current time stays booked until you confirm a new one." : undefined}>
            <Button disabled={!selected || !format || busy} onClick={() => void book()}>
              {busy
                ? "Confirming…"
                : selected
                  ? `${preview.booked ? "Move to" : "Book"} ${slotLabel(selected, preview.timezone)}`
                  : "Choose a time"}
            </Button>
          </Actions>
        ) : null}

        {step === "booked" && preview?.booked ? (
          <Actions>
            {confirmingCancel ? (
              <>
                <p className="kit-body" style={{ textAlign: "center" }}>
                  Cancel your consultation? You can book another time here afterwards.
                </p>
                <ButtonRow>
                  <Button disabled={busy} onClick={() => setConfirmingCancel(false)} size="compact" variant="secondary">
                    Keep it
                  </Button>
                  <Button disabled={busy} onClick={() => void cancel()} variant="danger">
                    Yes, cancel it
                  </Button>
                </ButtonRow>
              </>
            ) : (
              <ButtonRow>
                <Button disabled={busy} onClick={() => setConfirmingCancel(true)} size="compact" variant="danger">
                  Cancel
                </Button>
                <Button disabled={busy} onClick={() => setStep("time")} variant="secondary">
                  Choose a different time
                </Button>
              </ButtonRow>
            )}
          </Actions>
        ) : null}
      </Screen>
    </KitRoot>
  );
}
