"use client";

import { useState } from "react";
import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, CheckCircle2, LoaderCircle } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { runWorkflowCommand } from "@/lib/workflows/command-client";
import { useTenantDocuments } from "@/components/live/tenant-records";
import {
  describePublishEffect,
  publishEffect,
} from "@/features/workflows/publication";

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

const automationChoices = [
  {
    key: "review-new-inquiry",
    name: "Create a lead-review task",
    detail: "When an inquiry arrives, create an internal follow-up task.",
    trigger: "lead_created",
    actions: [
      {
        key: "create-lead-review-task",
        type: "create_task",
        configuration: {
          title: "Review new inquiry",
          description: "Review fit, availability, and missing information.",
          priority: "high",
        },
        requiresApproval: false,
      },
    ],
  },
  {
    key: "confirm-consultation",
    name: "Send consultation confirmation",
    detail: "Queue the branded confirmation after a consultation is scheduled.",
    trigger: "consultation_scheduled",
    actions: [
      {
        key: "send-consultation-confirmation",
        type: "send_email",
        configuration: { template: "consultation_confirmation" },
        requiresApproval: false,
      },
    ],
  },
  {
    key: "complete-contract-checkpoint",
    name: "Complete the contract checkpoint",
    detail: "Wait for the signing provider to confirm completion — never a guess.",
    trigger: "contract_completed",
    actions: [
      {
        key: "complete-contract",
        type: "complete_checkpoint",
        configuration: { templateKey: "contract-completed" },
        requiresApproval: false,
      },
    ],
  },
  {
    key: "review-retainer-payment",
    name: "Complete retainer and alert the studio",
    detail: "Record payment evidence, then prompt the studio to run booking.",
    trigger: "invoice_paid",
    actions: [
      {
        key: "complete-retainer",
        type: "complete_checkpoint",
        configuration: { templateKey: "retainer-paid" },
        requiresApproval: false,
      },
      {
        key: "booking-ready-alert",
        type: "send_internal_alert",
        configuration: {
          title: "Retainer received",
          body: "Review the booking gate and complete booking when every requirement passes.",
        },
        requiresApproval: false,
      },
    ],
  },
  {
    key: "review-questionnaire",
    name: "Create questionnaire review task",
    detail: "Put every submitted questionnaire into the studio review queue.",
    trigger: "form_submitted",
    actions: [
      {
        key: "create-questionnaire-review",
        type: "create_task",
        configuration: {
          title: "Review submitted questionnaire",
          priority: "normal",
        },
        requiresApproval: false,
      },
    ],
  },
  {
    key: "schedule-approved-alert",
    name: "Notify the studio when a schedule is approved",
    detail: "Create an internal alert before final publication and crew acknowledgement.",
    trigger: "schedule_approved",
    actions: [
      {
        key: "schedule-approved-notification",
        type: "send_internal_alert",
        configuration: {
          title: "Schedule approved",
          body: "Publish the final schedule and confirm crew acknowledgement.",
        },
        requiresApproval: false,
      },
    ],
  },
  {
    key: "schedule-confirmation-30-days",
    name: "Request the final schedule confirmation",
    detail:
      "Thirty days before a wedding, send the current schedule for client review.",
    trigger: "relative_date_reached",
    conditions: [
      {
        field: "relativeDateKey",
        operator: "equals",
        value: "schedule_confirmation_30_days",
      },
    ],
    eventTypes: ["Wedding"],
    actions: [
      {
        key: "send-schedule-confirmation",
        type: "send_email",
        configuration: {
          templateKey: "schedule_review",
          values: { scheduleStatus: "review" },
        },
        requiresApproval: false,
      },
    ],
  },
  {
    key: "event-preparation-1-day",
    name: "Send the day-before preparation note",
    detail:
      "One day before a wedding, remind the client to gather the dress, shoes, flowers, rings, and invitation.",
    trigger: "relative_date_reached",
    conditions: [
      {
        field: "relativeDateKey",
        operator: "equals",
        value: "event_preparation_1_day",
      },
    ],
    eventTypes: ["Wedding"],
    actions: [
      {
        key: "send-event-preparation",
        type: "send_email",
        configuration: { templateKey: "event_reminder" },
        requiresApproval: false,
      },
    ],
  },
] as const;

