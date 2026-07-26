"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, LoaderCircle } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { runWorkflowCommand } from "@/lib/workflows/command-client";

const formSchema = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().min(10).max(3000),
  eventType: z.enum(["Wedding", "Corporate", "Sports"]),
  status: z.enum(["draft", "active"]),
});
type FormValues = z.infer<typeof formSchema>;

const checkpointChoices = [
  { key: "contract-completed", name: "Contract completed", category: "Booking", ownerType: "client", offsetDays: -120, completionMethod: "contract_completed", blocking: true },
  { key: "retainer-paid", name: "Retainer paid", category: "Booking", ownerType: "client", offsetDays: -120, completionMethod: "invoice_paid", blocking: true },
  { key: "questionnaire-complete", name: "Questionnaire complete", category: "Planning", ownerType: "client", offsetDays: -45, completionMethod: "form_submitted", blocking: true },
  { key: "coi-approved", name: "COI approved and sent", category: "Planning", ownerType: "studio", offsetDays: -21, completionMethod: "manual", blocking: true },
  { key: "schedule-approved", name: "Final schedule approved", category: "Readiness", ownerType: "client", offsetDays: -14, completionMethod: "schedule_approved", blocking: true },
  { key: "final-payment", name: "Final balance paid", category: "Readiness", ownerType: "client", offsetDays: -14, completionMethod: "invoice_paid", blocking: true },
  { key: "crew-acknowledged", name: "Crew acknowledged schedule", category: "Readiness", ownerType: "subcontractor", offsetDays: -7, completionMethod: "assignment_accepted", blocking: true },
] as const;

export function CreateWorkflowForm() {
  const [selected, setSelected] = useState<string[]>(
    checkpointChoices.map((checkpoint) => checkpoint.key),
  );
  const [outcome, setOutcome] = useState<{ persisted: boolean; reference: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "Wedding Photography",
      description: "A complete client lifecycle from booking through event readiness.",
      eventType: "Wedding",
      status: "draft",
    },
  });

  const submit = handleSubmit(async (values) => {
    setError(null);
    if (selected.length === 0) {
      setError("Select at least one checkpoint.");
      return;
    }
    try {
      const command = await runWorkflowCommand("createWorkflowTemplate", {
        name: values.name,
        description: values.description,
        eventTypeId: values.eventType.toLowerCase(),
        eventTypeLabel: values.eventType,
        status: values.status,
        checkpointTemplates: checkpointChoices
          .filter((checkpoint) => selected.includes(checkpoint.key))
          .map((checkpoint) => ({
            key: checkpoint.key,
            name: checkpoint.name,
            description: `${checkpoint.name} must be verified before event readiness.`,
            category: checkpoint.category,
            ownerType: checkpoint.ownerType,
            assignedUserId: null,
            assignedContactId: null,
            dueDateRule: {
              type: "relative",
              anchor: "event_date",
              offsetDays: checkpoint.offsetDays,
            },
            visibility: checkpoint.ownerType === "client" ? "shared" : checkpoint.ownerType === "subcontractor" ? "crew" : "studio",
            blocking: checkpoint.blocking,
            dependencies: [],
            completionMethod: checkpoint.completionMethod,
            requiredEvidence: checkpoint.completionMethod === "manual" ? ["studio approval"] : ["provider evidence"],
            reminderRules: [{ daysBeforeDue: 7, channel: "email", recipient: checkpoint.ownerType }],
            escalationRules: [{ daysOverdue: 1, notifyRole: "studio_admin" }],
            waiverAllowed: true,
          })),
        automationRules: [],
      });
      setOutcome({
        persisted: command.persisted,
        reference: String(
          command.result.workflowTemplateId ?? command.result.reference,
        ),
      });
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Workflow could not be created.");
    }
  });

  if (outcome) {
    return (
      <div className="command-success">
        <CheckCircle2 size={23} />
        <h2>Workflow version prepared</h2>
        <p>Reference: {outcome.reference}</p>
        {!outcome.persisted ? (
          <small>Preview mode: this workflow was not persisted.</small>
        ) : null}
      </div>
    );
  }

  return (
    <form className="command-form panel workflow-create-form" onSubmit={submit}>
      <div className="form-grid">
        <label className="form-span">Template name<input {...register("name")} /><small>{errors.name?.message}</small></label>
        <label className="form-span">Description<textarea {...register("description")} rows={3} /><small>{errors.description?.message}</small></label>
        <label>Event type<select {...register("eventType")}><option>Wedding</option><option>Corporate</option><option>Sports</option></select></label>
        <label>Initial state<select {...register("status")}><option value="draft">Draft</option><option value="active">Publish active</option></select></label>
      </div>
      <fieldset className="checkpoint-picker">
        <legend>Starting checkpoints</legend>
        {checkpointChoices.map((checkpoint) => (
          <label key={checkpoint.key}>
            <input
              checked={selected.includes(checkpoint.key)}
              onChange={(event) =>
                setSelected((current) =>
                  event.target.checked
                    ? [...current, checkpoint.key]
                    : current.filter((key) => key !== checkpoint.key),
                )
              }
              type="checkbox"
            />
            <span><strong>{checkpoint.name}</strong><small>{checkpoint.category} · {Math.abs(checkpoint.offsetDays)} days before event</small></span>
            {checkpoint.blocking ? <i>Blocking</i> : null}
          </label>
        ))}
      </fieldset>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="button button-dark" disabled={isSubmitting} type="submit">
        {isSubmitting ? <LoaderCircle className="spin" size={16} /> : null}
        Create workflow version
      </button>
    </form>
  );
}
