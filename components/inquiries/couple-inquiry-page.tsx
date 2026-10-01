"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { CalendarDays, CheckCircle2, ClipboardList, LoaderCircle, Send, Video } from "lucide-react";
import {
  Actions,
  AppBar,
  Button,
  ButtonRow,
  Card,
  Choices,
  Field,
  KitRoot,
  List,
  Main,
  Note,
  PoweredBy,
  Row,
  Screen,
  Steps,
  TextArea,
  type Studio,
} from "@/components/kit/kit";
import { SlotPicker, slotLabel } from "@/components/kit/slot-picker";
import { Question, spoken } from "@/components/client/kit/questionnaire-question";
import {
  parseQuestionnaireSections,
  visibleQuestionnaireSections,
} from "@/features/questionnaires/client-form";
import { outstandingRequired } from "@/features/questionnaires/outstanding";
import { runPublicScheduling } from "@/lib/booking/public-scheduling-client";

/**
 * The couple's own page: tell us about your day, then pick a time to talk.
 *
 * Reached from the link in the studio's first reply (and every reply until a
 * call is booked). One page instead of two emails: the details the studio
 * still needs — only those — then a time and a way to meet. Coming back later
 * shows the booked call, with a way to move or cancel it.
 *
 * When the studio sends an event form with its wedding inquiries
 * (functions/src/intake/inquiry-form.ts), the form is a step before the
 * times: the studio wants the answers for the call. Its details step then
 * asks only for the date, which the form needs (the date makes the job the
 * answers belong to); everything else is the studio's own form's to ask.
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
  /** A proposal is out: the call has happened. Absent from an older build. */
  pastConsultation?: boolean;
  /** Where the job is once past the call; names what is in their email. */
  jobStage?: "proposal" | "agreement" | "retainer" | "booked" | null;
  timezone: string;
  /** The studio's event form, before the times. Absent from an older build. */
  eventForm?: { name: string; status: string; requiresDate: boolean } | null;
  booked: { startsAt: string; endsAt: string; format: Format; joinUrl: string | null; location: string | null } | null;
};
type Slot = { startsAt: string; endsAt: string };
type EventForm = {
  name: string;
  sections: ReturnType<typeof parseQuestionnaireSections>;
  status: string;
  submittedAt: string | null;
};

const returned = (status: string | undefined | null) => status === "submitted" || status === "locked";

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
  INQUIRY_PAST_CONSULTATION: "You’ve already spoken with the studio, and your proposal is on its way. Reply to their email to talk again.",
  TIME_NO_LONGER_AVAILABLE: "That time was just taken. Please choose another.",
  EVENT_DATE_REQUIRED: "Add your wedding date first, so the studio can check it’s free.",
  FORMAT_NOT_OFFERED: "Please choose one of the ways the studio meets.",
  PHONE_NUMBER_REQUIRED: "Add the best number to call you, so the studio can ring you at that time.",
  INQUIRY_FORM_REQUIRED: "Please fill in the studio’s form first — they’d like your answers before the call.",
  INQUIRY_FORM_INCOMPLETE: "A few questions marked Required still need an answer.",
  INQUIRY_FORM_NOT_AVAILABLE: "This form isn’t available any more. You can go ahead and pick a time.",
  QUESTIONNAIRE_ALREADY_SUBMITTED: "You’ve already sent this to the studio. Reply to their email to change an answer.",
  RATE_LIMITED: "That’s a lot of saving in a short time. Please wait a few minutes and try again.",
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

/**
 * The details step's questions. With the studio's own event form coming
 * next, only the date: the form asks the rest in the studio's words, and
 * asking the venue twice in two minutes reads as a page that isn't listening.
 */
function detailFieldsFor(preview: Pick<Preview, "eventForm" | "missing">): Field[] {
  return preview.eventForm ? preview.missing.filter((field) => field === "eventDate") : preview.missing;
}

