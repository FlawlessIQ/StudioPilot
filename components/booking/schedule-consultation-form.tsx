"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { sendBookingCommand } from "@/lib/booking/command-client";

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

export function ScheduleConsultationForm() {
  const [notice, setNotice] = useState<string | null>(null);
  const [interactive, setInteractive] = useState(false);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      projectId: "wedding-contract",
      contactId: "contact-wedding-contract",
      mode: "zoom",
      startsAt: "2026-07-29T14:00",
      endsAt: "2026-07-29T14:45",
      timezone: "America/New_York",
      location: "",
    },
  });
  useEffect(() => {
    const frame = requestAnimationFrame(() => setInteractive(true));
    return () => cancelAnimationFrame(frame);
  }, []);
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
  return (
    <form className="booking-form" onSubmit={submit}>
      <label><span>Project</span><select {...form.register("projectId")}><option value="wedding-contract">Priya &amp; Jordan</option><option value="sports">Hudson Valley Media Day</option></select></label>
      <label><span>Meeting type</span><select {...form.register("mode")}><option value="zoom">Zoom</option><option value="in_person">In person</option><option value="phone">Phone</option><option value="custom">Custom</option></select></label>
      <label><span>Starts</span><input type="datetime-local" {...form.register("startsAt")} /></label>
      <label><span>Ends</span><input type="datetime-local" {...form.register("endsAt")} /></label>
      <label className="booking-form-wide"><span>Location (optional)</span><input placeholder="Studio address or call details" {...form.register("location")} /></label>
      <input type="hidden" {...form.register("contactId")} />
      <input type="hidden" {...form.register("timezone")} />
      <button className="button button-dark" type="submit" disabled={!interactive || form.formState.isSubmitting}>{form.formState.isSubmitting ? "Checking availability…" : "Schedule consultation"}</button>
      {notice ? <p className="form-notice" role="status">{notice}</p> : null}
    </form>
  );
}
