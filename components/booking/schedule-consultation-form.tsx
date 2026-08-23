"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CapabilityNote } from "@/components/integrations/capability-note";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { sendBookingCommand } from "@/lib/booking/command-client";
import { useTenantDocuments } from "@/components/live/tenant-records";

const schema = z.object({
  projectId: z.string().min(1),
  contactId: z.string().min(1),
  mode: z.enum(["zoom", "in_person", "phone", "custom"]),
  startsAt: z.string().min(1),
  endsAt: z.string().min(1),
  timezone: z.string().min(1),
  location: z.string(),
});
type Values = z.infer<typeof schema>;

/**
 * Nothing renders this.
 *
 * The live consultation booking is the form inside StudioCalendar, which
 * posts the same `scheduleConsultation` command; this component is exported
 * and never imported. Left in place rather than deleted because deleting a
 * working form is a bigger call than noting it, but it should either get a
 * route or go — see the route-reachability sweep in tests/.
 */
export function ScheduleConsultationForm() {
  const [notice, setNotice] = useState<string | null>(null);
  const [interactive, setInteractive] = useState(false);
  const { records: projects, loading } = useTenantDocuments("projects");
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      projectId: "",
      contactId: "",
      mode: "zoom",
      startsAt: "",
      endsAt: "",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      location: "",
    },
  });
  useEffect(() => {
    const frame = requestAnimationFrame(() => setInteractive(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    const first = projects?.find((project) =>
      Array.isArray(project.clientContactIds) &&
      project.clientContactIds.some((value) => typeof value === "string"),
    );
    if (!first || form.getValues("projectId")) return;
    form.setValue("projectId", first.id);
    form.setValue("contactId", String((first.clientContactIds as unknown[])[0]));
  }, [form, projects]);
  const submit = form.handleSubmit(async (values) => {
    setNotice(null);
    try {
      const result = await sendBookingCommand({
        type: "scheduleConsultation",
        idempotencyKey: crypto.randomUUID(),
        input: {
          ...values,
          startsAt: new Date(values.startsAt).toISOString(),
          endsAt: new Date(values.endsAt).toISOString(),
          location: values.location || null,
        },
      });
      setNotice(result.mode === "preview"
        ? "Development preview: availability, Zoom, calendar, and reminders were validated without persisting."
        : "Consultation scheduled and invitations queued.");
    } catch (caught: unknown) {
      setNotice(caught instanceof Error ? caught.message : "Consultation could not be scheduled.");
    }
  });
  const mode = form.watch("mode");

  return (
    <form className="booking-form" onSubmit={submit}>
      <label><span>Project</span><select disabled={loading} {...form.register("projectId", { onChange: (event) => {
        const selected = projects?.find((project) => project.id === event.target.value);
        const contacts = selected?.clientContactIds;
        form.setValue("contactId", Array.isArray(contacts) ? String(contacts[0] ?? "") : "");
      } })}><option value="">{loading ? "Loading projects…" : "Select a project"}</option>{projects?.map((project) => <option value={project.id} key={project.id}>{String(project.name)}</option>)}</select></label>
      <label><span>Meeting type</span><select {...form.register("mode")}><option value="zoom">Zoom</option><option value="in_person">In person</option><option value="phone">Phone</option><option value="custom">Custom</option></select></label>
      <label><span>Starts</span><input type="datetime-local" {...form.register("startsAt")} /></label>
      <label><span>Ends</span><input type="datetime-local" {...form.register("endsAt")} /></label>
      <label className="booking-form-wide"><span>Location (optional)</span><input placeholder="Studio address or call details" {...form.register("location")} /></label>
      <input type="hidden" {...form.register("contactId")} />
      <input type="hidden" {...form.register("timezone")} />
      {/* Scheduling always writes a calendar event; it only mints a
          meeting link when the type is Zoom. Showing the meetings note on
          an in-person consultation would be noise about a provider the
          booking is not going to use. */}
      <div className="booking-form-wide booking-form-notes">
        <CapabilityNote capability="calendar" />
        {mode === "zoom" ? <CapabilityNote capability="meetings" /> : null}
      </div>
      <button className="button button-dark" type="submit" disabled={!interactive || form.formState.isSubmitting}>{form.formState.isSubmitting ? "Checking availability…" : "Schedule consultation"}</button>
      {notice ? <p className="form-notice" role="status">{notice}</p> : null}
    </form>
  );
}
