"use client";

import { useState } from "react";
import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, LoaderCircle, UserPlus } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { runCrmCommand } from "@/lib/crm/command-client";

const schema = z.object({
  name: z.string().trim().min(2).max(160),
  eventType: z.enum(["Wedding", "Corporate", "Sports"]),
  eventDate: z.string().date(),
  timezone: z.string().min(1),
  primaryContactId: z.string().trim().min(1),
  venueName: z.string().trim().max(160),
  city: z.string().trim().max(120),
});
type FormValues = z.infer<typeof schema>;

export function CreateProjectForm() {
  const { records: contacts, loading: contactsLoading } =
    useTenantDocuments("contacts");
  const [outcome, setOutcome] = useState<{ persisted: boolean; reference: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", eventType: "Wedding", eventDate: "", timezone: "America/New_York", primaryContactId: "", venueName: "", city: "" },
  });
  const submit = handleSubmit(async (values) => {
    setError(null);
    try {
      const command = await runCrmCommand("createProject", {
        name: values.name,
        eventType: values.eventType,
        eventTypeId: values.eventType.toLowerCase(),
        eventDate: values.eventDate,
        timezone: values.timezone,
        clientContactIds: [values.primaryContactId],
        leadPhotographerId: null,
        leadId: null,
        venueName: values.venueName || null,
        city: values.city || null,
      });
      setOutcome({ persisted: command.persisted, reference: String(command.result.projectId ?? command.result.reference) });
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Project could not be created.");
    }
  });
  if (outcome) {
    return <div className="command-success"><CheckCircle2 size={23} /><h2>Project prepared</h2><p>Reference: {outcome.reference}</p>{!outcome.persisted ? <small>Preview mode: this record was not persisted.</small> : null}</div>;
  }
  return (
    <form className="command-form panel" onSubmit={submit}>
      <div className="form-grid">
        <label className="form-span">Project name <span className="required-mark">Required</span><input {...register("name")} autoFocus placeholder="e.g. Johnson wedding" required /><small>{errors.name?.message}</small></label>
        <label>Event type <span className="required-mark">Required</span><select {...register("eventType")} required><option>Wedding</option><option>Corporate</option><option>Sports</option></select></label>
        <label>Event date <span className="required-mark">Required</span><input {...register("eventDate")} required type="date" /><small>{errors.eventDate?.message}</small></label>
        <label className="form-span">
          Primary client <span className="required-mark">Required</span>
          <select {...register("primaryContactId")} disabled={contactsLoading} required>
            <option value="">{contactsLoading ? "Loading clients…" : "Select a client"}</option>
            {(contacts ?? []).map((contact) => (
              <option key={contact.id} value={contact.id}>
                {String(contact.displayName ?? contact.email ?? "Client")}
              </option>
            ))}
          </select>
          <small>{errors.primaryContactId?.message}</small>
          {!contactsLoading && !contacts?.length ? (
            <Link className="inline-form-action" href="/studio/clients/new">
              <UserPlus size={14} /> Add your first client
            </Link>
          ) : null}
        </label>
        <label>Timezone <span className="required-mark">Required</span><select {...register("timezone")} required><option>America/New_York</option><option>America/Chicago</option><option>America/Denver</option><option>America/Los_Angeles</option><option>Europe/London</option><option>Australia/Sydney</option></select></label>
        <label>Venue<input {...register("venueName")} placeholder="Venue name, if known" /></label>
        <label>City<input {...register("city")} placeholder="Event city" /></label>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="button button-dark" disabled={isSubmitting} type="submit">{isSubmitting ? <LoaderCircle className="spin" size={16} /> : null}Create project</button>
    </form>
  );
}
