"use client";

import { useState } from "react";
import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowRight,
  CheckCircle2,
  ClipboardPaste,
  LoaderCircle,
  UserPlus,
  UserRound,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { prefillFromText } from "@/features/crm/project-prefill";
import { friendlyError } from "@/lib/ai/friendly-error";
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

export function CreateProjectForm() {
  const { records: contacts, loading: contactsLoading } =
    useTenantDocuments("contacts");
  const [outcome, setOutcome] = useState<{
    persisted: boolean;
    projectId: string;
    name: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paste, setPaste] = useState("");
  const [prefillNote, setPrefillNote] = useState<string | null>(null);
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

  function applyPrefill() {
    const found = prefillFromText(paste);
    const applied: string[] = [];
    if (found.eventDate) {
      setValue("eventDate", found.eventDate, { shouldValidate: true });
      applied.push("event date");
    }
    if (found.eventType) {
      setValue("eventType", found.eventType);
      applied.push("event type");
    }
    if (found.venueName) {
      setValue("venueName", found.venueName);
      applied.push("venue");
    }
    if (found.city) {
      setValue("city", found.city);
      applied.push("city");
    }
    if (found.firstName) {
      setValue("clientMode", "new");
      setValue("newClientFirstName", found.firstName);
      if (found.lastName) setValue("newClientLastName", found.lastName);
      applied.push("client name");
      const projectName = `${found.firstName}${
        found.partnerName ? ` & ${found.partnerName}` : ""
      }${found.lastName ? ` ${found.lastName}` : ""} ${
        (found.eventType ?? "Wedding").toLowerCase()
      }`;
      setValue("name", projectName);
      applied.push("project name");
    }
    if (found.email) {
      setValue("clientMode", "new");
      setValue("newClientEmail", found.email);
      applied.push("email");
    }
    if (found.phone) {
      setValue("clientMode", "new");
      setValue("newClientPhone", found.phone);
      applied.push("phone");
    }
    setPrefillNote(
      applied.length
        ? `Filled in ${applied.join(", ")} — check every field before creating.`
        : "Nothing recognizable found — fill the fields in directly.",
    );
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

  return (
    <form className="command-form panel" onSubmit={submit}>
      <div className="project-prefill">
        <label>
          <span>
            <ClipboardPaste size={15} /> Start from the client&rsquo;s message
            <em>Optional</em>
          </span>
          <textarea
            onChange={(event) => setPaste(event.target.value)}
            placeholder="Paste the inquiry email or text here — StudioCue picks out the names, date, venue, and contact details it can find. You confirm everything."
            rows={3}
            value={paste}
          />
        </label>
        <button
          className="button button-light"
          disabled={!paste.trim()}
          onClick={applyPrefill}
          type="button"
        >
          Fill in what you can
        </button>
        {prefillNote ? <small role="status">{prefillNote}</small> : null}
      </div>

      <div className="form-grid">
        <label className="form-span">Project name <span className="required-mark">Required</span><input {...register("name")} autoFocus placeholder="e.g. Johnson wedding" required /><small>{errors.name?.message}</small></label>
        <label>Event type <span className="required-mark">Required</span><select {...register("eventType")} required><option>Wedding</option><option>Corporate</option><option>Sports</option></select></label>
        <label>Event date <span className="required-mark">Required</span><input {...register("eventDate")} required type="date" /><small>{errors.eventDate?.message}</small></label>
      </div>

      <fieldset className="client-choice">
        <legend>Primary client</legend>
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
                <small>No clients yet — switch to &ldquo;New client&rdquo; to add one right here.</small>
              ) : null}
            </label>
          </div>
        ) : (
          <div className="form-grid">
            <label>First name <span className="required-mark">Required</span><input {...register("newClientFirstName")} placeholder="Ava" /><small>{errors.newClientFirstName?.message}</small></label>
            <label>Last name <span className="required-mark">Required</span><input {...register("newClientLastName")} placeholder="Chen" /><small>{errors.newClientLastName?.message}</small></label>
            <label>Email<input {...register("newClientEmail")} inputMode="email" placeholder="ava@example.com" /><small>{errors.newClientEmail?.message}</small></label>
            <label>Phone<input {...register("newClientPhone")} inputMode="tel" placeholder="(201) 555-0142" /></label>
          </div>
        )}
      </fieldset>

      <div className="form-grid">
        <label>Timezone <span className="required-mark">Required</span>
          <select {...register("timezone")} required>
            {(TIMEZONES.includes(timezone) ? TIMEZONES : [timezone, ...TIMEZONES]).map(
              (zone) => (
                <option key={zone}>{zone}</option>
              ),
            )}
          </select>
        </label>
        <label>Venue<input {...register("venueName")} placeholder="Venue name, if known" /></label>
        <label>City<input {...register("city")} placeholder="Event city" /></label>
      </div>

      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="button button-dark" disabled={isSubmitting} type="submit">
        {isSubmitting ? <LoaderCircle className="spin" size={16} /> : null}
        {clientMode === "new" ? "Create client & project" : "Create project"}
      </button>
    </form>
  );
}
