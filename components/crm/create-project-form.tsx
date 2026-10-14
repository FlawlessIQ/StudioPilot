"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
  UserPlus,
  UserRound,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
import { friendlyError } from "@/lib/ai/friendly-error";
import {
  readProjectIntake,
  type ProjectIntake,
  type ProjectIntakeResult,
} from "@/lib/ai/project-intake-client";
import { runCrmCommand, teamEmailWarning } from "@/lib/crm/command-client";
import { useStudioJobTypes } from "@/components/job-kinds/use-studio-job-types";
import { isMitzvahType, jobKindFromLabel, journeyProfile, vocab } from "@/features/job-kinds/job-kinds";
import { HonoreeFields } from "@/components/job-kinds/honoree-fields";
import {
  clientMatchNote,
  jobNameFromRead,
  matchClientByEmail,
  occasionKept,
  teamEmailsOf,
} from "@/features/crm/new-job-from-message";
import { tradeProfile, tradeVocab } from "@/features/trades/trades";
import { AddressField } from "@/components/forms/address-field";
import {
  placeCity,
  placeLabel,
  unverifiedPlace,
  type CapturedPlace,
} from "@/features/places/schema";

const schema = z
  .object({
    name: z.string().trim().min(2).max(160),
    // The studio's job type, by key (use-studio-job-types.ts).
    eventType: z.string().trim().min(1, "Choose the kind of job."),
    eventDate: z.string().date(),
    // When everyone must be ready: a makeup artist's or hair stylist's only.
    readyByTime: z
      .string()
      .trim()
      .regex(/^(?:(?:[01]\d|2[0-3]):[0-5]\d)?$/, "Enter a time, or leave it blank."),
    timezone: z.string().min(1),
    clientMode: z.enum(["existing", "new"]),
    primaryContactId: z.string().trim(),
    newClientFirstName: z.string().trim().max(80),
    newClientLastName: z.string().trim().max(80),
    newClientEmail: z.string().trim(),
    newClientPhone: z.string().trim().max(30),
    venueName: z.string().trim().max(160),
    city: z.string().trim().max(120),
    // Who the job celebrates, for a kind that has someone (job-kinds.ts `honoree`).
    honoreeName: z.string().trim().max(80),
    mitzvahType: z.string().trim(),
  })
  .superRefine((values, context) => {
    if (values.clientMode === "existing" && !values.primaryContactId) {
      context.addIssue({
        code: "custom",
        path: ["primaryContactId"],
        message: "Choose the client this job is for.",
      });
    }
    if (values.clientMode === "new") {
      if (!values.newClientFirstName)
        context.addIssue({
          code: "custom",
          path: ["newClientFirstName"],
          message: "The client's first name is required.",
        });
      if (!values.newClientLastName)
        context.addIssue({
          code: "custom",
          path: ["newClientLastName"],
          message: "The client's last name is required.",
        });
      if (
        values.newClientEmail &&
        !z.string().email().safeParse(values.newClientEmail).success
      )
        context.addIssue({
          code: "custom",
          path: ["newClientEmail"],
          message: "This doesn't look like an email address.",
        });
    }
  });
type FormValues = z.infer<typeof schema>;

type FillableField =
  | "name"
  | "eventType"
  | "eventDate"
  | "readyByTime"
  | "newClientFirstName"
  | "newClientLastName"
  | "newClientEmail"
  | "newClientPhone"
  | "venueName"
  | "city";

const FIELD_LABELS: Record<FillableField, string> = {
  name: "job name",
  eventType: "event type",
  eventDate: "event date",
  readyByTime: "ready-by time",
  newClientFirstName: "first name",
  newClientLastName: "last name",
  newClientEmail: "email",
  newClientPhone: "phone",
  venueName: "venue",
  city: "city",
};

const browserTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  } catch {
    return "America/New_York";
  }
};

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Australia/Sydney",
];

function FilledTag() {
  return (
    <em className="intake-filled-tag">
      <Sparkles size={10} /> from the message
    </em>
  );
}

