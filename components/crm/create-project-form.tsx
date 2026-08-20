"use client";

import { useState } from "react";
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
  type ProjectIntakeResult,
} from "@/lib/ai/project-intake-client";
import { runCrmCommand } from "@/lib/crm/command-client";

const schema = z
  .object({
    name: z.string().trim().min(2).max(160),
    eventType: z.enum(["Wedding", "Corporate", "Sports"]),
    eventDate: z.string().date(),
    timezone: z.string().min(1),
    clientMode: z.enum(["existing", "new"]),
    primaryContactId: z.string().trim(),
    newClientFirstName: z.string().trim().max(80),
    newClientLastName: z.string().trim().max(80),
    newClientEmail: z.string().trim(),
    newClientPhone: z.string().trim().max(30),
    venueName: z.string().trim().max(160),
    city: z.string().trim().max(120),
  })
  .superRefine((values, context) => {
    if (values.clientMode === "existing" && !values.primaryContactId) {
      context.addIssue({
        code: "custom",
        path: ["primaryContactId"],
        message: "Choose the client this project is for.",
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
  | "newClientFirstName"
  | "newClientLastName"
  | "newClientEmail"
  | "newClientPhone"
  | "venueName"
  | "city";

const FIELD_LABELS: Record<FillableField, string> = {
  name: "project name",
  eventType: "event type",
  eventDate: "event date",
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

export function CreateProjectForm() {
  const workspace = useWorkspace();
  const { records: contacts, loading: contactsLoading } =
    useTenantDocuments("contacts");
  const [outcome, setOutcome] = useState<{
    persisted: boolean;
    projectId: string;
    name: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [reading, setReading] = useState(false);
  const [intake, setIntake] = useState<ProjectIntakeResult | null>(null);
  const [filled, setFilled] = useState<Partial<Record<FillableField, boolean>>>(
    {},
  );
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      eventType: "Wedding",
      eventDate: "",
      timezone: browserTimezone(),
      clientMode: "existing",
      primaryContactId: "",
      newClientFirstName: "",
      newClientLastName: "",
      newClientEmail: "",
      newClientPhone: "",
      venueName: "",
      city: "",
    },
  });
  const clientMode = watch("clientMode");
  const timezone = watch("timezone");

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
      set("eventType", found.eventType);
      set("venueName", found.venueName);
      set("city", found.city);
      if (found.firstName || found.email || found.phone)
        setValue("clientMode", "new");
      set("newClientFirstName", found.firstName);
      set("newClientLastName", found.lastName);
      set("newClientEmail", found.email);
      set("newClientPhone", found.phone);
      if (found.firstName) {
        const projectName = `${found.firstName}${
          found.partnerName ? ` & ${found.partnerName}` : ""
        }${found.lastName ? ` ${found.lastName}` : ""} ${
          (found.eventType ?? "Wedding").toLowerCase()
        }`;
        set("name", projectName);
      }
      setFilled(nextFilled);
      setIntake(result);
    } finally {
      setReading(false);
    }
  }

  const submit = handleSubmit(async (values) => {
    setError(null);
    try {
      let contactId = values.primaryContactId;
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
      }
      const command = await runCrmCommand("createProject", {
        name: values.name,
        eventType: values.eventType,
        eventTypeId: values.eventType.toLowerCase(),
        eventDate: values.eventDate,
        timezone: values.timezone,
        clientContactIds: [contactId],
        leadPhotographerId: null,
        leadId: null,
        venueName: values.venueName || null,
        city: values.city || null,
      });
      setOutcome({
        persisted: command.persisted,
        projectId: String(command.result.projectId ?? ""),
        name: values.name,
      });
    } catch (caught: unknown) {
      setError(friendlyError(caught, "The project could not be created. Try again."));
    }
  });

  if (outcome) {
    return (
      <div className="command-success">
        <CheckCircle2 size={23} />
        <h2>{outcome.name} is ready</h2>
        <p>The journey starts at inquiry — open the project to take the first step.</p>
        {outcome.persisted && outcome.projectId ? (
          <Link
            className="button button-dark"
            href={`/studio/projects/${outcome.projectId}`}
          >
            Open project <ArrowRight size={15} />
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

  return (
    <div className="intake-workspace">
      <aside className="intake-copilot" aria-label="StudioCue copilot">
        <p className="eyebrow">StudioCue copilot</p>
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
          {reading ? "Reading the message…" : "Prepare the project"}
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
                    <Check size={11} /> ~{intake.extraction.guestCount} guests
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
              Project name <span className="required-mark">Required</span>
              {filled.name ? <FilledTag /> : null}
              <input {...fieldProps("name")} placeholder="e.g. Johnson wedding" required />
              <small>{errors.name?.message}</small>
            </label>
            <label className={filled.eventType ? "is-filled" : ""}>
              Event type <span className="required-mark">Required</span>
              {filled.eventType ? <FilledTag /> : null}
              <select {...fieldProps("eventType")} required>
                <option>Wedding</option>
                <option>Corporate</option>
                <option>Sports</option>
              </select>
            </label>
            <label className={filled.eventDate ? "is-filled" : ""}>
              Event date <span className="required-mark">Required</span>
              {filled.eventDate ? <FilledTag /> : null}
              <input {...fieldProps("eventDate")} required type="date" />
              <small>{errors.eventDate?.message}</small>
            </label>
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
                {filled.newClientEmail ? <FilledTag /> : null}
                <input
                  {...fieldProps("newClientEmail")}
                  inputMode="email"
                  placeholder="ava@example.com"
                />
                <small>{errors.newClientEmail?.message}</small>
              </label>
              <label className={filled.newClientPhone ? "is-filled" : ""}>
                Phone
                {filled.newClientPhone ? <FilledTag /> : null}
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
            <label className={filled.venueName ? "is-filled" : ""}>
              Venue
              {filled.venueName ? <FilledTag /> : null}
              <input {...fieldProps("venueName")} placeholder="Venue name, if known" />
            </label>
            <label className={filled.city ? "is-filled" : ""}>
              City
              {filled.city ? <FilledTag /> : null}
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
            {clientMode === "new" ? "Create client & project" : "Create project"}
          </button>
          <small>
            Creates the {clientMode === "new" ? "client record and the " : ""}
            project, then opens its journey.
          </small>
        </div>
      </form>
    </div>
  );
}