export function CreateWorkflowForm({
  reviseTemplateId = null,
}: {
  /** Set when arriving from "New version" on an existing template. */
  reviseTemplateId?: string | null;
} = {}) {
  const templates = useTenantDocuments("workflowTemplates");
  const source = reviseTemplateId
    ? (templates.records ?? []).find(
        (template) => String(template.id) === reviseTemplateId,
      )
    : undefined;
  const [selected, setSelected] = useState<string[]>(
    checkpointChoices.map((checkpoint) => checkpoint.key),
  );
  const [selectedAutomations, setSelectedAutomations] = useState<string[]>(
    automationChoices.map((automation) => automation.key),
  );
  const [outcome, setOutcome] = useState<{
    persisted: boolean;
    reference: string;
    active: boolean;
    eventType: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "Wedding Photography",
      description: "A complete client lifecycle from booking through event readiness.",
      eventType: "Wedding",
      // Publishing is the point. A draft template is inert, and defaulting
      // to it meant the ordinary path through this form produced nothing.
      status: "active",
    },
  });
  /**
   * Adopt the template being revised, once.
   *
   * Adjusted during render rather than in an effect: an effect renders the
   * blank form first and then the filled one, and a form that visibly
   * rewrites itself under the cursor is worse than one that waits. Keyed
   * on the record's id so it happens exactly once per template.
   */
  const [adopted, setAdopted] = useState<string | null>(null);
  if (source && adopted !== reviseTemplateId) {
    setAdopted(reviseTemplateId);
    setValue("name", String(source.name ?? ""));
    setValue("description", String(source.description ?? ""));
    const label = String(source.eventTypeLabel ?? "");
    if (["Wedding", "Corporate", "Sports"].includes(label)) {
      setValue("eventType", label as FormValues["eventType"]);
    }
    const keys = new Set(
      (Array.isArray(source.checkpointTemplates)
        ? source.checkpointTemplates
        : []
      ).map((entry) => String((entry as { key?: unknown }).key ?? "")),
    );
    // Only the checkpoints this form knows how to offer. A template that
    // carries steps the form cannot render must not have them silently
    // dropped from the tick list and then dropped from the new version —
    // see the note below the picker.
    setSelected(
      checkpointChoices
        .filter((choice) => keys.has(choice.key))
        .map((choice) => choice.key),
    );
    const ruleKeys = new Set(
      (Array.isArray(source.automationRules) ? source.automationRules : []).map(
        (entry) => String((entry as { key?: unknown }).key ?? ""),
      ),
    );
    setSelectedAutomations(
      automationChoices
        .filter((choice) => ruleKeys.has(choice.key))
        .map((choice) => choice.key),
    );
  }

  /**
   * Steps the source template has that this form cannot show.
   *
   * Publishing would drop them, because the payload is rebuilt from the
   * tick list. Saying so is the minimum; the real fix is the editor that
   * can render them, which is a separate piece of work.
   */
  const unrenderable = source
    ? (Array.isArray(source.checkpointTemplates)
        ? source.checkpointTemplates
        : []
      ).filter(
        (entry) =>
          !checkpointChoices.some(
            (choice) =>
              choice.key === String((entry as { key?: unknown }).key ?? ""),
          ),
      ).length
    : 0;

  const eventType = watch("eventType");
  const status = watch("status");
  /**
   * Editing a workflow is republishing one under the same name.
   *
   * createWorkflowTemplate looks up prior versions by name, increments the
   * version and supersedes the previous active one — so the mechanism for
   * "change my workflow" already exists and works. Nothing anywhere said
   * so, which left a photographer with a template they could not edit and
   * no way to discover that recreating it *is* the edit.
   */
  const effect = publishEffect({
    name: watch("name"),
    eventTypeId: watch("eventType").toLowerCase(),
    status: watch("status"),
    existing: (templates.records ?? []).map((template) => ({
      id: String(template.id ?? ""),
      name: String(template.name ?? ""),
      eventTypeId: String(template.eventTypeId ?? ""),
      status: String(template.status ?? ""),
      version: Number(template.version ?? 0),
    })),
  });
  const availableAutomations = automationChoices.filter(
    (automation) =>
      !("eventTypes" in automation) ||
      (automation.eventTypes as readonly string[]).includes(eventType),
  );

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
        automationRules: automationChoices
          .filter((automation) =>
            selectedAutomations.includes(automation.key) &&
            (!("eventTypes" in automation) ||
              (automation.eventTypes as readonly string[]).includes(
                values.eventType,
              )),
          )
          .map((automation) => ({
            key: automation.key,
            name: automation.name,
            trigger: automation.trigger,
            conditions:
              "conditions" in automation ? automation.conditions : [],
            actions: automation.actions,
            active: true,
          })),
      });
      setOutcome({
        persisted: command.persisted,
        reference: String(
          command.result.workflowTemplateId ?? command.result.reference,
        ),
        active: values.status === "active",
        eventType: values.eventType,
      });
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Workflow could not be created.");
    }
  });

  if (outcome) {
    return (
      <div className="command-success">
        <CheckCircle2 size={23} />
        <h2>{outcome.active ? "Workflow is live" : "Workflow saved as a draft"}</h2>
        {/* "Workflow saved" and nothing else was a dead end: no link to the
            thing just made, no way back to the list, and — the part that
            actually matters — no statement of whether it will ever run. A
            draft never does. */}
        <p>
          {outcome.active
            ? `From now on, every ${outcome.eventType.toLowerCase()} that reaches booking starts with these checkpoints, dated from its event date.`
            : `Drafts do not run. Nothing will change on your ${outcome.eventType.toLowerCase()} jobs until you publish this.`}
        </p>
        {!outcome.persisted ? (
          <small>This is a preview. Connect the live database to save it.</small>
        ) : null}
        <div className="command-success-actions">
          <Link className="button button-dark" href="/studio/workflows">
            Back to workflows <ArrowRight size={15} />
          </Link>
          {outcome.reference && outcome.persisted ? (
            <Link
              className="button button-light"
              href={`/studio/workflows/${outcome.reference}`}
            >
              Open this workflow
            </Link>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <form className="command-form panel workflow-create-form" onSubmit={submit}>
      <div className="form-grid">
        <label className="form-span">Template name<input {...register("name")} /><small>{errors.name?.message}</small></label>
        <label className="form-span">Description<textarea {...register("description")} rows={3} /><small>{errors.description?.message}</small></label>
        <label>Event type<select {...register("eventType")}><option>Wedding</option><option>Corporate</option><option>Sports</option></select></label>
        <label>
          Availability
          <select {...register("status")}>
            <option value="active">Publish — use on new {eventType.toLowerCase()} jobs</option>
            <option value="draft">Keep as a draft — does not run</option>
          </select>
          {/* Draft used to be the default, which meant the ordinary result
              of filling this in was a template that would never do
              anything, with nothing on screen to say so. */}
          <small>
            {status === "active"
              ? (describePublishEffect(effect, eventType) ??
                "Runs automatically when a job reaches booking.")
              : "Saved, but it will not run until you publish it."}
          </small>
        </label>
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
            {checkpoint.blocking ? <i>Required for readiness</i> : null}
          </label>
        ))}
      </fieldset>
      {unrenderable ? (
        <p className="form-notice" role="status">
          {`This workflow has ${unrenderable} step${unrenderable === 1 ? "" : "s"} that this form cannot show yet, so publishing from here would leave ${unrenderable === 1 ? "it" : "them"} out. The current version stays untouched until you publish.`}
        </p>
      ) : null}
      <fieldset className="checkpoint-picker">
        <legend>Starting automations</legend>
        {availableAutomations.map((automation) => (
          <label key={automation.key}>
            <input
              checked={selectedAutomations.includes(automation.key)}
              onChange={(event) =>
                setSelectedAutomations((current) =>
                  event.target.checked
                    ? [...current, automation.key]
                    : current.filter((key) => key !== automation.key),
                )
              }
              type="checkbox"
            />
            <span>
              <strong>{automation.name}</strong>
              <small>{automation.detail}</small>
            </span>
            <i>{automation.trigger.replaceAll("_", " ")}</i>
          </label>
        ))}
      </fieldset>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="button button-dark" disabled={isSubmitting} type="submit">
        {isSubmitting ? <LoaderCircle className="spin" size={16} /> : null}
        Create workflow
      </button>
    </form>
  );
}