export function CreateProjectForm({
  sharedMessage = null,
}: {
  /** Text shared to StudioCue from another app; read as soon as it arrives. */
  sharedMessage?: string | null;
} = {}) {
  const workspace = useWorkspace();
  /**
   * A studio with no clients should not land on the tab that cannot work.
   *
   * "Existing client" was the active tab on a brand-new studio, and its
   * dropdown held exactly one option: the empty placeholder. The note below it
   * did say to switch tabs, which is a fair rescue and still one wasted step
   * on the first project anyone creates.
   *
   * Applied once, and only while the studio has not touched the control, so a
   * deliberate choice of "Existing client" on an empty directory is respected
   * — and so a later fetch cannot yank the tab out from under someone who is
   * mid-typing. `setValue` is react-hook-form's ref-based setter, not React
   * state, so this does not cascade a render.
   */
  const clientModeDefaulted = useRef(false);
  const { records: contacts, loading: contactsLoading } =
    useTenantDocuments("contacts");
  const [outcome, setOutcome] = useState<{
    persisted: boolean;
    projectId: string;
    name: string;
    warning?: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState(sharedMessage ?? "");
  const sharedRead = useRef(false);
  const [reading, setReading] = useState(false);
  const [intake, setIntake] = useState<ProjectIntakeResult | null>(null);
  const [filled, setFilled] = useState<Partial<Record<FillableField, boolean>>>(
    {},
  );
  const [venue, setVenue] = useState<CapturedPlace | null>(null);
  /**
   * The read whose client is still to be matched against the studio's own.
   *
   * A message can be read before the client list has loaded (one shared from
   * another app is read on arrival), so the match waits for the list rather
   * than deciding "New client" against an empty one. Taken once per read, so
   * a later choice of tab is the studio's. The kind's word goes with it, for
   * naming the job after the client it matched.
   */
  const pendingClientRead = useRef<{ found: ProjectIntake; eventWord: string } | null>(null);
  // The studio's trade: a makeup artist or hair stylist prices per person and
  // asks when everyone must be ready (trades.ts).
  const trade = workspace.tenantTrade;
  const perPerson = tradeProfile(trade).perPersonPricing;
  const planningForm = tradeVocab(trade).detailsForm;
  // The studio's own types — "Cheer", "Mini sessions" — each one kind of
  // work; the hard-coded Wedding / Corporate / Sports list left family
  // sessions with nowhere to go (job-types plan, B6).
  const jobTypes = useStudioJobTypes();
  const {
    register,
    handleSubmit,
    getValues,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      eventType: "",
      eventDate: "",
      readyByTime: "",
      timezone: browserTimezone(),
      clientMode: "existing",
      primaryContactId: "",
      newClientFirstName: "",
      newClientLastName: "",
      newClientEmail: "",
      newClientPhone: "",
      venueName: "",
      city: "",
      honoreeName: "",
      mitzvahType: "",
    },
  });
  const clientMode = watch("clientMode");
  // The kind of the type chosen, for the fields only some kinds have.
  const chosenKind = jobTypes.find((type) => type.key === watch("eventType"))?.kind ?? null;
  useEffect(() => {
    if (clientModeDefaulted.current || contactsLoading) return;
    if (contacts && contacts.length === 0) {
      clientModeDefaulted.current = true;
      setValue("clientMode", "new");
    }
  }, [contacts, contactsLoading, setValue]);
  const timezone = watch("timezone");
  const primaryContactId = watch("primaryContactId");
  const newClientEmail = watch("newClientEmail");
  // The studio's own people, whose addresses are never a client to match.
  const { records: crewProfiles, loading: crewLoading } =
    useTenantDocuments("crewProfiles");
  const teamEmails = useMemo(
    () => teamEmailsOf({ crewProfiles, userEmail: workspace.userEmail }),
    [crewProfiles, workspace.userEmail],
  );

  /**
   * Who the message is from, among the studio's own clients.
   *
   * Cue filled "New client" with Priya Shah's details from her email though
   * that email was already a client's (Jess Styles Bridal, 2026-10-12):
   * creating it would have made her a second contact, with her Sangeet on
   * that one instead of the record her wedding is on. Now the address she
   * wrote from picks her out — exactly that address, case and spacing aside —
   * and the job goes on her record. "New client" stays one tap away; several
   * clients on one address pick nobody, and the form says so.
   */
  useEffect(() => {
    const pending = pendingClientRead.current;
    if (!intake || !pending || contactsLoading || crewLoading) return;
    pendingClientRead.current = null;
    clientModeDefaulted.current = true;
    const { found, eventWord } = pending;
    const match = matchClientByEmail(contacts, found.email, teamEmails);
    if (match.kind === "one") {
      setValue("clientMode", "existing");
      setValue("primaryContactId", match.contactId, { shouldValidate: true });
      // A message signed "Priya" is still named for the client it matched.
      const name = getValues("name").trim()
        ? null
        : jobNameFromRead({
            firstName: match.firstName,
            lastName: match.lastName,
            partnerName: found.partnerName,
            occasion: found.occasion,
            eventWord,
          });
      if (name) {
        setValue("name", name, { shouldValidate: true });
        setFilled((current) => ({ ...current, name: true }));
      }
    } else if (match.kind === "several") {
      setValue("clientMode", "existing");
      setValue("primaryContactId", "");
    } else if (found.firstName || found.email || found.phone) {
      setValue("clientMode", "new");
    }
  }, [intake, contacts, contactsLoading, crewLoading, teamEmails, getValues, setValue]);

  const clearTag = (field: FillableField) =>
    setFilled((current) =>
      current[field] ? { ...current, [field]: false } : current,
    );
  const fieldProps = (field: FillableField) => {
    const registered = register(field);
    return {
      ...registered,
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        clearTag(field);
        return registered.onChange(event);
      },
    };
  };

  async function runCopilot() {
    if (!message.trim() || !workspace.tenantId) return;
    setReading(true);
    setIntake(null);
    try {
      const result = await readProjectIntake(workspace.tenantId, message);
      const found = result.extraction;
      const nextFilled: Partial<Record<FillableField, boolean>> = {};
      const set = (field: FillableField, value: string | null) => {
        if (!value) return;
        setValue(field, value as never, { shouldValidate: true });
        nextFilled[field] = true;
      };
      set("eventDate", found.eventDate);
      // The read names a kind of work; the studio's first type of that kind.
      const foundKind = found.eventType
        ? (jobKindFromLabel(found.eventType) ?? "other")
        : null;
      const foundType = foundKind ? jobTypes.find((type) => type.kind === foundKind) : null;
      set("eventType", foundType?.key ?? null);
      set("venueName", found.venueName);
      set("city", found.city);
      // The copilot read a venue out of the client's email, so show it in
      // the address box — unverified, because a name pulled from prose is
      // not a confirmed address. Choosing a suggestion upgrades it.
      if (found.venueName) setVenue(unverifiedPlace(found.venueName));
      const eventWord = foundKind ? vocab(foundKind).event : "job";
      // Existing or new client is decided once the studio's clients are in
      // hand (the effect above): the email may already be one of theirs.
      pendingClientRead.current = { found, eventWord };
      set("newClientFirstName", found.firstName);
      set("newClientLastName", found.lastName);
      set("newClientEmail", found.email);
      set("newClientPhone", found.phone);
      // "Hair done by 5:30 PM": the time the party list asks for, only where
      // the trade has one (a makeup artist's or hair stylist's).
      if (perPerson) set("readyByTime", found.readyByTime ?? null);
      // Named for the occasion when the message names one ("Priya Shah
      // Sangeet"); otherwise for the kind of job, as before.
      set(
        "name",
        jobNameFromRead({
          firstName: found.firstName,
          lastName: found.lastName,
          partnerName: found.partnerName,
          occasion: found.occasion,
          eventWord,
        }),
      );
      setFilled(nextFilled);
      setIntake(result);
    } finally {
      setReading(false);
    }
  }

  /**
   * Keep the flat fields in step with the captured place.
   *
   * `venueName` and `city` are what the rest of the product reads — the
   * Jobs table, the AI drafts, the PDF renderer. The structured place sits
   * beside them rather than replacing them, so choosing an address
   * improves every one of those without any of them changing.
   */
  // Shared from another app: read it once the workspace is known, the same as
  // pressing "Prepare the job".
  useEffect(() => {
    if (!sharedMessage || !workspace.tenantId || sharedRead.current) return;
    sharedRead.current = true;
    void Promise.resolve().then(runCopilot);
    // runCopilot reads the latest message state; it is not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedMessage, workspace.tenantId]);

  function applyVenue(place: CapturedPlace | null) {
    setVenue(place);
    setValue("venueName", place ? placeLabel(place).slice(0, 160) : "", {
      shouldValidate: true,
    });
    const city = placeCity(place);
    // Only overwrite the city when the lookup actually knows one — a
    // half-typed venue must not wipe a city the reader already entered.
    if (city) setValue("city", city.slice(0, 120), { shouldValidate: true });
  }

  const submit = handleSubmit(async (values) => {
    setError(null);
    // The message the job is made from, kept with it for the studio: Job
    // history shows it and "Draft from what they told you" reads it
    // (functions/src/crm/job-source-message.ts). Never the client's to see.
    const sourceText = message.trim().slice(0, 8000);
    try {
      let contactId = values.primaryContactId;
      let warning: string | null = null;
      if (values.clientMode === "new") {
        const contact = await runCrmCommand("createContact", {
          firstName: values.newClientFirstName,
          lastName: values.newClientLastName,
          email: values.newClientEmail || null,
          phone: values.newClientPhone || null,
          company: null,
          contactTypes: ["client"],
        });
        contactId = String(contact.result.contactId ?? "");
        if (!contactId) throw new Error("CONTACT_CREATE_FAILED");
        warning = teamEmailWarning(contact.result);
      }
      const command = await runCrmCommand("createProject", {
        name: values.name,
        warning,
        // Label, kind and the studio's type id, together (job-kinds.ts).
        eventType:
          jobTypes.find((type) => type.key === values.eventType)?.label ?? values.eventType,
        eventKind: jobTypes.find((type) => type.key === values.eventType)?.kind ?? "other",
        eventTypeKey: values.eventType,
        eventTypeId: jobTypes.find((type) => type.key === values.eventType)?.kind ?? "other",
        ...(journeyProfile(chosenKind).honoree
          ? {
              honoreeName: values.honoreeName || null,
              mitzvahType: isMitzvahType(values.mitzvahType) ? values.mitzvahType : null,
            }
          : {}),
        eventDate: values.eventDate,
        timezone: values.timezone,
        clientContactIds: [contactId],
        leadPhotographerId: null,
        leadId: null,
        venueName: values.venueName || null,
        city: values.city || null,
        venue,
        ...(perPerson && values.readyByTime ? { readyByTime: values.readyByTime } : {}),
        sourceMessage: sourceText
          ? {
              text: sourceText,
              summary: intake?.extraction.summary?.slice(0, 400) ?? null,
              // Only an occasion the job's name still carries.
              occasion: occasionKept(intake?.extraction.occasion, values.name),
            }
          : null,
      });
      setOutcome({
        persisted: command.persisted,
        projectId: String(command.result.projectId ?? ""),
        name: values.name,
      });
    } catch (caught: unknown) {
      setError(friendlyError(caught, "The job could not be created. Try again."));
    }
  });

  if (outcome) {
    return (
      <div className="command-success">
        <CheckCircle2 size={23} />
        <h2>{outcome.name} is ready</h2>
        <p>Open the job to take its first step.</p>
        {outcome.warning ? (
          <p className="form-notice" role="alert">
            {outcome.warning}
          </p>
        ) : null}
        {outcome.persisted && outcome.projectId ? (
          <Link
            className="button button-dark"
            href={`/studio/projects/${outcome.projectId}`}
          >
            Open job <ArrowRight size={15} />
          </Link>
        ) : (
          <small>Preview mode: this record was not persisted.</small>
        )}
      </div>
    );
  }

  const foundFacts: string[] = intake
    ? (Object.keys(FIELD_LABELS) as FillableField[])
        .filter((field) => filled[field])
        .map((field) => FIELD_LABELS[field])
    : [];
  const missingEssentials: string[] = intake
    ? [
        !filled.eventDate ? "event date" : null,
        !filled.newClientFirstName && clientMode === "new" ? "client name" : null,
      ].filter((value): value is string => value !== null)
    : [];
  const clientNote = clientMatchNote({
    mode: clientMode,
    read: intake && contacts ? matchClientByEmail(contacts, intake.extraction.email, teamEmails) : null,
    selectedId: primaryContactId,
    typed:
      clientMode === "new"
        ? matchClientByEmail(contacts, newClientEmail, teamEmails)
        : { kind: "none" },
  });

  return (
    <div className="intake-workspace">
      <aside className="intake-copilot" aria-label="Cue">
        <p className="eyebrow">Cue · your office manager</p>
        <h2>Tell me about the booking.</h2>
        <p>
          Paste the client&rsquo;s email or text — or just describe the job in
          your own words. I&rsquo;ll set the form up; you stay in charge of
          what gets created.
        </p>
        <textarea
          onChange={(event) => setMessage(event.target.value)}
          placeholder={
            "e.g. “My name is Maren Castillo — Diego and I are getting married October 9, 2027 at The Ryland Inn in Whitehouse Station, NJ…”"
          }
          value={message}
        />
        <button
          className="intake-copilot-run"
          disabled={reading || !message.trim()}
          onClick={() => void runCopilot()}
          type="button"
        >
          {reading ? (
            <LoaderCircle className="spin" size={15} />
          ) : (
            <Sparkles size={15} />
          )}
          {reading ? "Reading the message…" : "Prepare the job"}
        </button>
        {intake ? (
          <div aria-live="polite" className="intake-copilot-result">
            {intake.extraction.summary ? (
              <p>{intake.extraction.summary}</p>
            ) : null}
            {foundFacts.length ? (
              <ul className="intake-facts">
                {foundFacts.map((fact) => (
                  <li key={fact}>
                    <Check size={11} /> {fact}
                  </li>
                ))}
                {intake.extraction.guestCount ? (
                  <li>
                    <Check size={11} /> ~{intake.extraction.guestCount}{" "} guests
                  </li>
                ) : null}
              </ul>
            ) : (
              <p>
                I couldn&rsquo;t pick anything out of that with confidence —
                fill the form in directly.
              </p>
            )}
            {missingEssentials.length ? (
              <span className="intake-missing">
                Still needs from you: {missingEssentials.join(", ")}.
              </span>
            ) : null}
            <span className="intake-mode">
              <ShieldCheck size={12} />
              {intake.mode === "ai"
                ? "Read by StudioCue AI · nothing is created until you confirm"
                : "Quick read (AI unavailable right now) · nothing is created until you confirm"}
            </span>
          </div>
        ) : null}
      </aside>

      <form className="intake-form panel" onSubmit={submit}>
        <fieldset className="intake-section">
          <legend>The event</legend>
          <div className="form-grid">
            <label className={`form-span${filled.name ? " is-filled" : ""}`}>
              Job name <span className="required-mark">Required</span>
              {filled.name ? <FilledTag /> : null}
              <input {...fieldProps("name")} placeholder="e.g. Johnson wedding" required />
              <small>{errors.name?.message}</small>
            </label>
            <label className={filled.eventType ? "is-filled" : ""}>
              Type of job <span className="required-mark">Required</span>
              {filled.eventType ? <FilledTag /> : null}
              <select {...fieldProps("eventType")} required>
                <option value="">Choose…</option>
                {jobTypes.map((type) => (
                  <option key={type.key} value={type.key}>
                    {type.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={filled.eventDate ? "is-filled" : ""}>
              Event date <span className="required-mark">Required</span>
              {filled.eventDate ? <FilledTag /> : null}
              <input {...fieldProps("eventDate")} required type="date" />
              <small>{errors.eventDate?.message}</small>
            </label>
            <HonoreeFields kind={chosenKind} nameProps={register("honoreeName")} typeProps={register("mitzvahType")} />
            {perPerson ? (
              <label className={filled.readyByTime ? "is-filled" : ""}>
                Everyone ready by
                {" "}{filled.readyByTime ? <FilledTag /> : null}
                <input {...fieldProps("readyByTime")} type="time" />
                <small>
                  {errors.readyByTime?.message ??
                    (planningForm
                      ? `Filled in on their ${planningForm.toLowerCase()} when you send it.`
                      : null)}
                </small>
              </label>
            ) : null}
          </div>
        </fieldset>

        <fieldset className="intake-section">
          <legend>The client</legend>
          <div className="segmented-control" role="tablist" aria-label="Client source">
            <button
              className={clientMode === "existing" ? "active" : ""}
              onClick={() => setValue("clientMode", "existing")}
              role="tab"
              type="button"
            >
              <UserRound size={14} /> Existing client
            </button>
            <button
              className={clientMode === "new" ? "active" : ""}
              onClick={() => setValue("clientMode", "new")}
              role="tab"
              type="button"
            >
              <UserPlus size={14} /> New client
            </button>
          </div>
          {clientNote ? (
            <p
              className={`intake-client-match${clientNote.warn ? " is-warning" : ""}`}
              role="status"
            >
              <UserRound aria-hidden="true" size={14} />
              <span>{clientNote.text}</span>
            </p>
          ) : null}
          {clientMode === "existing" ? (
            <div className="form-grid">
              <label className="form-span">
                Client
                <select {...register("primaryContactId")} disabled={contactsLoading}>
                  <option value="">
                    {contactsLoading ? "Loading clients…" : "Select a client"}
                  </option>
                  {(contacts ?? []).map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {String(contact.displayName ?? contact.email ?? "Client")}
                    </option>
                  ))}
                </select>
                <small>{errors.primaryContactId?.message}</small>
                {!contactsLoading && !contacts?.length ? (
                  <small>
                    No clients yet — switch to &ldquo;New client&rdquo; to add
                    one right here.
                  </small>
                ) : null}
              </label>
            </div>
          ) : (
            <div className="form-grid">
              <label className={filled.newClientFirstName ? "is-filled" : ""}>
                First name <span className="required-mark">Required</span>
                {filled.newClientFirstName ? <FilledTag /> : null}
                <input {...fieldProps("newClientFirstName")} placeholder="Ava" />
                <small>{errors.newClientFirstName?.message}</small>
              </label>
              <label className={filled.newClientLastName ? "is-filled" : ""}>
                Last name <span className="required-mark">Required</span>
                {filled.newClientLastName ? <FilledTag /> : null}
                <input {...fieldProps("newClientLastName")} placeholder="Chen" />
                <small>{errors.newClientLastName?.message}</small>
              </label>
              <label className={filled.newClientEmail ? "is-filled" : ""}>
                Email
                {" "}{filled.newClientEmail ? <FilledTag /> : null}
                <input
                  {...fieldProps("newClientEmail")}
                  inputMode="email"
                  placeholder="ava@example.com"
                />
                <small>{errors.newClientEmail?.message}</small>
              </label>
              <label className={filled.newClientPhone ? "is-filled" : ""}>
                Phone
                {" "}{filled.newClientPhone ? <FilledTag /> : null}
                <input
                  {...fieldProps("newClientPhone")}
                  inputMode="tel"
                  placeholder="(201) 555-0142"
                />
              </label>
            </div>
          )}
        </fieldset>

        <fieldset className="intake-section">
          <legend>Where</legend>
          <div className="form-grid">
            {/* Venue was a free-text box, so the same estate arrived as
                "The Ryland Inn", "Ryland Inn" and "ryland inn, whitehouse
                station" across three jobs — three venues as far as the
                product was concerned, and only as good as the typing on
                the certificate of insurance that goes to them. Choosing
                the place fills the city too, and keeps the postal address
                and coordinates beside it. Typing an unlisted barn still
                works; it is stored unverified rather than refused. */}
            <div className="form-span">
              <AddressField
                hint={
                  venue?.verified
                    ? "Confirmed address — used for insurance certificates and directions."
                    : "Start typing a venue or address, or enter your own."
                }
                label="Venue"
                onChange={applyVenue}
                placeholder="Venue name or address"
                value={venue}
              />
            </div>
            <label className={filled.city ? "is-filled" : ""}>
              City
              {" "}{filled.city ? <FilledTag /> : null}
              <input {...fieldProps("city")} placeholder="Event city" />
            </label>
            <label>
              Timezone <span className="required-mark">Required</span>
              <select {...register("timezone")} required>
                {(TIMEZONES.includes(timezone)
                  ? TIMEZONES
                  : [timezone, ...TIMEZONES]
                ).map((zone) => (
                  <option key={zone}>{zone}</option>
                ))}
              </select>
            </label>
          </div>
        </fieldset>

        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="intake-submit">
          <button className="button button-dark" disabled={isSubmitting} type="submit">
            {isSubmitting ? <LoaderCircle className="spin" size={16} /> : null}
            {clientMode === "new" ? "Create client & job" : "Create job"}
          </button>
        </div>
      </form>
    </div>
  );
}