export function CoupleInquiryPage({ token }: { token: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [step, setStep] = useState<"loading" | "details" | "form" | "time" | "booked" | "moved_on" | "error">("loading");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [values, setValues] = useState<Partial<Record<Field | "notes", string>>>({});
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selected, setSelected] = useState("");
  const [format, setFormat] = useState<Format | "">("");
  // Only asked when they choose a phone call and no number is on file.
  const [callPhone, setCallPhone] = useState("");
  // Bumped after each change so the page re-reads where the couple stands.
  const [reloadKey, setReloadKey] = useState(0);
  const load = () => setReloadKey((key) => key + 1);

  // The studio's event form: its questions, the couple's answers, and an
  // autosave that never takes the keyboard away (as the portal's does).
  const [form, setForm] = useState<EventForm | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  // Set by a Send with required answers missing: flags each one where it is.
  const [showMissing, setShowMissing] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const answersRef = useRef(answers);
  const changeVersion = useRef(0);
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

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
        const form = result.eventForm ?? null;
        const fields = detailFieldsFor(result);
        setStep(
          result.booked
            ? "booked"
            : result.pastConsultation
              ? "moved_on"
              : fields.includes("eventDate") || (fields.length && !result.detailsSubmitted)
                ? "details"
                : form && !returned(form.status)
                  ? "form"
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

  // The form's questions and anything already saved, read when the step opens.
  const formWanted = step === "form" && Boolean(preview?.eventForm);
  useEffect(() => {
    if (!formWanted) return;
    let active = true;
    void call("inquiry_form", { token })
      .then((result) => {
        if (!active) return;
        setForm({
          name: String(result.name ?? "Event form"),
          // The server sends only what a couple sees: no internal or file questions.
          sections: parseQuestionnaireSections(result.sections),
          status: String(result.status ?? "not_started"),
          submittedAt: typeof result.submittedAt === "string" ? result.submittedAt : null,
        });
        setAnswers(
          typeof result.answers === "object" && result.answers !== null
            ? (result.answers as Record<string, unknown>)
            : {},
        );
        setDirty(false);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        const code = caught instanceof Error ? caught.message : "";
        // The studio took it back or turned it off: nothing stands before the times.
        if (code === "INQUIRY_FORM_NOT_AVAILABLE") {
          setStep(preview?.booked ? "booked" : "time");
          return;
        }
        setNotice(message(caught, "The form couldn’t load. Please try again in a moment."));
      });
    return () => {
      active = false;
    };
  }, [formWanted, token, preview?.booked]);

  const visible = useMemo(
    () => (form ? visibleQuestionnaireSections(form.sections, answers) : []),
    [form, answers],
  );
  const outstanding = outstandingRequired(
    visible.flatMap((section) => section.fields.filter((field) => field.type !== "information")),
    answers,
  );
  const formSent = returned(form?.status);
  // Worked out from the answers, so it goes as the last one comes in.
  const names = outstanding.map((field) => field.label);
  const missingNotice =
    showMissing && names.length
      ? names.length > 3
        ? `${names.length} questions marked Required still need an answer.`
        : // A label is often a question already: no "?." at the end.
          `Still needed: ${names.join(", ")}${/[.?!]$/.test(names.at(-1) ?? "") ? "" : "."}`
      : "";

  const persist = useCallback(
    async (submit: boolean) => {
      const version = changeVersion.current;
      if (submit) setSending(true);
      else setSaving(true);
      try {
        const result = await call("inquiry_form_save", {
          token,
          // Every answer, not just the visible ones: the server merges, and a
          // condition flipped back must not have lost what was typed.
          answers: { ...answersRef.current },
          submit,
        });
        if (version === changeVersion.current) setDirty(false);
        setSavedAt(new Date());
        if (submit) {
          setForm((current) =>
            current ? { ...current, status: String(result.status ?? "submitted") } : current,
          );
          window.scrollTo({ top: 0 });
          // Straight on to the times (or back to the booked call).
          setReloadKey((key) => key + 1);
        }
        return true;
      } catch (caught: unknown) {
        setNotice(
          message(caught, submit ? "Your answers couldn’t be sent. Please try again." : "Your answers couldn’t be saved. Check your connection."),
        );
        if (caught instanceof Error && caught.message === "QUESTIONNAIRE_ALREADY_SUBMITTED")
          setReloadKey((key) => key + 1);
        return false;
      } finally {
        if (submit) setSending(false);
        else setSaving(false);
      }
    },
    [token],
  );

  // Autosave a moment after the couple stops typing.
  useEffect(() => {
    if (step !== "form" || !dirty || formSent || saving || sending) return;
    const timer = window.setTimeout(() => void persist(false), 1_500);
    return () => window.clearTimeout(timer);
  }, [step, dirty, formSent, persist, saving, sending]);

  function answer(fieldId: string, value: unknown) {
    if (formSent) return;
    changeVersion.current += 1;
    setAnswers((current) => ({ ...current, [fieldId]: value }));
    setDirty(true);
  }

  function sendForm() {
    if (outstanding.length) {
      // On a phone the note sat at the foot of a long form, out of sight,
      // and Send seemed to do nothing (local walk, 2026-10-01). Mark each
      // missing answer and take the couple to the first one.
      setShowMissing(true);
      const first = document.getElementById(`inquiry-question-${outstanding[0]!.id}`);
      first?.scrollIntoView({ behavior: "smooth", block: "center" });
      first?.querySelector<HTMLElement>("input, textarea, select")?.focus({ preventScroll: true });
      setNotice("");
      return;
    }
    setNotice("");
    void persist(true);
  }

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

  const needsPhone = format === "phone" && Boolean(preview?.missing.includes("phone"));
  const phoneUsable = callPhone.replace(/\D/g, "").length >= 7;

  async function book() {
    if (!selected || !format || (needsPhone && !phoneUsable)) return;
    setBusy(true);
    setNotice("");
    try {
      await call("inquiry_book", { token, startsAt: selected, format, ...(needsPhone ? { phone: callPhone.trim() } : {}) });
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
  // Past the call, the page points at whatever is waiting in their email:
  // "your proposal is ready" read wrong to a couple whose agreement was out.
  const movedOn = {
    proposal: {
      heading: "your proposal is ready",
      lede: `You’ve spoken with ${studio}, and they’ve sent your proposal. It’s in your email — open it there to look it over.`,
    },
    agreement: {
      heading: "your agreement is ready to sign",
      lede: `${studio} has sent your agreement. It’s in your email — sign it from there.`,
    },
    retainer: {
      heading: "one last step: your retainer",
      lede: `Your agreement is signed. ${studio} has emailed the retainer invoice; paying it holds your date.`,
    },
    booked: {
      heading: "you’re booked",
      lede: `${studio} has your date. Everything from here is in your client portal — the link is in your email.`,
    },
  }[preview?.jobStage ?? "proposal"];
  const eventForm = preview?.eventForm ?? null;
  const detailFields = preview ? detailFieldsFor(preview) : [];
  // The steps this couple walks. Without an event form it is the page as it
  // was: details, then a time. With one, the date (only if missing), the
  // form, then a time.
  const flow: Array<"details" | "form" | "time"> = [
    ...(!eventForm || detailFields.length || preview?.detailsSubmitted ? (["details"] as const) : []),
    ...(eventForm ? (["form"] as const) : []),
    "time",
  ];
  const stepNumber = flow.indexOf(step as "details" | "form" | "time") + 1;
  // Opened from a booked call ("Fill it in now"), the form isn't a step.
  const showSteps = stepNumber > 0 && !(step === "form" && preview?.booked);
  const formName = form?.name ?? eventForm?.name ?? "event form";
  const phrase =
    step === "details"
      ? eventForm
        ? "when’s the wedding?"
        : "tell us about your day"
      : step === "form"
        ? formSent
          ? `your ${formName} is with ${studio}`
          : "tell us about your day"
      : step === "booked"
        ? "you’re booked in"
        : step === "moved_on"
          ? movedOn.heading
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
  const eyebrow = showSteps
    ? `Step ${stepNumber} of ${flow.length}`
    : step === "form"
      ? formName
      : step === "moved_on"
        ? "Your inquiry"
        : "Your consultation";
  const lede =
    step === "details"
      ? eventForm
        ? `So ${studio} can check they’re free. Then a few questions about your day.`
        : "Just what the studio doesn’t know yet. Skip anything you haven’t decided."
      : step === "form"
        ? formSent
          ? `${form?.submittedAt ? `Sent ${new Date(form.submittedAt).toLocaleDateString(undefined, { month: "long", day: "numeric" })}. ` : ""}Here’s what they have. To change an answer, reply to their email.`
          : `${studio} would love to know about your day before you talk. Your answers save as you go — come back to this link any time to finish.`
      : step === "booked"
        ? "Need a different time? You can move it or cancel it here."
        : step === "moved_on"
          ? movedOn.lede
        : `A ${preview?.durationMinutes ?? 30}-minute conversation about your plans. Nothing is booked until you confirm.`;

  return (
    <KitRoot studio={brand}>
      <Screen>
        {/* Nothing until the studio is known: a generic "Your photographer"
            and its "Y" flashed before every couple's page. */}
        <AppBar studio={preview ? brand : undefined} />
        <Main label="Your inquiry">
          {showSteps ? <Steps step={stepNumber} total={flow.length} /> : null}
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
              {detailFields.map((field) => (
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
              {/* With an event form next, the form is where they tell the studio more. */}
              {eventForm ? null : (
                <TextArea
                  label={`Anything else you’d like ${studio} to know?`}
                  onChange={(event) => setValues((current) => ({ ...current, notes: event.target.value }))}
                  rows={3}
                  value={values.notes ?? ""}
                />
              )}
            </form>
          ) : null}

          {step === "form" && !form ? (
            <Card>
              <p className="kit-body" role="status">
                <LoaderCircle aria-hidden="true" className="spin" size={18} /> Opening the form…
              </p>
            </Card>
          ) : null}

          {/* Sent: what the studio has, read-only. */}
          {step === "form" && form && formSent
            ? visible.map((section) => (
                <section aria-label={section.title} className="kit-stack-tight" key={section.id}>
                  <h2 className="kit-subsection">{section.title}</h2>
                  <List>
                    {section.fields
                      .filter((field) => field.type !== "information")
                      .map((field) => (
                        <Row
                          key={field.id}
                          subtitle={spoken(answers[field.id], field.type) || "Not answered"}
                          title={field.label}
                        />
                      ))}
                  </List>
                </section>
              ))
            : null}

          {step === "form" && form && !formSent ? (
            <div className="kit-stack">
              {visible.map((section) => (
                <section aria-label={section.title} className="kit-stack" key={section.id}>
                  <h2 className="kit-subsection">{section.title}</h2>
                  {section.fields.map((field) => {
                    const missing = showMissing && outstanding.some((item) => item.id === field.id);
                    return (
                      <div className="kit-stack-tight" id={`inquiry-question-${field.id}`} key={field.id}>
                        <Question
                          answer={answers[field.id]}
                          field={field}
                          onChange={(value) => answer(field.id, value)}
                          onFile={() => undefined}
                          source=""
                          uploading={false}
                        />
                        {missing ? (
                          <p className="kit-note" data-tone="danger">
                            Still needed
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </section>
              ))}
            </div>
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

          {/* Booked before the studio's form reached them (or booked, then
              the studio turned the form on): still worth having before the call. */}
          {step === "booked" && preview?.booked && eventForm ? (
            returned(eventForm.status) ? (
              <button className="kit-link-button" onClick={() => setStep("form")} type="button">
                See your {eventForm.name}
              </button>
            ) : (
              <Card>
                <p className="kit-eyebrow">
                  <ClipboardList aria-hidden="true" size={14} /> Before your call
                </p>
                <h2 className="kit-section">Your {eventForm.name}</h2>
                <p className="kit-body">
                  {`${studio} would love your answers before you talk, so they can plan the call around your day.`}
                </p>
                <Button onClick={() => setStep("form")} variant="secondary">
                  Fill it in now
                </Button>
              </Card>
            )
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
              {needsPhone ? (
                <Field
                  hint={`${studio} will call you on this number at the time you pick.`}
                  inputMode="tel"
                  label="Best number to call you"
                  onChange={(event) => setCallPhone(event.target.value)}
                  type="tel"
                  value={callPhone}
                />
              ) : null}
              <SlotPicker onSelect={setSelected} selected={selected} slots={slots} timezone={preview.timezone} />
              {slots.length ? (
                <p className="kit-caption">Times shown in {preview.timezone}.</p>
              ) : (
                <Note>No times are open right now. Reply to the studio’s email and they’ll find one.</Note>
              )}
            </div>
          ) : null}

          {(notice || (step === "form" && missingNotice)) && step !== "error" ? (
            <p className="kit-note" data-tone="danger" role="alert">
              {notice || missingNotice}
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

        {step === "form" && form ? (
          <Actions
            note={
              formSent
                ? undefined
                : showMissing && outstanding.length
                  ? outstanding.length === 1
                    ? "1 question still needs an answer — it's marked above."
                    : `${outstanding.length} questions still need an answer — they're marked above.`
                  : saving
                  ? "Saving…"
                  : dirty
                    ? "Saving shortly…"
                    : savedAt
                      ? `Saved ${savedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                      : "Your answers save as you type."
            }
          >
            {formSent ? (
              <Button onClick={() => setStep(preview?.booked ? "booked" : "time")}>
                {preview?.booked ? "Back to your consultation" : "Pick a time to talk"}
              </Button>
            ) : (
              <Button disabled={sending} icon={Send} onClick={sendForm}>
                {sending
                  ? "Sending…"
                  : preview?.booked || !preview?.takesBookings
                    ? `Send to ${studio}`
                    : "Send, then pick a time"}
              </Button>
            )}
          </Actions>
        ) : null}

        {step === "time" && preview?.takesBookings ? (
          <Actions note={preview.booked ? "Your current time stays booked until you confirm a new one." : undefined}>
            <Button disabled={!selected || !format || busy || (needsPhone && !phoneUsable)} onClick={() => void book()}>
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
                  {preview.pastConsultation
                    ? "Cancel your consultation?"
                    : "Cancel your consultation? You can book another time here afterwards."}
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
