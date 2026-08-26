"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, LoaderCircle } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { runWorkflowCommand } from "@/lib/workflows/command-client";
import { friendlyError } from "@/lib/ai/friendly-error";

const schema = z.object({
  projectId: z.string().trim().min(1),
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(3000),
  dueDate: z.string().date(),
  priority: z.enum(["low", "normal", "high", "urgent"]),
  blocking: z.boolean(),
});
type FormValues = z.infer<typeof schema>;

export function CreateTaskForm({ initialProjectId = "" }: { initialProjectId?: string }) {
  const { records: projects, loading: projectsLoading } =
    useTenantDocuments("projects");
  const [outcome, setOutcome] = useState<{ persisted: boolean; reference: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      projectId: initialProjectId,
      title: "",
      description: "",
      dueDate: "",
      priority: "normal",
      blocking: false,
    },
  });
  const submit = handleSubmit(async (values) => {
    setError(null);
    try {
      const command = await runWorkflowCommand("createTask", {
        projectId: values.projectId,
        workflowRunId: null,
        checkpointId: null,
        title: values.title,
        description: values.description,
        assignedUserId: null,
        assignedRole: "studio_coordinator",
        dueDate: values.dueDate,
        priority: values.priority,
        blocking: values.blocking,
      });
      setOutcome({
        persisted: command.persisted,
        reference: String(command.result.taskId ?? command.result.reference),
      });
    } catch (caught: unknown) {
      setError(friendlyError(caught, "Task could not be created."));
    }
  });
  if (outcome) {
    return <div className="command-success"><CheckCircle2 size={23} /><h2>Task prepared</h2><p>Reference: {outcome.reference}</p>{!outcome.persisted ? <small>Preview mode: this task was not persisted.</small> : null}</div>;
  }
  return (
    <form className="command-form panel" onSubmit={submit}>
      <div className="form-grid">
        <label>Project <span className="required-mark">Required</span><select {...register("projectId")} disabled={projectsLoading} required><option value="">{projectsLoading ? "Loading projects…" : "Select a project"}</option>{(projects ?? []).map((project) => <option key={project.id} value={project.id}>{String(project.name ?? "Project")}</option>)}</select><small>{errors.projectId?.message}</small></label>
        <label>Due date <span className="required-mark">Required</span><input {...register("dueDate")} required type="date" /><small>{errors.dueDate?.message}</small></label>
        <label className="form-span">Task title <span className="required-mark">Required</span><input {...register("title")} placeholder="What needs to be done?" required /><small>{errors.title?.message}</small></label>
        <label className="form-span">Description<textarea {...register("description")} placeholder="Add instructions, context, or expected evidence." rows={3} /></label>
        <label>Priority<select {...register("priority")}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>
        <label className="check-control"><input {...register("blocking")} type="checkbox" /><span>Affects readiness</span></label>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="button button-dark" disabled={isSubmitting} type="submit">{isSubmitting ? <LoaderCircle className="spin" size={16} /> : null}Create task</button>
    </form>
  );
}
